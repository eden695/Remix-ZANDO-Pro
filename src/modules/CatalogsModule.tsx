import React, {useMemo, useState} from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Loader2,
  Mail,
  MessageCircle,
  Monitor,
  Pencil,
  Phone,
  Plus,
  Share2,
  Smartphone,
  Trash2,
} from 'lucide-react';
import {ModernSelect} from '../components/ModernSelect';
import {SheetModal} from '../components/SheetModal';
import {useStore} from '../context/StoreContext';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {
  copyTextSafely,
  downloadBlobSafely,
  openSocialAppIntent,
  tryNativeFileShare,
} from '../services/androidShareService';
import {
  createIndependentCatalogSnapshot,
  generateCatalogPdfBlob,
  generateStandaloneCatalogHtml,
} from '../services/catalogueGenerator';
import {
  buildCatalogSlug,
  isStaticHostWithoutBackend,
  publishCatalogOnline,
  unpublishCatalogOnline,
} from '../services/onlineCatalogService';
import {SavedCatalog} from '../types/commerce';
import {formatBytes, formatDateTime} from '../utils/format';

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const mimeMatch = parts[0].match(/data:([^;]+);base64/);
    const mime = mimeMatch?.[1] || 'image/jpeg';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], {type: mime});
  } catch {
    return null;
  }
}

