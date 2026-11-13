import { supabase } from '../lib/supabase';
import { buildFiscalCancellationRpcArgs, isFiscalDocumentType } from './fiscalContracts';

export type FiscalDocumentType = 'nfe' | 'nfce';
export type FiscalDocumentStatus = 'pending' | 'processing' | 'authorized' | 'rejected' | 'cancelled';

export type FiscalSettingsRecord = {
  id?: string;
  user_id?: string;
  name: string;
  ncm?: string | null;
  cfop?: string | null;
  cst_csosn?: string | null;
  icms_rate?: number;
  pis_rate?: number;
  cofins_rate?: number;
  active?: boolean;
  apply_to_nfe?: boolean;
  origin?: string | null;
  unit?: string | null;
  pis_cst?: string | null;
  cofins_cst?: string | null;
  branch_id?: string | null;
  created_at?: string;
};

export type FiscalDocumentRecord = {
  id?: string;
  user_id?: string;
  order_id?: string | null;
  provider?: string | null;
  document_type?: FiscalDocumentType | string;
  status?: FiscalDocumentStatus | string;
  series?: string | null;
  number?: string | null;
  access_key?: string | null;
  protocol?: string | null;
  provider_document_id?: string | null;
  xml_url?: string | null;
  pdf_url?: string | null;
  rejection_reason?: string | null;
  provider_response?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  branch_id?: string | null;
};

function assertBranchSelected(branchId: string | null | undefined): asserts branchId is string {
  if (!branchId) {
    throw new Error('Selecione uma filial para continuar.');
  }
}

export async function getFiscalSettings(userId: string, branchId: string | null | undefined) {
  if (!supabase) {
    return { data: [] as FiscalSettingsRecord[], error: null };
  }

  let query = supabase
    .from('fiscal_tax_rules')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (branchId) query = query.eq('branch_id', branchId);
  return query;
}

export async function saveFiscalSettings(
  userId: string,
  branchId: string | null | undefined,
  settings: Partial<FiscalSettingsRecord>,
) {
  assertBranchSelected(branchId);

  if (!supabase) {
    return { data: null, error: null };
  }

  const payload = {
    user_id: userId,
    branch_id: branchId,
    ...settings,
  };

  return supabase.rpc('save_fiscal_branch_settings', { p_settings: payload });
}

export async function listFiscalDocuments(userId: string, branchId: string | null | undefined) {
  assertBranchSelected(branchId);

  if (!supabase) {
    return { data: [] as FiscalDocumentRecord[], error: null };
  }

  return supabase
    .from('fiscal_documents')
    .select('*')
    .eq('user_id', userId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });
}

export async function getFiscalDocument(userId: string, documentId: string, branchId: string | null | undefined) {
  assertBranchSelected(branchId);

  if (!supabase) {
    return { data: null, error: null };
  }

  return supabase
    .from('fiscal_documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', userId)
    .eq('branch_id', branchId)
    .maybeSingle();
}

export async function createFiscalDocument(
  userId: string,
  branchId: string | null | undefined,
  input: Partial<FiscalDocumentRecord> & { document_type: FiscalDocumentType; status?: FiscalDocumentStatus | string; },
) {
  assertBranchSelected(branchId);

  if (!supabase) {
    return { data: null, error: null };
  }

  return supabase.rpc('record_fiscal_document', {
    p_document_id: input.id ?? null,
    p_document_type: input.document_type,
    p_status: input.status ?? 'pending',
    p_document_number: input.number ?? null,
    p_access_key: input.access_key ?? null,
    p_payload: {
      user_id: userId,
      ...(input.provider_response ?? {}),
      order_id: input.order_id ?? null,
      provider: input.provider ?? null,
      series: input.series ?? null,
      protocol: input.protocol ?? null,
      provider_document_id: input.provider_document_id ?? null,
      xml_url: input.xml_url ?? null,
      pdf_url: input.pdf_url ?? null,
      rejection_reason: input.rejection_reason ?? null,
      branch_id: branchId,
    },
  });
}

export async function getFiscalEvents(userId: string, branchId: string | null | undefined) {
  if (!supabase) {
    return { data: [] as FiscalDocumentRecord[], error: null };
  }

  let query = supabase
    .from('fiscal_documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (branchId) query = query.eq('branch_id', branchId);
  const { data, error } = await query;

  if (error) {
    return { data: [], error };
  }

  return { data: data ?? [], error: null };
}

export async function requestFiscalCancellation(
  userId: string,
  documentId: string,
  branchId: string | null | undefined,
  reason?: string,
) {
  assertBranchSelected(branchId);

  if (!supabase) {
    return { data: null, error: null };
  }

  const { data: document, error } = await supabase
    .from('fiscal_documents')
    .select('document_type')
    .eq('id', documentId)
    .eq('user_id', userId)
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!document) return { data: null, error: new Error('Documento fiscal não encontrado nesta filial.') };
  if (!isFiscalDocumentType(document.document_type)) {
    return { data: null, error: new Error('Tipo de documento fiscal inválido; não foi possível solicitar o cancelamento.') };
  }

  return supabase.rpc(
    'record_fiscal_document',
    buildFiscalCancellationRpcArgs(documentId, document.document_type, branchId, reason),
  );
}
