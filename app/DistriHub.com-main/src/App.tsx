import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Lock, ShieldAlert, Eye, KeyRound, Mail, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { BusinessSegment } from './types';
import { readWithJwtRecovery, useAuth } from './hooks/useAuth';
import { useSuperAdminAuth } from './hooks/useSuperAdminAuth';
import { HubHome } from './components/HubHome';
import { AppUpdateNotice } from './components/AppUpdateNotice';
import { supabase } from './lib/supabase';
import { PartnerAccessGate } from './components/partner/PartnerAccessGate';

const PartnerPanel = lazy(() => import('./components/PartnerPanel').then((module) => ({ default: module.PartnerPanel })));
const AuthScreen = lazy(() => import('./components/AuthScreen').then((module) => ({ default: module.AuthScreen })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then((module) => ({ default: module.AdminPanel })));
const PublicCatalogPage = lazy(() => import('./components/PublicCatalogPage').then((module) => ({ default: module.PublicCatalogPage })));

type View = 'hub' | 'partner' | 'auth' | 'admin' | 'super-admin';

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="super-admin-gate">
      <div className="super-admin-gate-card">
        <div className="super-admin-gate-header">
          <h2>{label}</h2>
          <p>Carregando painel...</p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const auth = useAuth();
  return <AppContent auth={auth} />;
}

