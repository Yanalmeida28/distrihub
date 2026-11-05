import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type LucideIcon, Ban, Mail, MessageCircle, MoreVertical, Printer, QrCode, Pencil, UserRound, FileDown } from 'lucide-react';

type Props = {
  onPrintReceipt: () => void;
  onPrintLabel: () => void;
  onWhatsApp: () => void;
  onEmail: () => void;
  onCancel?: () => void;
  onEditItems?: () => void;
  onChangeCustomer?: () => void;
  onDownloadQuote?: () => void;
  onShareQuote?: () => void;
};

export function SaleActionsMenu(props: Props) {
  const actions = [
    ...(props.onShareQuote ? [{ label: 'Enviar orçamento em PDF', icon: MessageCircle, run: props.onShareQuote }] : []),
    ...(props.onChangeCustomer ? [{ label: 'Alterar cliente', icon: UserRound, run: props.onChangeCustomer }] : []),
    ...(props.onEditItems ? [{ label: 'Editar produtos', icon: Pencil, run: props.onEditItems }] : []),
    ...(props.onDownloadQuote ? [{ label: 'Baixar orçamento em PDF', icon: FileDown, run: props.onDownloadQuote }] : []),
    { label: 'Imprimir cupom', icon: Printer, run: props.onPrintReceipt },
    { label: 'Imprimir etiqueta', icon: QrCode, run: props.onPrintLabel },
    { label: 'Enviar por WhatsApp', icon: MessageCircle, run: props.onWhatsApp },
    { label: 'Enviar por e-mail', icon: Mail, run: props.onEmail },
    ...(props.onCancel ? [{ label: 'Cancelar/apagar venda', icon: Ban, run: props.onCancel, danger: true }] : []),
  ];
  return <ActionsMenu actions={actions} label="Ações da venda" />;
}

export function ActionsMenu({ actions, label, disabled = false }: { actions: { label: string; icon: LucideIcon; run: () => void; danger?: boolean }[]; label: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();


  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    setPosition({
      left: Math.max(8, Math.min(rect.right - menu.current.offsetWidth, window.innerWidth - menu.current.offsetWidth - 8)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)),
    });
    menu.current.querySelector('button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" disabled={disabled} className="sale-actions-trigger" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
      <MoreVertical size={19} />
    </button>
    {open && createPortal(
      <div ref={menu} id={id} role="menu" aria-label={label} className="sale-actions-menu" style={position} onKeyDown={(event) => {
        const buttons = Array.from(menu.current?.querySelectorAll('button') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
        if (event.key === 'Tab') setOpen(false);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
        {actions.map(({ label, icon: Icon, run, danger }) => <button key={label} type="button" role="menuitem" className={danger ? 'sale-actions-danger' : undefined} onClick={() => {
          setOpen(false);
          trigger.current?.focus();
          run();
        }}><Icon size={16} />{label}</button>)}
      </div>, document.body)}
  </>;
}
