# Carregamento de Cadastro, PDV e Caixa

Branch local: `fix/operational-tab-loading`.
Base: `07dffec11f767dd9f634c8c21ce4f9cffec1bc03`.

## Alterações

- Cadastro de clientes abre buscando o diretório, sem carregar vendas/devoluções como pré-requisito. Detalhes e Histórico de Compras/Extrato solicitam o escopo `cadastros:clientes-historico`, com as dependências completas. A barreira existente de recursos continua ocultando conteúdo incompleto/erro enquanto esse histórico é carregado. Não há corte arbitrário do histórico.
- Caixa deixa de requisitar o diretório de clientes e histórico geral de vendas na abertura. O RPC `read_partner_cash_register` permanece como fonte autorizada de sessões, movimentos e vendas; relatórios e estornos conservam suas verificações. O fallback para vendas já conhecidas no painel continua disponível.
- Hover/foco/toque no menu pré-carregam somente código dos módulos. Dados são solicitados pela navegação efetiva; mover o ponteiro por várias abas não dispara buscas concorrentes de históricos que o usuário não abriu.
- Consultas concorrentes de navegação ao snapshot do PDV e eventos de foco/visibilidade do Caixa podem compartilhar uma requisição pendente no mesmo contexto. Nenhum resultado concluído é armazenado por esse mecanismo. Reconciliação Realtime e eventos de alteração de caixa iniciam leitura nova, pois podem ocorrer depois de uma escrita em outro dispositivo.
- Atualizações explícitas e após mutações continuam novas por padrão. Uma confirmação de venda ou movimentação não pode reutilizar leitura iniciada antes da escrita. Respostas anteriores continuam sujeitas às gerações/versões existentes.
- As leituras envolvidas passam a ter deadline de 20 segundos com AbortSignal. O deadline não é uma meta de velocidade: apenas encerra consultas travadas e permite erro/tentativa segura. Nenhum timeout ou repetição automática foi acrescentado a escritas financeiras.

## Preservado

Conferência de caixa antes de finalizar, validação de estoque/crédito, autenticação/PIN, permissões, isolamento de empresa/filial, idempotência das escritas, proteção contra respostas atrasadas e recuperação de resultado incerto. Nenhuma migration, regra comercial ou função de banco foi alterada.

O checkout anterior, com duas alterações preexistentes em migration/fixture, foi preservado. O projeto de logística e seus recursos não foram utilizados nesta correção. Não houve conexão ao banco de produção, publicação, commit ou push.

## Verificação e limites

Testes direcionados cobrem: Caixa sem histórico geral como pré-requisito; clientes sem vendas/devoluções até solicitar histórico; chamada da UI ao abrir histórico; deduplicação de eventos simultâneos; atualização pós-escrita independente da leitura antiga; descarte de resposta antiga; timeout/abort e recuperação; autorização e recuperação de caixa. TypeScript, ESLint e build executados localmente.

Resultado final: **886 testes aprovados, zero falhas, zero testes ignorados**, em `node --test --test-concurrency=4 supabase/tests/*.test.mjs`. TypeScript, ESLint e build aprovados. O teste antigo que esperava carregar clientes na antecipação do Caixa foi atualizado para Pedidos, que ainda depende desses dados; novos testes verificam explicitamente que o Caixa dispensa esse histórico. Relatório completo em `operational-loading-tests.log`, ignorado pelo Git.

A primeira tentativa da suíte geral identificou a dependência de testes `@electric-sql/pglite` ainda não instalada no novo checkout. A dependência fixada em `supabase/tests/package-lock.json` foi instalada e a suíte foi reiniciada. Nenhuma versão de dependência foi modificada para contornar testes.

Não houve medição autenticada na conta de clientes. A redução de consultas foi demonstrada em testes; não se afirma que toda aba abre abaixo de um número de segundos. Catálogos e históricos grandes ainda usam leituras completas, e consultas SQL, rede e tamanho dos arquivos do módulo podem continuar contribuindo para a demora. Uma medição em dispositivo/rede representativos continua necessária antes de afirmar o ganho observado em produção.

Build mantém avisos sobre chunks grandes já presentes, incluindo conversão HEIC e bibliotecas de exportação. Não houve atualização de dependências, mudanças de precificação, cache entre usuários ou remoção de validações para reduzir tempo.
