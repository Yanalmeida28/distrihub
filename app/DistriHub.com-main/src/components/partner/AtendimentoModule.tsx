import { useEffect, useState } from 'react';
import './AtendimentoModule.css';

const sections = ['Conversas', 'Contatos', 'Campanhas', 'Funil', 'Chatbot'] as const;
const statuses = ['Novo', 'Em atendimento', 'Aguardando cliente', 'Resolvido'] as const;
const stages = ['Novo contato', 'Em negociação', 'Pedido fechado', 'Pós-venda'] as const;
const quickReplies = [
  ['Saudação', 'Olá! Como podemos ajudar?'],
  ['Consultar pedido', 'Você pode me informar o número do pedido?'],
  ['Consultar entrega', 'Qual é o CEP da entrega?'],
] as const;

type Conversation = {
  id: number;
  name: string;
  city: string;
  status: typeof statuses[number];
  stage: typeof stages[number];
  assigned: boolean;
  messages: { text: string; outgoing?: boolean }[];
};

const examples: Conversation[] = [
  { id: 1, name: 'Mercado Horizonte', city: 'São Paulo', status: 'Novo', stage: 'Novo contato', assigned: false, messages: [{ text: 'Olá, podem me enviar o catálogo?' }] },
  { id: 2, name: 'Empório do Vale', city: 'Campinas', status: 'Aguardando cliente', stage: 'Em negociação', assigned: true, messages: [{ text: 'Vocês entregam em Campinas?' }, { text: 'Sim. Qual é o bairro da entrega?', outgoing: true }] },
  { id: 3, name: 'Mercearia das Flores', city: 'São Paulo', status: 'Novo', stage: 'Pós-venda', assigned: false, messages: [{ text: 'Bom dia! Gostaria de confirmar a data de entrega do meu pedido.' }] },
];

