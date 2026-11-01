import { useState, useRef } from 'react';
import {
  Upload, FileText, Download, Table, FileSpreadsheet, File, Check, X, ArrowRight,
  Users,
} from 'lucide-react';

import type { PartnerProduct, PartnerCustomer } from '../../types';
import { money } from '../../utils';
import { buildCsv, escapeHtml } from '../../lib/exportSafety';

type ImportTarget = 'produtos' | 'clientes';

type Props = {
  products: PartnerProduct[];
  customers: PartnerCustomer[];
  selectedBranchId?: string | null;
  onAddProduct: (p: Omit<PartnerProduct, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onUpdateProduct: (id: string, p: Partial<PartnerProduct>) => Promise<void>;
  onAddCustomer: (c: Omit<PartnerCustomer, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
};

const productFields = ['name', 'sku', 'cost_price', 'sale_price', 'wholesale_price', 'stock', 'min_stock', 'category', 'is_service'];
const customerFields = ['name', 'document', 'phone', 'email', 'birthday', 'address', 'neighborhood', 'city', 'device_model', 'notes', 'customer_type', 'credit_limit', 'allow_credit'];

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  sku: 'SKU / Código',
  cost_price: 'Preço de Custo',
  sale_price: 'Preço Varejo',
  wholesale_price: 'Preço Atacado',
  stock: 'Estoque',
  min_stock: 'Estoque Mínimo',
  category: 'Categoria',
  is_service: 'Serviço (sim/não)',
  document: 'CPF / CNPJ',
  phone: 'WhatsApp / Telefone',
  email: 'E-mail',
  birthday: 'Aniversário',
  address: 'Endereço',
  neighborhood: 'Bairro',
  city: 'Cidade',
  device_model: 'Modelo do Equipamento',
  notes: 'Observações',
  customer_type: 'Tipo de Cliente',
  credit_limit: 'Limite de Crédito',
  allow_credit: 'Permite Fiado (sim/não)',
};

type ParsedRow = string[];
type ParsedData = { headers: string[]; rows: ParsedRow[] };
type ImportError = { line: number; message: string };
type ImportResult = { total: number; valid: number; ok: number; fail: number; errors: ImportError[] };

// Parser CSV robusto: respeita campos entre aspas (com "", obras de linha
// dentro do campo), separadores ; , e TAB fora de aspas, CRLF/LF e BOM UTF-8.
function parseCSV(text: string): ParsedData {
  const src = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    if (ch === ';' || ch === ',' || ch === '\t') {
      record.push(field);
      field = '';
      fieldStarted = false;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      fieldStarted = false;
      if (record.some((c) => c.trim() !== '')) records.push(record);
      record = [];
      continue;
    }
    field += ch;
    fieldStarted = true;
  }
  record.push(field);
  if (record.some((c) => c.trim() !== '')) records.push(record);

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) => r.map((c) => c.trim()));
  return { headers, rows };
}

// Lê a primeira planilha de um arquivo .xlsx/.xls e converte para a mesma
// estrutura interna do CSV. Células são convertidas para texto bruto
// (raw: true) para que a normalização de números brasileiros decida o valor.
async function parseXLS(data: ArrayBuffer): Promise<ParsedData> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  const rows = aoa
    .map((r) => (Array.isArray(r) ? r : []).map((c) => (c === null || c === undefined ? '' : String(c).trim())))
    .filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0], rows: rows.slice(1) };
}

// Normaliza números no formato brasileiro para preços:
// "1.299,90" → 1299.90 | "1299,90" → 1299.90 | "1299.90" → 1299.90
// Lança erro quando o valor é inválido — nunca converte silenciosamente em 0.
function parseBrazilianNumber(value: string): number {
  const v = value.trim().replace(/R\$\s*/g, '').replace(/\s/g, '');
  if (v === '') throw new Error('vazio');
  if (!/^[+-]?[0-9.,]+$/.test(v)) throw new Error('formato inválido');
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = v;
  } else if (lastComma > lastDot) {
    // Vírgula é o separador decimal; pontos são milhar.
    normalized = v.replace(/\./g, '').replace(',', '.');
  } else {
    // Ponto é o separador decimal; vírgulas são milhar.
    normalized = v.replace(/,/g, '');
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error('formato inválido');
  return n;
}

