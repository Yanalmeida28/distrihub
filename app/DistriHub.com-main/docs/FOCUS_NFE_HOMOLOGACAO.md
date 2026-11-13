# NF-e de homologação — Amazonas

Fluxo do modelo 55 separado da NFC-e (modelo 65). Não exige CSC. Exige empresa habilitada para NF-e no Focus, certificado cadastrado e dados fiscais completos. Todo acesso ao Focus usa exclusivamente `https://homologacao.focusnfe.com.br`; produção não é ativada.

## Configuração do servidor

Segredos no Supabase:

- `FOCUS_NFE_HOMOLOGATION_ENABLED=true`: libera o adaptador, sujeito às validações de dados.
- `FOCUS_NFE_HOMOLOGATION_ACCOUNTS`: lista JSON de contas autorizadas, conforme o modelo abaixo.
- `FOCUS_NFE_HOMOLOGATION_TOKEN`: token de emissão de homologação do emitente. Quando ausente, é aproveitado o segredo existente `FOCUS_NFCE_HOMOLOGATION_TOKEN`. O nome anterior do segredo não obriga o uso do modelo 65.
- `FOCUS_NFE_ORIGIN`: origem permitida da interface; padrão `https://distrihub.com.br`.

```json
[
  {
    "company_id": "UUID_EMPRESA",
    "branch_id": "UUID_FILIAL",
    "cnpj": "CNPJ_DO_EMITENTE",
    "uf": "AM",
    "nfe_enabled": true,
    "issuer_regime": "1",
    "products": {
      "UUID_PRODUTO": {
        "origin": "ORIGEM_CONFIRMADA",
        "unit": "UNIDADE_CONFIRMADA",
        "pis_cst": "CST_PIS_CONFIRMADO",
        "cofins_cst": "CST_COFINS_CONFIRMADO"
      }
    },
    "customer_policies": {
      "UUID_CLIENTE": {
        "final_consumer": "INDICADOR_CONFIRMADO_0_OU_1",
        "ie_indicator": "INDICADOR_CONFIRMADO_1_2_OU_9"
      }
    }
  }
]
```

Use uma entrada para cada filial. As duas filiais da mesma empresa e CNPJ podem usar o token do mesmo emitente. Não é permitido distribuir automaticamente esse segredo entre empresas/CNPJs diferentes. Não publique tokens ou configurações preenchidas no Git.

`issuer_regime=1` corresponde ao Simples Nacional, confirmado pelo responsável nesta implantação. O adaptador inicial não implementa outros regimes. Origem, unidade, CSTs e indicadores de destinatário não são escolhidos automaticamente: precisam de revisão contábil. `products={}` ou `customer_policies={}` mantêm os respectivos envios bloqueados, mesmo com a integração habilitada.

## Escopo inicial

Vendas concluídas de balcão, sem frete, em dinheiro/Pix, destinatário identificado da mesma empresa/filial, com CPF/CNPJ válido, logradouro, número, bairro, município, UF AM e CEP completo. Venda de atacado também pode ser preparada, mas seu indicador de consumidor final precisa ser informado explicitamente; não é inferido pelo nome da filial.

Para os produtos, é reutilizada a validação conservadora documentada em [NFC-e de homologação](FOCUS_NFCE_HOMOLOGACAO.md): NCM, CFOP interno, CSOSN e enquadramentos de PIS/COFINS sem cálculo de tributos, com alíquotas cadastradas e compatíveis. Produtos fora do escopo ficam bloqueados; não altere a tributação para contornar o adaptador. Serviços, transporte, vendas interestaduais, outras tributações, cartões, crédito RMA e outras finalidades exigem ampliação e homologação próprias.

O nome do destinatário é marcado como homologação, preservando seu documento/endereço cadastrados. Nenhum destinatário fictício é criado automaticamente no banco.

## Uso e respostas

Na área **Fiscal**, selecione uma filial e uma venda concluída. O quadro **NF-e de teste — Focus / Amazonas** verifica a preparação local e permite enviar/consultar explicitamente a venda. A checagem de configuração não emite documentos nem confirma certificado/credencial no provedor.

A referência do modelo 55 é `dhn` seguida pelo UUID da venda sem hífens, diferente da referência da NFC-e. A API pode responder `processando_autorizacao`: nesse caso a interface mostra processamento, não autorização. Consulte a mesma venda novamente para recuperar o resultado. Não há transmissão automática em segundo plano, webhook ou consulta contínua nesta etapa.

Só uma resposta confirmada como `autorizado`, com chave de 44 dígitos do CNPJ/UF e modelo 55 corretos e gravação confirmada no banco, é anunciada como autorizada em homologação. Timeout, resposta inválida ou falha de gravação mantêm resultado incerto e referência estável. Correção explícita é permitida após rejeição confirmada, conservando a referência.

O histórico distingue o ambiente sem valor fiscal. A numeração e a série ficam sob controle do Focus para o CNPJ; não são geradas de forma independente em cada filial. DANFE/XML podem ser abertos quando retornados por URL de homologação aprovada.

## Instalação

1. Validar testes do modelo 55 e regressões da NFC-e, TypeScript, lint e compilação.
2. Aplicar `20261112234028_focus_nfe_homologation.sql` no projeto correto. Ela é independente da migração de NFC-e.
3. Publicar a função `focus-nfe` com os arquivos compartilhados `focus-nfe.ts` e `focus-nfce.ts`. A função valida o JWT com `auth.getUser`; a RPC confere módulo fiscal, cargo e escopo da venda.
4. Cadastrar os segredos e as filiais autorizadas. A NFC-e permanece sem ativação enquanto não houver CSC.
5. Publicar a interface e verificar o ambiente. Nenhuma emissão é efetuada pela instalação.
6. Revisar produtos/destinatário da venda de teste e solicitar explicitamente o primeiro envio. Concluir a homologação no Focus/SEFAZ antes de preparar produção.

Referências: [emissão de NF-e](https://doc.focusnfe.com.br/reference/emitir_nfe), [consulta de NF-e](https://doc.focusnfe.com.br/reference/consultar_nfe) e [ambientes](https://doc.focusnfe.com.br/reference/ambiente).
