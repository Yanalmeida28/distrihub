# Envio de orçamento por e-mail

Codigo preparado e desativado por padrao. Publicacao do frontend autorizada em 08/11/2026; a funcao e a migration de e-mail permanecem sem instalacao em producao, aguardando homologacao. Nenhum envio real foi executado.

## Fluxo

O botão de e-mail de Pedidos em aberto conserva o envio manual por aplicativo enquanto `VITE_ORDER_EMAIL_ENABLED` não for exatamente `true`. Com a integração habilitada, envia somente `saleId` à função `order-quote-email`.

A função valida a identidade com Supabase Auth. A RPC `prepare_order_quote_email` aplica os controles existentes de assinatura/módulo `pedidos`, o resolver real de operadores, papel permitido, empresa, filial ativa e vínculo do cliente (inclusive cliente compartilhado com filial NULL). O e-mail de destino e o conteúdo são lidos do pedido salvo, sem aceitar destinatário ou PDF fornecidos pelo navegador.

O PDF não fiscal é gerado no backend. O adaptador Resend recebe remetente validado, destinatário cadastrado, PDF e chave de idempotência da tentativa. O texto identifica a empresa e a filial. Remetente inicialmente centralizado do DistriHub; não utiliza nem solicita senha de e-mail dos lojistas. Remetentes próprios por empresa e reply-to exigem configuração validada em uma etapa posterior.

## Segurança e duplicidade

- `ORDER_EMAIL_ENABLED` precisa ser exatamente `true` no backend; chave e remetente também são obrigatórios.
- Segredos somente no backend: `RESEND_API_KEY`. Nunca usar prefixo VITE para credenciais.
- `ORDER_EMAIL_FROM`: endereço simples de um domínio validado; `ORDER_EMAIL_ORIGIN`: origem HTTPS autorizada (padrão https://distrihub.com.br).
- Gateway com `verify_jwt=false` para compatibilidade com as chaves atuais; o handler exige Bearer e valida o usuário no Auth antes de reservar qualquer envio. A autorização empresarial é independente, no SQL.
- Tabela de tentativas com RLS, sem privilégios diretos para anon/authenticated. Finalização somente por service_role; não há política pública nem leitura de histórico pelo frontend.
- Um pedido com o mesmo conteúdo/destinatário tem somente uma tentativa, incluindo tentativas pendentes ou incertas. Alterações legítimas no orçamento geram uma nova impressão digital.
- Reserva atômica com lock transacional por empresa; proteção operacional inicial de 60 novas tentativas por empresa/hora. Não é cobrança por assinatura.
- Timeout, erro 5xx, resposta ambígua ou falha ao registrar confirmação deixam resultado incerto. Não há retry automático, reenvio forçado ou reuso de chave após expiração da idempotência do provedor.
- Tentativas pendentes após interrupção, incertas e falhas exigem conferência administrativa no provedor. Não liberar reenvio sem reconciliação; ainda não existe painel dessa conferência.
- “Aceito pelo serviço” não significa entrega na caixa do destinatário. Webhooks de entrega/bounce e tratamento de supressão ainda não foram implementados.
- Logs e mensagens ao usuário não incluem token, corpo de resposta do provedor ou conteúdo comercial.
- Não armazena cópia do PDF ou conteúdo do pedido na tabela de tentativas. Registra IDs, fingerprint, estado e horários. A exclusão da venda/empresa remove as tentativas por cascade; definir retenção de auditoria antes da ativação.

## Validação e ativação futura

Testes locais usam PGlite, o resolver versionado real e doubles explícitos somente da assinatura/módulo e do provedor. Validam ACL, autorização empresarial/filial, cliente compartilhado, reserva única, estados incertos, PDF real e botão sem clique duplicado. Não substituem testes com conexões PostgreSQL independentes, Supabase Auth/gateway e runtime Deno reais.

Antes de ativar: revisar/aplicar a migration `20261108201103_order_quote_email_delivery.sql` em homologação, validar Deno e gateway, concorrência em conexões independentes e RLS/ACL na stack real; configurar domínio e chave Resend de testes; confirmar SPF/DKIM/DMARC e política de remetente, custos/limites, retenção e reconciliação de resultados incertos. Somente depois habilitar as duas flags e testar com destinatários autorizados. Não configurar segredos no Git ou no chat.

Os módulos de vendas, estoque, caixa e os e-mails do Supabase Auth mantêm seus contratos. Histórico de vendas conserva o compartilhamento manual; a integração inicial atende somente orçamento de pedido aberto.

Referências: https://resend.com/docs/api-reference/emails/send-email e https://supabase.com/docs/guides/functions/auth.
