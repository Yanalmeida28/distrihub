import { useRef, useState, type FormEvent } from 'react';
import type { PartnerProduct } from '../../types';
import type { usePriceLists } from '../../hooks/usePriceLists';
import { priceTableName, productTablePrice, validSalePrice, type BasePriceTable, type CustomPriceList } from '../../lib/pdv';
import { money } from '../../utils';

type Props = {
  data: ReturnType<typeof usePriceLists>;
  products: PartnerProduct[];
  branchId?: string;
};

export function PriceListsModule({ data, products, branchId }: Props) {
  const [listId, setListId] = useState('');
  const [name, setName] = useState('');
  const [base, setBase] = useState<BasePriceTable>('varejo');
  const [adjustment, setAdjustment] = useState('0');
  const [productId, setProductId] = useState('');
  const [fixedPrice, setFixedPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const currentList = data.lists.find(list => list.id === listId);
  const branchProducts = products.filter(item => item.branch_id === branchId);
  const product = branchProducts.find(item => item.id === productId);

  function edit(list?: CustomPriceList) {
    setListId(list?.id ?? '');
    setName(list?.name ?? '');
    setBase(list?.base_table ?? 'varejo');
    setAdjustment(String((list?.adjustment_bps ?? 0) / 100));
    setProductId('');
    setFixedPrice('');
    setError('');
    setNotice('');
  }

  async function commit(operation: () => Promise<void>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await operation(); setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { lock.current = false; setBusy(false); }
  }

  function saveList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(adjustment);
    const basisPoints = Math.round(parsed * 100);
    if (!name.trim() || !adjustment.trim() || !Number.isFinite(parsed) || Math.abs(parsed * 100 - basisPoints) > .000001 || basisPoints < -10000 || basisPoints > 100000) {
      setError('Informe um nome e um percentual entre −100% e 1.000%, com até duas casas decimais.');
      return;
    }
    void commit(async () => {
      setListId(await data.saveList(listId || undefined, { name: name.trim(), base_table: base, adjustment_bps: basisPoints }));
    }, 'Tabela salva. Você já pode vinculá-la no cadastro do cliente.');
  }

  function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(fixedPrice);
    if (!currentList || !product || !fixedPrice.trim() || !validSalePrice(value)) return setError('Informe um preço válido para o produto.');
    const key = product.id;
    void commit(() => data.saveProductPrice(currentList.id, key, value), 'Preço específico salvo.');
  }

  function shownPrice(item: PartnerProduct) {
    if (!currentList) return '';
    try { return money.format(productTablePrice(item, `lista:${currentList.id}`, data.lists)); }
    catch { return 'Preço indisponível'; }
  }

  return <section className="module-card" aria-label="Tabelas de preços">
    <h4>Tabelas de preços</h4>
    <p>Crie listas para diferentes carteiras de clientes. Vincule a lista em Clientes → perfil do cliente → Dados Financeiros.</p>
    {data.loading && <p role="status">Carregando tabelas…</p>}
    {data.error && <p role="alert">{data.error} <button type="button" className="partner-secondary-btn" onClick={data.reload}>Tentar novamente</button></p>}
    {!data.loading && !data.error && <>
      <label>Tabela<select value={listId} disabled={busy} onChange={event => edit(data.lists.find(list => list.id === event.target.value))}>
        <option value="">Nova tabela</option>
        {listId && !currentList && <option value={listId}>{name}</option>}
        {data.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select></label>
      <form className="rma-form" onSubmit={saveList}>
        <fieldset disabled={busy}>
          <label>Nome da tabela<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Tabela base<select value={base} onChange={event => setBase(event.target.value as BasePriceTable)}>
            {(['varejo', 'atacado', 'premium'] as const).map(option => <option key={option} value={option}>{priceTableName(option)}</option>)}
          </select></label>
          <label>Ajuste percentual<input type="number" required min={-100} max={1000} step=".01" value={adjustment} onChange={event => setAdjustment(event.target.value)} /></label>
          <p>Use um percentual negativo para desconto, positivo para acréscimo ou zero para manter a tabela base.</p>
          <button type="submit" className="module-submit-btn">Salvar tabela</button>
        </fieldset>
      </form>
      {currentList && (branchId ? <form className="rma-form" onSubmit={saveOverride}>
        <fieldset disabled={busy}>
          <h4>Preço específico por produto desta filial</h4>
          <label>Produto<select required value={productId} onChange={event => {
            const id = event.target.value;
            setProductId(id);
            setFixedPrice(currentList.prices[id] === undefined ? '' : String(currentList.prices[id]));
          }}>
            <option value="">Selecione</option>
            {branchProducts.map(item => <option key={item.id} value={item.id}>{item.name}{item.sku ? ' · ' + item.sku : ''}</option>)}
          </select></label>
          {product && <>
            <p>Preço aplicado: {shownPrice(product)}</p>
            <label>Preço específico (R$)<input type="number" required min={0} max={99999999.99} step=".01" value={fixedPrice} onChange={event => setFixedPrice(event.target.value)} /></label>
            <button type="submit" className="module-submit-btn">Salvar preço específico</button>
            {currentList.prices[product.id] !== undefined && <button type="button" className="partner-secondary-btn" onClick={() => void commit(async () => {
              await data.saveProductPrice(currentList.id, product.id, null);
              setFixedPrice('');
            }, 'O produto voltou a usar o percentual da tabela.')}>Voltar ao preço calculado</button>}
          </>}
        </fieldset>
      </form> : <p>Selecione uma filial para cadastrar preços específicos por produto.</p>)}
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
