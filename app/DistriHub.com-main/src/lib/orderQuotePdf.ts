import { jsPDF } from 'jspdf';
import type { PrintableSale, ReceiptDetails } from './salePrint';
import { saleChargeTotal } from './pdv';
import { money } from '../utils';

type QuoteLogo = { data: string; width: number; height: number };
const quoteLogos = new Map<string, QuoteLogo>();
const pendingLogos = new Map<string, Promise<void>>();

/** Preload the saved logo so native sharing can start directly from the click. */
export function prepareOrderQuoteLogo(url?: string | null): Promise<void> {
  if (!url || quoteLogos.has(url) || typeof Image === 'undefined') return Promise.resolve();
  const pending = pendingLogos.get(url);
  if (pending) return pending;
  const task = new Promise<void>(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => finish(), 8000);
    function finish() { clearTimeout(timer); image.onload = null; image.onerror = null; resolve(); }
    image.onerror = finish;
    image.onload = () => {
      try {
        const scale = Math.min(1, 800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          quoteLogos.set(url, { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        }
      } catch { /* An unavailable logo must not prevent generating the quote. */ }
      finish();
    };
    image.src = url;
  }).finally(() => pendingLogos.delete(url));
  pendingLogos.set(url, task);
  return task;
}

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
      const colon = !bold ? line.indexOf(':') : -1;
      if (colon >= 0) {
        const label = line.slice(0, colon + 1);
        pdf.setFont('helvetica', 'bold');
        pdf.text(label, 14, y);
        const labelWidth = pdf.getTextWidth(label);
        pdf.setFont('helvetica', 'normal');
        pdf.text(line.slice(colon + 1), 14 + labelWidth, y);
      } else pdf.text(line, 14, y);
      y += height;
    }
    y += 2;
  }
  const logo = details.settings?.logo_url ? quoteLogos.get(details.settings.logo_url) : undefined;
  if (logo) {
    const scale = Math.min(50 / logo.width, 25 / logo.height);
    pdf.addImage(logo.data, 'PNG', 14, y - 5, logo.width * scale, logo.height * scale);
    y += logo.height * scale + 5;
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
        pdf.setFont('helvetica', 'bold');
        pdf.text(currency(Math.round(item.quantity * item.unit_price * 100) / 100), 194, y, { align: 'right' });
        pdf.setFont('helvetica', 'normal');
        first = false;
      }
      y += chunk.length * 4.5 + 4;
      if (lines.length) { newPage(); tableHeader(); pdf.setFont('helvetica', 'normal'); }
    }
    pdf.setDrawColor(220, 225, 230); pdf.line(14, y - 2, 196, y - 2);
    // Afasta o próximo produto da divisória, inclusive quando a descrição ocupa várias linhas.
    y += 3;
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
  if (details.settings?.logo_url && !quoteLogos.has(details.settings.logo_url)) await prepareOrderQuoteLogo(details.settings.logo_url);
  const { pdf, filename } = buildOrderQuotePdf(sale, details);
  await pdf.save(filename, { returnPromise: true });
}

/** Invoke directly from the click: file sharing requires transient user activation. */
export async function shareOrderQuotePdf(sale: PrintableSale, details: ReceiptDetails = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (details.settings?.logo_url && !quoteLogos.has(details.settings.logo_url)) await prepareOrderQuoteLogo(details.settings.logo_url);
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
