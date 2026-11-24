import { Building2, Check, ChevronDown, Lock } from 'lucide-react';
import type { PartnerBranch } from '../../types';

type Props = {
  branches: Pick<PartnerBranch, 'id' | 'name'>[];
  selectedBranchId: string;
  onSelectBranch: (id: string) => void;
  isEmployeeLocked: boolean;
  lockedBranchName?: string;
  allowConsolidated?: boolean;
  disabled?: boolean;
};

export function BranchSelector({ branches, selectedBranchId, onSelectBranch, isEmployeeLocked, lockedBranchName, allowConsolidated = true, disabled = false }: Props) {
  const options = isEmployeeLocked ? branches.filter(branch => branch.id === selectedBranchId) : branches;
  const selectedName = options.find(branch => branch.id === selectedBranchId)?.name
    ?? (isEmployeeLocked ? lockedBranchName ?? 'Filial vinculada' : selectedBranchId ? 'Filial selecionada' : 'Todas as filiais');
  return <div className="sidebar-branch-selector">
    <span className="sidebar-branch-label">Filial ativa</span>
    {isEmployeeLocked ? (
      <div className="sidebar-branch-current"><Lock size={16} aria-hidden="true" /><span title={selectedName}>{selectedName}</span></div>
    ) : (
      <details className="sidebar-branch-dropdown" key={selectedBranchId}>
        <summary aria-label={`Selecionar filial: ${selectedName}`}>
          <Building2 size={16} aria-hidden="true" /><span title={selectedName}>{selectedName}</span><ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="sidebar-branch-options" role="group" aria-label="Filiais disponíveis">
          {[...(allowConsolidated ? [{ id: '', name: 'Todas as filiais' }] : []), ...options].map(branch => (
            <button type="button" disabled={disabled} key={branch.id} aria-pressed={selectedBranchId === branch.id} onClick={event => {
              onSelectBranch(branch.id);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}>
              <span>{branch.name}</span>{selectedBranchId === branch.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </details>
    )}
  </div>;
}
