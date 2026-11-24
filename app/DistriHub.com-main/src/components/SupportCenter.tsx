import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BookOpen, Headphones, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './SupportCenter.css';

type Status = 'open' | 'active' | 'waiting' | 'resolved';
type Ticket = { id: string; protocol: number; subject: string; area: string; company: string; branch: string | null; status: Status; assigned: boolean; mine: boolean; updated_at: string };
type Thread = { ticket: Ticket; messages: { id: string; body: string; admin: boolean; created_at: string; position: number }[]; attachment: { mime: string; data: string } | null };
type Props = { admin?: boolean; active?: boolean; branchId?: string; branchName?: string; onHelp?: () => void };
const statuses: Record<Status, string> = { open: 'Aberto', active: 'Em atendimento', waiting: 'Aguardando cliente', resolved: 'Resolvido' };
const areas = ['Acesso', 'PDV e caixa', 'Produtos e serviços', 'Pedidos e orçamentos', 'Financeiro', 'Fiscal', 'Outros'];
const pageSize = 25;
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];

export function SupportCenter({ admin = false, active = true, branchId, branchName, onHelp }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState('');
  const [thread, setThread] = useState<Thread>();
  const [moreHistory, setMoreHistory] = useState(false);
  const paged = useRef(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState('');
  const [area, setArea] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File>();
  const [reply, setReply] = useState('');
  const createId = useRef<string>();
  const replyId = useRef<string>();

  const rpc = useCallback(async <T,>(action: string, data: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    if (!supabase) throw new Error('Serviço indisponível.');
    const query = supabase.rpc('support_ticket_workspace', { p_admin: admin, p_action: action, p_input: data });
    const result = await (signal ? query.abortSignal(signal) : query);
    if (result.error) {
      throw new Error(result.error.code === 'PGRST202' ? 'A Central de Suporte ainda não está disponível neste ambiente.' :
        result.error.message === 'SUPPORT_TICKET_ASSIGNED' ? 'Outro administrador já assumiu o chamado. Atualize a fila.' :
        'Não foi possível concluir. Confira o acesso e tente novamente.');
    }
    return result.data as T;
  }, [admin]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await rpc<Ticket[]>('list', { filter, search, page }, controller.signal);
        if (!controller.signal.aborted) setTickets(result);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Falha ao atualizar a fila.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, rpc, filter, search, page, revision]);

  useEffect(() => {
    if (!active || !selected) return;
    const controller = new AbortController();
    let includeAttachment = true;
    async function load() {
      try {
        const result = await rpc<Thread>('read', { id: selected, includeAttachment }, controller.signal);
        if (controller.signal.aborted) return;
        includeAttachment = false;
        if (!paged.current) setMoreHistory(result.messages.length > 50);
        const incoming = result.messages.slice(-50);
        setThread(current => {
          if (current?.ticket.id !== selected) return { ...result, messages: incoming };
          const messages = new Map(current.messages.map(message => [message.id, message]));
          for (const message of incoming) messages.set(message.id, message);
          return { ...result, attachment: result.attachment ?? current.attachment, messages: [...messages.values()].sort((a, b) => a.position - b.position) };
        });
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Falha ao abrir o chamado.');
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, rpc, selected, revision]);

  async function run(task: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError('');
    try {
      await task();
      refresh(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.');
    } finally {
      locked.current = false; setBusy(false);
    }
  }

  function openTicket(event: FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !description.trim() || !area) return;
    void run(async () => {
      const attachment = file ? await readImage(file) : undefined;
      createId.current ??= crypto.randomUUID();
      const ticket = await rpc<{ id: string }>('open', { id: createId.current, subject, area, body: description, branchId, attachment });
      createId.current = undefined;
      paged.current = false;
      setSelected(ticket.id); setThread(undefined); setMoreHistory(false); setCreating(false);
      setSubject(''); setArea(''); setDescription(''); setFile(undefined);
    });
  }

  function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    void run(async () => {
      replyId.current ??= crypto.randomUUID();
      await rpc('reply', { id: selected, requestId: replyId.current, body: reply });
      replyId.current = undefined;
      setReply('');
    });
  }

  const ticket = thread?.ticket.id === selected ? thread.ticket : undefined;
  const canReply = ticket && ticket.status !== 'resolved' && (!admin || ticket.mine);
  return (
    <section className="module-card support-center" aria-labelledby="support-center-title">
      <header className="support-center-header">
        <div className="module-header"><Headphones size={21} aria-hidden="true" /><div><h2 id="support-center-title">{admin ? 'Fila de chamados' : 'Central de Suporte'}</h2><p>{admin ? 'Acompanhe os chamados das empresas.' : 'Abra um chamado e acompanhe as respostas da equipe.'}</p></div></div>
        {!admin && <div className="support-center-actions">
          {onHelp && <button className="btn-secondary" type="button" onClick={onHelp}><BookOpen size={16} aria-hidden="true" /> Ajuda rápida</button>}
          <button className="btn-primary" type="button" aria-expanded={creating} onClick={() => setCreating(value => !value)}><Plus size={16} aria-hidden="true" /> {creating ? 'Fechar formulário' : 'Abrir chamado'}</button>
        </div>}
      </header>
      {error && <p role="alert">{error} <button type="button" className="btn-secondary" onClick={() => { setError(''); refresh(value => value + 1); }}>Atualizar</button></p>}
      {creating && !admin && <form className="support-center-form" onSubmit={openTicket}>
        <h3>Novo chamado</h3>
        <p>Filial: {branchName || 'Sem filial específica'}</p>
        <label>Assunto<input required maxLength={120} disabled={busy} value={subject} onChange={event => { createId.current = undefined; setSubject(event.target.value); }} /></label>
        <label>Módulo afetado<select required disabled={busy} value={area} onChange={event => { createId.current = undefined; setArea(event.target.value); }}><option value="">Selecione</option>{areas.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Descrição<textarea required maxLength={2000} disabled={busy} value={description} onChange={event => { createId.current = undefined; setDescription(event.target.value); }} /></label>
        <label>Captura de tela <small>PNG, JPEG ou WebP, até 1 MB</small><input type="file" accept={imageTypes.join(',')} disabled={busy} onChange={event => { createId.current = undefined; setFile(event.target.files?.[0]); }} /></label>
        <button className="btn-primary" disabled={busy || !area || !subject.trim() || !description.trim()}>Registrar chamado</button>
      </form>}
      <div className="support-center-layout">
        <aside className="support-center-list">
          <h3>{admin ? 'Chamados recebidos' : 'Meus chamados'}</h3>
          <label>Buscar<input type="search" value={search} maxLength={120} placeholder={admin ? 'Empresa, filial ou assunto' : 'Protocolo ou assunto'} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
          <label>Status<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">Todos</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {loading && <p role="status">Carregando chamados…</p>}
          {!loading && !tickets.length && !error && <p>Nenhum chamado encontrado.</p>}
          {tickets.slice(0, pageSize).map(item => <button type="button" className="support-ticket-row" aria-pressed={item.id === selected} key={item.id} disabled={busy} onClick={() => {
            if (item.id === selected) return;
            paged.current = false;
            setSelected(item.id); setThread(undefined); setMoreHistory(false); setReply(''); replyId.current = undefined;
          }}>
            <span>#{item.protocol} · {statuses[item.status]}</span><strong>{item.subject}</strong>
            <small>{[admin ? item.company : item.area, item.branch, new Date(item.updated_at).toLocaleString('pt-BR')].filter(Boolean).join(' · ')}</small>
          </button>)}
          {(page > 0 || tickets.length > pageSize) && <div className="support-center-actions">
            <button type="button" className="btn-secondary" disabled={!page} onClick={() => setPage(value => value - 1)}>Anterior</button>
            <button type="button" className="btn-secondary" disabled={tickets.length <= pageSize} onClick={() => setPage(value => value + 1)}>Próxima</button>
          </div>}
        </aside>
        <article className="support-center-thread">
          {ticket ? <>
            <h3>#{ticket.protocol} · {ticket.subject}</h3>
            <p>{statuses[ticket.status]} · {ticket.branch ?? 'Sem filial específica'} · {ticket.assigned ? admin && ticket.mine ? 'Responsável: você' : 'Responsável: equipe de suporte' : 'Sem responsável'}</p>
            {admin && <div className="support-center-actions">
              {!ticket.assigned && <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(() => rpc('claim', { id: selected }))}>Assumir</button>}
              {ticket.mine && ticket.status !== 'resolved' && <>
                <button type="button" className="btn-secondary" disabled={busy || ticket.status === 'waiting'} onClick={() => void run(() => rpc('waiting', { id: selected }))}>Aguardar cliente</button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(() => rpc('resolve', { id: selected }))}>Resolver</button>
              </>}
            </div>}
            {thread?.attachment && imageTypes.includes(thread.attachment.mime) && <details><summary>Ver captura de tela</summary><img className="support-ticket-image" alt="Captura de tela anexada ao chamado" src={`data:${thread.attachment.mime};base64,${thread.attachment.data}`} /></details>}
            {moreHistory && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(async () => {
              const before = thread?.messages[0]?.position;
              if (!before) return;
              const result = await rpc<Thread>('read', { id: selected, before });
              paged.current = true;
              setMoreHistory(result.messages.length > 50);
              setThread(current => current?.ticket.id === selected ? {
                ...current, messages: [...result.messages.slice(-50), ...current.messages],
              } : current);
            })}>Mensagens anteriores</button>}
            <ol className="support-ticket-messages">{thread?.messages.map(message => <li key={message.id} data-admin={message.admin}>
              <small>{message.admin ? 'Suporte' : 'Cliente'} · {new Date(message.created_at).toLocaleString('pt-BR')}</small><p>{message.body}</p>
            </li>)}</ol>
            {canReply && <form className="support-center-form" onSubmit={sendReply}>
              <label>Resposta<textarea required maxLength={2000} disabled={busy} value={reply} onChange={event => { replyId.current = undefined; setReply(event.target.value); }} /></label>
              <button className="btn-primary" disabled={busy || !reply.trim()}>Enviar resposta</button>
            </form>}
          </> : <p>{selected ? 'Carregando chamado…' : 'Selecione um chamado para ver a conversa.'}</p>}
        </article>
      </div>
    </section>
  );
}

async function readImage(file: File) {
  if (!imageTypes.includes(file.type) || file.size > 1024 * 1024 || !file.size) throw new Error('Escolha uma imagem PNG, JPEG ou WebP de até 1 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let data = '';
  for (let index = 0; index < bytes.length; index += 8192) data += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return { mime: file.type, data: btoa(data) };
}
