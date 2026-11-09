import { splitPaymentComponent } from './fixtures/split_payment_component.mjs';
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const helpers = {};
const sessionDraftMocks = {
  SessionDraftProvider: ({ children }) => children,
  useSessionDraftScope: () => 'test',
  useSessionDraftState: (_draftId, initialValue) => React.useState(initialValue),
};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/pdv.ts', import.meta.url), 'utf8')), { exports: helpers, Error });
const source = compile(await readFile(new URL('../../src/components/partner/PdvModule.tsx', import.meta.url), 'utf8')) + '\nexports.Checkout = PdvCheckout;';
function loadCheckout(react, printing = {}) {
const module = { exports: {} };
const saved = new Map();
const localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key), get length() { return saved.size; }, key: index => [...saved.keys()][index] ?? null };
vm.runInNewContext(source, {
  exports: module.exports, Date, Error, setTimeout: () => 1,
  window: { localStorage, open: printing.open ?? (() => null), setTimeout: () => 1, clearTimeout() {} },
  require(name) {
    if (name === '../../lib/salePrint') return { directReceiptEnabled: () => Boolean(printing.direct), printSale: printing.printSale ?? (() => {}) };
    if(name==='./SplitPaymentFields') return splitPaymentComponent;
    if (name === 'react') return react;
    if (name === '../../lib/pdv') return helpers;
    if (name === '../../hooks/useSessionDraft') return { ...sessionDraftMocks, useSessionDraftState: (_draftId, initialValue) => react.useState(initialValue) };
    if (name === '../../utils') return { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) };
    if (name === './PreSaleCheckout') return {};
    if (name === './SalePriceInput') return { SalePriceInput: props => React.createElement('input', { value: props.value, readOnly: true }) };
    return require(name);
  },
});
return module.exports;
}
const module = { exports: loadCheckout(React) };
const props = {
  products: [{ id: 'product', name: 'Produto', sku: 'SKU', branch_id: 'branch', stock: 5, sale_price: 100 }],
  customers: [], salespeople: [], credits: [], selectedBranchId: 'branch', segment: 'assistencia',
  canCheckout: true, canEditPrice: false, onCreateSale: async () => {},
};
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
const controls = () => renderer.root.findByProps({ 'aria-label': 'Opções da venda' });
test('product results stay hidden until a search and clearing it preserves the cart',async()=>{
 await act(async()=>{renderer=TestRenderer.create(React.createElement(module.exports.Checkout,props));});
 const results=()=>renderer.root.findByProps({'aria-label':'Resultados da pesquisa'});
 const search=()=>renderer.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'});
 assert.equal(results().props.hidden,true);
 await act(async()=>search().props.onChange({target:{value:'   '}}));assert.equal(results().props.hidden,true);
 await act(async()=>search().props.onChange({target:{value:props.products[0].name}}));assert.equal(results().props.hidden,false);
 await act(async()=>renderer.root.findByProps({className:'pdv-product-card'}).props.onClick());
 await act(async()=>search().props.onChange({target:{value:''}}));assert.equal(results().props.hidden,true);
 assert.ok(renderer.root.findByProps({'aria-label':'Carrinho'}).findByProps({'aria-label':'Remover '+props.products[0].name}));
 await act(async()=>search().props.onChange({target:{value:'produto-inexistente-xyz'}}));
 assert.equal(results().props.hidden,false);assert.match(JSON.stringify(results().findByProps({className:'empty-row'}).children),/Nenhum produto/);
});

