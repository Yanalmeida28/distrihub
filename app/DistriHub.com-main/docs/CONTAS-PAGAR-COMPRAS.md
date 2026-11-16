# Compra, vencimento e pagamento

Em **Administrativo → Financeiro → Contas a Pagar → Nova conta a pagar**:

1. Escolha a filial, descrição, categoria e credor.
2. Informe a **Data da compra** e o **valor total**.
3. Escolha a forma prevista: Pix, dinheiro, cartão de débito, cartão de crédito, boleto, transferência, cheque ou outra forma. **Definir depois** mantém essa informação em aberto.
4. Escolha **À vista / uma parcela** ou **Parcelado**.
5. No parcelamento, informe de 2 a 120 parcelas e o primeiro vencimento. Confira a prévia e ajuste as datas de cada parcela antes de cadastrar.

O total é dividido em centavos. Por exemplo, R$ 100 em 3 parcelas gera R$ 33,34 + R$ 33,33 + R$ 33,33. Não existe uma quarta conta com o total. Juros e taxas devem estar incluídos no valor informado.

Os vencimentos sugeridos são mensais e preservam o dia original quando possível: 31 de janeiro, 28 ou 29 de fevereiro e 31 de março. As datas podem ser revisadas antes de cadastrar.

## Três datas diferentes

- **Compra:** quando a aquisição aconteceu; é uma informação da conta e não altera sozinha os cálculos anteriores.
- **Vencimento:** quando cada parcela deve ser paga; continua sendo a referência das despesas no resultado gerencial e das contas no fluxo previsto.
- **Pagamento:** quando o dinheiro saiu; define o período no fluxo realizado.

Cadastrar a compra não registra pagamento. Cada parcela possui seu próprio saldo. Em **Registrar pagamento**, confirme a forma efetivamente usada e a data real. Um pagamento parcial pode usar uma forma diferente dos próximos pagamentos, sem alterar a forma prevista da compra.

Os registros antigos ficam sem data da compra e forma de pagamento quando esses dados não existiam; eles não são inventados. As operações antigas e tentativas pendentes permanecem compatíveis.

## Editar e excluir contas

Use **Editar conta** para corrigir descrição, credor, fornecedor, categoria, valor, vencimento, data da compra e forma prevista. O valor não pode ficar abaixo do total já pago. A data, a forma real e o valor de pagamentos confirmados continuam preservados.

Use **Excluir conta** apenas para um registro indevido. Confira o aviso, informe o motivo e confirme. A conta sai dos saldos e do resultado, e os pagamentos vinculados deixam de contar no fluxo dos seus períodos originais. A exclusão não gera devolução bancária.

O filtro **Excluídas** permite conferir o registro original e o motivo. O banco mantém o histórico dos pagamentos e das alterações. Em uma compra parcelada, a edição ou exclusão vale para a parcela escolhida. Alterar o valor de uma parcela atualiza o total informativo da compra, sem redistribuir as outras parcelas.

Cada alteração verifica a versão da conta, incluindo pagamentos feitos em outro acesso. Dados desatualizados são recusados para evitar sobrescrever uma alteração. Tentativas com resposta perdida são recuperadas pelo mesmo identificador, sem aplicar a correção duas vezes.

## Despesa fixa ou variável

Ao cadastrar uma despesa, escolha **Tipo de despesa**: fixa (não acompanha as vendas) ou variável (acompanha as vendas). A categoria continua indicando a finalidade do gasto. Contas da mesma categoria podem ter tipos diferentes. Na compra parcelada, a escolha vale para todas as parcelas.

O ponto de equilíbrio usa primeiro o tipo definido na própria conta. Contas antigas sem tipo continuam usando a classificação da categoria salva para a filial em Inteligência Empresarial. Nenhuma conta antiga é reclassificada automaticamente. Em **Editar conta**, é possível corrigir o tipo com motivo e histórico de alteração, inclusive em contas pagas, sem alterar os pagamentos. A edição vale para a parcela escolhida.

