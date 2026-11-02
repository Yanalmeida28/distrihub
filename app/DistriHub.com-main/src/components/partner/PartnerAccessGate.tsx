import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { Lock, Shield, UserCheck, X } from 'lucide-react';
import type { PartnerIdentity } from '../../types';
import { supabase } from '../../lib/supabase';
import { authorizeOwner, authorizePin, rememberOperatorAccess, revokeOperatorSession, type PartnerAccess, type PinOperator } from '../../lib/partnerAccess';
import { OperatorSelectionStore, OperatorSessionStore } from '../../lib/checkoutCash';
import './SinglePanelModal.css';

type Mode = 'employee' | 'owner';
type Props = {
  user: User | null;
  identity: PartnerIdentity | null;
  identityError?: string | null;
  onRetryIdentity?: () => void;
  onSwitchAccount: () => Promise<void>;
  children: (operator: PinOperator | null, requestAccess: (mode: Mode) => void, accessLocked: boolean, selectBranch: (id: string) => Promise<void>) => ReactNode;
};

// Render the actual panel immediately, with operational access locked until
// confirmed. A saved operator selection is never an authorization.
export function PartnerAccessGate({ user, identity, identityError, onRetryIdentity, onSwitchAccount, children }: Props) {
  const scope = identity ? `${identity.authUserId}:${identity.companyUserId}` : '';
  const [authorized, setAuthorized] = useState<{ scope: string; access: PartnerAccess } | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const current = authorized?.scope === scope ? authorized.access : null;
  const currentRef = useRef(current);
  const generation = useRef({ value: 0 });
  currentRef.current = current;
  async function selectBranch(id: string) {
    const previous = currentRef.current;
    if (!identity || previous?.kind !== 'employee' || !previous.operator.canAccessAllBranches || !id) throw new Error('Filial não autorizada.');
    const access = await authorizePin(identity, previous.operator.id, previous.operator.name, previous.operator.pin, id);
    if (currentRef.current !== previous) throw new Error('O operador mudou. Selecione a filial novamente.');
    await allow(access.kind === 'employee' ? { ...access, operator: { ...access.operator, sessionExpiresAt: previous.operator.sessionExpiresAt } } : access);
  }
  async function allow(access: PartnerAccess) {
    if (!identity) return;
    const attempt = ++generation.current.value;
    let remembered = access;
    try { remembered = await rememberOperatorAccess(access); } catch { /* Keep the verified access in memory if persistence is unavailable. */ }
    if (attempt !== generation.current.value) return;
    try {
      const store = new OperatorSessionStore(sessionStorage, scope);
      const previous = store.read();
      store.clear();
      if (remembered.kind === 'employee' && remembered.operator.sessionExpiresAt) store.save({
        operatorId: remembered.operator.id, operatorName: remembered.operator.name, branchId: remembered.operator.branchId,
        credential: remembered.operator.pin, expiresAt: remembered.operator.sessionExpiresAt,
      });
      if (previous && (remembered.kind !== 'employee' || previous.credential !== remembered.operator.pin)) {
        await revokeOperatorSession(previous.credential);
      }
    } catch { /* Storage failure must not discard the currently verified access. */ }
    if (attempt !== generation.current.value) return;
    try { new OperatorSelectionStore(sessionStorage, scope).save({
      operatorId: access.kind === 'employee' ? access.operator.id : null,
      branchId: access.kind === 'employee' ? access.operator.branchId : '',
    }); } catch { /* PIN and password are never persisted. */ }
    setAuthorized({ scope, access: remembered });
    setMode(null);
  }
  useEffect(() => {
    const lifetime = generation.current;
    const attempt = ++lifetime.value;
    let live = true;
    setRestoreError(false);
    setRestoring(false);
    if (identity && user) {
      const expectedIdentity = identity;
      let saved: ReturnType<OperatorSessionStore['read']> = null;
      try { saved = new OperatorSessionStore(sessionStorage, scope).read(); } catch { /* Locked until PIN confirmation. */ }
      if (saved) {
        setRestoring(true);
        const session = saved;
        void authorizePin(expectedIdentity, session.operatorId, session.operatorName, session.credential, session.branchId)
          .then(access => {
            if (!live || attempt !== lifetime.value || access.kind !== 'employee') return;
            setAuthorized({ scope, access: { kind: 'employee', operator: { ...access.operator, sessionExpiresAt: session.expiresAt } } });
          })
          .catch(() => {
            if (live && attempt === lifetime.value) setRestoreError(true);
          })
          .finally(() => {
            if (live && attempt === lifetime.value) setRestoring(false);
          });
      }
    }
    return () => { live = false; lifetime.value++; };
  }, [scope, user, identity, restoreRevision]);
  function requestAccess(nextMode: Mode) { generation.current.value++; setRestoring(false); setRestoreError(false); setMode(nextMode); }
  if (!identity || !user) return <div className="partner-panel"><p role="status">
    {identityError || 'Validando sua sessão…'}</p>
    {identityError && onRetryIdentity && <button type="button" className="module-submit-btn" onClick={onRetryIdentity}>Tentar novamente</button>}
  </div>;
  return <>
    {!current && restoring ? <div className="partner-panel"><p role="status">Retomando seu operador…</p></div> :
    !current && restoreError ? <div className="partner-panel">
      <p role="alert">Não foi possível retomar seu operador. Confira a conexão e tente novamente. Se o acesso expirou ou foi alterado, confirme o PIN.</p>
      <button type="button" className="module-submit-btn" onClick={() => setRestoreRevision(value => value + 1)}>Retomar operador</button>
      <button type="button" className="rma-advance-btn" onClick={() => requestAccess('employee')}>Trocar operador por PIN</button>
    </div> :
    children(current?.kind === 'employee' ? current.operator : null, requestAccess, !current, selectBranch)
    }
    {mode && <PinAccessDialog key={`${scope}:${mode}`} mode={mode}
      identity={identity} user={user} onAuthorize={allow} onSwitchAccount={onSwitchAccount}
      onClose={() => setMode(null)} />}
  </>;
}

