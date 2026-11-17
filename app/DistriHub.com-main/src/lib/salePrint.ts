import { printerPreferences, requireImageConnector, sendReceipt, sendReceiptImage } from './directPrint';
import type { PartnerBranch, PartnerCustomer, PartnerSale, StoreSettings } from '../types';
import { money } from '../utils';
import { saleChargeTotal, salePaymentDescription } from './pdv';
import { receiptPreferences } from './personalization';

export type PrintableSale = Pick<PartnerSale, 'sale_number' | 'customer_name' | 'items' | 'total' | 'freight_fee' | 'imei' | 'serial_number' | 'payment_method' | 'payment_splits' | 'created_at' | 'branch_id' | 'customer_id' | 'salesperson_id'> & { id?: string; status?: PartnerSale['status']; completed_at?: string | null };

export type ReceiptDetails = { customer?: PartnerCustomer; salespersonName?: string; settings?: StoreSettings; companyName?: string; companyDocument?: string | null; companyAddress?: string | null; branches?: Pick<PartnerBranch, 'id' | 'name' | 'address'>[] };

// Older connector preferences must not silently discard the saved design.
// Plain text printing is available only after an explicit choice.
export function directReceiptEnabled() { const mode = printerPreferences()?.mode; return mode === 'text' || mode === 'image'; }
const imageReceiptJobs = new Map<string, Promise<void>>();

