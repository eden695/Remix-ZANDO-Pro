import {
  APP_VERSION,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_STORE_PROFILE,
  openZandoDB,
  STORES,
} from '../db/indexedDb';
import {
  BackupSerializedBlob,
  CollaboratorPresetRole,
  CreditTransaction,
  Customer,
  Expense,
  MediaBlobRecord,
  Order,
  Product,
  Promotion,
  Sale,
  SavedCatalog,
  SchemaMeta,
  StorePermissions,
  StoreProfile,
  StoreSlot,
  StoreTransferEnvelope,
  ZandoBackupPayload,
} from '../types/commerce';
import {generateId} from '../utils/format';
import {validateBackupJson} from './backupService';
import {blobToDataUrl, clearAllCachedUrls, dataUrlToBlob} from './mediaService';
import {isStaticHostWithoutBackend} from './onlineCatalogService';
import {
  base64ToBytes,
  bytesToBase64,
  decryptForZandoReceiver,
  encryptForZandoReceiver,
} from './securityService';

export const ZANDO_ID_REGEX = /^ZND-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export const DEFAULT_OWNER_PERMISSIONS: StorePermissions = {
  canManageProducts: true,
  canRecordSales: true,
  canManageOrders: true,
  canManageCustomersCredits: true,
  canViewFinances: true,
  canManageCatalogs: true,
  canManageSettings: true,
};

export function getPresetPermissions(preset: CollaboratorPresetRole): StorePermissions {
  if (preset === 'manager') {
    return {
      canManageProducts: true,
      canRecordSales: true,
      canManageOrders: true,
      canManageCustomersCredits: true,
      canViewFinances: true,
      canManageCatalogs: true,
      canManageSettings: false,
    };
  }
  if (preset === 'viewer') {
    return {
      canManageProducts: false,
      canRecordSales: false,
      canManageOrders: false,
      canManageCustomersCredits: false,
      canViewFinances: true,
      canManageCatalogs: false,
      canManageSettings: false,
    };
  }
  // 'seller' par défaut
  return {
    canManageProducts: false,
    canRecordSales: true,
    canManageOrders: true,
    canManageCustomersCredits: true,
    canViewFinances: false,
    canManageCatalogs: true,
    canManageSettings: false,
  };
}

export function getCollaboratorRoleLabel(preset: CollaboratorPresetRole): string {
  if (preset === 'manager') return 'Gérant complet';
  if (preset === 'viewer') return 'Consultation seule';
  if (preset === 'custom') return 'Droits personnalisés';
  return 'Vendeur / Caissier';
}

