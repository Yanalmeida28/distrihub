import { useId, useState, type ReactNode } from 'react';
type Props = { label?: string; activeCount?: number; children: ReactNode };
export function MobileFilters({ label = 'Filtros', activeCount = 0, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className={'mobile-filters ' + (expanded ? 'is-expanded' : '')}>
    <button type="button" className="rma-advance-btn mobile-filters-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <span>{label}{activeCount > 0 ? ' · ' + activeCount + ' ativo' + (activeCount > 1 ? 's' : '') : ''}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    <div id={id} className="mobile-filters-content">{children}</div>
  </div>;
}
