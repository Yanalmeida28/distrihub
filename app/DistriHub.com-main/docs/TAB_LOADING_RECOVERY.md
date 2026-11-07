# Recuperação do carregamento das abas

7/11/2026. Ajuste local na branch `fix/tab-loading-recovery`, baseado na versão publicada `2c2cb4232958f24ae34669b1e2aaa390d8509ba7`. Nenhuma alteração de banco, autenticação, autorização ou regras comerciais.

## Problema reproduzido

Uma atualização Realtime do perfil durante a primeira leitura invalida corretamente a resposta antiga. A coleção não recebe marca de carregamento concluído, porém o fluxo terminava sem erro e sem repetir a leitura. A interface via resourcesReady=false, mantendo o texto de carregamento. Sair para outra aba e voltar iniciava uma nova leitura e podia destravar.

Um teste de regressão reproduziu o bloqueio antes do ajuste. O caso é compatível com o relato do cliente, mas não substitui captura de rede/telemetria daquele dispositivo.

## Correção

Ao terminar uma leitura necessária para a aba atual, o hook confere se a coleção foi realmente carregada. Se uma resposta foi superada sem erro e a coleção segue incompleta, repete somente essa leitura, uma única vez, mantendo os controles de identidade, geração e aba. Não repete gravações nem aceita a resposta antiga.

Se a segunda leitura também for invalidada, apresenta erro com opção de tentar novamente, em vez de spinner permanente. A recuperação ocorre por coleção e não aguarda fornecedores ou outras leituras opcionais. Falhas reais de permissão/rede continuam sendo exibidas, sem repetição automática adicional. Troca de conta, saída da aba e desmontagem cancelam a recuperação antiga.

## Verificação

14 testes de carregamento/navegação aprovados: reproduções nas abas PDV, produtos e pedidos, repetição limitada, fornecedores lentos, caixa independente de históricos, navegação, snapshot autorizado, timeout e isolamento na troca de identidade. TypeScript, ESLint e build aprovados. A publicação e a confirmação no dispositivo do cliente permanecem pendentes.

Arquivos de implementação: `src/hooks/usePartnerData.ts` e `supabase/tests/tab-performance.test.mjs`. As diferenças preexistentes de fim de linha em dois arquivos históricos foram preservadas e ficam fora da entrega. Logística permanece intacta.
