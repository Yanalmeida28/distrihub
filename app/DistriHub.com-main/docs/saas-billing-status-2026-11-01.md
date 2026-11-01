# Conferência privada de cobrança SaaS — 01/11/2026

Foi adicionado `saas-billing-status`, um diagnóstico privado que reutiliza a autenticação do agendador existente. A função valida `x-distrihub-scheduler` com `authorize_saas_scheduler`, não reivindica jobs e não cria, altera ou cancela pagamentos/assinaturas. O gateway JWT está desligado porque a função aplica sua própria autenticação de servidor; chamadas públicas sem a credencial são rejeitadas antes de ler segredos do Mercado Pago.

Após autenticação, informa apenas presença dos segredos, validade do retorno HTTPS no domínio do DistriHub e aceitação/pertencimento do token à conta esperada. A única chamada ao Mercado Pago é `GET /users/me`, com timeout de dez segundos e redirecionamentos bloqueados. A resposta não contém tokens, assinatura secreta, ID, e-mail ou dados pessoais da conta. A presença da chave de webhook não comprova sua correspondência ao segredo da aplicação; a assinatura do webhook ainda precisa de teste ponta a ponta.

Validação local: seis testes de autenticação, ausência de segredos, conta divergente, indisponibilidade/rejeição do provedor e não exposição de dados. Lint direcionado aprovado. Validação remota: segredos presentes e URL de retorno válida; token aceito mas pertencente ao vendedor de testes da aplicação, não à conta de recebimento. Não considerar cobranças de produção ativadas. O provedor também informou credenciais de produção ainda pendentes.

Para nova conferência, o operador autorizado agenda um POST via `net.http_post`, obtendo o header do segredo já existente no Vault sem copiá-lo para mensagens ou arquivos, e informa `expectedAccountId` da conta selecionada. Ler a resposta correspondente em `net._http_response`. Não adicionar o segredo do agendador ao navegador ou conceder execução do RPC de autenticação a usuários comuns. Não alterar as permissões existentes desse RPC.

A consulta não verifica a criação de checkout, entrega assinada de webhook, renovação ou cancelamento. Homologar esses fluxos com contas de teste antes da operação real; uma consulta de identificação bem-sucedida não é uma homologação financeira.

