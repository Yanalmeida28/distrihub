import { useRef, useState } from 'react';
import { isMacComputer, listReceiptPrinters, printerPreferences, requireImageConnector, savePrinter, sendReceipt, sendReceiptImage } from '../../lib/directPrint';
import { renderReceiptImage } from '../../lib/receiptImage';

export function PrinterSettings() {
  const [saved, setSaved] = useState(printerPreferences);
  const [printers, setPrinters] = useState<string[]>(() => saved ? [saved.name] : []);
  const [name, setName] = useState(saved?.name ?? '');
  const [width, setWidth] = useState<'58' | '80'>(saved?.width ?? '80');
  const [mode, setMode] = useState<'image' | 'text'>(saved?.mode === 'text' ? 'text' : 'image');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [tested, setTested] = useState<{ name: string; width: '58' | '80'; mode: 'image' | 'text' } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setNotice(''); setError('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível conectar à impressora.'); }
    finally { running.current = false; setBusy(false); }
  }
  if (isMacComputer()) return <div className="module-card">
    <h3>Impressora de cupons</h3>
    <p>No Mac, cupons e etiquetas são impressos pela janela de impressão do navegador, com a personalização salva.</p>
    <p>Adicione sua impressora em Ajustes do Sistema → Impressoras e Scanners. Ao imprimir no app, escolha a impressora e o tamanho do papel. A opção Salvar como PDF também está disponível nessa janela.</p>
    <p>O Conector DistriHub para impressão sem janela está disponível para Windows.</p>
  </div>;
  return <div className="module-card">
    <h3>Impressora de cupons</h3>
    <p>O modo personalizado direto imprime o logo, a fonte e a disposição da personalização sem abrir a janela do navegador. Requer o Conector DistriHub v2 neste computador.</p>
    <p role="status">{saved?.mode === 'image' ? 'Modo atual: personalizado direto, sem janela de impressão.' : saved?.mode === 'text' ? 'Modo atual: texto simples, sem logo e formatação.' : 'Modo atual: cupom personalizado pelo navegador.'}</p>
    <h4>Conectar ou atualizar a impressora</h4>
    <p>Baixe e instale o conector atualizado, mesmo se já utilizava uma versão anterior. O teste verifica a conexão e a impressão gráfica; as vendas usam a personalização salva.</p>
    <p><a href="/downloads/Conector-DistriHub.zip?v=20261112-nitidez-58-80" download>1. Baixar conector para Windows</a> · Extraia o arquivo e abra Instalar.cmd uma vez.</p>
    <p>Atualização de nitidez para 58 e 80 mm: se o texto ficou borrado no modo automático, instale este conector atualizado e imprima um novo cupom de teste.</p>
    <button type="button" className="rma-advance-btn" disabled={busy} onClick={() => void run(async () => { const found = await listReceiptPrinters(); setPrinters(found); if (!found.includes(name)) setName(found[0] ?? ''); setNotice(found.length ? 'Conector conectado. Escolha sua impressora.' : 'Instale o driver da impressora no Windows e tente novamente.'); })}>2. Buscar impressoras</button>
    <div className="rma-form">
      <label>Impressora<select value={name} disabled={busy} onChange={event => { setName(event.target.value); setTested(null); }}><option value="">Selecione</option>{printers.map(printer => <option key={printer} value={printer}>{printer}</option>)}</select></label>
      <label>Papel<select value={width} disabled={busy} onChange={event => { setWidth(event.target.value as '58' | '80'); setTested(null); }}><option value="80">80 mm (Elgin i8)</option><option value="58">58 mm</option></select></label>
      <label>Modo de impressão<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as 'image' | 'text'); setTested(null); }}><option value="image">Personalizado direto (logo e formatação)</option><option value="text">Texto simples (sem logo e formatação)</option></select></label>
    </div>
    <button type="button" className="module-submit-btn" disabled={busy || !name} onClick={() => void run(async () => {
      setTested(null);
      if (mode === 'image') {
        await requireImageConnector();
        const image = await renderReceiptImage(target => {
          const doc = target.document;
          doc.body.style.font = '14px Arial';
          const title = doc.createElement('h1'); title.textContent = 'DistriHub'; title.style.cssText = 'font-size:22px;text-align:center';
          const text = doc.createElement('p'); text.textContent = 'TESTE PERSONALIZADO DIRETO'; text.style.cssText = 'font-weight:bold;text-align:center';
          const printer = doc.createElement('p'); printer.textContent = 'Impressora: ' + name;
          const footer = doc.createElement('p'); footer.textContent = 'Confira a impressão e confirme no aplicativo para salvar.';
          doc.body.append(title, text, doc.createElement('hr'), printer, footer);
        }, width);
        await sendReceiptImage(image, { name, width, mode });
      } else await sendReceipt('DistriHub\nTESTE DE IMPRESSÃO\nImpressora: ' + name + '\nConfira o cupom antes de salvar.\n', { name, width, mode });
      setTested({ name, width, mode }); setNotice('Teste enviado à fila do Windows. Confira se o cupom saiu corretamente antes de salvar.');
    })}>3. Imprimir cupom de teste</button>
    {tested && tested.name === name && tested.width === width && tested.mode === mode && <button type="button" className="module-submit-btn" disabled={busy} onClick={() => { savePrinter(tested); setSaved(tested); setTested(null); setNotice('Impressora salva. Impressão direta ativada no modo escolhido.'); }}>4. O cupom saiu corretamente: salvar impressora</button>}
    {saved && <><p>Impressora do conector: {saved.name}. Use o mesmo papel configurado na personalização. O corte depende do driver.</p><button type="button" disabled={busy} className="rma-advance-btn" onClick={() => { const preferences = { ...saved, mode: 'personalized' as const }; savePrinter(preferences); setSaved(preferences); setNotice('Impressão personalizada pelo navegador ativada.'); }}>Usar cupom personalizado pelo navegador</button></>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="otp-error-msg">{error}</p>}
  </div>;
}
