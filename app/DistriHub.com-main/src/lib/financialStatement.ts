import { localDate, type FinancialMovement } from './financialFlow';

// Keep the chronological balance attached to its movement, independent of display order/page.
export function financialStatement(records: FinancialMovement[], start: string, end: string, mode: 'realizado' | 'previsto', timeZone?: string) {
  const dated = records.map(row => ({ ...row, day: row.date ? localDate(row.date, timeZone) : '' }))
    .map(row => ({ ...row, day: /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isFinite(Date.parse(row.day)) && new Date(row.day).toISOString().slice(0, 10) === row.day ? row.day : '' }));
  const timestamp = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? -Infinity : Date.parse(date);
  const chronological = dated.filter(row => row.day && row.day >= start && row.day <= end)
    .sort((a, b) => a.day.localeCompare(b.day) || (timestamp(a.date!) - timestamp(b.date!)) || a.id.localeCompare(b.id));
  let incoming = 0, outgoing = 0, running = 0;
  const rows = chronological.map(row => {
    const cents = Math.round(row.amount * 100);
    if (cents >= 0) incoming += cents; else outgoing -= cents;
    running += cents;
    return { ...row, running: running / 100 };
  });
  return { rows: mode === 'realizado' ? rows.reverse() : rows, incoming: incoming / 100, outgoing: outgoing / 100, result: running / 100, undated: dated.filter(row => !row.day) };
}
