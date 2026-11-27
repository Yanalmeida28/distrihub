import { useRef, useState, type FormEvent } from 'react';
import type { PartnerProduct, SaleItem } from '../../types';
import { validSalePrice } from '../../lib/pdv';
import { money } from '../../utils';

type CopyProduct = { id: string; name: string; sku: string; barcode: string; stock: number; priceCents: number; tracksStock: boolean };
type Snapshot = { scope: string; branchId: string; branchName: string; cashId: string; products: CopyProduct[] };
export type OfflineSale = { id: string; recordedAt: string; items: SaleItem[]; total: number };
type OfflineState = { version: number; snapshot: Snapshot & { savedAt: number; expiresAt: number }; queue: OfflineSale[] };
type Terminal = { state: OfflineState | null; save(next: OfflineState): Promise<void> };
type Runtime = {
  hasTerminal(): boolean;
  openTerminal(password: string, allowCreate?: boolean): Promise<Terminal>;
  prepareSnapshot(previous: OfflineState | null, snapshot: Snapshot): OfflineState;
};
type Props = {
  scope: string;
  branchId: string;
  branchName: string;
  cashId?: string;
  canPrepare: boolean;
  connected: boolean;
  products: PartnerProduct[];
  confirmCash: (cashId?: string) => Promise<void>;
  syncSale: (sale: OfflineSale, cashId: string) => Promise<unknown>;
};

const offlinePath = '/contingencia/index.html';

async function loadRuntime(): Promise<Runtime> {
  const url = '/contingencia/storage.js';
  return await import(/* @vite-ignore */ url) as Runtime;
}

async function installShell() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('Este navegador não permite preparar a abertura offline.');
  const registration = await navigator.serviceWorker.register('/contingencia-sw.js');
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (worker && worker.state !== 'activated') {
    await new Promise<void>((resolve, reject) => {
      function cleanup() { clearTimeout(timer); worker?.removeEventListener('statechange', check); }
      function check() {
        if (worker?.state === 'activated') { cleanup(); resolve(); }
        else if (worker?.state === 'redundant') { cleanup(); reject(new Error('O navegador não conseguiu preparar a página offline.')); }
      }
      const timer = setTimeout(() => { cleanup(); reject(new Error('A preparação offline não foi confirmada. Tente novamente.')); }, 12000);
      worker.addEventListener('statechange', check);
      check();
    });
  }
  if (!(await caches.match(offlinePath))) throw new Error('A página offline não ficou disponível neste navegador.');
}

export function OfflineTerminal({ scope, branchId, branchName, cashId, canPrepare, connected, products, confirmCash, syncSale }: Props) {
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<OfflineState | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function run(action: (runtime: Runtime) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setMessage(''); setError('');
    try { await action(await loadRuntime()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); }
    finally { running.current = false; setBusy(false); }
  }

  function validateScope(state: OfflineState | null): OfflineState {
    if (!state) throw new Error('A contingência ainda não foi preparada.');
    if (state.snapshot.scope !== scope || state.snapshot.branchId !== branchId) {
      throw new Error('Entre com a conta, o operador e a filial que prepararam este terminal.');
    }
    return state;
  }

  async function prepare(runtime: Runtime) {
    if (!connected || !canPrepare || !cashId || !branchId) throw new Error('Conecte-se, selecione a filial e abra o caixa antes de preparar.');
    await confirmCash(cashId);
    const terminal = await runtime.openTerminal(password, true);
    if (terminal.state?.queue.length) validateScope(terminal.state);
    const next = runtime.prepareSnapshot(terminal.state, {
      scope, branchId, branchName, cashId,
      products: products.filter(product => product.branch_id === branchId && !product.is_service && validSalePrice(Number(product.sale_price))).map(product => ({
        id: product.id, name: product.name, sku: product.sku ?? '', barcode: product.barcode ?? '',
        priceCents: Math.round(Number(product.sale_price) * 100), stock: Math.max(0, product.stock), tracksStock: product.control_stock !== false,
      })),
    });
    if (!next.snapshot.products.length) throw new Error('Nenhum produto da filial está disponível para a cópia local.');
    await installShell();
    await confirmCash(cashId);
    await terminal.save(next);
    setSummary(next);
    setMessage('Terminal preparado por 12 horas. Acesse a contingência quando precisar.');
  }

  async function showQueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async runtime => {
      if (!runtime.hasTerminal()) throw new Error('Prepare a contingência neste navegador antes de consultar os registros.');
      setSummary(validateScope((await runtime.openTerminal(password)).state));
    });
  }

  async function synchronize(runtime: Runtime) {
    if (!connected) throw new Error('Reconecte-se para sincronizar as vendas.');
    const terminal = await runtime.openTerminal(password);
    let state = validateScope(terminal.state);
    for (const sale of state.queue) {
      await syncSale(sale, state.snapshot.cashId);
      const quantities = new Map(sale.items.map(item => [item.product_id, item.quantity]));
      state = {
        ...state,
        snapshot: {
          ...state.snapshot,
          products: state.snapshot.products.map(product => ({
            ...product, stock: Math.max(0, product.stock - (quantities.get(product.id) ?? 0)),
          })),
        },
        queue: state.queue.filter(entry => entry.id !== sale.id),
      };
      await terminal.save(state);
      setSummary(state);
    }
    setMessage('Fila local sincronizada.');
  }

  return <details className="module-card">
    <summary>Contingência sem internet</summary>
    <p>Prepare um terminal por filial com a internet funcionando. A cópia local inclui produtos, preços de varejo e identificação do caixa.</p>
    <p><a href={offlinePath}>Abrir PDV em contingência</a></p>
    <form className="rma-form inline" onSubmit={showQueue} autoComplete="off">
      <label>Senha local do terminal<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} disabled={busy} onChange={event => {
        setPassword(event.target.value); setSummary(null);
      }} /></label>
      <button type="button" className="partner-secondary-btn" disabled={busy || !connected || !canPrepare || !cashId || password.length < 8}
        onClick={() => void run(prepare)}>Preparar ou atualizar terminal</button>
      <button type="submit" className="partner-secondary-btn" disabled={busy || password.length < 8}>Conferir fila local</button>
    </form>
    {summary && <div>
      <p>{summary.queue.length} venda(s) pendente(s) · {summary.snapshot.branchName} · Caixa {summary.snapshot.cashId.slice(0, 8)}</p>
      {summary.queue.length > 0 && <>
        <ul>{summary.queue.map(sale => <li key={sale.id}>#{sale.id.slice(0, 8)} · {new Date(sale.recordedAt).toLocaleString('pt-BR')} · {money.format(sale.total)}</li>)}</ul>
        <button type="button" className="module-submit-btn" disabled={busy || !connected} onClick={() => void run(synchronize)}>Sincronizar vendas pendentes</button>
      </>}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
