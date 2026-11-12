import { useSupportUnread } from '../hooks/useSupportUnread';
import { SupportUnreadBadge } from './SupportUnreadBadge';
import { useEffect, useState } from 'react';
import {
  ArrowLeft, Users, Check, BarChart3, ClipboardList,
  Receipt, ShieldCheck, Lock, Eye, EyeOff, Headphones,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useSuperAdminAuth } from '../hooks/useSuperAdminAuth';
import type { AdminCompany, AdminLojista } from '../types';
import { money } from '../utils';
import { AdminSaasModule } from './AdminSaasModule';
import { AdminSupportInbox } from './AdminSupportInbox';
import { AdminPlanRequestsModule } from './AdminPlanRequestsModule';
import { AdminResponsiveTable } from './AdminResponsiveTable';
import { AdminCompanySegmentField } from './AdminCompanySegmentField';
import { businessSegmentLabels } from '../lib/businessSegments';


type AdminPanelProps = {
  onBack: () => void;
};

type AdminTab = 'visao' | 'historico' | 'lojistas' | 'financeiro' | 'faturas' | 'planos' | 'seguranca' | 'suporte' | 'assinaturas';

function companyRegistrationDate(value?: string | null) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  }).format(date);
}

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [supportActorId, setSupportActorId] = useState<string>();
  const supportUnread = useSupportUnread(supportActorId, true);
  const [tab, setTab] = useState<AdminTab>('visao');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [details, setDetails] = useState<AdminCompany | null>(null);
  const [accessCompanyId, setAccessCompanyId] = useState<string | null>(null);
  const [companiesVersion, setCompaniesVersion] = useState(0);
  const [lojistas, setLojistas] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCompanyIds, setSavingCompanyIds] = useState<Set<string>>(() => new Set());
  const [statusFeedback, setStatusFeedback] = useState<Record<string, { type: 'success' | 'error'; message: string }>>({});
  const superAdminAuth = useSuperAdminAuth();

  useEffect(() => {
    let cancelled = false;
    async function loadAdminData() {
      setLoading(true);
      setError(null);
      if (!isSupabaseConfigured || !supabase) {
        setError('Supabase não configurado. Não foi possível carregar o painel master.');
        setLoading(false);
        return;
      }
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) throw new Error('Sessão do super admin inválida.');

        const { data: isSuperAdmin, error: authError } = await supabase.rpc('is_super_admin');
        if (authError || isSuperAdmin !== true) {
          throw new Error('Operador não autorizado para o painel master.');
        }

        const loj = await supabase.rpc('get_super_admin_company_overview_auth');
        if (loj.error) throw loj.error;
        if (cancelled) return;
        setSupportActorId(userData.user.id);
        setLojistas((loj.data as AdminCompany[]) ?? []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o painel master.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAdminData();
    return () => { cancelled = true; };
  }, [companiesVersion]);

  async function updateLojista(id: string, updates: Partial<AdminCompany>) {
    setSavingCompanyIds((current) => new Set(current).add(id));
    setStatusFeedback((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado. A alteração não foi salva.');
      }
      const { error: updateError } = await supabase.rpc('update_super_admin_client_auth', {
        client_id: id,
        new_status: updates.status ?? null,
        new_credit_limit: updates.credit_limit ?? null,
      });
      if (updateError) throw updateError;
      setLojistas((prev) => prev.map((l) => l.id === id ? { ...l, ...updates, client_status: updates.status ?? l.client_status } : l));
      setStatusFeedback((current) => ({ ...current, [id]: { type: 'success', message: 'Status salvo.' } }));
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Não foi possível salvar o status da empresa.';
      setStatusFeedback((current) => ({ ...current, [id]: { type: 'error', message } }));
    } finally {
      setSavingCompanyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const tabs: { id: AdminTab; label: string; icon: typeof Users }[] = [
    { id: 'visao', label: 'Visão geral', icon: BarChart3 },
    { id: 'lojistas', label: 'Gestão de Clientes', icon: Users },
    { id: 'financeiro', label: 'Financeiro SaaS', icon: BarChart3 },
    { id: 'faturas', label: 'Faturas SaaS', icon: Receipt },
    { id: 'assinaturas', label: 'Acesso ao aplicativo', icon: ShieldCheck },
    { id: 'planos', label: 'Solicitações de Plano', icon: ClipboardList },
    { id: 'suporte', label: 'Suporte', icon: Headphones },
    { id: 'historico', label: 'Histórico administrativo', icon: ClipboardList },
    { id: 'seguranca', label: 'Segurança', icon: ShieldCheck },
  ];
  const filteredClients = lojistas.filter(c =>
    `${c.business_name} ${c.email ?? ''} ${c.document ?? ''} ${c.whatsapp ?? ''}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))
    && (clientFilter === 'all' || c.client_status === clientFilter)
    && (planFilter === 'all' || c.subscription_plan === planFilter));

  return (
    <div className="partner-panel admin-panel">
      <div className="partner-header admin-header">
        <div className="page-container partner-header-inner">
          <button className="partner-back-btn" onClick={onBack}>
            <ArrowLeft size={18} /> Sair do app
          </button>
          <div className="partner-title">
            <h2>Painel Super Admin</h2>
            <p>Controle de acesso, empresas, assinaturas e cobranças</p>
          </div>
          {loading && <span className="partner-loading">Carregando...</span>}
          {error && <span className="admin-load-error" role="alert">{error}</span>}
        </div>
      </div>

      <div className="page-container partner-body">
        <div className="partner-tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`partner-tab ${tab === id ? 'active' : ''}`} onClick={() => { setAccessCompanyId(null); setTab(id); }}>
              <Icon size={17} /> {label}{id === 'suporte' && <SupportUnreadBadge count={supportUnread.total} />}
            </button>
          ))}
        </div>

        <div className="partner-content">
          {error && !loading && <div className="admin-load-error admin-load-error-panel" role="alert">{error}</div>}
          {tab === 'visao' && <AdminSaasModule view="overview" onNavigate={destination => setTab(destination)} />}
          {tab === 'historico' && <AdminSaasModule view="history" />}

          {tab === 'lojistas' && (
            <div className="panel-module">
              <div className="module-header">
                <span className="module-icon"><Users size={20} /></span>
                <div>
                  <h3>Clientes da Plataforma</h3>
                  <p>Gerencie o cadastro comercial e abra os controles de acesso de cada empresa.</p>
                </div>
              </div>
              <div className="admin-client-summary">
                <strong>{filteredClients.length}</strong> de {lojistas.length} clientes
              </div>
              <div className="rma-form inline admin-filters">
                <label>Buscar cliente<input type="search" placeholder="Empresa, e-mail, documento ou telefone" value={search} onChange={e => setSearch(e.target.value)} /></label>
                <label>Cadastro comercial<select value={clientFilter} onChange={e => setClientFilter(e.target.value)}><option value="all">Todos</option><option value="pendente">Pendente</option><option value="aprovado">Aprovado</option><option value="reprovado">Bloqueado</option></select></label>
                <label>Plano<select value={planFilter} onChange={e => setPlanFilter(e.target.value)}><option value="all">Todos</option><option value="basico">Básico</option><option value="profissional">Profissional</option><option value="enterprise">Enterprise</option></select></label>
                <button type="button" className="rma-advance-btn" disabled={loading} onClick={() => setCompaniesVersion(v => v + 1)}>Atualizar</button>
              </div>
              {details && <section className="module-card admin-client-detail"><div className="module-header"><h4>{details.business_name}</h4><button className="rma-advance-btn" onClick={() => setDetails(null)}>Fechar ficha</button></div><dl className="admin-detail-grid">
                {Object.entries({ 'Responsável': details.account_name, 'E-mail': details.email, 'Contato': details.whatsapp, 'Documento': details.document, 'Ramo': businessSegmentLabels[details.segment] ?? details.segment, 'Plano': details.subscription_plan, 'Assinatura': details.subscription_status, 'Cadastro comercial': details.client_status, 'Pedidos': details.orders_count, 'Total de compras': money.format(details.orders_total), 'Limite de crédito': details.credit_limit == null ? 'Não definido' : money.format(details.credit_limit) }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
                <div><dt>Data de cadastro (Brasília)</dt><dd>{companyRegistrationDate(details.created_at)}</dd></div>
              </dl></section>}
              <AdminResponsiveTable>
                <table className="rma-table">
                  <thead>
                    <tr><th>Empresa</th><th>Cadastro (Brasília)</th><th>Login</th><th>Contato</th><th>Documento</th><th>Ramo</th><th>Assinatura</th><th>Compras</th><th>Cadastro comercial</th><th>Acesso ao aplicativo</th></tr>
                  </thead>
                  <tbody>
                    {filteredClients.length === 0 ? (
                      <tr><td colSpan={10} className="empty-row">{loading ? 'Carregando clientes...' : 'Nenhuma empresa encontrada.'}</td></tr>
                    ) : (
                      filteredClients.map((cliente) => (
                        <tr key={cliente.id}>
                          <td><strong>{cliente.business_name}</strong><small className="admin-client-id">{cliente.account_name ?? cliente.user_id?.slice(0, 8)}</small></td>
                          <td>{companyRegistrationDate(cliente.created_at)}</td>
                          <td>{cliente.email ?? '—'}</td>
                          <td>{cliente.whatsapp ?? '—'}</td>
                          <td>{cliente.document ?? '—'}</td>
                          <td><AdminCompanySegmentField key={cliente.id} companyId={cliente.id} companyName={cliente.business_name} value={cliente.segment}
                            onSaved={segment => {
                              setLojistas(current => current.map(company => company.id === cliente.id ? { ...company, segment } : company));
                              setDetails(current => current?.id === cliente.id ? { ...current, segment } : current);
                            }} /></td>
                          <td>
                            <span>{cliente.subscription_plan ?? 'basico'} · {cliente.subscription_status ?? 'trial'}</span>
                          </td>
                          <td>{cliente.orders_count} · {money.format(cliente.orders_total)}</td>
                          <td>
                            <select
                              className="inline-select"
                              aria-label={`Status comercial de ${cliente.business_name}`}
                              value={cliente.client_status}
                              disabled={savingCompanyIds.has(cliente.id)}
                              onChange={(e) => { void updateLojista(cliente.id, { status: e.target.value as AdminLojista['status'] }); }}
                            >
                              <option value="pendente">Pendente</option>
                              <option value="aprovado">Aprovado</option>
                              <option value="reprovado">Bloqueado</option>
                            </select>
                            {savingCompanyIds.has(cliente.id) && <small role="status">Salvando…</small>}
                            {statusFeedback[cliente.id] && (
                              <small role={statusFeedback[cliente.id].type === 'error' ? 'alert' : 'status'}>
                                {statusFeedback[cliente.id].message}
                              </small>
                            )}
                          </td>
                          <td><div className="subscription-actions"><button className="rma-advance-btn" onClick={() => setDetails(cliente)}>Ver ficha</button><button className="rma-advance-btn" disabled={!cliente.user_id} onClick={() => {
                            setAccessCompanyId(cliente.user_id); setTab('assinaturas');
                          }}>Controlar acesso</button></div></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </AdminResponsiveTable>
            </div>
          )}

          {tab === 'financeiro' && <AdminSaasModule view="financial" />}
          {tab === 'faturas' && <AdminSaasModule view="invoices" />}
          {tab === 'assinaturas' && <AdminSaasModule view="subscriptions" initialCompanyId={accessCompanyId} onChanged={() => setCompaniesVersion(version => version + 1)} />}

          {tab === 'suporte' && <AdminSupportInbox companies={lojistas} unreadCounts={supportUnread.conversations} />}

          {tab === 'planos' && <AdminPlanRequestsModule onChanged={() => setCompaniesVersion(v => v + 1)} />}

          {tab === 'seguranca' && (
            <ChangePasswordSection auth={superAdminAuth} />
          )}
        </div>
      </div>
    </div>
  );
}

function ChangePasswordSection({ auth }: { auth: ReturnType<typeof useSuperAdminAuth> }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }
    if (newPassword.length < 6) {
      setError('A nova senha deve ter ao menos 6 caracteres.');
      return;
    }
    setLoading(true);
    const ok = await auth.changePassword(newPassword);
    setLoading(false);
    if (!ok) {
      setError('Não foi possível atualizar a senha do super admin.');
      return;
    }
    setSuccess(true);
    setNewPassword('');
    setConfirmPassword('');
  }

  return (
    <div className="panel-module">
      <div className="module-header">
        <span className="module-icon"><ShieldCheck size={20} /></span>
        <div>
          <h3>Segurança — Alterar Senha Master</h3>
          <p>Atualize a credencial de acesso ao painel super admin</p>
        </div>
      </div>
      <form className="rma-form" onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        <label>
          <span className="social-label"><Lock size={14} /> Nova Senha</span>
          <div className="password-input-wrap">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setError(null); setSuccess(false); }}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <button type="button" className="password-toggle" onClick={() => setShowNew(!showNew)} aria-label={showNew ? 'Ocultar nova senha' : 'Mostrar nova senha'}>
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <label>
          <span className="social-label"><Lock size={14} /> Confirmar Nova Senha</span>
          <div className="password-input-wrap">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(null); setSuccess(false); }}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <button type="button" className="password-toggle" onClick={() => setShowConfirm(!showConfirm)} aria-label={showConfirm ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}>
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        {error && <p className="super-admin-gate-error" role="alert" aria-live="polite">{error}</p>}
        {success && (
          <p className="super-admin-change-success" aria-live="polite">
            <Check size={14} /> Senha master atualizada com sucesso!
          </p>
        )}
        <button type="submit" className="module-submit-btn" disabled={loading}>
          <ShieldCheck size={16} /> {loading ? 'Atualizando...' : 'Atualizar senha master'}
        </button>
      </form>
    </div>
  );
}
