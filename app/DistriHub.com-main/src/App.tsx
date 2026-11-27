import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Lock, ShieldAlert, Eye, KeyRound, Mail, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { BusinessSegment, PanelPreferences } from './types';
import { readWithJwtRecovery, useAuth } from './hooks/useAuth';
import { useSuperAdminAuth } from './hooks/useSuperAdminAuth';
import { HubHome } from './components/HubHome';
import { AppUpdateNotice } from './components/AppUpdateNotice';
import { supabase } from './lib/supabase';
import { panelPreferences } from './lib/personalization';
import { PartnerAccessGate } from './components/partner/PartnerAccessGate';

const PartnerPanel = lazy(() => import('./components/PartnerPanel').then((module) => ({ default: module.PartnerPanel })));
const AuthScreen = lazy(() => import('./components/AuthScreen').then((module) => ({ default: module.AuthScreen })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then((module) => ({ default: module.AdminPanel })));
const PublicCatalogPage = lazy(() => import('./components/PublicCatalogPage').then((module) => ({ default: module.PublicCatalogPage })));

type View = 'hub' | 'partner' | 'auth' | 'admin' | 'super-admin';

type SavedPanelAppearance = { scope: string; preferences?: Partial<PanelPreferences> };
const panelAppearanceStorageKey = 'distrihub:panel-appearance';
const themePilotCompany = 'b9e98e0f-5625-452f-b7f7-48a264234822';
const deviceThemeKey = `distrihub:device-white-theme:${themePilotCompany}`;
const deviceThemeLabels = { white: 'Fundo Branco', 'blue-glass': 'Azul Vidro' } as const;
type DeviceTheme = keyof typeof deviceThemeLabels;

function readDeviceTheme(): DeviceTheme | undefined {
  try {
    const value = localStorage.getItem(deviceThemeKey);
    return value === 'white' || value === 'blue-glass' ? value : undefined;
  } catch { return undefined; }
}

function readSavedPanelAppearance(): SavedPanelAppearance | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(panelAppearanceStorageKey) ?? 'null');
    if (typeof saved?.scope !== 'string') return undefined;
    return { scope: saved.scope, preferences: saved.preferences ? panelPreferences(saved.preferences) : undefined };
  } catch { return undefined; }
}