test('checkout places customer type and customer picker in the same layout row', async () => {
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, props)); });
  const form = renderer.root.findByProps({ className: 'pdv-form' });
  const fields = renderer.root.findByProps({ className: 'pdv-customer-fields' });
  const actions = renderer.root.findByProps({ className: 'pdv-checkout-actions' });
  assert.ok(fields.findByType('select'));
  assert.equal(fields.findAll(node => typeof node.type === 'function' && node.type.name === 'CustomerSearchPicker').length, 1);
  assert.deepEqual(actions.findAllByType('button').map(button => button.props.children.filter(child => typeof child === 'string').join('').trim()), [
    'Finalizar e imprimir',
    'Finalizar sem imprimir',
  ]);
  assert.deepEqual(form.children.map(section => section.props.className), [
    'pdv-form-section pdv-customer-section',
    'pdv-form-section pdv-payment-section',
    'pdv-form-section pdv-delivery-section',
  ]);
  assert.equal(form.findAll(node => node.props.className === 'pdv-form-section-label').some(label =>
    label.children.some(text => text === 'Cliente' || text === 'Pagamento' || text === 'Entrega')
  ), false);
});

test('mobile shortcuts navigate and focus without submitting or changing the sale', async () => {
  const visits = [];
  let submissions = 0;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.exports.Checkout, {
      ...props, cameraScannerEnabled: true, onCreateSale: async () => { submissions++; },
    }), { createNodeMock: element => ({
      scrollIntoView() { visits.push(['scroll', element.props['aria-label']]); },
      focus() { visits.push(['focus', element.props['aria-label']]); },
    }) });
  });
  const shortcuts = () => renderer.root.findByProps({ 'aria-label': 'Atalhos da venda' }).findAllByType('button');
  assert.equal(shortcuts().length, 4);
  assert.equal(shortcuts()[3].props.disabled, true);
  await act(async () => shortcuts()[0].props.onClick());
  assert.deepEqual(visits.map(visit => visit[0]), ['scroll', 'focus']);
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  assert.equal(shortcuts()[3].props.disabled, false);
  assert.ok(shortcuts()[3].findByType('strong').children.join('').includes('100,00'));
  visits.length = 0;
  await act(async () => shortcuts()[2].props.onClick());
  await act(async () => shortcuts()[3].props.onClick());
  assert.deepEqual(visits.map(visit => visit[1]), [
    'Carrinho', 'Carrinho', 'Pagamento e entrega', 'Pagamento e entrega',
  ]);
  assert.equal(submissions, 0);
  await act(async () => renderer.update(React.createElement(module.exports.Checkout, { ...props, isActive: false })));
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Atalhos da venda' }).length, 0);
});

test('checkout enables cart scrolling starting with six products', async () => {
  const products = Array.from({ length: 6 }, (_, index) => ({
    id: `product-${index}`,
    name: `Produto ${index}`,
    sku: `SKU-${index}`,
    branch_id: 'branch',
    stock: 5,
    sale_price: 100,
  }));
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, { ...props, products })); });
  const cartWrapper = () => renderer.root.findAll(node => typeof node.type === 'string' && node.props.className?.startsWith('pdv-cart-table-wrap'))[0];
  const addProduct = index => renderer.root.findAll(node => typeof node.type === 'string' && node.props.className?.startsWith('pdv-product-card'))[index].props.onClick();

  for (let index = 0; index < 5; index += 1) {
    await act(async () => addProduct(index));
  }
  assert.equal(cartWrapper().props.className, 'pdv-cart-table-wrap');

  await act(async () => addProduct(5));
  assert.equal(cartWrapper().props.className, 'pdv-cart-table-wrap pdv-cart-table-scrollable');
});

test('new checkout applies customer return credit to a purchase and charges only the difference',async()=>{
 let submitted;
 const rma={id:'rma',customer_id:'customer',branch_id:'branch',status:'credito_gerado',product_name:'Returned product',credit_amount:50,credit_used_amount:0};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(module.exports.Checkout,{...props,customers:[{id:'customer',name:'Cliente',customer_type:'varejo'}],rmaRequests:[rma,{...rma,id:'foreign-credit',customer_id:'other',credit_amount:1000}],onCreateSale:async sale=>{submitted=sale;return {...sale,id:'confirmed'};}}));});
 await act(async()=>renderer.root.findByProps({className:'pdv-product-card'}).props.onClick());
 const selectCustomer=id=>renderer.root.findAll(node=>typeof node.type==='function'&&node.type.name==='CustomerSearchPicker')[0].props.onSelect(id);
 await act(async()=>selectCustomer('customer'));
 const chooser=()=>renderer.root.findByProps({'aria-label':'Crédito RMA para a compra'});
 assert.equal(chooser().findAllByType('option').length,2);
 await act(async()=>chooser().props.onChange({target:{value:'rma'}}));
 assert.equal(renderer.root.findByProps({'aria-label':'Valor do crédito RMA na compra'}).props.value,'50');
 await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
 assert.equal(submitted.total,100);assert.equal(submitted.rma_credit_id,'rma');assert.equal(submitted.payment_method,'misto');
 assert.deepEqual(JSON.parse(JSON.stringify(submitted.payment_splits)),[{method:'credito_rma',amount:50},{method:'pix',amount:50}]);
});