function AppContent({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const superAdminAuth = useSuperAdminAuth();

  const publicCatalog = typeof window !== 'undefined' && ['/catalogo', '/catalogo/'].includes(window.location?.pathname);
  const catalogParams = publicCatalog ? new URLSearchParams(window.location.search) : null;
  const [view, setView] = useState<View>(() => typeof window !== 'undefined' && window.location?.search?.includes('cadastro=1') ? 'auth' : 'hub');
  const [partnerInitialTab, setPartnerInitialTab] = useState<string | undefined>(undefined);
  const [superAdminUnlocked, setSuperAdminUnlocked] = useState(false);
  const [sessionAccess, setSessionAccess] = useState<{ userId: string; master: boolean; error: string | null } | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const sessionUserId = auth.user?.id ?? null;

  const accountScope = auth.identity ? `${auth.identity.authUserId}:${auth.identity.companyUserId}` : null;
  const { signOut } = auth;
  const handleSwitchAccount = useCallback(async () => {
    await signOut();
    if (accountScope) {
      try { sessionStorage.removeItem(`distrihub:operator-selection:${accountScope}`); }
      catch { /* The session has already been terminated. */ }
      try { sessionStorage.removeItem(`distrihub:operator-session:${accountScope}`); }
      catch { /* A new login has a different server session and cannot reuse the token. */ }
    }
    setPartnerInitialTab(undefined);
    setSuperAdminUnlocked(false);
    setSessionAccess(null);
    setView('auth');
  }, [signOut, accountScope]);

  useEffect(() => {
    if (publicCatalog) return;
    if (auth.loading) return;
    const catalogReturn = typeof window !== 'undefined' ? window.sessionStorage?.getItem('distrihub-catalog-return') : null;
    if (sessionUserId && catalogReturn?.startsWith('/catalogo?')) {
      window.sessionStorage.removeItem('distrihub-catalog-return');
      window.location.assign(catalogReturn);
      return;
    }
    if (auth.passwordRecovery) {
      setSuperAdminUnlocked(false);
      setView('auth');
      return;
    }
    if (!sessionUserId) {
      setSessionAccess(null);
      setSuperAdminUnlocked(false);
      setView(current => current === 'partner' || current === 'admin' || current === 'super-admin' ? 'auth' : current);
      return;
    }
    let cancelled = false;
    async function restorePanel() {
      try {
        if (!supabase) throw new Error('Não foi possível conectar para recuperar o painel.');
        const client = supabase;
        const { data, error } = await readWithJwtRecovery(() => client.rpc('is_super_admin'), () => !cancelled);
        if (error || typeof data !== 'boolean') throw new Error('Não foi possível confirmar o acesso ao painel. Tente novamente.');
        if (cancelled) return;
        setSessionAccess({ userId: sessionUserId!, master: data, error: null });
        setSuperAdminUnlocked(data);
        setView(current => current === 'hub' || current === 'auth' || current === 'partner' || current === 'admin'
          ? data ? 'super-admin' : 'partner' : current);
      } catch (error) {
        if (!cancelled) setSessionAccess({ userId: sessionUserId!, master: false, error: error instanceof Error ? error.message : 'Não foi possível recuperar o painel.' });
      }
    }
    void restorePanel();
    return () => { cancelled = true; };
  }, [auth.loading, auth.passwordRecovery, sessionUserId, sessionRetry, publicCatalog, handleSwitchAccount]);

  const segment: BusinessSegment = auth.profile?.segment ?? 'assistencia';

  function handlePartnerClick() {
    setPartnerInitialTab(undefined);
    setView(auth.user ? sessionAccess?.master ? 'super-admin' : 'partner' : 'auth');
  }

  async function handleSuperAdminUnlock(email: string, password: string): Promise<{ ok: boolean; error: string | null }> {
    const result = await superAdminAuth.verifyPassword(email, password);
    if (result.ok) {
      setSuperAdminUnlocked(true);
      setView('super-admin');
    }
    return result;
  }

  async function handleLogout() {
    setNavigationError(null);
    try {
      await handleSwitchAccount();
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : 'Não foi possível sair. Tente novamente.');
    }
  }

  function handleSuperAdminBack() {
    if (superAdminUnlocked) void handleLogout();
    else setView('hub');
  }

  function handleAuthBack() {
    setView('hub');
  }

  async function handleSignIn(email: string, password: string) {
    const result = await auth.signIn(email, password);
    if (!result.error) {
      setPartnerInitialTab(undefined);
      setView('partner');
    }
    return result;
  }

  async function handleSignUp(data: {
    document: string;
    personType: 'PF' | 'PJ';
    businessName: string;
    whatsapp: string;
    email: string;
    password: string;
  }) {
    const result = await auth.signUp(data);
    if (!result.error && !result.needsEmailConfirmation) {
      setPartnerInitialTab(undefined);
      setView('partner');
    }
    return result;
  }

  if (publicCatalog) return <Suspense fallback={<LoadingScreen label="Catálogo" />}><PublicCatalogPage slug={catalogParams?.get('loja') ?? ''} branchSlug={catalogParams?.get('filial')} userId={auth.user?.id ?? null} onSignIn={auth.signIn} /></Suspense>;

  if (!sessionUserId && auth.sessionRecoveryError) {
    return <div className="super-admin-gate"><div className="super-admin-gate-card">
      <h2>Recuperando sua sessão</h2>
      <p role="alert">{auth.sessionRecoveryError}</p>
      <button className="module-submit-btn" onClick={auth.retrySession}>Tentar novamente</button>
    </div></div>;
  }
  if (auth.loading || (sessionUserId && !auth.passwordRecovery && sessionAccess?.userId !== sessionUserId)) {
    return <LoadingScreen label="Recuperando sua sessão" />;
  }
  if (sessionUserId && !auth.passwordRecovery && sessionAccess?.error) {
    return <div className="super-admin-gate"><div className="super-admin-gate-card">
      <p role="alert">{sessionAccess.error}</p>
      <button className="module-submit-btn" onClick={() => { setSessionAccess(null); setSessionRetry(value => value + 1); }}>Tentar novamente</button>
      <button className="partner-back-btn" onClick={() => void handleLogout()}>Sair do app</button>
      {navigationError && <p role="alert">{navigationError}</p>}
    </div></div>;
  }

  return (
    <div className="app-shell">
      {sessionUserId && !auth.passwordRecovery && (view === 'partner' || view === 'admin' || (view === 'super-admin' && superAdminUnlocked)) &&
        <AppUpdateNotice expectedUserId={sessionUserId} />}
      {navigationError && <p role="alert" className="otp-error-msg">{navigationError}</p>}
      {view === 'hub' && (
        <HubHome
          onAccessPanel={handlePartnerClick}
          onAccessSuperAdmin={() => setView('super-admin')}
          superAdminActive={superAdminUnlocked}
        />
      )}

      {view === 'auth' && (
        <Suspense fallback={<LoadingScreen label="Autenticação" />}>
          <AuthScreen
            onBack={handleAuthBack}
            onSignIn={handleSignIn}
            onSignUp={handleSignUp}
            onRequestPasswordReset={auth.requestPasswordReset}
            onUpdatePassword={auth.updatePassword}
            recoveryMode={auth.passwordRecovery}
          />
        </Suspense>
      )}

      {view === 'partner' && (
        <Suspense fallback={<LoadingScreen label="Área do parceiro" />}>
          <PartnerAccessGate key={auth.user?.id} user={auth.user} identity={auth.identity}
            identityError={auth.error} onRetryIdentity={auth.retrySession} onSwitchAccount={handleSwitchAccount}>
          {(pinOperator, onRequestAccess, accessLocked, onSelectOperatorBranch) => <PartnerPanel
            key={`${auth.user?.id}:${accessLocked ? 'locked' : pinOperator?.id ?? 'owner'}:${pinOperator?.branchId ?? 'all'}`}
            accessLocked={accessLocked}
            pinOperator={pinOperator}
            onRequestAccess={onRequestAccess}
            onSelectOperatorBranch={onSelectOperatorBranch}
            onBack={handleLogout}
            user={auth.user}
            identity={auth.identity}
            identityError={auth.error}
            onRetryIdentity={auth.retrySession}
            segment={segment}
            initialTab={partnerInitialTab}
            onConsumeInitialTab={() => setPartnerInitialTab(undefined)}
          />}
          </PartnerAccessGate>
        </Suspense>
      )}

      {view === 'admin' && (
        <Suspense fallback={<LoadingScreen label="Administração" />}>
          <AdminPanel onBack={handleSuperAdminBack} />
        </Suspense>
      )}

      {view === 'super-admin' && !superAdminUnlocked && (
        <SuperAdminGate
          onBack={handleSuperAdminBack}
          onUnlock={handleSuperAdminUnlock}
          auth={superAdminAuth}
        />
      )}

      {view === 'super-admin' && superAdminUnlocked && (
        <Suspense fallback={<LoadingScreen label="Painel master" />}>
          <AdminPanel onBack={handleSuperAdminBack} />
        </Suspense>
      )}


    </div>
  );
}

