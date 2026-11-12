import { useEffect, useState } from 'react';
import type { BusinessSegment } from '../types';
import { supabase } from '../lib/supabase';

import { businessSegmentLabels } from '../lib/businessSegments';

type Props = {
  companyId: string;
  companyName: string;
  value: BusinessSegment;
  onSaved: (segment: BusinessSegment) => void;
};

export function AdminCompanySegmentField({ companyId, companyName, value, onSaved }: Props) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  useEffect(() => { setDraft(value); }, [value]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || draft === value) return;
    setSaving(true);
    setFeedback(null);
    try {
      if (!supabase) throw new Error('Não foi possível conectar. O ramo não foi salvo.');
      const { data, error } = await supabase.rpc('set_super_admin_company_segment', {
        company_id: companyId,
        new_segment: draft,
      });
      if (error) throw new Error(error.message);
      if (data !== draft) throw new Error('O servidor não confirmou a alteração do ramo. Atualize a lista e tente novamente.');
      onSaved(draft);
      setFeedback({ error: false, message: 'Ramo salvo.' });
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : 'Não foi possível salvar o ramo.' });
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={save}>
    <select className="inline-select" aria-label={`Ramo de ${companyName}`} value={draft} disabled={saving}
      onChange={event => { setDraft(event.target.value as BusinessSegment); setFeedback(null); }}>
      {Object.entries(businessSegmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <button type="submit" className="rma-advance-btn" disabled={saving || draft === value}>
      {saving ? 'Salvando…' : 'Salvar ramo'}
    </button>
    {feedback && <small role={feedback.error ? 'alert' : 'status'}>{feedback.message}</small>}
  </form>;
}