export function normalizeZandoId(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidZandoId(raw: string): boolean {
  return ZANDO_ID_REGEX.test(normalizeZandoId(raw));
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function exportStoreDatabaseSnapshot(dbName: string): Promise<ZandoBackupPayload> {
  const db = await openZandoDB(dbName);
  const allStores = Object.values(STORES);
  const tx = db.transaction(allStores, 'readonly');

  const [
    profiles,
    mediaBlobs,
    products,
    promotions,
    customers,
    sales,
    orders,
    catalogs,
    expenses,
    creditTransactions,
  ] = await Promise.all([
    idbReq<StoreProfile[]>(tx.objectStore(STORES.STORE_PROFILE).getAll()),
    idbReq<MediaBlobRecord[]>(tx.objectStore(STORES.MEDIA_BLOBS).getAll()),
    idbReq<Product[]>(tx.objectStore(STORES.PRODUCTS).getAll()),
    idbReq<Promotion[]>(tx.objectStore(STORES.PROMOTIONS).getAll()),
    idbReq<Customer[]>(tx.objectStore(STORES.CUSTOMERS).getAll()),
    idbReq<Sale[]>(tx.objectStore(STORES.SALES).getAll()),
    idbReq<Order[]>(tx.objectStore(STORES.ORDERS).getAll()),
    idbReq<SavedCatalog[]>(tx.objectStore(STORES.CATALOGS).getAll()),
    idbReq<Expense[]>(tx.objectStore(STORES.EXPENSES).getAll()),
    idbReq<CreditTransaction[]>(tx.objectStore(STORES.CREDIT_TRANSACTIONS).getAll()),
  ]);

  const serializedBlobs: BackupSerializedBlob[] = [];
  for (const media of mediaBlobs) {
    try {
      const dataUrl = await blobToDataUrl(media.blob);
      serializedBlobs.push({
        id: media.id,
        mimeType: media.mimeType,
        width: media.width,
        height: media.height,
        originalSize: media.originalSize,
        compressedSize: media.compressedSize,
        createdAt: media.createdAt,
        dataUrl,
      });
    } catch {
      // Ignore unreadable individual blob
    }
  }

  return {
    format: 'zando-pro-backup',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    storeProfile: profiles[0] ?? DEFAULT_STORE_PROFILE,
    products,
    promotions,
    customers,
    sales,
    orders,
    catalogs,
    expenses,
    creditTransactions,
    mediaBlobs: serializedBlobs,
  };
}

export async function restoreBackupPayloadToDatabase(
  dbName: string,
  payload: ZandoBackupPayload,
  labelDescription: string,
): Promise<void> {
  const db = await openZandoDB(dbName);
  clearAllCachedUrls();

  const hydratedBlobs: MediaBlobRecord[] = [];
  for (const item of payload.mediaBlobs) {
    try {
      const blob = dataUrlToBlob(item.dataUrl);
      hydratedBlobs.push({
        id: item.id,
        blob,
        mimeType: item.mimeType || blob.type || 'image/jpeg',
        width: item.width || 600,
        height: item.height || 600,
        originalSize: item.originalSize || blob.size,
        compressedSize: blob.size,
        createdAt: item.createdAt || Date.now(),
      });
    } catch {
      // Skip corrupted media item
    }
  }

  const storeNames = [
    STORES.STORE_PROFILE,
    STORES.MEDIA_BLOBS,
    STORES.PRODUCTS,
    STORES.PROMOTIONS,
    STORES.CUSTOMERS,
    STORES.SALES,
    STORES.ORDERS,
    STORES.CATALOGS,
    STORES.EXPENSES,
    STORES.CREDIT_TRANSACTIONS,
    STORES.SCHEMA_META,
  ];

  const tx = db.transaction(storeNames, 'readwrite');
  for (const storeName of storeNames) {
    if (storeName !== STORES.SCHEMA_META) {
      tx.objectStore(storeName).clear();
    }
  }

  tx.objectStore(STORES.STORE_PROFILE).put({
    ...DEFAULT_STORE_PROFILE,
    ...payload.storeProfile,
    id: 'default',
    updatedAt: Date.now(),
  });

  for (const blobRec of hydratedBlobs) tx.objectStore(STORES.MEDIA_BLOBS).put(blobRec);
  for (const p of payload.products) tx.objectStore(STORES.PRODUCTS).put(p);
  for (const promo of payload.promotions) tx.objectStore(STORES.PROMOTIONS).put(promo);
  for (const cust of payload.customers) tx.objectStore(STORES.CUSTOMERS).put(cust);
  for (const sale of payload.sales) tx.objectStore(STORES.SALES).put(sale);
  for (const order of payload.orders) tx.objectStore(STORES.ORDERS).put(order);
  for (const cat of payload.catalogs) tx.objectStore(STORES.CATALOGS).put(cat);
  for (const exp of payload.expenses ?? []) tx.objectStore(STORES.EXPENSES).put(exp);
  for (const crd of payload.creditTransactions ?? []) {
    tx.objectStore(STORES.CREDIT_TRANSACTIONS).put(crd);
  }

  const metaStore = tx.objectStore(STORES.SCHEMA_META);
  const existingMetaReq = metaStore.get('schema');
  existingMetaReq.onsuccess = () => {
    const prev = existingMetaReq.result as SchemaMeta | undefined;
    metaStore.put({
      id: 'schema',
      currentVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      lastUpdatedAt: Date.now(),
      lastBackupAt: payload.exportedAt,
      migrations: [
        ...(prev?.migrations ?? []),
        {
          version: CURRENT_SCHEMA_VERSION,
          appliedAt: Date.now(),
          description: labelDescription,
        },
      ],
    } satisfies SchemaMeta);
  };

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Erreur lors de l’importation de la boutique.'));
  });
}

