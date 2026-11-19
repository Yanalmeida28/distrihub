import { authenticatedRealtime } from '../lib/authenticatedRealtime';
import { SupportUnreadBadge } from './SupportUnreadBadge';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AdminCompany } from '../types';
import { supabase } from '../lib/supabase';
import { SupportChatModule, type SupportMessage } from './partner/SupportChatModule';
import { saasAdminError } from '../lib/saasAdminControls';
type Conversation = SupportMessage & { priority: 'normal' | 'high'; closed_at: string | null; closed_message_position: number | null; closed: boolean; company_name: string };
export function AdminSupportInbox({ companies, unreadCounts = {} }: { companies: AdminCompany[]; unreadCounts?: Record<string, number> }) {
  const [user, setUser] = useState<User | null>(null); const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0); const [total, setTotal] = useState(0); const [pending, setPending] = useState(0);
  const [version, setVersion] = useState(0); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const lock = useRef(false);
  const mounted = useRef(true);
  const selectedId = useRef(selected?.user_id); selectedId.current = selected?.user_id;
  const stateRevision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (!supabase) { setError('Suporte indisponível.'); setLoading(false); return; }
    void supabase.auth.getUser().then(({ data, error }) => { if (active) { if (error || !data.user) { setError('Entre na conta do Super Admin.'); setLoading(false); } else setUser(data.user); } });
    return () => { active = false; };
  }, []);
  useEffect(() => { setPage(0); }, [search, filter]);
  useEffect(() => {
    let active = true; if (!supabase || !user) return;
    setLoading(true); setError('');
    void supabase.rpc('get_admin_support_inbox', { p_search: search.trim(), p_filter: filter, p_page: page }).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) setError(error?.message ?? 'Resumo do suporte indisponivel.'); else { setConversations(data.conversations ?? []); setTotal(Number(data.total ?? 0)); setPending(Number(data.pending ?? 0)); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [user, search, filter, page, version]);
  const conversationId = selected?.user_id;
  useEffect(() => {
    if (!supabase || !user || !conversationId) return;
    let active = true;
    const revision = stateRevision.current;
    void supabase.rpc('get_admin_support_conversation', { p_user_id: conversationId }).then(({ data, error }) => {
      if (!active || revision !== stateRevision.current) return;
      if (error || !data || data.user_id !== conversationId) { setError('Não foi possível atualizar o atendimento selecionado.'); return; }
      setSelected(current => current?.user_id === conversationId ? data as Conversation : current);
    });
    return () => { active = false; };
  }, [user, conversationId, version]);
  useEffect(() => {
    if (!supabase || !user) return;
    const client = supabase;
    const stopRealtime = authenticatedRealtime(client, () => client.channel('admin-support-inbox-v2').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => setVersion(v => v + 1)), { label: 'admin-support-inbox', expectedUserId: user.id });
    const timer = window.setInterval(() => setVersion(v => v + 1), 10000);
    return () => { window.clearInterval(timer); stopRealtime(); };
  }, [user]);
  async function update(action: 'priority_high' | 'priority_normal' | 'close' | 'reopen') {
    if (!supabase || !selected || lock.current) return;
    lock.current = true; setSaving(true); setError('');
    const target = selected.user_id;
    stateRevision.current += 1;
    try {
      const { data, error } = await supabase.rpc('update_admin_support_state', { p_user_id: target, p_action: action, p_expected_position: selected.message_position });
      if (error || !data || data.user_id !== target) throw error ?? new Error('Situação do atendimento não confirmada.');
      if (!mounted.current) return;
      stateRevision.current += 1;
      setSelected(current => current?.user_id === target ? { ...current, ...data, closed: !!data.closed_at && Number(data.closed_message_position ?? 0) >= Number(current.message_position) } : current);
      setVersion(v => v + 1);
    } catch (cause) {
      if (mounted.current) { if (selectedId.current === target) setError(saasAdminError(cause)); setVersion(v => v + 1); }
    } finally { lock.current = false; if (mounted.current) setSaving(false); }
  }
  return <section className="panel-module"><div className="module-header"><div><h3>Atendimento aos clientes</h3><p>{pending} atendimento(s) aguardando resposta.</p></div><button className="rma-advance-btn" disabled={loading || saving} onClick={() => setVersion(v => v + 1)}>Atualizar atendimentos</button></div>
    {error && <p role="alert" className="admin-feedback admin-feedback-error">{error}</p>}
    <div className="rma-form inline admin-filters"><label>Buscar atendimento<input type="search" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} placeholder="Empresa ou última mensagem" /></label><label>Mostrar<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos</option><option value="pending">Aguardando resposta</option><option value="closed">Encerrados</option><option value="high">Prioridade alta</option></select></label></div>
    {loading && <p role="status">Carregando atendimentos...</p>}
    <div className="admin-support-conversations">{conversations.map(conversation => <button type="button" className={'admin-support-conversation ' + (selected?.user_id === conversation.user_id ? 'active' : '')} key={conversation.user_id} onClick={() => setSelected(conversation)}><strong>{conversation.company_name}<SupportUnreadBadge count={unreadCounts[conversation.user_id] ?? 0} /></strong><span>{conversation.message}</span><small>{new Date(conversation.created_at).toLocaleString('pt-BR')} · {conversation.closed ? 'Encerrado' : conversation.sender_role === 'cliente' ? 'Aguardando resposta' : 'Respondido'}{conversation.priority === 'high' ? ' · Prioridade alta' : ''}</small></button>)}</div>
    {!loading && !conversations.length && <p>Nenhum atendimento encontrado.</p>}
    <div className="subscription-actions"><button type="button" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1} · {total} atendimento(s)</span><button type="button" disabled={loading || (page + 1) * 25 >= total} onClick={() => setPage(p => p + 1)}>Próxima</button></div>
    {selected && user && <div className="module-card"><h4>{companies.find(c => c.user_id === selected.user_id)?.business_name ?? selected.company_name}</h4><div className="subscription-actions"><button type="button" className="rma-advance-btn" disabled={saving} onClick={() => void update(selected.priority === 'high' ? 'priority_normal' : 'priority_high')}>{selected.priority === 'high' ? 'Remover prioridade alta' : 'Marcar prioridade alta'}</button><button type="button" className="rma-advance-btn" disabled={saving} onClick={() => void update(selected.closed ? 'reopen' : 'close')}>{selected.closed ? 'Reabrir atendimento' : 'Encerrar atendimento'}</button></div><SupportChatModule key={selected.user_id} user={user} conversationUserId={selected.user_id} admin /></div>}
  </section>;
}
