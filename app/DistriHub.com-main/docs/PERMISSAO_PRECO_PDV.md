# Permissão individual para preço de venda

Atualização de publicação — 10/11/2026: após autorização, a migration foi instalada no projeto DistriHub.com. Conferidos antes da aplicação: tabela sob postgres, dependências existentes, duas ocorrências do predicado esperado e guarda de finalização preservada; MD5 prévio da implementação privada de venda `d291b740e3ec42eb002d06516f25280e`. Depois da aplicação: coluna boolean NOT NULL DEFAULT false, trigger ativo, duas chamadas ao helper, setter sob postgres/search_path vazio, EXECUTE permitido a authenticated e negado a anon. Nenhum colaborador recebeu liberação automática. As observações abaixo registram a preparação e os requisitos de implantação.

Em Administrativo → Usuários e permissões → Editar colaborador, a opção **Permitir alterar preço na venda (PDV)** fica disponível para Vendedor/Balcão, Caixa e Atendente. Inicia desativada, inclusive para registros existentes. Salva imediatamente e separadamente das demais alterações. Não ativa o colaborador nem muda sua função, filial ou módulos.

A liberação e a revogação exigem proprietário ou administrador autorizado. Gerente continua podendo negociar preços pelas regras existentes, mas não recebe autorização para delegar essa permissão. A opção não amplia o acesso ao Administrativo: os controles existentes continuam sendo exigidos. O Atendente não passa a concluir vendas por receber autorização de preço; suas restrições originais permanecem.

O PDV e a edição de itens de pedidos usam a autorização individual. A alteração afeta o preço daquela venda, não o catálogo do produto. A revogação é revalidada no backend na próxima operação; um campo ainda visível em uma tela desatualizada não autoriza uma venda.

Revogar impede novas negociações; não reprecifica pedidos anteriores. Uma pré-venda já validada continua seguindo o contrato existente de finalização com os preços aprovados, sem permitir negociá-los novamente durante a conclusão.

## Backend

Migration nova: `20261110164331_operator_sale_price_permission.sql`. Acrescenta a coluna booleana `partner_salespeople.can_edit_sale_price NOT NULL DEFAULT false`, o setter `set_partner_salesperson_price_permission(uuid,boolean,uuid,text)`, uma guarda contra escrita direta e um helper privado usado pelo validador de preços existente.

O setter usa o resolver real de operador/PIN, verifica empresa, filial, papel administrativo e acesso ao módulo Administrativo. Grava auditoria sem PIN. Atualizações diretas da coluna por authenticated são recusadas, mesmo se existirem grants legados. A autorização de vendas consulta o operador efetivo resolvido pelo servidor, e não o vendedor atribuído livremente no formulário.

A migration estende somente o predicado existente de negociação de preço. Exige exatamente as duas ocorrências conhecidas em cada implementação privada que valida preços e preserva a guarda de finalização de pré-venda. Contrato desconhecido ou ausência da implementação interrompe a transação integralmente. Não modifica migrations históricas. Permanecem as validações de totais, limites de preço, estoque, crédito, caixa, filial e PIN.

## Instalação e limites

Trabalho local, sem aplicação no banco remoto e sem publicação. Instalar a migration antes do frontend, pois a consulta de colaboradores passa a incluir a nova coluna. A instalação adquire lock de alteração da tabela, com timeout de cinco segundos. Conferir previamente as definições reais das funções e seus proprietários; não contornar a guarda se houver divergência. Confirmar RLS/ACL, testar em homologação com Auth e sessões reais e só então publicar com autorização.

Testes locais de caixa/PDV e interface de permissões: 80 aprovados. Suíte completa: 932 aprovados, zero falhas. O teste adicional de venda concluída com funcionário autenticado também passou: preço negociado persistido, baixa de estoque correta e preço do catálogo preservado. Validam liberação, revogação, negação a gerente/funcionário/outra empresa/anônimo, PIN incorreto e escrita direta. TypeScript e ESLint aprovados; build aprovado com avisos de tamanho de chunks. O PostgreSQL dos testes é descartável (PGlite); autenticação e integrações reais não foram homologadas nesta tarefa.
