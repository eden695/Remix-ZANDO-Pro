import {
  AppMode,
  AssistantMessage,
  CreditTransaction,
  Customer,
  Expense,
  MediaBlobRecord,
  MigrationRecord,
  Order,
  Product,
  Promotion,
  Sale,
  SavedCatalog,
  SchemaMeta,
  StoreProfile,
  StoreSlot,
} from '../types/commerce';
import {generateId} from '../utils/format';

export const REAL_DB_NAME = 'zando_pro_local_db';
export const DEMO_DB_NAME = 'zando_pro_demo_db';
export const CURRENT_SCHEMA_VERSION = 2;
export const APP_VERSION = '2.1.0';
export const MAX_STORES = 3;

const APP_MODE_KEY = 'zando_pro_app_mode';
const STORE_SLOTS_KEY = 'zando_pro_store_slots_v1';
const ACTIVE_STORE_ID_KEY = 'zando_pro_active_store_id_v1';

export const STORES = {
  STORE_PROFILE: 'storeProfile',
  MEDIA_BLOBS: 'mediaBlobs',
  PRODUCTS: 'products',
  PROMOTIONS: 'promotions',
  CUSTOMERS: 'customers',
  SALES: 'sales',
  ORDERS: 'orders',
  CATALOGS: 'catalogs',
  EXPENSES: 'expenses',
  CREDIT_TRANSACTIONS: 'creditTransactions',
  ASSISTANT_MESSAGES: 'assistantMessages',
  SCHEMA_META: 'schemaMeta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export const DEFAULT_STORE_PROFILE: StoreProfile = {
  id: 'default',
  name: 'Ma Boutique',
  description: 'Produits de qualité disponibles sur commande WhatsApp et en boutique.',
  phone: '',
  email: '',
  address: '',
  currency: 'FCFA',
  primaryColor: '#0F172A',
  accentColor: '#059669',
  themeMode: 'light',
  layoutMode: 'grid',
  instagramHandle: '',
  facebookPage: '',
  tiktokHandle: '',
  updatedAt: Date.now(),
};

const MIGRATION_DESCRIPTIONS: Record<number, string> = {
  1: 'Initialisation du schéma Offline-First (produits, médias Blob, ventes, commandes, clients, promotions, catalogues autonomes).',
  2: 'Extension financière v2 : dépenses, journal immuable des crédits/avances clients et historique de l’assistant local.',
};

const dbCache = new Map<string, Promise<IDBDatabase>>();

const DEFAULT_SLOT: StoreSlot = {
  id: 'store_1',
  dbName: REAL_DB_NAME,
  name: 'Boutique Principale',
  currency: 'FCFA',
  createdAt: 0,
};

export function getStoreSlots(): StoreSlot[] {
  try {
    const raw = localStorage.getItem(STORE_SLOTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, MAX_STORES);
      }
    }
  } catch {
    // Fallback to default slot
  }
  const initial = [{...DEFAULT_SLOT, createdAt: Date.now()}];
  try {
    localStorage.setItem(STORE_SLOTS_KEY, JSON.stringify(initial));
  } catch {
    // Ignore storage quota error
  }
  return initial;
}

function saveStoreSlots(slots: StoreSlot[]): void {
  try {
    localStorage.setItem(STORE_SLOTS_KEY, JSON.stringify(slots.slice(0, MAX_STORES)));
  } catch {
    // Ignore storage restriction
  }
}

export function getActiveStoreId(): string {
  const slots = getStoreSlots();
  try {
    const stored = localStorage.getItem(ACTIVE_STORE_ID_KEY);
    if (stored && slots.some((s) => s.id === stored)) {
      return stored;
    }
  } catch {
    // Ignore
  }
  return slots[0].id;
}

export function setActiveStoreId(id: string): void {
  const slots = getStoreSlots();
  if (!slots.some((s) => s.id === id)) return;
  try {
    localStorage.setItem(ACTIVE_STORE_ID_KEY, id);
  } catch {
    // Ignore
  }
}

