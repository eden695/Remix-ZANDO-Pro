import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type {Request, Response} from 'express';

const PORT = Number(process.env.PORT) || 3000;
const APP_VERSION = '2.1.0';
const CATALOGS_DIR = path.resolve(process.cwd(), 'data', 'catalogs');
const TRANSFERS_DIR = path.resolve(process.cwd(), 'data', 'transfers');
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const PRODUCT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ZANDO_ID_RE = /^ZND-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const TRANSFER_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;

interface PublishedCatalogRecord {
  slug: string;
  manageToken: string;
  title: string;
  subtitle: string;
  storeName: string;
  html: string;
  coverDataUrl?: string;
  productImages: Record<string, string>;
  updatedAt: number;
}

async function ensureCatalogDir(): Promise<void> {
  await fs.mkdir(CATALOGS_DIR, {recursive: true});
  await fs.mkdir(TRANSFERS_DIR, {recursive: true});
}

function resolveTransferReceiverDir(zandoId: string): string | null {
  const normalized = zandoId.trim().toUpperCase();
  if (!ZANDO_ID_RE.test(normalized)) return null;
  const resolved = path.resolve(TRANSFERS_DIR, normalized);
  if (!resolved.startsWith(TRANSFERS_DIR + path.sep)) return null;
  return resolved;
}

function resolveTransferFilePath(zandoId: string, transferId: string): string | null {
  const dir = resolveTransferReceiverDir(zandoId);
  if (!dir || !TRANSFER_ID_RE.test(transferId)) return null;
  const resolved = path.resolve(dir, `${transferId}.json`);
  if (!resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

function resolveCatalogPath(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return null;
  const resolved = path.resolve(CATALOGS_DIR, `${slug}.json`);
  if (!resolved.startsWith(CATALOGS_DIR + path.sep)) return null;
  return resolved;
}

function escapeMeta(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getRequestOrigin(req: Request): string {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader)
    ? protoHeader[0]
    : (protoHeader || req.protocol || 'https').split(',')[0].trim();
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader.split(',')[0].trim();
  return `${proto}://${host}`;
}

function decodeDataUrlImage(dataUrl?: string): {mime: string; buffer: Buffer} | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  try {
    const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 4 * 1024 * 1024) return null;
    return {mime, buffer};
  } catch {
    return null;
  }
}

function safeTokenCompare(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function readCatalogRecord(slug: string): Promise<PublishedCatalogRecord | null> {
  const filePath = resolveCatalogPath(slug);
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as PublishedCatalogRecord;
  } catch {
    return null;
  }
}

