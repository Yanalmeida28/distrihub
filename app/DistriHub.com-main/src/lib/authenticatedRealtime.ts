import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type Options = { label: string; expectedUserId?: string; onStatus?: (status: string) => void };

// Subscribe only after the SDK has recovered its session and forwarded the JWT.
// Each failed join gets a new channel, with bounded backoff and no credentials in logs.
export function authenticatedRealtime(client: SupabaseClient, createChannel: () => RealtimeChannel, options: Options) {
  let stopped = false, generation = 0, retries = 0, connected = false;
  let account = options.expectedUserId ?? null;
  let channel: RealtimeChannel | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const remove = async (old: RealtimeChannel | null) => { if (old) { try { await client.removeChannel(old); } catch { /* The old generation is already ignored. */ } } };
  const schedule = (delay: number) => {
    if (stopped) return;
    clearTimer(); timer = setTimeout(() => { timer = undefined; void start(); }, delay);
  };
  const fail = () => {
    if (stopped) return;
    connected = false; options.onStatus?.('CHANNEL_ERROR');
    console.warn('[Realtime] ' + options.label + ': conexão temporariamente indisponível; nova tentativa agendada.');
    schedule(Math.min(30_000, 1000 * 2 ** Math.min(retries++, 5)));
  };
  async function start() {
    const attempt = ++generation;
    connected = false;
    const old = channel; channel = null;
    await remove(old);
    try {
      const { data, error } = await client.auth.getSession();
      if (stopped || attempt !== generation) return;
      if (error) throw error;
      const session = data.session;
      if (!session?.access_token || !session.user?.id || (account && session.user.id !== account)) {
        options.onStatus?.('CLOSED'); return;
      }
      account ??= session.user.id;
      await client.realtime.setAuth(session.access_token);
      if (stopped || attempt !== generation) return;
      const next = createChannel(); channel = next;
      next.subscribe(status => {
        if (stopped || attempt !== generation || channel !== next) return;
        connected = status === 'SUBSCRIBED'; options.onStatus?.(status);
        if (connected) retries = 0;
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') fail();
      });
    } catch { if (!stopped && attempt === generation) fail(); }
  }
  const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
    // Never await Auth methods inside its callback: the SDK holds its recovery lock.
    if (event === 'SIGNED_OUT' || (session && account && session.user.id !== account)) {
      generation++; connected = false; clearTimer(); const old = channel; channel = null;
      void remove(old); options.onStatus?.('CLOSED'); return;
    }
    if (session && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) schedule(0);
  });
  const resume = () => { if (!connected && document.visibilityState !== 'hidden') schedule(0); };
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
  void start();
  return () => {
    stopped = true; generation++; clearTimer(); authListener.subscription.unsubscribe();
    window.removeEventListener('online', resume); window.removeEventListener('focus', resume);
    document.removeEventListener('visibilitychange', resume);
    const old = channel; channel = null; void remove(old);
  };
}
