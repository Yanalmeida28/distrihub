# Correções da revisão de segurança — 17/11/2026

## Implementado

- Storage: removidas permissões antigas das fotos de OS; acesso depende da empresa, filial, assinatura e módulo. Fotos ainda vinculadas não podem ser apagadas pelo caminho de limpeza. Arquivos existentes preservados.
- Fotos de clientes: leitura, envio, atualização e limpeza validam o cadastro e seu escopo; exclusão exige desvinculação.
- Buckets de fotos de OS e clientes: novos uploads limitados a 2 MB, JPG/PNG/WebP. Os arquivos antigos não são regravados.
- Índices dos vínculos device_sessions.branch_id e partner_payable_changes.payable_id.
- Histórico: filtro no servidor usa o fuso da empresa, com fallback São Paulo para configuração ausente ou inválida. Preservadas autorização, paginação, estornos e regras de conclusão.
- Histórico, pedidos abertos e Caixa recebem o fuso comercial da empresa. Resumo diário, horários exibidos e impressão respeitam a configuração. Datas puras e timestamps armazenados preservados.
- Publicação: FTPS com verificação estrita do certificado, permissões mínimas do token e fila para evitar implantações simultâneas. Não existe fallback automático para FTP simples.
- Navegador: anti-enquadramento, nosniff, política de referência, HSTS sem afetar subdomínios e câmera permitida na própria origem. CSP ampla de scripts/conexões permanece em Report-Only para observar incompatibilidades antes de bloquear.

## Banco ativo

Migration aplicada: 20261117014956_harden_storage_and_business_time. O arquivo local foi alinhado com a versão registrada pelo Supabase. Verificação posterior confirmou zero políticas antigas, dois índices presentes, limites dos dois buckets, função de Histórico atualizada e dez arquivos de OS preservados. O advisor não aponta mais as duas chaves estrangeiras sem índice.

## Validação

- 1.067 testes passaram, sem falhas; inclui cinco novos testes de banco/segurança e novos casos de fuso comercial.
- Typecheck, lint com zero avisos, build e git diff --check passaram.
- O build conserva o aviso sobre o conversor HEIC maior que 500 kB, carregado separadamente. Nenhuma dependência foi adicionada.
- Testes reproduzem bloqueio entre empresas, troca de filial, módulo negado, assinatura bloqueada, foto vinculada, limpeza autorizada, limites no servidor, ACL de função privada e Manaus perto da meia-noite.

## Etapas externas e acompanhamento

A publicação FTPS deve ser confirmada pelo workflow e pelos cabeçalhos da versão servida. Falha de certificado deve ser corrigida no hostname/certificado da hospedagem; não desativar validação TLS.

Proteção contra senhas vazadas: permanece dependente da configuração Auth do Supabase, não gerenciada pelos recursos de banco nem pelo subconjunto de configuração exposto pela CLI usada nesta sessão. No Dashboard do projeto, abrir Authentication / configurações de senha e ativar Leaked password protection se disponível no plano atual. Não foi contratado plano ou serviço. Confirmar o resultado no advisor. A proteção independente por senha/PIN do proprietário já existente foi preservada.

Após publicar, validar na loja um envio/substituição de foto de OS, uma foto de cliente, impressão e câmera. Não foram emitidos documentos fiscais ou cobranças reais nos testes. Backup completo e restauração em ambiente separado continuam como verificação operacional recomendada; exportação JSON não substitui backup de banco e Storage.
