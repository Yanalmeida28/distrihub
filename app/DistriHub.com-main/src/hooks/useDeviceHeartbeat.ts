import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function deviceIdentity(userId: string) {
  const key = `distrihub-device:${userId}`;
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return { id, name: localStorage.getItem(`${key}:name`) ?? 'Terminal deste navegador', nameKey: `${key}:name` };
}

export function useDeviceHeartbeat(userId?: string, branchId?: string | null, operatorScope?: string) {
  const scope = `${userId ?? ''}:${branchId ?? ''}:${operatorScope ?? ''}`;
  const [result, setResult] = useState<{ scope: string; error: string | null; interrupted: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!userId || !supabase) { setResult(null); return; }
    let active = true;
    let pending = false;
    const onInterrupted = () => {
      if (!active) return;
      setResult(previous => ({
        scope,
        error: previous?.scope === scope ? previous.error : 'Reconecte à internet para verificar este dispositivo.',
        interrupted: true,
      }));
    };
    const touch = async () => {
      if (!active || pending) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { onInterrupted(); return; }
      pending = true;
      try {
        const device = deviceIdentity(userId);
        const { error, status } = await supabase!.rpc('touch_partner_device', { p_device_key: device.id, p_name: device.name, p_branch_id: branchId || null });
        if (status === 0) { onInterrupted(); return; }
        if (error) throw error;
        if (active) setResult({ scope, error: null, interrupted: false });
      } catch (failure) {
        if (active) setResult({ scope, error: failure instanceof Error ? failure.message : (failure as { message?: string })?.message ?? 'Não foi possível verificar este dispositivo.', interrupted: false });
      }
      finally { pending = false; }
    };
    void touch();
    const timer = window.setInterval(() => void touch(), 30_000);
    window.addEventListener('focus', touch);
    window.addEventListener('online', touch);
    window.addEventListener('offline', onInterrupted);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', touch); window.removeEventListener('online', touch); window.removeEventListener('offline', onInterrupted); };
  }, [userId, branchId, scope, revision]);
  const current = result?.scope === scope ? result : null;
  return { ready: Boolean(current && !current.error), interrupted: current?.interrupted ?? false, error: current?.error ?? null, retry };
}