test('checkout refuses excessive return credit, preserves it after a server failure, and clears it on customer change',async()=>{
 let calls=0;
 const rma={id:'rma',customer_id:'customer',branch_id:'branch',status:'credito_gerado',product_name:'Returned product',credit_amount:50,credit_used_amount:0};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(module.exports.Checkout,{...props,customers:[{id:'customer',name:'Cliente',customer_type:'varejo'},{id:'other',name:'Outro',customer_type:'varejo'}],rmaRequests:[rma],onCreateSale:async()=>{calls++;throw Error('Falha de conexão');}}));});
 await act(async()=>renderer.root.findByProps({className:'pdv-product-card'}).props.onClick());
 const selectCustomer=id=>renderer.root.findAll(node=>typeof node.type==='function'&&node.type.name==='CustomerSearchPicker')[0].props.onSelect(id);
 await act(async()=>selectCustomer('customer'));
 await act(async()=>renderer.root.findByProps({'aria-label':'Crédito RMA para a compra'}).props.onChange({target:{value:'rma'}}));
 const amount=()=>renderer.root.findByProps({'aria-label':'Valor do crédito RMA na compra'});
 await act(async()=>amount().props.onChange({target:{value:'51'}}));
 await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());assert.equal(calls,0);
 await act(async()=>amount().props.onChange({target:{value:'50'}}));
 await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());assert.equal(calls,1);
 assert.equal(amount().props.value,'50');
 await act(async()=>selectCustomer('other'));
 assert.equal(renderer.root.findByProps({'aria-label':'Crédito RMA para a compra'}).props.value,'');
});

