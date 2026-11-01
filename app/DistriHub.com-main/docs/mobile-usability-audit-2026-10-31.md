# Auditoria de usabilidade mobile — 31/10/2026

Revisão dos componentes do painel e conferência de layout no Chrome headless, em 320, 390, 768 e 1280 px. Foram renderizados 26 componentes e 12 abas adicionais de cadastros/relatórios: 38 cenários, 152 medições. Resultado final: nenhuma largura de documento excedente e nenhum controle com transbordamento detectado nos cenários preparados.

As páginas de teste usam HTML renderizado dos componentes reais, CSS do build e dados fictícios com nomes/SKUs longos. Não acessam contas de clientes nem executam operações da loja. Capturas e medições ficam no ambiente local em `.tmp/mobile-audit/`; não são conteúdo de produção.

| Área revisada | Resultado / ajuste |
| --- | --- |
| PDV e pré-venda | Revisados busca, produtos, carrinho e ações existentes; preservada barra mobile e expansão dos dados. |
| Caixa | Conferido layout inicial; mantidos formulários e controle de caixa existentes. |
| Cadastros | Produtos, clientes, categorias, fornecedores, combos, modificadores, XML, importação e reposição conferidos; títulos longos podem quebrar linha. |
| Pedidos em aberto | Layout inicial conferido; mantida lista adaptada existente. |
| Histórico de vendas | Preservado cartão compacto; reservado espaço suficiente ao toque no menu superior. |
| Histórico de compras | Lista passa a cartões de duas colunas com rótulos no mobile, sem exigir rolagem lateral. |
| Ordens de serviço | Conferido layout inicial e revisadas regras de formulários, fotos e detalhes existentes. |
| RMA / devoluções | Lista passa a cartões; filtros de status em duas colunas; resumo e carteira mais compactos; filtros de data lado a lado a partir de 360 px. |
| Entregas | Conferido layout; mantidos cartões existentes. |
| Financeiro, contas a pagar/receber e fluxo | Conferidos layouts disponíveis e regras existentes; grupos de ações podem quebrar linha. |
| Fiscal e administração fiscal | Conferidos layouts iniciais; preservada rolagem interna de tabelas de comparação. |
| Relatórios e CRM | Conferidas abas de vendas, financeiro, estoque, sem giro e CRM; selects limitados à largura disponível, inclusive no desktop. |
| Administrativo e inteligência empresarial | Conferidos layouts iniciais, indicadores e quebras existentes. |
| Catálogo online | Prefixo de URL separado do campo editável, eliminando corte em 320 px; ações e títulos ajustados. |
| Configurações e assinatura | Botões de segurança/assinatura quebram linha; textos e resumo de plano podem se ajustar à largura. |
| Filiais e dispositivos | Cartões de filiais usam largura disponível; nomes de sessão quebram linha. |
| Importação / exportação | Mapeamento de colunas empilhado no mobile para preservar seleção e nomes longos. |
| Personalização / white-label | Conferido layout inicial; mantida adaptação existente. |
| Suporte | Mensagens longas quebram linha; botão de envio preserva área própria; altura da conversa acompanha a tela. |
| Ajuda | Conferido layout inicial e regras de abas/guias existentes. |

TypeScript, lint, build e 15 testes direcionados de histórico/RMA passaram localmente. A publicação executa também a suíte completa do repositório.

## Limites da conferência

Esta é uma auditoria de código e layout representativo, sem navegação autenticada na loja. Não cobre todas as combinações de permissões, dados ou diálogos abertos. Caixa e OS incluem estados iniciais, não todo o ciclo operacional. Os efeitos React não rodam nas páginas renderizadas; formulários condicionais, entrega do chat, câmera, impressão, teclado virtual e comportamento de iOS/Safari precisam de validação funcional em dispositivo real.

Tabelas extensas de relatórios, fiscal, arquivos importados e extratos continuam com rolagem dentro do próprio bloco quando a comparação entre colunas justifica; não foi usado overflow oculto para mascarar dados. Nenhuma migração ou alteração de dados foi realizada.
