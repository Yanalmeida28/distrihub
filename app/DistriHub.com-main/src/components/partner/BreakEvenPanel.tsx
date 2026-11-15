import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { registeredBreakEven, type BreakEvenSettings, type buildBusinessIntelligence } from '../../lib/businessIntelligence';
import { payableCategories } from '../../lib/accounts';
import { money } from '../../utils';

const categories = ['aluguel', 'energia', 'salarios', 'impostos', 'outros'] as const;
const empty: BreakEvenSettings = { aluguel: '', energia: '', salarios: '', impostos: '', outros: '', desired: 0 };
type Props = { companyId: string; branchId: string; model: ReturnType<typeof buildBusinessIntelligence> };

export function BreakEvenPanel({ companyId, branchId, model }: Props) {
  const scope = branchId || 'all';
  const context = `${companyId}:${scope}`;
  const current = useRef(context); current.current = context;
  const [loaded, setLoaded] = useState('');
  const [settings, setSettings] = useState<BreakEvenSettings>(empty);
  const [desired, setDesired] = useState('0');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoaded(''); setError(''); setMessage(''); setReviewed(false); setSaving(false); setSettings(empty); setDesired('0');
    if (!supabase) { setError('Conexão indisponível. Tente abrir esta aba novamente.'); return; }
    void Promise.resolve(supabase.from('partner_break_even_settings').select('aluguel,energia,salarios,impostos,outros,desired')
      .eq('user_id', companyId).eq('scope', scope).maybeSingle()).then(({ data, error: failure }) => {
        if (cancelled) return;
        if (failure) { setError('Não foi possível carregar as configurações. Reabra a aba para tentar novamente.'); return; }
        const saved = data ? { ...data, desired: Number(data.desired) } as BreakEvenSettings : empty;
        setSettings(saved); setDesired(String(saved.desired)); setLoaded(context);
      }).catch(() => { if (!cancelled) setError('Não foi possível carregar as configurações. Reabra a aba para tentar novamente.'); });
    return () => { cancelled = true; };
  }, [companyId, scope, context]);
  useEffect(() => { setReviewed(false); }, [model.first, model.last, model.result, context]);
  const desiredValue = /^\d+(?:[.,]\d{1,2})?$/.test(desired) ? Number(desired.replace(',', '.')) : NaN;
  const calculation = registeredBreakEven(model.result, { ...settings, desired: desiredValue });
  const ready = loaded === context;
  const save = async () => {
    if (!supabase || !ready || saving) return;
    if (!Number.isFinite(desiredValue) || desiredValue < 0 || desiredValue > 1e12) { setError('Informe um resultado desejado válido, entre zero e 1 trilhão.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: failure } = await supabase.from('partner_break_even_settings').upsert({ user_id: companyId, scope, ...settings, desired: desiredValue }, { onConflict: 'user_id,scope' });
      if (current.current !== context) return;
      if (failure) setError('Não foi possível confirmar o salvamento. Tente salvar novamente.');
      else setMessage('Configurações salvas para esta seleção de filiais.');
    } catch {
      if (current.current === context) setError('Não foi possível confirmar o salvamento. Tente salvar novamente.');
    } finally {
      if (current.current === context) setSaving(false);
    }
  };
  return <section className="module-card bi-simulator" aria-labelledby="registered-break-even">
    <h4 id="registered-break-even">Ponto de equilíbrio com seus dados</h4>
    <p>Usa as vendas concluídas, os custos dos produtos vendidos e as despesas por vencimento do período selecionado. Compras de estoque não são descontadas novamente.</p>
    {!ready && !error && <p role="status">Carregando configurações…</p>}
    {error && <p role="alert">{error}</p>}
    {ready && <>
      <p>As contas marcadas como fixas ou variáveis no Financeiro usam essa escolha no cálculo. A classificação abaixo vale para os lançamentos antigos ou sem tipo de despesa definido.</p>
      <div className="bi-input-grid">{categories.map(category => <label key={category}>{payableCategories[category]}<select disabled={saving} value={settings[category]} onChange={event => { setSettings({ ...settings, [category]: event.target.value }); setReviewed(false); setMessage(''); }}><option value="">Selecionar classificação</option><option value="fixed">Fixa — não acompanha as vendas</option><option value="variable">Variável — acompanha as vendas</option></select></label>)}
        <label>Resultado desejado no período (R$)<input inputMode="decimal" disabled={saving} value={desired} onChange={event => { setDesired(event.target.value); setMessage(''); }} /></label></div>
      <p>Nas próximas contas a pagar, selecione o tipo de despesa ao cadastrar. Assim, uma mesma categoria pode reunir despesas fixas e variáveis sem misturar seus cálculos. Estas configurações e o resultado desejado ficam salvos por filial; revise o valor desejado ao trocar o período.</p>
      <button type="button" className="rma-advance-btn" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar configurações do ponto de equilíbrio'}</button>
      {message && <p role="status">{message}</p>}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16 }}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />Conferi os gastos deste período, incluindo taxas e tributos, e os custos dos produtos. Categorias sem lançamentos representam zero neste período.</label>
      {!reviewed ? <p role="status">Confira os registros e marque a confirmação para apresentar a estimativa.</p> : calculation.error ? <p role="status">{calculation.error}</p> : calculation.result && <div className="report-cards bi-kpi-grid" aria-live="polite">
        <div className="report-card"><small>Gastos fixos cadastrados</small><strong>{money.format(calculation.result.fixed)}</strong><small>Valor integral por vencimento, incluindo contas em aberto</small></div>
        <div className="report-card"><small>Margem de contribuição estimada</small><strong>{calculation.result.margin.toFixed(2)}%</strong><small>Receita líquida menos custo vendido e despesas variáveis</small></div>
        <div className="report-card"><small>Ponto de equilíbrio estimado</small><strong>{money.format(calculation.result.breakEven)}</strong><small>Receita líquida necessária para cobrir os gastos fixos</small></div>
        <div className="report-card"><small>Falta para atingir o equilíbrio</small><strong>{money.format(calculation.result.remaining)}</strong><small>{calculation.result.remaining === 0 ? 'Equilíbrio atingido nos registros deste período' : 'Receita adicional, mantendo a mesma margem'}</small></div>
        <div className="report-card"><small>Receita para o resultado desejado</small><strong>{money.format(calculation.result.requiredRevenue)}</strong><small>Gastos fixos mais resultado desejado, divididos pela margem</small></div>
      </div>}
      <small className="bi-disclaimer">Estimativa gerencial: depende da classificação e da cobertura dos registros. Custos atuais usados em vendas sem histórico continuam sendo aproximações. Períodos parciais consideram somente os vencimentos dentro da seleção; o cálculo não projeta automaticamente o mês inteiro. Nenhuma conta é criada ou alterada.</small>
    </>}
  </section>;
}
