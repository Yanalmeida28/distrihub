# Visão geral dos caixas

Regra solicitada: o quadro **Visão geral dos caixas** aparece somente ao proprietário e ao perfil `administrador`. Gerente, caixa, vendedor e demais perfis não recebem essa visão.

A permissão não usa o vendedor comercial escolhido para a venda. O backend resolve o operador autenticado/PIN pela função existente e retorna `can_view_overview = (op.role = 'administrador')`. O resolver representa o proprietário com o papel `administrador`.

`can_manage` permanece separado e inalterado para preservar as operações de gerenciamento já autorizadas aos gerentes. Esta mudança restringe o quadro geral, sem revogar implicitamente todo acesso operacional a sessões/movimentos e sem modificar as regras de supervisão de sangria, fechamento ou estorno.

A interface exige a nova permissão explícita e a permissão operacional. Sem flag, durante carregamento, após erro ou troca de contexto, o quadro não aparece. A nova migration complementa o contrato JSON da leitura atual, preservando assinatura, retorno jsonb, resolver, guardas de assinatura/módulo, empresa/filial, PIN, SECURITY DEFINER, search_path vazio e ACL authenticated/sem anon. Nenhuma migration histórica foi editada.

## Instalação pendente

Alteração preparada localmente na branch `fix/cash-overview-access`, baseada em `490189ac83d531128b18debbb3ddc512af3afde5`. Nada aplicado em produção ou publicado nesta etapa.

Antes de publicar: conferir a definição real de `read_partner_cash_register` contra a baseline versionada, aplicar a migration complementar no destino autorizado e depois publicar o frontend. Até o backend fornecer a flag, o frontend novo oculta o quadro inclusive do proprietário por segurança. O frontend antigo continua usando `can_manage` até ser atualizado.

Testes locais cobrem proprietário, administrador, gerente, vendedor, caixa, PIN inválido, outra empresa, anônimo, ausência da nova flag, revogação após atualização e regressões operacionais de caixa/checkout. Validação em PostgreSQL embarcado descartável; não houve consulta ou alteração no banco de produção.

Resultado: 89 testes direcionados aprovados, TypeScript, ESLint e build aprovados. Após os testes, Git reportou também diferenças de final de linha nos arquivos históricos `20261031034052_product_frontend_database_alignment.sql` e `product_contract_production.sql`; `git diff --ignore-space-at-eol` não apontou alteração de conteúdo. Esses arquivos ficam fora da entrega desta correção, sem descarte ou inclusão automática.
