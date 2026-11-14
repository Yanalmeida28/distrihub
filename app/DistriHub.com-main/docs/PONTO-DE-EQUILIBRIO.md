# Ponto de equilíbrio

Em Administrativo → Inteligência Empresarial, selecione filial e período. Em **Ponto de equilíbrio com seus dados**, classifique as categorias de despesas como fixas ou variáveis, informe o resultado desejado e salve. As configurações ficam na conta, separadas por filial e na visão consolidada, disponíveis em outros dispositivos.

Confira os lançamentos e marque a confirmação de cobertura do período para ver os resultados. Essa confirmação não é persistida e é desmarcada quando os dados ou o período mudam. Categorias sem lançamentos somente são consideradas zero após essa conferência. Categorias com lançamentos precisam estar classificadas.

- Receita líquida: vendas concluídas sem frete de repasse, menos créditos e reembolsos de devoluções.
- Custo vendido: custo das vendas, deduzidas as reintegrações reconhecidas no período.
- Despesas: valor integral por vencimento, incluindo contas abertas e parcialmente pagas; contas canceladas ou excluídas não entram. Compras de estoque não entram novamente, pois já existe o custo vendido.
- Margem de contribuição: (receita líquida − custo vendido − despesas classificadas como variáveis) ÷ receita líquida.
- Ponto de equilíbrio: despesas fixas ÷ margem de contribuição.
- Receita para o resultado desejado: (despesas fixas + resultado desejado) ÷ margem.

Os resultados são estimativas gerenciais, dependentes dos custos e da classificação informados. Taxas, tributos e demais despesas precisam estar registrados. Se uma categoria mistura gastos fixos e variáveis, reorganize os lançamentos antes de interpretar a estimativa. Períodos parciais não projetam o mês inteiro. Não há cálculo com receita líquida não positiva, margem não positiva ou acima de 100%, custos desconhecidos ou devoluções incompletas. Não são criados pagamentos ou metas financeiras automaticamente.

O simulador manual permanece abaixo para experimentar cenários temporários.

A tabela `partner_break_even_settings` permite leitura e gravação somente ao proprietário autenticado com os três recursos necessários, e valida a propriedade da filial. Não armazena credenciais. O salvamento usa a chave empresa/seleção de filial; repetir o salvamento substitui as mesmas configurações sem duplicar registros.