export function getActiveStoreSlot(): StoreSlot {
  const slots = getStoreSlots();
  const activeId = getActiveStoreId();
  return slots.find((s) => s.id === activeId) ?? slots[0];
}

export function createStoreSlot(name: string, currency = 'FCFA'): StoreSlot {
  const slots = getStoreSlots();
  if (slots.length >= MAX_STORES) {
    throw new Error(`Limite maximale atteinte : vous pouvez ouvrir jusqu’à ${MAX_STORES} boutiques.`);
  }
  const usedIds = new Set(slots.map((s) => s.id));
  let slotNumber = 2;
  while (usedIds.has(`store_${slotNumber}`) && slotNumber <= MAX_STORES + 2) {
    slotNumber += 1;
  }
  const id = `store_${slotNumber}`;
  const dbName = `${REAL_DB_NAME}_${slotNumber}`;
  const newSlot: StoreSlot = {
    id,
    dbName,
    name: name.trim() || `Boutique ${slotNumber}`,
    currency,
    createdAt: Date.now(),
  };
  const next = [...slots, newSlot];
  saveStoreSlots(next);
  setActiveStoreId(newSlot.id);
  return newSlot;
}

export function updateStoreSlotMeta(id: string, name: string, currency: string): void {
  const slots = getStoreSlots();
  const next = slots.map((s) =>
    s.id === id
      ? {
          ...s,
          name: name.trim() || s.name,
          currency: currency || s.currency,
        }
      : s,
  );
  saveStoreSlots(next);
}

export async function deleteStoreSlot(id: string): Promise<string> {
  const slots = getStoreSlots();
  if (slots.length <= 1) {
    throw new Error('Vous devez conserver au moins une boutique active.');
  }
  const target = slots.find((s) => s.id === id);
  if (!target) {
    throw new Error('Boutique introuvable.');
  }
  await closeAndClearDbCache(target.dbName);
  const remaining = slots.filter((s) => s.id !== id);
  saveStoreSlots(remaining);
  const nextActiveId = remaining[0].id;
  setActiveStoreId(nextActiveId);

  if (typeof indexedDB !== 'undefined' && typeof indexedDB.deleteDatabase === 'function') {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(target.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
  return nextActiveId;
}

export function getStoredAppMode(): AppMode {
  try {
    const val = localStorage.getItem(APP_MODE_KEY);
    if (val === 'demo' || val === 'real') return val;
    return 'unset';
  } catch {
    return 'real';
  }
}

export function setStoredAppMode(mode: AppMode): void {
  try {
    if (mode === 'unset') {
      localStorage.removeItem(APP_MODE_KEY);
    } else {
      localStorage.setItem(APP_MODE_KEY, mode);
    }
  } catch {
    // Ignore storage restriction
  }
}

export function getActiveDatabaseName(): string {
  if (getStoredAppMode() === 'demo') return DEMO_DB_NAME;
  return getActiveStoreSlot().dbName;
}

function ensureStore(
  db: IDBDatabase,
  name: string,
  keyPath: string,
  indexes: Array<{name: string; keyPath: string; unique?: boolean}> = [],
) {
  if (!db.objectStoreNames.contains(name)) {
    const store = db.createObjectStore(name, {keyPath});
    for (const idx of indexes) {
      store.createIndex(idx.name, idx.keyPath, {unique: Boolean(idx.unique)});
    }
  }
}

export function openZandoDB(explicitDbName?: string): Promise<IDBDatabase> {
  const targetName = explicitDbName ?? getActiveDatabaseName();
  const existing = dbCache.get(targetName);
  if (existing) return existing;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB est indisponible dans cet environnement WebView.'));
      return;
    }

    const request = indexedDB.open(targetName, CURRENT_SCHEMA_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Version 1 stores
      if (oldVersion < 1) {
        ensureStore(db, STORES.STORE_PROFILE, 'id');
        ensureStore(db, STORES.MEDIA_BLOBS, 'id', [{name: 'createdAt', keyPath: 'createdAt'}]);
        ensureStore(db, STORES.PRODUCTS, 'id', [
          {name: 'category', keyPath: 'category'},
          {name: 'updatedAt', keyPath: 'updatedAt'},
        ]);
        ensureStore(db, STORES.PROMOTIONS, 'id', [{name: 'isActive', keyPath: 'isActive'}]);
        ensureStore(db, STORES.CUSTOMERS, 'id', [{name: 'phone', keyPath: 'phone'}]);
        ensureStore(db, STORES.SALES, 'id', [{name: 'createdAt', keyPath: 'createdAt'}]);
        ensureStore(db, STORES.ORDERS, 'id', [
          {name: 'status', keyPath: 'status'},
          {name: 'createdAt', keyPath: 'createdAt'},
        ]);
        ensureStore(db, STORES.CATALOGS, 'id', [{name: 'createdAt', keyPath: 'createdAt'}]);
        ensureStore(db, STORES.SCHEMA_META, 'id');
      }

      // Version 2 incremental migration: never deletes or alters existing user data
      if (oldVersion < 2) {
        ensureStore(db, STORES.EXPENSES, 'id', [
          {name: 'date', keyPath: 'date'},
          {name: 'category', keyPath: 'category'},
        ]);
        ensureStore(db, STORES.CREDIT_TRANSACTIONS, 'id', [
          {name: 'customerId', keyPath: 'customerId'},
          {name: 'createdAt', keyPath: 'createdAt'},
        ]);
        ensureStore(db, STORES.ASSISTANT_MESSAGES, 'id', [
          {name: 'createdAt', keyPath: 'createdAt'},
        ]);
      }
    };

    request.onsuccess = async () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbCache.delete(targetName);
      };
      try {
        await ensureSchemaMetaAndDefaults(db);
        requestPersistentStorage();
        resolve(db);
      } catch (err) {
        reject(err);
      }
    };

    request.onerror = () => {
      dbCache.delete(targetName);
      reject(request.error ?? new Error("Impossible d'ouvrir la base locale IndexedDB."));
    };
  });

  dbCache.set(targetName, promise);
  return promise;
}

