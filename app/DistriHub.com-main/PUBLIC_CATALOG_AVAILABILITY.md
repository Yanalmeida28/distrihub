# Catalogo publico: disponibilidade sem quantidade

Publicacao autorizada em 08/11/2026: ajustes de disponibilidade e links por filial. A conclusao deve ser confirmada pelo workflow e pelo marcador de versao do site.

- Os endpoints read_public_catalog_page e read_public_store_catalog (tambem usados pelo wrapper read_public_catalog_v2) retornam apenas available, nunca stock.
- Produtos sem saldo, inclusive saldo negativo ou nulo, sao exibidos como indisponiveis; servicos continuam fora da vitrine.
- Permanecem os filtros por empresa/filial ativa, loja habilitada, visibilidade de SKU e paginacao.
- A preferencia show_stock passa a controlar a exibicao de disponibilidade. Nenhuma opcao revela a quantidade.
- O carrinho guarda apenas a quantidade solicitada pelo cliente, sem transportar saldo nem usa-lo como maximo HTML. O servidor continua validando o estoque no envio do pedido.
- Estoque interno, vendas e demais funcoes comerciais nao foram modificados.

## Validacao

15 testes de catalogo, paginacao, privacidade e regressao de atualizacao aprovados em banco descartavel e componentes React. TypeScript, ESLint e build executados separadamente.

## Publicacao futura

Aplicar a migration 20261108195815_hide_public_catalog_stock_quantities.sql e publicar o frontend juntos. A migration substitui somente as duas funcoes de leitura do catalogo, mantendo assinaturas, SECURITY DEFINER, search_path vazio e EXECUTE apenas para anon/authenticated (PUBLIC revogado). Nao altera linhas de produtos nem saldos.

## Links por filial

A personalizacao do catalogo disponibiliza abrir/copiar link geral e links por filial ativa. Utiliza o parametro filial ja suportado pelo backend, sem migration adicional. O nome e codificado no link; renomear a filial exige copiar o novo endereco. Links fixos nao exibem seletor e preservam a filial ao retornar do cadastro.
