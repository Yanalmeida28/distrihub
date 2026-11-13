import { PrinterSettings } from './PrinterSettings';
import { CompanyRegistration } from '../CompanyRegistration';
import { OwnerPasswordSettings } from './OwnerPasswordSettings';
import { useState, type ReactNode } from 'react';
import {
  Settings, User, Mail, Phone, Lock, CreditCard,
  Check, X, Crown, Zap, Building2, Receipt, ArrowUpCircle, ArrowDownCircle,
  Shield, Eye, EyeOff,
} from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { PartnerProfile } from '../../types';
import { supabase } from '../../lib/supabase';
import { money } from '../../utils';
import { SaasBillingModule } from './SaasBillingModule';
import { useSaasSubscription } from '../../hooks/useSaasSubscription';
import { planCatalog } from '../../lib/planCatalog';

type Props = {
  canManageAccount?: boolean;
  canManageOwnerPassword?: boolean;
  user: SupabaseUser | null;
  profile: PartnerProfile | null;
  onProfileUpdate: (profile: Partial<PartnerProfile>) => Promise<unknown>;
  branchManagement?: ReactNode;
  onSubscriptionChanged?: () => void;
};

type Plan = {
  id: string;
  name: string;
  price: number;
  features: string[];
  icon: typeof Crown;
  highlighted?: boolean;
};

