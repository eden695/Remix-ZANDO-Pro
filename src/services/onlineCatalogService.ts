import {SavedCatalog} from '../types/commerce';
import {generateStandaloneCatalogHtml} from './catalogueGenerator';

export interface PublishCatalogResult {
  slug: string;
  url: string;
  manageToken: string;
  updatedAt: number;
}

export function buildCatalogSlug(catalog: SavedCatalog): string {
  if (catalog.onlineSlug && /^[a-z0-9][a-z0-9_-]{2,63}$/.test(catalog.onlineSlug)) {
    return catalog.onlineSlug;
  }
  const baseSlug = (catalog.title || 'catalogue')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const suffix = catalog.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-8) || 'zando';
  return `${baseSlug || 'catalogue'}-${suffix}`;
}

export async function publishCatalogOnline(
  catalog: SavedCatalog,
): Promise<PublishCatalogResult | null> {
  if (typeof window === 'undefined' || navigator.onLine === false) {
    return null;
  }
  const slug = buildCatalogSlug(catalog);
  const html = generateStandaloneCatalogHtml(catalog);
  const productImages: Record<string, string> = {};
  for (const item of catalog.products) {
    if (item.imageDataUrl) {
      productImages[item.id] = item.imageDataUrl;
    }
  }
  const coverDataUrl =
    catalog.bannerDataUrl || catalog.logoDataUrl || Object.values(productImages)[0];

  try {
    const res = await fetch('/api/catalogs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        slug,
        title: catalog.title,
        subtitle: catalog.subtitle,
        storeName: catalog.storeName,
        html,
        coverDataUrl,
        productImages,
        manageToken: catalog.manageToken,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PublishCatalogResult;
    if (!data?.url) return null;
    return data;
  } catch {
    return null;
  }
}

export async function unpublishCatalogOnline(catalog: SavedCatalog): Promise<void> {
  if (!catalog.onlineSlug || !catalog.manageToken || navigator.onLine === false) return;
  try {
    await fetch(`/api/catalogs/${encodeURIComponent(catalog.onlineSlug)}`, {
      method: 'DELETE',
      headers: {'X-Catalog-Token': catalog.manageToken},
    });
  } catch {
    // Ignorer si hors ligne ou serveur indisponible
  }
}

export async function checkServerHealth(): Promise<{
  ok: boolean;
  version?: string;
  onlineCatalogs?: boolean;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {ok: false};
  }
  try {
    const res = await fetch(`/api/health?t=${Date.now()}`, {cache: 'no-store'});
    if (!res.ok) return {ok: false};
    const data = (await res.json()) as {
      ok?: boolean;
      version?: string;
      onlineCatalogs?: boolean;
    };
    return {
      ok: Boolean(data.ok),
      version: data.version,
      onlineCatalogs: Boolean(data.onlineCatalogs),
    };
  } catch {
    return {ok: false};
  }
}