export default function AtendimentoModule() {
  const [section, setSection] = useState<typeof sections[number]>('Conversas');
  const [conversations, setConversations] = useState(examples);
  const [selectedId, setSelectedId] = useState(1);
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [audience, setAudience] = useState<number[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [interval, setInterval] = useState(30);
  const [greeting, setGreeting] = useState('Olá! Como podemos ajudar? Digite 1 para falar com um atendente.');
  const [botInput, setBotInput] = useState('');
  const [botResult, setBotResult] = useState('');

  useEffect(() => {
    if (!image) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const selected = conversations.find(item => item.id === selectedId);
  const draft = drafts[selectedId] ?? '';
  const contacts = conversations.filter(item =>
    item.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')) && (!city || item.city === city));
  const queue = conversations.filter(item => statusFilter === 'Todos' || item.status === statusFilter);

  function update(id: number, patch: Partial<Conversation>) {
    setConversations(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  function open(id: number) {
    setSelectedId(id);
    setStatusFilter('Todos');
    setSection('Conversas');
  }

  return (
    <section className="module-card atendimento" aria-label="Atendimento">
      <div className="module-header"><div><h3>Atendimento</h3><p>WhatsApp</p></div></div>
      <p className="atendimento-note" role="status">Modo demonstração. Os dados são fictícios e as alterações duram até recarregar a página. Envios reais estão desativados.</p>
      <nav className="atendimento-actions" aria-label="Seções de atendimento">
        {sections.map(item => <button key={item} type="button" className={section === item ? 'btn-primary' : 'btn-secondary'} aria-pressed={section === item} onClick={() => setSection(item)}>{item}</button>)}
      </nav>

      {section === 'Conversas' && <div className="atendimento-split">
        <aside className="atendimento-box">
          <label>Status da fila
            <select value={statusFilter} onChange={event => {
              const value = event.target.value;
              setStatusFilter(value);
              if (value !== 'Todos' && selected?.status !== value) {
                setSelectedId(conversations.find(item => item.status === value)?.id ?? 0);
              }
            }}>{['Todos', ...statuses].map(status => <option key={status}>{status}</option>)}</select>
          </label>
          <p>{conversations.filter(item => item.status === 'Novo' && !item.assigned).length} aguardando atendimento</p>
          {queue.map(item => <button type="button" className="atendimento-row" key={item.id} aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}>
            <strong>{item.name}</strong><small>{item.status}{item.assigned ? ' · Você' : ' · Sem responsável'}</small>
          </button>)}
          {!queue.length && <p>Nenhuma conversa neste status.</p>}
        </aside>
        <div className="atendimento-box">
          {selected ? <>
            <h4>{selected.name}</h4>
            <div className="atendimento-actions">
              {!selected.assigned && <button className="btn-secondary" onClick={() => { update(selected.id, { assigned: true, status: 'Em atendimento' }); setStatusFilter('Todos'); }}>Assumir conversa</button>}
              <label>Status da conversa
                <select value={selected.status} onChange={event => { update(selected.id, { status: event.target.value as Conversation['status'] }); setStatusFilter('Todos'); }}>
                  {statuses.map(status => <option key={status}>{status}</option>)}
                </select>
              </label>
            </div>
            <ol className="atendimento-messages" aria-label="Histórico da conversa">
              {selected.messages.map((message, index) => <li key={index} data-outgoing={message.outgoing || undefined}><small>{message.outgoing ? 'Você' : selected.name}</small>{message.text}</li>)}
            </ol>
            <form onSubmit={event => {
              event.preventDefault();
              if (!selected.assigned || !draft.trim()) return;
              update(selected.id, { messages: [...selected.messages, { text: draft.trim(), outgoing: true }] });
              setDrafts(values => ({ ...values, [selected.id]: '' }));
            }}>
              <label>Resposta de teste<textarea value={draft} maxLength={4096} onChange={event => setDrafts(values => ({ ...values, [selected.id]: event.target.value }))} /></label>
              <div className="atendimento-actions" role="group" aria-label="Respostas rápidas">
                {quickReplies.map(([label, reply]) => <button key={label} type="button" className="btn-secondary" disabled={!selected.assigned} onClick={() => {
                  setDrafts(values => ({ ...values, [selected.id]: [values[selected.id]?.trimEnd(), reply].filter(Boolean).join('\n').slice(0, 4096) }));
                }}>{label}</button>)}
              </div>
              <button className="btn-primary" disabled={!selected.assigned || !draft.trim()}>Simular resposta</button>
            </form>
          </> : <p>Selecione uma conversa da fila.</p>}
        </div>
      </div>}

      {section === 'Contatos' && <div className="atendimento-box">
        <div className="atendimento-actions">
          <label>Buscar empresa<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>Cidade<select value={city} onChange={event => setCity(event.target.value)}>
            <option value="">Todas</option>{[...new Set(conversations.map(item => item.city))].sort().map(value => <option key={value}>{value}</option>)}
          </select></label>
        </div>
        {contacts.map(item => <div className="atendimento-contact" key={item.id}>
          <label><input type="checkbox" checked={audience.includes(item.id)} onChange={event => {
            const checked = event.target.checked;
            setAudience(ids => checked ? [...ids, item.id] : ids.filter(id => id !== item.id));
          }} /> {item.name} · {item.city}</label>
          <button className="btn-secondary" onClick={() => open(item.id)}>Abrir conversa</button>
        </div>)}
        {!contacts.length && <p>Nenhum contato encontrado.</p>}
        <button className="btn-primary" disabled={!audience.length} onClick={() => setSection('Campanhas')}>Usar {audience.length} em campanha</button>
      </div>}

      {section === 'Campanhas' && <div className="atendimento-box">
        <h4>Prévia de campanha</h4>
        <p>{audience.length ? conversations.filter(item => audience.includes(item.id)).map(item => item.name).join(', ') : 'Selecione os destinatários na seção Contatos.'}</p>
        <label>Imagem sem legenda<input type="file" accept="image/jpeg,image/png" onChange={event => setImage(event.target.files?.[0] ?? null)} /></label>
        <label>Intervalo entre envios<select value={interval} onChange={event => setInterval(Number(event.target.value))}>
          <option value={30}>30 segundos</option><option value={60}>1 minuto</option>
        </select></label>
        {preview && <img className="atendimento-preview" src={preview} alt="Prévia da imagem da campanha" />}
        {preview && audience.length > 0 && <ol aria-label="Programação simulada">{audience.map((id, index) =>
          <li key={id}>{conversations.find(item => item.id === id)?.name} · {index === 0 ? 'início da campanha' : `+${index * interval} s`}</li>)}</ol>}
      </div>}

      {section === 'Funil' && <div className="atendimento-funnel">
        {stages.map(stage => <div className="atendimento-box" key={stage}>
          <h4>{stage}</h4>
          {conversations.filter(item => item.stage === stage).map(item => <div className="atendimento-funnel-card" key={item.id}>
            <button className="btn-secondary" onClick={() => open(item.id)}>{item.name}</button>
            <label>Mover para<select value={stage} onChange={event => update(item.id, { stage: event.target.value as Conversation['stage'] })}>
              {stages.map(value => <option key={value}>{value}</option>)}
            </select></label>
          </div>)}
        </div>)}
      </div>}

      {section === 'Chatbot' && <div className="atendimento-box">
        <h4>Teste de saudação e transferência</h4>
        <label>Saudação<textarea value={greeting} maxLength={1000} onChange={event => setGreeting(event.target.value)} /></label>
        <form onSubmit={event => {
          event.preventDefault();
          if (!botInput.trim() || !greeting.trim()) return;
          const input = botInput.trim().toLocaleLowerCase('pt-BR');
          setBotResult(input === '1' || /\batendente\b/.test(input) ? 'Transferência simulada para a fila de atendimento.' : greeting.trim());
        }}>
          <label>Mensagem do cliente<input value={botInput} maxLength={1000} placeholder="Ex.: 1" onChange={event => setBotInput(event.target.value)} /></label>
          <button className="btn-primary" disabled={!botInput.trim() || !greeting.trim()}>Testar bot</button>
        </form>
        {botResult && <p role="status">{botResult}</p>}
      </div>}
    </section>
  );
}
