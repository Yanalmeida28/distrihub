export function numericCnpj(value: string) { return value.replace(/[.\s/-]/g, ''); }

export function canLookupCnpj(value: string): boolean {
  const digits = numericCnpj(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const check = (base: string) => {
    let weight = base.length - 7, sum = 0;
    for (const digit of base) { sum += Number(digit) * weight--; if (weight < 2) weight = 9; }
    const remainder = sum % 11; return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = check(digits.slice(0,12));
  return first === Number(digits[12]) && check(digits.slice(0,12) + first) === Number(digits[13]);
}

export async function lookupCnpj(value: string, request: typeof fetch = fetch): Promise<Record<string, string>> {
  const cnpj = numericCnpj(value);
  if (!canLookupCnpj(cnpj)) throw new Error('Informe um CNPJ numérico válido com 14 dígitos para consultar.');
  let response: Response;
  try {
    response = await request(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    });
  } catch { throw new Error('A consulta de CNPJ está indisponível. Tente novamente ou preencha os dados manualmente.'); }
  if (!response.ok) throw new Error(response.status === 404 ? 'CNPJ não encontrado na base de consulta.'
    : response.status === 429 ? 'Limite de consultas atingido. Aguarde antes de tentar novamente.' : 'Não foi possível consultar o CNPJ. Você pode preencher manualmente.');
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || numericCnpj(String(data.cnpj ?? '')) !== cnpj || typeof data.razao_social !== 'string' || !data.razao_social.trim()) {
    throw new Error('A consulta retornou dados inválidos ou de outro CNPJ. Nenhum campo foi alterado.');
  }
  const result: Record<string,string> = {};
  const mapping: Record<string,string> = { legal_name: 'razao_social', trade_name: 'nome_fantasia', address: 'logradouro',
    address_number: 'numero', complement: 'complemento', neighborhood: 'bairro', city: 'municipio', state: 'uf', zip_code: 'cep' };
  for (const [key, source] of Object.entries(mapping)) {
    if (typeof data[source] === 'string' && data[source].trim()) result[key] = data[source].trim().slice(0,160);
  }
  if (result.zip_code) { result.zip_code = result.zip_code.replace(/\D/g,''); if (!/^\d{8}$/.test(result.zip_code)) delete result.zip_code; }
  if (result.state) { result.state = result.state.toUpperCase(); if (!/^[A-Z]{2}$/.test(result.state)) delete result.state; }
  if (result.address && typeof data.descricao_tipo_de_logradouro === 'string') {
    const type = data.descricao_tipo_de_logradouro.trim();
    if (type && !result.address.toUpperCase().startsWith(type.toUpperCase() + ' ')) result.address = `${type} ${result.address}`.slice(0,160);
  }
  // Regime e inscrições não são deduzidos de CNAE, porte, MEI ou opção pelo Simples.
  return result;
}
