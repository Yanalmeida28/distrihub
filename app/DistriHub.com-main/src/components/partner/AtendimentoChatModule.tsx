import { useCallback, useEffect, useRef, useState } from 'react';
import { buildOrderQuotePdf } from '../../lib/orderQuotePdf';
import { supabase } from '../../lib/supabase';
import type { PartnerCustomer, PartnerSale } from '../../types';
import './AtendimentoChatModule.css';

type Conversation = { id: string; phone: string; customer_id: string | null; customer_name: string | null; assignee_name: string | null; state: 'waiting' | 'active' | 'resolved'; mine: boolean; updated_at: string };
type Message = { position: number; direction: 'incoming' | 'outgoing'; body: string; delivery: 'received' | 'submitted' | 'delivered'; created_at: string };
type Details = { operators: { id: string; name: string }[]; quotes: { id: string; total: number }[] };
type Props = { companyId: string; branchId: string; branchName: string; companyName?: string; operatorId?: string; credential?: string; customers: PartnerCustomer[]; active: boolean };
const labels = { waiting: 'Aguardando', active: 'Em atendimento', resolved: 'Resolvido' };
const filters = [['all', 'Todas'], ['waiting', 'Aguardando'], ['mine', 'Minhas'], ['resolved', 'Resolvidas']];
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AtendimentoModule({ companyId, branchId, branchName, companyName, operatorId, credential, customers, active }: Props) {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [channel, setChannel] = useState<'test' | 'unconfigured'>();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Conversation | null>(null);
  const id = selection?.id;
  const selected = rows.find(row => row.id === id) ?? selection;
  const [messages, setMessages] = useState<Message[]>([]);
  const [details, setDetails] = useState<Details>();
  const [mobile, setMobile] = useState<'list' | 'thread' | 'customer'>('list');
  const [moreRows, setMoreRows] = useState(false);
  const [moreMessages, setMoreMessages] = useState(false);
  const rowsPaged = useRef(false);
  const historyPaged = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [target, setTarget] = useState('');
  const [customer, setCustomer] = useState('');
  const [confirmCustomer, setConfirmCustomer] = useState(false);
  const [quote, setQuote] = useState('');
  const [reference, setReference] = useState('');
  const [draft, setDraft] = useState('');
  const attempt = useRef<{ id: string; text: string }>();

  const rpc = useCallback(async <T,>(action: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> => {
    if (!supabase) throw new Error('Serviço indisponível.');
    const query = supabase.rpc('atendimento_workspace', { p_company: companyId, p_branch: branchId, p_operator: operatorId ?? null, p_credential: credential ?? null, p_action: action, p_input: input });
    const { data, error: failure } = await (signal ? query.abortSignal(signal) : query);
    if (failure) throw new Error(failure.message === 'ATENDIMENTO_ALREADY_ASSIGNED' ? 'Outro operador já assumiu esta conversa.' : 'Não foi possível concluir. Confira o acesso e tente novamente.');
    return data as T;
  }, [companyId, branchId, operatorId, credential]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await rpc<{ channel: 'test' | 'unconfigured'; rows: Conversation[] }>('list', { filter, search }, controller.signal);
        if (controller.signal.aborted) return;
        setChannel(data.channel);
        setRows(current => {
          const incoming = data.rows.slice(0, 25);
          const seen = new Set(incoming.map(row => row.id));
          return rowsPaged.current ? [...incoming, ...current.filter(row => !seen.has(row.id))] : incoming;
        });
        setSelection(current => data.rows.find(row => row.id === current?.id) ?? current);
        if (!rowsPaged.current) setMoreRows(data.rows.length > 25);
      } catch {
        if (!controller.signal.aborted) setError('Não foi possível atualizar a fila. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void load(), 12000);
        }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, rpc, filter, search, revision]);

  useEffect(() => {
    if (!active || !id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const [history, context] = await Promise.all([
          rpc<Message[]>('history', { conversationId: id }, controller.signal),
          rpc<Details>('details', { conversationId: id }, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const recent = history.slice(0, 30);
        setMessages(current => {
          const seen = new Set(recent.map(message => message.position));
          return [...recent, ...current.filter(message => !seen.has(message.position))].sort((a, b) => b.position - a.position);
        });
        if (!historyPaged.current) setMoreMessages(history.length > 30);
        setDetails(context);
      } catch {
        if (!controller.signal.aborted) setError('O histórico ainda não respondeu. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) {
          setLoadingHistory(false);
          timer = setTimeout(() => void load(), 8000);
        }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, id, rpc, revision]);

  function open(row: Conversation) {
    if (pending.current) return;
    if (row.id !== id) {
      setSelection(row); setMessages([]); setMoreMessages(false); setLoadingHistory(true); setDetails(undefined);
      historyPaged.current = false;
      setDraft(''); setError(''); setReference(''); setTarget(''); setCustomer(''); setQuote(''); setConfirmCustomer(false);
      attempt.current = undefined;
    }
    setMobile('thread');
  }

  async function perform(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try { await task(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.'); }
    finally { pending.current = false; setBusy(false); }
  }

  function mutate(action: string, input: Record<string, unknown> = {}) {
    if (!id) return;
    void perform(async () => {
      await rpc(action, { conversationId: id, ...input });
      rowsPaged.current = false;
      setRows([]); setFilter('all'); setTarget(''); setConfirmCustomer(false);
      refresh(value => value + 1);
    });
  }

  function prepareQuote() {
    if (!id || !quote) return;
    void perform(async () => {
      const data = await rpc<{ operationId: string; sale: PartnerSale }>('prepare_quote', { conversationId: id, targetId: quote });
      setReference(data.operationId);
      const { pdf, filename } = buildOrderQuotePdf(data.sale, { companyName: companyName || branchName, customer: customers.find(item => item.id === data.sale.customer_id) });
      await pdf.save(filename, { returnPromise: true });
    });
  }

  return <section className="module-card atendimento" aria-label="Atendimento">
    <header className="atendimento-header">
      <div><h2>Atendimento</h2><p>{branchName}</p></div>
      {channel && <strong>{channel === 'test' ? 'Canal de teste' : 'Canal não configurado'}</strong>}
    </header>
    {error && <div role="alert">{error} <button type="button" className="btn-secondary" onClick={() => { setError(''); refresh(value => value + 1); }}>Tentar novamente</button></div>}
    <div className="atendimento-chat" data-mobile={mobile}>
      <aside className="atendimento-list">
        <h3>Conversas</h3>
        <label>Buscar<input type="search" maxLength={100} value={search} disabled={busy} onChange={event => { rowsPaged.current = false; setRows([]); setSearch(event.target.value); }} /></label>
        <div className="atendimento-actions">{filters.map(([key, label]) =>
          <button type="button" className="btn-secondary" key={key} disabled={busy} aria-pressed={filter === key} onClick={() => {
            if (filter !== key) { rowsPaged.current = false; setRows([]); setFilter(key); }
          }}>{label}</button>)}</div>
        {loading && <p role="status">Carregando fila…</p>}
        {!loading && !rows.length && <p>Nenhuma conversa neste filtro.</p>}
        {rows.map(row => <button type="button" className="atendimento-row" aria-pressed={id === row.id} key={row.id} onClick={() => open(row)}>
          <strong>{row.customer_name ?? row.phone}</strong><small>{labels[row.state]}{row.mine ? ' · Você' : row.assignee_name ? ` · ${row.assignee_name}` : ''}</small>
        </button>)}
        {moreRows && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void perform(async () => {
          const last = rows[rows.length - 1];
          if (!last) return;
          const data = await rpc<{ rows: Conversation[] }>('list', { filter, search, beforeAt: last.updated_at, beforeId: last.id });
          rowsPaged.current = true;
          setRows(current => [...current, ...data.rows.slice(0, 25).filter(row => !current.some(item => item.id === row.id))]);
          setMoreRows(data.rows.length > 25);
        })}>Mais conversas</button>}
      </aside>
      <section className="atendimento-thread" aria-label="Conversa selecionada">
        <button type="button" className="btn-secondary atendimento-mobile" onClick={() => setMobile('list')}>Conversas</button>
        {selected ? <>
          <h3>{selected.customer_name ?? selected.phone}</h3>
          <div className="atendimento-actions">
            {selected.state === 'waiting' && <button type="button" className="btn-primary" disabled={busy} onClick={() => mutate('assume')}>Assumir</button>}
            {selected.state === 'active' && selected.mine && <button type="button" className="btn-secondary" disabled={busy} onClick={() => mutate('resolve')}>Resolver</button>}
            <button type="button" className="btn-secondary atendimento-mobile" onClick={() => setMobile('customer')}>Cliente e orçamento</button>
          </div>
          {loadingHistory && <p role="status">Carregando histórico…</p>}
          {moreMessages && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void perform(async () => {
            const last = messages[messages.length - 1];
            if (!last) return;
            const older = await rpc<Message[]>('history', { conversationId: id, before: last.position });
            historyPaged.current = true;
            setMessages(current => [...current, ...older.slice(0, 30).filter(row => !current.some(item => item.position === row.position))]);
            setMoreMessages(older.length > 30);
          })}>Mensagens anteriores</button>}
          <ol className="atendimento-history">{[...messages].reverse().map(message => <li key={message.position} data-outgoing={message.direction === 'outgoing'}>
            <small>{message.direction === 'incoming' ? 'Cliente' : message.delivery === 'delivered' ? 'Entregue · teste' : 'Registrado · teste'}</small>
            <div>{message.body}</div>
          </li>)}</ol>
          {channel === 'test' && selected.state === 'active' && selected.mine && <form onSubmit={event => {
            event.preventDefault();
            if (!id || !draft.trim()) return;
            const text = draft.trim();
            if (attempt.current?.text !== text) attempt.current = { id: crypto.randomUUID(), text };
            const requestId = attempt.current.id;
            void perform(async () => {
              await rpc('test_send', { conversationId: id, body: text, requestId });
              attempt.current = undefined; setDraft(''); refresh(value => value + 1);
            });
          }}>
            <label>Mensagem de teste<textarea value={draft} disabled={busy} maxLength={4096} onChange={event => setDraft(event.target.value)} /></label>
            <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>Enviar teste</button>
          </form>}
        </> : <p>Selecione uma conversa para ver o histórico.</p>}
      </section>
      <aside className="atendimento-details" aria-label="Dados do cliente">
        <button type="button" className="btn-secondary atendimento-mobile" onClick={() => setMobile('thread')}>Voltar à conversa</button>
        <h3>Cliente</h3>
        {selected && <>
          <p>{selected.customer_name ?? 'Cliente sem vínculo'}</p>
          <p>{selected.phone}</p>
          {selected.state === 'active' && selected.mine && <>
            <label>Transferir para<select value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
              <option value="">Selecione o operador</option>{details?.operators.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <button type="button" className="btn-secondary" disabled={busy || !target} onClick={() => mutate('transfer', { targetId: target })}>Transferir</button>
            <label>Cadastro do cliente<select value={customer} disabled={busy} onChange={event => { setCustomer(event.target.value); setConfirmCustomer(false); }}>
              <option value="">Selecione o cliente</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            {customer && <label><input type="checkbox" checked={confirmCustomer} onChange={event => setConfirmCustomer(event.target.checked)} /> Confirmo o vínculo com este cliente</label>}
            <button type="button" className="btn-secondary" disabled={busy || !customer || !confirmCustomer} onClick={() => mutate('link', { targetId: customer, confirmed: true })}>Vincular cliente</button>
            {selected.customer_id && <>
              <label>Orçamento<select value={quote} disabled={busy} onChange={event => { setQuote(event.target.value); setReference(''); }}>
                <option value="">Selecione o orçamento</option>{details?.quotes.map(item => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {money.format(item.total)}</option>)}
              </select></label>
              <button type="button" className="btn-primary" disabled={busy || !quote} onClick={prepareQuote}>Preparar e baixar PDF</button>
              {reference && <p role="status">Preparação registrada. Referência {reference}.</p>}
            </>}
          </>}
        </>}
      </aside>
    </div>
  </section>;
}
