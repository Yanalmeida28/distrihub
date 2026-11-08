import { jsPDF } from 'npm:jspdf@4.2.1';
import type { QuotePayload } from './order-email.ts';

export async function buildEmailQuotePdf(payload: QuotePayload): Promise<string> {
  const doc = new jsPDF({ compress: true });
  let y = 18;
  const text = (value: string) => {
    for (const line of doc.splitTextToSize(Array.from(value, character => character.charCodeAt(0) < 32 ? ' ' : character).join(''), 180)) {
      if (y > 275) { doc.addPage(); y = 18; }
      doc.text(line, 15, y); y += 6;
    }
  };
  const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
  text('ORÇAMENTO — NÃO FISCAL');
  text(`${payload.company_name} — ${payload.branch_name}`);
  text(`Pedido: ${payload.sale.sale_number ?? payload.sale.id}`);
  text(`Cliente: ${payload.customer.name}`);
  text(`Data: ${payload.sale.created_at.slice(0, 10)}`);
  if (!Array.isArray(payload.sale.items) || payload.sale.items.length > 1000) throw new Error('items');
  for (const item of payload.sale.items) text(`${item.quantity} x ${item.name} — ${money(item.unit_price)} — ${money(item.quantity * item.unit_price)}`);
  text(`Subtotal: ${money(payload.sale.total)}`);
  text(`Frete: ${money(payload.sale.freight_fee ?? 0)}`);
  text(`TOTAL: ${money(Number(payload.sale.total) + Number(payload.sale.freight_fee ?? 0))}`);
  text('Pedido em aberto. Não comprova pagamento. Disponibilidade e frete sujeitos à confirmação da loja.');
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
