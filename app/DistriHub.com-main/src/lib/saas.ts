export type SaasPlanId = 'basico' | 'profissional' | 'enterprise';
export type SaasStatus = 'trial' | 'active' | 'past_due' | 'expired' | 'suspended' | 'cancelled' | 'unavailable';
export type SaasBranchRequest = {
  id: string; company_id: string; extra_branches: number;
  status: 'pending' | 'approved' | 'rejected'; reason: string | null; created_at: string;
};
export type SaasInvoice = {
  id: string; company_id: string; company_name?: string; amount: number;
  status: 'pending' | 'paid' | 'cancelled' | 'cancellation_requested' | 'refunded' | 'charged_back';
  period_start: string; period_end: string; paid_at: string | null; created_at: string;
  provider_payment_id?: string | null; cancellation_reason?: string | null;
};
export type SaasSubscription = {
  company_id: string; company_name?: string; plan_id: SaasPlanId; effective_plan: SaasPlanId;
  billing_mode: 'paid' | 'exempt'; full_access: boolean; status: SaasStatus;
  can_access: boolean; features: string[]; monthly_amount: number; branch_limit: number | null;
  base_monthly_amount?: number; quoted_monthly_amount?: number; authorized_monthly_amount?: number | null;
  included_branches?: number; branch_count?: number; device_limit?: number;
  extra_branches?: number; courtesy_branches?: number; funded_extra_branches?: number; extra_branch_amount?: number;
  branch_requests?: SaasBranchRequest[];
  trial_ends_at: string; paid_until: string | null; admin_access_until: string | null; grace_until?: string | null;
  next_billing_at: string | null; auto_renew: boolean; provider_cancel_pending: boolean;
  provider_subscription_id: string | null; provider_status: string | null;
  invoices?: SaasInvoice[];
  plans?: { id: SaasPlanId; name: string; monthly_amount: number; features: string[] }[];
};
export type SaasOverview = {
  branch_requests?: SaasBranchRequest[];
  subscriptions: SaasSubscription[]; invoices: SaasInvoice[];
  jobs: { id: string; company_id: string; kind: string; status: string; last_error: string | null }[];
};
export const saasStatusLabels: Record<SaasStatus, string> = {
  trial: 'Período de teste', active: 'Ativa', past_due: 'Pagamento em atraso', expired: 'Acesso vencido',
  suspended: 'Suspensa', cancelled: 'Cancelada', unavailable: 'Indisponível',
};
export const saasInvoiceLabels: Record<SaasInvoice['status'], string> = {
  pending: 'Pendente', paid: 'Paga', cancelled: 'Cancelada', cancellation_requested: 'Cancelamento em processamento',
  refunded: 'Estornada', charged_back: 'Contestada',
};
export function canUseSaasFeature(subscription: SaasSubscription | null, feature: string): boolean {
  if (feature === 'configuracoes' || feature === 'suporte') return true;
  return subscription?.can_access === true && (feature === 'atendimento' || subscription.features.includes(feature));
}
export function saasAccessDateForInput(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : '';
}
export { mercadoPagoCheckoutUrl } from '../../supabase/functions/_shared/mercadoPago.ts';
