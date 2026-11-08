import { useState } from 'react';
import type { PartnerBranch } from '../../types';

type Props = {
  slug: string;
  branches: Pick<PartnerBranch, 'id' | 'name' | 'is_active'>[];
};

export function CatalogShareLinks({ slug, branches }: Props) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  if (!slug) return null;

  const general = `/catalogo?loja=${encodeURIComponent(slug)}`;
  const links = [
    { id: 'general', name: 'Catálogo geral — escolher filial', href: general },
    ...branches.filter(branch => branch.is_active).map(branch => ({
      id: branch.id, name: branch.name,
      href: `${general}&filial=${encodeURIComponent(branch.name)}`,
    })),
  ];

  async function copy(id: string, href: string) {
    setCopied(''); setError('');
    const url = new URL(href, window.location.origin).href;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const field = document.createElement('textarea');
        field.value = url;
        field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field);
        try {
          field.focus(); field.select();
          if (!document.execCommand('copy')) throw new Error('copy');
        } finally { field.remove(); }
      }
      setCopied(id);
    } catch {
      setError('Não foi possível copiar. Abra o catálogo e copie o endereço do navegador.');
    }
  }

  return <div className="module-card">
    <h4>Compartilhar por filial</h4>
    <p>O link da filial abre apenas os produtos daquela unidade, sem precisar escolher a loja.</p>
    <p>Salve as alterações antes de compartilhar. Se renomear a filial ou o link da loja, copie o novo endereço.</p>
    {links.map(link => <div key={link.id} className="catalog-action-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      <strong>{link.name}</strong>
      <a href={link.href} target="_blank" rel="noopener noreferrer">Abrir catálogo</a>
      <button type="button" className="module-action-btn" aria-label={`Copiar link: ${link.name}`} onClick={() => void copy(link.id, link.href)}>
        {copied === link.id ? 'Link copiado!' : 'Copiar link'}
      </button>
    </div>)}
    {copied && <p role="status">Link copiado.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
