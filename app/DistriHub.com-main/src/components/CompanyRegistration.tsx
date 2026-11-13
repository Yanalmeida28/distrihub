import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const fields = [
  ['legal_name', 'Razão social'], ['trade_name', 'Nome fantasia'],
  ['state_registration', 'Inscrição estadual'], ['municipal_registration', 'Inscrição municipal'],
  ['address', 'Logradouro'], ['address_number', 'Número'], ['complement', 'Complemento'],
  ['neighborhood', 'Bairro'], ['city', 'Cidade'], ['state', 'UF'], ['zip_code', 'CEP'],
] as const;
type Registration = Record<string, string>;
type Snapshot = { business_name: string; document: string | null; registration: Registration };
const regimes: Record<string, string> = { '1': 'Simples Nacional', '2': 'Simples Nacional — excesso de sublimite', '3': 'Regime normal', '4': 'MEI' };

function draftOf(data: Snapshot): Registration {
  const entries = Object.entries(data.registration ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return { legal_name: data.business_name ?? '', ...Object.fromEntries(entries) };
}

export function CompanyRegistration({ companyId, readOnly = false, onSaved }: {
  companyId: string; readOnly?: boolean; onSaved?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Registration>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const guard = useRef(false);
  const generation = useRef(0);
  const dirty = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    dirty.current = false; guard.current = false;
    setSnapshot(null); setDraft({}); setNotice(null); setError(null); setSaving(false);
    async function load() {
      if (!supabase) { setLoading(false); setError('Conexão indisponível.'); return; }
      if (dirty.current && !readOnly) return;
      setLoading(true);
      try {
        const { data, error: failure } = await supabase.rpc('get_company_registration', { p_company_id: companyId });
        if (cancelled || generation.current !== current) return;
        if (failure) throw failure;
        if (!data || typeof data !== 'object') throw new Error('Cadastro da empresa não encontrado.');
        if (dirty.current && !readOnly) return;
        setSnapshot(data as Snapshot); setDraft(draftOf(data as Snapshot)); setError(null);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o cadastro da empresa.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('company-registration-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true; generation.current = current + 1;
      window.removeEventListener('company-registration-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [companyId, readOnly]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !snapshot || guard.current || readOnly) return;
    guard.current = true;
    const current = generation.current;
    setSaving(true); setError(null); setNotice(null);
    try {
      const { data, error: failure } = await supabase.rpc('save_company_registration', {
        p_company_id: companyId, p_registration: draft, p_expected_registration: snapshot.registration,
      });
      if (generation.current !== current) return;
      if (failure) {
        if (failure.code === '40001') throw new Error('O cadastro foi alterado em outra tela. Reabra a ficha para carregar os dados atuais antes de salvar.');
        throw new Error(failure.message ?? 'Não foi possível salvar o cadastro.');
      }
      if (!data || typeof data !== 'object') throw new Error('O servidor não confirmou a gravação.');
      setSnapshot(data as Snapshot); setDraft(draftOf(data as Snapshot)); dirty.current = false;
      setNotice('Cadastro da empresa salvo. Os dados estão disponíveis na área fiscal.');
      window.dispatchEvent(new Event('company-registration-updated'));
      onSaved?.();
    } catch (failure) {
      if (generation.current === current) setError(failure instanceof Error ? failure.message : 'Não foi possível salvar o cadastro.');
    } finally {
      if (generation.current === current) { guard.current = false; setSaving(false); }
    }
  }

  function change(key: string, value: string) {
    dirty.current = true; setNotice(null); setDraft(previous => ({ ...previous, [key]: value }));
  }
  return <section className="module-card" aria-label="Cadastro da empresa">
    <h4>Dados cadastrais da empresa</h4>
    <p>{readOnly ? 'Dados salvos no cadastro da empresa. Para alterar, acesse Configurações → Dados cadastrais da empresa.'
      : 'Preencha uma vez para consultar nas configurações, no Super Admin e na área fiscal. O endereço de cada filial permanece no cadastro de filiais.'}</p>
    {loading && <p role="status">Carregando cadastro…</p>}
    {error && <p role="alert">{error}</p>}
    {snapshot && (readOnly ? <dl className="admin-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14, overflowWrap: 'anywhere' }}>
      <div><dt>CNPJ / CPF</dt><dd>{snapshot.document || 'Não informado'}</dd></div>
      {fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{draft[key] || 'Não informado'}</dd></div>)}
      <div><dt>Regime tributário</dt><dd>{regimes[draft.tax_regime] || 'Não informado'}</dd></div>
    </dl> : <form className="rma-form" onSubmit={save}>
      <p>CNPJ / CPF: {snapshot.document || 'Não informado'}. O documento é o mesmo do perfil da conta.</p>
      <div className="form-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
        {fields.map(([key, label]) => <label key={key} style={{ minWidth: 0, flex: '1 1 220px' }}>{label}
          <input required={key === 'legal_name'} maxLength={key === 'state' ? 2 : key === 'zip_code' ? 9 : 160}
            autoComplete={key === 'zip_code' ? 'postal-code' : key === 'city' ? 'address-level2' : undefined}
            value={draft[key] ?? ''} disabled={saving || loading}
            onChange={event => change(key, key === 'state' ? event.target.value.toUpperCase() : event.target.value)} />
        </label>)}
        <label style={{ minWidth: 0, flex: '1 1 220px' }}>Regime tributário<select value={draft.tax_regime ?? ''} disabled={saving || loading} onChange={event => change('tax_regime', event.target.value)}>
          <option value="">Selecione conforme o cadastro da empresa</option>
          {Object.entries(regimes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <p>Informe as inscrições e o regime conforme a contabilidade. Os dados da Focus devem corresponder a este cadastro; salvar aqui não altera automaticamente o cadastro na Focus.</p>
      <button type="submit" className="module-submit-btn" disabled={saving || loading}>{saving ? 'Salvando…' : 'Salvar cadastro da empresa'}</button>
    </form>)}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
