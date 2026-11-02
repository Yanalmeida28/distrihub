# Referência visual: painel único

O Acesso do Proprietário é a referência para novos modais e futuras revisões do DistriHub.

- Uma superfície escura, com cantos arredondados; sem cartões ou molduras internos.
- Título e descrição diretamente no painel; hierarquia por tipografia e espaçamento.
- Campos simples com contorno discreto e foco visível.
- Confirmação em verde; Cancelar como ação de texto, sem caixa ou borda.
- Erros em texto legível, no fluxo do formulário.
- Área de toque de pelo menos 44px e largura adaptada ao celular.

Use as classes de `SinglePanelModal.css`: `single-panel-modal`, `single-panel-header`, `single-panel-body`, `single-panel-form`, `single-panel-confirm` e `single-panel-secondary`.

Não aplique classes de cartões, como `rma-form` ou `module-card`, dentro desse painel. A revisão visual não altera validações de acesso, estados de carregamento nem permissões. A conversão dos demais modais deve ser feita por fluxo, preservando suas necessidades de conteúdo.
