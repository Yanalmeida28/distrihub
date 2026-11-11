export type OperationAttempt<T> = { id: string; payload: T };
export class OperationAttempts {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  private key(scope: string, kind: string) { return `distrihub-operation:${scope}:${kind}`; }
  pending<T>(scope: string, kind: string): OperationAttempt<T> | null {
    const raw = this.storage.getItem(this.key(scope, kind));
    if (!raw) return null;
    const value = JSON.parse(raw) as OperationAttempt<T>;
    if (!value.id || !value.payload) throw new Error('Tentativa inválida. Confira a operação antes de continuar.');
    return value;
  }
  get<T>(scope: string, kind: string, payload: T): OperationAttempt<T> {
    const previous = this.pending<T>(scope, kind);
    if (previous) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw new Error('Existe uma tentativa sem confirmação. Recupere os dados enviados antes de registrar outra operação.');
      return previous;
    }
    const value = { id: crypto.randomUUID(), payload };
    this.storage.setItem(this.key(scope, kind), JSON.stringify(value));
    return value;
  }
  confirm(scope: string, kind: string, expectedId?: string) {
    // A late response must never remove a newer attempt in the same scope.
    if (expectedId && this.pending(scope, kind)?.id !== expectedId) return;
    this.storage.removeItem(this.key(scope, kind));
  }
}

export type PendingPhoto = { id: string; file: File; type: 'entry' | 'exit'; label: string };
function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('distrihub-pending-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Não foi possível preservar os anexos neste navegador.'));
  });
}
export async function pendingPhotos(key: string, value?: PendingPhoto[] | null): Promise<PendingPhoto[]> {
  const db = await openFiles();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('operations', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('operations');
      const request = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
      transaction.oncomplete = () => resolve(value === undefined ? request.result ?? [] : value ?? []);
      transaction.onerror = transaction.onabort = () => reject(new Error('Não foi possível preservar os anexos. Tente novamente.'));
    });
  } finally { db.close(); }
}
