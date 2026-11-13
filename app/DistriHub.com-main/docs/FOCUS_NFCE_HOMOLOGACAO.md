# NFC-e de teste com Focus — Amazonas

Esta implementação é exclusiva para **homologação**, com URL fixa `https://homologacao.focusnfe.com.br`. O token de produção não é utilizado. Preparar os arquivos não publica a função nem envia notas.

## Para o responsável pela empresa

1. No Focus, confirme que a empresa está habilitada para **NFC-e no AM em homologação**, com certificado válido e **CSC de homologação**. O CSC é separado do certificado. Não envie nenhum desses segredos pelo chat.
2. No DistriHub, confira o CNPJ no cadastro da empresa. Ele precisa corresponder ao emitente configurado no Focus. A preparação inicial usa o CNPJ do perfil empresarial; não presume CNPJ independente por filial.
3. Separe uma venda de teste no varejo/balcão, sem frete, com pagamento em dinheiro ou Pix. Não utilize dados pessoais reais para a homologação.
4. Peça ao contador para conferir NCM, CFOP, CST/CSOSN, origem da mercadoria, unidade e enquadramentos de PIS/COFINS de cada produto. O código não escolhe a tributação da empresa.
5. Depois da instalação e configuração descritas abaixo, abra **Fiscal**, selecione a filial e a venda concluída e use o quadro **NFC-e de teste — Focus / Amazonas**.

O botão **Verificar configuração** valida somente a preparação local dos dados e dos segredos. Ele não testa o certificado, não autentica uma operação remota e não emite nota. **Enviar ou consultar NFC-e de teste** é a ação explícita que consulta o Focus e, se não existir documento com aquela referência, solicita a emissão em homologação.

## Configurar o token sem passar pelo chat

No projeto Supabase do DistriHub, abra **Edge Functions → Secrets**:

https://supabase.com/dashboard/project/kcxefjgchxhvcfppglvp/functions/secrets

Cadastre:

| Nome do segredo | Valor |
| --- | --- |
| `FOCUS_NFCE_HOMOLOGATION_TOKEN` | Token de emissão de homologação da empresa, para a configuração inicial de uma única empresa/filial |
| `FOCUS_NFCE_HOMOLOGATION_ENABLED` | `true`, somente depois de revisar a configuração |
| `FOCUS_NFCE_ORIGIN` | `https://distrihub.com.br` |
| `FOCUS_NFCE_HOMOLOGATION_ACCOUNTS` | Lista JSON com as empresas/filiais autorizadas, conforme o modelo abaixo |

O valor JSON é secreto porque contém o token de **emissão de homologação da empresa**. Não use token de revenda/administração nem o token de produção. Não coloque esse JSON no Git, em variáveis `VITE_*`, localStorage, screenshots ou arquivos públicos.

```json
[
  {
    "company_id": "ID_DA_EMPRESA_NO_DISTRIHUB",
    "branch_id": "ID_DA_FILIAL_NO_DISTRIHUB",
    "cnpj": "CNPJ_DO_EMITENTE_COM_14_DIGITOS",
    "uf": "AM",
    "csc_confirmed": false,
    "products": {
      "ID_DO_PRODUTO": {
        "origin": "ORIGEM_CONFERIDA",
        "unit": "UNIDADE_CONFERIDA",
        "pis_cst": "CST_PIS_CONFERIDO",
        "cofins_cst": "CST_COFINS_CONFERIDO"
      }
    }
  }
]
```

Substitua todos os marcadores. Troque `csc_confirmed` para `true` **apenas depois de confirmar** o CSC no Focus. Os IDs de empresa e filial aparecem no quadro de NFC-e da interface preparada; o ID do produto é o identificador real do cadastro, não o SKU. Este modelo é propositalmente incompleto e não habilita emissão sem preenchimento.

Com uma única entrada, o token é lido de `FOCUS_NFCE_HOMOLOGATION_TOKEN` e não precisa constar no JSON. Para duas ou mais entradas, cada uma deve incluir seu próprio campo secreto `token`; o token global não é distribuído automaticamente entre empresas/filiais.

