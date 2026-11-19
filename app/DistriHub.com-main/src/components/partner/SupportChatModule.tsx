import { authenticatedRealtime } from '../../lib/authenticatedRealtime';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Send, Sparkles, MessageSquareText } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { OperationAttempts, type OperationAttempt } from '../../lib/operationAttempts';

export type SupportMessage = {
  id: string;
  user_id: string;
  sender_role: 'cliente' | 'suporte';
  message: string;
  created_at: string;
  message_position: number;
};

type Props = { user: User | null; conversationUserId?: string; admin?: boolean; isActive?: boolean };
type SendPayload = { userId: string; admin: boolean; text: string };
const position = (row: SupportMessage) => {
  const value = Number(row.message_position);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Sequência de mensagens inválida.');
  return value;
};
const merge = (old: SupportMessage[], rows: SupportMessage[]) => {
  const result = new Map(old.map(row => [row.id, row]));
  for (const row of rows) { position(row); result.set(row.id, row); }
  return [...result.values()].sort((a, b) => position(a) - position(b));
};
export function SupportChatModule(props: Props) {
  return <SupportChat key={JSON.stringify([props.user?.id, props.conversationUserId, props.admin])} {...props} />;
}
function SupportChat({ user, conversationUserId, admin = false, isActive = true }: Props) {
  const userId = conversationUserId ?? user?.id;
  const actorId = user?.id;
  const scope = JSON.stringify([actorId, userId, admin]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState<OperationAttempt<SendPayload> | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const mounted = useRef(true);
  const active = useRef(isActive); active.current = isActive;
  const sendLock = useRef(false);
  const olderLock = useRef(false);
  const cursor = useRef<number | null>(null);
  const reload = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const latestMessageId = messages[messages.length - 1]?.id;
  const acknowledgedPosition = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const recoverAttempt = useCallback(() => {
    try {
      const attempt = new OperationAttempts(window.sessionStorage).pending<SendPayload>(scope, 'support-message');
      if (attempt && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt.id) || attempt.payload.userId !== userId || attempt.payload.admin !== admin || typeof attempt.payload.text !== 'string' || !attempt.payload.text.trim() || attempt.payload.text !== attempt.payload.text.trim() || attempt.payload.text.length > 2000)) throw new Error('Tentativa inválida');
      setPending(attempt);
      if (attempt) setMessage(attempt.payload.text);
      setStorageReady(true); setError(null);
    } catch {
      setStorageReady(false); setError('Não foi possível recuperar o envio pendente. Tente novamente antes de enviar outra mensagem.');
    }
  }, [admin, scope, userId]);
  useEffect(() => { recoverAttempt(); }, [recoverAttempt]);
  useEffect(() => { if (isActive) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [latestMessageId, loading, isActive]);
  const quickMessages = ['Preciso de ajuda com o cadastro de clientes.', 'Quero revisar meu limite de crédito.', 'Estou com problema no pedido ou entrega.'];

  useEffect(() => {
    if (!supabase || !actorId || !userId || !isActive) return;
    const client = supabase;
    let live = true, busy = false, queued = false;
    const loadMessages = async () => {
      if (busy) { queued = true; return; }
      busy = true;
      try {
        if (cursor.current === null) {
          const { data, error } = await client.from('support_messages').select('*').eq('user_id', userId).order('message_position', { ascending: false }).limit(50);
          if (error) throw error;
          if (!live) return;
          const rows = (data ?? []) as SupportMessage[];
          setMessages(old => merge(old, rows));
          cursor.current = rows.length ? Math.max(...rows.map(position)) : 0;
          setHasOlder(rows.length === 50);
        }
        // Advance only the read cursor, never the cursor of an optimistic/send response.
        for (let page = 0; page < 20 && live; page++) {
          const { data, error } = await client.from('support_messages').select('*').eq('user_id', userId).gt('message_position', cursor.current).order('message_position', { ascending: true }).limit(50);
          if (error) throw error;
          if (!live) return;
          const rows = (data ?? []) as SupportMessage[];
          setMessages(old => merge(old, rows));
          if (rows.length) cursor.current = Math.max(...rows.map(position));
          if (rows.length < 50) break;
        }
        if (live) setReadError(null);
      } catch { if (live) setReadError('Não foi possível atualizar a conversa. Tente novamente.'); }
      finally {
        busy = false;
        if (live) { setLoading(false); if (queued) { queued = false; void loadMessages(); } }
      }
    };
    reload.current = () => { void loadMessages(); };
    const stopRealtime = authenticatedRealtime(client, () => client.channel('support-' + scope).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: 'user_id=eq.' + userId }, () => { void loadMessages(); }), { label: 'support-chat', expectedUserId: actorId, onStatus: status => { if (status === 'SUBSCRIBED') void loadMessages(); } });
    void loadMessages();
    const interval = window.setInterval(() => { void loadMessages(); }, 10000);
    return () => { live = false; reload.current = null; window.clearInterval(interval); stopRealtime(); };
  }, [actorId, userId, admin, isActive, scope]);

  useEffect(() => {
    if (!supabase || !actorId || !userId || !isActive || loading || typeof document === 'undefined') return;
    const client = supabase;
    const incoming = messages.filter(row => row.sender_role === (admin ? 'cliente' : 'suporte'));
    const lastPosition = incoming.length ? Math.max(...incoming.map(position)) : 0;
    if (!lastPosition) return;
    let live = true;
    const acknowledge = async () => {
      if (!live || document.visibilityState !== 'visible' || lastPosition <= acknowledgedPosition.current) return;
      try {
        const {error} = await client.rpc('mark_support_messages_read', {p_user_id: userId, p_position: lastPosition, p_admin: admin});
        if (!error && live) {
          acknowledgedPosition.current = Math.max(acknowledgedPosition.current, lastPosition);
          window.dispatchEvent(new Event('distrihub:support-read'));
        }
      } catch { /* The next conversation refresh retries the acknowledgement. */ }
    };
    void acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    window.addEventListener('focus', acknowledge);
    return () => { live = false; document.removeEventListener('visibilitychange', acknowledge); window.removeEventListener('focus', acknowledge); };
  }, [actorId, userId, admin, isActive, loading, messages]);

  async function loadOlder() {
    if (!supabase || !userId || !messages[0] || olderLock.current || !active.current) return;
    olderLock.current = true; setLoadingOlder(true);
    try {
      const { data, error } = await supabase.from('support_messages').select('*').eq('user_id', userId).lt('message_position', position(messages[0])).order('message_position', { ascending: false }).limit(50);
      if (error) throw error;
      if (!mounted.current || !active.current) return;
      setHasOlder((data?.length ?? 0) === 50);
      setMessages(old => merge(old, (data ?? []) as SupportMessage[]));
    } catch { if (mounted.current) setReadError('Não foi possível carregar as mensagens anteriores. Tente novamente.'); }
    finally { olderLock.current = false; if (mounted.current) setLoadingOlder(false); }
  }
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !actorId || !userId || !active.current || sendLock.current || !storageReady) return;
    const text = message.trim();
    if (!text || text.length > 2000) { setError('A mensagem deve ter de 1 a 2000 caracteres.'); return; }
    sendLock.current = true; setSending(true); setError(null);
    try {
      const attempts = new OperationAttempts(window.sessionStorage);
      const attempt = attempts.get(scope, 'support-message', { userId, admin, text });
      setPending(attempt);
      const { data, error } = await supabase.rpc('send_support_message_once', { p_request_id: attempt.id, p_user_id: userId, p_admin: admin, p_message: text });
      if (error) throw error;
      const row = data as SupportMessage | null;
      if (!row || row.id !== attempt.id || row.user_id !== userId || row.sender_role !== (admin ? 'suporte' : 'cliente') || row.message !== text) throw new Error('Envio não confirmado');
      position(row);
      attempts.confirm(scope, 'support-message');
      if (!mounted.current) return;
      setMessages(old => merge(old, [row])); setPending(null); setMessage('');
      reload.current?.();
    } catch {
      if (mounted.current) setError('Envio não confirmado. Sua mensagem foi preservada; use Reenviar para conferir a mesma tentativa.');
    } finally { sendLock.current = false; if (mounted.current) setSending(false); }
  }

  const notConfigured = !supabase || !user;

  return (
    <div className="panel-module">
      <div className="module-header">
        <span className="module-icon"><Headphones size={20} /></span>
        <div><h3>Chat de Suporte</h3><p>{admin ? 'Responda ao cliente da plataforma' : 'Envie sua mensagem diretamente ao Super Admin'}</p></div>
      </div>

      {!notConfigured && !admin && (
        <div className="support-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8bc7ff' }}>
            <MessageSquareText size={16} />
            <span>Canal direto com o Super Admin</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {quickMessages.map((text) => (
              <button key={text} type="button" className="rma-advance-btn" disabled={sending || !!pending || !storageReady} onClick={() => { if (!sendLock.current && !pending) setMessage(text); }} style={{ fontSize: '13px', minWidth: 'auto' }}>
                <Sparkles size={12} /> {text}
              </button>
            ))}
          </div>
        </div>
      )}

      {notConfigured ? (
        <div className="empty-row" style={{ padding: '24px 16px' }}>
          O chat ainda não está disponível para este usuário ou ambiente. Conecte a sessão do Supabase para ativar o suporte ao vivo.
        </div>
      ) : (
        <>
          {error && <p role="alert" className="admin-load-error">{error}</p>}
          {!storageReady && <button type="button" onClick={recoverAttempt}>Tentar recuperar envio</button>}
          {readError && <p role="alert">{readError}<button type="button" onClick={() => reload.current?.()}>Atualizar conversa</button></p>}
          {hasOlder && <button type="button" className="rma-advance-btn" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Carregando...' : 'Carregar mensagens anteriores'}</button>}
          <div className="support-chat-messages">
            {loading ? <p className="empty-row">Carregando conversa...</p> : messages.length === 0 ? <p className="empty-row">{readError ? 'Conversa ainda não confirmada.' : 'Envie uma mensagem para iniciar o atendimento.'}</p> : messages.map((item) => (
              <div key={item.id} className={`support-message ${item.sender_role}`}>
                <span>{item.sender_role === 'cliente' ? (admin ? 'Cliente' : 'Você') : 'Super Admin'}</span>
                <p>{item.message}</p>
                <small>{new Date(item.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <form className="support-chat-form" onSubmit={sendMessage}>
            <input disabled={sending || !!pending || !storageReady} value={message} onChange={(e) => { if (!sendLock.current && !pending) setMessage(e.target.value); }} placeholder="Digite sua mensagem..." maxLength={2000} />
            <button type="submit" className="module-submit-btn" disabled={!message.trim() || sending || !storageReady} aria-label={pending ? "Reenviar mensagem" : "Enviar mensagem"}><Send size={16} />{pending && "Reenviar"}</button>
          </form>
        </>
      )}
    </div>
  );
}
