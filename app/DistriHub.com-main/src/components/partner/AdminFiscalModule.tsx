import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle, Check, FileCheck, FileText, Plus, RefreshCw, Save, X,
} from 'lucide-react';
import type { PartnerBranch, PartnerSale } from '../../types';
import { money } from '../../utils';
import { supabase } from '../../lib/supabase';
import {
  getFiscalEvents,
  getFiscalSettings,
  requestFiscalCancellation,
  saveFiscalSettings,
  type FiscalDocumentRecord,
  type FiscalSettingsRecord,
} from '../../services/fiscalService';

type FiscalSection = 'emitir' | 'regras' | 'historico-notas' | 'inutilizacao';

type InutilizationRecord = {
  id: string;
  document_type: string;
  series: string;
  number_start: number;
  number_end: number;
  justification: string;
  status: string;
  protocol: string | null;
  created_at: string;
  branch_id: string | null;
};

type Props = {
  section: string;
  userId?: string;
  branchId: string | null;
  sales: PartnerSale[];
  branches: PartnerBranch[];
  ownerView: boolean;
};

const emptyRule: FiscalSettingsRecord = {
  name: '',
  ncm: '',
  cfop: '',
  cst_csosn: '',
  icms_rate: 0,
  pis_rate: 0,
  cofins_rate: 0,
  active: true,
  apply_to_nfe: false,
  origin: '', unit: '', pis_cst: '', cofins_cst: '',
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function formatStatus(value?: string) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    processing: 'Em processamento',
    authorized: 'Autorizado',
    rejected: 'Rejeitado',
    cancelled: 'Cancelado',
  };
  return labels[value ?? ''] ?? value ?? '—';
}