interface InnerTransferPayload {
  backupPayload: ZandoBackupPayload;
  permissions?: StorePermissions;
  ownerZandoId: string;
  collaboratorName?: string;
}

export async function buildStoreTransferPackage(params: {
  slot: StoreSlot;
  kind: 'sale' | 'collaboration';
  senderZandoId: string;
  receiverZandoId: string;
  receiverName?: string;
  salePrice?: string;
  note?: string;
  permissions?: StorePermissions;
}): Promise<{envelope: StoreTransferEnvelope; blob: Blob; filename: string; transferCode: string}> {
  const receiverId = normalizeZandoId(params.receiverZandoId);
  if (!isValidZandoId(receiverId)) {
    throw new Error('Identifiant ZANDO invalide (format attendu : ZND-XXXX-YYYY).');
  }

  const backupPayload = await exportStoreDatabaseSnapshot(params.slot.dbName);
  const inner: InnerTransferPayload = {
    backupPayload,
    permissions: params.kind === 'collaboration' ? params.permissions : DEFAULT_OWNER_PERMISSIONS,
    ownerZandoId: params.senderZandoId,
    collaboratorName: params.receiverName?.trim() || undefined,
  };

  const encrypted = await encryptForZandoReceiver(JSON.stringify(inner), receiverId);
  const envelope: StoreTransferEnvelope = {
    format: 'zando-pro-store-transfer',
    version: 1,
    transferId: generateId('trf'),
    kind: params.kind,
    senderZandoId: params.senderZandoId,
    receiverZandoId: receiverId,
    receiverName: params.receiverName?.trim() || undefined,
    storeName: backupPayload.storeProfile.name || params.slot.name,
    salePrice: params.salePrice?.trim() || undefined,
    note: params.note?.trim() || undefined,
    permissions: params.kind === 'collaboration' ? params.permissions : undefined,
    createdAt: Date.now(),
    alg: encrypted.alg,
    salt: encrypted.salt,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };

  const jsonText = JSON.stringify(envelope, null, 2);
  const ext = params.kind === 'sale' ? 'zando-boutique' : 'zando-collab';
  const safeName =
    (envelope.storeName || 'boutique')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'boutique';
  const filename = `${safeName}-${receiverId.toLowerCase()}.${ext}`;
  const blob = new Blob([jsonText], {type: 'application/json;charset=utf-8'});

  const compactJson = JSON.stringify(envelope);
  const transferCode = `ZANDO-TR1:${bytesToBase64(new TextEncoder().encode(compactJson))}`;

  return {envelope, blob, filename, transferCode};
}

export function parseTransferInput(rawInput: string): StoreTransferEnvelope {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Aucun code ou fichier de transfert fourni.');
  }

  let jsonText = trimmed;
  if (trimmed.startsWith('ZANDO-TR1:')) {
    try {
      const b64 = trimmed.slice('ZANDO-TR1:'.length).trim();
      jsonText = new TextDecoder().decode(base64ToBytes(b64));
    } catch {
      throw new Error('Code de transfert ZANDO invalide ou tronqué.');
    }
  }

  let parsed: Partial<StoreTransferEnvelope>;
  try {
    parsed = JSON.parse(jsonText) as Partial<StoreTransferEnvelope>;
  } catch {
    throw new Error('Format de transfert non reconnu.');
  }

  if (parsed.format !== 'zando-pro-store-transfer' || !parsed.ciphertext || !parsed.receiverZandoId) {
    throw new Error('Ce fichier ou code n’est pas un transfert officiel de boutique ZANDO Pro.');
  }

  return parsed as StoreTransferEnvelope;
}

