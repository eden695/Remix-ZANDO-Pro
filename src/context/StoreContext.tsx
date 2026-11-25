import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
  bulkPutProducts,
  clearStore,
  closeAndClearDbCache,
  convertOrderToSaleTransaction,
  createStoreSlot,
  DEFAULT_STORE_PROFILE,
  deleteRecord,
  deleteStoreSlot,
  DEMO_DB_NAME,
  getActiveStoreId,
  getActiveStoreSlot,
  getCachedStoreProfileSnapshot,
  getStoredAppMode,
  getStoreSlots,
  isStoreSlotEmpty,
  loadAllDomainData,
  markSlotAsCollaborator,
  MAX_STORES,
  putRecord,
  recordCreditLedgerEntry,
  recordSaleWithStockDeduction,
  saveCachedStoreProfileSnapshot,
  setActiveStoreId,
  setStoredAppMode,
  STORES,
  updateStoreCollaborators,
  updateStoreSlotMeta,
} from '../db/indexedDb';
import {
  clearInitialSyncForResync,
  ensureOfflineFirstSyncRecord,
  ensureOfflineFirstSyncRecordFast,
  getSyncState,
  incrementPendingSyncChanges,
  readCompletedInitialSync,
  runIncrementalSyncNonBlocking,
  runInitialSync,
} from '../services/initialSyncService';
import {answerCommercialQuestion} from '../services/localAssistantService';
import {clearAllCachedUrls, deleteMediaBlob} from '../services/mediaService';
import {
  appendLocalNotification,
  buildDynamicStoreAlerts,
  getReadDynamicIds,
  getStoredNotifications,
  saveReadDynamicIds,
  saveStoredNotifications,
} from '../services/notificationService';
import {
  appendSecurityAudit,
  clearPinCooldown,
  clearSecurityAuditLog,
  getLockCooldownState,
  getLockMethodLabel,
  getOrCreateZandoDeviceId,
  getProAppSettings,
  getSecurityAuditLog,
  getSecuritySettings,
  hashPinCode,
  playSaleFeedbackBeep,
  recordFailedPinAttempt,
  saveProAppSettings,
  saveSecuritySettings,
  verifyPinCode,
} from '../services/securityService';
import {seedDemoDatabase} from '../services/seedService';
import {
  buildStoreTransferPackage,
  decryptStoreTransferEnvelope,
  DEFAULT_OWNER_PERMISSIONS,
  parseTransferInput,
  restoreBackupPayloadToDatabase,
} from '../services/storeTransferService';
import {
  AppMode,
  AppNotification,
  AppSecuritySettings,
  AssistantMessage,
  CollaboratorPresetRole,
  CreditTransaction,
  Customer,
  Expense,
  InitialSyncRecord,
  LockMethod,
  Order,
  ProAppSettings,
  Product,
  Promotion,
  Sale,
  SavedCatalog,
  SchemaMeta,
  SecurityAuditEntry,
  StoreCollaborator,
  StorePermissions,
  StoreProfile,
  StoreSlot,
  StoreTransferEnvelope,
  SyncState,
} from '../types/commerce';
import {formatMoney, generateId, getContrastTextColor} from '../utils/format';

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'success' | 'info' | 'error';
}

export interface TransferPackageResult {
  envelope: StoreTransferEnvelope;
  blob: Blob;
  filename: string;
  transferCode: string;
}