Compras de estoque (categoria fornecedor) não recebem esse tipo: o custo dos produtos vendidos já participa do cálculo. Classificar uma despesa não muda seu valor, seu vencimento nem o fluxo de caixa. O ponto de equilíbrio ainda exige dados suficientes, conferência dos gastos e margem de contribuição positiva.

O ponto de equilíbrio aparece automaticamente na Inteligência Empresarial quando há despesas operacionais no período, classificações utilizáveis, receita e custos disponíveis e margem de contribuição positiva. Atualizar os dados ou trocar o período recalcula a estimativa sem uma confirmação manual. Ausência de despesas operacionais não é interpretada como gasto zero: a tela informa dados insuficientes; cenários sem despesas podem ser avaliados no simulador livre.

**Ajustar classificações e meta do ponto de equilíbrio** abre as preferências. A edição gera uma prévia identificada como não salva; **Salvar ajustes do ponto de equilíbrio** mantém as escolhas para a empresa e filial selecionadas. Atualizar registros não grava preferências nem cria contas. O cálculo não certifica que todos os gastos foram cadastrados; revise a cobertura das despesas do período.

Validação: `npm run test:expense-behavior`, `npm run test:intelligence`, `npm run typecheck`, `npm run lint -- --max-warnings 0` e `npm run build`.

## Retiradas de sócios / uso pessoal

Use a categoria **Retirada de sócios / uso pessoal** em Contas a Pagar. Preencha quem recebeu no campo de beneficiário e informe o motivo na descrição. A retirada usa os mesmos controles de filial, vencimento, pagamento parcial, parcelas, revisão e histórico das demais contas. Ela não recebe tipo fixo/variável e não entra nas despesas operacionais nem no ponto de equilíbrio; o pagamento continua como saída no fluxo realizado, e o saldo pendente continua no previsto.

Os filtros de categoria e vencimento permitem consultar as contas por período. O resumo de retiradas por pessoa considera todas as contas ativas desses filtros e da filial, independente da busca ou aba de status. **Pago** nesse resumo significa o valor liquidado dessas contas, mesmo que em outro período. A Inteligência Empresarial mostra separadamente contas por vencimento e pagamentos efetivos no período selecionado, com nomes de beneficiários. Histórico de pagamentos incompleto mantém os valores de caixa indisponíveis.

Para corrigir uma conta antiga, use **Editar conta**, selecione a categoria de retirada, confira quem recebeu e descreva o motivo da correção. Não cadastre um segundo pagamento. A correção preserva os pagamentos e registra o antes/depois; nenhuma conta histórica é reclassificada automaticamente. Em compras parceladas, a correção vale somente para a parcela selecionada.

Água para consumo da loja pode ser registrada em **Outras despesas → Fixa** quando o gasto existe independentemente das vendas. Fixo não significa valor idêntico todo mês. Água para revenda é compra de estoque. A categoria de retiradas destina-se a uso pessoal e retiradas dos sócios, não aos gastos de funcionamento da loja.

Verificações específicas: `node --test supabase/tests/owner-withdrawals.test.mjs supabase/tests/expense-behavior-ui.test.mjs`.

## Integridade

A compra inteira é salva em uma transação. Se uma parcela for inválida, nenhuma é confirmada. Tentativas com falha de conexão preservam os identificadores, parcelas, datas e formas de pagamento para recuperação sem duplicação. Repetir uma tentativa não zera pagamentos já feitos.

A autorização de proprietário, filial, fornecedor, assinatura e módulo permanece validada no servidor. Pagamentos continuam limitados ao saldo da parcela.

## Arquivos

- `src/lib/payableDetails.ts`: formas de pagamento e cálculo das parcelas.
- `src/components/partner/AccountsModule.tsx`: cadastro, prévia, listagem e confirmação.
- `src/hooks/usePayables.ts`: persistência e recuperação das operações.
- `supabase/migrations/20261114180005_payable_purchase_details.sql`: campos e operações do banco.
- `supabase/tests/payable-purchase.test.mjs`: integridade da compra e dos pagamentos.
