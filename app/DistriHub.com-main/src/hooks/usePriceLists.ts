import { useCallback, useEffect, useState } from 'react';
import type { BasePriceTable, CustomPriceList } from '../lib/pdv';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from './usePartnerData';

type ListFields = Pick<CustomPriceList, 'name' | 'base_table' | 'adjustment_bps'>;
const emptyLists: CustomPriceList[] = [];

export function usePriceLists(companyId?: string, branchId?: string) {
  const scope = companyId ? companyId + ':' + (branchId ?? '') : '';
  const [snapshot, setSnapshot] = useState<{ scope: string; lists: CustomPriceList[]; error?: string }>();
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const client = supabase;
    if (!client || !companyId) return;
    const controller = new AbortController();
    async function load() {
      if (!client) return;
      try {
        const [lists, items] = await Promise.all([
          fetchAllPages((from, to) => client.from('partner_price_lists').select('id,name,base_table,adjustment_bps')
            .eq('user_id', companyId).order('name').order('id').range(from, to), controller.signal),
          branchId ? fetchAllPages((from, to) => client.from('partner_price_list_items').select('price_list_id,product_id,price')
            .eq('user_id', companyId).eq('branch_id', branchId).order('price_list_id').order('product_id').range(from, to), controller.signal)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (lists.error || items.error) throw lists.error ?? items.error;
        const byList = new Map<string, Record<string, number>>();
        for (const item of items.data ?? []) {
          const prices = byList.get(item.price_list_id) ?? {};
          prices[item.product_id] = Number(item.price);
          byList.set(item.price_list_id, prices);
        }
        if (!controller.signal.aborted) setSnapshot({ scope, lists: (lists.data ?? []).map(list => ({
          ...list, base_table: list.base_table as BasePriceTable, prices: byList.get(list.id) ?? {},
        })) });
      } catch {
        if (!controller.signal.aborted) setSnapshot({ scope, lists: [], error: 'Não foi possível carregar as tabelas de preços.' });
      }
    }
    void load();
    window.addEventListener('focus', reload);
    return () => { controller.abort(); window.removeEventListener('focus', reload); };
  }, [scope, companyId, branchId, revision, reload]);

  async function saveList(id: string | undefined, fields: ListFields) {
    if (!supabase || !companyId) throw new Error('Acesso à empresa indisponível.');
    const query = supabase.from('partner_price_lists');
    const { data, error } = await (id
      ? query.update(fields).eq('id', id).eq('user_id', companyId)
      : query.insert({ ...fields, user_id: companyId })).select('id').single();
    if (error || !data) throw new Error(error?.code === '23505' ? 'Já existe uma tabela com esse nome.' : error?.message ?? 'Tabela não confirmada.');
    reload();
    return data.id as string;
  }

  async function saveProductPrice(listId: string, productId: string, price: number | null) {
    if (!supabase || !companyId || !branchId) throw new Error('Selecione a filial do produto.');
    const query = supabase.from('partner_price_list_items');
    const { error } = await (price === null
      ? query.delete().eq('price_list_id', listId).eq('product_id', productId).eq('user_id', companyId).eq('branch_id', branchId)
      : query.upsert({ price_list_id: listId, product_id: productId, user_id: companyId, branch_id: branchId, price }, { onConflict: 'price_list_id,product_id' }));
    if (error) throw new Error(error.message);
    reload();
  }

  return {
    lists: snapshot?.scope === scope ? snapshot.lists : emptyLists,
    error: snapshot?.scope === scope ? snapshot.error : undefined,
    loading: Boolean(scope && snapshot?.scope !== scope),
    reload, saveList, saveProductPrice,
  };
}
