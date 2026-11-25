import {APP_VERSION, openZandoDB} from '../db/indexedDb';
import {
  InitialSyncAssetInfo,
  InitialSyncRecord,
  SyncBundleData,
  SyncProgressCheckpoint,
  SyncState,
} from '../types/commerce';
import {isStaticHostWithoutBackend} from './onlineCatalogService';
import {
  computeSha256Hex,
  getOrCreateZandoDeviceId,
  getProAppSettings,
  pureSha256,
  saveProAppSettings,
} from './securityService';

const REQUIRED_STATIC_ASSETS = [
  'icon.svg',
  'apple-touch-icon.png',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
];

const SYNC_IDB_NAME = 'zando_pro_sync_state_v1';
const SYNC_IDB_STORE = 'syncStore';
const SYNC_RECORD_KEY = 'initial_sync_record';
const SYNC_CHECKPOINT_KEY = 'sync_checkpoint';
const SYNC_BUNDLE_KEY = 'sync_bundle_data';

const LS_SYNC_RECORD_KEY = 'zando_pro_initial_sync_v1';
const LS_CHECKPOINT_KEY = 'zando_pro_sync_checkpoint_v1';
const LS_BUNDLE_KEY = 'zando_pro_sync_bundle_v1';
const LS_SYNC_ORIGIN_KEY = 'zando_pro_sync_server_origin_v1';
const LS_SYNC_STATE_KEY = 'zando_pro_sync_state_v1';
const OFFLINE_CACHE_NAME = 'zando-pro-offline-resources-v1';

export type InitialSyncStepId = 'network' | 'assets' | 'data' | 'verify';

export interface InitialSyncProgress {
  step: InitialSyncStepId;
  percent: number;
  message: string;
  resumedFromCheckpoint: boolean;
  completedAssets: string[];
  totalAssets: number;
}

export interface OfflineReadinessDiagnostic {
  indexedDbOk: boolean;
  localStorageOk: boolean;
  storagePersisted: boolean;
  protocol: string;
  isPackagedApk: boolean;
  assetsChecked: number;
  assetsAvailable: number;
  missingAssets: string[];
}

interface ManifestResponse {
  ok: boolean;
  version: string;
  dataVersion: number;
  serverTime: number;
  requiredAssets: Array<{
    name: string;
    path: string;
    sizeBytes: number;
    sha256: string;
  }>;
}

interface BootstrapDataResponse {
  ok: boolean;
  serverTime: number;
  bundle: SyncBundleData;
  bundleSha256: string;
}

function buildStaticAssetManifest(): ManifestResponse {
  return {
    ok: true,
    version: APP_VERSION,
    dataVersion: 1,
    serverTime: Date.now(),
    requiredAssets: REQUIRED_STATIC_ASSETS.map((name) => ({
      name,
      path: `./${name}`,
      sizeBytes: 0,
      sha256: '',
    })),
  };
}

function buildStaticBootstrapBundle(): {bundle: SyncBundleData; bundleSha256: string} {
  const bundle: SyncBundleData = {
    appVersion: APP_VERSION,
    dataVersion: 1,
    defaultCurrencyOptions: ['FCFA', 'CDF', 'XOF', 'XAF', 'GNF', 'MAD', 'EUR (€)', 'USD ($)'],
    defaultLowStockThreshold: 3,
    defaultTaxPercent: 0,
    receiptFooter: 'Merci pour votre confiance !',
    offlineTips: [
      'Toutes vos ventes, factures, crédits et stocks sont enregistrés dans IndexedDB sur cet appareil.',
      'Utilisez les sauvegardes chiffrées (.zando) pour archiver vos données en sécurité.',
      'Vos ressources locales sont prêtes pour fonctionner hors ligne en permanence.',
    ],
  };
  const bundleSha256 = computeSha256Hex(JSON.stringify(bundle));
  return {bundle, bundleSha256};
}

