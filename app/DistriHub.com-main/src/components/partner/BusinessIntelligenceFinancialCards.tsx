import type { buildBusinessIntelligence } from '../../lib/businessIntelligence';
import { payableCategories } from '../../lib/accounts';
import { money } from '../../utils';

type Model = ReturnType<typeof buildBusinessIntelligence>;
const day = (value: string) => value.split('-').reverse().join('/');
const period = (model: Model) => `${day(model.first)} a ${day(model.last)}`;

export function IntelligenceMoney({ value, maxSize = 24 }: { value: number | null; maxSize?: number }) {
  const known = value !== null && Number.isFinite(value);
  const text = known ? money.format(value) : 'Dados insuficientes';
  return <strong className={`bi-finance-value${known ? '' : ' bi-finance-unavailable'}`} style={known ? { fontSize: `clamp(9px, calc(155cqi / ${text.length}), ${maxSize}px)` } : undefined}>{text}</strong>;
}

export function IntelligenceBalances({ model }: { model: Model }) {
  return <section className="module-card bi-finance-panel" aria-labelledby="bi-account-balances">
    <header><h5 id="bi-account-balances">Saldos das contas</h5><small>Posição de hoje · {day(model.today)}</small></header>
    <div className="bi-finance-metrics">
      <div className="bi-finance-metric bi-finance-receivable"><span>A receber</span><IntelligenceMoney value={model.receivable} /><small>Saldo em aberto</small></div>
      <div className="bi-finance-metric bi-finance-payable"><span>A pagar</span><IntelligenceMoney value={model.payable} /><small>Saldo em aberto</small></div>
    </div>
    <div className="bi-finance-period-label">Período selecionado · {period(model)}</div>
    <div className="bi-finance-metrics">
      <div className="bi-finance-metric"><span>Entradas registradas</span><IntelligenceMoney value={model.received} /></div>
      <div className="bi-finance-metric"><span>Reembolsos</span><IntelligenceMoney value={model.refunded} /></div>
    </div>
  </section>;
}

export function IntelligenceWithdrawals({ model }: { model: Model }) {
  return <section className="module-card bi-finance-panel" aria-labelledby="bi-owner-withdrawals">
    <header><h5 id="bi-owner-withdrawals">Retiradas de sócios / uso pessoal</h5><small>Período selecionado · {period(model)}</small></header>
    <div className="bi-withdrawal-overview">
    <div className="bi-finance-metrics">
      <div className="bi-finance-metric"><span>Por vencimento</span><IntelligenceMoney value={model.result.withdrawals} /><small>{model.result.withdrawalCount} conta(s)</small></div>
      <div className="bi-finance-metric"><span>Pagas no período</span><IntelligenceMoney value={model.paidWithdrawals} /><small>Data do pagamento</small></div>
    </div>
    {model.withdrawalRecipients.length > 0 && <div><h6 className="bi-finance-subtitle">Pagamentos por pessoa</h6><ul className="bi-finance-recipients">{model.withdrawalRecipients.map(row => <li key={row.recipient}><span>{row.recipient}</span><div className="bi-finance-money-cell"><IntelligenceMoney value={row.amount} maxSize={20} /></div></li>)}</ul></div>}
    </div>
    {model.result.undatedExpenses > 0 && <p className="bi-finance-warning" role="note">Há contas sem vencimento válido. A posição por vencimento pode estar incompleta.</p>}
    {model.paidWithdrawals === null && <p className="bi-finance-warning" role="note">Dados de pagamentos incompletos. Confira o histórico financeiro.</p>}
    {model.paidWithdrawals === 0 && <small>Nenhuma retirada paga no período.</small>}
    <details className="bi-finance-details"><summary>Entenda as retiradas</summary>
      <p>Retiradas ficam separadas das despesas operacionais, do resultado estimado e do ponto de equilíbrio. Os pagamentos continuam nas saídas do caixa.</p>
      <p>O primeiro valor reúne contas por vencimento; o segundo, pagamentos efetivos no período. As datas podem pertencer a períodos diferentes.</p>
      <p>Para corrigir uma conta antiga, edite sua categoria em Contas a Pagar, confira o beneficiário e preserve o pagamento existente, sem cadastrar uma segunda saída.</p>
    </details>
  </section>;
}

export function IntelligenceCategoryPayments({ model }: { model: Model }) {
  const rows = [...model.expenseCategories].sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  const maximum = rows[0]?.amount || 1;
  const labels: Record<string, string> = { ...payableCategories, fornecedor: 'Compras de estoque', retirada: 'Retiradas dos sócios' };
  return <section className="module-card bi-finance-panel" aria-labelledby="bi-category-payments">
    <header><h5 id="bi-category-payments">Pagamentos de contas por categoria</h5><small>Data do pagamento · {period(model)}</small></header>
    {model.cashResult === null ? <p className="bi-finance-warning" role="note">Dados insuficientes para apresentar pagamentos por categoria. Confira os avisos do histórico financeiro.</p>
      : rows.length === 0 ? <p>Nenhum pagamento de conta neste período.</p>
      : <ol className="bi-category-bars" aria-label="Pagamentos por categoria, do maior para o menor">{rows.map(row => <li key={row.category}>
        <div className="bi-category-bar-label"><span>{labels[row.category] ?? row.category}</span><div className="bi-finance-money-cell"><IntelligenceMoney value={row.amount} maxSize={20} /></div></div>
        <div className={`bi-category-bar-track bi-category-${row.category}`} aria-hidden="true"><span style={{ width: `${row.amount / maximum * 100}%` }} /></div>
      </li>)}</ol>}
    <details className="bi-finance-details"><summary>Entenda as categorias</summary><p>Saídas por data de pagamento, incluindo compras de estoque e retiradas. Compras não são deduzidas novamente do resultado que já considera o custo vendido; retiradas ficam fora das despesas operacionais.</p></details>
  </section>;
}