export async function closeAndClearDbCache(dbName?: string): Promise<void> {
  if (dbName) {
    const p = dbCache.get(dbName);
    if (p) {
      const db = await p.catch(() => null);
      db?.close();
      dbCache.delete(dbName);
    }
    return;
  }
  for (const [key, p] of dbCache.entries()) {
    const db = await p.catch(() => null);
    db?.close();
    dbCache.delete(key);
  }
}

export async function hasExistingRealData(): Promise<boolean> {
  const db = await openZandoDB(REAL_DB_NAME);
  const tx = db.transaction(
    [STORES.PRODUCTS, STORES.SALES, STORES.CUSTOMERS, STORES.ORDERS, STORES.STORE_PROFILE],
    'readonly',
  );
  const [pCount, sCount, cCount, oCount, profiles] = await Promise.all([
    idbReq<number>(tx.objectStore(STORES.PRODUCTS).count()),
    idbReq<number>(tx.objectStore(STORES.SALES).count()),
    idbReq<number>(tx.objectStore(STORES.CUSTOMERS).count()),
    idbReq<number>(tx.objectStore(STORES.ORDERS).count()),
    idbReq<StoreProfile[]>(tx.objectStore(STORES.STORE_PROFILE).getAll()),
  ]);
  const prof = profiles[0];
  const customizedStore = Boolean(prof && prof.name && prof.name !== DEFAULT_STORE_PROFILE.name);
  return pCount > 0 || sCount > 0 || cCount > 0 || oCount > 0 || customizedStore;
}

