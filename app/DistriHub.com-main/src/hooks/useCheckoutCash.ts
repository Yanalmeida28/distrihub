import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { pdvErrorMessage } from '../lib/pdv';
import { checkoutCash, closedCashMessage, type CheckoutCashSnapshot, type CheckoutCashSession } from '../lib/checkoutCash';

type State = { status: 'loading' | 'open' | 'closed' | 'authorize' | 'error'; current: CheckoutCashSession | null; others: CheckoutCashSession[]; message: string };
export function useCheckoutCash(branchId: string, operatorId: string | null, operatorPin: string | null, operatorName: string, scope: string, isActive = true, managedSessionId: string | null = null, checkoutModule: 'pdv' | 'pedidos' | 'caixa' = 'pdv') {
  const [state, setState] = useState<State>({ status: 'loading', current: null, others: [], message: 'Conferindo caixa...' });
  const generation = useRef(0);
  const invalidateReads = useCallback(() => { generation.current++; }, []);
  const context = useRef({ branchId, operatorId, operatorPin, scope, managedSessionId, checkoutModule });
  context.current = { branchId, operatorId, operatorPin, scope, managedSessionId, checkoutModule };
  const needsPin = Boolean(operatorId && !operatorPin);
  const read = useCallback(async () => {
    if (!branchId) throw new Error('Selecione uma filial para conferir o caixa.');
    if (needsPin) throw new Error(`Confirme o PIN de ${operatorName} para retomar o caixa.`);
    if (!supabase) throw new Error('Conecte-se para conferir o caixa.');
    const { data, error } = await supabase.rpc('read_partner_checkout_cash', {
      p_branch_id: branchId, p_salesperson_id: operatorId, p_pin: operatorPin, p_module: checkoutModule,
    });
    if (error) throw new Error(pdvErrorMessage(error));
    if (!data || typeof data.actor_key !== 'string' || !Array.isArray(data.sessions)) throw new Error('Não foi possível identificar o caixa do operador.');
    return checkoutCash(data as CheckoutCashSnapshot, branchId, managedSessionId);
  }, [branchId, operatorId, operatorPin, operatorName, needsPin, managedSessionId, checkoutModule]);
  const performRefresh = useCallback(async () => {
    const request = ++generation.current;
    setState({ status: 'loading', current: null, others: [], message: 'Conferindo caixa...' });
    try {
      const result = await read();
      if (request === generation.current) setState({ ...result, status: result.current ? 'open' : 'closed',
        message: result.current ? `Caixa aberto · ${result.current.operator_name}` : closedCashMessage(operatorName, result.others.map(session => session.operator_name)) });
      return result;
    } catch (error) {
      if (request === generation.current) setState({ status: needsPin ? 'authorize' : 'error', current: null, others: [], message: pdvErrorMessage(error) });
      throw error;
    }
  }, [read, operatorName, needsPin]);
  const inFlight = useRef<{ scope: string; perform: typeof performRefresh; request: ReturnType<typeof performRefresh> } | null>(null);
  const refresh = useCallback(() => {
    const pending = inFlight.current;
    if (pending?.scope === scope && pending.perform === performRefresh) return pending.request;
    const request = performRefresh();
    inFlight.current = { scope, perform: performRefresh, request };
    void request.finally(() => { if (inFlight.current?.request === request) inFlight.current = null; }).catch(() => {});
    return request;
  }, [scope, performRefresh]);
  useEffect(() => {
    if (!isActive) { invalidateReads(); inFlight.current = null; return; }
    const sync = () => { void refresh().catch(() => {}); };
    const visible = () => { if (document.visibilityState === 'visible') sync(); };
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('distrihub:cash-changed', sync);
    document.addEventListener('visibilitychange', visible);
    return () => { invalidateReads(); inFlight.current = null; window.removeEventListener('focus', sync); window.removeEventListener('distrihub:cash-changed', sync); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, scope, invalidateReads, isActive]);
  const assertOpen = useCallback(async (expectedSessionId?: string) => {
    const result = await refresh();
    if (context.current.branchId !== branchId || context.current.operatorId !== operatorId
      || context.current.operatorPin !== operatorPin || context.current.scope !== scope || context.current.managedSessionId !== managedSessionId || context.current.checkoutModule !== checkoutModule) {
      throw new Error('O operador ou a filial mudou durante a conferência. Confira o caixa antes de finalizar.');
    }
    if (!result.current) throw new Error(closedCashMessage(operatorName, result.others.map(session => session.operator_name)));
    if (expectedSessionId && result.current.id !== expectedSessionId) throw new Error('O caixa original da venda não está aberto. Confira a venda pendente antes de sincronizar.');
  }, [refresh, operatorName, branchId, operatorId, operatorPin, scope, managedSessionId, checkoutModule]);
  return { ...state, refresh, assertOpen };
}
