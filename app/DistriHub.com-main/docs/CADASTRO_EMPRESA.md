# Cadastro compartilhado da empresa

## Preenchimento pelo CNPJ

O CNPJ/CPF é editado junto aos dados cadastrais, tanto em Configurações quanto no Super Admin. Ao sair do campo com um CNPJ numérico válido, a consulta pública à BrasilAPI apresenta razão social, nome fantasia e endereço disponíveis. Também há o botão **Consultar CNPJ**. Não há consulta automática de CPF.

A consulta não salva nem troca campos automaticamente. Confira a prévia e escolha **Preencher apenas campos vazios** ou **Substituir campos consultados**; depois salve o cadastro. Inscrições e regime não são deduzidos de CNAE, porte ou opção pelo Simples. Uma falha no serviço não impede preenchimento manual. Respostas de um CNPJ anterior são ignoradas se o documento mudar durante a consulta.

Documento e cadastro são gravados na mesma transação com comparação dos valores anteriores, evitando salvar endereço de uma versão e CNPJ de outra. A consulta usa somente o CNPJ público; não envia sessão do DistriHub nem credenciais fiscais para o provedor.

O proprietário preenche os dados em **Configurações → Dados cadastrais da empresa**. O super admin consulta e edita o mesmo registro em **Gestão de Clientes → Ver ficha**. A área fiscal consulta os dados salvos, sem campos locais que se perdem ao sair da tela.

Campos: razão social, nome fantasia, inscrições estadual e municipal, regime tributário, logradouro, número, complemento, bairro, cidade, UF e CEP. A razão social atualiza também o nome empresarial existente. O CNPJ/CPF e os contatos continuam no perfil da conta. O endereço operacional de cada filial permanece no cadastro de filiais; não é substituído pelo endereço cadastral da empresa.

Os dados ficam em `partner_profiles.company_registration`. As funções `get_company_registration` e `save_company_registration` verificam sessão e empresa no servidor. Funcionários autorizados podem consultar; somente proprietário e super admin podem salvar. A gravação compara a versão lida para recusar alterações concorrentes e não aceita tokens ou campos fora do cadastro.

Esse cadastro não sincroniza automaticamente com a Focus. O emitente da NF-e continua vinculado ao CNPJ configurado no servidor e ao cadastro/certificado da Focus. Mantenha os dados correspondentes nos dois serviços. Não há importação de endereços, inscrições ou regime por suposição; campos ainda não informados aparecem como tal.