test('rescued sale opens the full editable checkout with saved fields and submits changed cart', async () => {
  let submitted;
  const rescuedSale = { id: 'original', sale_number: 42, customer_id: null, customer_name: 'Consumidor',
    items: [{ product_id: 'product', name: 'Produto', quantity: 2, unit_price: 100, subtotal: 200 }],
    total: 200, freight_fee: 12, customer_type: 'varejo', delivery_type: 'entrega', payment_method: 'dinheiro', salesperson_id: null };
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, {
    ...props, rescuedSale, onCreateSale: async sale => { submitted = sale; return { ...rescuedSale, ...sale }; },
  })); });
  assertVisibleControls();
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Frete terceirizado' }).props.value, 12);
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Tipo de atendimento da venda' }).props.value, 'entrega');
  assert.ok(renderer.root.findByProps({ role: 'status' }).children.some(node => typeof node !== 'string' && node.props?.children?.toString().includes('Editando pré-venda')));
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  await act(async () => renderer.root.findByProps({ className: 'module-cancel-btn pdv-checkout-btn' }).props.onClick());
  assert.equal(submitted.items[0].quantity, 3);
  assert.equal(submitted.items[0].subtotal, 300);
  assert.equal(submitted.total, 300);
  assert.equal(submitted.freight_fee, 12);
  assert.equal(submitted.payment_method, 'dinheiro');
});
test('split checkout rejects a missing balance, completes remaining PIX and submits each part including freight',async()=>{
  let submitted;
  await act(async()=>{renderer=TestRenderer.create(React.createElement(module.exports.Checkout,{...props,onCreateSale:async sale=>{submitted=sale;}}));});
  await act(async()=>renderer.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));
  await act(async()=>renderer.root.findByProps({className:'pdv-product-card'}).props.onClick());
  await act(async()=>renderer.root.findByProps({'aria-label':'Tipo de atendimento da venda'}).props.onChange({target:{value:'entrega'}}));
  await act(async()=>renderer.root.findByProps({'aria-label':'Frete terceirizado'}).props.onChange({target:{value:'15'}}));
  const paymentSelect=()=>renderer.root.findAllByType('select').find(node=>node.findAllByType('option').some(option=>option.props.value==='misto'));
  await act(async()=>paymentSelect().props.onChange({target:{value:'misto'}}));
  assert.equal(renderer.root.findByProps({'aria-label':'Valor em Dinheiro'}).props.value,'');
  await act(async()=>renderer.root.findByProps({'aria-label':'Valor em Dinheiro'}).props.onChange({target:{value:'50'}}));
  await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
  assert.equal(submitted,undefined);
  assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/duas formas/);
  await act(async()=>renderer.root.findAllByType('button').find(node=>node.children.includes('Completar restante no PIX')).props.onClick());
  assert.equal(renderer.root.findByProps({'aria-label':'Valor em PIX'}).props.value,'65.00');
  await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
  assert.equal(submitted.payment_method,'misto');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.payment_splits)),[{method:'dinheiro',amount:50},{method:'pix',amount:65}]);
  assert.equal(submitted.total,100); assert.equal(submitted.freight_fee,15);
});
function assertVisibleControls() {
  assert.ok(controls().findByProps({ 'aria-label': 'Tabela de preços da venda' }));
  assert.ok(controls().findByProps({ id: 'pdv-customer-search' }));
  assert.ok(controls().findByProps({ 'aria-label': 'Tipo de atendimento da venda' }));
  assert.ok(controls().findByProps({ id: 'pdv-salesperson-search' }));
}
test('pesquisa fica à esquerda e carrinho acima das opções à direita', async () => {
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, props)); });
  assertVisibleControls();
  const left = renderer.root.findByProps({ className: 'pdv-left' });
  assert.equal(left.children[0].props.className, 'pdv-search-bar');
  assert.equal(left.findAllByProps({ className: 'pdv-product-card' }).length, 1);
  assert.equal(left.findAllByProps({ 'aria-label': 'Carrinho' }).length, 0);
  const layout = renderer.root.findByProps({ className: 'pdv-layout pdv-checkout-layout' });
  assert.equal(layout.children[0], left);
  assert.equal(layout.children[1].props['aria-label'], 'Opções da venda');
  assert.equal(layout.children[1].children[0].props['aria-label'], 'Carrinho');
});
test('leitor de código adiciona o produto pelo SKU e leituras repetidas aumentam a quantidade', async () => {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.exports.Checkout, {
      ...props,
      products: [{ ...props.products[0], sku: '0789012345678' }],
    }));
  });
  const searchInput = renderer.root.findByProps({ 'aria-label': 'Buscar produto por nome, SKU ou código de barras' });
  const scan = async () => {
    await act(async () => searchInput.props.onChange({ target: { value: '0789012345678' } }));
    let prevented = false;
    await act(async () => searchInput.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true; } }));
    assert.equal(prevented, true);
  };
  await scan();
  await scan();
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Carrinho' }).findByType('b').children[0], '2');
});
test('leitor desativado não adiciona produto ao confirmar a busca com Enter', async () => {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(module.exports.Checkout, {
      ...props,
      barcodeScannerEnabled: false,
      products: [{ ...props.products[0], sku: '0789012345678' }],
    }));
  });
  const searchInput = renderer.root.findByProps({ 'aria-label': 'Buscar produto por nome, SKU ou código de barras' });
  await act(async () => searchInput.props.onChange({ target: { value: '0789012345678' } }));
  let prevented = false;
  await act(async () => searchInput.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true; } }));
  assert.equal(prevented, true);
  assert.match(renderer.root.findByProps({ 'aria-label': 'Carrinho' }).findByType('tbody').children[0].findAllByType('td')[0].children.join(''), /Carrinho vazio/);
});
test('selecionar e remover o último produto mantém as opções da venda visíveis', async () => {
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, props)); });
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Buscar produto por nome, SKU ou código de barras' }).props.onChange({ target: { value: 'Produto' } }));
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  assertVisibleControls();
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Remover Produto' }).props.onClick());
  assertVisibleControls();
});

