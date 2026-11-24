import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { money } from '../../utils';
type CatalogOrder = { id: string; business_name: string; contact: string; delivery_address: string | null; delivery_method: string; payment_method: string; total: number; status: string; created_at: string; items: { id: string; name: string; price: number; quantity: number }[] };
export function CatalogOrdersModule({ companyId, branchId, compact = false }: { companyId: string | null; branchId: string | null; compact?: boolean }) {
  const [rows, setRows] = useState<CatalogOrder[]>([]); const [page, setPage] = useState(0); const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState('pendente'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [version, setVersion] = useState(0);
  const lock = useRef(false);
  useEffect(() => { setPage(0); setRows([]); }, [companyId, branchId, filter]);
  useEffect(() => {
    let active = true; if (!supabase || !companyId) return;
    setBusy(true); setError('');
    let query = supabase.from('catalog_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * 25, page * 25 + 25);
    if (branchId) query = query.eq('branch_id', branchId); if (filter !== 'all') query = query.eq('status', filter);
    void query.then(({ data, error }) => { if (!active) return; if (error) setError(error.message); else { setRows((data ?? []).slice(0, 25) as CatalogOrder[]); setHasMore((data?.length ?? 0) > 25); } setBusy(false); });
    return () => { active = false; };
  }, [companyId, branchId, filter, page, version]);
  async function update(id: string, status: string) {
    if (!supabase || lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const { data, error } = await supabase.rpc('update_catalog_order_status', { p_order_id: id, p_status: status }); if (error || data !== true) throw error ?? new Error('Pedido não confirmado.'); setVersion(v => v + 1); }
    catch (cause) { setError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível atualizar o pedido.'); }
    finally { lock.current = false; setBusy(false); }
  }
  const content = <section className="module-card"><div className="module-header"><div><h3>Pedidos do catálogo público</h3><p>Solicitações recebidas pela loja. Confirme com o cliente e registre a venda no PDV para cobrar e baixar o estoque.</p></div><button type="button" className="rma-advance-btn" disabled={busy} onClick={() => setVersion(v => v + 1)}>Atualizar pedidos</button></div>
    {error && <p role="alert">{error}</p>}<label>Mostrar<select value={filter} onChange={e => setFilter(e.target.value)}><option value="pendente">Pendentes</option><option value="all">Todos</option><option value="confirmado">Confirmados</option><option value="cancelado">Cancelados</option></select></label>
    <div className="admin-overview-list">{rows.map(order => <article key={order.id} className="module-card"><strong>#{order.id.slice(0, 8)} · {order.business_name}</strong><p>{order.contact} · {new Date(order.created_at).toLocaleString('pt-BR')}</p><p>{order.delivery_method === 'entrega' ? `Entrega solicitada: ${order.delivery_address}` : 'Retirada na loja'} · {order.payment_method === 'pix' ? 'PIX' : 'Cartão'}</p>{order.items.map(item => <p key={item.id}>{item.quantity} × {item.name} · {money.format(item.price)}</p>)}<strong>{money.format(Number(order.total))}</strong><p>Situação: {order.status}</p><div className="subscription-actions"><button type="button" className="rma-advance-btn" disabled={busy || order.status !== 'pendente'} onClick={() => void update(order.id, 'confirmado')}>Confirmar pedido</button><button type="button" className="rma-advance-btn" disabled={busy || order.status === 'cancelado'} onClick={() => void update(order.id, 'cancelado')}>Cancelar solicitação</button></div></article>)}</div>
    {busy && <p role="status">Carregando / salvando...</p>}{!busy && !rows.length && <p>Nenhum pedido nesta seleção.</p>}{(page > 0 || hasMore) && <div className="subscription-actions"><button type="button" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1}</span><button type="button" disabled={busy || !hasMore} onClick={() => setPage(p => p + 1)}>Próxima</button></div>}
  </section>;
  if (!compact) return content;
  return <details className="mobile-catalog-orders">
    <summary>Pedidos do catálogo{rows.some(order => order.status === 'pendente') && <span>Há pendentes</span>}</summary>
    {content}
  </details>;
}
