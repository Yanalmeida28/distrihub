# Ajuda por plano

A aba **Ajuda** apresenta os recursos e o passo a passo de uso por plano, sem alterar assinatura ou permissões.

- **Básico:** 1 filial e 3 dispositivos simultâneos por filial; cadastros, etiquetas, PDV, caixa, pedidos, histórico, ordens de serviço e relatórios simples.
- **Profissional:** 3 filiais e 5 dispositivos por filial; acrescenta gestão administrativa, estoque, financeiro, entregas, RMA, fiscal, CRM e relatórios avançados.
- **Enterprise:** 5 filiais e 8 dispositivos por filial; acrescenta a aba Personalização e suporte prioritário. Adicionais de filiais seguem o catálogo e o processo de aprovação e pagamento da conta.

Esses são os limites padrão. Cortesias, adicionais e condições específicas são consultados na assinatura. Dispositivos simultâneos não representam o total de colaboradores cadastrados.

## Conteúdo e acesso

O seletor começa no plano efetivo da conta. Recursos e guias desse plano usam as funcionalidades retornadas pela assinatura. Os outros planos podem ser consultados como prévia, sem botões para abrir módulos. A navegação do plano atual também exige que o módulo esteja autorizado para o operador.

Os guias de despesas, data do pagamento e fluxo exigem Administrativo e Financeiro. A Inteligência Empresarial exige também Relatórios e é descrita como uma área do proprietário.

Foram acrescentadas instruções de consulta de CNPJ, despesas esquecidas, pagamentos com data anterior, fluxo realizado e previsto e análise mensal. A busca considera títulos, resumos, passos e observações, sem distinguir acentos.

## Manutenção

- `src/lib/helpGuides.ts`: descrições, roteiros, recursos e regras de exibição dos guias.
- `src/lib/planCatalog.ts`: limites padrão e valor do adicional Enterprise.
- `src/components/partner/HelpModule.tsx`: apresentação, busca e navegação.
- `supabase/tests/help-guides.test.mjs`: recursos por plano, permissões, prévias e guias financeiros.
