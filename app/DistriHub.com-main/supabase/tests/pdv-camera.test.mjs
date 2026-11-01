import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
import {splitPaymentComponent} from './fixtures/split_payment_component.mjs';
import {pdvHelpers} from './fixtures/pdv_helpers.mjs';
const require=createRequire(import.meta.url);
const {DecodeHintType,QRCodeWriter,BarcodeFormat,BinaryBitmap,HybridBinarizer,RGBLuminanceSource}=require('@zxing/library');
const {BrowserMultiFormatReader:RealReader}=require('@zxing/browser');
const source=ts.transpileModule(await readFile(new URL('../../src/components/partner/PdvModule.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText+'\nexports.Checkout=PdvCheckout;exports.Camera=BarcodeCameraDialog;';
let renderer;
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());renderer=null;});
function harness({secure=true,error=null,pending=false}={}){
 let callback,resolve,decoder,stops=0;
 const controls={stop(){stops++;}};
 const document={visibilityState:'visible',listeners:new Set(),addEventListener(_event,fn){this.listeners.add(fn);},removeEventListener(_event,fn){this.listeners.delete(fn);}};
 const library={BrowserMultiFormatReader:class{constructor(hints){assert.equal(hints.get(DecodeHintType.TRY_HARDER),true);decoder=new RealReader(hints);}async decodeFromConstraints(constraints,_video,cb){assert.equal(constraints.video.facingMode.ideal,'environment');assert.equal(constraints.video.width.ideal,1280);assert.equal(constraints.video.height.ideal,720);assert.equal(constraints.audio,false);if(error)throw {name:error};callback=cb;return pending?new Promise(done=>resolve=done):controls;}}};
 const exports={};
 vm.runInNewContext(source,{exports,Date,Error,document,navigator:{mediaDevices:{getUserMedia(){}}},window:{isSecureContext:secure,open:()=>null,setTimeout:()=>1,clearTimeout(){}},require(name){
  if(name==='react')return React;if(name==='@zxing/browser')return library;
  if(name==='../../lib/pdv')return pdvHelpers;
  if(name==='../../hooks/useSessionDraft')return {SessionDraftProvider:({children})=>children,useSessionDraftScope:()=> 'test',useSessionDraftState:(_id,initial)=>React.useState(initial)};
  if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
  if(name==='../../lib/salePrint')return {printSale(){}};
  if(name==='./SplitPaymentFields')return splitPaymentComponent;
  if(name==='./PreSaleCheckout')return {};
  if(name==='./SalePriceInput')return {SalePriceInput:()=>null};
  return require(name);
 }});
 return {exports,document,get stops(){return stops;},decode(bitmap){return decoder.decodeBitmap(bitmap).getText();},detect(code){callback({getText:()=>code},null,controls);},resolve(){resolve(controls);}};
}
const props={products:[{id:'product',name:'Produto',sku:'0789012345678',branch_id:'branch',stock:5,sale_price:100}],customers:[],salespeople:[],credits:[],selectedBranchId:'branch',segment:'assistencia',canCheckout:true,canEditPrice:false,cameraScannerEnabled:true,onCreateSale:async()=>{}};
const search=()=>renderer.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'});
const qty=()=>renderer.root.findAllByProps({'data-label':'Quantidade'})[0]?.findByType('b').children.join('');
async function mount(h,overrides={}){await act(async()=>{renderer=TestRenderer.create(React.createElement(h.exports.Checkout,{...props,...overrides}),{createNodeMock:()=>({focus(){}})});});}
test('keyboard reader finds a separate barcode with leading zeroes while SKU is internal',async()=>{
 const h=harness();await mount(h,{products:[{...props.products[0],sku:'INTERNO-42',barcode:'0789012345678'}]});
 await typeCode();await act(async()=>enter());assert.equal(qty(),'1');
});
test('camera finds a separate barcode while preserving the internal SKU',async()=>{
 const h=harness();await mount(h,{products:[{...props.products[0],sku:'INTERNO-42',barcode:'0789012345678'}]});
 await openCamera();await act(async()=>h.detect('0789012345678'));assert.equal(qty(),'1');
});

test('QR sem SKU usa o ID impresso na etiqueta, pela câmera e pelo leitor de teclado',async()=>{
 const h=harness();await mount(h,{products:[{...props.products[0],sku:null,barcode:null}]});
 await openCamera();await act(async()=>h.detect('product'));assert.equal(qty(),'1');
 await act(async()=>search().props.onChange({target:{value:'product'}}));await act(async()=>enter());assert.equal(qty(),'2');
});

