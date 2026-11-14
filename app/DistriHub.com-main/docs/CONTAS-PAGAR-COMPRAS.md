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

## Integridade

A compra inteira é salva em uma transação. Se uma parcela for inválida, nenhuma é confirmada. Tentativas com falha de conexão preservam os identificadores, parcelas, datas e formas de pagamento para recuperação sem duplicação. Repetir uma tentativa não zera pagamentos já feitos.

A autorização de proprietário, filial, fornecedor, assinatura e módulo permanece validada no servidor. Pagamentos continuam limitados ao saldo da parcela.

## Arquivos

- `src/lib/payableDetails.ts`: formas de pagamento e cálculo das parcelas.
- `src/components/partner/AccountsModule.tsx`: cadastro, prévia, listagem e confirmação.
- `src/hooks/usePayables.ts`: persistência e recuperação das operações.
- `supabase/migrations/20261114180005_payable_purchase_details.sql`: campos e operações do banco.
- `supabase/tests/payable-purchase.test.mjs`: integridade da compra e dos pagamentos.