export async function clearDatabaseStoreContents(dbName: string): Promise<void> {
  const db = await openZandoDB(dbName);
  const storesToClear = Object.values(STORES).filter((s) => s !== STORES.SCHEMA_META);
  const tx = db.transaction(storesToClear, 'readwrite');
  for (const s of storesToClear) {
    tx.objectStore(s).clear();
  }
  tx.objectStore(STORES.STORE_PROFILE).put({...DEFAULT_STORE_PROFILE, updatedAt: Date.now()});
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // WebView may not implement persist(), safely ignored
  }
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ensureSchemaMetaAndDefaults(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([STORES.SCHEMA_META, STORES.STORE_PROFILE], 'readwrite');
  const metaStore = tx.objectStore(STORES.SCHEMA_META);
  const profileStore = tx.objectStore(STORES.STORE_PROFILE);

  const existingMeta = await idbReq<SchemaMeta | undefined>(metaStore.get('schema'));
  const existingProfile = await idbReq<StoreProfile | undefined>(profileStore.get('default'));

  if (!existingProfile) {
    profileStore.put({...DEFAULT_STORE_PROFILE, updatedAt: Date.now()});
  }

  if (!existingMeta) {
    const migrations: MigrationRecord[] = [
      {
        version: 1,
        appliedAt: Date.now(),
        description: MIGRATION_DESCRIPTIONS[1],
      },
      {
        version: 2,
        appliedAt: Date.now(),
        description: MIGRATION_DESCRIPTIONS[2],
      },
    ];
    metaStore.put({
      id: 'schema',
      currentVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      lastUpdatedAt: Date.now(),
      migrations,
    } satisfies SchemaMeta);
  } else if (
    existingMeta.currentVersion < CURRENT_SCHEMA_VERSION ||
    existingMeta.appVersion !== APP_VERSION
  ) {
    const updatedMigrations = [...existingMeta.migrations];
    for (let v = existingMeta.currentVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      updatedMigrations.push({
        version: v,
        appliedAt: Date.now(),
        description: MIGRATION_DESCRIPTIONS[v] ?? `Migration vers schéma v${v}`,
      });
    }
    metaStore.put({
      ...existingMeta,
      currentVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      lastUpdatedAt: Date.now(),
      migrations: updatedMigrations,
    } satisfies SchemaMeta);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllFromStore<T>(storeName: StoreName): Promise<T[]> {
  const db = await openZandoDB();
  const tx = db.transaction(storeName, 'readonly');
  return idbReq<T[]>(tx.objectStore(storeName).getAll());
}

export async function getById<T>(storeName: StoreName, id: string): Promise<T | undefined> {
  const db = await openZandoDB();
  const tx = db.transaction(storeName, 'readonly');
  return idbReq<T | undefined>(tx.objectStore(storeName).get(id));
}

export async function putRecord<T>(storeName: StoreName, record: T): Promise<void> {
  const db = await openZandoDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function bulkPutProducts(products: Product[]): Promise<void> {
  const db = await openZandoDB();
  const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
  const store = tx.objectStore(STORES.PRODUCTS);
  for (const product of products) {
    store.put(product);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRecord(storeName: StoreName, id: string): Promise<void> {
  const db = await openZandoDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openZandoDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function recordSaleWithStockDeduction(sale: Sale): Promise<void> {
  const db = await openZandoDB();
  const tx = db.transaction(
    [STORES.SALES, STORES.PRODUCTS, STORES.CREDIT_TRANSACTIONS, STORES.CUSTOMERS],
    'readwrite',
  );
  const salesStore = tx.objectStore(STORES.SALES);
  const productStore = tx.objectStore(STORES.PRODUCTS);
  const creditStore = tx.objectStore(STORES.CREDIT_TRANSACTIONS);
  const customerStore = tx.objectStore(STORES.CUSTOMERS);

  const amountPaid = sale.amountPaid ?? sale.total;
  const remainingDebt = Math.max(0, sale.total - amountPaid);

  let resolvedCustomerId = sale.customerId;
  if (remainingDebt > 0 && !resolvedCustomerId) {
    resolvedCustomerId = generateId('cust');
    customerStore.put({
      id: resolvedCustomerId,
      name: sale.customerName || 'Client crédit',
      phone: sale.customerPhone || '',
      email: '',
      address: '',
      channel: sale.channel,
      notes: 'Créé automatiquement lors d’une vente à crédit',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies Customer);
  }

  const finalizedSale: Sale = {
    ...sale,
    customerId: resolvedCustomerId,
    amountPaid,
    paymentStatus:
      remainingDebt <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'credit',
    refundedAmount: sale.refundedAmount ?? 0,
  };

  salesStore.put(finalizedSale);

  for (const item of finalizedSale.items) {
    const product = await idbReq<Product | undefined>(productStore.get(item.productId));
    if (product) {
      productStore.put({
        ...product,
        stock: Math.max(0, product.stock - item.quantity),
        updatedAt: Date.now(),
      });
    }
  }

  // Record credit debt entry in immutable ledger when unpaid balance remains
  if (remainingDebt > 0 && resolvedCustomerId) {
    creditStore.put({
      id: generateId('crd'),
      customerId: resolvedCustomerId,
      customerName: finalizedSale.customerName,
      customerPhone: finalizedSale.customerPhone,
      type: 'credit_sale',
      amount: remainingDebt,
      direction: 'debt_increase',
      saleId: finalizedSale.id,
      receiptNumber: finalizedSale.receiptNumber,
      dueDate: finalizedSale.dueDate,
      note:
        amountPaid > 0
          ? `Reste dû sur vente ${finalizedSale.receiptNumber} (acompte versé : ${amountPaid})`
          : `Vente à crédit ${finalizedSale.receiptNumber}`,
      createdAt: finalizedSale.createdAt,
    } satisfies CreditTransaction);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function recordCreditLedgerEntry(entry: CreditTransaction): Promise<void> {
  const db = await openZandoDB();
  const tx = db.transaction([STORES.CREDIT_TRANSACTIONS, STORES.SALES], 'readwrite');
  const creditStore = tx.objectStore(STORES.CREDIT_TRANSACTIONS);
  const saleStore = tx.objectStore(STORES.SALES);

  creditStore.put(entry);

  if (entry.saleId) {
    const linkedSale = await idbReq<Sale | undefined>(saleStore.get(entry.saleId));
    if (linkedSale) {
      if (entry.type === 'partial_payment') {
        const currentPaid = linkedSale.amountPaid ?? linkedSale.total;
        const nextPaid = Math.min(linkedSale.total, currentPaid + entry.amount);
        saleStore.put({
          ...linkedSale,
          amountPaid: nextPaid,
          paymentStatus: nextPaid >= linkedSale.total ? 'paid' : 'partial',
        });
      } else if (entry.type === 'refund') {
        const currentRefunded = linkedSale.refundedAmount ?? 0;
        const nextRefunded = Math.min(linkedSale.total, currentRefunded + entry.amount);
        saleStore.put({
          ...linkedSale,
          refundedAmount: nextRefunded,
        });
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function convertOrderToSaleTransaction(order: Order, sale: Sale): Promise<Order> {
  const db = await openZandoDB();
  const tx = db.transaction([STORES.ORDERS, STORES.SALES, STORES.PRODUCTS], 'readwrite');
  const orderStore = tx.objectStore(STORES.ORDERS);
  const saleStore = tx.objectStore(STORES.SALES);
  const productStore = tx.objectStore(STORES.PRODUCTS);

  saleStore.put({
    ...sale,
    paymentStatus: 'paid',
    amountPaid: sale.total,
    refundedAmount: 0,
  });

  if (!order.stockDeducted) {
    for (const item of order.items) {
      const product = await idbReq<Product | undefined>(productStore.get(item.productId));
      if (product) {
        productStore.put({
          ...product,
          stock: Math.max(0, product.stock - item.quantity),
          updatedAt: Date.now(),
        });
      }
    }
  }

  const updatedOrder: Order = {
    ...order,
    status: 'delivered',
    stockDeducted: true,
    linkedSaleId: sale.id,
    updatedAt: Date.now(),
  };
  orderStore.put(updatedOrder);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return updatedOrder;
}

export interface StorageDiagnostic {
  databaseName: string;
  usageBytes: number;
  quotaBytes: number;
  isPersisted: boolean;
  counts: {
    products: number;
    sales: number;
    orders: number;
    customers: number;
    promotions: number;
    catalogs: number;
    expenses: number;
    creditTransactions: number;
    mediaBlobs: number;
  };
}

export async function getStorageDiagnostics(): Promise<StorageDiagnostic> {
  const databaseName = getActiveDatabaseName();
  const db = await openZandoDB(databaseName);
  let usageBytes = 0;
  let quotaBytes = 0;
  let isPersisted = false;

  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? 0;
      quotaBytes = est.quota ?? 0;
    }
    if (navigator.storage?.persisted) {
      isPersisted = await navigator.storage.persisted();
    }
  } catch {
    // Ignored on older WebViews
  }

  const storeNames: StoreName[] = [
    STORES.PRODUCTS,
    STORES.SALES,
    STORES.ORDERS,
    STORES.CUSTOMERS,
    STORES.PROMOTIONS,
    STORES.CATALOGS,
    STORES.EXPENSES,
    STORES.CREDIT_TRANSACTIONS,
    STORES.MEDIA_BLOBS,
  ];
  const tx = db.transaction(storeNames, 'readonly');
  const [
    products,
    sales,
    orders,
    customers,
    promotions,
    catalogs,
    expenses,
    creditTransactions,
    mediaBlobs,
  ] = await Promise.all(storeNames.map((name) => idbReq<number>(tx.objectStore(name).count())));

  return {
    databaseName,
    usageBytes,
    quotaBytes,
    isPersisted,
    counts: {
      products,
      sales,
      orders,
      customers,
      promotions,
      catalogs,
      expenses,
      creditTransactions,
      mediaBlobs,
    },
  };
}

export async function loadAllDomainData(): Promise<{
  storeProfile: StoreProfile;
  products: Product[];
  promotions: Promotion[];
  customers: Customer[];
  sales: Sale[];
  orders: Order[];
  catalogs: SavedCatalog[];
  expenses: Expense[];
  creditTransactions: CreditTransaction[];
  assistantMessages: AssistantMessage[];
  mediaBlobs: MediaBlobRecord[];
  schemaMeta: SchemaMeta;
}> {
  const db = await openZandoDB();
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
    assistantMessages,
    metas,
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
    idbReq<AssistantMessage[]>(tx.objectStore(STORES.ASSISTANT_MESSAGES).getAll()),
    idbReq<SchemaMeta[]>(tx.objectStore(STORES.SCHEMA_META).getAll()),
  ]);

  return {
    storeProfile: profiles[0] ?? DEFAULT_STORE_PROFILE,
    mediaBlobs,
    products: products.sort((a, b) => b.updatedAt - a.updatedAt),
    promotions: promotions.sort((a, b) => b.createdAt - a.createdAt),
    customers: customers.sort((a, b) => b.updatedAt - a.updatedAt),
    sales: sales.sort((a, b) => b.createdAt - a.createdAt),
    orders: orders.sort((a, b) => b.createdAt - a.createdAt),
    catalogs: catalogs.sort((a, b) => b.createdAt - a.createdAt),
    expenses: expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    creditTransactions: creditTransactions.sort((a, b) => b.createdAt - a.createdAt),
    assistantMessages: assistantMessages.sort((a, b) => a.createdAt - b.createdAt),
    schemaMeta: metas[0] ?? {
      id: 'schema',
      currentVersion: CURRENT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      lastUpdatedAt: Date.now(),
      migrations: [],
    },
  };
}
