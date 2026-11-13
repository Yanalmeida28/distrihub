import { useEffect, useState } from 'react';
import type { PartnerCustomer } from '../../types';
import { canLookupCnpj, lookupCnpj, numericCnpj } from '../../lib/cnpjLookup';

export function CustomerCnpjLookup({ document, basic = false, disabled = false, onApply }: {
  document: string; basic?: boolean; disabled?: boolean;
  onApply: (data: Partial<PartnerCustomer>, replace: boolean) => void;
}) {
  const [result, setResult] = useState<Record<string,string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [applied, setApplied] = useState(false);
  const cnpj = numericCnpj(document);
  const valid = canLookupCnpj(cnpj);
  useEffect(() => {
    let cancelled = false;
    setResult(null); setError(null); setApplied(false); setBusy(false);
    if (!canLookupCnpj(cnpj)) return;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void lookupCnpj(cnpj).then(data => { if (!cancelled) setResult(data); })
        .catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Falha ao consultar o CNPJ.'); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 650);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [cnpj, retry]);

  function apply(replace: boolean) {
    if (!result || disabled) return;
    const data: Partial<PartnerCustomer> = {};
    if (result.legal_name) data.name = result.legal_name;
    if (result.neighborhood) data.neighborhood = result.neighborhood;
    if (result.city) data.city = result.city;
    if (basic) {
      const address = [result.address, result.address_number, result.complement, result.state, result.zip_code].filter(Boolean).join(', ');
      if (address) data.address = address;
    } else {
      for (const key of ['trade_name','address','address_number','complement','state','zip_code'] as const) {
        if (result[key]) data[key] = result[key];
      }
    }
    onApply(data, replace); setResult(null); setApplied(true);
  }
  if (!valid) return null;
  return <section aria-label="Consulta de CNPJ do cliente" style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    {busy && <p role="status">Consultando CNPJ do cliente…</p>}
    {error && <p role="alert">{error}</p>}
    {!busy && <button type="button" className="module-action-btn" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Consultar CNPJ novamente</button>}
    {result && <>
      <p>Dados encontrados na BrasilAPI. Confira antes de preencher o cadastro:</p>
      <dl>
        <div><dt>Razão social</dt><dd>{result.legal_name}</dd></div>
        {!basic && result.trade_name && <div><dt>Nome fantasia</dt><dd>{result.trade_name}</dd></div>}
        <div><dt>Endereço</dt><dd>{[result.address,result.address_number,result.complement,result.neighborhood,result.city,result.state,result.zip_code].filter(Boolean).join(', ') || 'Não informado'}</dd></div>
      </dl>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
        <button type="button" className="module-action-btn" disabled={disabled} style={{ maxWidth: '100%', whiteSpace: 'normal' }} onClick={() => apply(false)}>Preencher apenas campos vazios</button>
        <button type="button" className="module-action-btn" disabled={disabled} style={{ maxWidth: '100%', whiteSpace: 'normal' }} onClick={() => apply(true)}>Substituir campos consultados</button>
        <button type="button" className="module-action-btn" disabled={disabled} onClick={() => setResult(null)}>Descartar consulta</button>
      </div>
      <p>Confira inscrições e enquadramento fiscal com a contabilidade. A consulta não altera crédito, filial nem permissões do cliente.</p>
    </>}
    {applied && <p role="status">Dados aplicados ao formulário. Confira e salve o cliente para gravar.</p>}
  </section>;
}