type DirectoryEntry = { id: string; name: string; active: boolean; branch_name: string | null; can_access_all_branches?: boolean };
type DialogProps = {
  mode: Mode; identity: PartnerIdentity; user: User;
  onAuthorize: (access: PartnerAccess) => void | Promise<void>; onSwitchAccount: () => Promise<void>; onClose?: () => void;
};

export function PinAccessDialog({ mode, identity, user, onAuthorize, onSwitchAccount, onClose }: DialogProps) {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [selected, setSelected] = useState(identity.salespersonId ?? '');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const generation = useRef({ value: 0 });
  useEffect(() => {
    if (mode !== 'employee') return;
    const lifetime = generation.current;
    let live = true;
    setLoading(true); setDirectoryError('');
    async function load() {
      try {
        if (!supabase) throw new Error('Serviço indisponível.');
        const { data, error: cause } = await supabase.rpc('list_partner_operator_directory');
        if (cause) throw cause;
        if (!Array.isArray(data)) throw new Error('Lista inválida.');
        if (!live) return;
        const rows = (data ?? []) as DirectoryEntry[];
        setDirectory(rows);
        let saved = identity.salespersonId ?? '';
        try { saved ||= new OperatorSelectionStore(sessionStorage, `${identity.authUserId}:${identity.companyUserId}`).read()?.operatorId ?? ''; }
        catch { /* PIN must still be entered. */ }
        setSelected(current => rows.some(row => row.id === current && row.active) ? current : rows.some(row => row.id === saved && row.active) ? saved : '');
      } catch { if (live) setDirectoryError('Não foi possível carregar os colaboradores. Tente novamente.'); }
      finally { if (live) setLoading(false); }
    }
    void load();
    return () => { live = false; lifetime.value++; };
  }, [identity.authUserId, identity.companyUserId, identity.salespersonId, retry, mode]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => { if (!pending.current) setRetry(value => value + 1); };
    window.addEventListener('focus', refresh);
    window.addEventListener('distrihub:operators-changed', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('distrihub:operators-changed', refresh); };
  }, []);
  useEffect(() => {
    generation.current.value++; pending.current = false; setBusy(false);
    setPin(''); setPassword(''); setError('');
  }, [mode, selected]);
  function close() { if (!pending.current) onClose?.(); }
  async function exitAccount() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onSwitchAccount(); }
    catch { setError('Não foi possível sair da conta. Tente novamente.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || (mode === 'employee' && (loading || Boolean(directoryError) || !directory.some(row => row.id === selected && row.active)))) return;
    pending.current = true; setBusy(true); setError('');
    const attempt = ++generation.current.value;
    try {
      if (mode === 'owner' && identity.salespersonId) { await onSwitchAccount(); return; }
      const access = mode === 'owner'
        ? await authorizeOwner(identity, user, password)
        : await authorizePin(identity, selected, directory.find(row => row.id === selected)?.name ?? 'Colaborador', pin);
      if (attempt === generation.current.value) { setPin(''); setPassword(''); await onAuthorize(access); }
    } catch (cause) {
      if (attempt === generation.current.value) setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o acesso.');
    } finally {
      if (attempt === generation.current.value) { pending.current = false; setBusy(false); }
    }
  }
  const owner = mode === 'owner';
  return <div className="modal-backdrop" onClick={close}>
    <div className="modal-content single-panel-modal" role="dialog" aria-modal="true"
      aria-labelledby="operator-access-title" onClick={event => event.stopPropagation()}>
      <div className="single-panel-header"><h3 id="operator-access-title">
        {owner ? <Shield size={18} /> : <UserCheck size={18} />}{' '}
        {owner ? 'Acesso do proprietário' : 'Acesso do colaborador'}</h3>
        {onClose && <button type="button" aria-label="Fechar" disabled={busy} onClick={close}><X size={18} /></button>}
      </div>
      <div className="single-panel-body">
        <form onSubmit={submit} className="single-panel-form">
          {!owner ? <>
            <p>Selecione seu nome e digite o PIN para entrar diretamente na sua filial.</p>
            <label>Colaborador<select aria-label="Colaborador" value={selected} disabled={busy || loading} onChange={event => setSelected(event.target.value)} required>
              <option value="">{loading ? 'Carregando…' : 'Selecione seu nome'}</option>
              {directory.map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.name} — {row.branch_name ?? 'Filial não definida'}{row.can_access_all_branches ? ' · Todas as filiais autorizadas' : ''}{!row.active ? ' · Inativo' : ''}</option>)}
            </select></label>
            <button type="button" className="single-panel-secondary" disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>Atualizar operadores</button>
            <label><span><Lock size={14} /> PIN de acesso</span><input aria-label="PIN de acesso" type="password" inputMode="numeric" autoComplete="off"
              value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} minLength={4} maxLength={8} required disabled={busy} /></label>
            {directoryError && <p role="alert">{directoryError} <button type="button" className="single-panel-secondary" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></p>}
            {!loading && !directoryError && directory.length === 0 && <p role="status">Nenhum colaborador ativo disponível nesta conta. Verifique o cadastro na Área do proprietário.</p>}
          </> : identity.salespersonId ? <p>Para liberar o acesso geral, entre com a conta do proprietário.</p> : <>
            <p>Informe a senha da Área do proprietário para liberar todas as filiais. Se ainda não cadastrou uma senha exclusiva em Configurações, use sua senha de login.</p>
            <label>Senha do proprietário<input aria-label="Senha do proprietário" type="password" autoComplete="current-password" value={password}
              onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>
          </>}
          {error && <p role="alert" className="otp-error-msg">{error}</p>}
          <button className="single-panel-confirm" disabled={busy || (!owner && (loading || Boolean(directoryError) || !directory.some(row => row.active)))}>
            {busy ? 'Conferindo…' : owner ? identity.salespersonId ? 'Entrar com a conta do proprietário' : 'Confirmar proprietário' : 'Entrar na minha filial'}
          </button>
          {onClose && <button type="button" className="single-panel-secondary" disabled={busy} onClick={close}>Cancelar</button>}
          {!onClose && <button type="button" className="single-panel-secondary" disabled={busy} onClick={() => void exitAccount()}>Sair da conta</button>}
        </form>
      </div>
    </div>
  </div>;
}
