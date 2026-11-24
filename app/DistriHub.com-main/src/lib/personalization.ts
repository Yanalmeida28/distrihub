import type { CatalogPreferences, PanelPreferences, ReceiptPreferences } from '../types';

export const receiptDefaults: ReceiptPreferences = { paper_width: '80', font_size: 12, header_text: '', show_phone: true, show_address: true, show_document: false, show_salesperson: true };
export const panelDefaults: PanelPreferences = { theme: 'default', text_size: 'normal', density: 'comfortable', corners: 'standard' };
export const catalogDefaults: CatalogPreferences = { welcome_message: '', card_size: 'normal', banner_height: 220, show_stock: true, show_sku: true, whatsapp_phone: '', show_whatsapp: true };

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function choice<T>(value: unknown, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
function flag(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback; }
function text(value: unknown, limit: number): string { return typeof value === 'string' ? value.slice(0, limit) : ''; }

export function receiptPreferences(value?: unknown): ReceiptPreferences {
  const data = object(value);
  return { paper_width: choice(data.paper_width, ['58', '80'], '80'), font_size: choice(data.font_size, [10, 12, 14, 16], 12),
    header_text: text(data.header_text, 120), show_phone: flag(data.show_phone, true), show_address: flag(data.show_address, true),
    show_document: flag(data.show_document, false), show_salesperson: flag(data.show_salesperson, true) };
}

export function panelPreferences(value?: unknown): PanelPreferences {
  const data = object(value);
  return { theme: choice(data.theme ?? data.financial_theme, ['default', 'blue-glass', 'white'], panelDefaults.theme),
    text_size: choice(data.text_size, ['normal', 'large', 'extra-large'], 'normal'), density: choice(data.density, ['comfortable', 'compact'], 'comfortable'), corners: choice(data.corners, ['standard', 'rounded', 'square'], 'standard') };
}

export function catalogPreferences(value?: unknown): CatalogPreferences {
  const data = object(value);
  return { welcome_message: text(data.welcome_message, 400), card_size: choice(data.card_size, ['normal', 'compact'], 'normal'),
    banner_height: choice(data.banner_height, [160, 220, 300], 220), show_stock: flag(data.show_stock, true), show_sku: flag(data.show_sku, true),
    whatsapp_phone: text(data.whatsapp_phone, 32), show_whatsapp: flag(data.show_whatsapp, true) };
}

export function panelStyle(value?: unknown): Record<string, string> {
  const panel = panelPreferences(value);
  const corners = { standard: [12, 8], rounded: [20, 14], square: [4, 4] }[panel.corners];
  return { '--dh-radius': `${corners[0]}px`, '--dh-radius-sm': `${corners[1]}px`, '--personalized-font-size': `${{ normal: 15, large: 17, 'extra-large': 19 }[panel.text_size]}px`,
    '--personalized-cell-padding': panel.density === 'compact' ? '7px 10px' : '12px 14px', '--personalized-card-padding': panel.density === 'compact' ? '12px' : '18px' };
}

export function catalogWhatsappUrl(phone: string): string | null {
  if (!phone.trim() || /[^\d+().\s-]/.test(phone)) return null;
  let digits = phone.replace(/\D/g, '');
  if (!phone.trim().startsWith('+') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? `https://wa.me/${digits}` : null;
}