interface StoreContextValue {
  loading: boolean;
  error: string | null;
  syncChecking: boolean;
  syncScreenOpen: boolean;
  initialSyncRecord: InitialSyncRecord | null;
  syncState: SyncState;
  appMode: AppMode;
  showOnboardingChoice: boolean;
  zandoDeviceId: string;
  storeSlots: StoreSlot[];
  activeStoreId: string;
  activeStoreSlot: StoreSlot;
  activePermissions: StorePermissions;
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
  schemaMeta: SchemaMeta | null;
  toasts: ToastMessage[];
  notifications: AppNotification[];
  unreadNotificationsCount: number;
  securitySettings: AppSecuritySettings;
  proSettings: ProAppSettings;
  securityAuditLog: SecurityAuditEntry[];
  isLocked: boolean;
  notify: (text: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: string) => void;
  completeInitialSync: (record: InitialSyncRecord) => void;
  closeSyncScreen: () => void;
  runManualSync: () => Promise<void>;
  resetAndResyncInitial: () => Promise<void>;
  pushAppNotification: (
    input: Omit<AppNotification, 'id' | 'createdAt' | 'read'>,
  ) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearReadNotifications: () => void;
  reloadAll: () => Promise<void>;
  enterDemoMode: () => Promise<void>;
  resetDemoMode: () => Promise<void>;
  startRealStore: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
  createNewStore: (name: string, currency?: string) => Promise<StoreSlot>;
  removeStoreSlot: (storeId: string) => Promise<void>;
  removeSecondaryStore: (storeId: string) => Promise<void>;
  sellStoreSlot: (params: {
    storeId: string;
    buyerZandoId: string;
    buyerName?: string;
    salePrice?: string;
    note?: string;
  }) => Promise<TransferPackageResult>;
  createCollaborationPackage: (params: {
    storeId: string;
    collaboratorZandoId: string;
    collaboratorName: string;
    preset: CollaboratorPresetRole;
    permissions: StorePermissions;
    note?: string;
  }) => Promise<TransferPackageResult>;
  revokeStoreCollaborator: (storeId: string, collaboratorId: string) => void;
  importStoreTransfer: (rawOrEnvelope: string | StoreTransferEnvelope) => Promise<{
    kind: 'sale' | 'collaboration';
    slot: StoreSlot;
  }>;
  saveStoreProfile: (next: StoreProfile) => Promise<void>;
  saveProduct: (product: Product) => Promise<void>;
  importProductsBatch: (products: Product[]) => Promise<void>;
  removeProduct: (product: Product) => Promise<void>;
  savePromotion: (promo: Promotion) => Promise<void>;
  removePromotion: (id: string) => Promise<void>;
  saveCustomer: (customer: Customer) => Promise<void>;
  removeCustomer: (id: string) => Promise<void>;
  addSale: (sale: Sale) => Promise<void>;
  removeSale: (id: string) => Promise<void>;
  saveOrder: (order: Order) => Promise<void>;
  removeOrder: (id: string) => Promise<void>;
  completeOrderAsSale: (order: Order, paymentMethod: Sale['paymentMethod']) => Promise<void>;
  saveCatalog: (catalog: SavedCatalog) => Promise<void>;
  removeCatalog: (id: string) => Promise<void>;
  saveExpense: (expense: Expense) => Promise<void>;
  removeExpense: (id: string) => Promise<void>;
  addCreditTransaction: (entry: CreditTransaction) => Promise<void>;
  askAssistant: (question: string) => Promise<AssistantMessage>;
  clearAssistantHistory: () => Promise<void>;
  unlockWithPin: (secret: string) => Promise<{ok: boolean; error?: string; lockedUntil?: number}>;
  verifyCurrentPin: (secret: string) => Promise<boolean>;
  lockAppNow: () => void;
  enableSecurityLock: (method: LockMethod, secret: string) => Promise<void>;
  enablePinLock: (pin: string) => Promise<void>;
  disablePinLock: () => void;
  updateSecuritySettings: (patch: Partial<AppSecuritySettings>) => void;
  updateProSettings: (patch: Partial<ProAppSettings>) => void;
  logSecurityEvent: (action: string, detail: string) => void;
  clearAuditLog: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncChecking, setSyncChecking] = useState(false);
  const [syncScreenOpen, setSyncScreenOpen] = useState(false);
  const [initialSyncRecord, setInitialSyncRecord] = useState<InitialSyncRecord | null>(() =>
    ensureOfflineFirstSyncRecordFast(),
  );
  const [syncState, setSyncState] = useState<SyncState>(() => getSyncState());
  const [appMode, setAppMode] = useState<AppMode>(() => {
    const mode = getStoredAppMode();
    if (mode === 'unset') {
      setStoredAppMode('real');
      return 'real';
    }
    return mode;
  });
  const [showOnboardingChoice, setShowOnboardingChoice] = useState(false);
  const [zandoDeviceId] = useState<string>(() => getOrCreateZandoDeviceId());
  const [storeSlots, setStoreSlots] = useState<StoreSlot[]>(() => getStoreSlots());
  const [activeStoreId, setActiveStoreIdState] = useState<string>(() => getActiveStoreId());

  const [securitySettings, setSecuritySettings] = useState<AppSecuritySettings>(() =>
    getSecuritySettings(),
  );
  const [proSettings, setProSettings] = useState<ProAppSettings>(() => getProAppSettings());
  const [securityAuditLog, setSecurityAuditLog] = useState<SecurityAuditEntry[]>(() =>
    getSecurityAuditLog(),
  );
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    const sec = getSecuritySettings();
    return Boolean(sec.pinEnabled && sec.pinHash);
  });
  const lastActivityRef = useRef<number>(Date.now());

  const [storeProfile, setStoreProfile] = useState<StoreProfile>(() =>
    getCachedStoreProfileSnapshot(),
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalogs, setCatalogs] = useState<SavedCatalog[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>([]);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [schemaMeta, setSchemaMeta] = useState<SchemaMeta | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storedNotifications, setStoredNotifications] = useState<AppNotification[]>(() =>
    getStoredNotifications(),
  );
  const [readDynamicIds, setReadDynamicIds] = useState<string[]>(() => getReadDynamicIds());

  const activeStoreSlot = useMemo(
    () => storeSlots.find((s) => s.id === activeStoreId) ?? storeSlots[0],
    [storeSlots, activeStoreId],
  );

  const activePermissions: StorePermissions = useMemo(() => {
    if (appMode === 'demo') return DEFAULT_OWNER_PERMISSIONS;
    if (activeStoreSlot?.role === 'collaborator' && activeStoreSlot.permissions) {
      return activeStoreSlot.permissions;
    }
    return DEFAULT_OWNER_PERMISSIONS;
  }, [appMode, activeStoreSlot]);

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), {id, text, tone}]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushAppNotification = useCallback(
    (input: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
      const next = appendLocalNotification(
        input,
        Boolean(securitySettings.browserNotificationsEnabled),
      );
      setStoredNotifications(next);
    },
    [securitySettings.browserNotificationsEnabled],
  );

  const dynamicAlerts = useMemo(
    () =>
      buildDynamicStoreAlerts({
        products,
        sales,
        orders,
        customers,
        creditTransactions,
        schemaMeta,
        securitySettings,
        currency: storeProfile.currency || 'FCFA',
        activeStoreSlot: appMode === 'demo' ? undefined : activeStoreSlot,
        readDynamicIds,
      }),
    [
      products,
      sales,
      orders,
      customers,
      creditTransactions,
      schemaMeta,
      securitySettings,
      storeProfile.currency,
      appMode,
      activeStoreSlot,
      readDynamicIds,
    ],
  );

  const notifications = useMemo(() => {
    const combined = [...dynamicAlerts, ...storedNotifications];
    return combined.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
  }, [dynamicAlerts, storedNotifications]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markNotificationRead = useCallback((id: string) => {
    if (id.startsWith('dyn_')) {
      setReadDynamicIds((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        saveReadDynamicIds(next);
        return next;
      });
      return;
    }
    setStoredNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? {...n, read: true} : n));
      saveStoredNotifications(next);
      return next;
    });
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setReadDynamicIds((prev) => {
      const allDyn = Array.from(new Set([...prev, ...dynamicAlerts.map((d) => d.id)]));
      saveReadDynamicIds(allDyn);
      return allDyn;
    });
    setStoredNotifications((prev) => {
      const next = prev.map((n) => ({...n, read: true}));
      saveStoredNotifications(next);
      return next;
    });
  }, [dynamicAlerts]);

  const clearReadNotifications = useCallback(() => {
    setStoredNotifications((prev) => {
      const next = prev.filter((n) => !n.read);
      saveStoredNotifications(next);
      return next;
    });
  }, []);

  const reloadAllInternal = useCallback(async (opts?: {silent?: boolean}): Promise<boolean> => {
    try {
      setError(null);
      const data = await loadAllDomainData();
      setStoreProfile(data.storeProfile);
      saveCachedStoreProfileSnapshot(data.storeProfile);
      setProducts(data.products);
      setPromotions(data.promotions);
      setCustomers(data.customers);
      setSales(data.sales);
      setOrders(data.orders);
      setCatalogs(data.catalogs);
      setExpenses(data.expenses);
      setCreditTransactions(data.creditTransactions);
      setAssistantMessages(data.assistantMessages);
      setSchemaMeta(data.schemaMeta);
      return true;
    } catch (err) {
      if (!opts?.silent) {
        setError(
          err instanceof Error
            ? err.message
            : 'Erreur lors du chargement de la base locale IndexedDB.',
        );
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadAll = useCallback(async (): Promise<void> => {
    await reloadAllInternal();
  }, [reloadAllInternal]);

  // Boot 100% offline-first: zero blocking screen, immediate Dashboard render + silent IDB hydration
  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    let backgroundSyncTimer: number | undefined;

    (async () => {
      const ok = await reloadAllInternal({silent: true});
      if (!active) return;

      if (!ok) {
        // Sur WebView Android au démarrage à froid, IndexedDB peut demander une brève seconde d'initialisation
        retryTimer = window.setTimeout(() => {
          if (!active) return;
          void reloadAllInternal();
        }, 650);
      }

      // Réconciliation silencieuse IDB sync + mise en cache en arrière-plan après affichage complet de l'UI
      backgroundSyncTimer = window.setTimeout(() => {
        if (!active) return;
        readCompletedInitialSync()
          .then((existing) => {
            if (!active) return existing;
            if (existing) {
              setInitialSyncRecord(existing);
              setSyncState(getSyncState());
            }
            return existing;
          })
          .then((existing) => {
            if (!active) return;
            const currentRec = existing || ensureOfflineFirstSyncRecordFast();
            if (
              typeof navigator !== 'undefined' &&
              navigator.onLine !== false &&
              !currentRec.storagePersisted
            ) {
              return runInitialSync({})
                .then((verifiedRec) => {
                  if (!active) return;
                  setInitialSyncRecord(verifiedRec);
                  setSyncState(getSyncState());
                })
                .catch(() => {
                  // Silencieux : l'application reste pleinement utilisable hors ligne
                });
            }
            return undefined;
          })
          .catch(() => {
            // Silencieux : les données locales sont déjà opérationnelles
          });
      }, 2200);
    })();

    return () => {
      active = false;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      if (backgroundSyncTimer !== undefined) {
        window.clearTimeout(backgroundSyncTimer);
      }
    };
  }, [reloadAllInternal]);

  const completeInitialSync = useCallback(
    (record: InitialSyncRecord) => {
      setInitialSyncRecord(record);
      setSyncScreenOpen(false);
      setSyncState(getSyncState());
      notify('ZANDO Pro est synchronisé et prêt pour le mode hors ligne.', 'success');
    },
    [notify],
  );

  const closeSyncScreen = useCallback(() => {
    setSyncScreenOpen(false);
  }, []);

  const resetAndResyncInitial = useCallback(async () => {
    await clearInitialSyncForResync();
    const fallbackRec = await ensureOfflineFirstSyncRecord();
    setInitialSyncRecord(fallbackRec);
    setSyncState(getSyncState());
    setSyncScreenOpen(true);
  }, []);

  const markPendingSync = useCallback(() => {
    setSyncState(incrementPendingSyncChanges());
  }, []);

  const runManualSync = useCallback(async () => {
    if (!initialSyncRecord) return;
    setSyncState((prev) => ({...prev, syncing: true, lastError: null}));
    const entityDigests: Array<{id: string; updatedAt: number}> = [
      ...products.map((p) => ({id: p.id, updatedAt: p.updatedAt})),
      ...promotions.map((p) => ({id: p.id, updatedAt: p.updatedAt})),
      ...customers.map((c) => ({id: c.id, updatedAt: c.updatedAt})),
      ...sales.map((s) => ({id: s.id, updatedAt: s.createdAt})),
      ...orders.map((o) => ({id: o.id, updatedAt: o.updatedAt})),
      ...catalogs.map((c) => ({id: c.id, updatedAt: c.updatedAt ?? c.createdAt})),
      ...expenses.map((e) => ({id: e.id, updatedAt: e.createdAt})),
      ...creditTransactions.map((t) => ({id: t.id, updatedAt: t.createdAt})),
    ];
    const res = await runIncrementalSyncNonBlocking({
      syncRecord: initialSyncRecord,
      entityDigests,
      stats: {
        storeCount: storeSlots.length,
        productsCount: products.length,
        salesCount: sales.length,
        ordersCount: orders.length,
        customersCount: customers.length,
      },
    });
    if (res.updatedRecord) {
      setInitialSyncRecord(res.updatedRecord);
    }
    setSyncState(getSyncState());
    if (res.ok) {
      notify('Synchronisation et vérification locales à jour.', 'success');
    } else if (res.error) {
      notify(res.error, 'info');
    }
  }, [
    initialSyncRecord,
    products,
    promotions,
    customers,
    sales,
    orders,
    catalogs,
    expenses,
    creditTransactions,
    storeSlots.length,
    notify,
  ]);

  // Synchronisation automatique discrète au retour d'Internet si des modifications locales attendent
  useEffect(() => {
    const handleOnline = () => {
      if (initialSyncRecord && syncState.pendingChanges > 0) {
        runManualSync().catch(() => {});
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [initialSyncRecord, syncState.pendingChanges, runManualSync]);

  // Alerte unique à la fin du premier téléchargement complet du cache hors ligne
  useEffect(() => {
    const onOfflineReady = () => {
      try {
        if (localStorage.getItem('zando_pro_offline_toast_shown') === '1') return;
        localStorage.setItem('zando_pro_offline_toast_shown', '1');
      } catch {
        // Ignoré
      }
      notify(
        'Mise en cache terminée : ZANDO Pro est prêt à fonctionner hors ligne en permanence.',
        'success',
      );
    };
    window.addEventListener('zando-offline-ready', onOfflineReady);
    return () => window.removeEventListener('zando-offline-ready', onOfflineReady);
  }, [notify]);

  useEffect(() => {
    const root = document.documentElement;
    if (storeProfile.themeMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    const primary = storeProfile.primaryColor || '#0F172A';
    const accent = storeProfile.accentColor || '#059669';
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-primary-fg', getContrastTextColor(primary));
    root.style.setProperty('--brand-accent', accent);
    root.style.setProperty('--brand-accent-fg', getContrastTextColor(accent));
  }, [storeProfile.themeMode, storeProfile.primaryColor, storeProfile.accentColor]);

  // Accurate auto-lock timer supporting 15s, 30s, 1m, 5m, 15m, 30m
  useEffect(() => {
    if (!securitySettings.pinEnabled || !securitySettings.pinHash) return;
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', markActivity, {passive: true});
    window.addEventListener('keydown', markActivity, {passive: true});

    const timer = window.setInterval(() => {
      if (securitySettings.autoLockSeconds > 0 && !isLocked) {
        const elapsedMs = Date.now() - lastActivityRef.current;
        if (elapsedMs >= securitySettings.autoLockSeconds * 1000) {
          setIsLocked(true);
        }
      }
    }, 2000);

    return () => {
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.clearInterval(timer);
    };
  }, [securitySettings.pinEnabled, securitySettings.pinHash, securitySettings.autoLockSeconds, isLocked]);

  const logSecurityEvent = useCallback((action: string, detail: string) => {
    const next = appendSecurityAudit(action, detail);
    setSecurityAuditLog(next);
  }, []);

  const clearAuditLog = useCallback(() => {
    clearSecurityAuditLog();
    setSecurityAuditLog([]);
  }, []);

  const enterDemoMode = useCallback(async () => {
    setLoading(true);
    clearAllCachedUrls();
    await closeAndClearDbCache(DEMO_DB_NAME);
    setStoredAppMode('demo');
    setAppMode('demo');
    setShowOnboardingChoice(false);
    await seedDemoDatabase();
    await reloadAll();
    logSecurityEvent('Mode démo', 'Activation du Mode Démonstration isolé');
    notify('Mode Démonstration activé avec une base de données isolée.', 'info');
  }, [reloadAll, notify, logSecurityEvent]);

  const resetDemoMode = useCallback(async () => {
    setLoading(true);
    clearAllCachedUrls();
    await seedDemoDatabase();
    await reloadAll();
    notify('Démonstration réinitialisée à son état initial.', 'info');
  }, [reloadAll, notify]);

  const startRealStore = useCallback(async () => {
    setLoading(true);
    clearAllCachedUrls();
    await closeAndClearDbCache(getActiveStoreSlot().dbName);
    setStoredAppMode('real');
    setAppMode('real');
    setShowOnboardingChoice(false);
    await reloadAll();
    logSecurityEvent('Mode démo', 'Retour vers la boutique réelle');
    notify('Espace personnel prêt. Vos données réelles sont isolées de la démonstration.', 'success');
  }, [reloadAll, notify, logSecurityEvent]);

  const switchStore = useCallback(
    async (storeId: string) => {
      if (appMode !== 'demo' && storeId === activeStoreId) {
        return;
      }
      setLoading(true);
      clearAllCachedUrls();
      await closeAndClearDbCache();
      setActiveStoreId(storeId);
      setActiveStoreIdState(storeId);
      if (appMode === 'demo') {
        setStoredAppMode('real');
        setAppMode('real');
      }
      await reloadAll();
      const target = getStoreSlots().find((s) => s.id === storeId);
      logSecurityEvent('Boutique', `Basculement vers « ${target?.name ?? storeId} »`);
      notify(`Boutique active : ${target?.name ?? 'Boutique'}`, 'success');
    },
    [appMode, activeStoreId, reloadAll, notify, logSecurityEvent],
  );

  const createNewStore = useCallback(
    async (name: string, currency = 'FCFA'): Promise<StoreSlot> => {
      const slot = createStoreSlot(name, currency);
      setStoreSlots(getStoreSlots());
      setActiveStoreIdState(slot.id);
      setLoading(true);
      clearAllCachedUrls();
      await closeAndClearDbCache();
      if (appMode === 'demo') {
        setStoredAppMode('real');
        setAppMode('real');
      }
      await putRecord(STORES.STORE_PROFILE, {
        ...DEFAULT_STORE_PROFILE,
        name: slot.name,
        currency: slot.currency,
        updatedAt: Date.now(),
      });
      await reloadAll();
      logSecurityEvent('Boutique', `Création de la boutique « ${slot.name} »`);
      pushAppNotification({
        category: 'system',
        severity: 'success',
        title: `Nouvelle boutique : ${slot.name}`,
        message: 'Espace indépendant prêt à être configuré hors ligne.',
        actionRoute: 'store',
        actionLabel: 'Configurer',
      });
      notify(`Nouvelle boutique « ${slot.name} » ouverte.`, 'success');
      return slot;
    },
    [appMode, reloadAll, notify, logSecurityEvent, pushAppNotification],
  );

  const removeStoreSlot = useCallback(
    async (storeId: string) => {
      const target = getStoreSlots().find((s) => s.id === storeId);
      setLoading(true);
      clearAllCachedUrls();
      const nextId = await deleteStoreSlot(storeId);
      setStoreSlots(getStoreSlots());
      setActiveStoreIdState(nextId);
      if (appMode === 'demo') {
        setStoredAppMode('real');
        setAppMode('real');
      }
      await reloadAll();
      logSecurityEvent('Boutique', `Suppression de la boutique « ${target?.name ?? storeId} »`);
      pushAppNotification({
        category: 'system',
        severity: 'info',
        title: 'Boutique supprimée',
        message: `La boutique « ${target?.name ?? storeId} » a été retirée de cet appareil.`,
      });
      notify(`Boutique « ${target?.name ?? ''} » supprimée.`, 'info');
    },
    [appMode, reloadAll, notify, logSecurityEvent, pushAppNotification],
  );

  const sellStoreSlot = useCallback(
    async (params: {
      storeId: string;
      buyerZandoId: string;
      buyerName?: string;
      salePrice?: string;
      note?: string;
    }): Promise<TransferPackageResult> => {
      const slots = getStoreSlots();
      const target = slots.find((s) => s.id === params.storeId);
      if (!target) throw new Error('Boutique introuvable.');
      if (target.role === 'collaborator') {
        throw new Error('Seul le propriétaire d’origine peut revendre cette boutique.');
      }

      const pkg = await buildStoreTransferPackage({
        slot: target,
        kind: 'sale',
        senderZandoId: zandoDeviceId,
        receiverZandoId: params.buyerZandoId,
        receiverName: params.buyerName,
        salePrice: params.salePrice,
        note: params.note,
      });

      // Après création du paquet de cession, supprimer la boutique chez le vendeur
      setLoading(true);
      clearAllCachedUrls();
      const nextId = await deleteStoreSlot(target.id, {allowResetIfLast: true});
      setStoreSlots(getStoreSlots());
      setActiveStoreIdState(nextId);
      if (appMode === 'demo') {
        setStoredAppMode('real');
        setAppMode('real');
      }
      await reloadAll();

      logSecurityEvent(
        'Vente de boutique',
        `Boutique « ${target.name} » cédée à ${pkg.envelope.receiverZandoId} et supprimée de cet appareil`,
      );
      pushAppNotification({
        category: 'transfer',
        severity: 'success',
        title: `Boutique vendue : ${target.name}`,
        message: `Transférée vers ${pkg.envelope.receiverZandoId} et supprimée de votre appareil.`,
      });
      notify(
        `Boutique « ${target.name} » transférée et supprimée de votre appareil.`,
        'success',
      );
      return pkg;
    },
    [appMode, zandoDeviceId, reloadAll, logSecurityEvent, pushAppNotification, notify],
  );

  const createCollaborationPackage = useCallback(
    async (params: {
      storeId: string;
      collaboratorZandoId: string;
      collaboratorName: string;
      preset: CollaboratorPresetRole;
      permissions: StorePermissions;
      note?: string;
    }): Promise<TransferPackageResult> => {
      const slots = getStoreSlots();
      const target = slots.find((s) => s.id === params.storeId);
      if (!target) throw new Error('Boutique introuvable.');
      if (target.role === 'collaborator') {
        throw new Error('Seul le propriétaire peut inviter d’autres collaborateurs.');
      }

      const pkg = await buildStoreTransferPackage({
        slot: target,
        kind: 'collaboration',
        senderZandoId: zandoDeviceId,
        receiverZandoId: params.collaboratorZandoId,
        receiverName: params.collaboratorName,
        note: params.note,
        permissions: params.permissions,
      });

      const entry: StoreCollaborator = {
        id: generateId('colab'),
        zandoId: pkg.envelope.receiverZandoId,
        name: params.collaboratorName.trim() || pkg.envelope.receiverZandoId,
        preset: params.preset,
        permissions: params.permissions,
        createdAt: Date.now(),
      };
      const existingList = (target.collaborators ?? []).filter(
        (c) => c.zandoId !== entry.zandoId,
      );
      updateStoreCollaborators(target.id, [entry, ...existingList]);
      setStoreSlots(getStoreSlots());

      logSecurityEvent(
        'Collaboration',
        `Accès partagé sur « ${target.name} » pour ${entry.name} (${entry.zandoId})`,
      );
      pushAppNotification({
        category: 'transfer',
        severity: 'info',
        title: `Collaboration créée : ${target.name}`,
        message: `${entry.name} (${entry.zandoId}) a reçu des droits d’utilisation. Votre boutique reste conservée ici.`,
        actionRoute: 'store',
        actionLabel: 'Voir boutique',
      });
      notify(`Accès collaboration généré pour ${entry.name}. La boutique reste sur votre appareil.`, 'success');
      return pkg;
    },
    [zandoDeviceId, logSecurityEvent, pushAppNotification, notify],
  );

  const revokeStoreCollaborator = useCallback(
    (storeId: string, collaboratorId: string) => {
      const slots = getStoreSlots();
      const target = slots.find((s) => s.id === storeId);
      if (!target) return;
      const col = target.collaborators?.find((c) => c.id === collaboratorId);
      const nextList = (target.collaborators ?? []).filter((c) => c.id !== collaboratorId);
      updateStoreCollaborators(storeId, nextList);
      setStoreSlots(getStoreSlots());
      logSecurityEvent(
        'Collaboration',
        `Accès retiré pour ${col?.name || collaboratorId} sur « ${target.name} »`,
      );
      notify('Collaborateur retiré de la liste.', 'info');
    },
    [logSecurityEvent, notify],
  );

  const importStoreTransfer = useCallback(
    async (
      rawOrEnvelope: string | StoreTransferEnvelope,
    ): Promise<{kind: 'sale' | 'collaboration'; slot: StoreSlot}> => {
      const envelope =
        typeof rawOrEnvelope === 'string' ? parseTransferInput(rawOrEnvelope) : rawOrEnvelope;
      const decrypted = await decryptStoreTransferEnvelope(envelope, zandoDeviceId);

      const slots = getStoreSlots();
      let targetSlot: StoreSlot | null = null;

      // Si l'utilisateur n'a qu'un seul emplacement vierge par défaut, l'utiliser directement
      if (slots.length === 1 && slots[0].role !== 'collaborator') {
        const isEmpty = await isStoreSlotEmpty(slots[0].dbName);
        if (
          isEmpty &&
          (slots[0].name === 'Boutique Principale' || slots[0].name === 'Ma Boutique')
        ) {
          targetSlot = slots[0];
        }
      }

      if (!targetSlot) {
        if (slots.length >= MAX_STORES) {
          throw new Error(
            `Vous avez déjà ${MAX_STORES} boutiques ouvertes. Supprimez ou cédez une boutique avant d’importer « ${decrypted.backupPayload.storeProfile.name} ».`,
          );
        }
        targetSlot = createStoreSlot(
          decrypted.backupPayload.storeProfile.name || envelope.storeName || 'Boutique importée',
          decrypted.backupPayload.storeProfile.currency || 'FCFA',
        );
      }

      setLoading(true);
      clearAllCachedUrls();
      await closeAndClearDbCache();

      await restoreBackupPayloadToDatabase(
        targetSlot.dbName,
        decrypted.backupPayload,
        envelope.kind === 'sale'
          ? `Achat / reprise de la boutique « ${envelope.storeName} » depuis ${decrypted.ownerZandoId}`
          : `Collaboration reçue sur « ${envelope.storeName} » depuis ${decrypted.ownerZandoId}`,
      );

      const resolvedName =
        decrypted.backupPayload.storeProfile.name || envelope.storeName || targetSlot.name;
      const resolvedCurrency = decrypted.backupPayload.storeProfile.currency || targetSlot.currency;

      if (envelope.kind === 'collaboration') {
        markSlotAsCollaborator(
          targetSlot.id,
          decrypted.ownerZandoId,
          decrypted.collaboratorName,
          decrypted.permissions,
          resolvedName,
          resolvedCurrency,
        );
      } else {
        updateStoreSlotMeta(targetSlot.id, resolvedName, resolvedCurrency);
      }

      setActiveStoreId(targetSlot.id);
      setActiveStoreIdState(targetSlot.id);
      setStoreSlots(getStoreSlots());
      if (appMode === 'demo') {
        setStoredAppMode('real');
        setAppMode('real');
      }

      await reloadAll();
      const updatedSlot = getStoreSlots().find((s) => s.id === targetSlot.id) ?? targetSlot;

      logSecurityEvent(
        envelope.kind === 'sale' ? 'Achat de boutique' : 'Collaboration acceptée',
        `Boutique « ${resolvedName} » importée depuis ${decrypted.ownerZandoId}`,
      );
      pushAppNotification({
        category: 'transfer',
        severity: 'success',
        title:
          envelope.kind === 'sale'
            ? `Boutique acquise : ${resolvedName}`
            : `Collaboration activée : ${resolvedName}`,
        message:
          envelope.kind === 'sale'
            ? `La boutique est maintenant installée en local et vous en êtes le propriétaire.`
            : `Vous disposez désormais des droits attribués par ${decrypted.ownerZandoId}.`,
        actionRoute: 'dashboard',
        actionLabel: 'Ouvrir',
      });
      notify(
        envelope.kind === 'sale'
          ? `Boutique « ${resolvedName} » achetée et importée avec succès !`
          : `Accès collaboration à « ${resolvedName} » activé !`,
        'success',
      );
      return {kind: envelope.kind, slot: updatedSlot};
    },
    [appMode, zandoDeviceId, reloadAll, logSecurityEvent, pushAppNotification, notify],
  );

  const saveStoreProfile = useCallback(
    async (next: StoreProfile) => {
      const prevPhone = storeProfile.phone;
      const updated = {...next, id: 'default' as const, updatedAt: Date.now()};
      await putRecord(STORES.STORE_PROFILE, updated);
      setStoreProfile(updated);
      saveCachedStoreProfileSnapshot(updated);

      if (appMode !== 'demo') {
        updateStoreSlotMeta(activeStoreId, updated.name, updated.currency);
        setStoreSlots(getStoreSlots());
      }

      if (updated.phone !== prevPhone && catalogs.length > 0) {
        const synced: SavedCatalog[] = [];
        let changed = false;
        for (const cat of catalogs) {
          if (!cat.storePhone || cat.storePhone === prevPhone) {
            const nextCat = {...cat, storePhone: updated.phone};
            await putRecord(STORES.CATALOGS, nextCat);
            synced.push(nextCat);
            changed = true;
          } else {
            synced.push(cat);
          }
        }
        if (changed) {
          setCatalogs(synced);
        }
      }
      markPendingSync();
    },
    [storeProfile.phone, catalogs, appMode, activeStoreId, markPendingSync],
  );

  const saveProduct = useCallback(
    async (product: Product) => {
      await putRecord(STORES.PRODUCTS, product);
      setProducts((prev) => {
        const idx = prev.findIndex((p) => p.id === product.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = product;
          return copy.sort((a, b) => b.updatedAt - a.updatedAt);
        }
        return [product, ...prev];
      });
      markPendingSync();
    },
    [markPendingSync],
  );

  const importProductsBatch = useCallback(
    async (items: Product[]) => {
      await bulkPutProducts(items);
      await reloadAll();
      markPendingSync();
      pushAppNotification({
        category: 'stock',
        severity: 'success',
        title: 'Importation de produits terminée',
        message: `${items.length} article(s) ajouté(s) ou mis à jour dans le stock.`,
        actionRoute: 'products',
        actionLabel: 'Voir produits',
      });
    },
    [reloadAll, pushAppNotification, markPendingSync],
  );

  const removeProduct = useCallback(
    async (product: Product) => {
      await deleteRecord(STORES.PRODUCTS, product.id);
      if (product.imageBlobId) {
        await deleteMediaBlob(product.imageBlobId);
      }
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const savePromotion = useCallback(
    async (promo: Promotion) => {
      await putRecord(STORES.PROMOTIONS, promo);
      setPromotions((prev) => {
        const idx = prev.findIndex((p) => p.id === promo.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = promo;
          return copy;
        }
        return [promo, ...prev];
      });
      markPendingSync();
    },
    [markPendingSync],
  );

  const removePromotion = useCallback(
    async (id: string) => {
      await deleteRecord(STORES.PROMOTIONS, id);
      setPromotions((prev) => prev.filter((p) => p.id !== id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const saveCustomer = useCallback(
    async (customer: Customer) => {
      await putRecord(STORES.CUSTOMERS, customer);
      setCustomers((prev) => {
        const idx = prev.findIndex((c) => c.id === customer.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = customer;
          return copy.sort((a, b) => b.updatedAt - a.updatedAt);
        }
        return [customer, ...prev];
      });
      markPendingSync();
    },
    [markPendingSync],
  );

  const removeCustomer = useCallback(
    async (id: string) => {
      await deleteRecord(STORES.CUSTOMERS, id);
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const addSale = useCallback(
    async (sale: Sale) => {
      await recordSaleWithStockDeduction(sale);
      playSaleFeedbackBeep(proSettings.soundFeedback);
      await reloadAll();
      markPendingSync();

      const unpaid = Math.max(0, sale.total - (sale.amountPaid ?? sale.total));
      if (unpaid > 0) {
        pushAppNotification({
          category: 'credit',
          severity: 'warning',
          title: `Vente à crédit : ${sale.customerName || 'Client'}`,
          message: `Reste dû : ${formatMoney(unpaid, storeProfile.currency)} (${sale.receiptNumber}).`,
          actionRoute: 'credits',
          actionLabel: 'Voir crédits',
        });
      }
    },
    [reloadAll, proSettings.soundFeedback, pushAppNotification, storeProfile.currency, markPendingSync],
  );

  const removeSale = useCallback(
    async (id: string) => {
      await deleteRecord(STORES.SALES, id);
      setSales((prev) => prev.filter((s) => s.id !== id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const saveOrder = useCallback(
    async (order: Order) => {
      const isNew = !orders.some((o) => o.id === order.id);
      await putRecord(STORES.ORDERS, order);
      setOrders((prev) => {
        const idx = prev.findIndex((o) => o.id === order.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = order;
          return copy.sort((a, b) => b.createdAt - a.createdAt);
        }
        return [order, ...prev];
      });
      markPendingSync();
      if (isNew) {
        pushAppNotification({
          category: 'order',
          severity: 'info',
          title: `Nouvelle commande ${order.orderNumber}`,
          message: `${order.customerName} · ${formatMoney(order.total, storeProfile.currency)} (${order.channel})`,
          actionRoute: 'orders',
          actionLabel: 'Traiter',
        });
      }
    },
    [orders, pushAppNotification, storeProfile.currency, markPendingSync],
  );

  const removeOrder = useCallback(
    async (id: string) => {
      await deleteRecord(STORES.ORDERS, id);
      setOrders((prev) => prev.filter((o) => o.id !== id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const completeOrderAsSale = useCallback(
    async (order: Order, paymentMethod: Sale['paymentMethod']) => {
      const prefix = (proSettings.receiptPrefix || 'FAC').trim() || 'FAC';
      const sale: Sale = {
        id: `sale_${Date.now().toString(36)}`,
        receiptNumber: `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`,
        customerId: order.customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        channel: order.channel,
        paymentMethod,
        paymentStatus: 'paid',
        amountPaid: order.total,
        refundedAmount: 0,
        extraFees: 0,
        items: order.items,
        subtotal: order.items.reduce((acc, i) => acc + i.originalPrice * i.quantity, 0),
        discountTotal: order.items.reduce((acc, i) => acc + i.discountApplied * i.quantity, 0),
        total: order.total,
        notes: `Convertie depuis commande ${order.orderNumber}`,
        createdAt: Date.now(),
      };
      await convertOrderToSaleTransaction(order, sale);
      playSaleFeedbackBeep(proSettings.soundFeedback);
      await reloadAll();
      markPendingSync();
    },
    [reloadAll, proSettings.receiptPrefix, proSettings.soundFeedback, markPendingSync],
  );

  const saveCatalog = useCallback(
    async (catalog: SavedCatalog) => {
      await putRecord(STORES.CATALOGS, catalog);
      setCatalogs((prev) => {
        const idx = prev.findIndex((c) => c.id === catalog.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = catalog;
          return copy;
        }
        return [catalog, ...prev];
      });
      markPendingSync();
    },
    [markPendingSync],
  );

  const removeCatalog = useCallback(
    async (id: string) => {
      await deleteRecord(STORES.CATALOGS, id);
      setCatalogs((prev) => prev.filter((c) => c.id !== id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const saveExpense = useCallback(
    async (expense: Expense) => {
      await putRecord(STORES.EXPENSES, expense);
      setExpenses((prev) => {
        const idx = prev.findIndex((e) => e.id === expense.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = expense;
          return copy.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
        }
        return [expense, ...prev].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      });
      markPendingSync();
    },
    [markPendingSync],
  );

  const removeExpense = useCallback(
    async (id: string) => {
      await deleteRecord(STORES.EXPENSES, id);
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      markPendingSync();
    },
    [markPendingSync],
  );

  const addCreditTransaction = useCallback(
    async (entry: CreditTransaction) => {
      await recordCreditLedgerEntry(entry);
      await reloadAll();
      markPendingSync();
    },
    [reloadAll, markPendingSync],
  );

  const askAssistant = useCallback(
    async (question: string): Promise<AssistantMessage> => {
      const userMsg: AssistantMessage = {
        id: generateId('msg'),
        role: 'user',
        text: question,
        createdAt: Date.now(),
      };
      const reply = answerCommercialQuestion(question, {
        storeProfile,
        products,
        sales,
        orders,
        customers,
        promotions,
        expenses,
        creditTransactions,
        catalogs,
      });

      await putRecord(STORES.ASSISTANT_MESSAGES, userMsg);
      await putRecord(STORES.ASSISTANT_MESSAGES, reply);
      setAssistantMessages((prev) => [...prev, userMsg, reply]);
      return reply;
    },
    [
      storeProfile,
      products,
      sales,
      orders,
      customers,
      promotions,
      expenses,
      creditTransactions,
      catalogs,
    ],
  );

  const clearAssistantHistory = useCallback(async () => {
    await clearStore(STORES.ASSISTANT_MESSAGES);
    setAssistantMessages([]);
  }, []);

  const unlockWithPin = useCallback(
    async (secret: string): Promise<{ok: boolean; error?: string; lockedUntil?: number}> => {
      const cooldown = getLockCooldownState();
      if (cooldown.lockedUntil > Date.now()) {
        return {
          ok: false,
          error: 'Trop de tentatives. Patientez quelques secondes.',
          lockedUntil: cooldown.lockedUntil,
        };
      }
      const methodLabel = getLockMethodLabel(securitySettings.lockMethod);
      const valid = await verifyPinCode(secret, securitySettings.pinHash, securitySettings.pinSalt);
      if (valid) {
        clearPinCooldown();
        lastActivityRef.current = Date.now();
        setIsLocked(false);
        logSecurityEvent('Déverrouillage', `Session déverrouillée par ${methodLabel.toLowerCase()}`);
        return {ok: true};
      }
      const nextCool = recordFailedPinAttempt();
      logSecurityEvent(
        'Alerte sécurité',
        `${methodLabel} incorrect (tentative #${nextCool.attempts})`,
      );
      if (nextCool.attempts >= 5) {
        pushAppNotification({
          category: 'security',
          severity: 'urgent',
          title: 'Tentatives de déverrouillage répétées',
          message: `5 échecs de saisie (${methodLabel}). Verrouillage temporaire de 30s activé.`,
          actionRoute: 'backup',
          actionLabel: 'Journal sécurité',
        });
      }
      return {
        ok: false,
        error:
          nextCool.lockedUntil > Date.now()
            ? '5 tentatives échouées : verrouillage temporaire de 30 secondes.'
            : `${methodLabel} incorrect.`,
        lockedUntil: nextCool.lockedUntil,
      };
    },
    [
      securitySettings.pinHash,
      securitySettings.pinSalt,
      securitySettings.lockMethod,
      logSecurityEvent,
      pushAppNotification,
    ],
  );

  const verifyCurrentPin = useCallback(
    async (secret: string): Promise<boolean> => {
      if (!securitySettings.pinEnabled) return true;
      return verifyPinCode(secret, securitySettings.pinHash, securitySettings.pinSalt);
    },
    [securitySettings.pinEnabled, securitySettings.pinHash, securitySettings.pinSalt],
  );

  const lockAppNow = useCallback(() => {
    if (!securitySettings.pinEnabled) return;
    setIsLocked(true);
    logSecurityEvent('Verrouillage', 'Application verrouillée manuellement');
  }, [securitySettings.pinEnabled, logSecurityEvent]);

  const enableSecurityLock = useCallback(
    async (method: LockMethod, secret: string) => {
      const {hash, salt} = await hashPinCode(secret);
      const next: AppSecuritySettings = {
        ...securitySettings,
        pinEnabled: true,
        lockMethod: method,
        pinHash: hash,
        pinSalt: salt,
      };
      saveSecuritySettings(next);
      setSecuritySettings(next);
      clearPinCooldown();
      lastActivityRef.current = Date.now();
      const label = getLockMethodLabel(method);
      logSecurityEvent('Sécurité', `Verrouillage par ${label} activé / modifié`);
      pushAppNotification({
        category: 'security',
        severity: 'success',
        title: `Verrouillage par ${label} activé`,
        message: 'Votre accès caisse est désormais protégé localement.',
        actionRoute: 'backup',
        actionLabel: 'Sécurité',
      });
    },
    [securitySettings, logSecurityEvent, pushAppNotification],
  );

  const enablePinLock = useCallback(
    async (pin: string) => {
      await enableSecurityLock('pin', pin);
    },
    [enableSecurityLock],
  );

  const disablePinLock = useCallback(() => {
    const next: AppSecuritySettings = {
      ...securitySettings,
      pinEnabled: false,
      pinHash: undefined,
      pinSalt: undefined,
    };
    saveSecuritySettings(next);
    setSecuritySettings(next);
    setIsLocked(false);
    clearPinCooldown();
    logSecurityEvent('Sécurité', 'Verrouillage d’application désactivé');
    pushAppNotification({
      category: 'security',
      severity: 'warning',
      title: 'Verrouillage désactivé',
      message: 'Le verrouillage d’accès à ZANDO Pro a été retiré.',
      actionRoute: 'backup',
      actionLabel: 'Sécurité',
    });
  }, [securitySettings, logSecurityEvent, pushAppNotification]);

  const updateSecuritySettings = useCallback(
    (patch: Partial<AppSecuritySettings>) => {
      const next = {...securitySettings, ...patch};
      saveSecuritySettings(next);
      setSecuritySettings(next);
      if (patch.privacyModeEnabled !== undefined) {
        logSecurityEvent(
          'Confidentialité',
          patch.privacyModeEnabled ? 'Mode Discret activé' : 'Mode Discret désactivé',
        );
      }
    },
    [securitySettings, logSecurityEvent],
  );

  const updateProSettings = useCallback(
    (patch: Partial<ProAppSettings>) => {
      const next = {...proSettings, ...patch};
      saveProAppSettings(next);
      setProSettings(next);
    },
    [proSettings],
  );

  return (
    <StoreContext.Provider
      value={{
        loading,
        error,
        syncChecking,
        syncScreenOpen,
        initialSyncRecord,
        syncState,
        appMode,
        showOnboardingChoice,
        zandoDeviceId,
        storeSlots,
        activeStoreId,
        activeStoreSlot,
        activePermissions,
        storeProfile,
        products,
        promotions,
        customers,
        sales,
        orders,
        catalogs,
        expenses,
        creditTransactions,
        assistantMessages,
        schemaMeta,
        toasts,
        notifications,
        unreadNotificationsCount,
        securitySettings,
        proSettings,
        securityAuditLog,
        isLocked,
        notify,
        dismissToast,
        completeInitialSync,
        closeSyncScreen,
        runManualSync,
        resetAndResyncInitial,
        pushAppNotification,
        markNotificationRead,
        markAllNotificationsRead,
        clearReadNotifications,
        reloadAll,
        enterDemoMode,
        resetDemoMode,
        startRealStore,
        switchStore,
        createNewStore,
        removeStoreSlot,
        removeSecondaryStore: removeStoreSlot,
        sellStoreSlot,
        createCollaborationPackage,
        revokeStoreCollaborator,
        importStoreTransfer,
        saveStoreProfile,
        saveProduct,
        importProductsBatch,
        removeProduct,
        savePromotion,
        removePromotion,
        saveCustomer,
        removeCustomer,
        addSale,
        removeSale,
        saveOrder,
        removeOrder,
        completeOrderAsSale,
        saveCatalog,
        removeCatalog,
        saveExpense,
        removeExpense,
        addCreditTransaction,
        askAssistant,
        clearAssistantHistory,
        unlockWithPin,
        verifyCurrentPin,
        lockAppNow,
        enableSecurityLock,
        enablePinLock,
        disablePinLock,
        updateSecuritySettings,
        updateProSettings,
        logSecurityEvent,
        clearAuditLog,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore doit être utilisé à l’intérieur de StoreProvider.');
  return ctx;
}