export function printSale(sale: PrintableSale, format: 'receipt' | 'label', details: ReceiptDetails = {}, preparedWindow?: Window, options: { previewOnly?: boolean } = {}) {
  // Reprints must identify the sale's branch even in consolidated views.
  const branch = details.branches?.find(candidate => candidate.id === sale.branch_id);
  if (details.branches) {
    details = { ...details, companyName: branch?.name || details.companyName, companyAddress: branch?.address };
  }
  const preferences = format === 'receipt' && !options.previewOnly ? printerPreferences() : null;
  if (preferences?.mode === 'image') {
    preparedWindow?.close();
    const key = JSON.stringify([sale, details, preferences]);
    const existing = imageReceiptJobs.get(key);
    if (existing) return existing;
    const job = (async () => {
      const width = receiptPreferences(details.settings?.personalization?.receipt).paper_width;
      if (preferences.width !== width) throw new Error('O papel da impressora está diferente da personalização. Ajuste a largura em Configurações antes de imprimir.');
      await requireImageConnector();
      const { renderReceiptImage } = await import('./receiptImage');
      const image = await renderReceiptImage(target => { printSale(sale, format, details, target, { previewOnly: true }); }, width);
      await sendReceiptImage(image, preferences);
    })().finally(() => imageReceiptJobs.delete(key));
    imageReceiptJobs.set(key, job);
    return job;
  }
  const direct = preferences?.mode === 'text' ? preferences : null;
  const popup = direct ? null : preparedWindow ?? window.open('', '_blank', 'width=440,height=700');
  if (!direct && !popup) throw new Error('Permita pop-ups neste navegador para imprimir o cupom ou a etiqueta.');

  if (!direct && preparedWindow) {
    preparedWindow.document.head.replaceChildren();
    preparedWindow.document.body.replaceChildren();
  }
  const isQuote = sale.status === 'pre_venda' || sale.status === 'aberta';
  const receipt = receiptPreferences(details.settings?.personalization?.receipt);
  const fontSize = format === 'receipt' ? receipt.font_size : 12;
  const contentWidth = format === 'receipt' && receipt.paper_width === '58' ? 50 : 72;
  const doc = direct ? document.implementation.createHTMLDocument('Cupom') : popup!.document;
  doc.title = format === 'receipt' ? (isQuote ? 'Orçamento — cupom não fiscal' : 'Cupom não fiscal') : 'Etiqueta da venda';
  doc.documentElement.lang = 'pt-BR';
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: white; color: black; font: ${fontSize}px Arial, sans-serif; }
    main { width: ${contentWidth}mm; max-width: 100%; margin: auto; }
    h1 { font-size: ${fontSize + 4}px; text-align: center; }
    p { margin: 7px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    article { padding: 3mm 0; border-bottom: 1px dashed black; break-inside: avoid; }
    hr { border: 0; border-top: 1px dashed black; margin: 3mm 0 0; }
    .label { width: 52mm; min-height: 30mm; padding: 2mm; border: 1px solid black; margin: 2mm auto; }
    button { display: block; margin: 16px auto; padding: 10px; }
    @media print { button { display: none; } }
  `;
  doc.head.append(style);
  const main = doc.createElement('main');
  doc.body.append(main);
  function line(parent: HTMLElement, text: string, heading = false, bold = false) {
    const element = doc.createElement(heading ? 'h1' : 'p');
    element.textContent = text;
    if (bold) element.style.fontWeight = '700';
    parent.append(element);
  }
  const date = new Date(sale.completed_at ?? sale.created_at).toLocaleString('pt-BR', details.settings?.personalization?.business_time_zone ? { timeZone: details.settings.personalization.business_time_zone } : undefined);
  const reference = sale.id ? `Venda: ${sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id}` : `Venda: ${date}`;
  function identification(parent: HTMLElement) {
    line(parent, reference);
    line(parent, `Cliente: ${sale.customer_name || 'Consumidor'}`, false, format === 'receipt');
    if (sale.imei) line(parent, `IMEI / Selo: ${sale.imei}`);
    if (sale.serial_number) line(parent, `Nº de série: ${sale.serial_number}`);
  }
  if (format === 'receipt') {
    if (details.settings?.show_logo_on_receipt && details.settings.logo_url) {
      const logo = doc.createElement('img');
      logo.src = details.settings.logo_url;
      logo.alt = details.companyName || 'Logo da loja';
      logo.style.cssText = 'display:block;max-width:50mm;max-height:25mm;object-fit:contain;margin:0 auto';
      main.append(logo);
    }
    if (details.companyName) line(main, details.companyName, true);
    if (receipt.header_text) line(main, receipt.header_text);
    if (details.settings?.show_cnpj_on_receipt) {
      if (details.companyDocument) line(main, `CNPJ/CPF: ${details.companyDocument}`);
      if (details.companyAddress) line(main, `Endereço da loja: ${details.companyAddress}`);
    }
    line(main, isQuote ? 'ORÇAMENTO — CUPOM NÃO FISCAL' : 'CUPOM NÃO FISCAL', true);
    if (isQuote) line(main, 'Pedido em aberto — pagamento não confirmado.');
    identification(main);
    const customer = details.customer;
    const phones = [...new Set([customer?.phone, customer?.phone_commercial_1, customer?.phone_commercial_2].map((value) => value?.trim()).filter(Boolean))].join(' / ');
    const address = [customer?.address, customer?.address_number, customer?.complement, customer?.neighborhood].map((value) => value?.trim()).filter(Boolean).join(', ');
    const city = [customer?.city, customer?.state].map((value) => value?.trim()).filter(Boolean).join(' / ');
    if (receipt.show_document && customer?.document) line(main, `CPF/CNPJ do cliente: ${customer.document}`, false, true);
    if (receipt.show_phone) line(main, `Telefone: ${phones || 'Não informado'}`, false, true);
    if (receipt.show_address) {
      line(main, `Endereço: ${address || 'Não informado'}`, false, true);
      line(main, `Cidade: ${city || 'Não informada'}`, false, true);
      if (customer?.zip_code) line(main, `CEP: ${customer.zip_code}`, false, true);
    }
    if (sale.id) line(main, `Data: ${date}`);
    line(main, 'Produtos/Serviços', false, true);
    main.append(doc.createElement('hr'));
    for (const item of sale.items) {
      const row = doc.createElement('article');
      line(row, item.name);
      line(row, `${item.quantity} × ${money.format(item.unit_price)} = ${money.format(item.quantity * item.unit_price)}`);
      main.append(row);
    }
    const totalQuantity = sale.items.reduce((total, item) => total + item.quantity, 0);
    if (sale.freight_fee) {
      line(main, `Subtotal produtos/serviços: ${money.format(sale.total)}`);
      line(main, `Frete terceirizado: ${money.format(sale.freight_fee)}`);
    }
    const totalSummary = doc.createElement('div');
    totalSummary.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;padding:4px 0';
    const totalLabel = doc.createElement('strong');
    totalLabel.textContent = `TOTAL: ${money.format(saleChargeTotal(sale))}`;
    totalLabel.style.cssText = `min-width:0;font-size:${fontSize + 4}px`;
    const quantityLabel = doc.createElement('span');
    quantityLabel.textContent = `Qtd. produtos: ${totalQuantity}`;
    quantityLabel.style.cssText = `flex:0 0 auto;font-size:${Math.max(10, fontSize - 1)}px;white-space:nowrap`;
    totalSummary.append(totalLabel, quantityLabel);
    main.append(totalSummary);

    const paymentSummary = doc.createElement('div');
    paymentSummary.style.cssText = `display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:${Math.max(10, fontSize - 1)}px`;
    const paymentLabel = doc.createElement('span');
    paymentLabel.textContent = `Pagamento: ${salePaymentDescription(sale)}`;
    paymentLabel.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere';
    const salespersonLabel = doc.createElement('span');
    salespersonLabel.textContent = `Colaborador: ${details.salespersonName || 'Não informado'}`;
    salespersonLabel.style.cssText = 'flex:1;min-width:0;text-align:right;overflow-wrap:anywhere';
    paymentSummary.append(paymentLabel);
    if (receipt.show_salesperson) paymentSummary.append(salespersonLabel);
    main.append(paymentSummary);
    if (details.settings?.receipt_footer_text) line(main, details.settings.receipt_footer_text);
  } else {
    for (const item of sale.items) {
      const label = doc.createElement('article');
      label.className = 'label';
      line(label, item.name, true);
      identification(label);
      line(label, `Quantidade: ${item.quantity}`);
      main.append(label);
    }
  }
  if (direct) {
    preparedWindow?.close();
    const text = Array.from(main.children).map(element => {
      if (element.tagName === 'IMG') return '';
      if (element.tagName === 'HR') return '--------------------------------';
      if (element.children.length) return Array.from(element.children).map(child => child.textContent ?? '').join('  ');
      return element.textContent ?? '';
    }).filter(Boolean).join('\n');
    return sendReceipt(text, direct);
  }
  if (options.previewOnly) return;
  const button = doc.createElement('button');
  button.textContent = 'Imprimir';
  button.onclick = () => { popup!.focus(); popup!.print(); };
  doc.body.append(button);
  // Keep the preview available for retrying or changing the printer settings.
  const images = Array.from(doc.images);
  void Promise.all(images.map((img) => img.decode().catch(() => undefined))).then(() => {
    if (!popup!.closed) popup!.requestAnimationFrame(() => { popup!.focus(); popup!.print(); });
  });
}
