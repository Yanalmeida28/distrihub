import { jsPDF } from 'jspdf';
import type { PrintableSale, ReceiptDetails } from './salePrint';
import { saleChargeTotal } from './pdv';
import { money } from '../utils';

/** Build a standalone quote from the saved order, without invoking a printer. */
export function buildOrderQuotePdf(sale: PrintableSale, details: ReceiptDetails = {}) {
  if (!['aberta', 'pre_venda'].includes(sale.status ?? '')) throw new Error('O pedido não está mais aberto para gerar um orçamento.');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const reference = sale.sale_number ? String(sale.sale_number).padStart(6, '0') : (sale.id ?? 'pedido').slice(0, 8).toUpperCase();
  const filename = `orcamento-${reference.replace(/[^a-zA-Z0-9_-]/g, '') || 'pedido'}.pdf`;
  const clean = (value: unknown) => Array.from(String(value ?? '').replace(/\u00a0/g, ' '))
    .filter(character => character.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(character)).join('');
  const currency = (value: number) => clean(money.format(value));
  const branch = details.branches?.find(candidate => candidate.id === sale.branch_id);
  const customer = details.customer?.id === sale.customer_id ? details.customer : undefined;
  let y = 20;
  const bottom = 274;
  pdf.setProperties({ title: `Orçamento ${reference}`, subject: 'Orçamento de pedido em aberto', creator: 'DistriHub' });
  pdf.setTextColor(25, 40, 55);
  function newPage() { pdf.addPage(); y = 20; }
  function paragraph(value: string, bold = false, size = 10) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(clean(value), 182) as string[];
    const height = size * 0.45;
    for (const line of lines) {
      if (y + height > bottom) newPage();
      pdf.text(line, 14, y); y += height;
    }
    y += 2;
  }
  paragraph('ORÇAMENTO', true, 21);
  paragraph(details.companyName || branch?.name || 'Loja', true, 13);
  if (branch && branch.name !== details.companyName) paragraph(`Filial: ${branch.name}`);
  if (details.companyDocument) paragraph(`CPF/CNPJ da loja: ${details.companyDocument}`);
  const address = branch ? branch.address : details.companyAddress;
  if (address) paragraph(`Endereço da loja: ${address}`);
  y += 3;
  paragraph(`Pedido: ${reference}`, true);
  const created = new Date(sale.created_at);
  if (!Number.isNaN(created.getTime())) paragraph(`Data do pedido: ${created.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  paragraph(`Cliente: ${sale.customer_name || customer?.name || 'Consumidor não identificado'}`, true);
  if (customer?.document) paragraph(`CPF/CNPJ: ${customer.document}`);
  if (customer?.phone) paragraph(`Telefone: ${customer.phone}`);
  if (customer?.email) paragraph(`E-mail: ${customer.email}`);
  const customerAddress = customer ? [customer.address, customer.address_number, customer.complement, customer.neighborhood, customer.city, customer.state, customer.zip_code].filter(Boolean).join(', ') : '';
  if (customerAddress) paragraph(`Endereço do cliente: ${customerAddress}`);
  if (details.salespersonName) paragraph(`Atendimento: ${details.salespersonName}`);
  if (sale.imei) paragraph(`IMEI / Selo: ${sale.imei}`);
  if (sale.serial_number) paragraph(`Número de série: ${sale.serial_number}`);
  y += 5;
  function tableHeader() {
    if (y + 12 > bottom) newPage();
    pdf.setFillColor(235, 240, 245); pdf.rect(14, y - 5, 182, 9, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
    pdf.text('Descrição', 16, y); pdf.text('Qtd.', 132, y, { align: 'right' });
    pdf.text('Valor unit.', 164, y, { align: 'right' }); pdf.text('Subtotal', 194, y, { align: 'right' });
    y += 11;
  }
  tableHeader();
  for (const item of sale.items) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(clean(item.name), 97) as string[];
    let first = true;
    while (lines.length) {
      if (y + 7 > bottom) { newPage(); tableHeader(); pdf.setFont('helvetica', 'normal'); }
      const count = Math.max(1, Math.floor((bottom - y - 3) / 4.5));
      const chunk = lines.splice(0, count);
      pdf.text(chunk, 16, y, { lineHeightFactor: 1.42 });
      if (first) {
        pdf.text(clean(item.quantity), 132, y, { align: 'right' });
        pdf.text(currency(item.unit_price), 164, y, { align: 'right' });
        pdf.text(currency(Math.round(item.quantity * item.unit_price * 100) / 100), 194, y, { align: 'right' });
        first = false;
      }
      y += chunk.length * 4.5 + 4;
      if (lines.length) { newPage(); tableHeader(); pdf.setFont('helvetica', 'normal'); }
    }
    pdf.setDrawColor(220, 225, 230); pdf.line(14, y - 2, 196, y - 2);
  }
  if (!sale.items.length) paragraph('Nenhum item registrado.');
  if (y + 38 > bottom) newPage();
  y += 5;
  paragraph(`Subtotal dos produtos/serviços: ${currency(sale.total)}`);
  if (sale.freight_fee) paragraph(`Frete: ${currency(sale.freight_fee)}`);
  paragraph(`TOTAL DO ORÇAMENTO: ${currency(saleChargeTotal(sale))}`, true, 13);
  paragraph('Pedido em aberto. Este orçamento não comprova pagamento e não é documento fiscal.', false, 9);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90);
    pdf.text(`Orçamento ${reference}`, 14, 287);
    pdf.text(`Página ${page} / ${pages}`, 196, 287, { align: 'right' });
  }
  return { pdf, filename };
}

export async function downloadOrderQuotePdf(sale: PrintableSale, details: ReceiptDetails = {}) {
  const { pdf, filename } = buildOrderQuotePdf(sale, details);
  await pdf.save(filename, { returnPromise: true });
}

/** Invoke directly from the click: file sharing requires transient user activation. */
export async function shareOrderQuotePdf(sale: PrintableSale, details: ReceiptDetails = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const { pdf, filename } = buildOrderQuotePdf(sale, details);
  if (typeof navigator !== 'undefined' && typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    const file = new File([pdf.output('blob')], filename, { type: 'application/pdf' });
    let supported = false;
    try { supported = navigator.canShare({ files: [file] }); } catch { /* Download remains available. */ }
    if (supported) {
      try {
        await navigator.share({ files: [file], title: filename.replace(/\.pdf$/, '') });
        return 'shared';
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
        if (!(error instanceof Error) || !['NotAllowedError', 'NotSupportedError', 'SecurityError'].includes(error.name)) throw error;
      }
    }
  }
  await pdf.save(filename, { returnPromise: true });
  return 'downloaded';
}