export function AdminFiscalModule({ section, userId, branchId, sales, branches, ownerView }: Props) {
  const [rules, setRules] = useState<FiscalSettingsRecord[]>([]);
  const [documents, setDocuments] = useState<FiscalDocumentRecord[]>([]);
  const [inutilizations, setInutilizations] = useState<InutilizationRecord[]>([]);
  const [ruleDraft, setRuleDraft] = useState<FiscalSettingsRecord>(emptyRule);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [documentType, setDocumentType] = useState<'nfe' | 'nfce'>('nfe');
  const [series, setSeries] = useState('001');
  const [number, setNumber] = useState('');
  const [numberStart, setNumberStart] = useState('');
  const [numberEnd, setNumberEnd] = useState('');
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const completedSales = useMemo(
    () => sales.filter((sale) => sale.status === 'concluida'),
    [sales],
  );

  const loadSection = useCallback(async () => {
    if (!userId || (!branchId && !ownerView)) {
      setRules([]);
      setDocuments([]);
      setInutilizations([]);
      return;
    }
    if (!supabase) {
      setError('Conexão com o banco de dados indisponível.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (section === 'regras') {
        const { data, error: queryError } = await getFiscalSettings(userId, branchId);
        if (queryError) throw queryError;
        setRules((data ?? []) as FiscalSettingsRecord[]);
      } else if (section === 'historico-notas') {
        const { data, error: queryError } = await getFiscalEvents(userId, branchId);
        if (queryError) throw queryError;
        setDocuments((data ?? []) as FiscalDocumentRecord[]);
      } else if (section === 'inutilizacao') {
        let query = supabase
          .from('fiscal_inutilizations')
          .select('id, document_type, series, number_start, number_end, justification, status, protocol, created_at, branch_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (branchId) query = query.eq('branch_id', branchId);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        setInutilizations((data ?? []) as InutilizationRecord[]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados fiscais.');
    } finally {
      setLoading(false);
    }
  }, [branchId, ownerView, section, userId]);

  useEffect(() => {
    void loadSection();
  }, [loadSection]);

  async function handleSaveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const ruleBranchId = editingRuleId ? ruleDraft.branch_id ?? branchId : branchId;
    if (!userId || !ruleBranchId) {
      setError('Selecione uma filial para salvar a regra fiscal.');
      return;
    }
    if (!ruleDraft.name?.trim() || !ruleDraft.cfop?.trim() || !ruleDraft.cst_csosn?.trim()) {
      setError('Preencha o nome, o CFOP e o CST/CSOSN.');
      return;
    }
    const rates = [ruleDraft.icms_rate, ruleDraft.pis_rate, ruleDraft.cofins_rate];
    if (ruleDraft.apply_to_nfe && (!/^\d{8}$/.test(ruleDraft.ncm ?? '') || !/^5\d{3}$/.test(ruleDraft.cfop ?? '') ||
      !['102', '103', '300', '400'].includes(ruleDraft.cst_csosn ?? '') || rates.some(rate => rate == null || Number(rate) !== 0) ||
      !/^[0-8]$/.test(ruleDraft.origin ?? '') || !/^[A-Z0-9]{1,6}$/.test(ruleDraft.unit ?? '') ||
      !['04', '06', '07', '08', '09'].includes(ruleDraft.pis_cst ?? '') || !['04', '06', '07', '08', '09'].includes(ruleDraft.cofins_cst ?? ''))) {
      setError('Para NF-e de teste, informe NCM com 8 dígitos, CFOP interno iniciado em 5, origem, unidade e CST de PIS/COFINS. Esta etapa aceita CSOSN 102, 103, 300 ou 400, CST de PIS/COFINS 04, 06, 07, 08 ou 09 e alíquotas zero, conforme revisão contábil.');
      return;
    }
    if (rates.some((rate) => !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100)) {
      setError('As alíquotas devem estar entre 0 e 100%.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: saveError } = await saveFiscalSettings(userId, ruleBranchId, {
        ...ruleDraft,
        branch_id: ruleBranchId,
        id: editingRuleId ?? undefined,
        name: ruleDraft.name.trim(),
        ncm: ruleDraft.ncm?.trim() || null,
        cfop: ruleDraft.cfop?.trim(),
        cst_csosn: ruleDraft.cst_csosn?.trim(),
        icms_rate: Number(ruleDraft.icms_rate ?? 0),
        pis_rate: Number(ruleDraft.pis_rate ?? 0),
        cofins_rate: Number(ruleDraft.cofins_rate ?? 0),
      });
      if (saveError) {
        if (saveError.code === '23505') throw new Error('Já existe uma regra ativa para este NCM na filial. Edite ou desative a regra existente.');
        throw saveError;
      }
      setRuleDraft(emptyRule);
      setEditingRuleId(null);
      setNotice(editingRuleId ? 'Regra tributária atualizada.' : 'Regra tributária salva.');
      await loadSection();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a regra tributária.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function toggleRule(rule: FiscalSettingsRecord) {
    if (savingRef.current) return;
    const ruleBranchId = rule.branch_id ?? branchId;
    if (!userId || !ruleBranchId || !rule.id) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: saveError } = await saveFiscalSettings(userId, ruleBranchId, {
        ...rule,
        branch_id: ruleBranchId,
        active: rule.active === false,
      });
      if (saveError) throw saveError;
      setNotice(rule.active === false ? 'Regra fiscal ativada.' : 'Regra fiscal desativada.');
      await loadSection();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar a regra tributária.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleEmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const sale = completedSales.find((item) => item.id === selectedSaleId);
    if (!sale || !branchId) {
      setError('Selecione uma venda concluída e uma filial.');
      return;
    }
    if (!supabase) {
      setError('Conexão com o banco de dados indisponível.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: emitError } = await supabase.rpc('record_fiscal_document', {
        p_document_id: null,
        p_document_type: documentType,
        p_status: 'pending',
        p_document_number: number.trim() || null,
        p_access_key: null,
        p_payload: {
          branch_id: branchId,
          sale_id: sale.id,
          series: series.trim(),
          items: sale.items,
          total: sale.total,
          customer_name: sale.customer_name,
          emission_requested_from: 'administrativo',
        },
      });
      if (emitError) throw emitError;
      setNotice('Solicitação registrada como pendente. A nota ainda não foi transmitida nem autorizada pela SEFAZ: o provedor fiscal e o certificado não estão configurados.');
      setSelectedSaleId('');
      setNumber('');
    } catch (emitError) {
      setError(emitError instanceof Error ? emitError.message : 'Não foi possível registrar a solicitação fiscal.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleCreateInutilization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const start = Number(numberStart);
    const end = Number(numberEnd);
    if (!supabase || !branchId) {
      setError('Selecione uma filial e verifique a conexão com o banco.');
      return;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      setError('Informe uma faixa numérica válida.');
      return;
    }
    if (justification.trim().length < 15) {
      setError('A justificativa deve ter pelo menos 15 caracteres.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: createError } = await supabase.rpc('create_fiscal_inutilization', {
        p_data: {
          branch_id: branchId,
          document_type: documentType,
          series: series.trim(),
          number_start: start,
          number_end: end,
          justification: justification.trim(),
        },
      });
      if (createError) throw createError;
      setNotice('Solicitação de inutilização salva como pendente. Ela ainda precisa ser enviada à SEFAZ pelo provedor fiscal.');
      setNumberStart('');
      setNumberEnd('');
      setJustification('');
      await loadSection();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Não foi possível registrar a inutilização.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleCancellation(document: FiscalDocumentRecord) {
    if (savingRef.current) return;
    if (!userId || !document.id) return;
    const reason = window.prompt('Informe a justificativa para solicitar o cancelamento:');
    if (reason === null) return;
    if (reason.trim().length < 15) {
      setError('A justificativa deve ter pelo menos 15 caracteres.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const documentBranchId = document.branch_id ?? branchId;
      if (!documentBranchId) throw new Error('Filial do documento fiscal não identificada.');
      const { error: cancelError } = await requestFiscalCancellation(userId, document.id, documentBranchId, reason.trim());
      if (cancelError) throw cancelError;
      setNotice('Solicitação de cancelamento registrada. O status não muda até processamento autorizado pelo provedor fiscal.');
      await loadSection();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Não foi possível registrar o cancelamento.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!branchId && !ownerView) {
    return (
      <div className="pdv-restricted-checkout" role="alert">
        <AlertCircle size={16} />
        <span>Selecione uma filial no Administrativo para acessar as opções fiscais.</span>
      </div>
    );
  }

  return (
    <div className="admin-inline-fiscal">
      <div className="admin-permissions-info">
        <FileText size={16} />
        <span>
          {sectionTitle(section)} — {branchId ? `filial ${branches.find((branch) => branch.id === branchId)?.name ?? 'selecionada'}` : 'visão consolidada de todas as filiais'}.
          {ownerView && !branchId && ' Para registrar ou editar dados, selecione uma filial no seletor do Administrativo.'}
          {' '}Solicitações fiscais ficam pendentes até integração com um provedor autorizado.
        </span>
        <button type="button" className="module-action-btn" onClick={() => void loadSection()} disabled={loading || saving}>
          <RefreshCw size={15} /> Atualizar
        </button>
      </div>

      {error && <p className="otp-error-msg" role="alert">{error}</p>}
      {notice && <p className="sent-message" role="status"><Check size={15} /> {notice}</p>}
      {loading && <p role="status">Carregando dados fiscais…</p>}

      {section === 'emitir' && (
        <form className="module-card rma-form" onSubmit={handleEmit}>
          <h4><FileCheck size={17} /> Registrar solicitação de emissão</h4>
          <p className="fiscal-help-text">O DistriHub registra o pedido, mas não transmite documentos à SEFAZ sem provedor e certificado digital configurados.</p>
          <label>
            Venda concluída
            <select required value={selectedSaleId} onChange={(event) => setSelectedSaleId(event.target.value)}>
              <option value="">Selecione uma venda...</option>
              {completedSales.map((sale) => (
                <option key={sale.id} value={sale.id}>
                  #{(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase())} — {sale.customer_name || 'Cliente'} — {money.format(sale.total)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Tipo de documento
              <select value={documentType} onChange={(event) => setDocumentType(event.target.value as 'nfe' | 'nfce')}>
                <option value="nfe">NF-e</option>
                <option value="nfce">NFC-e</option>
              </select>
            </label>
            <label>Série<input value={series} onChange={(event) => setSeries(event.target.value)} required maxLength={3} /></label>
            <label>Número (opcional)<input value={number} onChange={(event) => setNumber(event.target.value)} /></label>
          </div>
          <button className="module-submit-btn" type="submit" disabled={saving || loading || !branchId}>
            <FileCheck size={16} /> {saving ? 'Registrando…' : 'Registrar solicitação pendente'}
          </button>
        </form>
      )}

      {section === 'regras' && (
        <>
          <form className="module-card rma-form" onSubmit={handleSaveRule}>
            <h4>{editingRuleId ? <Save size={17} /> : <Plus size={17} />} {editingRuleId ? 'Editar regra tributária' : 'Nova regra tributária'}</h4>
            <p>Na NF-e de teste, a regra ativa será aplicada aos produtos com este NCM nesta filial, em vendas internas no AM. Confira com o contador se todos esses produtos usam o mesmo enquadramento. O NCM precisa estar cadastrado no produto.</p>
            <label><input type="checkbox" checked={ruleDraft.apply_to_nfe === true} onChange={(event) => setRuleDraft({ ...ruleDraft, apply_to_nfe: event.target.checked })} /> Usar esta regra na NF-e de teste</label>
            {ruleDraft.apply_to_nfe && <div className="form-grid">
              <label>Origem da mercadoria<select required value={ruleDraft.origin ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, origin: event.target.value })}>
                <option value="">Selecione conforme a contabilidade</option>
                <option value="0">0 — Nacional</option><option value="1">1 — Estrangeira, importação direta</option><option value="2">2 — Estrangeira, adquirida no mercado interno</option>
                <option value="3">3 — Nacional, importação superior a 40% e até 70%</option><option value="4">4 — Nacional, processos produtivos básicos</option><option value="5">5 — Nacional, importação até 40%</option>
                <option value="6">6 — Estrangeira, importação direta sem similar nacional</option><option value="7">7 — Estrangeira, mercado interno sem similar nacional</option><option value="8">8 — Nacional, importação superior a 70%</option>
              </select></label>
              <label>Unidade comercial<input required maxLength={6} placeholder="Ex.: UN" value={ruleDraft.unit ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, unit: event.target.value.toUpperCase() })} /></label>
              <label>CST do PIS<input required maxLength={2} placeholder="Conforme a contabilidade" value={ruleDraft.pis_cst ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, pis_cst: event.target.value })} /></label>
              <label>CST da COFINS<input required maxLength={2} placeholder="Conforme a contabilidade" value={ruleDraft.cofins_cst ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, cofins_cst: event.target.value })} /></label>
            </div>}
            <div className="form-row">
              <label>Nome da regra<input required value={ruleDraft.name ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} /></label>
              <label>NCM<input value={ruleDraft.ncm ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, ncm: event.target.value })} maxLength={8} /></label>
            </div>
            <div className="form-row">
              <label>CFOP<input required value={ruleDraft.cfop ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, cfop: event.target.value })} maxLength={4} /></label>
              <label>CST/CSOSN<input required value={ruleDraft.cst_csosn ?? ''} onChange={(event) => setRuleDraft({ ...ruleDraft, cst_csosn: event.target.value })} /></label>
              <label>ICMS %<input type="number" min="0" max="100" step="0.0001" value={ruleDraft.icms_rate ?? 0} onChange={(event) => setRuleDraft({ ...ruleDraft, icms_rate: Number(event.target.value) })} /></label>
              <label>PIS %<input type="number" min="0" max="100" step="0.0001" value={ruleDraft.pis_rate ?? 0} onChange={(event) => setRuleDraft({ ...ruleDraft, pis_rate: Number(event.target.value) })} /></label>
              <label>COFINS %<input type="number" min="0" max="100" step="0.0001" value={ruleDraft.cofins_rate ?? 0} onChange={(event) => setRuleDraft({ ...ruleDraft, cofins_rate: Number(event.target.value) })} /></label>
            </div>
            <button className="module-submit-btn" type="submit" disabled={saving || loading || !(editingRuleId ? ruleDraft.branch_id ?? branchId : branchId)}>
              <Save size={16} /> {saving ? 'Salvando…' : editingRuleId ? 'Atualizar regra' : 'Salvar regra'}
            </button>
            {editingRuleId && (
              <button type="button" className="module-action-btn" onClick={() => { setRuleDraft(emptyRule); setEditingRuleId(null); }}>
                <X size={15} /> Cancelar edição
              </button>
            )}
          </form>
          <div className="stock-table-wrap">
            <table className="rma-table">
              <thead><tr>{!branchId && <th>Filial</th>}<th>Nome</th><th>NCM</th><th>CFOP</th><th>CST/CSOSN</th><th>ICMS</th><th>PIS</th><th>COFINS</th><th>Situação</th><th>Ação</th></tr></thead>
              <tbody>
                {rules.length === 0 ? <tr><td colSpan={branchId ? 9 : 10} className="empty-row">Nenhuma regra tributária cadastrada nesta filial.</td></tr> : rules.map((rule) => (
                  <tr key={rule.id}>
                    {!branchId && <td>{branches.find((branch) => branch.id === rule.branch_id)?.name ?? '—'}</td>}
                    <td>{rule.name}</td><td>{rule.ncm || '—'}</td><td>{rule.cfop}</td><td>{rule.cst_csosn}</td>
                    <td>{Number(rule.icms_rate ?? 0).toFixed(2)}%</td><td>{Number(rule.pis_rate ?? 0).toFixed(2)}%</td><td>{Number(rule.cofins_rate ?? 0).toFixed(2)}%</td>
                    <td>{rule.active === false ? 'Inativa' : rule.apply_to_nfe ? 'Ativa — NF-e de teste' : 'Ativa — sem aplicação na NF-e'}</td>
                    <td>
                      <button type="button" className="module-action-btn" onClick={() => { setEditingRuleId(rule.id ?? null); setRuleDraft({ ...rule }); }} disabled={saving || !rule.id}>Editar</button>
                      <button type="button" className="module-action-btn" onClick={() => void toggleRule(rule)} disabled={saving || !rule.id}>{rule.active === false ? 'Ativar' : 'Desativar'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {section === 'historico-notas' && (
        <div className="stock-table-wrap">
          <table className="rma-table">
            <thead><tr><th>Data</th>{!branchId && <th>Filial</th>}<th>Tipo</th><th>Número/Série</th><th>Status</th><th>Chave de acesso</th><th>Detalhes</th><th>Ação</th></tr></thead>
            <tbody>
            {documents.length === 0 ? <tr><td colSpan={branchId ? 7 : 8} className="empty-row">Nenhuma nota fiscal registrada nesta filial.</td></tr> : documents.map((document) => {
                const details = document.provider_response ?? {};
                const documentSeries = document.series || (typeof details.series === 'string' ? details.series : '');
                const cancellationRequested = details.cancellation_requested === true;
                return (
                  <tr key={document.id}>
                    <td>{formatDate(document.created_at)}</td>
                    {!branchId && <td>{branches.find((branch) => branch.id === document.branch_id)?.name ?? '—'}</td>}
                    <td>{document.document_type?.toUpperCase() ?? '—'}</td>
                    <td>{document.number || '—'}{documentSeries ? ` / ${documentSeries}` : ''}</td>
                    <td>{formatStatus(document.status)}{document.provider === 'focus_homologacao' && <small>Homologação — sem valor fiscal</small>}</td>
                    <td>{document.access_key || '—'}</td>
                    <td>{document.rejection_reason || (cancellationRequested ? 'Cancelamento solicitado (aguardando provedor)' : '—')}</td>
                    <td>
                      {document.status === 'authorized' && !cancellationRequested
                        ? <button type="button" className="module-action-btn" onClick={() => void handleCancellation(document)} disabled={saving || (!branchId && !document.branch_id)}>Solicitar cancelamento</button>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {section === 'inutilizacao' && (
        <>
          <form className="module-card rma-form" onSubmit={handleCreateInutilization}>
            <h4><X size={17} /> Solicitar inutilização de numeração</h4>
            <p className="fiscal-help-text">A solicitação é registrada como pendente e precisa de transmissão pelo provedor fiscal.</p>
            <div className="form-row">
              <label>Documento<select value={documentType} onChange={(event) => setDocumentType(event.target.value as 'nfe' | 'nfce')}><option value="nfe">NF-e</option><option value="nfce">NFC-e</option></select></label>
              <label>Série<input value={series} onChange={(event) => setSeries(event.target.value)} required maxLength={3} /></label>
              <label>Número inicial<input type="number" min="1" step="1" required value={numberStart} onChange={(event) => setNumberStart(event.target.value)} /></label>
              <label>Número final<input type="number" min="1" step="1" required value={numberEnd} onChange={(event) => setNumberEnd(event.target.value)} /></label>
            </div>
            <label>Justificativa<textarea required minLength={15} rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} /></label>
            <button className="module-submit-btn" type="submit" disabled={saving || loading || !branchId}>
              <Save size={16} /> {saving ? 'Registrando…' : 'Registrar inutilização'}
            </button>
          </form>
          <div className="stock-table-wrap">
            <table className="rma-table">
              <thead><tr><th>Data</th>{!branchId && <th>Filial</th>}<th>Documento</th><th>Série</th><th>Faixa</th><th>Status</th><th>Protocolo</th><th>Justificativa</th></tr></thead>
              <tbody>
                  {inutilizations.length === 0 ? <tr><td colSpan={branchId ? 7 : 8} className="empty-row">Nenhuma inutilização registrada nesta filial.</td></tr> : inutilizations.map((record) => (
                  <tr key={record.id}>
                      <td>{formatDate(record.created_at)}</td>{!branchId && <td>{branches.find((branch) => branch.id === record.branch_id)?.name ?? '—'}</td>}<td>{record.document_type.toUpperCase()}</td><td>{record.series}</td>
                    <td>{record.number_start}–{record.number_end}</td><td>{formatStatus(record.status)}</td><td>{record.protocol || '—'}</td><td>{record.justification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function sectionTitle(section: string) {
  const titles: Record<FiscalSection, string> = {
    emitir: 'Ativar/Emitir NF-e e NFC-e',
    regras: 'Regras Tributárias',
    'historico-notas': 'Histórico de Notas Emitidas',
    inutilizacao: 'Inutilização de Notas',
  };
  return titles[section as FiscalSection] ?? 'Área Fiscal';
}