// Estoque: aceita somente inteiro (inclui "10,0" / "10.0" com decimal zero).
function parseBrazilianInteger(value: string): number {
  const n = parseBrazilianNumber(value);
  if (!Number.isInteger(n)) throw new Error('não é um número inteiro');
  return n;
}

// Datas: aceita DD/MM/YYYY, DD/MM/YY e YYYY-MM-DD (formatos comuns em
// arquivos brasileiros). Retorna YYYY-MM-DD. Data inexistente → erro;
// nunca gera uma data arbitrária.
function parseBrazilianDate(value: string): string {
  const v = value.trim();
  if (v === '') throw new Error('vazia');
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return buildIsoDate(Number(y), Number(mo), Number(d));
  }
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const [, d, mo, yy] = m;
    const year = Number(yy);
    const full = year <= 49 ? 2000 + year : 1900 + year;
    return buildIsoDate(full, Number(mo), Number(d));
  }
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return buildIsoDate(Number(y), Number(mo), Number(d));
  }
  throw new Error('formato inválido (use DD/MM/AAAA ou AAAA-MM-DD)');
}

function buildIsoDate(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error('data inexistente');
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error('data inexistente');
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// E-mail: validação simples apenas quando o campo for informado.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Booleano PT-BR para colunas sim/não: "sim", "não", "s", "n", "1", "0",
// "true", "false", "x" (marcado). Retorna undefined quando vazio.
function parseBrazilianBoolean(value: string): boolean | undefined {
  const v = normalizeHeader(value);
  if (v === '') return undefined;
  if (['sim', 's', '1', 'true', 'verdadeiro', 'x', 'yes', 'y'].includes(v)) return true;
  if (['nao', 'n', '0', 'false', 'falso', 'no'].includes(v)) return false;
  throw new Error(`valor inválido para sim/não: "${value}"`);
}

// Normaliza cabeçalhos para comparação inequívoca: minúsculas, sem acentos,
// com `_`, `-` e espaços tratados de forma equivalente, sem espaços extras.
function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-\s]+/g, ' ')
    .trim();
}

// Sinônimos aceitos por campo (já normalizados). Ordenados do mais específico
// ao mais genérico; a correspondência é por igualdade exata após normalização
// ou por prefixo exato, evitando mapeamentos ambíguos.
const fieldSynonyms: Record<string, string[]> = {
  name: ['nome', 'nome do produto', 'nome completo', 'razao social', 'descricao', 'produto', 'cliente'],
  sku: ['sku', 'codigo', 'cod', 'codigo do produto', 'referencia', 'ref'],
  cost_price: ['preco de custo', 'custo', 'preco custo', 'valor de custo'],
  sale_price: ['preco varejo', 'preco de venda', 'preco', 'valor', 'valor varejo', 'preco de varejo', 'venda'],
  wholesale_price: ['preco atacado', 'atacado', 'preco de atacado', 'valor atacado'],
  stock: ['estoque', 'quantidade', 'qtde', 'qtd', 'saldo'],
  min_stock: ['estoque minimo', 'minimo', 'estoque min'],
  category: ['categoria', 'grupo', 'departamento'],
  is_service: ['servico', 'e servico', 'tipo item'],
  document: ['cpf cnpj', 'cpf', 'cnpj', 'documento', 'doc'],
  phone: ['whatsapp', 'telefone', 'fone', 'celular', 'cel', 'whatsapp telefone'],
  email: ['e mail', 'email', 'e-mail'],
  birthday: ['aniversario', 'data de nascimento', 'nascimento', 'data nascimento'],
  address: ['endereco', 'end', 'logradouro'],
  neighborhood: ['bairro'],
  city: ['cidade', 'municipio'],
  device_model: ['modelo do equipamento', 'modelo equipamento', 'equipamento', 'modelo do aparelho', 'modelo aparelho', 'aparelho', 'modelo'],
  notes: ['observacoes', 'observacao', 'obs', 'anotacoes'],
  customer_type: ['tipo de cliente', 'tipo cliente', 'tipo'],
  credit_limit: ['limite de credito', 'limite credito', 'limite'],
  allow_credit: ['permite fiado', 'permite credito', 'fiado', 'venda a prazo'],
};

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportProductsCSV(products: PartnerProduct[]) {
  const headers = ['Nome', 'SKU', 'Custo', 'Varejo', 'Atacado', 'Estoque', 'Categoria'];
  const rows = products.map((p) => [
    p.name, p.sku ?? '', String(p.cost_price), String(p.sale_price),
    String(p.wholesale_price), String(p.stock), p.category ?? '',
  ]);
  const csv = buildCsv([headers, ...rows]);
  downloadFile(csv, 'produtos.csv', 'text/csv;charset=utf-8');
}