Para outra empresa ou filial, acrescente uma entrada com os seus próprios identificadores e credenciais. Entradas repetidas para o mesmo par empresa/filial são recusadas. Uma empresa autenticada não consegue escolher o token de outra: a seleção ocorre no servidor a partir da venda autorizada.

## Escopo fiscal desta primeira etapa

São aceitas quantidades inteiras positivas, preços em centavos, NCM de oito dígitos, CFOP iniciado por 5, CSOSN `102`, `103`, `300` ou `400`, alíquotas cadastradas de ICMS/PIS/COFINS iguais a zero e CST de PIS/COFINS entre `04`, `06`, `07`, `08` e `09`, desde que sejam os enquadramentos efetivamente conferidos para o produto. Esses valores não são recomendação tributária nem uma configuração padrão.

Outras tributações, serviços, cartões sem detalhes da transação, crédito RMA, atacado, entregas, frete e descontos que não estejam refletidos nos preços dos itens são bloqueados. Produção, NF-e, contingência, cancelamento, inutilização, envio automático de e-mail/WhatsApp e impressão térmica automática não são transmitidos por esta integração inicial. O DANFC-e e o XML de homologação podem ser abertos quando seus caminhos forem retornados pelo Focus.

Não selecione um enquadramento incorreto para contornar um bloqueio. Se a empresa/produto não se enquadra no escopo implementado, amplie e teste o adaptador com as regras confirmadas antes do envio.

## Instalação técnica

1. Executar os testes de Focus, TypeScript, lint e compilação.
2. Aplicar `supabase/migrations/20261112195816_focus_nfce_homologation.sql` no projeto correto.
3. Publicar a Edge Function `focus-nfce`, incluindo o arquivo compartilhado `supabase/functions/_shared/focus-nfce.ts`. A configuração local usa `verify_jwt=false` porque o próprio handler valida cada sessão com `auth.getUser`; a autorização fiscal é conferida separadamente na RPC do banco.
4. Cadastrar os segredos pelo dashboard. Nunca publicar uma chave `service_role` na interface.
5. Publicar a interface somente depois da migração e da função.
6. Verificar a configuração com uma venda autorizada, enviar explicitamente uma NFC-e de teste e conferir no Focus o ambiente e o resultado. Testes locais com respostas simuladas não substituem essa homologação.

## Tentativas e recuperação

A referência é `dhh` seguida pelo UUID da venda sem hífens. A mesma venda/empresa/filial sempre recupera a mesma tentativa em homologação. A função consulta o provedor antes de enviar. Uma reserva com validade de 60 segundos impede envios concorrentes; cada execução tem um identificador de reserva diferente, para uma resposta antiga não sobrescrever outra.

Um timeout ou resposta ambígua preserva a referência e os dados originais. Consulte novamente a mesma venda. Não crie outra venda para repetir uma nota de resultado desconhecido.

Após uma rejeição fiscal confirmada pelo Focus, o botão **Reenviar após correção fiscal** permite reconstruir os dados tributários corrigidos, conservando a referência. Erros HTTP genéricos não liberam automaticamente uma nova versão do pedido: primeiro é necessário conciliar o resultado no provedor. Autorização ou cancelamento confirmados não são reenviados. Uma configuração de CNPJ diferente da tentativa original é recusada.

Os resultados são gravados em `fiscal_documents` com provedor `focus_homologacao` e marca explícita de ambiente, para não serem confundidos com documentos de produção. Tokens não entram no payload fiscal, nas tabelas de tentativas nem nas respostas à interface.

## Referências oficiais

- [Ambientes Focus](https://doc.focusnfe.com.br/reference/ambiente)
- [Autenticação Focus](https://doc.focusnfe.com.br/reference/autenticacao)
- [Emissão de NFC-e](https://doc.focusnfe.com.br/reference/emitir_nfce)
- [Consulta de NFC-e](https://doc.focusnfe.com.br/reference/consultar_nfce)
- [Referências e repetição de tentativas](https://doc.focusnfe.com.br/reference/referencia)
- [Segredos de Edge Functions](https://supabase.com/docs/guides/functions/secrets)
