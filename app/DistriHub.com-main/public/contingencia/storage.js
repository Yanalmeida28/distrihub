const terminalKey = 'distrihub:contingencia:v1';
const lifetime = 12 * 60 * 60 * 1000;
const encode = new TextEncoder();
const decode = new TextDecoder();
const random = size => crypto.getRandomValues(new Uint8Array(size));
const maxCents = 9_999_999_999;

async function derive(password, salt) {
  const input = await crypto.subtle.importKey('raw', encode.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, input,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function hasTerminal() {
  try { return Boolean(localStorage.getItem(terminalKey)); } catch { return false; }
}

async function scopeFingerprint(scope, branchId) {
  const hash = await crypto.subtle.digest('SHA-256', encode.encode(JSON.stringify([scope, branchId])));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

export async function terminalMatches(scope, branchId) {
  try {
    const saved = localStorage.getItem(terminalKey);
    if (!saved) return false;
    const { fingerprint } = JSON.parse(saved);
    // Terminais anteriores conferem a filial ao desbloquear a cópia.
    return !fingerprint || fingerprint === await scopeFingerprint(scope, branchId);
  } catch { return false; }
}

export async function openTerminal(password, allowCreate = false) {
  if (!navigator.locks || !crypto.subtle) throw new Error('Use um navegador atualizado para habilitar a contingência.');
  let current = localStorage.getItem(terminalKey);
  if (!current && !allowCreate) throw new Error('Prepare a contingência neste navegador enquanto estiver conectado.');
  if (password.length < 8 || password.length > 128) throw new Error('Use uma senha local de 8 a 128 caracteres.');

  let salt;
  let key;
  let state = null;
  try {
    const box = current ? JSON.parse(current) : null;
    salt = box ? Uint8Array.from(box.salt) : random(16);
    key = await derive(password, salt);
    if (box) {
      const bytes = Uint8Array.from(atob(box.cipher), c => c.charCodeAt(0));
      state = JSON.parse(decode.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(box.iv) }, key, bytes)));
      if (state.version !== 1 || !Array.isArray(state.queue) || !state.snapshot) throw new Error('invalid');
    }
  } catch {
    throw new Error('Senha local incorreta ou dados de contingência indisponíveis.');
  }

  return {
    state,
    async save(next) {
      const iv = random(12);
      const bytes = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encode.encode(JSON.stringify(next))));
      const cipher = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
      const fingerprint = await scopeFingerprint(next.snapshot.scope, next.snapshot.branchId);
      const encrypted = JSON.stringify({ salt: [...salt], iv: [...iv], cipher: btoa(cipher), fingerprint });
      await navigator.locks.request(terminalKey, () => {
        if (localStorage.getItem(terminalKey) !== current) throw new Error('Os dados foram alterados em outra aba. Abra a contingência novamente.');
        localStorage.setItem(terminalKey, encrypted);
        current = encrypted;
      });
    },
  };
}

export function prepareSnapshot(previous, snapshot, now = Date.now()) {
  if (previous?.queue.length) throw new Error('Sincronize as vendas pendentes antes de atualizar a cópia local.');
  return { version: 1, snapshot: { ...snapshot, savedAt: now, expiresAt: now + lifetime }, queue: [] };
}

export function remainingStock(state, product) {
  const pending = state.queue.reduce((sum, sale) => sum + sale.items
    .filter(item => item.product_id === product.id).reduce((total, item) => total + item.quantity, 0), 0);
  return Math.max(0, product.stock - pending);
}

export function recordSale(state, cart, now = Date.now(), id = crypto.randomUUID()) {
  if (now < state.snapshot.savedAt || now >= state.snapshot.expiresAt) throw new Error('A autorização local expirou. Atualize a contingência com internet.');
  if (state.queue.length >= 100) throw new Error('A fila local está cheia. Sincronize as vendas para continuar.');
  if (!cart.size || cart.size > 100) throw new Error('Confira os produtos da venda.');
  const items = [];
  let cents = 0;
  for (const [productId, quantity] of cart) {
    const product = state.snapshot.products.find(item => item.id === productId);
    if (!product || !Number.isInteger(quantity) || quantity <= 0 || quantity > (product.tracksStock ? remainingStock(state, product) : 999)) {
      throw new Error('Quantidade indisponível na cópia local do estoque.');
    }
    cents += product.priceCents * quantity;
    items.push({ product_id: product.id, name: product.name, quantity, unit_price: product.priceCents / 100 });
  }
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maxCents) throw new Error('Confira o total da venda.');
  const sale = { id, recordedAt: new Date(now).toISOString(), items, total: cents / 100 };
  return { ...state, queue: [...state.queue, sale] };
}
