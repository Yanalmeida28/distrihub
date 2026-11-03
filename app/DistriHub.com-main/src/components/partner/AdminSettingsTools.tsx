import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '../../lib/supabase';
import { deviceIdentity } from '../../hooks/useDeviceHeartbeat';
import type { PartnerBranch, PartnerCustomer, PartnerProduct, PartnerSale } from '../../types';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeText = (value: string | null | undefined) => /^[\s]*[=+@-]/.test(value ?? '') ? `'${value}` : value ?? '';

type DataExportProps = {
  allowed?: boolean;
  products: PartnerProduct[]; sales: PartnerSale[]; customers: PartnerCustomer[]; branchId: string; extra: Record<string, unknown>;
};
export function AdminDataExports(props: DataExportProps) {
  if (props.allowed !== true) return null;
  return <AuthorizedAdminDataExports {...props} />;
}
function AuthorizedAdminDataExports({ products, sales, customers, branchId, extra }: DataExportProps) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const productRows = products.map(p => ({ Produto: safeText(p.name), SKU: safeText(p.sku), Estoque: p.stock, Custo: p.cost_price, Venda: p.sale_price, NCM: p.ncm ?? '', Filial: p.branch_id ?? '' }));
  const saleRows = sales.map(s => ({ ID: s.id, Data: s.created_at, Cliente: safeText(s.customer_name), Total: s.total, Status: s.status, Pagamento: safeText(s.payment_method), Filial: s.branch_id ?? '' }));
  const customerRows = customers.map(c => ({ Cliente: safeText(c.name), Telefone: safeText(c.phone), Email: safeText(c.email), ID: c.id }));
  async function exportFile(kind: 'json' | 'produtos' | 'vendas' | 'clientes') {
    if (!active.current) return;
    setError(''); setNotice('');
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (kind === 'json') {
        const snapshot = { exported_at: new Date().toISOString(), branch_id: branchId || null, products, sales, customers, ...extra };
        const content = JSON.stringify(snapshot, (key, value) => /^(pin|pin_hash|new_pin|password|access_token|refresh_token)$/i.test(key) ? undefined : value, 2);
        download(`distrihub-dados-${date}.json`, content, 'application/json');
      } else {
        const rows = kind === 'produtos' ? productRows : kind === 'vendas' ? saleRows : customerRows;
        if (!rows.length) throw new Error('Nenhum registro disponível nesta visão para exportar.');
        const XLSX = await import('xlsx');
        if (!active.current) return;
        const sheet = XLSX.utils.json_to_sheet(rows);
        if (kind === 'produtos') { const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Produtos'); XLSX.writeFile(workbook, `produtos-${date}.xlsx`); }
        else download(`${kind}-${date}.csv`, '\uFEFF' + XLSX.utils.sheet_to_csv(sheet, { FS: ';' }), 'text/csv;charset=utf-8');
      }
      setNotice('Arquivo gerado e enviado para download.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o arquivo.'); }
  }
  return <section className="module-card"><h4>Exportação de Dados</h4>
    <p>Exporta os registros disponíveis na visão selecionada. O JSON contém estes cadastros e movimentos; não é um backup integral do banco e não inclui contas de acesso, senhas ou arquivos de Storage.</p>
    <div className="orders-filter-row" style={{ flexWrap: 'wrap' }}>
      <button type="button" className="module-action-btn" onClick={() => exportFile('json')}>Exportar dados (JSON)</button>
      <button type="button" className="module-action-btn" onClick={() => exportFile('produtos')}>Produtos (XLSX)</button>
      <button type="button" className="module-action-btn" onClick={() => exportFile('vendas')}>Vendas (CSV)</button>
      <button type="button" className="module-action-btn" onClick={() => exportFile('clientes')}>Clientes (CSV)</button>
    </div>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}

