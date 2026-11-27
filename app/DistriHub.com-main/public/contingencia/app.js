import { openTerminal, recordSale, remainingStock } from './storage.js';

const element = id => document.getElementById(id);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const cart = new Map();
let terminal;
let state;
let saving = false;
const embedded = window.parent !== window;
const context = new URLSearchParams(location.hash.slice(1));
element('back').hidden = embedded;

function row(container, text, action) {
  const li = document.createElement('li');
  const content = document.createElement('span');
  content.textContent = text;
  li.append(content);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.disabled = action.disabled;
    button.onclick = action.click;
    li.append(button);
  }
  element(container).append(li);
}

function render() {
  const { snapshot, queue } = state;
  const valid = Date.now() >= snapshot.savedAt && Date.now() < snapshot.expiresAt;
  element('terminal').textContent = `${snapshot.branchName} · Caixa ${snapshot.cashId.slice(0, 8)} · Cópia de ${date.format(snapshot.savedAt)}`;
  element('validity').textContent = valid ? `Autorizado até ${date.format(snapshot.expiresAt)}.` : 'Autorização expirada. Consulte a cópia ou sincronize pelo PDV.';
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(element('search').value.trim());
  const results = term ? snapshot.products.filter(product => normalize(`${product.name} ${product.sku} ${product.barcode}`).includes(term)) : [];
  ['products', 'cart', 'queue'].forEach(id => element(id).replaceChildren());
  if (!results.length) row('products', term ? 'Nenhum produto encontrado.' : 'Digite o nome ou o código do produto.');
  for (const product of results.slice(0, 12)) {
    const limit = product.tracksStock ? remainingStock(state, product) : 999;
    row('products', `${product.name} · ${money.format(product.priceCents / 100)}${product.tracksStock ? ` · ${limit} un. disponíveis na cópia` : ''}`, {
      label: 'Adicionar', disabled: !valid || saving || (cart.get(product.id) ?? 0) >= limit,
      click: () => { cart.set(product.id, (cart.get(product.id) ?? 0) + 1); render(); },
    });
  }
  let total = 0;
  for (const [id, quantity] of cart) {
    const product = snapshot.products.find(item => item.id === id);
    total += product.priceCents * quantity;
    row('cart', `${quantity} × ${product.name}`, { label: 'Remover 1', disabled: saving, click: () => {
      if (quantity === 1) cart.delete(id); else cart.set(id, quantity - 1);
      render();
    } });
  }
  element('total').textContent = `Total: ${money.format(total / 100)}`;
  element('save').disabled = saving || !valid || !cart.size;
  element('lock').disabled = saving;
  if (!queue.length) row('queue', 'Nenhuma venda pendente.');
  for (const sale of [...queue].reverse()) row('queue', `#${sale.id.slice(0, 8)} · ${date.format(new Date(sale.recordedAt))} · ${money.format(sale.total)}`);
}

async function unlock(password) {
  const form = element('unlock');
  const button = form.querySelector('button');
  if (button.disabled || terminal) return;
  button.disabled = true;
  try {
    const opened = await openTerminal(password);
    if (embedded && (opened.state.snapshot.scope !== context.get('scope') || opened.state.snapshot.branchId !== context.get('branch'))) {
      throw new Error('A cópia local pertence a outra conta, operador ou filial.');
    }
    terminal = opened;
    state = terminal.state;
    form.reset();
    form.hidden = true;
    element('workspace').hidden = false;
    element('message').textContent = '';
    render();
  } catch (error) { element('message').textContent = error.message; }
  finally { button.disabled = false; }
}

element('unlock').onsubmit = event => {
  event.preventDefault();
  void unlock(new FormData(event.currentTarget).get('password'));
};

if (embedded) {
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'distrihub:contingency-unlock' && typeof event.data.password === 'string') {
      void unlock(event.data.password);
    }
  });
  window.parent.postMessage({ type: 'distrihub:contingency-ready' }, location.origin);
}

element('search').oninput = render;
element('save').onclick = async () => {
  if (saving) return;
  saving = true;
  render();
  try {
    const next = recordSale(state, cart);
    await terminal.save(next);
    state = next;
    cart.clear();
    element('message').textContent = 'Venda registrada neste terminal. Pendente de sincronização.';
  } catch (error) { element('message').textContent = error.message; }
  finally { saving = false; render(); }
};
element('lock').onclick = () => {
  cart.clear();
  state = undefined;
  terminal = undefined;
  element('workspace').hidden = true;
  ['terminal', 'validity', 'products', 'cart', 'total', 'queue'].forEach(id => element(id).replaceChildren());
  element('search').value = '';
  element('message').textContent = '';
  element('unlock').hidden = false;
  element('unlock').querySelector('input').focus();
};