export default App;

type SuperAdminAuth = ReturnType<typeof useSuperAdminAuth>;

type RecoveryStep = 'request' | 'sent';

function SuperAdminGate({
  onBack,
  onUnlock,
  auth,
}: {
  onBack: () => void;
  onUnlock: (email: string, password: string) => Promise<{ ok: boolean; error: string | null }>;
  auth: SuperAdminAuth;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await onUnlock(email, password);
      if (!result.ok) {
        setError(result.error ?? 'Credencial inválida. Acesso negado.');
        setPassword('');
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível validar a credencial.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  if (showRecovery) {
    return (
      <RecoveryFlow
        auth={auth}
        onBack={() => setShowRecovery(false)}
        onSuccess={() => { setShowRecovery(false); setPassword(''); setError(null); }}
      />
    );
  }

  return (
    <div className="super-admin-gate">
      <div className="super-admin-gate-card">
        <div className="super-admin-gate-header">
          <span className="super-admin-gate-icon"><ShieldAlert size={28} /></span>
          <h2>Painel Super Admin — Distribuidora</h2>
          <p>Área restrita ao proprietário do sistema. Use sua conta autenticada do Super Admin.</p>
        </div>
        <form onSubmit={handleSubmit} className="super-admin-gate-form">
          <label>
            <span className="social-label text-slate-900"><Mail size={14} /> E-mail do Super Admin</span>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              autoFocus
              required
            />
          </label>
          <label>
            <span className="social-label text-slate-900"><Lock size={14} /> Senha</span>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              required
            />
          </label>
          {error && <p className="super-admin-gate-error">{error}</p>}
          <button
            type="button"
            className="super-admin-forgot-link"
            onClick={() => setShowRecovery(true)}
          >
            <KeyRound size={13} /> Esqueci minha senha
          </button>
          <div className="super-admin-gate-actions">
            <button type="button" className="partner-back-btn" onClick={onBack}>
              <ArrowLeft size={16} /> Voltar ao início
            </button>
            <button type="submit" className="module-submit-btn" disabled={submitting}>
              <Eye size={16} /> {submitting ? 'Verificando...' : 'Liberar Acesso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RecoveryFlow({
  auth,
  onBack,
  onSuccess,
}: {
  auth: SuperAdminAuth;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<RecoveryStep>('request');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await auth.requestRecovery(email);
      if (err) { setError(err); return; }
      setInfo('Se o e-mail estiver cadastrado, você receberá um link seguro para concluir a troca de senha.');
      setStep('sent');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível solicitar o link de recuperação.');
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="super-admin-gate">
      <div className="super-admin-gate-card">
        <div className="super-admin-gate-header">
          <span className="super-admin-gate-icon"><KeyRound size={28} /></span>
          <h2>Recuperar Acesso Master</h2>
          {step !== 'sent' && <p>Verifique sua identidade para redefinir a senha master.</p>}
        </div>

        {step === 'request' && (
          <form onSubmit={handleRequestCode} className="super-admin-gate-form">
            <label>
              <span className="social-label"><Mail size={14} /> E-mail do Admin Master</span>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                autoFocus
                required
              />
            </label>
            {error && <p className="super-admin-gate-error">{error}</p>}
            <div className="super-admin-gate-actions">
              <button type="button" className="partner-back-btn" onClick={onBack}>
                <ArrowLeft size={16} /> Voltar ao login
              </button>
              <button type="submit" className="module-submit-btn" disabled={loading}>
                <ShieldCheck size={16} /> {loading ? 'Enviando...' : 'Enviar link por e-mail'}
              </button>
            </div>
          </form>
        )}

        {step === 'sent' && (
          <div className="super-admin-gate-form">
            <div className="super-admin-recovery-success">
              <CheckCircle2 size={40} />
              <h3>Confira seu e-mail</h3>
              <p>{info}</p>
            </div>
            <button type="button" className="module-submit-btn" onClick={onSuccess}>
              <ArrowLeft size={16} /> Voltar ao login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