test('decodifica QR real de código numérico, SKU e ID com as opções do leitor da câmera',async()=>{
 const h=harness();await mount(h);await openCamera();
 for(const value of ['0194252156971','FONTE-IPHONE-20W','ca519b77-76e1-4044-b67a-e9874b670849']){
  const matrix=new QRCodeWriter().encode(value,BarcodeFormat.QR_CODE,240,240,new Map());
  const pixels=new Uint8ClampedArray(240*240);
  for(let y=0;y<240;y++)for(let x=0;x<240;x++)pixels[y*240+x]=matrix.get(x,y)?0:255;
  assert.equal(h.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels,240,240)))),value);
 }
});
test('duplicate barcode in the same branch never adds an arbitrary product',async()=>{
 const h=harness();await mount(h,{products:[{...props.products[0],sku:'A',barcode:'0789012345678'},{...props.products[0],id:'second',sku:'B',barcode:'0789012345678'}]});
 await typeCode();await act(async()=>enter());assert.equal(qty(),undefined);
});
test('barcode in another branch is ignored',async()=>{
 const h=harness();await mount(h,{products:[{...props.products[0],sku:'A',barcode:'0789012345678'},{...props.products[0],id:'second',branch_id:'other',sku:'B',barcode:'0789012345678'}]});
 await typeCode();await act(async()=>enter());assert.equal(qty(),'1');
});
async function typeCode(){await act(async()=>search().props.onChange({target:{value:'0789012345678'}}));}
function enter(){search().props.onKeyDown({key:'Enter',preventDefault(){}});}
async function openCamera(){await act(async()=>renderer.root.findByProps({'aria-label':'Ler código pela câmera'}).props.onClick());}
test('leituras no mesmo ciclo respeitam estoque e preservam duas unidades legítimas',async()=>{const h=harness();await mount(h,{products:[{...props.products[0],stock:1}]});await typeCode();act(()=>{enter();enter();});assert.equal(qty(),'1');assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/insuficiente/);await act(async()=>renderer.unmount());renderer=null;await mount(h,{products:[{...props.products[0],stock:2}]});await typeCode();act(()=>{enter();enter();});assert.equal(qty(),'2');});
test('finalização bloqueia teclado, câmera e alteração de quantidade sem perder uma leitura',async()=>{const h=harness();let release,payload;await mount(h,{onCreateSale:sale=>{payload=sale;return new Promise(done=>release=done);}});await typeCode();await act(async()=>enter());await openCamera();const staleDetected=renderer.root.findByType(h.exports.Camera).props.onDetected;await typeCode();act(()=>{void renderer.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick();enter();staleDetected('0789012345678');renderer.root.findByProps({'aria-label':'Aumentar quantidade de Produto'}).props.onClick();});assert.equal(qty(),'1');assert.equal(payload.items[0].quantity,1);assert.equal(renderer.root.findAllByType(h.exports.Camera).length,0);assert.equal(search().props.disabled,true);assert.equal(renderer.root.findByProps({'aria-label':'Ler código pela câmera'}).props.disabled,true);assert.ok(h.stops>0);await act(async()=>release({id:'saved',...payload}));assert.equal(qty(),undefined);});
test('venda incerta bloqueia leitor e carrinho até recuperação',async()=>{const h=harness();await mount(h,{hasPendingSale:true});await typeCode();act(()=>enter());assert.equal(qty(),undefined);assert.equal(search().props.disabled,true);});
test('sair do PDV encerra a câmera e ignora callback atrasado',async()=>{const h=harness();await mount(h);await openCamera();const detected=renderer.root.findByType(h.exports.Camera).props.onDetected;await act(async()=>renderer.update(React.createElement(h.exports.Checkout,{...props,isActive:false})));assert.equal(renderer.root.findAllByType(h.exports.Camera).length,0);assert.ok(h.stops>0);act(()=>detected('0789012345678'));assert.equal(qty(),undefined);});
test('ocultar página encerra câmera e preserva carrinho',async()=>{const h=harness();await mount(h);await openCamera();await act(async()=>{h.document.visibilityState='hidden';for(const fn of h.document.listeners)fn();});assert.equal(renderer.root.findAllByType(h.exports.Camera).length,0);assert.ok(h.stops>0);});
test('decodificação adiciona uma unidade e ignora repetição do mesmo frame',async()=>{const h=harness();await mount(h);await openCamera();await act(async()=>{h.detect('0789012345678');h.detect('0789012345678');});assert.equal(qty(),'1');assert.ok(h.stops>0);});
test('fechar durante inicialização encerra controles quando a permissão chega',async()=>{const h=harness({pending:true});await mount(h);await openCamera();await act(async()=>renderer.root.findByProps({'aria-label':'Fechar leitor de câmera'}).props.onClick());await act(async()=>h.resolve());assert.ok(h.stops>0);assert.equal(renderer.root.findAllByType(h.exports.Camera).length,0);});
for(const [options,message] of [[{secure:false},/HTTPS/],[{error:'NotAllowedError'},/Permita/],[{error:'NotReadableError'},/em uso/]])test('câmera informa pré-requisito ou erro: '+JSON.stringify(options),async()=>{const h=harness(options);await mount(h);await openCamera();assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),message);});