export async function decryptStoreTransferEnvelope(
  envelope: StoreTransferEnvelope,
  myZandoId: string,
): Promise<{
  envelope: StoreTransferEnvelope;
  backupPayload: ZandoBackupPayload;
  permissions: StorePermissions;
  ownerZandoId: string;
  collaboratorName?: string;
}> {
  const normalizedMine = normalizeZandoId(myZandoId);
  if (normalizeZandoId(envelope.receiverZandoId) !== normalizedMine) {
    throw new Error(
      `Ce paquet est chiffré exclusivement pour l’identifiant ${envelope.receiverZandoId} (votre identifiant est ${normalizedMine}).`,
    );
  }

  const plainJson = await decryptForZandoReceiver(envelope, normalizedMine);
  const inner = JSON.parse(plainJson) as InnerTransferPayload;
  const validatedBackup = validateBackupJson(JSON.stringify(inner.backupPayload));

  return {
    envelope,
    backupPayload: validatedBackup,
    permissions: inner.permissions || envelope.permissions || DEFAULT_OWNER_PERMISSIONS,
    ownerZandoId: inner.ownerZandoId || envelope.senderZandoId,
    collaboratorName: inner.collaboratorName || envelope.receiverName,
  };
}

function getTransferApiOrigin(): string {
  const customApi = (import.meta.env.VITE_CATALOG_API_URL as string | undefined)?.trim();
  return customApi ? customApi.replace(/\/+$/, '') : '';
}

export async function pushTransferOnline(
  envelope: StoreTransferEnvelope,
): Promise<{ok: boolean; error?: string}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {ok: false, error: 'Hors ligne : utilisez l’envoi de fichier ou le code hors ligne.'};
  }
  if (isStaticHostWithoutBackend()) {
    return {
      ok: false,
      error: 'Relais serveur indisponible sur cet hébergement statique : partagez le fichier ou code hors ligne.',
    };
  }
  try {
    const res = await fetch(`${getTransferApiOrigin()}/api/transfers`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(envelope),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return {ok: false, error: 'Le serveur de transfert n’a pas répondu.'};
    }
    return {ok: true};
  } catch {
    return {ok: false, error: 'Connexion au relais impossible.'};
  }
}

export async function fetchPendingTransfersOnline(
  myZandoId: string,
): Promise<{ok: boolean; transfers: StoreTransferEnvelope[]; error?: string}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {ok: false, transfers: [], error: 'Vous êtes hors ligne.'};
  }
  if (isStaticHostWithoutBackend()) {
    return {
      ok: false,
      transfers: [],
      error: 'Hébergement statique sans relais serveur : importez le fichier ou collez le code reçu.',
    };
  }
  try {
    const res = await fetch(
      `${getTransferApiOrigin()}/api/transfers/${encodeURIComponent(normalizeZandoId(myZandoId))}?t=${Date.now()}`,
      {cache: 'no-store'},
    );
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return {ok: false, transfers: [], error: 'Réponse serveur invalide.'};
    }
    const data = (await res.json()) as {transfers?: StoreTransferEnvelope[]};
    return {ok: true, transfers: Array.isArray(data.transfers) ? data.transfers : []};
  } catch {
    return {ok: false, transfers: [], error: 'Impossible de joindre le serveur de transfert.'};
  }
}

export async function acknowledgeTransferOnline(
  myZandoId: string,
  transferId: string,
): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    navigator.onLine === false ||
    isStaticHostWithoutBackend()
  ) {
    return;
  }
  try {
    await fetch(
      `${getTransferApiOrigin()}/api/transfers/${encodeURIComponent(normalizeZandoId(myZandoId))}/${encodeURIComponent(transferId)}`,
      {method: 'DELETE'},
    );
  } catch {
    // Best-effort cleanup
  }
}
