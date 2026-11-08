# Atualização do caixa sem reinicialização visual

8/11/2026. O carregamento de uma nova leitura substituía o conteúdo do caixa pelo texto de carregamento e desmontava CashOverview. A altura da página diminuía durante a consulta e filtros/paginação internos eram perdidos.

Após o primeiro snapshot autorizado, o conteúdo permanece montado durante atualizações normais. A primeira entrada e mudanças de empresa, filial ou operador continuam exigindo novo carregamento e limpeza do contexto anterior. A seleção de caixa e operações ficam bloqueadas enquanto a leitura é conferida; autorizações, tratamento de falhas e respostas antigas permanecem protegidos.

Não foi aumentado o intervalo de atualização, nem adicionado código para forçar a rolagem. O teste verifica que a visão geral e os formulários mantêm a mesma instância durante a consulta, preservando o filtro digitado. Os testes existentes de revogação de permissão, mudança de filial e respostas fora de ordem continuam passando.

18 testes de interface do caixa aprovados. TypeScript, lint e build verificados antes da publicação. Sem alteração de banco ou regras financeiras. A posição exata do scroll em navegador real ainda deve ser conferida no dispositivo do cliente, especialmente se a quantidade de registros mudar.