export const CatalogsModule: React.FC = () => {
  const {catalogs, products, promotions, storeProfile, saveCatalog, removeCatalog, notify} =
    useStore();
  const isOnline = useOnlineStatus();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingCatalog, setEditingCatalog] = useState<SavedCatalog | null>(null);
  const [previewCatalog, setPreviewCatalog] = useState<SavedCatalog | null>(null);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [generating, setGenerating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // PDF Confirmation Modal state
  const [pdfConfirmState, setPdfConfirmState] = useState<{
    catalog: SavedCatalog;
    blob: Blob;
    filename: string;
  } | null>(null);

  // Share Modal state (PDF or Online HTML link across networks)
  const [shareState, setShareState] = useState<{
    catalog: SavedCatalog;
    format: 'html' | 'pdf';
    blob: Blob;
    coverBlob: Blob | null;
    filename: string;
    onlineUrl?: string;
    caption: string;
  } | null>(null);

  // Unified Builder/Editor state
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showStock, setShowStock] = useState(true);
  const [showPromotions, setShowPromotions] = useState(true);
  const [compressionPreset, setCompressionPreset] = useState<'compact' | 'balanced' | 'high'>(
    'balanced',
  );

  const activeProducts = useMemo(() => products.filter((p) => p.isActive), [products]);

  const archivedCatalogItems = useMemo(() => {
    if (!editingCatalog) return [];
    const currentIds = new Set(products.map((p) => p.id));
    return editingCatalog.products.filter((p) => !currentIds.has(p.id));
  }, [editingCatalog, products]);

  const openBuilder = () => {
    setEditingCatalog(null);
    setTitle(`Catalogue ${storeProfile.name}`);
    setSubtitle(storeProfile.description || 'Sélection officielle disponible sur commande WhatsApp.');
    setSelectedIds(activeProducts.map((p) => p.id));
    setShowStock(true);
    setShowPromotions(true);
    setCompressionPreset('balanced');
    setBuilderOpen(true);
  };

  const openEditCatalog = (cat: SavedCatalog) => {
    setEditingCatalog(cat);
    setTitle(cat.title);
    setSubtitle(cat.subtitle);
    setSelectedIds(cat.products.map((p) => p.id));
    setShowStock(cat.showStock);
    setShowPromotions(cat.showPromotions);
    setCompressionPreset('balanced');
    setBuilderOpen(true);
  };

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const getSafeSlug = (text: string) =>
    (text || 'catalogue')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'catalogue';

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) {
      notify('Sélectionnez au moins un produit pour enregistrer le catalogue.', 'error');
      return;
    }

    setGenerating(true);
    try {
      const presetMap = {
        compact: {maxWidth: 480, quality: 0.62},
        balanced: {maxWidth: 640, quality: 0.74},
        high: {maxWidth: 840, quality: 0.84},
      };
      const {maxWidth, quality} = presetMap[compressionPreset];

      let snapshot = await createIndependentCatalogSnapshot(storeProfile, products, promotions, {
        title,
        subtitle,
        selectedProductIds: selectedIds,
        showStock,
        showPromotions,
        imageMaxWidth: maxWidth,
        imageQuality: quality,
        existingCatalog: editingCatalog ?? undefined,
      });

      // Synchronise la version en ligne si déjà publiée
      if (snapshot.onlineSlug && isOnline) {
        const published = await publishCatalogOnline(snapshot);
        if (published) {
          snapshot = {
            ...snapshot,
            onlineSlug: published.slug,
            onlineUrl: published.url,
            manageToken: published.manageToken,
            updatedAt: published.updatedAt,
          };
        }
      }

      await saveCatalog(snapshot);
      setBuilderOpen(false);
      setEditingCatalog(null);
      notify(
        `${editingCatalog ? 'Catalogue mis à jour' : 'Catalogue créé'} (${formatBytes(snapshot.htmlSizeBytes)}, ${snapshot.products.length} produits).`,
        'success',
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de la génération.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const ensureOnlineCatalogPublished = async (cat: SavedCatalog): Promise<SavedCatalog> => {
    if (!isOnline) return cat;
    setPublishingId(cat.id);
    try {
      const published = await publishCatalogOnline(cat);
      if (!published) return cat;
      const updated: SavedCatalog = {
        ...cat,
        onlineSlug: published.slug,
        onlineUrl: published.url,
        manageToken: published.manageToken,
        updatedAt: published.updatedAt,
      };
      // Re-générer pour embarquer onlineUrl dans le HTML autonome
      const refreshedHtml = generateStandaloneCatalogHtml(updated);
      updated.htmlSizeBytes = new Blob([refreshedHtml], {type: 'text/html;charset=utf-8'}).size;
      await saveCatalog(updated);
      if (previewCatalog?.id === updated.id) {
        setPreviewCatalog(updated);
      }
      return updated;
    } finally {
      setPublishingId(null);
    }
  };

  const handleDownloadHtml = async (cat: SavedCatalog) => {
    try {
      const html = generateStandaloneCatalogHtml(cat);
      const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
      await downloadBlobSafely(blob, `${getSafeSlug(cat.title)}.html`);
      notify('Fichier HTML autonome téléchargé.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors du téléchargement HTML.', 'error');
    }
  };

  const requestPdfConfirmation = (cat: SavedCatalog) => {
    try {
      const blob = generateCatalogPdfBlob(cat);
      const filename = `${getSafeSlug(cat.title)}.pdf`;
      setPdfConfirmState({catalog: cat, blob, filename});
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Impossible de générer le PDF.', 'error');
    }
  };

  const confirmAndDownloadPdf = async () => {
    if (!pdfConfirmState) return;
    try {
      await downloadBlobSafely(pdfConfirmState.blob, pdfConfirmState.filename);
      notify(
        `Catalogue PDF téléchargé (${pdfConfirmState.filename} · ${formatBytes(pdfConfirmState.blob.size)}).`,
        'success',
      );
      setPdfConfirmState(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Échec du téléchargement PDF.', 'error');
    }
  };

  const buildShareCaption = (cat: SavedCatalog, onlineUrl?: string) => {
    const productPreview = cat.products
      .slice(0, 4)
      .map((p) => `• ${p.name} : ${new Intl.NumberFormat('fr-FR').format(p.finalPrice)} ${cat.currency}`)
      .join('\n');

    return [
      `*${cat.title}* — ${cat.storeName}`,
      cat.subtitle ? cat.subtitle : '',
      productPreview ? `\nAperçu (${cat.products.length} articles) :\n${productPreview}` : '',
      onlineUrl ? `\nOuvrir le catalogue complet avec photos :\n${onlineUrl}` : '',
      cat.storePhone ? `Commander sur WhatsApp / Tél : ${cat.storePhone}` : '',
      cat.storeAddress ? `Adresse : ${cat.storeAddress}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const openShareDialog = async (rawCat: SavedCatalog, format: 'html' | 'pdf') => {
    try {
      let cat = rawCat;
      if (format === 'html' && isOnline) {
        cat = await ensureOnlineCatalogPublished(rawCat);
      }

      const blob =
        format === 'html'
          ? new Blob([generateStandaloneCatalogHtml(cat)], {type: 'text/html;charset=utf-8'})
          : generateCatalogPdfBlob(cat);

      const coverDataUrl =
        cat.bannerDataUrl ||
        cat.logoDataUrl ||
        cat.products.find((p) => Boolean(p.imageDataUrl))?.imageDataUrl;
      const coverBlob = coverDataUrl ? dataUrlToBlob(coverDataUrl) : null;
      const filename = `${getSafeSlug(cat.title)}.${format}`;
      const onlineUrl = format === 'html' ? cat.onlineUrl : undefined;
      const caption = buildShareCaption(cat, onlineUrl);

      setCopiedLink(false);
      setShareState({
        catalog: cat,
        format,
        blob,
        coverBlob,
        filename,
        onlineUrl,
        caption,
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Impossible de préparer le partage.', 'error');
    }
  };

  const handleShareOnlineLinkWithVisual = async () => {
    if (!shareState) return;
    if (shareState.format === 'html' && shareState.onlineUrl) {
      // Sur mobile, partager le visuel + lien cliquable + texte complet
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          if (shareState.coverBlob && typeof navigator.canShare === 'function') {
            const coverFile = new File(
              [shareState.coverBlob],
              `${getSafeSlug(shareState.catalog.title)}-visuel.jpg`,
              {type: shareState.coverBlob.type || 'image/jpeg'},
            );
            if (navigator.canShare({files: [coverFile]})) {
              await navigator.share({
                title: `${shareState.catalog.title} — ${shareState.catalog.storeName}`,
                text: shareState.caption,
                url: shareState.onlineUrl,
                files: [coverFile],
              });
              notify('Lien du catalogue et visuel partagés.', 'success');
              return;
            }
          }
          await navigator.share({
            title: `${shareState.catalog.title} — ${shareState.catalog.storeName}`,
            text: shareState.caption,
            url: shareState.onlineUrl,
          });
          notify('Lien du catalogue partagé.', 'success');
          return;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            notify('Partage annulé.', 'info');
            return;
          }
        }
      }
      await copyTextSafely(shareState.caption);
      if (shareState.coverBlob) {
        await downloadBlobSafely(
          shareState.coverBlob,
          `${getSafeSlug(shareState.catalog.title)}-couverture.jpg`,
        );
      }
      notify('Lien en ligne + message copiés (image de couverture téléchargée).', 'success');
      return;
    }

    const res = await tryNativeFileShare(
      shareState.blob,
      shareState.filename,
      shareState.catalog.title,
      shareState.caption,
    );
    if (res.shared) {
      notify('Catalogue PDF partagé via le menu natif.', 'success');
      setShareState(null);
      return;
    }
    if (res.cancelled) {
      notify('Partage annulé.', 'info');
      return;
    }
    await downloadBlobSafely(shareState.blob, shareState.filename);
    await copyTextSafely(shareState.caption);
    notify(
      'Menu natif indisponible : PDF téléchargé et message copié. Choisissez un réseau ci-dessous.',
      'info',
    );
  };

  const handleNetworkShare = async (
    platform: 'whatsapp' | 'facebook' | 'instagram' | 'tiktok' | 'email',
  ) => {
    if (!shareState) return;
    if (shareState.format === 'pdf') {
      await downloadBlobSafely(shareState.blob, shareState.filename);
    } else if (!shareState.onlineUrl) {
      await downloadBlobSafely(shareState.blob, shareState.filename);
    }
    const res = await openSocialAppIntent(platform, shareState.caption, shareState.catalog.title);
    notify(
      res.offline
        ? `${shareState.filename} préparé localement. ${res.message}`
        : shareState.format === 'html' && shareState.onlineUrl
          ? `Lien en ligne et infos copiés pour ${platform.toUpperCase()}.`
          : `${shareState.filename} prêt à joindre dans ${platform.toUpperCase()} (texte copié).`,
      res.offline ? 'error' : 'info',
    );
  };

  const previewHtmlDoc = useMemo(() => {
    if (!previewCatalog) return '';
    return generateStandaloneCatalogHtml(previewCatalog);
  }, [previewCatalog]);

  const previewWebUrl = useMemo(() => {
    if (!previewCatalog) return '';
    if (previewCatalog.onlineUrl) return previewCatalog.onlineUrl;
    if (isStaticHostWithoutBackend()) {
      return `catalogue-autonome://${getSafeSlug(previewCatalog.title)}.html`;
    }
    const slug = buildCatalogSlug(previewCatalog);
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://zando.pro';
    return `${origin}/c/${slug}`;
  }, [previewCatalog]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
          Créez vos catalogues avec photos et infos boutique : prévisualisez le rendu web, exportez en PDF ou partagez un lien HTML en ligne cliquable sur vos réseaux.
        </p>
        <button
          type="button"
          onClick={openBuilder}
          disabled={products.length === 0}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          style={{
            backgroundColor: 'var(--brand-accent, #059669)',
            color: 'var(--brand-accent-fg, #FFFFFF)',
          }}
        >
          <Plus className="w-4 h-4" />
          <span>Créer un catalogue</span>
        </button>
      </div>

      {catalogs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {products.length === 0
              ? 'Ajoutez d’abord des produits dans votre inventaire pour créer un catalogue.'
              : 'Aucun catalogue généré pour le moment.'}
          </p>
          {products.length > 0 && (
            <button
              type="button"
              onClick={openBuilder}
              className="mt-4 inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Générer mon premier catalogue</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {catalogs.map((cat) => {
            const isPublishing = publishingId === cat.id;
            return (
              <article
                key={cat.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatDateTime(cat.updatedAt ?? cat.createdAt)} · {cat.products.length} produit
                      {cat.products.length > 1 ? 's' : ''} · {formatBytes(cat.htmlSizeBytes)}
                    </div>
                    <h3 className="mt-0.5 text-base font-bold text-slate-900 dark:text-white truncate">
                      {cat.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1">
                      {cat.storeName} · {cat.categories.join(', ')}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3 shrink-0" />
                        {cat.storePhone ? cat.storePhone : 'Aucun numéro renseigné'}
                      </span>
                      {cat.onlineUrl && (
                        <a
                          href={cat.onlineUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold hover:underline"
                        >
                          <Globe className="w-3 h-3 shrink-0" />
                          <span>En ligne</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Uniquement les deux icônes : Modifier + Supprimer */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditCatalog(cat)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      aria-label="Modifier le catalogue"
                      title="Modifier"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await unpublishCatalogOnline(cat);
                        await removeCatalog(cat.id);
                        notify('Catalogue supprimé.', 'info');
                      }}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      aria-label="Supprimer le catalogue"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Uniquement : Aperçu · Partager PDF · Partager HTML */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewViewport('desktop');
                      setPreviewCatalog(cat);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Aperçu</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => requestPdfConfirmation(cat)}
                    className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-rose-600" />
                    <span>Partager PDF</span>
                  </button>
                  <button
                    type="button"
                    disabled={isPublishing}
                    onClick={() => openShareDialog(cat, 'html')}
                    className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {isPublishing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    <span>{isPublishing ? 'Publication...' : 'Partager HTML'}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Unified Create / Edit Modal (apparence strictement identique entre création et modification) */}
      <SheetModal
        open={builderOpen}
        onClose={() => {
          setBuilderOpen(false);
          setEditingCatalog(null);
        }}
        title={editingCatalog ? 'Modifier le catalogue' : 'Nouveau catalogue'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Titre du catalogue *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Compression des images</label>
              <ModernSelect
                value={compressionPreset}
                onChange={(val) =>
                  setCompressionPreset(val as 'compact' | 'balanced' | 'high')
                }
                options={[
                  {value: 'compact', label: 'Légère (480px · idéal WhatsApp)'},
                  {value: 'balanced', label: 'Équilibrée (640px · recommandée)'},
                  {value: 'high', label: 'Haute qualité (840px)'},
                ]}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Sous-titre / Message d’accroche</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 min-h-[40px] cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showStock}
                onChange={(e) => setShowStock(e.target.checked)}
                className="w-4 h-4 accent-emerald-600"
              />
              <span>Afficher les disponibilités</span>
            </label>
            <label className="flex items-center gap-2 min-h-[40px] cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showPromotions}
                onChange={(e) => setShowPromotions(e.target.checked)}
                className="w-4 h-4 accent-emerald-600"
              />
              <span>Inclure les promotions actives</span>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold">
                Produits inclus ({selectedIds.length}/{products.length + archivedCatalogItems.length})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds([
                      ...activeProducts.map((p) => p.id),
                      ...archivedCatalogItems.map((p) => p.id),
                    ])
                  }
                  className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 cursor-pointer"
                >
                  Tout sélectionner
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-xs font-semibold text-slate-500 cursor-pointer"
                >
                  Aucun
                </button>
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {products.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="w-4 h-4 accent-emerald-600 shrink-0"
                    />
                    <span className="truncate font-medium">{p.name}</span>
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">{p.category}</span>
                </label>
              ))}
              {archivedCatalogItems.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="w-4 h-4 accent-emerald-600 shrink-0"
                    />
                    <span className="truncate font-medium">{p.name}</span>
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">{p.category}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                setBuilderOpen(false);
                setEditingCatalog(null);
              }}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={generating || selectedIds.length === 0}
              className="min-h-[44px] px-5 rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: 'var(--brand-accent, #059669)',
                color: 'var(--brand-accent-fg, #FFFFFF)',
              }}
            >
              {generating ? 'Compression & génération...' : 'Enregistrer le catalogue'}
            </button>
          </div>
        </form>
      </SheetModal>

      {/* PDF Download & Share Modal */}
      <SheetModal
        open={!!pdfConfirmState}
        onClose={() => setPdfConfirmState(null)}
        title="Catalogue PDF"
        maxWidthClass="max-w-md"
      >
        {pdfConfirmState && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-1.5 text-xs sm:text-sm">
              <div className="font-bold text-slate-900 dark:text-white">
                {pdfConfirmState.catalog.title}
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                Fichier : <span className="font-mono font-semibold">{pdfConfirmState.filename}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-400 tabular-nums">
                Contenu : {pdfConfirmState.catalog.products.length} produit(s) · Taille :{' '}
                <strong>{formatBytes(pdfConfirmState.blob.size)}</strong>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5 justify-end pt-1">
              <button
                type="button"
                onClick={() => setPdfConfirmState(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmAndDownloadPdf}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pdfConfirmState.catalog;
                  setPdfConfirmState(null);
                  openShareDialog(target, 'pdf');
                }}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Partager PDF</span>
              </button>
            </div>
          </div>
        )}
      </SheetModal>

      {/* Multi-Network Share Modal (HTML Online Link + Images OR PDF File) */}
      <SheetModal
        open={!!shareState}
        onClose={() => setShareState(null)}
        title={
          shareState?.format === 'html'
            ? 'Partager le catalogue en ligne (HTML)'
            : 'Partager le catalogue (PDF)'
        }
        maxWidthClass="max-w-lg"
      >
        {shareState && (
          <div className="space-y-4">
            {shareState.format === 'html' && shareState.onlineUrl ? (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    <Globe className="w-4 h-4" />
                    <span>Lien HTML en ligne prêt pour vos clients</span>
                  </span>
                  <a
                    href={shareState.onlineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    <span>Ouvrir</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareState.onlineUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 min-w-0 min-h-[38px] px-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 text-xs font-mono text-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await copyTextSafely(shareState.onlineUrl!);
                      setCopiedLink(true);
                      notify('Lien du catalogue copié.', 'success');
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 min-h-[38px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copié' : 'Copier'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Lorsque votre client clique sur ce lien, le catalogue s’ouvre sur le web avec toutes les images, les prix, et l’envoi de commande avec photos.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 text-xs space-y-1">
                <div className="font-bold text-slate-900 dark:text-white">
                  {shareState.filename} ({formatBytes(shareState.blob.size)})
                </div>
                <div className="text-slate-600 dark:text-slate-400">
                  {shareState.format === 'html'
                    ? 'En mode hors ligne, le fichier HTML autonome contenant toutes les images peut être envoyé directement.'
                    : 'Le fichier PDF réel sera partagé avec vos infos boutique.'}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleShareOnlineLinkWithVisual}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>
                {shareState.format === 'html' && shareState.onlineUrl
                  ? 'Partager lien + visuel & infos (Menu système)'
                  : `Envoyer le fichier ${shareState.format.toUpperCase()} (Menu système)`}
              </span>
            </button>

            {!isOnline && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                Vous êtes hors ligne : la publication d’un lien web et l’ouverture des réseaux sociaux nécessitent une connexion Internet.
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Envoyer vers un réseau social (lien + infos copiés) :
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleNetworkShare('whatsapp')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-600" />
                  <span>WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNetworkShare('facebook')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 text-sky-600" />
                  <span>Facebook</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNetworkShare('instagram')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 text-pink-600" />
                  <span>Instagram</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNetworkShare('tiktok')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>TikTok</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNetworkShare('email')}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Mail className="w-4 h-4 text-indigo-600" />
                  <span>Email</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await copyTextSafely(shareState.caption);
                    notify('Texte complet et lien copiés.', 'success');
                  }}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Copy className="w-4 h-4 text-slate-600" />
                  <span>Copier message</span>
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <span className="text-[11px] text-slate-500">
                Archive locale ({formatBytes(shareState.blob.size)})
              </span>
              <button
                type="button"
                onClick={() => downloadBlobSafely(shareState.blob, shareState.filename)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Télécharger le fichier .{shareState.format}</span>
              </button>
            </div>
          </div>
        )}
      </SheetModal>

      {/* Full-Screen Web Browser Preview Modal */}
      <SheetModal
        open={!!previewCatalog}
        onClose={() => setPreviewCatalog(null)}
        title={`Aperçu Web : ${previewCatalog?.title ?? ''}`}
        fullScreen
      >
        {previewCatalog && (
          <div className="flex flex-col h-full gap-3">
            {/* Web Browser Toolbar */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="hidden sm:flex items-center gap-1.5 px-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                  <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate font-mono">{previewWebUrl}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('desktop')}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                      previewViewport === 'desktop'
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                    title="Vue ordinateur"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Web</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('mobile')}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                      previewViewport === 'mobile'
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                    title="Vue mobile"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Mobile</span>
                  </button>
                </div>

                {previewCatalog.onlineUrl ? (
                  <a
                    href={previewCatalog.onlineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ouvrir sur le web</span>
                  </a>
                ) : (
                  isOnline &&
                  !isStaticHostWithoutBackend() && (
                    <button
                      type="button"
                      disabled={publishingId === previewCatalog.id}
                      onClick={async () => {
                        const updated = await ensureOnlineCatalogPublished(previewCatalog);
                        if (updated.onlineUrl) {
                          notify('Catalogue publié en ligne et prêt à ouvrir sur le web.', 'success');
                        } else {
                          notify('Serveur de publication indisponible.', 'error');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600/40 bg-white dark:bg-slate-950 text-xs font-semibold text-emerald-700 dark:text-emerald-400 cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>
                        {publishingId === previewCatalog.id ? 'Publication...' : 'Publier lien web'}
                      </span>
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => openShareDialog(previewCatalog, 'html')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Partager HTML</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadHtml(previewCatalog)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Télécharger</span>
                </button>
              </div>
            </div>

            {/* Simulated Browser Viewport */}
            <div className="flex-1 flex justify-center overflow-hidden rounded-xl bg-slate-200/70 dark:bg-slate-950/70 p-2 sm:p-4 border border-slate-200 dark:border-slate-800">
              <iframe
                title="Aperçu web du catalogue"
                srcDoc={previewHtmlDoc}
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                className={`h-full min-h-[calc(100dvh-180px)] rounded-xl border border-slate-300 dark:border-slate-700 bg-white shadow-sm transition-all ${
                  previewViewport === 'mobile' ? 'w-full max-w-[390px]' : 'w-full'
                }`}
              />
            </div>
          </div>
        )}
      </SheetModal>
    </div>
  );
};