async function startServer(): Promise<void> {
  await ensureCatalogDir();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({limit: '15mb'}));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      version: APP_VERSION,
      onlineCatalogs: true,
      timestamp: Date.now(),
    });
  });

  app.post('/api/catalogs', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object') {
        res.status(400).json({error: 'Corps de requête invalide.'});
        return;
      }

      const rawSlug = typeof body.slug === 'string' ? body.slug.toLowerCase().trim() : '';
      const slug = rawSlug.replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
      const filePath = resolveCatalogPath(slug);
      if (!filePath) {
        res.status(400).json({error: 'Identifiant de catalogue invalide.'});
        return;
      }

      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
      const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim().slice(0, 320) : '';
      const storeName = typeof body.storeName === 'string' ? body.storeName.trim().slice(0, 140) : '';
      const html = typeof body.html === 'string' ? body.html : '';

      if (!title || !storeName || !html || html.length > 12 * 1024 * 1024) {
        res.status(400).json({error: 'Données du catalogue incomplètes ou trop volumineuses.'});
        return;
      }

      const existing = await readCatalogRecord(slug);
      const providedToken =
        typeof body.manageToken === 'string'
          ? body.manageToken
          : typeof req.headers['x-catalog-token'] === 'string'
            ? req.headers['x-catalog-token']
            : '';

      if (existing && !safeTokenCompare(existing.manageToken, providedToken)) {
        res.status(403).json({error: 'Jeton de modification du catalogue invalide.'});
        return;
      }

      const manageToken = existing?.manageToken || crypto.randomBytes(16).toString('hex');
      const coverDataUrl =
        typeof body.coverDataUrl === 'string' && decodeDataUrlImage(body.coverDataUrl)
          ? body.coverDataUrl
          : undefined;

      const productImages: Record<string, string> = {};
      if (body.productImages && typeof body.productImages === 'object') {
        for (const [pid, dataUrl] of Object.entries(body.productImages as Record<string, unknown>)) {
          if (
            PRODUCT_ID_RE.test(pid) &&
            typeof dataUrl === 'string' &&
            decodeDataUrlImage(dataUrl)
          ) {
            productImages[pid] = dataUrl;
          }
        }
      }

      const record: PublishedCatalogRecord = {
        slug,
        manageToken,
        title,
        subtitle,
        storeName,
        html,
        coverDataUrl,
        productImages,
        updatedAt: Date.now(),
      };

      const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(record), 'utf8');
      await fs.rename(tmpPath, filePath);

      const origin = getRequestOrigin(req);
      res.json({
        slug,
        url: `${origin}/c/${slug}`,
        path: `/c/${slug}`,
        manageToken,
        updatedAt: record.updatedAt,
      });
    } catch (err) {
      console.error('Error publishing catalog:', err);
      res.status(500).json({error: 'Erreur interne lors de la publication du catalogue.'});
    }
  });

  app.delete('/api/catalogs/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const filePath = resolveCatalogPath(slug);
    if (!filePath) {
      res.status(400).json({error: 'Identifiant invalide.'});
      return;
    }

    const existing = await readCatalogRecord(slug);
    if (!existing) {
      res.status(404).json({error: 'Catalogue introuvable.'});
      return;
    }

    const token =
      typeof req.headers['x-catalog-token'] === 'string' ? req.headers['x-catalog-token'] : '';
    if (!safeTokenCompare(existing.manageToken, token)) {
      res.status(403).json({error: 'Non autorisé.'});
      return;
    }

    await fs.unlink(filePath).catch(() => {});
    res.json({deleted: true});
  });

  app.post('/api/transfers', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || body.format !== 'zando-pro-store-transfer') {
        res.status(400).json({error: 'Enveloppe de transfert invalide.'});
        return;
      }
      const receiverZandoId =
        typeof body.receiverZandoId === 'string' ? body.receiverZandoId.trim().toUpperCase() : '';
      const transferId = typeof body.transferId === 'string' ? body.transferId.trim() : '';
      const filePath = resolveTransferFilePath(receiverZandoId, transferId);
      const receiverDir = resolveTransferReceiverDir(receiverZandoId);

      if (!filePath || !receiverDir || typeof body.ciphertext !== 'string') {
        res.status(400).json({error: 'Identifiant destinataire ou données de transfert invalides.'});
        return;
      }

      await fs.mkdir(receiverDir, {recursive: true});
      const existingFiles = (await fs.readdir(receiverDir).catch(() => [])).filter((f) =>
        f.endsWith('.json'),
      );
      if (existingFiles.length >= 10) {
        existingFiles.sort();
        for (const oldFile of existingFiles.slice(0, existingFiles.length - 9)) {
          await fs.unlink(path.resolve(receiverDir, oldFile)).catch(() => {});
        }
      }

      const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(body), 'utf8');
      await fs.rename(tmpPath, filePath);

      res.json({ok: true, transferId, receiverZandoId});
    } catch (err) {
      console.error('Error storing transfer:', err);
      res.status(500).json({error: 'Erreur serveur lors de l’envoi du transfert.'});
    }
  });

  app.get('/api/transfers/:zandoId', async (req: Request, res: Response) => {
    const receiverDir = resolveTransferReceiverDir(String(req.params.zandoId || ''));
    if (!receiverDir) {
      res.status(400).json({error: 'Identifiant ZANDO invalide.'});
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    try {
      const files = (await fs.readdir(receiverDir).catch(() => [])).filter((f) =>
        f.endsWith('.json'),
      );
      const transfers: unknown[] = [];
      for (const file of files) {
        const resolved = path.resolve(receiverDir, file);
        if (!resolved.startsWith(receiverDir + path.sep)) continue;
        try {
          const raw = await fs.readFile(resolved, 'utf8');
          transfers.push(JSON.parse(raw));
        } catch {
          // Skip malformed transfer file
        }
      }
      res.json({transfers});
    } catch {
      res.json({transfers: []});
    }
  });

  app.delete('/api/transfers/:zandoId/:transferId', async (req: Request, res: Response) => {
    const filePath = resolveTransferFilePath(
      String(req.params.zandoId || ''),
      String(req.params.transferId || ''),
    );
    if (!filePath) {
      res.status(400).json({error: 'Paramètres de suppression invalides.'});
      return;
    }
    await fs.unlink(filePath).catch(() => {});
    res.json({deleted: true});
  });

  app.get('/c/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const record = await readCatalogRecord(slug);
    if (!record) {
      res
        .status(404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalogue introuvable</title></head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#0F172A"><h1>Catalogue indisponible</h1><p>Ce lien de catalogue n’existe plus ou a été retiré par le commerçant.</p></body></html>`,
        );
      return;
    }

    const origin = getRequestOrigin(req);
    const catalogUrl = `${origin}/c/${slug}`;
    const coverUrl = `${catalogUrl}/cover.jpg`;
    const firstProdId = Object.keys(record.productImages)[0];
    const hasCover = Boolean(record.coverDataUrl || firstProdId);

    const ogTags = [
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${escapeMeta(`${record.title} — ${record.storeName}`)}" />`,
      `<meta property="og:description" content="${escapeMeta(record.subtitle || `Catalogue officiel de ${record.storeName}`)}" />`,
      `<meta property="og:url" content="${escapeMeta(catalogUrl)}" />`,
      hasCover ? `<meta property="og:image" content="${escapeMeta(coverUrl)}" />` : '',
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<script>window.__ZANDO_ONLINE_BASE__=${JSON.stringify(catalogUrl).replace(/</g, '\\u003c')};</script>`,
    ]
      .filter(Boolean)
      .join('\n');

    const finalHtml = record.html.includes('</head>')
      ? record.html.replace('</head>', `${ogTags}\n</head>`)
      : `${ogTags}\n${record.html}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(finalHtml);
  });

  app.get('/c/:slug/cover.jpg', async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const record = await readCatalogRecord(slug);
    if (!record) {
      res.status(404).end();
      return;
    }
    const fallbackImg = Object.values(record.productImages)[0];
    const img = decodeDataUrlImage(record.coverDataUrl || fallbackImg);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(img.buffer);
  });

  app.get('/c/:slug/img/:productId.jpg', async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const productId = String(req.params.productId || '').trim();
    if (!PRODUCT_ID_RE.test(productId)) {
      res.status(400).end();
      return;
    }
    const record = await readCatalogRecord(slug);
    if (!record) {
      res.status(404).end();
      return;
    }
    const img = decodeDataUrlImage(record.productImages[productId]);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', img.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(img.buffer);
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ZANDO Pro server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