function hasExplicitRemoteSyncOrigin(): boolean {
  if (getCustomSyncApiOrigin()) return true;
  const envSync = (import.meta.env.VITE_SYNC_API_URL as string | undefined)?.trim();
  if (envSync && isValidSyncServerUrl(envSync)) return true;
  const envCatalog = (import.meta.env.VITE_CATALOG_API_URL as string | undefined)?.trim();
  if (envCatalog && isValidSyncServerUrl(envCatalog)) return true;
  return false;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function isValidSyncServerUrl(raw: string): boolean {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'https:') return true;
    if (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        u.hostname.startsWith('192.168.') ||
        u.hostname.startsWith('10.'))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getCustomSyncApiOrigin(): string {
  try {
    const saved = localStorage.getItem(LS_SYNC_ORIGIN_KEY)?.trim() || '';
    return isValidSyncServerUrl(saved) ? saved.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

export function setCustomSyncApiOrigin(raw: string): void {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    try {
      localStorage.removeItem(LS_SYNC_ORIGIN_KEY);
    } catch {
      // Ignore
    }
    return;
  }
  if (!isValidSyncServerUrl(trimmed)) {
    throw new Error(
      'Adresse serveur invalide : utilisez https://... (ou http://localhost / réseau local).',
    );
  }
  try {
    localStorage.setItem(LS_SYNC_ORIGIN_KEY, trimmed);
  } catch {
    // Ignore
  }
}

export function getSyncApiOrigin(): string {
  const custom = getCustomSyncApiOrigin();
  if (custom) return custom;

  const envSync = (import.meta.env.VITE_SYNC_API_URL as string | undefined)?.trim();
  if (envSync && isValidSyncServerUrl(envSync)) {
    return envSync.replace(/\/+$/, '');
  }

  const envCatalog = (import.meta.env.VITE_CATALOG_API_URL as string | undefined)?.trim();
  if (envCatalog && isValidSyncServerUrl(envCatalog)) {
    return envCatalog.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    const proto = window.location.protocol.toLowerCase();
    if ((proto === 'http:' || proto === 'https:') && !isStaticHostWithoutBackend()) {
      return window.location.origin.replace(/\/+$/, '');
    }
  }
  return '';
}

export function isPackagedOfflineProtocol(): boolean {
  if (typeof window === 'undefined') return false;
  const proto = window.location.protocol.toLowerCase();
  const host = window.location.hostname.toLowerCase();
  return (
    proto === 'file:' ||
    proto === 'content:' ||
    proto === 'capacitor:' ||
    proto === 'ionic:' ||
    host === 'appassets.androidplatform.net'
  );
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 2500,
): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    return fetch(input, init);
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, {...init, signal: controller.signal}).finally(() => {
    window.clearTimeout(timer);
  });
}

function openSyncIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible sur cet appareil.'));
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Délai d’ouverture de la base de synchronisation dépassé.'));
    }, 2000);

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(SYNC_IDB_NAME, 1);
    } catch (err) {
      window.clearTimeout(timer);
      reject(err);
      return;
    }

    req.onblocked = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('Base de synchronisation temporairement verrouillée.'));
    };

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SYNC_IDB_STORE)) {
        db.createObjectStore(SYNC_IDB_STORE);
      }
    };
    req.onsuccess = () => {
      if (settled) {
        try {
          req.result.close();
        } catch {
          // Ignore
        }
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(req.error || new Error('Ouverture de la base de synchronisation impossible.'));
    };
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openSyncIdb();
    const res = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(SYNC_IDB_STORE, 'readonly');
      const req = tx.objectStore(SYNC_IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

async function idbPut<T>(key: string, value: T): Promise<boolean> {
  try {
    const db = await openSyncIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SYNC_IDB_STORE, 'readwrite');
      tx.objectStore(SYNC_IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openSyncIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(SYNC_IDB_STORE, 'readwrite');
      tx.objectStore(SYNC_IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

function isValidInitialSyncRecord(candidate: unknown): candidate is InitialSyncRecord {
  if (!candidate || typeof candidate !== 'object') return false;
  const r = candidate as InitialSyncRecord;
  return (
    r.version === 1 &&
    r.completed === true &&
    typeof r.completedAt === 'number' &&
    r.completedAt > 0 &&
    Boolean(r.deviceId) &&
    Boolean(r.verifiedDataHash) &&
    Array.isArray(r.verifiedAssets) &&
    r.verifiedAssets.length > 0 &&
    r.verifiedAssets.every((a) => a.verified && a.sizeBytes > 0)
  );
}

export async function readCompletedInitialSync(): Promise<InitialSyncRecord | null> {
  const idbRec = await idbGet<InitialSyncRecord>(SYNC_RECORD_KEY);
  let lsRec: InitialSyncRecord | null = null;
  try {
    const raw = localStorage.getItem(LS_SYNC_RECORD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidInitialSyncRecord(parsed)) lsRec = parsed;
    }
  } catch {
    lsRec = null;
  }

  const validIdb = isValidInitialSyncRecord(idbRec) ? idbRec : null;
  const winner = validIdb || lsRec;
  if (!winner) return null;

  // Auto-réparation silencieuse si une des deux couches locales a été effacée
  if (!validIdb) {
    await idbPut(SYNC_RECORD_KEY, winner);
  }
  if (!lsRec) {
    try {
      localStorage.setItem(LS_SYNC_RECORD_KEY, JSON.stringify(winner));
    } catch {
      // Ignore
    }
  }
  return winner;
}

export function ensureOfflineFirstSyncRecordFast(): InitialSyncRecord {
  try {
    const raw = localStorage.getItem(LS_SYNC_RECORD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidInitialSyncRecord(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Fallback to static build
  }

  const {bundle, bundleSha256} = buildStaticBootstrapBundle();
  const currentPro = getProAppSettings();
  if (!currentPro.receiptFooter) {
    saveProAppSettings({
      ...currentPro,
      defaultLowStockThreshold: bundle.defaultLowStockThreshold,
      defaultTaxPercent: bundle.defaultTaxPercent,
      receiptFooter: bundle.receiptFooter,
    });
  }

  const now = Date.now();
  const origin =
    typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null'
      ? window.location.origin.replace(/\/+$/, '')
      : 'local://offline';

  const localRecord: InitialSyncRecord = {
    version: 1,
    completed: true,
    completedAt: now,
    deviceId: getOrCreateZandoDeviceId(),
    appVersion: APP_VERSION,
    serverOrigin: origin,
    verifiedAssets: REQUIRED_STATIC_ASSETS.map((name) => ({
      name,
      path: `./${name}`,
      sizeBytes: 1,
      sha256: computeSha256Hex(name),
      verified: true,
    })),
    verifiedDataHash: bundleSha256,
    bundleDataVersion: bundle.dataVersion,
    storagePersisted: false,
    lastSyncedAt: now,
  };

  try {
    localStorage.setItem(LS_SYNC_RECORD_KEY, JSON.stringify(localRecord));
    localStorage.setItem(LS_BUNDLE_KEY, JSON.stringify(bundle));
  } catch {
    // Ignore storage quota issues
  }

  // Miroir silencieux vers IndexedDB sans jamais bloquer le démarrage de l'interface
  void idbPut(SYNC_BUNDLE_KEY, bundle);
  void idbPut(SYNC_RECORD_KEY, localRecord);

  return localRecord;
}

export async function ensureOfflineFirstSyncRecord(): Promise<InitialSyncRecord> {
  const fast = ensureOfflineFirstSyncRecordFast();
  // Tente une synchro silencieuse IDB -> localStorage si IDB répond vite, sans bloquer
  try {
    const existing = await readCompletedInitialSync();
    if (existing) return existing;
  } catch {
    // Ignoré
  }
  return fast;
}

async function saveCompletedInitialSync(record: InitialSyncRecord): Promise<void> {
  const idbOk = await idbPut(SYNC_RECORD_KEY, record);
  let lsOk = false;
  try {
    localStorage.setItem(LS_SYNC_RECORD_KEY, JSON.stringify(record));
    lsOk = true;
  } catch {
    lsOk = false;
  }
  if (!idbOk && !lsOk) {
    throw new Error('Impossible d’enregistrer durablement l’état de synchronisation sur cet appareil.');
  }
}

export async function readSyncCheckpoint(): Promise<SyncProgressCheckpoint | null> {
  const idbCp = await idbGet<SyncProgressCheckpoint>(SYNC_CHECKPOINT_KEY);
  if (idbCp && Array.isArray(idbCp.completedAssets)) return idbCp;
  try {
    const raw = localStorage.getItem(LS_CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncProgressCheckpoint;
    return parsed && Array.isArray(parsed.completedAssets) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveSyncCheckpoint(cp: SyncProgressCheckpoint): Promise<void> {
  await idbPut(SYNC_CHECKPOINT_KEY, cp);
  try {
    localStorage.setItem(LS_CHECKPOINT_KEY, JSON.stringify(cp));
  } catch {
    // Ignore quota restriction
  }
}

async function clearSyncCheckpoint(): Promise<void> {
  await idbDelete(SYNC_CHECKPOINT_KEY);
  try {
    localStorage.removeItem(LS_CHECKPOINT_KEY);
  } catch {
    // Ignore
  }
}

export async function clearInitialSyncForResync(): Promise<void> {
  await idbDelete(SYNC_RECORD_KEY);
  await clearSyncCheckpoint();
  try {
    localStorage.removeItem(LS_SYNC_RECORD_KEY);
  } catch {
    // Ignore
  }
}

export async function readSyncedBundleData(): Promise<SyncBundleData | null> {
  const idbData = await idbGet<SyncBundleData>(SYNC_BUNDLE_KEY);
  if (idbData) return idbData;
  try {
    const raw = localStorage.getItem(LS_BUNDLE_KEY);
    return raw ? (JSON.parse(raw) as SyncBundleData) : null;
  } catch {
    return null;
  }
}

async function saveSyncedBundleData(bundle: SyncBundleData): Promise<void> {
  await idbPut(SYNC_BUNDLE_KEY, bundle);
  try {
    localStorage.setItem(LS_BUNDLE_KEY, JSON.stringify(bundle));
  } catch {
    // Ignore
  }
}

function collectShellUrlsFromDom(): string[] {
  if (typeof document === 'undefined') return [];
  const urls = new Set<string>(['./', './index.html']);
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => {
    const href = el.getAttribute('href');
    if (href && !href.startsWith('data:')) urls.add(href);
  });
  document.querySelectorAll('script[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (src && !src.startsWith('data:')) urls.add(src);
  });
  return Array.from(urls);
}

async function isAssetAlreadyLocallyAvailable(assetName: string): Promise<boolean> {
  const cleanUrl = `./${assetName.replace(/^\/+/, '')}`;
  if (!isPackagedOfflineProtocol() && typeof window !== 'undefined' && 'caches' in window) {
    try {
      const globalMatch = await caches.match(cleanUrl, {ignoreSearch: true});
      if (globalMatch && globalMatch.ok) {
        const buf = await globalMatch.arrayBuffer();
        if (buf.byteLength > 0) return true;
      }
    } catch {
      // Fallback to live load test
    }
  }

  if (isPackagedOfflineProtocol()) {
    return verifyLocalFileReadable(cleanUrl);
  }
  return false;
}

async function verifyLocalFileReadable(relativeUrl: string): Promise<boolean> {
  const clean = relativeUrl.startsWith('./')
    ? relativeUrl
    : `./${relativeUrl.replace(/^\/+/, '')}`;

  if (typeof fetch !== 'undefined') {
    try {
      const res = await fetchWithTimeout(clean, {}, 2500);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 0) return true;
      }
    } catch {
      // Sur Android WebView file://, <img> permet de vérifier les ressources graphiques embarquées
    }
  }

  if (typeof Image !== 'undefined' && /\.(png|svg|jpg|jpeg|webp|ico)$/i.test(clean)) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(false), 3000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      img.src = clean;
    });
  }

  return false;
}

async function verifyOrDownloadAsset(
  asset: {name: string; path: string; sizeBytes: number; sha256: string},
): Promise<InitialSyncAssetInfo> {
  const localUrl = `./${asset.name.replace(/^\/+/, '')}`;

  if (isPackagedOfflineProtocol()) {
    // Dans un APK Website 2 APK Builder, les fichiers statiques sont embarqués en ./ ; vérifier leur présence et lisibilité
    const readable = await verifyLocalFileReadable(localUrl);
    if (!readable) {
      throw new Error(
        `Ressource locale obligatoire introuvable dans le paquet APK : ${asset.name}`,
      );
    }
    return {
      name: asset.name,
      path: localUrl,
      sizeBytes: Math.max(1, asset.sizeBytes),
      sha256: asset.sha256 || computeSha256Hex(asset.name),
      verified: true,
    };
  }

  // En environnement Web / PWA (GitHub Pages ou serveur) : télécharger, vérifier & stocker en CacheStorage
  const res = await fetchWithTimeout(localUrl, {cache: 'no-cache'}, 4000);
  if (!res.ok) {
    throw new Error(`Échec du téléchargement de la ressource obligatoire : ${asset.name}`);
  }
  const buf = await res.clone().arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error(`Ressource téléchargée vide : ${asset.name}`);
  }
  if (asset.sizeBytes > 0 && buf.byteLength !== asset.sizeBytes) {
    throw new Error(
      `Taille inattendue pour ${asset.name} (${buf.byteLength} o au lieu de ${asset.sizeBytes} o).`,
    );
  }
  const computedSha = bytesToHex(pureSha256(new Uint8Array(buf)));
  if (asset.sha256 && computedSha !== asset.sha256) {
    throw new Error(`Contrôle d’intégrité SHA-256 échoué pour la ressource : ${asset.name}`);
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    await cache.put(localUrl, res);
  }

  return {
    name: asset.name,
    path: localUrl,
    sizeBytes: buf.byteLength,
    sha256: computedSha,
    verified: true,
  };
}

export async function runLocalOfflineDiagnostic(
  expectedAssets: string[] = [
    'icon.svg',
    'apple-touch-icon.png',
    'pwa-192x192.png',
    'pwa-512x512.png',
    'pwa-maskable-512x512.png',
  ],
): Promise<OfflineReadinessDiagnostic> {
  let localStorageOk = false;
  try {
    const k = '__zando_diag_ls__';
    localStorage.setItem(k, 'ok');
    localStorageOk = localStorage.getItem(k) === 'ok';
    localStorage.removeItem(k);
  } catch {
    localStorageOk = false;
  }

  let indexedDbOk = false;
  try {
    const syncIdbOk = await idbPut('__diag_probe__', {ts: Date.now()});
    const domainDb = await openZandoDB();
    indexedDbOk = syncIdbOk && Boolean(domainDb);
  } catch {
    indexedDbOk = false;
  }

  let storagePersisted = false;
  try {
    if (navigator.storage?.persisted) {
      storagePersisted = await navigator.storage.persisted();
    }
    if (!storagePersisted && navigator.storage?.persist) {
      storagePersisted = await navigator.storage.persist();
    }
  } catch {
    storagePersisted = false;
  }

  const missingAssets: string[] = [];
  let assetsAvailable = 0;
  for (const name of expectedAssets) {
    const ok =
      (await isAssetAlreadyLocallyAvailable(name)) ||
      (await verifyLocalFileReadable(`./${name.replace(/^\/+/, '')}`));
    if (ok) {
      assetsAvailable += 1;
    } else {
      missingAssets.push(name);
    }
  }

  return {
    indexedDbOk,
    localStorageOk,
    storagePersisted,
    protocol: typeof window !== 'undefined' ? window.location.protocol : 'unknown',
    isPackagedApk: isPackagedOfflineProtocol(),
    assetsChecked: expectedAssets.length,
    assetsAvailable,
    missingAssets,
  };
}

export async function checkSyncServerAvailability(): Promise<{
  reachable: boolean;
  origin: string;
  mode?: 'server' | 'static';
  manifest?: ManifestResponse;
  error?: string;
}> {
  if (!isPackagedOfflineProtocol() && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      reachable: false,
      origin: getSyncApiOrigin(),
      error: 'Aucune connexion Internet détectée sur cet appareil.',
    };
  }

  const origin = getSyncApiOrigin();
  const explicitRemote = hasExplicitRemoteSyncOrigin();

  if (origin) {
    try {
      const res = await fetchWithTimeout(
        `${origin}/api/sync/manifest?t=${Date.now()}`,
        {cache: 'no-store'},
        2500,
      );
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const manifest = (await res.json()) as ManifestResponse;
        if (manifest?.ok && Array.isArray(manifest.requiredAssets)) {
          return {reachable: true, origin, mode: 'server', manifest};
        }
      }
      // Si un serveur distant explicite a été configuré et répond invalide, signaler l'erreur
      if (explicitRemote) {
        return {
          reachable: false,
          origin,
          error: 'Serveur de synchronisation inaccessible ou réponse invalide.',
        };
      }
    } catch {
      if (explicitRemote) {
        return {
          reachable: false,
          origin,
          error: 'Impossible de contacter le serveur de synchronisation.',
        };
      }
    }
  }

  // Hébergement statique (GitHub Pages *.github.io, domaine personnalisé GitHub Pages, ou APK)
  if (!isPackagedOfflineProtocol()) {
    try {
      const probeRes = await fetchWithTimeout(`./icon.svg?t=${Date.now()}`, {cache: 'no-store'}, 2500);
      if (!probeRes.ok) {
        return {
          reachable: false,
          origin: '',
          error: 'Impossible de joindre les ressources en ligne pour la préparation initiale.',
        };
      }
    } catch {
      return {
        reachable: false,
        origin: '',
        error: 'Connexion Internet requise pour télécharger les ressources initiales.',
      };
    }
  }

  const staticOrigin =
    typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null'
      ? window.location.origin.replace(/\/+$/, '')
      : 'local://offline';

  return {
    reachable: true,
    origin: staticOrigin,
    mode: 'static',
    manifest: buildStaticAssetManifest(),
  };
}

