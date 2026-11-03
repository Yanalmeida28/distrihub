import type { PartnerIdentity, SalespersonRole } from '../types';

export function canTransferCompanyData(
  identity: PartnerIdentity | null,
  accessLocked: boolean,
  deviceReady: boolean,
  operator: { role: SalespersonRole; is_active: boolean } | null,
): boolean {
  if (!identity || accessLocked || !deviceReady) return false;
  if (!identity.salespersonId) return identity.authUserId === identity.companyUserId;
  return operator?.is_active === true && operator.role === 'administrador';
}