test('botão da câmera aparece apenas quando leitura pela câmera está ativada', async () => {
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, props)); });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Ler código pela câmera' }).length, 0);
  await act(async () => renderer.update(React.createElement(module.exports.Checkout, { ...props, cameraScannerEnabled: true })));
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Ler código pela câmera' }).length, 1);
});

test('checkout collects freight separately and resets it after the confirmed sale', async () => {
  let submitted;
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, {...props,onCreateSale:async sale=>{submitted=sale;}})); });
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Buscar produto por nome, SKU ou código de barras' }).props.onChange({ target: { value: 'Produto' } }));
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  await act(async()=>renderer.root.findByProps({'aria-label':'Tipo de atendimento da venda'}).props.onChange({target:{value:'entrega'}}));
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Frete terceirizado' }).props.onChange({ target: { value:'15.25' } }));
  assert.equal(renderer.root.findByProps({className:'pdv-total-bar'}).findByType('strong').children.join(''),new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(115.25));
  await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
  assert.equal(submitted.total,100);
  assert.equal(submitted.freight_fee,15.25);
  assert.equal(renderer.root.findAllByProps({'aria-label':'Frete terceirizado'}).length,0);
  await act(async()=>renderer.root.findByProps({'aria-label':'Tipo de atendimento da venda'}).props.onChange({target:{value:'entrega'}}));
  assert.equal(renderer.root.findByProps({'aria-label':'Frete terceirizado'}).props.value,0);
});

test('freight zero can be cleared and an empty field is submitted as zero', async () => {
  let submitted;
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.Checkout, {...props,onCreateSale:async sale=>{submitted=sale;}})); });
  assert.equal(renderer.root.findAllByProps({'aria-label':'Frete terceirizado'}).length,0);
  await act(async()=>renderer.root.findByProps({'aria-label':'Tipo de atendimento da venda'}).props.onChange({target:{value:'entrega'}}));
  await act(async()=>renderer.root.findByProps({'aria-label':'Frete terceirizado'}).props.onChange({target:{value:''}}));
  assert.equal(renderer.root.findByProps({'aria-label':'Frete terceirizado'}).props.value,'');
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Buscar produto por nome, SKU ou código de barras' }).props.onChange({ target: { value: 'Produto' } }));
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  await act(async()=>renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
  assert.equal(submitted.freight_fee,0);
  assert.equal(submitted.total,100);
});

test('finalizar e imprimir aguarda confirmação, imprime a venda salva e bloqueia envio duplicado', async () => {
  const events = [];
  const popup = { document: { body: {} }, closed: false, close() { this.closed = true; } };
  let resolveSale;
  let submitted;
  const Checkout = loadCheckout(React, {
    open: () => { events.push('open'); return popup; },
    printSale: (...args) => { events.push('print'); submitted = args; },
  }).Checkout;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Checkout, {
    ...props, receiptDetails: { companyName: 'DistriHub' },
    onCreateSale: () => { events.push('save'); return new Promise(resolve => { resolveSale = resolve; }); },
  })); });
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  const button = renderer.root.findByProps({ className: 'module-submit-btn pdv-checkout-btn' });
  assert.ok(button.children.includes('Finalizar e imprimir'));
  let checkout;
  await act(async () => { checkout = button.props.onClick(); });
  assert.deepEqual(events, ['open', 'save']);
  assert.equal(button.props.disabled, true);
  await act(async () => button.props.onClick());
  assert.deepEqual(events, ['open', 'save']);
  const saved = { id: 'confirmed-sale', customer_id: null, salesperson_id: null, total: 100, items: props.products };
  await act(async () => { resolveSale(saved); await checkout; });
  assert.deepEqual(events, ['open', 'save', 'print']);
  assert.equal(submitted[0], saved);
  assert.equal(submitted[1], 'receipt');
  assert.equal(submitted[2].companyName, 'DistriHub');
  assert.equal(submitted[3], popup);
});