function LoadingScreen({ label, theme }: { label: string; theme?: PanelPreferences['theme'] }) {
  return (
    <div className="super-admin-gate" data-panel-theme={theme}>
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

  const [panelAppearance, setPanelAppearance] = useState<SavedPanelAppearance>();
  const [savedPanelAppearance, setSavedPanelAppearance] = useState(readSavedPanelAppearance);
  const accountScope = auth.identity ? `${auth.identity.authUserId}:${auth.identity.companyUserId}` : null;
  const companyUserId = auth.identity?.companyUserId;
  const themePilot = Boolean(accountScope && companyUserId === themePilotCompany);
  const [deviceTheme, setDeviceTheme] = useState(readDeviceTheme);
  const [themePreview, setThemePreview] = useState<{ scope: string | null; theme: DeviceTheme }>();
  const [deviceThemeError, setDeviceThemeError] = useState('');
  const previewTheme = themePilot && themePreview?.scope === accountScope ? themePreview.theme : undefined;
  const localPanelTheme = themePilot ? previewTheme ?? deviceTheme : undefined;
  const savedForAccount = accountScope && savedPanelAppearance?.scope === accountScope ? savedPanelAppearance.preferences : undefined;
  const cachedPanelPreferences = accountScope && panelAppearance?.scope === accountScope ? panelAppearance.preferences : savedForAccount;
  const panelTheme = localPanelTheme ?? (accountScope && panelAppearance?.scope === accountScope
    ? panelPreferences(panelAppearance.preferences).theme
    : cachedPanelPreferences?.theme ?? cachedPanelPreferences?.financial_theme);
  const startupTheme = !auth.passwordRecovery && savedPanelAppearance && (
    !sessionUserId || (accountScope ? savedPanelAppearance.scope === accountScope : savedPanelAppearance.scope.startsWith(sessionUserId + ':'))
  ) ? savedPanelAppearance.preferences?.theme : undefined;

  function saveDeviceTheme(theme?: DeviceTheme) {
    setDeviceThemeError('');
    try {
      if (theme) localStorage.setItem(deviceThemeKey, theme);
      else localStorage.removeItem(deviceThemeKey);
      setDeviceTheme(theme);
      setThemePreview(undefined);
    } catch {
      setDeviceThemeError('O navegador não permitiu salvar a preferência neste aparelho.');
    }
  }

  const deviceAppearance = themePilot ? (
    <section className="module-card settings-account-card" aria-labelledby="device-appearance-title">
      <h3 id="device-appearance-title">Aparência neste aparelho</h3>
      <p>{previewTheme ? `${deviceThemeLabels[previewTheme]} em teste. Navegue pelo painel e volte aqui para salvar.` :
        deviceTheme ? `${deviceThemeLabels[deviceTheme]} salvo neste navegador.` : 'Escolha um tema para experimentar neste navegador.'}</p>
      <div className="action-row">
        {previewTheme ? <>
          <button type="button" className="module-submit-btn" onClick={() => saveDeviceTheme(previewTheme)}>Salvar tema</button>
          <button type="button" className="partner-secondary-btn" onClick={() => { setThemePreview(undefined); setDeviceThemeError(''); }}>Voltar ao tema anterior</button>
        </> : <>
          {(Object.keys(deviceThemeLabels) as DeviceTheme[]).filter(theme => theme !== deviceTheme).map(theme =>
            <button key={theme} type="button" className="partner-secondary-btn" onClick={() => {
              setDeviceThemeError('');
              setThemePreview({ scope: accountScope, theme });
            }}>Experimentar {deviceThemeLabels[theme]}</button>)}
          {deviceTheme && <button type="button" className="partner-secondary-btn" onClick={() => saveDeviceTheme()}>Usar tema da empresa</button>}
        </>}
      </div>
      {deviceThemeError && <p role="alert">{deviceThemeError}</p>}
    </section>
  ) : undefined;

  useEffect(() => {
    if (!panelAppearance || panelAppearance.scope !== accountScope) return;
    try {
      sessionStorage.setItem(panelAppearanceStorageKey, JSON.stringify({
        scope: panelAppearance.scope, preferences: panelPreferences(panelAppearance.preferences),
      }));
    } catch { /* The active theme still works without browser storage. */ }
  }, [accountScope, panelAppearance]);

  useEffect(() => {
    const client = supabase;
    if (view !== 'partner' || !sessionUserId || !accountScope || !companyUserId || !client) return;

    let active = true;
    void readWithJwtRecovery(() => client.from('partner_store_settings')
      .select('panel:personalization->panel')
      .eq('user_id', companyUserId)
      .maybeSingle(), () => active)
      .then(({ data, error }) => {
        if (!active || error) return;
        const preferences = data?.panel ? panelPreferences(data.panel) : undefined;
        // The unlocked panel may already have loaded or saved newer settings.
        setPanelAppearance(current => current?.scope === accountScope ? current : { scope: accountScope, preferences });
      })
      .catch(() => { /* Theme stays at its current value if the read fails. */ });

    return () => { active = false; };
  }, [view, sessionUserId, accountScope, companyUserId]);

  const { signOut } = auth;
  const handleSwitchAccount = useCallback(async () => {
    await signOut();
    if (accountScope) {
      try { sessionStorage.removeItem(`distrihub:operator-selection:${accountScope}`); }
      catch { /* The session has already been terminated. */ }
      try { sessionStorage.removeItem(`distrihub:operator-session:${accountScope}`); }
      catch { /* A new login has a different server session and cannot reuse the token. */ }
    }
    try { sessionStorage.removeItem(panelAppearanceStorageKey); }
    catch { /* The session has already been terminated. */ }
    setSavedPanelAppearance(undefined);
    setPanelAppearance(undefined);
    setThemePreview(undefined);
    setDeviceThemeError('');
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

  if (publicCatalog) return <Suspense fallback={<LoadingScreen label="Catálogo" />}><PublicCatalogPage slug={catalogParams?.get('loja') ?? ''} branchSlug={catalogParams?.get('filial')} fixedBranchId={catalogParams?.get('unidade')} userId={auth.user?.id ?? null} onSignIn={auth.signIn} /></Suspense>;

  if (!sessionUserId && auth.sessionRecoveryError) {
    return <div className="super-admin-gate"><div className="super-admin-gate-card">
      <h2>Recuperando sua sessão</h2>
      <p role="alert">{auth.sessionRecoveryError}</p>
      <button className="module-submit-btn" onClick={auth.retrySession}>Tentar novamente</button>
    </div></div>;
  }
  if (auth.loading || (sessionUserId && !auth.passwordRecovery && sessionAccess?.userId !== sessionUserId)) {
    return <LoadingScreen label="Recuperando sua sessão" theme={panelTheme ?? startupTheme} />;
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
        <Suspense fallback={<LoadingScreen label="Área do parceiro" theme={panelTheme ?? startupTheme} />}>
          <PartnerAccessGate key={auth.user?.id} user={auth.user} identity={auth.identity}
            identityError={auth.error} onRetryIdentity={auth.retrySession} onSwitchAccount={handleSwitchAccount}
            panelTheme={panelTheme ?? (!accountScope ? startupTheme : undefined)}>
          {(pinOperator, onRequestAccess, accessLocked, onSelectOperatorBranch) => <PartnerPanel
            key={`${auth.user?.id}:${accessLocked ? 'locked' : pinOperator?.id ?? 'owner'}:${pinOperator?.branchId ?? 'all'}`}
            accessLocked={accessLocked}
            cachedPanelPreferences={cachedPanelPreferences}
            localPanelTheme={localPanelTheme}
            deviceAppearance={deviceAppearance}
            onPanelPreferencesLoaded={setPanelAppearance}
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
