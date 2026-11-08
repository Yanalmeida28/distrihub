import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CatalogOrderRejected, saveCatalogOrder } from '../lib/catalogOrders';
import { OperationAttempts } from '../lib/operationAttempts';
import { money } from '../utils';
export type CatalogCartItem = { id: string; name: string; quantity: number; sale_price: number };
type Draft = { cart: { id: string; quantity: number }[]; businessName: string; contact: string; deliveryAddress: string; paymentMethod: string; deliveryMethod: string };
export function PublicCatalogCheckout({ slug, branchSlug, branchId, cart, userId, onSignIn, onQuantity, onComplete }: { slug: string; branchSlug?: string | null; branchId: string; cart: CatalogCartItem[]; userId: string | null; onSignIn?: (email: string, password: string) => Promise<{ error: string | null }>; onQuantity: (id: string, amount: number) => void; onComplete: () => void }) {
  const [name, setName] = useState(''); const [contact, setContact] = useState(''); const [address, setAddress] = useState('');
  const [delivery, setDelivery] = useState('balcao'); const [payment, setPayment] = useState('pix');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [result, setResult] = useState<{ id: string; total: number } | null>(null);
  const [pending, setPending] = useState<Draft | null>(null); const lock = useRef(false);
  const scope = `${userId}:${slug}:${branchId}`;
  useEffect(() => {
    setResult(null); setPending(null);
    if (!userId) return;
    try { const previous = new OperationAttempts(window.localStorage).pending<Draft>(scope, 'catalog-order'); if (previous) { setPending(previous.payload); setName(previous.payload.businessName); setContact(previous.payload.contact); setAddress(previous.payload.deliveryAddress); setPayment(previous.payload.paymentMethod); setDelivery(previous.payload.deliveryMethod); } }
    catch { setError('Não foi possível recuperar o pedido pendente. Confira seus pedidos antes de enviar novamente.'); }
  }, [scope, userId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || !userId) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const store = new OperationAttempts(window.localStorage);
      const draft = pending ?? { cart: cart.map(item => ({ id: item.id, quantity: item.quantity })).sort((a, b) => a.id.localeCompare(b.id)), businessName: name, contact, deliveryAddress: address, paymentMethod: payment, deliveryMethod: delivery };
      const attempt = store.get(scope, 'catalog-order', draft); setPending(attempt.payload);
      const saved = await saveCatalogOrder(supabase, userId, { ...attempt.payload, requestId: attempt.id, catalogSlug: slug, branchId });
      store.confirm(scope, 'catalog-order'); setPending(null); setResult(saved); onComplete();
    } catch (cause) { if (cause instanceof CatalogOrderRejected && !pending) { new OperationAttempts(window.localStorage).confirm(scope, 'catalog-order'); setPending(null); } setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o pedido. Recupere a mesma tentativa.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="public-catalog-checkout" aria-label="Seu pedido">
    <h2>Seu pedido</h2>{error && <p role="alert">{error}</p>}
    {result && <p role="status">Pedido #{result.id.slice(0, 8)} recebido pela loja. Total dos produtos: {money.format(result.total)}. Aguarde a confirmação de disponibilidade e pagamento.</p>}
    {cart.map(item => <div key={item.id} className="public-cart-row"><strong>{item.name}</strong><span>{money.format(item.sale_price)}</span><label>Quantidade<input type="number" min={0} value={item.quantity} disabled={busy || !!pending} onChange={e => onQuantity(item.id, Number(e.target.value))} /></label></div>)}
    <p>Total dos produtos: {money.format(cart.reduce((sum, item) => sum + item.quantity * item.sale_price, 0))}</p>
    {!userId ? <form onSubmit={async e => { e.preventDefault(); if (!onSignIn || busy) return; setBusy(true); setError(''); try { const result = await onSignIn(email, password); if (result.error) setError(result.error); else setPassword(''); } catch { setError('Não foi possível entrar.'); } finally { setBusy(false); } }}>
      <p>Entre na sua conta para enviar o pedido.</p><label>E-mail<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Senha<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button type="submit" disabled={busy}>Entrar</button><a href="/?cadastro=1" onClick={() => window.sessionStorage.setItem('distrihub-catalog-return', `/catalogo?loja=${encodeURIComponent(slug)}${branchSlug ? `&filial=${encodeURIComponent(branchSlug)}` : ''}`)}>Criar uma conta</a>
    </form> : <form onSubmit={submit}><fieldset disabled={busy || !!pending}>
      <label>Seu nome / empresa<input required minLength={2} maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label><label>Telefone / WhatsApp<input type="tel" required minLength={5} maxLength={100} value={contact} onChange={e => setContact(e.target.value)} /></label>
      <label>Recebimento<select value={delivery} onChange={e => setDelivery(e.target.value)}><option value="balcao">Retirar na loja</option><option value="entrega">Solicitar entrega — frete a combinar</option></select></label>
      {delivery === 'entrega' && <label>Endereço de entrega<input required minLength={5} maxLength={1500} value={address} onChange={e => setAddress(e.target.value)} /></label>}
      <label>Preferência de pagamento<select value={payment} onChange={e => setPayment(e.target.value)}><option value="pix">PIX</option><option value="cartao">Cartão</option></select></label>
    </fieldset><p>O envio registra uma solicitação. A loja confirma o pagamento e, se houver entrega, o frete.</p><button type="submit" disabled={busy || (!cart.length && !pending)}>{busy ? 'Confirmando...' : pending ? 'Recuperar pedido enviado' : 'Enviar pedido à loja'}</button>{pending && <p>Esta tentativa conserva os dados enviados, mesmo após falha de conexão.</p>}</form>}
  </section>;
}
