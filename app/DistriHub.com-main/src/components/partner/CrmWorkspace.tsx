import { adminBusinessDay, adminSaleDate } from '../../lib/adminDashboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PartnerCustomer, PartnerInvoice, PartnerSale, PartnerSalesperson } from '../../types';
import { supabase } from '../../lib/supabase';
import { accountBalance, isOverdue } from '../../lib/accounts';
import { money } from '../../utils';

type Task = { id: string; customer_id: string; description: string; due_date: string; responsible_id: string | null; status: 'pendente' | 'concluida'; completed_at: string | null; created_at: string };
type Draft = { description: string; dueDate: string; responsibleId: string };
type Props = { timeZone?: string; initialSegment?: string; customers: PartnerCustomer[]; sales: PartnerSale[]; invoices: PartnerInvoice[]; salespeople: PartnerSalesperson[]; companyUserId: string | null; branchId: string | null };
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

export function CrmWorkspace({ timeZone, initialSegment = 'todos', customers, sales, invoices, salespeople, companyUserId, branchId }: Props) {
  const [query,setQuery] = useState('');
  const [page, setPage] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const [segment,setSegment] = useState(initialSegment);
  const [selectedId,setSelectedId] = useState('');
  const [tasks,setTasks] = useState<Task[]>([]);
  const [drafts,setDrafts] = useState<Record<string,Draft>>({});
  const {description,dueDate,responsibleId} = drafts[selectedId] ?? {description:'',dueDate:localDate(new Date()),responsibleId:''};
  function updateDraft(patch: Partial<Draft>) {
    setDrafts(previous=>({...previous,[selectedId]:{...(previous[selectedId] ?? {description:'',dueDate:localDate(new Date()),responsibleId:''}),...patch}}));
  }
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ id: string; customer_id: string; description: string; due_date: string; responsible_id: string | null } | null>(null);
  const scope = `${companyUserId}:${branchId}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const load = useCallback(async () => {
    const currentScope = `${companyUserId}:${branchId}`;
    if (!supabase || !companyUserId) return;
    setLoading(true); setError('');
    try {
      const rows: Task[] = [];
      for (let offset=0;;offset+=500) {
        let request = supabase.from('partner_crm_tasks').select('*').eq('user_id',companyUserId).order('due_date').order('id').range(offset,offset+499);
        if (branchId) request=request.eq('branch_id',branchId);
        const { data,error } = await request;
        if (error) throw error;
        rows.push(...(data ?? []) as Task[]);
        if ((data?.length ?? 0)<500) break;
      }
      if (scopeRef.current===currentScope) setTasks(rows);
    } catch (cause) { if(scopeRef.current===currentScope) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o acompanhamento.'); }
    finally { if(scopeRef.current===currentScope) setLoading(false); }
  },[companyUserId,branchId]);
  useEffect(() => { setTasks([]); setSelectedId(''); setPage(0); setDrafts({}); attempt.current=null; void load(); },[load]);
  const selected = customers.find(c=>c.id===selectedId);
  const today = timeZone ? adminBusinessDay(new Date(), timeZone) : '';
  const purchasesByCustomer = useMemo(() => {
    const result = new Map<string, PartnerSale[]>();
    const purchaseDate = (sale: PartnerSale) => timeZone ? adminSaleDate(sale) : sale.created_at;
    for (const sale of sales) {
      if (!sale.customer_id || sale.status !== 'concluida') continue;
      const date = new Date(purchaseDate(sale));
      if (timeZone && (!Number.isFinite(date.getTime()) || adminBusinessDay(date, timeZone) > today)) continue;
      const purchases = result.get(sale.customer_id) ?? [];
      purchases.push(sale);
      result.set(sale.customer_id, purchases);
    }
    for (const purchases of result.values()) purchases.sort((a, b) => purchaseDate(b).localeCompare(purchaseDate(a)));
    return result;
  }, [sales, timeZone, today]);
  const purchaseDate = (sale: PartnerSale) => timeZone ? adminSaleDate(sale) : sale.created_at;
  const customerSales = (id: string) => purchasesByCustomer.get(id) ?? [];
  const inactiveDays = (id: string) => { const last=customerSales(id)[0]; return last ? Math.max(0,timeZone ? Math.round((Date.parse(adminBusinessDay(new Date(), timeZone))-Date.parse(adminBusinessDay(new Date(purchaseDate(last)), timeZone)))/86400000) : Math.floor((Date.now()-new Date(last.created_at).getTime())/86400000)) : null; };
  const visible=customers.filter(c=>c.is_active !== false && `${c.name} ${c.phone ?? ''} ${c.document ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (segment==='todos' || segment==='sem-compras' && inactiveDays(c.id)===null || segment==='inativos' && (inactiveDays(c.id) ?? -1)>=90 || segment==='retorno' && tasks.some(t=>t.customer_id===c.id && t.status==='pendente' && t.due_date<=localDate(new Date()))));

  const pageSize = 6;
  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const offset = currentPage * pageSize;
  const pageCustomers = visible.slice(offset, offset + pageSize);
  useEffect(() => setPage(value => Math.min(value, lastPage)), [lastPage]);
  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.focus({ preventScroll: true });
      detailRef.current.scrollIntoView({ block: 'start' });
    }
  }, [selectedId]);

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if(lock.current || !supabase || !selected || !branchId || !companyUserId || (attempt.current && attempt.current.customer_id !== selected.id)) return;
    lock.current=true; setBusy(true); setError('');
    const currentScope=scope;
    try {
      const pending = attempt.current ??= { id: crypto.randomUUID(), customer_id: selected.id, description: description.trim(), due_date: dueDate, responsible_id: responsibleId || null };
      const { data: existing,error: lookupError }=await supabase.from('partner_crm_tasks').select('id').eq('id',pending.id).maybeSingle();
      if(lookupError) throw lookupError;
      if(!existing) { const {error}=await supabase.from('partner_crm_tasks').insert({...pending,user_id:companyUserId,branch_id:branchId}); if(error) throw error; }
      if(scopeRef.current===currentScope) { attempt.current=null; updateDraft({description:''}); await load(); }
    } catch(cause) { if(scopeRef.current===currentScope) setError(cause && typeof cause==='object' && 'message' in cause ? String(cause.message) : 'Não foi possível salvar o retorno.'); }
    finally { lock.current=false; setBusy(false); }
  }
  async function complete(task: Task) {
    if(lock.current || !supabase || !companyUserId) return;
    lock.current=true;setBusy(true);setError('');
    try { const {data,error}=await supabase.from('partner_crm_tasks').update({status:'concluida',completed_at:new Date().toISOString()}).eq('id',task.id).eq('user_id',companyUserId).select('id').single(); if(error || !data) throw error ?? new Error('Retorno não confirmado.'); await load(); }
    catch(cause) {setError(cause && typeof cause==='object' && 'message' in cause ? String(cause.message) : 'Não foi possível concluir.');}
    finally {lock.current=false;setBusy(false);}
  }
  return <section className="module-card">
    <h4>Acompanhamento de clientes</h4>
    <p>Compras e saldos da filial selecionada. Registrar um retorno não envia uma mensagem ao cliente.</p>
    {error && <p role="alert">{error} <button type="button" onClick={()=>void load()}>Recarregar</button></p>}
    {loading && <p role="status">Carregando retornos…</p>}
    <div className="orders-filter-row"><input type="search" autoComplete="off" aria-label="Buscar cliente no CRM" placeholder="Cliente, documento ou telefone" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/><select aria-label="Segmento de clientes" value={segment} onChange={e=>{setSegment(e.target.value);setPage(0);}}><option value="todos">Todos</option><option value="inativos">Sem comprar há 90 dias</option><option value="sem-compras">Sem compras registradas</option><option value="retorno">Retorno pendente até hoje</option></select></div>
    {selected && <div className="module-card crm-customer-detail" ref={detailRef} tabIndex={-1}><div className="module-header" style={{ flexWrap: 'wrap' }}><h4>{selected.name}</h4><button type="button" className="rma-advance-btn" style={{ minHeight: 44 }} disabled={busy} onClick={()=>setSelectedId('')}><X size={16} aria-hidden="true" /> Fechar ficha</button></div><p>{selected.phone || 'Sem telefone'} · {selected.email || 'Sem e-mail'}</p>
      <p>A receber: {money.format(invoices.filter(i=>i.customer_id===selected.id).reduce((sum,i)=>sum+accountBalance(i),0))} · Vencido: {money.format(invoices.filter(i=>i.customer_id===selected.id && isOverdue(i, new Date(), timeZone)).reduce((sum,i)=>sum+accountBalance(i),0))}</p>
      <h4>Compras recentes</h4>{customerSales(selected.id).slice(0,10).map(s=><p key={s.id}>#{s.id.slice(0,8)} · {new Date(s.created_at).toLocaleDateString('pt-BR')} · {money.format(s.total)}</p>)}
      <h4>Planejar retorno / registrar observação</h4>{!branchId ? <p>Selecione uma filial para cadastrar retornos.</p> : <form onSubmit={saveTask}><fieldset disabled={busy || Boolean(attempt.current)} style={{border:0}}><label>Observação / próxima ação<textarea required maxLength={4000} value={description} onChange={e=>updateDraft({description:e.target.value})}/></label><label>Data<input type="date" required value={dueDate} onChange={e=>updateDraft({dueDate:e.target.value})}/></label><label>Responsável<select value={responsibleId} onChange={e=>updateDraft({responsibleId:e.target.value})}><option value="">Não atribuído</option>{salespeople.filter(s=>!s.branch_id || s.branch_id===branchId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></fieldset><button type="submit" disabled={busy}>{busy ? 'Salvando…' : attempt.current ? 'Recuperar retorno enviado' : 'Salvar retorno'}</button></form>}
      <details><summary>Histórico de acompanhamento</summary>{tasks.filter(t=>t.customer_id===selected.id).map(t=><p key={t.id}>{t.due_date.split('-').reverse().join('/')} · {t.description} · {salespeople.find(s=>s.id===t.responsible_id)?.name ?? 'Não atribuído'} · {t.status}{t.completed_at ? ' em '+new Date(t.completed_at).toLocaleString('pt-BR') : ''} {t.status==='pendente' && <button type="button" disabled={busy} onClick={()=>void complete(t)}>Marcar realizado</button>}</p>)}</details>
    </div>}
    {visible.length > 0 && <div className="directory-pagination">
      <span role="status">Mostrando {offset + 1}–{offset + pageCustomers.length} de {visible.length} clientes</span>
      {lastPage > 0 && <nav aria-label="Páginas de clientes do CRM">
        <button type="button" className="partner-secondary-btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
        <button type="button" className="partner-secondary-btn" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button>
      </nav>}
    </div>}
    <div className="stock-table-wrap crm-customer-table-wrap"><table className="rma-table crm-customer-table"><thead><tr><th>Cliente</th><th>Última compra</th><th>Compras</th><th>Valor</th><th>Ação</th></tr></thead><tbody>{pageCustomers.map(c=>{const purchases=customerSales(c.id);return <tr key={c.id}><td data-label="Cliente">{c.name}</td><td data-label="Última compra">{purchases[0] ? new Date(purchaseDate(purchases[0])).toLocaleDateString('pt-BR', timeZone ? { timeZone } : undefined) : 'Sem compras'}</td><td data-label="Compras">{purchases.length}</td><td data-label="Valor">{money.format(purchases.reduce((sum,s)=>sum+s.total,0))}</td><td data-label="Ação"><button type="button" disabled={busy || Boolean(attempt.current && attempt.current.customer_id !== c.id)} onClick={()=>setSelectedId(c.id)}>Abrir ficha</button></td></tr>;})}{!visible.length && <tr><td colSpan={5}>Nenhum cliente encontrado.</td></tr>}</tbody></table></div>
    {!selected && tasks.some(t=>t.status==='pendente') && <p>{tasks.filter(t=>t.status==='pendente').length} retorno(s) pendente(s). Abra a ficha para acompanhar.</p>}
  </section>;
}
