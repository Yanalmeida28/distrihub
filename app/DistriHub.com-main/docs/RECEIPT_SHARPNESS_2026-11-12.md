# Nitidez do cupom automático — 12/11/2026

Extensão para 58 mm: a remoção segura das margens brancas é mantida mesmo quando o conteúdo ainda precisa de uma pequena redução para caber na área do driver. O teste de 464 para 384 pixels confirma que só 400 pixels de conteúdo precisam ser ajustados, sem suavização adicional e sem cortar conteúdo nas bordas. Os testes de 80 mm continuam cobrindo preservação exata dos traços. O mesmo pacote atende aos dois tamanhos; selecionar o papel correspondente no aplicativo e no driver e reinstalar o conector atualizado.

Relato: texto borrado em impressora Elgin com papel de 80 mm após ativar a impressão automática personalizada. O modelo exato e uma impressão física não foram disponibilizados.

O navegador gera a imagem com margens laterais de 4 mm. O conector ajustava a largura total dessa imagem à área imprimível já reduzida pelo driver, diminuindo novamente texto e logo. O redimensionamento do GDI+ também não especificava interpolação adequada a traços de impressão térmica.

O conector agora tenta aproveitar apenas colunas completamente brancas das margens para ajustar a imagem à largura disponível em pixels do driver, evitando reduzir as letras quando o conteúdo já cabe. Se não houver espaço branco suficiente, mantém todo o conteúdo e ajusta sua escala. O desenho usa vizinho mais próximo e alinhamento de pixels para não introduzir suavização adicional. O formato de imagem e a compatibilidade com o aplicativo permanecem os mesmos.

O pacote `public/downloads/Conector-DistriHub.zip` foi reconstruído com a correção. A tela de configuração informa a atualização e usa uma URL de download com versão para evitar reutilizar o arquivo anterior em cache. É necessário extrair o pacote e executar `Instalar.cmd` novamente no computador da impressora, depois imprimir e conferir um cupom de teste.

Verificação: compilação do C# e análise dos scripts PowerShell; teste em bitmap com redução de 640 para 576 pixels por remoção exclusiva de margens brancas, preservando exatamente traços de dois pixels sem adicionar cinza; proteção contra corte de conteúdo nas bordas e preservação de imagem em impressora mais larga. Nenhuma fila de impressão foi acionada durante esses testes. Os 27 testes de impressão direta, OS e etiquetas passaram. A validação em papel depende do novo teste na Elgin do usuário.
