# Períodos e despesas esquecidas

Na Inteligência Empresarial, o filtro **Período de análise** permite:

- **Este mês até hoje**: do primeiro dia do mês até a data atual.
- **Mês passado**: o mês anterior completo.
- **Selecionar mês e ano**: o mês escolhido completo.
- **Período personalizado**: datas inicial e final, incluindo os dois dias.
- **Hoje** e os últimos **7, 30 ou 90 dias encerrados**.

Os dias seguem o horário de São Paulo. Datas inválidas ou invertidas bloqueiam a exibição do diagnóstico. A comparação de crescimento exige período encerrado e histórico suficiente; usa a mesma quantidade de dias imediatamente anteriores. Alertas de vencimento e previsões continuam referenciados na data atual.

## Cadastrar uma despesa esquecida

1. Entre em **Financeiro → Contas a pagar → Nova conta a pagar**.
2. Escolha a filial e a categoria correta, preencha descrição, credor e valor.
3. Informe o **vencimento original**, mesmo que seja de um mês passado.
4. Salve e selecione esse mês na Inteligência Empresarial.

O resultado gerencial inclui a despesa pelo vencimento original e considera seu valor total, mesmo que ainda esteja em aberto. A data em que ela foi cadastrada continua preservada. Compras de estoque ficam separadas para evitar descontá-las novamente além do custo das mercadorias vendidas.

**Pagamento é diferente de despesa:** em **Registrar pagamento**, informe a **Data do pagamento**. O padrão é hoje, mas você pode selecionar uma data passada em que realmente pagou. A saída entra no fluxo de caixa dessa data, enquanto o instante do lançamento continua preservado para conferência. Datas futuras não são aceitas.

Exemplo: despesa vencida em outubro, paga em outubro e cadastrada em novembro. Use o vencimento original e a data real de pagamento de outubro. O resultado e a saída de caixa serão apresentados em outubro. Se ela foi paga apenas em novembro, informe novembro no pagamento; o resultado e o caixa podem pertencer a meses diferentes.

Pagamentos antigos mantêm a data já registrada. A alteração não muda pagamentos anteriores nem oferece edição de pagamentos já confirmados. Tentativas com falha de conexão guardam valor, data e identificador para recuperação sem duplicidade. O vencimento continua sendo uma aproximação gerencial e não substitui uma DRE contábil por competência.

## Implementação e verificação

- `src/lib/businessIntelligence.ts`: resolução e validação dos períodos, cálculo dos resultados.
- `src/components/partner/BusinessIntelligenceModule.tsx`: seleção de mês/ano e datas.
- `src/components/partner/AccountsModule.tsx`: orientação para despesas esquecidas.
- Testes de meses completos, fevereiro bissexto, virada do ano, limites de horário, despesas cadastradas depois do vencimento e datas inválidas em `supabase/tests/business-intelligence*.test.mjs`.