test('venda rejeitada fecha a janela e mantém o carrinho sem imprimir', async () => {
  let prints = 0;
  const popup = { document: { body: {} }, closed: false, close() { this.closed = true; } };
  const Checkout = loadCheckout(React, { open: () => popup, printSale: () => { prints++; } }).Checkout;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Checkout, { ...props, onCreateSale: async () => { throw new Error('Venda recusada'); } })); });
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  await act(async () => renderer.root.findByProps({ className: 'module-submit-btn pdv-checkout-btn' }).props.onClick());
  assert.equal(prints, 0);
  assert.equal(popup.closed, true);
  assert.equal(renderer.root.findByProps({ className: 'module-submit-btn pdv-checkout-btn' }).props.disabled, false);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /Venda recusada/);
});

test('falha de impressão conserva a venda concluída e orienta reimpressão sem nova venda', async () => {
  let saves = 0;
  const popup = { document: { body: {} }, closed: false, close() { this.closed = true; } };
  const Checkout = loadCheckout(React, { open: () => popup, printSale: () => { throw new Error('Reimprima pelo Histórico.'); } }).Checkout;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Checkout, { ...props, onCreateSale: async () => { saves++; return { id: 'confirmed-sale' }; } })); });
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  await act(async () => renderer.root.findByProps({ className: 'module-submit-btn pdv-checkout-btn' }).props.onClick());
  assert.equal(saves, 1);
  assert.equal(renderer.root.findByProps({ className: 'module-submit-btn pdv-checkout-btn' }).props.disabled, true);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /Venda finalizada.*Histórico/);
});

test('finalizar sem imprimir salva uma vez sem abrir janela', async () => {
  let saves = 0;
  const Checkout = loadCheckout(React, { open: () => assert.fail('Não deve abrir janela'), printSale: () => assert.fail('Não deve imprimir') }).Checkout;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Checkout, { ...props, onCreateSale: async () => { saves++; return { id: 'confirmed-sale' }; } })); });
  await act(async () => renderer.root.findByProps({ className: 'pdv-product-card' }).props.onClick());
  await act(async () => renderer.root.findByProps({ className: 'module-cancel-btn pdv-checkout-btn' }).props.onClick());
  assert.equal(saves, 1);
  assert.equal(renderer.root.findByProps({ className: 'module-submit-btn pdv-checkout-btn' }).props.disabled, true);
});