type Device = { id: string; device_key: string; name: string; branch_id: string | null; last_seen: string };
type DeviceProps = { userId?: string; branchId: string; branches: PartnerBranch[]; isActive?: boolean };
export function AdminDeviceRegistry(props: DeviceProps) {
  return <DeviceRegistryScreen key={[props.userId, props.branchId].join(':')} {...props} />;
}
function DeviceRegistryScreen({ userId, branchId, branches, isActive = true }: DeviceProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const activeRef = useRef(isActive); activeRef.current = isActive;
  const revision = useRef(0);
  const invalidate = useCallback(() => { ++revision.current; }, []);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    if (!isActive || !alive.current) return;
    const request = ++revision.current;
    const current = () => alive.current && activeRef.current && request === revision.current;
    setLoading(true); setError('');
    try {
    if (!userId || !supabase) throw new Error('Loja não conectada.');
    const all: Device[] = [];
    for (let offset = 0; ; offset += 500) {
      let query = supabase.from('partner_devices').select('id,device_key,name,branch_id,last_seen').eq('user_id', userId).order('id').range(offset, offset + 499);
      if (branchId) query = query.eq('branch_id', branchId);
      const { data, error: failure } = await query;
      if (!current()) return;
      if (failure) throw new Error(failure.message);
      if (!Array.isArray(data)) throw new Error('Resposta de terminais inválida.');
      all.push(...data as Device[]); if (data.length < 500) break;
    }
    if (current()) { setDevices(all); setNow(Date.now()); setError(''); }
    } catch (cause) { if (current()) { setDevices([]); setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os terminais.'); } }
    finally { if (current()) setLoading(false); }
  }, [userId, branchId, isActive]);
  useEffect(() => {
    alive.current = true;
    if (!isActive) return;
    setDevices([]); void load();
    try { if (userId) setName(deviceIdentity(userId).name); } catch { setError('O navegador bloqueou o armazenamento necessário para identificar este terminal.'); }
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { alive.current = false; invalidate(); window.clearInterval(timer); };
  }, [load, userId, isActive, invalidate]);
  useEffect(() => () => { alive.current = false; }, []);
  async function register(event: React.FormEvent) {
    event.preventDefault(); if (!isActive || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (!userId || !supabase || !name.trim()) throw new Error('Informe o nome deste terminal.');
      const device = deviceIdentity(userId);
      const { error: failure } = await supabase.rpc('touch_partner_device', { p_device_key: device.id, p_name: name.trim(), p_branch_id: branchId || null });
      if (failure) throw new Error(failure.message);
      localStorage.setItem(device.nameKey, name.trim());
      if (alive.current && activeRef.current) await load();
    } catch (cause) { if (alive.current && activeRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível registrar o terminal.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="module-card"><h4>Dispositivos / Terminais</h4>
    <p>Cada navegador conectado registra sua última conexão a cada minuto. “Sem contato recente” indica ausência de atualização por dois minutos; não confirma que o aparelho está desligado.</p>
    <form onSubmit={register}><label>Nome deste terminal <input required maxLength={100} value={name} disabled={busy || !isActive} onChange={e => setName(e.target.value)} /></label> <button className="module-submit-btn" disabled={busy || !isActive}>{busy ? 'Salvando…' : 'Registrar / renomear este terminal'}</button></form>
    <button type="button" className="module-action-btn" disabled={!isActive || loading} onClick={() => void load()}>Atualizar lista</button>
    {loading && <p role="status">Carregando terminais…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="stock-table-wrap"><table className="rma-table"><thead><tr><th>Terminal</th><th>Filial</th><th>Contato</th><th>Última conexão</th></tr></thead><tbody>{devices.length === 0 ? <tr><td colSpan={4}>{loading || error ? 'Consulta de terminais ainda não confirmada.' : 'Nenhum terminal registrado nesta visão.'}</td></tr> : devices.map(device => <tr key={device.id}><td>{device.name}</td><td>{branches.find(b => b.id === device.branch_id)?.name ?? 'Não selecionada'}</td><td>{now - new Date(device.last_seen).getTime() <= 120_000 ? 'Contato recente' : 'Sem contato recente'}</td><td>{new Date(device.last_seen).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div>
  </section>;
}
