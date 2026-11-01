# Leitura QR no PDV — 01/11/2026

Relato: câmera abriu no celular, mas o produto não foi reconhecido. A causa física não foi reproduzida no aparelho do usuário.

Correções: solicitar câmera traseira com resolução ideal de 1280×720 (o navegador escolhe a disponível), ativar TRY_HARDER no ZXing e tentar foco contínuo somente quando suportado. A prévia mostra o enquadramento inteiro com object-fit:contain, sem cortar as bordas. As instruções agora incluem QR, iluminação e distância para foco.

Corrigida também uma incompatibilidade de identificação: a etiqueta usa barcode, SKU ou, na ausência destes, o ID; a leitura agora procura os três, respeitando a filial e recusando ambiguidades. Teclado também aceita a identificação da etiqueta. Não foram inventados códigos nem alterados produtos.

Validação local: 30 testes de leitor/etiquetas, incluindo decodificação real de QR, SVG gerado, zero inicial, SKU/ID, duplicatas, estoque e encerramento da câmera. TypeScript, lint e build são executados na publicação. Os testes não substituem validação física da lente, luz, qualidade de impressão ou Safari/iOS.

Para conferir no aparelho: atualizar o site, abrir o leitor do PDV, enquadrar o QR inteiro e afastar um pouco até focar. Conferir uma única inclusão do produto e testar também código de barras. Se persistir, registrar aparelho/navegador e uma foto da etiqueta para reproduzir o caso.

Referência: [ZXing Browser](https://github.com/zxing-js/browser/blob/master/src/readers/BrowserMultiFormatReader.ts).