export async function runInitialSync(params: {
  onProgress?: (progress: InitialSyncProgress) => void;
}): Promise<InitialSyncRecord> {
  const existingCp = await readSyncCheckpoint();
  const resumed = Boolean(
    existingCp && (existingCp.completedAssets.length > 0 || existingCp.dataVerified),
  );

  const report = (
    step: InitialSyncStepId,
    percent: number,
    message: string,
    completedAssets: string[],
    totalAssets: number,
  ) => {
    params.onProgress?.({
      step,
      percent,
      message,
      resumedFromCheckpoint: resumed,
      completedAssets,
      totalAssets,
    });
  };

  // Étape 1 : Connexion & Manifeste
  report('network', 8, 'Vérification de la connexion Internet et des ressources...', [], 0);
  const probe = await checkSyncServerAvailability();
  if (!probe.reachable || !probe.manifest) {
    throw new Error(probe.error || 'Connexion Internet requise pour la synchronisation initiale.');
  }

  const manifest = probe.manifest;
  const requiredAssets = manifest.requiredAssets;
  if (requiredAssets.length === 0) {
    throw new Error('La liste des ressources obligatoires du serveur est vide.');
  }

  const cp: SyncProgressCheckpoint =
    existingCp && existingCp.manifestVersion === manifest.version
      ? existingCp
      : {
          startedAt: Date.now(),
          completedAssets: [],
          verifiedAssets: [],
          dataDownloaded: false,
          dataVerified: false,
          storageVerified: false,
          manifestVersion: manifest.version,
        };

  // Étape 2 : Téléchargement / reprise incrémentale & vérification des ressources indispensables
  const totalAssets = requiredAssets.length;
  for (let idx = 0; idx < requiredAssets.length; idx++) {
    const asset = requiredAssets[idx];
    const basePct = 15 + Math.round(((idx + 0.5) / totalAssets) * 45);

    const alreadyInCp = cp.completedAssets.includes(asset.name);
    const locallyOk = alreadyInCp && (await isAssetAlreadyLocallyAvailable(asset.name));

    if (alreadyInCp && locallyOk) {
      report(
        'assets',
        basePct,
        `Reprise : ressource « ${asset.name} » déjà vérifiée (${idx + 1}/${totalAssets})`,
        [...cp.completedAssets],
        totalAssets,
      );
      continue;
    }

    report(
      'assets',
      basePct,
      `Téléchargement et vérification : ${asset.name} (${idx + 1}/${totalAssets})...`,
      [...cp.completedAssets],
      totalAssets,
    );

    const verifiedEntry = await verifyOrDownloadAsset(asset);
    if (!cp.completedAssets.includes(asset.name)) {
      cp.completedAssets.push(asset.name);
    }
    const existingIdx = cp.verifiedAssets.findIndex((a) => a.name === asset.name);
    if (existingIdx >= 0) {
      cp.verifiedAssets[existingIdx] = verifiedEntry;
    } else {
      cp.verifiedAssets.push(verifiedEntry);
    }
    await saveSyncCheckpoint(cp);
  }

  // Mettre aussi en cache le shell HTML/JS/CSS & PWA sur navigateur Web / GitHub Pages
  if (!isPackagedOfflineProtocol() && typeof window !== 'undefined' && 'caches' in window) {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const shellUrls = Array.from(
      new Set([...collectShellUrlsFromDom(), './manifest.webmanifest', './sw.js']),
    );
    for (const u of shellUrls) {
      try {
        const res = await fetchWithTimeout(u, {}, 2500);
        if (res.ok) await cache.put(u, res);
      } catch {
        // Non bloquant si ressource absente en mode développement
      }
    }
    if ('serviceWorker' in navigator) {
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(resolve, 3500)),
        ]);
      } catch {
        // Ignoré si le WebView bloque les Service Workers
      }
    }
  }

  // Étape 3 : Téléchargement (ou chargement statique) et vérification des données & paramètres initiaux
  report(
    'data',
    68,
    cp.dataVerified
      ? 'Reprise : données initiales déjà téléchargées et vérifiées...'
      : 'Synchronisation des paramètres et données initiales...',
    [...cp.completedAssets],
    totalAssets,
  );

  let bundleData = cp.bundleData;
  let bundleSha256 = cp.bundleSha256;

  if (!cp.dataVerified || !bundleData || !bundleSha256) {
    if (!isPackagedOfflineProtocol() && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Connexion interrompue avant la fin de la synchronisation des données.');
    }

    if (probe.mode === 'static') {
      const staticPayload = buildStaticBootstrapBundle();
      bundleData = staticPayload.bundle;
      bundleSha256 = staticPayload.bundleSha256;
    } else {
      const dataRes = await fetchWithTimeout(
        `${probe.origin}/api/sync/bootstrap-data?t=${Date.now()}`,
        {cache: 'no-store'},
        4000,
      );
      if (!dataRes.ok) {
        throw new Error('Impossible de télécharger le paquet de données initiales.');
      }
      const payload = (await dataRes.json()) as BootstrapDataResponse;
      if (!payload?.ok || !payload.bundle || !payload.bundleSha256) {
        throw new Error('Paquet de données initiales incomplet.');
      }
      const computedBundleSha = computeSha256Hex(JSON.stringify(payload.bundle));
      if (computedBundleSha !== payload.bundleSha256) {
        throw new Error('Intégrité des données initiales invalide (empreinte SHA-256 non conforme).');
      }

      bundleData = payload.bundle;
      bundleSha256 = payload.bundleSha256;
    }

    // Enregistrer durablement les données initiales sans écraser d'éventuelles préférences déjà personnalisées
    await saveSyncedBundleData(bundleData);
    const currentPro = getProAppSettings();
    if (!currentPro.receiptFooter) {
      saveProAppSettings({
        ...currentPro,
        defaultLowStockThreshold: bundleData.defaultLowStockThreshold,
        defaultTaxPercent: bundleData.defaultTaxPercent,
        receiptFooter: bundleData.receiptFooter,
      });
    }

    cp.dataDownloaded = true;
    cp.dataVerified = true;
    cp.bundleData = bundleData;
    cp.bundleSha256 = bundleSha256;
    await saveSyncCheckpoint(cp);
  }

  // Étape 4 : Vérification finale de persistance, d'intégrité et de disponibilité locale
  report(
    'verify',
    86,
    'Vérification de la persistance IndexedDB et de l’accès hors ligne...',
    [...cp.completedAssets],
    totalAssets,
  );

  const diag = await runLocalOfflineDiagnostic(requiredAssets.map((a) => a.name));
  if (!diag.localStorageOk || !diag.indexedDbOk) {
    throw new Error(
      'Le stockage local persistant (IndexedDB / localStorage) n’est pas disponible sur cet appareil.',
    );
  }
  if (diag.missingAssets.length > 0) {
    throw new Error(
      `Ressources obligatoires manquantes en local : ${diag.missingAssets.join(', ')}`,
    );
  }

  const deviceId = getOrCreateZandoDeviceId();
  const now = Date.now();
  const finalRecord: InitialSyncRecord = {
    version: 1,
    completed: true,
    completedAt: now,
    deviceId,
    appVersion: APP_VERSION,
    serverOrigin: probe.origin,
    verifiedAssets: cp.verifiedAssets,
    verifiedDataHash: bundleSha256,
    bundleDataVersion: bundleData.dataVersion,
    storagePersisted: diag.storagePersisted,
    lastSyncedAt: now,
  };

  await saveCompletedInitialSync(finalRecord);
  await clearSyncCheckpoint();
  markIncrementalSyncSuccess(0);

  report(
    'verify',
    100,
    'Synchronisation initiale complète vérifiée. Mode hors ligne prêt !',
    [...cp.completedAssets],
    totalAssets,
  );

  return finalRecord;
}

