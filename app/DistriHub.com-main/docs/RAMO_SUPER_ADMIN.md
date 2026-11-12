# Ramo da empresa no superadministrador

Em **Super Admin → Gestão de Clientes**, a coluna **Ramo** permite selecionar **Assistência técnica**, **Varejo** ou **Serviços** e clicar em **Salvar ramo**. O formulário público de cadastro continua sem solicitar esse campo.

A seleção é um rascunho até salvar. A lista e uma ficha aberta da mesma empresa são atualizadas somente após confirmação do servidor. Em caso de falha, a tela informa o erro e permite tentar novamente.

O sistema conserva o valor padrão `assistencia` dos cadastros atuais até uma alteração explícita. Não há reclassificação automática de empresas. O novo ramo vale para o perfil da empresa; não reescreve ordens de serviço históricas.

## Implementação

- `src/components/AdminCompanySegmentField.tsx`: seleção, gravação e retorno ao usuário.
- `src/lib/businessSegments.ts`: nomes dos ramos em português.
- `src/components/AdminPanel.tsx`: integração na lista e na ficha da empresa.
- `supabase/migrations/20261112185215_super_admin_company_segment.sql`: função autenticada de gravação.
- `supabase/tests/admin-company-segment.test.mjs`: testes da interface e da função em PostgreSQL local em memória.

A função confere a sessão e a autorização de superadministrador no servidor, valida os três ramos e atualiza `partner_profiles` e o registro correspondente em `admin_lojistas` na mesma transação. Não altera status comercial, crédito ou assinatura. A execução pública e anônima é revogada.

## Publicação

Aplicar a migração antes de publicar a interface. Sem ela, salvar retorna erro e não informa sucesso. A preparação local não aplica a migração nem publica a interface automaticamente.
