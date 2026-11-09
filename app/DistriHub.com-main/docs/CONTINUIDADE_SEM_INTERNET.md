# Continuidade diante de queda de internet — primeira etapa

Implementação sobre `c71d93b`, no repositório DistriHub. Não altera banco, autenticação, PIN, assinaturas, estoque ou contratos das RPCs. Publicação autorizada pelo usuário após a conclusão do desenvolvimento local.

## Comportamento

- A área autenticada mostra aviso quando o navegador informa perda de rede, com a última sincronização disponível. Essa indicação não prova a disponibilidade do Supabase: falhas de servidor continuam sendo tratadas pelas respostas das operações.
- O PDV mantém os produtos já carregados e permite organizar o carrinho. Salvar pedido, corrigir pré-venda e finalizar ficam indisponíveis sem rede; os handlers também verificam a conexão, inclusive antes de criar uma tentativa de venda.
- O carrinho normal recebe uma cópia local de produtos, quantidades e preços, separada por usuário autenticado, empresa, filial e identificador de rascunho. Nenhum PIN, token, cliente ou forma de pagamento é incluído nessa cópia. Rascunhos de pré-vendas resgatadas não geram esse backup adicional.
- Após fechar a aba, entrar novamente e confirmar o acesso autorizado, um carrinho vazio oferece recuperação explícita das cópias desse escopo. São exibidas até cinco recentes. A cópia expira após 24 horas; o operador deve conferir cliente, pagamento, estoque e preços. Recuperar não registra venda nem faz reserva de estoque.
- Tentativas de venda com resultado incerto usam armazenamento local persistente, separado por usuário/empresa. A tentativa antiga da aba é migrada sem credenciais. Duas tentativas locais conflitantes bloqueiam novas operações; não se descarta nenhuma automaticamente. Uma tentativa incerta não expira silenciosamente.
- Reabrir ou reconectar não reenvia vendas. A recuperação é explícita e reutiliza o mesmo ID e payload comercial. Após confirmação, o backup associado e a tentativa são removidos. Falha de limpeza local preserva a recuperação e produz aviso, sem transformar sucesso no servidor em nova venda.

## Limites e segurança

Esta etapa não instala service worker, cache completo de produtos ou fila de vendas offline. Não garante abrir/recarregar o app sem rede, login offline ou crédito atualizado. O aparelho precisa voltar a ter conexão para iniciar a sessão, obter dados e confirmar operações.

Os rascunhos não são uma base confiável: o servidor continua validando identidade, operador/PIN, filial, caixa, preços, estoque e crédito. A cópia local não transfere permissões entre contas. Em computador compartilhado, manter os perfis de navegador protegidos; armazenamento local não é um cofre criptografado. Não apagar dados do navegador antes de conciliar vendas incertas. Limpeza de armazenamento pelo usuário, modo privado, quota, perda do aparelho e bloqueios do navegador podem impedir recuperação; há aviso quando a gravação falha.

Rascunhos em abas diferentes não são sincronizados como um atendimento único. Não operar o mesmo atendimento simultaneamente em vários terminais/abas. O controle existente por ID protege retries da mesma operação; não identifica como duplicadas duas vendas comerciais distintas criadas pelo operador com IDs diferentes. Concorrência entre terminais, queda real de energia e dispositivos físicos ainda exigem homologação específica.

## Validação

Testes locais de armazenamento, React e hook de vendas usam dados fictícios e serviço simulado. Cobrem fechamento do runtime/aba com armazenamento preservado, recuperação explícita, descarte, isolamento, expiração, dados inválidos, allowlist, armazenamento indisponível, migração de tentativa, resposta incerta, reconexão sem envio automático, confirmação com o mesmo ID e regressões do PDV/pré-vendas/câmera/PIN.

TypeScript, ESLint dos arquivos alterados, build e `git diff --check` integram as verificações. Os resultados exatos da execução são informados na entrega; testes simulados não equivalem a homologação real com queda de rede no aparelho do cliente.

Resultado final local: **205 testes aprovados, zero falhas e zero ignorados** nas nove suítes selecionadas de continuidade, PDV, rascunhos, pré-vendas, câmera, PIN, confirmação de operador e preservação dos módulos. TypeScript e ESLint dos arquivos alterados passaram. O build concluiu em 6,60 segundos, com aviso de chunks maiores que 500 kB. `git diff --check` passou; as quatro alterações preexistentes em HubHome e contratos SQL foram preservadas e não fazem parte deste ajuste.

Na preparação da publicação, a suíte completa executou 930 testes: 927 passaram e três testes antigos de impressão encontraram um aviso adicional porque seu navegador simulado não fornecia localStorage. O fixture foi atualizado com armazenamento em memória e os 21 testes desse arquivo passaram na repetição, sem alterar o fluxo comercial. O checkout de publicação contém somente esta melhoria e seus testes/documentação; os checks automatizados do GitHub continuam obrigatórios na implantação.

Nenhuma migration, conexão ao Supabase de produção ou mudança no app Logística integra esta publicação.
