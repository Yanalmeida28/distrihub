import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

type FiscalResult = {
  environment?: string; state?: string; reference?: string; message?: string; configured?: boolean;
  result?: { numero?: string; serie?: string; mensagem_sefaz?: string; message?: string; chave_nfe?: string; caminho_danfe?: string; caminho_xml_nota_fiscal?: string };
};
type Props = { saleId: string; branchId: string; companyId: string; canEmit: boolean; documentType?: 'nfce' | 'nfe' };

const labels: Record<string, string> = {
  authorized: 'NFC-e autorizada em homologação — sem valor fiscal.',
  rejected: 'NFC-e rejeitada no ambiente de homologação.',
  cancelled: 'NFC-e cancelada no ambiente de homologação.',
  processing: 'Há uma consulta ou envio em andamento. Aguarde e consulte esta venda novamente.',
  unknown: 'Resultado ainda não confirmado. Consulte a mesma venda para recuperar a resposta.',
};

export function FocusNfcePanel({ saleId, branchId, companyId, canEmit, documentType = 'nfce' }: Props) {
  const label = documentType === 'nfe' ? 'NF-e' : 'NFC-e';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FiscalResult | null>(null);
  const guard = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; };
  }, []);

  async function request(action: 'status' | 'submit' | 'retry') {
    if (guard.current || !canEmit || !supabase) return;
    guard.current = true;
    const current = generation.current;
    setBusy(true); setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(documentType === 'nfe' ? 'focus-nfe' : 'focus-nfce', { body: { saleId, branchId, action } });
      if (generation.current !== current) return;
      if (invokeError) {
        let message = 'Não foi possível confirmar a resposta fiscal. Consulte esta mesma venda antes de repetir.';
        const context = invokeError.context;
        if (context instanceof Response) {
          const body = await context.json().catch(() => null);
          if (typeof body?.error === 'string') message = body.error;
        }
        if (generation.current === current) setError(message);
        return;
      }
      if (!data || data.environment !== 'homologacao') throw new Error('O servidor não confirmou o ambiente de homologação.');
      setResult(data as FiscalResult);
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error ? failure.message : 'Falha ao consultar a NFC-e.');
    } finally {
      if (generation.current === current) { guard.current = false; setBusy(false); }
    }
  }

  const safeLink = (value?: string) => {
    if (!value) return undefined;
    try { const url = new URL(value); return url.origin === 'https://homologacao.focusnfe.com.br' && !url.username && !url.password ? url.href : undefined; }
    catch { return undefined; }
  };
  return <section className="module-card" aria-label={`Focus ${label} em homologação`}>
    <h4>{label} de teste — Focus / Amazonas</h4>
    <p>Homologação, sem valor fiscal. A primeira etapa aceita vendas no balcão, sem frete, com pagamento em dinheiro ou Pix e classificação fiscal compatível.</p>
    <p>{documentType === 'nfe' ? 'NF-e modelo 55: exige destinatário identificado com endereço completo no AM e regras fiscais revisadas. Não utiliza CSC.' : 'Certificado e CSC devem estar cadastrados no Focus.'} O token fica somente na configuração segura do servidor.</p>
    <details><summary>Identificadores para configuração</summary><p>Empresa: <code>{companyId}</code></p><p>Filial: <code>{branchId}</code></p></details>
    <div className="subscription-actions">
      <button type="button" className="module-action-btn" disabled={busy || !canEmit} onClick={() => { void request('status'); }}>Verificar configuração</button>
      <button type="button" className="module-submit-btn" disabled={busy || !canEmit} onClick={() => { void request('submit'); }}>
        {busy ? 'Consultando…' : `Enviar ou consultar ${label} de teste`}
      </button>
      {result?.state === 'rejected' && <button type="button" className="module-action-btn" disabled={busy || !canEmit} onClick={() => { void request('retry'); }}>Reenviar após correção fiscal</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status">
      <p>{result.state ? (labels[result.state] ?? 'Resultado fiscal pendente de confirmação.').split('NFC-e').join(label) : result.message}</p>
      {result.reference && <p>Referência: {result.reference}</p>}
      {result.result?.mensagem_sefaz && <p>{result.result.mensagem_sefaz}</p>}
      {result.result?.message && <p>{result.result.message}</p>}
      {result.result?.numero && <p>Nota {result.result.numero} / série {result.result.serie}</p>}
      {result.result?.chave_nfe && <p>Chave: {result.result.chave_nfe}</p>}
      {safeLink(result.result?.caminho_danfe) && <p><a href={safeLink(result.result?.caminho_danfe)} target="_blank" rel="noopener noreferrer">Abrir {documentType === 'nfe' ? 'DANFE' : 'DANFC-e'} de homologação</a></p>}
      {safeLink(result.result?.caminho_xml_nota_fiscal) && <p><a href={safeLink(result.result?.caminho_xml_nota_fiscal)} target="_blank" rel="noopener noreferrer">Abrir XML de homologação</a></p>}
    </div>}
  </section>;
}
