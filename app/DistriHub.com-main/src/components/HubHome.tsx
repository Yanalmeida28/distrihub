import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CircleDollarSign,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Wrench,
  Layers,
  Zap,
  Cpu,
  LogIn,
  Menu,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { planCatalog } from '../lib/planCatalog';
import './HubHome.css';
import { money } from '../utils';

type HubHomeProps = {
  onAccessPanel: () => void;
  onAccessSuperAdmin: () => void;
  superAdminActive?: boolean;
};

/**
 * Envolve uma seção e a revela com fade + leve deslocamento assim que
 * entra na tela. Puramente visual, não depende de nada externo.
 */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`dh-reveal ${visible ? 'is-visible' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function HubHome({ onAccessPanel, onAccessSuperAdmin, superAdminActive }: HubHomeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  function openPanel() {
    setMenuOpen(false);
    onAccessPanel();
  }

  function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Header ganha sombra/blur discretos assim que a página é rolada
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Menu mobile: fecha com Esc e trava o scroll do fundo enquanto aberto
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  return (
    <main className="hub-home">
      <style>{`
        html { scroll-behavior: smooth; }

        .dh-reveal {
          opacity: 0;
          transform: translateY(26px);
          transition: opacity .7s cubic-bezier(.22,1,.36,1), transform .7s cubic-bezier(.22,1,.36,1);
          will-change: opacity, transform;
        }
        .dh-reveal.is-visible { opacity: 1; transform: translateY(0); }

        .hub-header { transition: box-shadow .25s ease, backdrop-filter .25s ease, background-color .25s ease; }
        .hub-header.dh-scrolled {
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
          backdrop-filter: blur(10px);
        }

        .hub-nav a { position: relative; }
        .hub-nav a::after {
          content: '';
          position: absolute;
          left: 0; bottom: -5px;
          width: 0; height: 2px;
          background: currentColor;
          transition: width .25s ease;
        }
        .hub-nav a:hover::after,
        .hub-nav a:focus-visible::after { width: 100%; }

        .hub-login-btn, .hub-outline-button, .hub-super-admin-btn, .hub-plan button {
          transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease, background-color .18s ease;
        }
        .hub-login-btn:hover, .hub-outline-button:hover, .hub-plan button:hover {
          transform: translateY(-2px);
        }
        .hub-login-btn:active, .hub-outline-button:active, .hub-plan button:active {
          transform: translateY(0);
        }

        .hub-feature, .hub-module, .hub-plan, .hub-agile-card {
          transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease;
        }
        .hub-feature:hover, .hub-module:hover, .hub-agile-card:hover {
          transform: translateY(-4px);
        }
        .hub-plan:hover:not(.featured) { transform: translateY(-4px); }

        @media (prefers-reduced-motion: reduce) {
          .dh-reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
          .hub-feature, .hub-module, .hub-plan, .hub-agile-card,
          .hub-login-btn, .hub-outline-button, .hub-plan button { transition: none !important; }
        }
      `}</style>

      <header className={`hub-header ${scrolled ? 'dh-scrolled' : ''}`}>
        <div className="page-container hub-header-inner">
          <a className="brand-logo" href="#inicio" aria-label="DistriHub início">
            <span className="brand-mark">
              <span /> <span />
            </span>
            <span>
              Distri<span>Hub</span>
            </span>
          </a>
          <nav className={`hub-nav ${menuOpen ? 'open' : ''}`}>
            <a href="#solucoes" onClick={(e) => handleNavClick(e, '#solucoes')}>Soluções</a>
            <a href="#modulos" onClick={(e) => handleNavClick(e, '#modulos')}>Módulos</a>
            <a href="#migracao" onClick={(e) => handleNavClick(e, '#migracao')}>Migração</a>
            <a href="#planos" onClick={(e) => handleNavClick(e, '#planos')}>Planos</a>
          </nav>
          <div className="hub-header-actions">
            <button className="hub-login-btn secondary" onClick={openPanel}>
              <LogIn size={16} /> Entrar
            </button>
            <a className="hub-login-btn" href="#planos" onClick={event => handleNavClick(event, '#planos')}>Ver planos</a>
            <button
              className={`hub-super-admin-btn ${superAdminActive ? 'active' : ''}`}
              onClick={onAccessSuperAdmin}
              title="Acesso restrito ao administrador master do sistema"
            >
              <ShieldCheck size={16} /> {superAdminActive ? 'Painel Master' : 'Super Admin'}
            </button>
          </div>
          <button
            className="hub-menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </header>

      <section id="inicio" className="hub-hero">
        <div className="page-container hub-hero-inner">
          <div className="hub-hero-copy">
            <div className="eyebrow">
              <Sparkles size={14} /> Gestão B2B e ERP multiempresa em tempo real
            </div>
            <h1>
              Menos tempo procurando informações.
              <br />
              <em>Mais controle do seu negócio.</em>
            </h1>
            <p>
              Acompanhe o que vendeu, o que precisa repor, o que falta receber e quais serviços
              estão pendentes em cada filial. Tudo em um só lugar, com o DistriHub.
            </p>
            <div className="hub-hero-actions">
              <button className="hub-login-btn" onClick={openPanel}>Acessar DistriHub <ArrowRight size={16}/></button>
              <a className="hub-outline-button" href="#planos" onClick={event => handleNavClick(event, '#planos')}>Comparar planos</a>
            </div>
            <div className="hub-proof"><ShieldCheck size={16}/><span>Acesso por operador e permissões por filial</span></div>
          </div>
          <div className="hub-hero-visual">
            <div className="hub-orb hub-orb-1" /><div className="hub-orb hub-orb-2" />
            <div className="hub-dashboard-card">
              <div className="hub-dashboard-top"><span>DEMONSTRAÇÃO DO PAINEL</span><span>Dados ilustrativos</span></div>
              <div className="hub-dashboard-title"><div><small>Receita total</small><strong>R$ 284.920,00</strong></div><span className="hub-growth">+18,4%</span></div>
              <div className="hub-chart"><span style={{ height: '32%' }} /><span style={{ height: '46%' }} /><span style={{ height: '39%' }} /><span style={{ height: '63%' }} /><span style={{ height: '55%' }} /><span style={{ height: '78%' }} /><span style={{ height: '92%' }} /></div>
              <div className="hub-dashboard-stats"><div><small>Pedidos hoje</small><strong>148</strong></div><div><small>Estoque disponível</small><strong>12.480</strong></div><div><small>Filiais online</small><strong>04/04</strong></div></div>
              <div className="hub-transfer"><span><PackageCheck size={16} /> Transferência aprovada</span><strong>45 un. <small>Centro → Zona Sul</small></strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className="hub-stats-strip">
        <div className="page-container hub-stats-grid"><div><strong>PDV</strong><span>vendas e caixa</span></div><div><strong>OS</strong><span>assistência técnica</span></div><div><strong>Filiais</strong><span>acesso por unidade</span></div><div><strong>Gestão</strong><span>recursos por plano</span></div></div>
      </section>

      <section id="solucoes" className="hub-features">
        <div className="page-container">
          <Reveal>
            <div className="hub-section-head">
              <div className="eyebrow">SOLUÇÕES POR OPERAÇÃO</div>
              <h2>Um sistema para cada etapa do seu negócio</h2>
              <p>Do pedido B2B ao pós-venda, tudo conectado em uma única operação</p>
            </div>
          </Reveal>
          <div className="hub-feature-grid">
            <Reveal><div className="hub-feature">
              <Layers size={24} />
              <h4>Distribuição B2B</h4>
              <p>Catálogo por cliente, tabelas de preço e pedidos centralizados para vender no atacado.</p>
            </div></Reveal>
            <Reveal><div className="hub-feature">
              <Zap size={24} />
              <h4>PDV para o dia a dia</h4>
              <p>Venda no balcão com busca de produtos, leitura de códigos e acompanhamento dos pagamentos registrados.</p>
            </div></Reveal>
            <Reveal><div className="hub-feature">
              <Building2 size={24} />
              <h4>Multiempresa e filiais</h4>
              <p>Tenha visão consolidada, estoque cruzado e permissões por unidade sem duplicar trabalho.</p>
            </div></Reveal>
            <Reveal><div className="hub-feature">
              <ShieldCheck size={24} />
              <h4>Garantia e RMA</h4>
              <p>Acompanhe produtos por número de série, identificação e fotos. Organize as devoluções e os créditos de troca.</p>
            </div></Reveal>
            <Reveal><div className="hub-feature">
              <Wrench size={24} />
              <h4>Fiscal sem retrabalho</h4>
              <p>Importe XML de NF-e, atualize custos e mantenha sua operação pronta para a emissão fiscal.</p>
            </div></Reveal>
            <Reveal><div className="hub-feature">
              <PackageCheck size={24} />
              <h4>Vendas e pagamentos</h4>
              <p>Registre formas de pagamento e acompanhe seus pedidos. Recursos de crédito e entrega dependem do plano.</p>
            </div></Reveal>
          </div>
        </div>
      </section>

      <section id="migracao" className="hub-migration">
        <div className="page-container hub-migration-inner">
          <Reveal><div><div className="eyebrow"><Zap size={14} /> ORGANIZE SUA OPERAÇÃO</div><h2>Troque a planilha por uma operação que acompanha seu ritmo.</h2><p>Cadastre seus produtos, clientes e fornecedores. Confira as opções de importação disponíveis e revise os dados antes de começar a vender.</p><a className="hub-outline-button" href="#planos" onClick={event => handleNavClick(event, '#planos')}>Conhecer os planos <ArrowRight size={15} /></a></div></Reveal>
          <Reveal><div className="hub-steps"><div><b>01</b><span><strong>Cadastros organizados</strong><small>Produtos, clientes, fornecedores e entrada por XML.</small></span></div><div><b>02</b><span><strong>Configuração por perfil</strong><small>Menus e permissões conforme o plano e o operador.</small></span></div><div><b>03</b><span><strong>Equipe em operação</strong><small>Guias de ajuda para consultar dentro do app.</small></span></div></div></Reveal>
        </div>
      </section>

      <section id="modulos" className="hub-modules">
        <div className="page-container">
          <Reveal><div className="hub-section-head"><div className="eyebrow">MÓDULOS CONFIGURÁVEIS</div><h2>Ative o que sua operação precisa</h2><p>O menu se adapta ao seu negócio, sem excesso de ferramentas na tela.</p></div></Reveal>
          <div className="hub-module-grid">{[['OS com fotos','Condições e fotos do atendimento',Wrench],['Catálogo B2B','Portal atacado por cliente',PackageCheck],['Curva ABC','Analytics para decisão',BarChart3],['Estoque cruzado','Transferências aprovadas',Layers],['Fiscal NF-e/NFC-e','Conformidade e controle',CircleDollarSign]].map(([title, description, Icon]) => { const ModuleIcon = Icon as typeof Wrench; return <Reveal key={title as string}><div className="hub-module"><span className="hub-module-icon"><ModuleIcon size={18} /></span><div><strong>{title as string}</strong><small>{description as string}</small></div><Check size={16} /></div></Reveal>; })}</div>
        </div>
      </section>

      <section id="planos" className="hub-plans">
        <div className="page-container">
          <Reveal><div className="hub-section-head"><div className="eyebrow">PLANOS PARA CRESCER</div><h2>Comece simples. Escale sem trocar de sistema.</h2><p>Escolha o plano ideal para a estrutura atual da sua operação.</p></div></Reveal>
          <div className="hub-plan-grid">{[
            { ...planCatalog.basico, features: ['1 filial', '3 dispositivos simultâneos por filial', 'PDV, caixa e pedidos', 'Cadastros e histórico de vendas', 'Ordens de serviço', 'Personalização básica de impressão', 'Relatórios simples', 'Configurações e suporte'] },
            { ...planCatalog.profissional, features: ['Tudo do Básico', 'Até 3 filiais', '5 dispositivos simultâneos por filial', 'Estoque, financeiro e entregas', 'Ordens de serviço, RMA e fiscal', 'CRM, cupons e relatórios avançados', 'Administrativo e permissões'] },
            { ...planCatalog.enterprise, features: ['Tudo do Profissional', 'Até 5 filiais', '8 dispositivos simultâneos por filial', `Filial adicional por ${money.format(planCatalog.enterprise.extraBranchPrice)}/mês`, 'Personalização White-label', 'Suporte prioritário'] },
          ].map((plan, index) => <Reveal key={plan.name}><div className={`hub-plan ${index === 1 ? 'featured' : ''}`}>{index === 1 && <span className="hub-plan-badge">PROFISSIONAL</span>}<strong>Plano {plan.name}</strong><div className="hub-plan-price">{money.format(plan.price)}<em>/ mês</em></div><ul>{plan.features.map(feature => <li key={feature}><Check size={14} /> {feature}</li>)}</ul><button onClick={openPanel}>Acessar para contratar <ArrowRight size={14} /></button></div></Reveal>)}</div>
          <div className="hub-plan-comparison">
            <h3>Compare o que está incluído em cada plano</h3>
            <p>Veja os módulos disponíveis e escolha o plano para sua operação.</p>
            <div className="hub-plan-table-scroll" role="region" aria-label="Comparação dos planos" tabIndex={0}>
              <table className="hub-plan-table">
                <caption>Módulos e limites dos planos DistriHub</caption>
                <thead><tr><th scope="col">Módulo e recursos</th><th scope="col">Básico</th><th scope="col">Profissional</th><th scope="col">Enterprise</th></tr></thead>
                <tbody>
                  {[
                    ['Lojas / filiais', 'Quantidade de unidades incluídas na assinatura', '1', 'Até 3', 'Até 5'],
                    ['Dispositivos simultâneos', 'Acessos conectados ao mesmo tempo, por filial', '3', '5', '8'],
                    ['Filial adicional', 'Sujeita à aprovação e confirmação do pagamento', '—', '—', `${money.format(planCatalog.enterprise.extraBranchPrice)}/mês`],
                    ['Cadastros', 'Produtos, serviços, SKU, código de barras, fotos, categorias, clientes e fornecedores', 'Incluído', 'Incluído', 'Incluído'],
                    ['PDV & Vendas', 'Atendimento, carrinho e fechamento de vendas', 'Incluído', 'Incluído', 'Incluído'],
                    ['Caixa', 'Abertura, movimentações e fechamento', 'Incluído', 'Incluído', 'Incluído'],
                    ['Pedidos em aberto', 'Acompanhamento e conclusão de vendas pendentes', 'Incluído', 'Incluído', 'Incluído'],
                    ['Histórico', 'Consulta das vendas realizadas e seus detalhes', 'Incluído', 'Incluído', 'Incluído'],
                    ['Relatórios', 'Acompanhamento das vendas e dos resultados', 'Simples', 'Avançados', 'Avançados'],
                    ['Estoque', 'Saldos, estoque mínimo, reposição e ajustes por filial', '—', 'Incluído', 'Incluído'],
                    ['CRM', 'Histórico dos clientes e acompanhamento comercial', '—', 'Incluído', 'Incluído'],
                    ['Entregas', 'Organização e acompanhamento das entregas', '—', 'Incluído', 'Incluído'],
                    ['Financeiro', 'Contas a pagar e receber e fluxo financeiro', '—', 'Incluído', 'Incluído'],
                    ['Ordens de serviço', 'Cadastro e acompanhamento dos serviços e equipamentos', 'Incluído', 'Incluído', 'Incluído'],
                    ['RMA & Devoluções', 'Solicitações de devolução, troca e reembolso', '—', 'Incluído', 'Incluído'],
                    ['Fiscal', 'Recursos de notas fiscais', '—', 'Incluído', 'Incluído'],
                    ['Administrativo', 'Gestão da empresa, equipe e permissões', '—', 'Incluído', 'Incluído'],
                    ['Cupons', 'Cupons de desconto para vendas', '—', 'Incluído', 'Incluído'],
                    ['Personalização básica', 'Informações de impressão e termos de serviço nas áreas disponíveis', 'Incluído', 'Incluído', 'Incluído'],
                    ['Personalização profissional', 'Recursos adicionais conforme as opções disponíveis na conta', '—', 'Incluído', 'Incluído'],
                    ['Aba Personalização', 'Identidade visual White-label e preferências do sistema', '—', '—', 'Incluído'],
                    ['Configurações', 'Dados da conta e assinatura', 'Incluído', 'Incluído', 'Incluído'],
                    ['Suporte', 'Atendimento para sua empresa', 'Incluído', 'Incluído', 'Prioritário'],
                  ].map(([module, description, ...values]) => (
                    <tr key={module}>
                      <th scope="row">{module}<small>{description}</small></th>
                      {values.map((value, index) => <td key={index} data-plan={['Básico','Profissional','Enterprise'][index]}>{value === '—' ? <span aria-label="Não incluído">—</span> : value}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="hub-about">
        <div className="page-container">
          <div className="hub-about-grid">
            <Reveal><div className="hub-about-copy">
              <div className="eyebrow"><Cpu size={14} /> TECNOLOGIA DE ALTO NÍVEL</div>
              <h2>Engenharia de Software criada para destravar o crescimento do seu negócio.</h2>
              <p>
                A DistriHub transforma a complexidade da distribuição em uma rotina clara para sua
                equipe. Conectamos distribuidores, assistências técnicas e lojistas em uma plataforma
                integrada, com dados para decidir e ferramentas para executar.
              </p>
              <div className="hub-about-metrics">
                <div className="hub-metric">
                  <strong>Operadores</strong>
                  <small>Acesso com PIN</small>
                </div>
                <div className="hub-metric">
                  <strong>Filiais</strong>
                  <small>Permissões por unidade</small>
                </div>
                <div className="hub-metric">
                  <strong>Planos</strong>
                  <small>Recursos para cada operação</small>
                </div>
              </div>
            </div></Reveal>
            <div className="hub-about-cards">
              <Reveal><div className="hub-agile-card">
                <span className="hub-agile-icon"><Zap size={22} /></span>
                <h4>Agilidade no atendimento</h4>
                <p>Consulte produtos, monte pedidos e acompanhe vendas em um fluxo organizado para o balcão.</p>
              </div></Reveal>
              <Reveal><div className="hub-agile-card">
                <span className="hub-agile-icon"><ShieldCheck size={22} /></span>
                <h4>Rastreabilidade e controle de acesso</h4>
                <p>Organize identificações de produtos e registros de atendimento, com permissões por operador e filial.</p>
              </div></Reveal>
              <Reveal><div className="hub-agile-card">
                <span className="hub-agile-icon"><Layers size={22} /></span>
                <h4>Ecosistema Integrado &amp; Escalável</h4>
                <p>Filiais, financeiro, entregas e recursos fiscais conforme o plano contratado. A emissão fiscal depende da configuração da empresa e do serviço de emissão.</p>
              </div></Reveal>
            </div>
          </div>
        </div>
      </section>

      <footer className="hub-footer">
        <div className="page-container hub-footer-inner">
          <p>&copy; {new Date().getFullYear()} DistriHub — Plataforma de Gestão ERP, Vendas e Distribuição B2B</p>
        </div>
      </footer>
    </main>
  );
}
