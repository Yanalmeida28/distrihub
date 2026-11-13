import { buildFocusNfce, fiscalAccounts, type FiscalAccount, type FiscalSnapshot } from './focus-nfce.ts';

type Customer = { id: string; user_id: string; branch_id: string; document?: string; address?: string; address_number?: string;
  neighborhood?: string; city?: string; state?: string; zip_code?: string; state_registration?: string; ie_isento?: boolean };
export type NfeAccount = FiscalAccount & {
  nfe_enabled: boolean; issuer_regime: '1';
  customer_policies: Record<string, { final_consumer: '0' | '1'; ie_indicator: '1' | '2' | '9' }>;
};
export type NfeTaxRule = {
  id: string; user_id: string; branch_id: string; active: boolean; apply_to_nfe: boolean;
  ncm: string; cfop: string; cst_csosn: string; icms_rate: number; pis_rate: number; cofins_rate: number;
  origin: string; unit: string; pis_cst: string; cofins_cst: string;
};
export type NfeSnapshot = FiscalSnapshot & { customer?: Customer | null; tax_rules?: NfeTaxRule[] };

// Apenas regras explicitamente habilitadas para esta operação. Nunca escolhe por nome ou pela primeira linha.
export function applyNfeTaxRules(snapshot: NfeSnapshot, account: NfeAccount) {
  const products = { ...account.products };
  const resolved = snapshot.products.map(product => {
    if (product.user_id !== account.company_id || product.branch_id !== account.branch_id) return product;
    const rules = (snapshot.tax_rules ?? []).filter(rule => rule.user_id === account.company_id &&
      rule.branch_id === account.branch_id && rule.active === true && rule.apply_to_nfe === true &&
      /^\d{8}$/.test(product.ncm) && rule.ncm === product.ncm);
    if (rules.length > 1) throw new Error(`Há mais de uma regra tributária ativa para o NCM ${product.ncm} nesta filial.`);
    if (!rules.length) return product;
    const rule = rules[0];
    // A regra habilitada substitui o enquadramento inteiro. Campos incompletos não herdam valores anteriores.
    products[product.id] = { origin: rule.origin, unit: rule.unit, pis_cst: rule.pis_cst, cofins_cst: rule.cofins_cst };
    return { ...product, cfop: rule.cfop, cst_csosn: rule.cst_csosn,
      icms_rate: rule.icms_rate, pis_rate: rule.pis_rate, cofins_rate: rule.cofins_rate };
  });
  return { snapshot: { ...snapshot, products: resolved }, account: { ...account, products } };
}

export function nfeAccounts(raw: string, token = ''): NfeAccount[] {
  const accounts = fiscalAccounts(raw, token, 'nfe') as NfeAccount[];
  if (accounts.some(a => a.nfe_enabled !== true || a.issuer_regime !== '1' || !a.customer_policies || typeof a.customer_policies !== 'object' || Array.isArray(a.customer_policies))) {
    throw new Error('Confirme a habilitação de NF-e no Focus, o regime tributário e as regras de destinatários no servidor.');
  }
  return accounts;
}

function validDocument(value: string): boolean {
  if (!/^\d{11}$|^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const calculate = (digits: string) => {
    let weight = digits.length === 9 ? 10 : digits.length === 10 ? 11 : digits.length === 12 ? 5 : 6;
    let sum = 0;
    for (const digit of digits) { sum += Number(digit) * weight--; if (value.length === 14 && weight < 2) weight = 9; }
    const remainder = sum % 11; return remainder < 2 ? 0 : 11 - remainder;
  };
  const base = value.slice(0, -2);
  const first = calculate(base);
  return first === Number(value.at(-2)) && calculate(base + first) === Number(value.at(-1));
}

export function buildFocusNfe(snapshot: NfeSnapshot, account: NfeAccount, now = new Date()): Record<string, unknown> {
  if (account.nfe_enabled !== true || account.issuer_regime !== '1') throw new Error('Revise a habilitação de NF-e e o regime do emitente.');
  const customer = snapshot.customer;
  if (!customer || customer.user_id !== account.company_id || customer.branch_id !== account.branch_id) throw new Error('Selecione um cliente cadastrado nesta empresa e filial para emitir NF-e.');
  const document = String(customer.document ?? '').replace(/\D/g, '');
  if (!validDocument(document)) throw new Error('Confira o CPF ou CNPJ do destinatário no cadastro do cliente.');
  const policy = account.customer_policies[customer.id];
  if (!policy || !['0', '1'].includes(policy.final_consumer) || !['1', '2', '9'].includes(policy.ie_indicator)) throw new Error('Confira com a contabilidade o indicador de IE e consumidor final do destinatário.');
  const text = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error(`Complete ${label} no cadastro do cliente.`);
    return value.trim();
  };
  const street = text(customer.address, 'o logradouro');
  const number = text(customer.address_number, 'o número do endereço');
  const neighborhood = text(customer.neighborhood, 'o bairro');
  const city = text(customer.city, 'o município');
  if (customer.state?.trim().toUpperCase() !== 'AM' || !/^\d{8}$/.test(String(customer.zip_code ?? '').replace(/\D/g, ''))) throw new Error('Esta homologação inicial exige destinatário no AM e CEP completo.');
  const ie = String(customer.state_registration ?? '').replace(/[^0-9]/g, '');
  if (policy.ie_indicator === '1' && (ie.length < 2 || customer.ie_isento === true)) throw new Error('Confira a inscrição estadual do destinatário contribuinte.');
  if (policy.ie_indicator === '2' && customer.ie_isento !== true) throw new Error('Confirme a isenção da inscrição estadual no cadastro do cliente.');
  const resolved = applyNfeTaxRules(snapshot, account);
  const payload = buildFocusNfce(resolved.snapshot, resolved.account, now, 'nfe');
  return { ...payload, tipo_documento: '1', finalidade_emissao: '1', consumidor_final: policy.final_consumer,
    natureza_operacao: 'VENDA DE MERCADORIA', regime_tributario_emitente: '1',
    nome_destinatario: 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
    ...(document.length === 14 ? { cnpj_destinatario: document } : { cpf_destinatario: document }),
    indicador_inscricao_estadual_destinatario: policy.ie_indicator,
    ...(policy.ie_indicator === '1' ? { inscricao_estadual_destinatario: ie } : {}),
    logradouro_destinatario: street, numero_destinatario: number, bairro_destinatario: neighborhood,
    municipio_destinatario: city, uf_destinatario: 'AM', cep_destinatario: String(customer.zip_code).replace(/\D/g, ''), pais_destinatario: 'Brasil' };
}
