import type { User } from '@supabase/supabase-js';
import type { PartnerIdentity, SalespersonRole } from '../types';
import { supabase } from './supabase';

export type PinOperator = {
  id: string; name: string; branchId: string; role: SalespersonRole; pin: string;
  canAccessAllBranches?: boolean;
  allowedBranches?: { id: string; name: string }[];
  sessionExpiresAt?: string;
};
export type PartnerAccess = { kind: 'owner' } | { kind: 'employee'; operator: PinOperator };
const roles = ['administrador', 'gerente', 'caixa', 'vendedor', 'tecnico', 'atendente', 'logistica'];

// Only retry reads using an existing opaque session; never replay PIN attempts.
async function readOperatorSession<T extends { error: { message?: string; code?: string } | null; status?: number }>(credential: string, read: () => PromiseLike<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const result = await read();
    const message = result.error?.message?.toLowerCase() ?? '';
    const temporary = message.includes('jwt issued at future') || message.includes('failed to fetch')
      || message.includes('networkerror') || (result.status !== undefined && result.status >= 500);
    if (!credential.startsWith('ops_') || !result.error || !temporary || attempt >= 2) return result;
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
}

export async function authorizePin(identity: PartnerIdentity, id: string, name: string, pin: string, requestedBranchId: string | null = null): Promise<PartnerAccess> {
  if (!supabase || !id || !/^(?:\d{4,8}|ops_[0-9a-f]{64})$/.test(pin)) throw new Error('Selecione o colaborador e informe o PIN de 4 a 8 dígitos.');
  const client = supabase;
  const { data, error } = await readOperatorSession(pin, () => client.rpc('resolve_partner_pdv_operator', {
    p_salesperson_id: id, p_pin: pin, p_requested_branch_id: requestedBranchId,
  }));
  const operator = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || !operator || operator.salesperson_id !== id || operator.company_id !== identity.companyUserId
    || typeof operator.branch_id !== 'string' || !operator.branch_id || !roles.includes(operator.role)) {
    throw new Error('PIN incorreto ou colaborador sem acesso a uma filial.');
  }
  if (requestedBranchId && operator.branch_id !== requestedBranchId) throw new Error('Filial não autorizada.');
  const { data: scope, error: scopeError } = await readOperatorSession(pin, () => client.rpc('read_partner_operator_branch_access', { p_salesperson_id: id, p_pin: pin }));
  const branches = scope?.branches;
  const canAccessAllBranches = scope?.can_access_all_branches === true && ['administrador','gerente'].includes(operator.role);
  if (scopeError || !Array.isArray(branches) || !branches.every(branch => typeof branch.id === 'string' && typeof branch.name === 'string')
    || !branches.some(branch => branch.id === operator.branch_id)) throw new Error('Não foi possível confirmar as filiais autorizadas.');
  if (identity.salespersonId && (identity.salespersonId !== id || (!canAccessAllBranches && identity.branchId !== operator.branch_id))) {
    throw new Error('Este acesso pertence a outro colaborador.');
  }
  return { kind: 'employee', operator: { id, name, pin, branchId: operator.branch_id, role: operator.role, canAccessAllBranches, allowedBranches: branches } };
}

export async function rememberOperatorAccess(access: PartnerAccess): Promise<PartnerAccess> {
  if (access.kind !== 'employee' || access.operator.pin.startsWith('ops_') || !supabase) return access;
  const { data, error } = await supabase.rpc('create_partner_operator_session', {
    p_salesperson_id: access.operator.id, p_pin: access.operator.pin,
  });
  if (error || !data || !/^ops_[0-9a-f]{64}$/.test(data.credential)
    || typeof data.expires_at !== 'string' || !(Date.parse(data.expires_at) > Date.now())) return access;
  return { kind: 'employee', operator: { ...access.operator, pin: data.credential, sessionExpiresAt: data.expires_at } };
}
export async function revokeOperatorSession(credential: string) {
  if (credential.startsWith('ops_') && supabase) {
    const { error } = await supabase.rpc('revoke_partner_operator_session', { p_credential: credential });
    if (error) throw error;
  }
}

export async function authorizeOwner(identity: PartnerIdentity, user: User | null, password: string): Promise<PartnerAccess> {
  if (!user?.email || identity.salespersonId || identity.authUserId !== identity.companyUserId
    || user.id !== identity.companyUserId || !password) throw new Error('Confirme a senha da conta do proprietário.');
  if (!supabase) throw new Error('Serviço indisponível.');
  const { data, error } = await supabase.rpc('verify_partner_owner_password', { p_password: password });
  if (error || data !== true) throw new Error('Senha da Área do proprietário incorreta ou acesso temporariamente bloqueado por tentativas.');
  return { kind: 'owner' };
}
