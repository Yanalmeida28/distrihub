import { useState, useEffect } from 'react';
import { ArrowLeft, Building2, Lock, Mail, Phone, Check, KeyRound } from 'lucide-react';
import { formatCpf, formatCnpj, isValidCpf, isValidCnpj, normalizeDocument } from '../utils';

type AuthScreenProps = {
  onBack: () => void;
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
  onSignUp: (data: {
    businessName: string;
    whatsapp: string;
    email: string;
    password: string;
    document: string;
    personType: 'PF' | 'PJ';
  }) => Promise<{ error: string | null; needsEmailConfirmation?: boolean }>;
  onRequestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  onUpdatePassword: (password: string) => Promise<{ error: string | null }>;
  recoveryMode?: boolean;
};

export function AuthScreen({ onBack, onSignIn, onSignUp, onRequestPasswordReset, onUpdatePassword, recoveryMode = false }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupInfo, setSignupInfo] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [personType, setPersonType] = useState<'PF' | 'PJ'>('PJ');
  const [document, setDocument] = useState('');

  // Password recovery state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<'identify' | 'reset'>('identify');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    if (recoveryMode) {
      setShowRecovery(true);
      setRecoveryStep('reset');
      setRecoveryDone(false);
      setPasswordUpdated(false);
    }
  }, [recoveryMode]);


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await onSignIn(email, password);
        if (error) setError(error);
      } else {
        if (!businessName.trim() || !whatsapp.trim()) {
          setError('Preencha todos os campos do cadastro.');
          setLoading(false);
          return;
        }
        if (personType === 'PF' ? !isValidCpf(document) : !isValidCnpj(document)) {
          setError(`Informe um ${personType === 'PF' ? 'CPF' : 'CNPJ'} válido.`);
          return;
        }
        const result = await onSignUp({ businessName, whatsapp, email, password, document: normalizeDocument(document), personType });
        if (result.error) setError(result.error);
        else if (result.needsEmailConfirmation) {
          setSignupInfo('Confira seu e-mail para confirmar a conta. Depois, faça login para concluir o cadastro.');
          setPassword('');
          setMode('login');
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível concluir a autenticação.');
    } finally {
      setLoading(false);
    }
  }

  function startRecovery() {
    setShowRecovery(true);
    setRecoveryStep('identify');
    setRecoveryEmail('');
    setNewPassword('');
    setRecoveryDone(false);
    setPasswordUpdated(false);
    setError(null);
  }

  async function sendRecoveryLink() {
    setError(null);
    setLoading(true);
    try {
      const result = await onRequestPasswordReset(recoveryEmail);
      if (result.error) { setError(result.error); return; }
      setPasswordUpdated(false);
      setRecoveryDone(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível solicitar o link.');
    } finally {
      setLoading(false);
    }
  }

  async function completeRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await onUpdatePassword(newPassword);
      if (result.error) { setError(result.error); return; }
      setRecoveryDone(true);
      setPasswordUpdated(true);
      setRecoveryStep('identify');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível alterar a senha.');
    } finally {
      setLoading(false);
    }
  }

  function closeRecovery() {
    setShowRecovery(false);
    setRecoveryStep('identify');
    setError(null);
  }

  const inputClass =
    'w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center px-4 py-12">
      <button
        onClick={onBack}
        className="self-start mb-6 flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition"
      >
        <ArrowLeft size={18} /> Voltar ao início
      </button>

      <div className="w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500 text-white">
              <Building2 size={22} />
            </span>
            <span className="text-2xl font-bold text-white">
              Distri<span className="text-cyan-400">Hub</span>
            </span>
          </div>
          <h2 className="text-xl font-semibold text-white text-center">
            {mode === 'login' ? 'Acesse seu painel' : 'Crie sua conta de lojista'}
          </h2>
          <p className="text-sm text-slate-400 text-center mt-1">
            {mode === 'login'
              ? 'Entre com suas credenciais para gerenciar seu negócio.'
              : 'Preencha os dados da sua empresa para começar a usar o ERP.'}
          </p>
        </div>

        <div className="flex gap-2 mb-6 bg-slate-800 rounded-lg p-1">
          <button
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              mode === 'login'
                ? 'bg-cyan-500 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => { setMode('login'); setError(null); }}
          >
            Entrar
          </button>
          <button
            className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
              mode === 'signup'
                ? 'bg-cyan-500 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
            onClick={() => { setMode('signup'); setError(null); }}
          >
            Cadastrar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
          {mode === 'signup' && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-300">Tipo de cadastro</span>
                <select aria-label="Tipo de cadastro" className={inputClass} value={personType}
                  onChange={event => { setPersonType(event.target.value as 'PF' | 'PJ'); setDocument(''); setError(null); }}>
                  <option value="PF">Pessoa física — CPF</option>
                  <option value="PJ">Pessoa jurídica — CNPJ</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-300">{personType === 'PF' ? 'CPF' : 'CNPJ'}</span>
                <input aria-label={personType === 'PF' ? 'CPF' : 'CNPJ'} className={inputClass} inputMode="numeric"
                  value={personType === 'PF' ? formatCpf(document) : formatCnpj(document)}
                  onChange={event => setDocument(normalizeDocument(event.target.value).slice(0, personType === 'PF' ? 11 : 14))}
                  placeholder={personType === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  maxLength={personType === 'PF' ? 14 : 18} required />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Building2 size={15} /> {personType === 'PF' ? 'Nome completo / nome da loja' : 'Nome da empresa / razão social'}
                </span>
                <input
                  className={inputClass}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Nome da sua empresa"
                  required
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Phone size={15} /> WhatsApp
                </span>
                <input
                  className={inputClass}
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="(11) 99999-9999"
                  required
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <Mail size={15} /> E-mail
            </span>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <Lock size={15} /> Senha
            </span>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {signupInfo && <p role="status" className="text-sm text-green-400">{signupInfo}</p>}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition"
          >
            {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        {mode === 'login' && (
          <div className="text-center mt-3">
            <button
              onClick={startRecovery}
              className="text-sm text-slate-400 hover:text-cyan-400 transition font-medium"
            >
              Esqueci minha senha
            </button>
          </div>
        )}

        <div className="text-center text-sm text-slate-400 mt-6">
          {mode === 'login' ? (
            <>Não tem conta? <button onClick={() => { setMode('signup'); setError(null); }} className="text-cyan-400 hover:text-cyan-300 font-medium">Cadastre-se</button></>
          ) : (
            <>Já tem conta? <button onClick={() => { setMode('login'); setError(null); }} className="text-cyan-400 hover:text-cyan-300 font-medium">Faça login</button></>
          )}
        </div>
      </div>

      {/* Password Recovery Drawer */}
      {showRecovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closeRecovery}>
          <div
            className="w-full max-w-md mx-4 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
                  <KeyRound size={20} />
                </span>
                <h3 className="text-lg font-semibold text-white">Recuperar Senha</h3>
              </div>
              <button onClick={closeRecovery} className="text-slate-500 hover:text-white transition">
                <ArrowLeft size={20} />
              </button>
            </div>

            {recoveryDone ? (
              <div className="text-center py-6">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 text-green-400 mb-4">
                  <Check size={30} />
                </div>
                <h4 className="text-white font-semibold mb-2">{passwordUpdated ? 'Senha redefinida com sucesso!' : 'Verifique seu e-mail'}</h4>
                <p className="text-sm text-slate-400 mb-6">{passwordUpdated ? 'Sua nova senha foi salva. Faça login para continuar.' : 'Se o e-mail estiver cadastrado, você receberá um link seguro para redefinir sua senha.'}</p>
                <button
                  onClick={() => { setShowRecovery(false); setRecoveryDone(false); setMode('login'); }}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-lg transition"
                >
                  Voltar para o login
                </button>
              </div>
            ) : recoveryStep === 'identify' ? (
              <div className="space-y-4">
                {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
                <p className="text-sm text-slate-400">
                  Informe o e-mail cadastrado. Enviaremos um link seguro para redefinir sua senha.
                </p>
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <Mail size={15} /> E-mail cadastrado
                  </span>
                  <input
                    type="email"
                    className={inputClass}
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    required
                  />
                </label>
                <button
                  onClick={sendRecoveryLink}
                  disabled={!recoveryEmail.trim() || loading}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Mail size={18} /> Enviar link por e-mail
                </button>
              </div>
            ) : recoveryStep === 'reset' ? (
              <form onSubmit={completeRecovery} className="space-y-4">
                <p className="text-sm text-slate-400">Digite sua nova senha.</p>
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <Lock size={15} /> Nova Senha
                  </span>
                  <input
                    type="password"
                    className={inputClass}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </label>
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-semibold py-3 rounded-lg transition"
                >
                  Alterar senha
                </button>
              </form>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
