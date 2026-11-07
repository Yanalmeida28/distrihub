import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { PartnerIdentity, PartnerProfile, PartnerSalesperson } from '../types';
import { isValidCpf, isValidCnpj, normalizeDocument } from '../utils';

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: PartnerProfile | null;
  identity: PartnerIdentity | null;
  loading: boolean;
  error: string | null;
  passwordRecovery: boolean;
  sessionRecoveryError: string | null;
};

type SignUpData = {
  document: string;
  personType: 'PF' | 'PJ';
  businessName: string;
  whatsapp: string;
  email: string;
  password: string;
};

type UseAuthReturn = AuthState & {
  signUp: (data: SignUpData) => Promise<{ error: string | null; needsEmailConfirmation?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  retrySession: () => void;
};

type AuthAction =
  | { type: 'RESET' }
  | { type: 'RETRY_SESSION' }
  | { type: 'SESSION_RECOVERY_FAILED' }
  | { type: 'SET_SESSION'; session: Session | null; user: User | null; passwordRecovery?: boolean }
  | { type: 'SET_PROFILE'; profile: PartnerProfile | null }
  | { type: 'SET_IDENTITY'; identity: PartnerIdentity | null }
  | { type: 'SET_ERROR'; error: string | null };

function isFutureJwtError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) return false;
  return typeof error.message === 'string' && error.message.trim().toLowerCase() === 'jwt issued at future'
    && (!('code' in error) || error.code === 'PGRST303');
}

// Retry only authentication reads rejected before execution by PostgREST's
// clock check. Never refresh/mint tokens, replay writes or bypass validation.
export async function readWithJwtRecovery<T extends { error?: unknown }>(
  read: () => PromiseLike<T>,
  isCurrent: () => boolean = () => true,
): Promise<T> {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    if (!isCurrent()) throw new Error('Leitura de sessão substituída.');
    const result = await read();
    if (!isCurrent()) throw new Error('Leitura de sessão substituída.');
    if (!isFutureJwtError(result.error)) return result;
    if (attempt === delays.length) {
      throw new Error('O serviço de autenticação está com uma diferença de horário temporária. Aguarde alguns segundos e clique em Tentar novamente.');
    }
    await new Promise<void>(resolve => window.setTimeout(resolve, delays[attempt]));
  }
}

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESET':
      return {
        session: null,
        user: null,
        profile: null,
        identity: null,
        loading: false,
        error: null,
        passwordRecovery: false,
        sessionRecoveryError: null,
      };
    case 'RETRY_SESSION':
      return { ...state, loading: true, sessionRecoveryError: null };
    case 'SESSION_RECOVERY_FAILED':
      return { ...state, loading: false, sessionRecoveryError: 'Não foi possível recuperar sua sessão agora. Verifique a conexão e tente novamente.' };
    case 'SET_SESSION':
      return {
        ...state,
        session: action.session,
        user: action.user,
        loading: false,
        sessionRecoveryError: null,
        passwordRecovery: action.passwordRecovery ?? state.passwordRecovery,
      };
    case 'SET_PROFILE':
      return {
        ...state,
        profile: action.profile,
      };
    case 'SET_IDENTITY':
      return { ...state, identity: action.identity };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