const plans: Plan[] = [
  {
    id: 'basico',
    name: 'Básico',
    price: planCatalog.basico.price,
    icon: Building2,
    features: ['1 filial', '3 dispositivos simultâneos por filial', 'PDV, caixa e pedidos', 'Cadastros e histórico', 'Relatórios simples'],
  },
  {
    id: 'profissional',
    name: 'Profissional',
    price: planCatalog.profissional.price,
    icon: Zap,
    highlighted: true,
    features: ['Tudo do Básico', 'Até 3 filiais', '5 dispositivos simultâneos por filial', 'Estoque, financeiro e entregas', 'OS, RMA e fiscal', 'CRM, cupons e relatórios avançados'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: planCatalog.enterprise.price,
    icon: Crown,
    features: ['Tudo do Profissional', 'Até 5 filiais', '8 dispositivos simultâneos por filial', 'Filial adicional por R$ 39,90/mês', 'Suporte prioritário', 'White-label completo'],
  },
];

const planLabels: Record<string, string> = {
  basico: 'Básico',
  profissional: 'Profissional',
  enterprise: 'Enterprise',
};


export function SettingsModule({ user, profile, onProfileUpdate, branchManagement, onSubscriptionChanged, canManageOwnerPassword = false, canManageAccount = true }: Props) {
  const saas = useSaasSubscription(profile?.id);
  const [accountName, setAccountName] = useState(profile?.account_name ?? '');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planRequesting, setPlanRequesting] = useState(false);
  const [planRequestMessage, setPlanRequestMessage] = useState<string | null>(null);
  const [planRequestError, setPlanRequestError] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState<Plan | null>(null);

  const currentPlan = saas.subscription?.effective_plan ?? profile?.subscription_plan ?? 'basico';
  const fullExemption = saas.subscription?.billing_mode === 'exempt' && saas.subscription.full_access;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await onProfileUpdate({
        account_name: accountName || null,
        whatsapp: whatsapp || null,
      });
      window.dispatchEvent(new Event('company-registration-updated'));

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as configurações.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(newPassword: string) {
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }

  async function handlePlanChange(plan: Plan) {
    if (!user || !supabase || planRequesting) return;
    setPlanRequesting(true);
    setPlanRequestMessage(null);
    setPlanRequestError(false);
    try {
      const { error: requestError } = await supabase.rpc('request_partner_plan_change', {
        p_requested_plan: plan.id,
      });
      if (requestError) throw requestError;
      setPlanRequestMessage('Solicitação registrada para análise administrativa. A aprovação atualiza o plano, mas não confirma pagamento.');
      setShowPlanModal(null);
    } catch (requestError) {
      setPlanRequestMessage(requestError instanceof Error ? requestError.message : 'Não foi possível solicitar a mudança de plano.');
      setPlanRequestError(true);
    } finally {
      setPlanRequesting(false);
    }
  }

  if (!canManageAccount) return <div className="panel-module">
    <div className="module-header"><span className="module-icon"><Settings size={20} /></span><div>
      <h3>Configurações do Sistema</h3><p>Configurações de impressão do seu dispositivo</p>
    </div></div>
    <PrinterSettings />
    <p>Senha da conta, assinatura, permissões da equipe e gerenciamento de filiais ficam na Área do proprietário.</p>
  </div>;

  return (
    <div className="panel-module">
      <div className="module-header">
        <span className="module-icon"><Settings size={20} /></span>
        <div>
          <h3>Configurações do Sistema</h3>
          <p>Perfil, segurança e gerenciamento de assinatura</p>
        </div>
      </div>

      <PrinterSettings />

      {/* Profile Section */}
      {branchManagement && <>
        <div className="section-divider">
          <span className="section-divider-label"><Building2 size={14} /> Filiais</span>
        </div>
        {branchManagement}
      </>}

      <div className="section-divider">
        <span className="section-divider-label"><User size={14} /> Perfil da Conta</span>
      </div>

      <div className="module-card">
        <div className="rma-form">
          <label>
            <span className="social-label"><User size={14} /> Nome do Responsável</span>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Seu nome completo"
            />
          </label>
          <label>
            <span className="social-label"><Mail size={14} /> E-mail da Conta</span>
            <input value={user?.email ?? ''} readOnly aria-readonly="true" />
            <small>Este é o e-mail usado para entrar na conta.</small>
          </label>
          <label>
            <span className="social-label"><Phone size={14} /> Telefone / WhatsApp</span>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 99999-9999"
            />
          </label>
        </div>
        <div className="otp-actions">
          <button className="module-submit-btn" onClick={handleSave} disabled={saving}>
            {saved ? <><Check size={16} /> Salvo!</> : saving ? 'Salvando...' : <><Check size={16} /> Salvar Configurações</>}
          </button>
        </div>
        {error && <p className="otp-error-msg" role="alert">{error}</p>}
      </div>

      {/* Security Section */}
      {profile?.id && <CompanyRegistration key={profile.id} companyId={profile.id} />}

      <div className="section-divider">
        <span className="section-divider-label"><Shield size={14} /> Segurança</span>
      </div>

      <div className="module-card security-card">
        <div className="security-info">
          <div className="catalog-toggle-icon"><Lock size={20} /></div>
          <div>
            <strong>Senha de login</strong>
            <small>Senha usada para entrar na conta do aplicativo</small>
          </div>
        </div>
        <button className="rma-advance-btn" onClick={() => setShowPasswordModal(true)}>
          <Lock size={14} /> Alterar senha de login
        </button>
      </div>

      {canManageOwnerPassword && <OwnerPasswordSettings />}

      {/* SaaS Billing Section */}
      <div className="section-divider">
        <span className="section-divider-label"><CreditCard size={14} /> Assinatura & Faturamento</span>
      </div>

      <div className="module-card subscription-card">
        {planRequestMessage && <p role={planRequestError ? 'alert' : 'status'}>{planRequestMessage}</p>}
        {fullExemption && <p>Sua empresa está isenta de cobrança e possui acesso completo aos recursos.</p>}
        <div className="subscription-actions">
          <button className="rma-advance-btn" disabled={fullExemption || saas.loading} onClick={() => setShowPlanModal(plans.find((p) => p.id !== currentPlan) ?? plans[1])}>
            {currentPlan === 'enterprise' ? <><ArrowDownCircle size={14} /> Downgrade Plano</> : <><ArrowUpCircle size={14} /> Upgrade Plano</>}
          </button>
        </div>
      </div>

      {profile?.id && <SaasBillingModule companyId={profile.id} onChanged={() => { void saas.refresh(); onSubscriptionChanged?.(); }} />}

      {/* Plan Cards */}
      <div className="plan-cards-grid">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isCurrent = plan.id === currentPlan;
          return (
            <div key={plan.id} className={`plan-card ${plan.highlighted ? 'highlighted' : ''} ${isCurrent ? 'current' : ''}`}>
              {plan.highlighted && <span className="plan-badge">Mais Popular</span>}
              {isCurrent && <span className="plan-current-badge">Plano Atual</span>}
              <div className="plan-card-icon"><Icon size={24} /></div>
              <strong>{plan.name}</strong>
              <div className="plan-price">
                <span className="plan-price-value">{money.format(plan.price)}</span>
                <span className="plan-price-period">/mês</span>
              </div>
              <ul className="plan-features">
                {plan.features.map((f, i) => (
                  <li key={i}><Check size={13} /> {f}</li>
                ))}
              </ul>
              {!isCurrent && !fullExemption && (
                <button
                  className={`plan-select-btn ${plan.highlighted ? 'primary' : ''}`}
                  onClick={() => setShowPlanModal(plan)}
                >
                  Selecionar {plan.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Invoice History */}
      <div className="section-divider">
        <span className="section-divider-label"><Receipt size={14} /> Histórico de Faturas</span>
      </div>

      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead><tr><th>Fatura</th><th>Data</th><th>Plano</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td colSpan={5}>Nenhuma fatura real registrada.</td></tr>
          </tbody>
        </table>
      </div>

      {/* Password Modal */}
      {showPasswordModal && (
        <PasswordModal
          onClose={() => setShowPasswordModal(false)}
          onSubmit={handlePasswordChange}
        />
      )}

      {/* Plan Change Modal */}
      {showPlanModal && (
        <PlanModal
          plan={showPlanModal}
          currentPlanName={planLabels[currentPlan] ?? currentPlan}
          onClose={() => setShowPlanModal(null)}
          onConfirm={() => { void handlePlanChange(showPlanModal); }}
          submitting={planRequesting}
        />
      )}
    </div>
  );
}

function PasswordModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (pw: string) => Promise<void> }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (newPassword.length < 6) { setError('A senha deve ter no mínimo 6 caracteres.'); return; }
    if (newPassword !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
      await onSubmit(newPassword);
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h4><Lock size={18} /> Alterar senha de login</h4>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {success ? (
          <div className="modal-body">
            <div className="otp-sent-hint" style={{ color: '#5bbc87' }}>
              <Check size={16} /> Senha alterada com sucesso!
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="rma-form">
              <label>
                Nova Senha
                <div className="password-input-wrap">
                  <input
                    type={show ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button type="button" className="password-toggle" onClick={() => setShow(!show)}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <label>
                Confirmar Senha
                <input
                  type={show ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
            </div>
            {error && <div className="otp-sent-hint" style={{ color: '#e6706d' }}>{error}</div>}
            <div className="otp-actions">
              <button className="rma-advance-btn" onClick={onClose}>Cancelar</button>
              <button className="module-submit-btn" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Alterando...' : 'Confirmar Alteração'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanModal({ plan, currentPlanName, onClose, onConfirm, submitting }: { plan: Plan; currentPlanName: string; onClose: () => void; onConfirm: () => void; submitting: boolean }) {
  const Icon = plan.icon;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h4><Icon size={18} /> Confirmar Mudança de Plano</h4>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="plan-modal-summary">
            <div className="plan-modal-row">
              <small>Plano Atual</small>
              <strong>{currentPlanName}</strong>
            </div>
            <div className="plan-modal-arrow">→</div>
            <div className="plan-modal-row">
              <small>Novo Plano</small>
              <strong>{plan.name} — {money.format(plan.price)}/mês</strong>
            </div>
          </div>
          <ul className="plan-features">
            {plan.features.map((f, i) => (
              <li key={i}><Check size={13} /> {f}</li>
            ))}
          </ul>
          <div className="otp-sent-hint">
            Esta solicitação não ativa o plano. A alteração só será aplicada após confirmação do pagamento ou aprovação administrativa.
          </div>
          <div className="otp-actions">
            <button className="rma-advance-btn" onClick={onClose}>Cancelar</button>
            <button className="module-submit-btn" onClick={onConfirm} disabled={submitting}>
              <Check size={16} /> {submitting ? 'Enviando...' : 'Solicitar Mudança'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