// Optional isolated browser fixture, with synthetic data and no account credentials.
if (process.env.PDV_BROWSER_FIXTURE === '1') {
  const directory = new URL('../../.tmp/pdv-toolbar/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  const browserReact = require('../../node_modules/react');
  const markup = renderToStaticMarkup(browserReact.createElement(loadCheckout(browserReact).Checkout, { ...props, cameraScannerEnabled: true }));
  await writeFile(new URL('preview.html', directory), `<!doctype html><meta charset="utf-8"><style>${css}</style>
    <div class="partner-panel sidebar-layout partner-pdv-mode" style="width:100%;background:white;--dh-surface:white;--dh-border:#ccc;--dh-blue:#2563eb;--dh-blue-soft:#eff6ff;--dh-accent-text:#172033">
      <aside class="partner-sidebar"><div class="sidebar-header">DistriHub</div></aside>
      <div class="sidebar-main"><div class="sidebar-main-inner"><div class="partner-content"><div class="panel-module pdv-workspace pdv-workspace-checkout"><div class="pdv-checkout-slot">${markup}</div></div></div></div></div></div>
    <pre id="audit"></pre><script>
      const workspace=document.querySelector('.pdv-workspace');
      workspace.style.setProperty('--pdv-height',(innerHeight-workspace.getBoundingClientRect().top)+'px');
      if(location.search.includes('filled=1')) {
        document.querySelector('.pdv-cart-table tbody').innerHTML=Array.from({length:18},(_,i)=>'<tr><td>Produto '+(i+1)+'</td><td>1</td><td>R$ 100,00</td><td>R$ 100,00</td><td>Remover</td></tr>').join('');
        document.querySelector('.pdv-cart-table-wrap').classList.add('pdv-cart-table-scrollable');
        document.querySelector('.pdv-cart-table-wrap').scrollTop=10000;
        document.querySelector('.pdv-left').scrollTop=10000;
      }
      const fields=[...document.querySelectorAll('.pdv-form input,.pdv-form select')].filter(el=>!el.closest('details'));
      const rects=fields.map(el=>el.getBoundingClientRect());
      const search=document.querySelector('.pdv-search-bar').getBoundingClientRect();
      const bar=document.querySelector('[aria-label="Opções da venda"]').getBoundingClientRect();
      const cart=document.querySelector('[aria-label="Carrinho"]').getBoundingClientRect();
      const content=document.querySelector('.pdv-left').getBoundingClientRect();
      const lastItem=document.querySelector('.pdv-cart-table tbody tr:last-child').getBoundingClientRect();
      const total=document.querySelector('.pdv-total-bar').getBoundingClientRect();
      document.querySelector('#audit').textContent=JSON.stringify({visible:rects.every(r=>r.width>0&&r.height>0),fieldCount:fields.length,belowSearch:bar.top>=search.bottom,belowCart:bar.top>=Math.min(cart.bottom,content.bottom),sameRow:Math.max(...rects.map(r=>r.bottom))-Math.min(...rects.map(r=>r.bottom))<5,inputFontPx:parseFloat(getComputedStyle(fields[0]).fontSize),inputHeight:rects[0].height,controlsFit:rects.every(r=>r.left>=bar.left&&r.right<=total.left),workspaceWidth:search.width,dockedAtBottom:Math.abs(bar.bottom-innerHeight)<3,noCartOverlap:content.bottom<=bar.top,lastItemVisible:lastItem.bottom<=content.bottom+1&&lastItem.top>=content.top});
    </script>`);
}

test('direct receipt printing awaits the saved sale and never opens a browser popup', async()=>{
 let calls=0,printed=0;
 const checkout=loadCheckout(React,{direct:true,open:()=>{throw Error('Browser dialog must not open');},printSale:async sale=>{assert.equal(sale.id,'confirmed-direct');printed++;}}).Checkout;
 await act(async()=>{renderer=TestRenderer.create(React.createElement(checkout,{...props,onCreateSale:async sale=>{calls++;return {...sale,id:'confirmed-direct',status:'concluida',created_at:new Date().toISOString()};}}));});
 await act(async()=>renderer.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));
 await act(async()=>renderer.root.findByProps({className:'pdv-product-card'}).props.onClick());
 const printButton=renderer.root.findAllByType('button').find(button=>button.props.className?.includes('pdv-checkout') && button.children.some(child=>typeof child==='string' && child.toLowerCase().includes('imprimir')));
 assert.ok(printButton);await act(async()=>printButton.props.onClick());assert.equal(calls,1);assert.equal(printed,1);
});


test('sale confirmation is emitted only after the server resolves, and never on failure', async () => {
  for (const fail of [false, true]) {
    let finish; const confirmations = [];
    const Checkout = loadCheckout(React).Checkout;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Checkout, {
      ...props, onSaleConfirmed: sale => confirmations.push(sale),
      onCreateSale: () => new Promise((resolve, reject) => { finish = () => fail ? reject(new Error('Falha no servidor')) : resolve({id:'saved',sale_number:42}); }),
    })); });
    await act(async () => renderer.root.findByProps({className:'pdv-product-card'}).props.onClick());
    let checkout;
    await act(async () => { checkout = renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick(); });
    assert.equal(confirmations.length,0);
    await act(async () => { finish(); await checkout; });
    assert.equal(confirmations.length,fail?0:1);
    if (!fail) assert.equal(confirmations[0].sale_number,42);
    await act(async () => renderer.unmount()); renderer=null;
  }
});