async function exportProductsExcel(products: PartnerProduct[]) {
  const XLSX = await import('xlsx');
  const headers = ['Nome', 'SKU', 'Custo', 'Varejo', 'Atacado', 'Estoque', 'Categoria'];
  const rows = products.map((p) => [
    p.name, p.sku ?? '', p.cost_price, p.sale_price,
    p.wholesale_price, p.stock, p.category ?? '',
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Produtos');
  XLSX.writeFile(workbook, 'produtos.xlsx');
}

function exportProductsPDF(products: PartnerProduct[]) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<html><head><title>Relatório de Produtos</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}th{background:#f0f0f0}h1{font-size:16px}</style></head><body><h1>Relatório de Produtos</h1><table><thead><tr><th>Nome</th><th>SKU</th><th>Custo</th><th>Varejo</th><th>Atacado</th><th>Estoque</th><th>Categoria</th></tr></thead><tbody>${products.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sku ?? '—')}</td><td>${money.format(p.cost_price)}</td><td>${money.format(p.sale_price)}</td><td>${p.wholesale_price > 0 ? money.format(p.wholesale_price) : '—'}</td><td>${escapeHtml(p.stock)}</td><td>${escapeHtml(p.category ?? '—')}</td></tr>`).join('')}</tbody></table></body></html>`);
  win.document.close();
  win.print();
}

function exportCustomersCSV(customers: PartnerCustomer[]) {
  const headers = ['Nome', 'CPF/CNPJ', 'WhatsApp', 'E-mail', 'Endereço', 'Bairro', 'Cidade', 'Tipo'];
  const rows = customers.map((c) => [
    c.name, c.document ?? '', c.phone ?? '', c.email ?? '',
    c.address ?? '', c.neighborhood ?? '', c.city ?? '', c.customer_type ?? 'varejo',
  ]);
  const csv = buildCsv([headers, ...rows]);
  downloadFile(csv, 'clientes.csv', 'text/csv;charset=utf-8');
}

async function exportCustomersExcel(customers: PartnerCustomer[]) {
  const XLSX = await import('xlsx');
  const headers = ['Nome', 'CPF/CNPJ', 'WhatsApp', 'E-mail', 'Endereço', 'Bairro', 'Cidade', 'Tipo'];
  const rows = customers.map((c) => [
    c.name, c.document ?? '', c.phone ?? '', c.email ?? '',
    c.address ?? '', c.neighborhood ?? '', c.city ?? '', c.customer_type ?? 'varejo',
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Clientes');
  XLSX.writeFile(workbook, 'clientes.xlsx');
}

function exportCustomersPDF(customers: PartnerCustomer[]) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<html><head><title>Relatório de Clientes</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}th{background:#f0f0f0}h1{font-size:16px}</style></head><body><h1>Relatório de Clientes</h1><table><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>WhatsApp</th><th>E-mail</th><th>Cidade</th><th>Tipo</th></tr></thead><tbody>${customers.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.document ?? '—')}</td><td>${escapeHtml(c.phone ?? '—')}</td><td>${escapeHtml(c.email ?? '—')}</td><td>${escapeHtml(c.city ?? '—')}</td><td>${escapeHtml(c.customer_type ?? 'varejo')}</td></tr>`).join('')}</tbody></table></body></html>`);
  win.document.close();
  win.print();
}

export function ExportButtons({ target, products, customers }: { target: ImportTarget; products: PartnerProduct[]; customers: PartnerCustomer[] }) {
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  async function runExport(action: () => Promise<void>) {
    if (exportLock.current) return;
    exportLock.current = true; setExporting(true); setExportError('');
    try { await action(); }
    catch { setExportError('Não foi possível gerar a planilha. Confira a conexão e tente novamente.'); }
    finally { exportLock.current = false; setExporting(false); }
  }
  if (target === 'produtos') {
    return (
      <div className="export-btn-group">
        {exportError && <p role="alert">{exportError}</p>}
        <button className="rma-advance-btn" disabled={exporting} onClick={() => void runExport(() => exportProductsExcel(products))} title="Exportar para Excel">
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button className="rma-advance-btn" onClick={() => exportProductsCSV(products)} title="Exportar CSV">
          <Table size={14} /> CSV
        </button>
        <button className="rma-advance-btn" onClick={() => exportProductsPDF(products)} title="Exportar PDF">
          <FileText size={14} /> PDF
        </button>
      </div>
    );
  }
  return (
    <div className="export-btn-group">
      {exportError && <p role="alert">{exportError}</p>}
      <button className="rma-advance-btn" disabled={exporting} onClick={() => void runExport(() => exportCustomersExcel(customers))} title="Exportar para Excel">
        <FileSpreadsheet size={14} /> Excel
      </button>
      <button className="rma-advance-btn" onClick={() => exportCustomersCSV(customers)} title="Exportar CSV">
        <Table size={14} /> CSV
      </button>
      <button className="rma-advance-btn" onClick={() => exportCustomersPDF(customers)} title="Exportar PDF">
        <FileText size={14} /> PDF
      </button>
    </div>
  );
}

export function ImportExportModule({ products, customers, selectedBranchId, onAddProduct, onUpdateProduct, onAddCustomer }: Props) {
  const [target, setTarget] = useState<ImportTarget>('produtos');
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState('');
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapWarning, setMapWarning] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = target === 'produtos' ? productFields : customerFields;

  // Mapeamento duplicado: duas colunas do arquivo apontando para o mesmo
  // campo tornam a importação ambígua — o usuário deve corrigir antes.
  const duplicateFields: string[] = (() => {
    const used = Object.values(columnMap).filter((f) => f !== '');
    return [...new Set(used.filter((f, i) => used.indexOf(f) !== i))];
  })();

  function handleMapChange(colIndex: string, field: string) {
    setColumnMap((prev) => ({ ...prev, [colIndex]: field }));
    if (field !== '' && Object.entries(columnMap).some(([idx, f]) => idx !== colIndex && f === field)) {
      setMapWarning(`O campo "${fieldLabels[field] ?? field}" foi associado a mais de uma coluna. Corrija o mapeamento para evitar dados ambíguos.`);
    } else {
      setMapWarning(null);
    }
  }

  function applyAutoMap(data: ParsedData) {
    const autoMap: Record<string, string> = {};
    const ambiguityNotes: string[] = [];

    data.headers.forEach((h, i) => {
      const norm = normalizeHeader(h);
      if (norm === '') return;
      // Campos cujo sinônimo corresponde EXATAMENTE ao cabeçalho normalizado
      // (ou o cabeçalho é o próprio nome do campo). Correspondência exata evita
      // ambiguidade; se dois campos diferentes baterem na mesma coluna, não
      // escolhemos arbitrariamente — registramos e deixamos para o usuário.
      const matches = fields.filter(
        (f) =>
          normalizeHeader(f) === norm ||
          (fieldSynonyms[f] ?? []).some((syn) => syn === norm),
      );
      if (matches.length === 1 && !Object.values(autoMap).includes(matches[0])) {
        autoMap[String(i)] = matches[0];
      } else if (matches.length > 1) {
        ambiguityNotes.push(
          `Coluna "${h}" é ambígua (${matches.map((f) => fieldLabels[f] ?? f).join(' / ')}): ajuste o mapeamento manualmente.`,
        );
      }
    });

    setColumnMap(autoMap);
    if (ambiguityNotes.length > 0) {
      setMapWarning(ambiguityNotes.join(' '));
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    setParsed(null);
    setFileError(null);
    setMapWarning(null);

    const ext = (file.name.split('.').pop() ?? '').toLowerCase();

    // XML NF-e e PDF: formatos reconhecidos, porém não implementados nesta
    // etapa — nunca interpretar como CSV.
    if (ext === 'xml' || ext === 'pdf') {
      setFileError('Este formato ainda não está disponível para importação.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const data = await parseXLS(ev.target?.result as ArrayBuffer);
          if (data.headers.length === 0) {
            setFileError('Não foi possível ler a planilha: arquivo vazio ou sem dados.');
            return;
          }
          setParsed(data);
          applyAutoMap(data);
        } catch {
          setFileError('Não foi possível ler o arquivo Excel. Verifique se ele não está corrompido.');
        }
      };
      reader.onerror = () => setFileError('Falha ao ler o arquivo selecionado.');
      reader.readAsArrayBuffer(file);
      return;
    }

    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = parseCSV(String(ev.target?.result ?? ''));
        if (data.headers.length === 0) {
          setFileError('Não foi possível ler o CSV: arquivo vazio ou sem dados.');
          return;
        }
        setParsed(data);
        applyAutoMap(data);
      };
      reader.onerror = () => setFileError('Falha ao ler o arquivo selecionado.');
      reader.readAsText(file, 'UTF-8');
      return;
    }

    setFileError(`Formato ".${ext}" não suportado. Use CSV, XLS ou XLSX.`);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleImport() {
    if (!parsed) return;
    if (duplicateFields.length > 0) {
      setMapWarning(`Mapeamento ambíguo: os campos ${duplicateFields.map((f) => `"${fieldLabels[f] ?? f}"`).join(', ')} foram associados a mais de uma coluna. Corrija antes de importar.`);
      return;
    }
    if (!selectedBranchId) {
      setFileError('Selecione uma filial antes de importar.');
      return;
    }

    // ===== VALIDAÇÃO ESTRUTURAL (impede qualquer gravação) =====
    // Coluna de nome precisa estar mapeada: sem ela nenhuma linha é válida.
    const nameMapped = Object.values(columnMap).includes('name');
    if (!nameMapped && !(target === 'produtos' && Object.values(columnMap).includes('sku'))) {
      setFileError('Mapeie a coluna de Nome antes de importar: nenhum registro pode ser gravado sem nome.');
      return;
    }
    if (parsed.rows.length === 0) {
      setFileError('O arquivo não contém linhas de dados além do cabeçalho.');
      return;
    }

    setImporting(true);
    setImportResult(null);
    setFileError(null);

    const headerCount = parsed.headers.length;

    // getVal compartilhado entre validação e gravação (mesmo mapeamento).
    const makeGetVal = (row: ParsedRow) => (field: string) => {
      const idx = Object.entries(columnMap).find(([, f]) => f === field)?.[0];
      if (idx === undefined) return '';
      return row[Number(idx)] ?? '';
    };

    // ===== PRÉ-VALIDAÇÃO DE TODAS AS LINHAS (antes de qualquer RPC) =====
    // Monta o payload de cada linha válida e coleta erros por linha.
    // Linhas inválidas NUNCA chegam ao onAddProduct/onAddCustomer.
    type Prepared =
      | {
          kind: 'produto';
          line: number;
          payload: Parameters<typeof onAddProduct>[0];
          existingProductId?: string;
        }
      | { kind: 'cliente'; line: number; payload: Parameters<typeof onAddCustomer>[0] };

    const prepared: Prepared[] = [];
    const preErrors: ImportError[] = [];
    const seenSkus = new Map<string, number>();
    const seenDocs = new Map<string, number>();
    const seenEmails = new Map<string, number>();

    for (let ri = 0; ri < parsed.rows.length; ri++) {
      const row = parsed.rows[ri];
      const line = ri + 2; // linha 1 = cabeçalho
      const getVal = makeGetVal(row);

      try {
        if (row.length > headerCount) {
          throw new Error(`linha com ${row.length} colunas, mas o cabeçalho tem ${headerCount} (verifique separadores extras).`);
        }

        if (target === 'produtos') {
          const importedName = getVal('name').trim();
          let name = importedName || (getVal('sku').trim() ? ' ' : '');
          if (!name) throw new Error('Nome do produto obrigatório.');

          const readPrice = (field: string, label: string, fallback: number) => {
            const raw = getVal(field).trim();
            if (raw === '') return fallback;
            try {
              return parseBrazilianNumber(raw);
            } catch {
              throw new Error(`${label} inválido: "${raw}".`);
            }
          };
          const readInt = (field: string, label: string, fallback: number) => {
            const raw = getVal(field).trim();
            if (raw === '') return fallback;
            try {
              return parseBrazilianInteger(raw);
            } catch {
              throw new Error(`${label} inválido: "${raw}".`);
            }
          };

          const sku = getVal('sku').trim();
          if (sku) {
            const key = sku.toLowerCase();
            const first = seenSkus.get(key);
            if (first !== undefined) {
              preErrors.push({ line, message: `SKU "${sku}" duplicado no arquivo (já presente na linha ${first}).` });
              continue;
            }
            seenSkus.set(key, line);
          }

          let isService = false;
          const serviceRaw = getVal('is_service').trim();
          if (serviceRaw !== '') {
            try {
              isService = parseBrazilianBoolean(serviceRaw) ?? false;
            } catch (e) {
              throw new Error(`Serviço inválido: ${e instanceof Error ? e.message : serviceRaw}`);
            }
          }

          const matchingProducts = sku
            ? products.filter(
                (product) =>
                  product.branch_id === selectedBranchId &&
                  product.sku?.trim().toLowerCase() === sku.toLowerCase(),
              )
            : [];

          if (matchingProducts.length > 1) {
            throw new Error(`SKU "${sku}" corresponde a mais de um produto nesta filial.`);
          }

          const existingProduct = matchingProducts[0];
          name = importedName || existingProduct?.name || '';
          if (!name) throw new Error('Nome do produto obrigatorio para um SKU novo.');

          prepared.push({
            kind: 'produto',
            line,
            payload: {
              // Campos residuais obrigatórios do tipo (não persistidos pela RPC):
              // satisfeitos com valores neutros apenas para conformidade de tipo.
              brand: null,
              price: 0,
              image: null,
              active: true,
              description: null,
              name,
              sku: sku || null,
              cost_price: readPrice('cost_price', 'Preço de custo', 0),
              sale_price: readPrice('sale_price', 'Preço de venda', 0),
              wholesale_price: readPrice('wholesale_price', 'Preço de atacado', 0),
              stock: readInt('stock', 'Estoque', 0),
              min_stock: readInt('min_stock', 'Estoque mínimo', 0),
              image_url: null,
              category: getVal('category').trim() || null,
              is_service: isService,
              branch_id: selectedBranchId,
            },
            existingProductId: existingProduct?.id,
          });
        } else {
          const name = getVal('name').trim();
          if (!name) throw new Error('Nome do cliente obrigatório.');

          const documentVal = getVal('document').trim();
          if (documentVal) {
            const key = documentVal.replace(/\D/g, '').toLowerCase();
            const first = seenDocs.get(key);
            if (first !== undefined) {
              preErrors.push({ line, message: `Documento "${documentVal}" duplicado no arquivo (já presente na linha ${first}).` });
              continue;
            }
            seenDocs.set(key, line);
          }

          const emailVal = getVal('email').trim();
          if (emailVal) {
            if (!EMAIL_RE.test(emailVal)) {
              throw new Error(`E-mail inválido: "${emailVal}".`);
            }
            const key = emailVal.toLowerCase();
            const first = seenEmails.get(key);
            if (first !== undefined) {
              preErrors.push({ line, message: `E-mail "${emailVal}" duplicado no arquivo (já presente na linha ${first}).` });
              continue;
            }
            seenEmails.set(key, line);
          }

          let birthday: string | null = null;
          const birthdayRaw = getVal('birthday').trim();
          if (birthdayRaw !== '') {
            try {
              birthday = parseBrazilianDate(birthdayRaw);
            } catch (e) {
              throw new Error(`Aniversário inválido: ${e instanceof Error ? e.message : birthdayRaw}`);
            }
          }

          let customerType: 'varejo' | 'atacado' = 'varejo';
          const typeRaw = getVal('customer_type').trim();
          if (typeRaw !== '') {
            const norm = normalizeHeader(typeRaw);
            if (norm === 'varejo' || norm === 'atacado') {
              customerType = norm;
            } else {
              throw new Error(`Tipo de cliente inválido: "${typeRaw}" (use varejo ou atacado).`);
            }
          }

          let creditLimit = 0;
          const creditRaw = getVal('credit_limit').trim();
          if (creditRaw !== '') {
            try {
              creditLimit = parseBrazilianNumber(creditRaw);
            } catch {
              throw new Error(`Limite de crédito inválido: "${creditRaw}".`);
            }
            if (creditLimit < 0) throw new Error('Limite de crédito não pode ser negativo.');
          }

          let allowCredit = false;
          const allowRaw = getVal('allow_credit').trim();
          if (allowRaw !== '') {
            try {
              allowCredit = parseBrazilianBoolean(allowRaw) ?? false;
            } catch (e) {
              throw new Error(`Permite fiado inválido: ${e instanceof Error ? e.message : allowRaw}`);
            }
          }

          prepared.push({
            kind: 'cliente',
            line,
            payload: {
              // Campo residual obrigatório do tipo (não persistido pela RPC):
              // satisfeito com valor neutro apenas para conformidade de tipo.
              status: null,
              name,
              document: documentVal || null,
              phone: getVal('phone').trim() || null,
              email: emailVal || null,
              birthday,
              address: getVal('address').trim() || null,
              neighborhood: getVal('neighborhood').trim() || null,
              city: getVal('city').trim() || null,
              device_model: getVal('device_model').trim() || null,
              notes: getVal('notes').trim() || null,
              customer_type: customerType,
              credit_limit: creditLimit,
              allow_credit: allowCredit,
              branch_id: selectedBranchId,
            },
          });
        }
      } catch (err) {
        preErrors.push({ line, message: err instanceof Error ? err.message : 'Erro desconhecido ao validar a linha.' });
      }
    }

    // ===== GRAVAÇÃO (somente linhas válidas, via callbacks existentes) =====
    (async () => {
      const errors: ImportError[] = [...preErrors];
      let ok = 0;
      let fail = 0;

      for (const item of prepared) {
        try {
          if (item.kind === 'produto') {
            if (item.existingProductId) {
              const existingProduct = products.find(
                (product) => product.id === item.existingProductId,
              );

              if (!existingProduct) {
                throw new Error('Produto existente não foi localizado para atualização.');
              }

              const mappedFields = new Set(Object.values(columnMap));
              await onUpdateProduct(item.existingProductId, {
                ...item.payload,
                cost_price: mappedFields.has('cost_price')
                  ? item.payload.cost_price
                  : existingProduct.cost_price,
                sale_price: mappedFields.has('sale_price')
                  ? item.payload.sale_price
                  : existingProduct.sale_price,
                wholesale_price: mappedFields.has('wholesale_price')
                  ? item.payload.wholesale_price
                  : existingProduct.wholesale_price,
                stock: mappedFields.has('stock')
                  ? item.payload.stock
                  : existingProduct.stock,
                min_stock: mappedFields.has('min_stock')
                  ? item.payload.min_stock
                  : existingProduct.min_stock,
                category: mappedFields.has('category')
                  ? item.payload.category
                  : existingProduct.category,
                is_service: mappedFields.has('is_service')
                  ? item.payload.is_service
                  : existingProduct.is_service,
                image_url: existingProduct.image_url,
              });
            } else {
              await onAddProduct(item.payload);
            }
          } else {
            await onAddCustomer(item.payload);
          }
          ok++;
        } catch (err) {
          // Erro da RPC/Supabase: associado à linha, sem mascarar a mensagem.
          fail++;
          errors.push({ line: item.line, message: err instanceof Error ? err.message : 'Erro ao gravar no servidor.' });
        }
      }

      setImporting(false);
      // total = linhas de dados; valid = válidas na pré-validação;
      // ok = importadas via RPC; fail = inválidas + falhas de RPC.
      setImportResult({
        total: parsed.rows.length,
        valid: prepared.length,
        ok,
        fail: parsed.rows.length - ok,
        errors,
      });
      void fail;
    })();
  }

  function reset() {
    setParsed(null);
    setFileName('');
    setColumnMap({});
    setImportResult(null);
    setFileError(null);
    setMapWarning(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div>
      <div className="subtab-bar">
        <button className={`subtab ${target === 'produtos' ? 'active' : ''}`} onClick={() => { setTarget('produtos'); reset(); }}>
          <FileSpreadsheet size={15} /> Importar Estoque
        </button>
        <button className={`subtab ${target === 'clientes' ? 'active' : ''}`} onClick={() => { setTarget('clientes'); reset(); }}>
          <Users size={15} /> Importar Clientes
        </button>
      </div>

      <div className="rma-form">
        <label>
          Arquivo para Importação (CSV, XLS ou XLSX)
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFile}
            style={{ padding: '8px' }}
          />
        </label>
        {fileError && (
          <p className="otp-error-msg" style={{ marginTop: '8px' }}>{fileError}</p>
        )}
        {fileName && parsed && (
          <div className="otp-sent-hint">
            <File size={14} /> Arquivo carregado: <strong>{fileName}</strong> ({parsed.rows.length} linhas detectadas)
          </div>
        )}
      </div>

      {parsed && parsed.headers.length > 0 && (
        <div className="rma-form" style={{ marginTop: '14px' }}>
          <div className="module-card-title">
            <ArrowRight size={16} /> Mapeamento de Colunas
          </div>
          <p style={{ color: '#7f97a9', fontSize: '13px', marginBottom: '12px' }}>
            Associe cada coluna do arquivo ao campo correspondente no sistema:
          </p>
          {mapWarning && (
            <p className="otp-error-msg" style={{ marginBottom: '12px' }}>{mapWarning}</p>
          )}
          {parsed.headers.map((h, i) => (
            <div key={i} className="import-map-row">
              <span className="import-map-source">{h}</span>
              <ArrowRight size={14} />
              <select
                value={columnMap[String(i)] ?? ''}
                onChange={(e) => handleMapChange(String(i), e.target.value)}
              >
                <option value="">— Ignorar —</option>
                {fields.map((f) => (
                  <option key={f} value={f}>{fieldLabels[f]}</option>
                ))}
              </select>
            </div>
          ))}

          <div className="import-preview">
            <div className="module-card-title"><Table size={16} /> Pré-visualização (5 primeiras linhas)</div>
            <div className="stock-table-wrap">
              <table className="rma-table">
                <thead><tr>{parsed.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, ri) => (
                    <tr key={ri}>{row.map((c, ci) => <td key={ci}>{c || '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="otp-actions">
            <button className="rma-advance-btn" onClick={reset}>
              <X size={16} /> Cancelar
            </button>
            <button
              className="module-submit-btn"
              onClick={handleImport}
              disabled={importing || duplicateFields.length > 0}
              title={duplicateFields.length > 0 ? 'Corrija o mapeamento de colunas duplicado antes de importar.' : undefined}
            >
              <Upload size={16} /> {importing ? 'Importando...' : `Importar ${parsed.rows.length} registros`}
            </button>
          </div>

          {importResult && (
            <div className="otp-sent-hint" style={{ display: 'block', color: importResult.fail > 0 ? '#e6a06d' : '#5bbc87' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Check size={14} /> <strong>Importação concluída</strong>
              </div>
              <p style={{ margin: '6px 0 0 20px' }}>
                Total de linhas: {importResult.total} · Válidas: {importResult.valid} · Importadas: {importResult.ok} · Falharam: {importResult.fail}
              </p>
              {importResult.ok > 0 && importResult.fail > 0 && (
                <p style={{ margin: '4px 0 0 20px' }}>
                  Importação parcial: apenas as linhas válidas foram gravadas.
                </p>
              )}
              {importResult.errors.length > 0 && (
                <div style={{ margin: '8px 0 0 20px' }}>
                  <strong>Erros:</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                    {importResult.errors.map((err, i) => (
                      <li key={i}>Linha {err.line} — {err.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="section-divider"><span className="section-divider-label">Exportar Dados</span></div>

      <div className="rma-form">
        <div className="module-card-title"><Download size={16} /> Exportar {target === 'produtos' ? 'Produtos' : 'Clientes'}</div>
        <p style={{ color: '#7f97a9', fontSize: '13px', marginBottom: '12px' }}>
          Baixe os dados cadastrados em formato Excel, CSV ou PDF:
        </p>
        <ExportButtons target={target} products={products} customers={customers} />
      </div>
    </div>
  );
}
