# Carregamento do proprietário

Preparação local em 7/11/2026, branch `fix/owner-access-loading`, a partir de `6bde0b98b695f751299d5a16bfbfa66f705dd261`. Não publicado e não aplicado ao banco de produção nesta etapa.

## Diagnóstico

O fluxo de autenticação consultava o perfil do proprietário apenas para confirmar existência e repetia a leitura para obter os campos completos. O hook agora reutiliza o perfil retornado pela primeira leitura, somente naquela resolução de identidade. Funcionários continuam carregando o perfil da empresa vinculada, e vínculos inativos continuam bloqueados. Cadastro recuperado de metadados ainda exige verificação Auth e leitura posterior; nenhum perfil é armazenado em cache entre contas ou sessões.

Na inspeção somente de leitura dos metadados do DistriHub, as 24 políticas restritivas `saas_entitlement` chamavam `partner_has_saas_access(user_id, feature)` por registro. A função STABLE atual verifica identidade, assinatura, recurso e dispositivo. Repetir sua avaliação ao ler centenas de produtos/clientes acrescenta trabalho a cada página. Isso identifica um fator de lentidão; não mede sozinho a latência final da rede ou de cada tela em produção.

## Alteração preparada

Migration nova `20261107162944_optimize_owner_entitlement_reads.sql`, sem alteração de migrations históricas, funções comerciais ou permissões:

- Quando a linha pertence ao usuário autenticado, a mesma função de autorização recebe auth.uid() e o mesmo recurso em uma subconsulta independente da linha. PostgreSQL calcula esse resultado uma vez por statement.
- Para qualquer outra empresa, mantém-se a chamada original dependente de user_id. As políticas de empresa, filial, operador e superadministrador continuam intactas.
- USING e WITH CHECK permanecem equivalentes, e a política continua RESTRICTIVE/ALL/authenticated.
- A migration compara a definição e o contrato das 24 políticas antes de substituí-las; recusa diferenças desconhecidas. Exige função STABLE e retorno boolean.
- Bloqueios de DDL são transacionais; lock_timeout de cinco segundos e statement_timeout de 30 segundos evitam espera indefinida. Falha reverte integralmente a migration.

Não há cache de assinatura no navegador ou entre requisições. A próxima consulta reavalia autorização, assinatura e dispositivo. Os gatilhos de escrita e demais políticas não foram modificados.

## Evidência local

- Teste com 500 registros próprios: o helper de assinatura foi avaliado 500 vezes antes e uma vez após a otimização. A consulta seguinte voltou a avaliá-lo, e bloqueio de assinatura passou a negar a leitura.
- Matriz antes/depois das 24 políticas: proprietário, funcionário, vínculo inativo, outra empresa, filial não autorizada, usuário sem vínculo, não autenticado, superadministrador, assinatura bloqueada, recurso ausente e dispositivo bloqueado preservaram resultados.
- Escritas continuam recusando assinatura/recurso/dispositivo inválidos e empresa/filial não autorizadas.
- Uma política desconhecida na última tabela causou rollback de todas as alterações anteriores.
- Autenticação verifica uma única leitura do perfil por login do proprietário, nova leitura após logout e isolamento na troca de contas. Recuperação de JWT e cancelamento de respostas antigas permanecem testados.

Os testes de políticas usam PostgreSQL embarcado com a definição versionada atual de partner_has_saas_access e dependências sintéticas de assinatura/dispositivo. Não equivalem à homologação de todos os fluxos comerciais nem medem o ganho em segundos no ambiente publicado. O resultado de 500 para uma avaliação não significa uma aceleração de 500 vezes do aplicativo inteiro.

Validação concluída: 32 testes direcionados aprovados, sem falhas, cobrindo políticas, autenticação, sessão, paginação e navegação entre módulos. TypeScript, ESLint sem avisos e build passaram. O build mantém o aviso já existente de bundles grandes.

## Publicação futura

Reconfirmar as políticas existentes e o HEAD remoto. Aplicar a migration autorizada em transação, em janela adequada para os bloqueios curtos de DDL, e publicar o frontend. Verificar o plano/tempo de consultas com contexto autorizado do proprietário e as abas reclamadas, sem divulgar dados ou remover limites de segurança. Outros custos de paginação, funções por linha e rede podem continuar relevantes.

Os dois arquivos históricos com diferenças locais de fim de linha foram preservados e devem ficar fora da entrega. O aplicativo de logística não foi alterado neste ajuste.
