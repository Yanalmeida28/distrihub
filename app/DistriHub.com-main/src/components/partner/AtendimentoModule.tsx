import { useRef, useState } from 'react';
import { ArrowUpRight, Bot, GitBranch, Image, Inbox, Link2, MessageCircle, Users } from 'lucide-react';
import './AtendimentoModule.css';

const sections = [
  { id: 'conversas', label: 'Conversas', icon: Inbox, empty: 'A caixa de entrada está vazia', detail: 'A fila receberá as mensagens depois que a integração estiver ativa.' },
  { id: 'contatos', label: 'Contatos', icon: Users, empty: 'Nenhum contato na central', detail: 'Os contatos de atendimento aparecerão aqui quando o canal estiver ativo.' },
  { id: 'campanhas', label: 'Campanhas', icon: Image, empty: 'Nenhuma campanha', detail: 'A configuração de campanhas com imagem ficará disponível após a liberação dos envios.' },
  { id: 'funil', label: 'Funil', icon: GitBranch, empty: 'Nenhum atendimento no funil', detail: 'As etapas poderão ser usadas para acompanhar os atendimentos da central.' },
  { id: 'chatbot', label: 'Chatbot', icon: Bot, empty: 'Nenhuma automação ativa', detail: 'Ative o canal de atendimento antes de configurar a saudação e o encaminhamento.' },
] as const;

export default function AtendimentoModule({ branchName }: { branchName?: string }) {
  const [active, setActive] = useState<typeof sections[number]['id']>('conversas');
  const [showConnection, setShowConnection] = useState(false);
  const connectionButton = useRef<HTMLButtonElement>(null);
  const section = sections.find(item => item.id === active) ?? sections[0];
  const Icon = section.icon;

  function openConnection() {
    setShowConnection(true);
    connectionButton.current?.focus();
  }

  return (
    <section className="module-card atendimento" aria-labelledby="atendimento-title">
      <header className="atendimento-header">
        <div className="atendimento-title">
          <span className="atendimento-icon"><MessageCircle size={24} aria-hidden="true" /></span>
          <div><h2 id="atendimento-title">Atendimento</h2><p>{branchName ? `Central de WhatsApp · ${branchName}` : 'Central de WhatsApp'}</p></div>
        </div>
        <span className="atendimento-status">API oficial pendente</span>
      </header>

      {branchName ? (
        <section className="atendimento-connection" aria-labelledby="atendimento-web-title">
          <div className="atendimento-connection-row">
            <div>
              <h3 id="atendimento-web-title">WhatsApp Web</h3>
              <p>Teste nesta filial. No WhatsApp, abra Aparelhos conectados e escaneie o QR Code exibido na nova guia.</p>
              <p>Use o número da filial ao entrar. As mensagens ficam no WhatsApp Web.</p>
            </div>
            <a className="btn-primary atendimento-button" href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer">
              <ArrowUpRight size={17} aria-hidden="true" /> Conectar via WhatsApp Web
            </a>
          </div>
        </section>
      ) : (
        <section className="atendimento-connection">
          <h3>Selecione a filial do teste</h3>
          <p>Escolha uma filial no seletor do painel para abrir o WhatsApp Web.</p>
        </section>
      )}

      <section className="atendimento-connection" aria-labelledby="atendimento-connection-title">
        <div className="atendimento-connection-row">
          <div>
            <h3 id="atendimento-connection-title">Conexão do WhatsApp Business</h3>
            <p>A autorização do número depende da liberação da integração oficial no DistriHub.</p>
          </div>
          <button ref={connectionButton} type="button" className="btn-secondary atendimento-button" aria-expanded={showConnection} aria-controls="atendimento-connection-guide" onClick={() => setShowConnection(value => !value)}>
            <Link2 size={17} aria-hidden="true" /> {showConnection ? 'Ocultar instruções' : 'Como conectar'}
          </button>
        </div>
        <div id="atendimento-connection-guide" hidden={!showConnection} className="atendimento-guide">
          <ol>
            <li>Tenha acesso de administrador ao portfólio empresarial da Meta que usará para o WhatsApp.</li>
            <li>Após a liberação no DistriHub, inicie a autorização pela aba Atendimento e selecione a empresa e o número na Meta.</li>
            <li>Quando a integração estiver ativa, valide o recebimento e a resposta com uma conversa de teste.</li>
          </ol>
          <p>Se o número estiver no app WhatsApp Business, a Meta verifica se ele pode continuar no aplicativo e também usar a API.</p>
          <a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/" target="_blank" rel="noreferrer">
            Consultar a integração oficial da Meta <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </section>

      <nav className="atendimento-nav" aria-label="Seções de atendimento">
        {sections.map(({ id, label, icon: SectionIcon }) => (
          <button type="button" key={id} aria-pressed={active === id} onClick={() => setActive(id)}>
            <SectionIcon size={18} aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      <section className="atendimento-empty" aria-labelledby="atendimento-section-title">
        <span className="atendimento-icon"><Icon size={24} aria-hidden="true" /></span>
        <h3 id="atendimento-section-title">{section.empty}</h3>
        <p>{section.detail}</p>
        {!showConnection && <button type="button" className="btn-secondary atendimento-button" onClick={openConnection}>Ver instruções de conexão</button>}
      </section>
    </section>
  );
}
