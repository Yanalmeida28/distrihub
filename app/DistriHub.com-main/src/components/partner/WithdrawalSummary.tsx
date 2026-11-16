import type { withdrawalSummary } from '../../lib/accounts';
import { money } from '../../utils';

type Props = {
  rows: ReturnType<typeof withdrawalSummary>;
  selectedRecipient: string | null;
  periodLabel: string;
  disabled: boolean;
  onSelectRecipient: (recipient: string) => void;
};

function Amount({ value }: { value: number }) {
  const text = money.formatToParts(value).filter(part => part.type !== 'currency' && part.type !== 'literal').map(part => part.value).join('');
  return <strong className="withdrawal-amount" style={{ fontSize: `clamp(9px, calc(160cqi / ${text.length}), 22px)` }}>{text}</strong>;
}

export function WithdrawalSummary({ rows, selectedRecipient, periodLabel, disabled, onSelectRecipient }: Props) {
  const totals = rows.reduce((sum, row) => ({ paid: sum.paid + Math.round(row.paid * 100), open: sum.open + Math.round(row.open * 100), registered: sum.registered + Math.round(row.registered * 100) }), { paid: 0, open: 0, registered: 0 });
  return <section className="withdrawal-summary" aria-labelledby="withdrawal-summary-title">
    <h5 id="withdrawal-summary-title">Retiradas por pessoa</h5>
    <p className="withdrawal-period">Contas por vencimento · {periodLabel}</p>
    <div className="withdrawal-totals" role="group" aria-label="Totais das retiradas">
      <div><small>Pago (R$)</small><Amount value={totals.paid / 100} /></div>
      <div><small>Em aberto (R$)</small><Amount value={totals.open / 100} /></div>
    </div>
    <ul className="withdrawal-people">{rows.map(row => <li key={row.recipient}>
      <button type="button" className="withdrawal-person" aria-label={`Ver lançamentos de ${row.recipient}. Pago: ${money.format(row.paid)}. Em aberto: ${money.format(row.open)}.`} aria-pressed={selectedRecipient === row.recipient} disabled={disabled} onClick={() => onSelectRecipient(row.recipient)}>
        <span className="withdrawal-person-name"><strong>{row.recipient}</strong><small>Ver lançamentos →</small></span>
        <span className="withdrawal-person-paid"><small>Pago (R$)</small><Amount value={row.paid} /></span>
        <span className="withdrawal-person-open"><small>Em aberto (R$)</small><Amount value={row.open} /></span>
      </button>
    </li>)}</ul>
    <details className="withdrawal-explanation">
      <summary>Entenda os valores</summary>
      <p>Total lançado: <strong>{money.format(totals.registered / 100)}</strong>. O resumo considera as contas ativas da categoria, filial e período de vencimento filtrados, em todos os estados de pagamento.</p>
      <p>Pago é o total liquidado dessas contas, mesmo quando o pagamento ocorreu em outra data. Para consultar saídas por data de pagamento, use o Fluxo Financeiro. A busca, a pessoa selecionada e as abas de status abaixo filtram apenas os lançamentos.</p>
    </details>
  </section>;
}