export function useAuth(): UseAuthReturn {
  const [state, dispatch] = useReducer(authReducer, {
    session: null,
    user: null,
    profile: null,
    identity: null,
    loading: true,
    error: null,
    passwordRecovery: false,
    sessionRecoveryError: null,
  });
  const [sessionRevision, setSessionRevision] = useState(0);
  const retrySession = useCallback(() => {
    dispatch({ type: 'RETRY_SESSION' });
    setSessionRevision(value => value + 1);
  }, []);
  const signupInProgressRef = useRef(false);
  const identityRequestRef = useRef(0);

  const resolveIdentity = useCallback(async (authUserId: string, isCurrent: () => boolean = () => true): Promise<{ identity: PartnerIdentity; ownerProfile?: PartnerProfile }> => {
    if (!supabase) {
      throw new Error('Supabase não configurado; não foi possível resolver a identidade do usuário.');
    }

    const client = supabase;
    const { data, error } = await readWithJwtRecovery(() => client
      .from('partner_salespeople')
      .select('id, user_id, role, branch_id, active')
      .eq('auth_user_id', authUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(), isCurrent);

    if (error) {
      throw new Error(`Não foi possível resolver a identidade do usuário: ${error.message}`);
    }

    const salesperson = data as Pick<PartnerSalesperson, 'id' | 'user_id' | 'role' | 'branch_id' | 'active'> | null;
    if (salesperson) {
      if (salesperson.active !== true) {
        throw new Error('Acesso pendente de liberação pelo administrador da empresa.');
      }
      if (!salesperson.user_id) {
        throw new Error('O vínculo do funcionário não possui uma empresa válida.');
      }

      return { identity: {
        authUserId,
        companyUserId: salesperson.user_id,
        role: salesperson.role,
        salespersonId: salesperson.id,
        branchId: salesperson.branch_id ?? null,
      } };
    }

    const { data: ownerProfile, error: ownerError } = await readWithJwtRecovery(() => client
      .from('partner_profiles')
      .select('*')
      .eq('id', authUserId)
      .limit(1)
      .maybeSingle(), isCurrent);

    if (ownerError) {
      throw new Error(`Não foi possível validar a identidade do proprietário: ${ownerError.message}`);
    }
    if (!ownerProfile) {
      const { data: verified, error: userError } = await supabase.auth.getUser();
      if (userError || verified.user?.id !== authUserId) throw new Error('Sessão inválida para concluir o cadastro.');
      // Metadata supplies contact fields only. Roles, plans and access are resolved by the database.
      const metadata = verified.user.user_metadata;
      if (typeof metadata.business_name !== 'string' || !metadata.business_name.trim()
        || typeof metadata.whatsapp !== 'string' || !metadata.whatsapp.trim()) {
        throw new Error('Conta sem cadastro de empresa. Conclua os dados do cadastro para acessar o painel.');
      }
      const { error: createError } = await supabase.from('partner_profiles').upsert({
        id: authUserId, business_name: metadata.business_name.trim(), whatsapp: metadata.whatsapp.trim(), segment: 'assistencia',
        ...(typeof metadata.document === 'string' && (isValidCpf(metadata.document) || isValidCnpj(metadata.document))
          ? { document: normalizeDocument(metadata.document) } : {}),
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (createError) throw new Error(`Não foi possível concluir o cadastro: ${createError.message}`);
    }

    return {
      identity: { authUserId, companyUserId: authUserId, role: 'administrador', salespersonId: null, branchId: null },
      // Reuse this request's verified owner profile, never a cross-session cache.
      ...(ownerProfile ? { ownerProfile: ownerProfile as PartnerProfile } : {}),
    };
  }, []);

  const loadProfile = useCallback(async (userId: string, isCurrent: () => boolean = () => true): Promise<PartnerProfile | null> => {
    if (!supabase) return null;

    const client = supabase;
    const { data: profile, error } = await readWithJwtRecovery(() => client
      .from('partner_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle(), isCurrent);

    if (error) {
      throw new Error(`Não foi possível carregar o perfil da empresa: ${error.message}`);
    }

    return profile as PartnerProfile | null;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      dispatch({ type: 'RESET' });
      return;
    }

    let cancelled = false;
    let authEventReceived = false;
    let authEventGeneration = 0;
    let resolvedUserId: string | null = null;

    const applySession = async (session: Session | null, passwordRecovery = false) => {
      const requestId = ++identityRequestRef.current;

      dispatch({
        type: 'SET_SESSION',
        session,
        user: session?.user ?? null,
        passwordRecovery,
      });

      if (!session?.user) {
        resolvedUserId = null;
        dispatch({ type: 'SET_PROFILE', profile: null });
        dispatch({ type: 'SET_IDENTITY', identity: null });
        dispatch({ type: 'SET_ERROR', error: null });
        return;
      }

      if (resolvedUserId !== session.user.id) {
        dispatch({ type: 'SET_IDENTITY', identity: null });
        dispatch({ type: 'SET_PROFILE', profile: null });
      }
      dispatch({ type: 'SET_ERROR', error: null });

      if (signupInProgressRef.current) return;

      try {
        const isCurrent = () => !cancelled && requestId === identityRequestRef.current;
        const { identity, ownerProfile } = await resolveIdentity(session.user.id, isCurrent);

        if (cancelled || requestId !== identityRequestRef.current) return;

        const profile = ownerProfile ?? await loadProfile(identity.companyUserId, isCurrent);

        if (cancelled || requestId !== identityRequestRef.current) return;

        dispatch({ type: 'SET_IDENTITY', identity });
        dispatch({ type: 'SET_PROFILE', profile });
        resolvedUserId = session.user.id;
        dispatch({ type: 'SET_ERROR', error: null });
      } catch (error: unknown) {
        if (cancelled || requestId !== identityRequestRef.current) return;

        dispatch({
          type: 'SET_IDENTITY',
          identity: null,
        });
        dispatch({
          type: 'SET_PROFILE',
          profile: null,
        });
        dispatch({
          type: 'SET_ERROR',
          error:
            error instanceof Error
              ? error.message
              : 'Não foi possível resolver a identidade do usuário.',
        });
      }
    };

    // A mobile connection failure must not be treated as an explicit logout.
    supabase.auth.getSession().then(({ data, error }) => {
      if (!cancelled && !authEventReceived) {
        if (error) dispatch({ type: 'SESSION_RECOVERY_FAILED' });
        else void applySession(data.session);
      }
    }).catch(() => {
      if (!cancelled && !authEventReceived) dispatch({ type: 'SESSION_RECOVERY_FAILED' });
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;
        // The SDK also emits INITIAL_SESSION(null) when renewal hits a network
        // error. Let getSession distinguish that from a genuinely absent session.
        if (event === 'INITIAL_SESSION' && !session) return;
        authEventReceived = true;
        const eventGeneration = ++authEventGeneration;
        // Invalidate identity reads immediately, before another deferred callback runs.
        identityRequestRef.current += 1;

        dispatch({
          type: 'SET_SESSION',
          session,
          user: session?.user ?? null,
          passwordRecovery:
            event === 'PASSWORD_RECOVERY',
        });

        if (!session?.user) {
          resolvedUserId = null;
          dispatch({ type: 'SET_PROFILE', profile: null });
          dispatch({ type: 'SET_IDENTITY', identity: null });
          dispatch({ type: 'SET_ERROR', error: null });
          return;
        }

        if (resolvedUserId !== session.user.id) {
          dispatch({ type: 'SET_PROFILE', profile: null });
          dispatch({ type: 'SET_IDENTITY', identity: null });
        }

        if (signupInProgressRef.current) return;

        // Token renewal updates the session without clearing identity or unmounting the panel.
        if (event === 'TOKEN_REFRESHED' && resolvedUserId === session.user.id) return;

        // Defer database reads until the auth callback releases its session lock.
        window.setTimeout(() => {
          if (!cancelled && eventGeneration === authEventGeneration) {
            void applySession(session, event === 'PASSWORD_RECOVERY');
          }
        }, 0);
      },
    );

    return () => {
      cancelled = true;
      identityRequestRef.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile, resolveIdentity, sessionRevision]);

  useEffect(() => {
    if (!state.sessionRecoveryError) return;
    window.addEventListener?.('online', retrySession);
    return () => window.removeEventListener?.('online', retrySession);
  }, [state.sessionRecoveryError, retrySession]);

  const signUp = useCallback(async (data: SignUpData): Promise<{ error: string | null; needsEmailConfirmation?: boolean }> => {
    if (!isSupabaseConfigured || !supabase) return { error: 'Supabase não configurado.' };
    if (!['PF', 'PJ'].includes(data.personType) || typeof data.document !== 'string'
      || (data.personType === 'PF' ? !isValidCpf(data.document) : !isValidCnpj(data.document))) {
      return { error: 'Informe um CPF/CNPJ válido para o tipo de cadastro selecionado.' };
    }

    signupInProgressRef.current = true;
    try {
      const { data: authData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: { business_name: data.businessName.trim(), whatsapp: data.whatsapp.trim(),
            document: normalizeDocument(data.document), person_type: data.personType },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) return { error: error.message };
      if (!authData.user) return { error: 'Falha ao criar conta.' };
      if (!authData.session) return { error: null, needsEmailConfirmation: true };

      const { identity, ownerProfile } = await resolveIdentity(authData.user.id);
      const profile = ownerProfile ?? await loadProfile(identity.companyUserId);
      dispatch({ type: 'SET_IDENTITY', identity });
      dispatch({ type: 'SET_PROFILE', profile });
      dispatch({ type: 'SET_ERROR', error: null });

      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Não foi possível concluir o cadastro da conta.' };
    } finally {
      signupInProgressRef.current = false;
    }
  }, [loadProfile, resolveIdentity]);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
    if (!isSupabaseConfigured || !supabase) return { error: 'Supabase não configurado.' };

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const { data: client, error: clientError } = await supabase
      .from('admin_lojistas')
      .select('status')
      .eq('user_id', data.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clientError) {
      console.error('Não foi possível verificar o status do lojista durante o login.', clientError);
    }
    if (client?.status === 'reprovado') {
      await supabase.auth.signOut();
      return { error: 'Acesso bloqueado pelo administrador da plataforma.' };
    }

    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;

    identityRequestRef.current += 1;

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      dispatch({ type: 'SET_ERROR', error: error.message });
      throw new Error(error.message);
    }

    dispatch({ type: 'RESET' });
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<{ error: string | null }> => {
    if (!isSupabaseConfigured || !supabase) return { error: 'Supabase não configurado.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    return { error: error?.message ?? null };
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<{ error: string | null }> => {
    if (!isSupabaseConfigured || !supabase) return { error: 'Supabase não configurado.' };
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  }, []);

  return { ...state, signUp, signIn, signOut, requestPasswordReset, updatePassword, retrySession };
}
