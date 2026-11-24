import {SavedCatalog} from '../types/commerce';
import {generateStandaloneCatalogHtml} from './catalogueGenerator';

export interface PublishCatalogResult {
  slug: string;
  url: string;
  manageToken: string;
  updatedAt: number;
}

function getCatalogApiOrigin(): string {
  const customApi = (import.meta.env.VITE_CATALOG_API_URL as string | undefined)?.trim();
  if (customApi) {
    return customApi.replace(/\/+$/, '');
  }
  return '';
}

export function isStaticHostWithoutBackend(): boolean {
  if (typeof window === 'undefined') return false;
  if (getCatalogApiOrigin()) return false;
  const proto = window.location.protocol.toLowerCase();
  if (
    proto === 'file:' ||
    proto === 'content:' ||
    proto === 'capacitor:' ||
    proto === 'ionic:'
  ) {
    return true;
  }
  const host = window.location.hostname.toLowerCase();
  if (!host) return true;
  return (
    host === 'appassets.androidplatform.net' ||
    host.endsWith('.github.io') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app')
  );
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
  if (isStaticHostWithoutBackend()) {
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

  const apiBase = getCatalogApiOrigin();

  try {
    const res = await fetch(`${apiBase}/api/catalogs`, {
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
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return null;
    const data = (await res.json()) as PublishCatalogResult;
    if (!data?.url) return null;
    return data;
  } catch {
    return null;
  }
}

export async function unpublishCatalogOnline(catalog: SavedCatalog): Promise<void> {
  if (
    !catalog.onlineSlug ||
    !catalog.manageToken ||
    navigator.onLine === false ||
    isStaticHostWithoutBackend()
  ) {
    return;
  }
  const apiBase = getCatalogApiOrigin();
  try {
    await fetch(`${apiBase}/api/catalogs/${encodeURIComponent(catalog.onlineSlug)}`, {
      method: 'DELETE',
      headers: {'X-Catalog-Token': catalog.manageToken},
    });
  } catch {
    // Ignorer si hors ligne ou hébergement statique sans backend
  }
}

export async function checkServerHealth(): Promise<{
  ok: boolean;
  version?: string;
  onlineCatalogs?: boolean;
}> {
  if (
    typeof navigator !== 'undefined' &&
    (navigator.onLine === false || isStaticHostWithoutBackend())
  ) {
    return {ok: false};
  }
  const apiBase = getCatalogApiOrigin();
  try {
    const res = await fetch(`${apiBase}/api/health?t=${Date.now()}`, {cache: 'no-store'});
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return {ok: false};
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
