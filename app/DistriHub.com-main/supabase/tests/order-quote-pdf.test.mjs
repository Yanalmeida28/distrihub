import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require = createRequire(import.meta.url);
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const pdv = {};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/pdv.ts', import.meta.url), 'utf8')), { exports: pdv });
const api = {};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/orderQuotePdf.ts', import.meta.url), 'utf8')), {
  exports: api, Date, Intl, Error,
  require: name => name === './pdv' ? pdv : name === '../utils' ? { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) } : require(name),
});
function pdfText(pdf) {
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const raw = bytes.toString('latin1');
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return match[1]; }
  }).join('\n');
}
const sale = { id: 'order-1', sale_number: 42, status: 'pre_venda', customer_id: 'customer', customer_name: 'João da Silva', branch_id: 'branch',
  created_at: '2026-10-23T01:30:00Z', total: 120, freight_fee: 15, items: [{ name: 'Peça de reposição', quantity: 2, unit_price: 60, unit_cost: 99999 }] };

test('preloads the personalized logo, preserves proportions and uses bold labels', async () => {
  const exports = {}, images = [];
  class Image {
    naturalWidth = 400; naturalHeight = 100;
    set src(value) { this.url = value; images.push(this); queueMicrotask(() => this.onload?.()); }
  }
  const { jsPDF } = require('jspdf');
  const placements = [];
  vm.runInNewContext(compile(await readFile(new URL('../../src/lib/orderQuotePdf.ts', import.meta.url), 'utf8')), {
    exports, Date, Intl, Error, Image, setTimeout, clearTimeout,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'logo-data' }) },
    require: name => name === 'jspdf' ? { jsPDF: function(options) {
      const pdf = new jsPDF(options); pdf.addImage = (...args) => { placements.push(args); return pdf; }; return pdf;
    } } : name === './pdv' ? pdv : name === '../utils' ? { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) } : require(name),
  });
  const url = 'https://example.com/store-logo.png';
  await Promise.all([exports.prepareOrderQuoteLogo(url), exports.prepareOrderQuoteLogo(url)]);
  const { pdf } = exports.buildOrderQuotePdf(sale, { settings: { logo_url: url, show_logo_on_receipt: false } });
  assert.equal(images.length, 1);
  assert.equal(images[0].crossOrigin, 'anonymous');
  assert.deepEqual(placements[0].slice(0, 2), ['logo-data', 'PNG']);
  assert.equal(placements[0][4], 50); assert.equal(placements[0][5], 12.5);
  const text = pdfText(pdf);
  assert.match(text, /\/F2 [\s\S]*?\(Data do pedido:\)/);
  assert.ok(text.includes('TOTAL DO ORÇAMENTO:'));
  exports.buildOrderQuotePdf(sale);
  assert.equal(placements.length, 1);
});
test('gera PDF real com cliente, filial do pedido e total com frete, sem custos ou confirmação de pagamento', () => {
  const { pdf, filename } = api.buildOrderQuotePdf(sale, { companyName: 'Empresa', companyDocument: '12.345.678/0001-00',
    companyAddress: 'Endereço consolidado errado', branches: [{ id: 'other', name: 'Outra loja', address: 'Rua errada' }, { id: 'branch', name: 'Filial correta', address: 'Rua certa' }],
    customer: { id: 'customer', name: 'João da Silva', phone: '11999999999', email: 'cliente@example.com' }, salespersonName: 'Maria' });
  const text = pdfText(pdf);
  assert.equal(filename, 'orcamento-000042.pdf');
  for (const expected of ['ORÇAMENTO', 'João da Silva', 'Filial correta', 'Rua certa', '11999999999', 'cliente@example.com', 'Maria', '120,00', '15,00', '135,00', '22/10/2026']) assert.ok(text.includes(expected), expected);
  assert.ok(text.includes('não comprova pagamento')); assert.ok(!text.includes('99.999,00')); assert.ok(!text.includes('Rua errada')); assert.ok(!text.includes('Endereço consolidado errado'));
});
test('pedidos longos geram múltiplas páginas com cabeçalhos repetidos e todos os itens', () => {
  const items = Array.from({ length: 250 }, (_, index) => ({ name: `Produto ${index + 1} com descrição longa para orçamento`, quantity: 1, unit_price: 10 }));
  const { pdf } = api.buildOrderQuotePdf({ ...sale, items, total: 2500, freight_fee: 0 });
  const text = pdfText(pdf);
  assert.ok(pdf.getNumberOfPages() > 3); assert.ok(text.includes('Produto 1 ')); assert.ok(text.includes('Produto 250 '));
  assert.ok(text.includes('2.500,00')); assert.equal((text.match(/\(Qtd\.\)/g) ?? []).length, pdf.getNumberOfPages());
});
test('descrição maior que uma página não é cortada nem cria loop; cliente de outro pedido não vaza no documento', () => {
  const { pdf } = api.buildOrderQuotePdf({ ...sale, items: [{ name: 'Detalhe '.repeat(1800) + 'FIM-DESCRICAO', quantity: 1, unit_price: 120 }] },
    { customer: { id: 'foreign', name: 'Outro cliente', email: 'nao-vazar@example.com' } });
  const text = pdfText(pdf);
  assert.ok(pdf.getNumberOfPages() > 1); assert.ok(text.includes('FIM-DESCRICAO')); assert.ok(!text.includes('nao-vazar'));
});
test('pedido concluído ou cancelado não é apresentado como orçamento em aberto', () => {
  for (const status of ['concluida', 'cancelada']) assert.throws(() => api.buildOrderQuotePdf({ ...sale, status }), /não está mais aberto/);
});

async function sharingHarness(navigator) {
  const exports = {}, saved = [];
  const { jsPDF } = require('jspdf');
  vm.runInNewContext(compile(await readFile(new URL('../../src/lib/orderQuotePdf.ts', import.meta.url), 'utf8')), {
    exports, Date, Intl, Error, File, navigator,
    require: name => name === 'jspdf' ? {jsPDF: function(options) {const pdf = new jsPDF(options);pdf.save = async filename => {saved.push(filename);};return pdf;}}
      : name === './pdv' ? pdv : name === '../utils' ? {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})} : require(name),
  });
  return {api:exports,saved};
}
test('share attaches a real PDF immediately and does not download or finalize the order', async () => {
  let attached;
  const {api,saved} = await sharingHarness({canShare:({files})=>files[0].type === 'application/pdf',share:async data=>{attached=data.files[0];}});
  const pending = api.shareOrderQuotePdf(sale);
  assert.equal(attached.name,'orcamento-000042.pdf');
  assert.equal(await pending,'shared');
  assert.equal(Buffer.from(await attached.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  assert.deepEqual(saved,[]);assert.equal(sale.status,'pre_venda');
});
test('cancelled share never downloads or claims success', async () => {
  const error = new Error('cancelled');error.name='AbortError';
  const {api,saved} = await sharingHarness({canShare:()=>true,share:async()=>{throw error;}});
  assert.equal(await api.shareOrderQuotePdf(sale),'cancelled');assert.deepEqual(saved,[]);
});
test('unsupported or permission-blocked sharing downloads the same quote', async () => {
  const denied = new Error('blocked');denied.name='NotAllowedError';
  for(const navigator of [{},{canShare:()=>false,share:async()=>{throw Error('must not share');}},{canShare:()=>true,share:async()=>{throw denied;}}]) {
    const {api,saved}=await sharingHarness(navigator);assert.equal(await api.shareOrderQuotePdf(sale),'downloaded');assert.deepEqual(saved,['orcamento-000042.pdf']);
  }
});