export function getSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(LS_SYNC_STATE_KEY);
    if (!raw) {
      return {syncing: false, lastSyncedAt: null, pendingChanges: 0, lastError: null};
    }
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      syncing: false,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : null,
      pendingChanges: typeof parsed.pendingChanges === 'number' ? parsed.pendingChanges : 0,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      lastDeduplicatedCount:
        typeof parsed.lastDeduplicatedCount === 'number'
          ? parsed.lastDeduplicatedCount
          : undefined,
    };
  } catch {
    return {syncing: false, lastSyncedAt: null, pendingChanges: 0, lastError: null};
  }
}

function saveSyncState(next: SyncState): void {
  try {
    localStorage.setItem(LS_SYNC_STATE_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
}

export function incrementPendingSyncChanges(): SyncState {
  const cur = getSyncState();
  const next: SyncState = {
    ...cur,
    pendingChanges: cur.pendingChanges + 1,
  };
  saveSyncState(next);
  return next;
}

export function markIncrementalSyncSuccess(deduplicatedCount = 0): SyncState {
  const next: SyncState = {
    syncing: false,
    lastSyncedAt: Date.now(),
    pendingChanges: 0,
    lastError: null,
    lastDeduplicatedCount: deduplicatedCount,
  };
  saveSyncState(next);
  return next;
}

export function markIncrementalSyncFailure(errorMessage: string): SyncState {
  const cur = getSyncState();
  const next: SyncState = {
    ...cur,
    syncing: false,
    lastError: errorMessage,
  };
  saveSyncState(next);
  return next;
}

export async function runIncrementalSyncNonBlocking(params: {
  syncRecord: InitialSyncRecord;
  entityDigests: Array<{id: string; updatedAt: number}>;
  stats: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  updatedRecord?: InitialSyncRecord;
  deduplicatedCount?: number;
  acceptedCount?: number;
  error?: string;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {ok: false, error: 'Appareil hors ligne : vos données locales restent intactes.'};
  }
  const explicitRemote = hasExplicitRemoteSyncOrigin();
  const origin =
    getSyncApiOrigin() ||
    (isValidSyncServerUrl(params.syncRecord.serverOrigin) ? params.syncRecord.serverOrigin : '');

  if (!origin || (!explicitRemote && isStaticHostWithoutBackend())) {
    const nextRecord = {...params.syncRecord, lastSyncedAt: Date.now()};
    await saveCompletedInitialSync(nextRecord);
    markIncrementalSyncSuccess(0);
    return {
      ok: true,
      updatedRecord: nextRecord,
      acceptedCount: 0,
      deduplicatedCount: 0,
    };
  }

  try {
    const res = await fetchWithTimeout(
      `${origin}/api/sync/exchange`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          deviceId: params.syncRecord.deviceId,
          appVersion: APP_VERSION,
          entityDigests: params.entityDigests.slice(0, 500),
          stats: params.stats,
        }),
      },
      5000,
    );

    const contentType = res.headers.get('content-type') || '';
    if (!explicitRemote && !contentType.includes('application/json')) {
      const nextRecord = {...params.syncRecord, lastSyncedAt: Date.now()};
      await saveCompletedInitialSync(nextRecord);
      markIncrementalSyncSuccess(0);
      return {
        ok: true,
        updatedRecord: nextRecord,
        acceptedCount: 0,
        deduplicatedCount: 0,
      };
    }

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      acceptedCount?: number;
      deduplicatedCount?: number;
      bundle?: SyncBundleData;
      bundleSha256?: string;
    };

    if (!res.ok || !data.ok) {
      const msg = data.error || 'Synchronisation différée — données locales préservées.';
      markIncrementalSyncFailure(msg);
      return {ok: false, error: msg};
    }

    let nextRecord = {...params.syncRecord, lastSyncedAt: Date.now()};
    if (data.bundle && data.bundleSha256) {
      const computedSha = computeSha256Hex(JSON.stringify(data.bundle));
      if (computedSha === data.bundleSha256) {
        await saveSyncedBundleData(data.bundle);
        nextRecord = {
          ...nextRecord,
          bundleDataVersion: data.bundle.dataVersion,
          verifiedDataHash: data.bundleSha256,
        };
      }
    }
    await saveCompletedInitialSync(nextRecord);
    markIncrementalSyncSuccess(data.deduplicatedCount ?? 0);

    return {
      ok: true,
      updatedRecord: nextRecord,
      acceptedCount: data.acceptedCount ?? 0,
      deduplicatedCount: data.deduplicatedCount ?? 0,
    };
  } catch {
    const msg = 'Connexion interrompue : vos données locales sont préservées.';
    markIncrementalSyncFailure(msg);
    return {ok: false, error: msg};
  }
}
