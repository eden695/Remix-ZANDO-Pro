import React, {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';
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
  getStoredAppMode,
  getStoreSlots,
  loadAllDomainData,
  putRecord,
  REAL_DB_NAME,
  recordCreditLedgerEntry,
  recordSaleWithStockDeduction,
  setActiveStoreId,
  setStoredAppMode,
  STORES,
  updateStoreSlotMeta,
} from '../db/indexedDb';
import {answerCommercialQuestion} from '../services/localAssistantService';
import {clearAllCachedUrls, deleteMediaBlob} from '../services/mediaService';
import {
  appendSecurityAudit,
  clearPinCooldown,
  clearSecurityAuditLog,
  getLockCooldownState,
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
  AppMode,
  AppSecuritySettings,
  AssistantMessage,
  CreditTransaction,
  Customer,
  Expense,
  Order,
  ProAppSettings,
  Product,
  Promotion,
  Sale,
  SavedCatalog,
  SchemaMeta,
  SecurityAuditEntry,
  StoreProfile,
  StoreSlot,
} from '../types/commerce';
import {generateId, getContrastTextColor} from '../utils/format';

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'success' | 'info' | 'error';
}

interface StoreContextValue {
  loading: boolean;
  error: string | null;
  appMode: AppMode;
  showOnboardingChoice: boolean;
  storeSlots: StoreSlot[];
  activeStoreId: string;
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
  securitySettings: AppSecuritySettings;
  proSettings: ProAppSettings;
  securityAuditLog: SecurityAuditEntry[];
  isLocked: boolean;
  notify: (text: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: string) => void;
  reloadAll: () => Promise<void>;
  enterDemoMode: () => Promise<void>;
  resetDemoMode: () => Promise<void>;
  startRealStore: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
  createNewStore: (name: string, currency?: string) => Promise<StoreSlot>;
  removeSecondaryStore: (storeId: string) => Promise<void>;
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
  unlockWithPin: (pin: string) => Promise<{ok: boolean; error?: string; lockedUntil?: number}>;
  verifyCurrentPin: (pin: string) => Promise<boolean>;
  lockAppNow: () => void;
  enablePinLock: (pin: string) => Promise<void>;
  disablePinLock: () => void;
  updateSecuritySettings: (patch: Partial<AppSecuritySettings>) => void;
  updateProSettings: (patch: Partial<ProAppSettings>) => void;
  logSecurityEvent: (action: string, detail: string) => void;
  clearAuditLog: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appMode, setAppMode] = useState<AppMode>(() => getStoredAppMode());
  const [showOnboardingChoice, setShowOnboardingChoice] = useState(false);
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

  const [storeProfile, setStoreProfile] = useState<StoreProfile>(DEFAULT_STORE_PROFILE);
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

  const reloadAll = useCallback(async () => {
    try {
      setError(null);
      const data = await loadAllDomainData();
      setStoreProfile(data.storeProfile);
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
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erreur lors du chargement de la base locale IndexedDB.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Boot sequence: always open normally in the real local workspace (demo mode is opt-in from Settings)
  useEffect(() => {
    let active = true;
    (async () => {
      const storedMode = getStoredAppMode();
      if (storedMode === 'unset') {
        if (!active) return;
        setStoredAppMode('real');
        setAppMode('real');
        setShowOnboardingChoice(false);
      }
      await reloadAll();
    })();
    return () => {
      active = false;
    };
  }, [reloadAll]);

  // Apply light/dark theme + merchant brand CSS custom properties to documentElement
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

  // Auto-lock inactivity monitor
  useEffect(() => {
    if (!securitySettings.pinEnabled || !securitySettings.pinHash) return;
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', markActivity, {passive: true});
    window.addEventListener('keydown', markActivity, {passive: true});

    const timer = window.setInterval(() => {
      if (securitySettings.autoLockMinutes > 0 && !isLocked) {
        const elapsedMs = Date.now() - lastActivityRef.current;
        if (elapsedMs >= securitySettings.autoLockMinutes * 60 * 1000) {
          setIsLocked(true);
        }
      }
    }, 15000);

    return () => {
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.clearInterval(timer);
    };
  }, [securitySettings.pinEnabled, securitySettings.pinHash, securitySettings.autoLockMinutes, isLocked]);

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
    [appMode, reloadAll, notify, logSecurityEvent],
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
      notify(`Nouvelle boutique « ${slot.name} » ouverte.`, 'success');
      return slot;
    },
    [appMode, reloadAll, notify, logSecurityEvent],
  );

  const removeSecondaryStore = useCallback(
    async (storeId: string) => {
      const target = getStoreSlots().find((s) => s.id === storeId);
      setLoading(true);
      clearAllCachedUrls();
      const nextId = await deleteStoreSlot(storeId);
      setStoreSlots(getStoreSlots());
      setActiveStoreIdState(nextId);
      await reloadAll();
      logSecurityEvent('Boutique', `Suppression de la boutique « ${target?.name ?? storeId} »`);
      notify('Boutique supprimée.', 'info');
    },
    [reloadAll, notify, logSecurityEvent],
  );

  const saveStoreProfile = useCallback(
    async (next: StoreProfile) => {
      const prevPhone = storeProfile.phone;
      const updated = {...next, id: 'default' as const, updatedAt: Date.now()};
      await putRecord(STORES.STORE_PROFILE, updated);
      setStoreProfile(updated);

      if (appMode !== 'demo') {
        updateStoreSlotMeta(activeStoreId, updated.name, updated.currency);
        setStoreSlots(getStoreSlots());
      }

      // Si le numéro WhatsApp de la boutique change, synchroniser les catalogues qui utilisaient l'ancien numéro (ou aucun numéro)
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
    },
    [storeProfile.phone, catalogs, appMode, activeStoreId],
  );

  const saveProduct = useCallback(async (product: Product) => {
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
  }, []);

  const importProductsBatch = useCallback(
    async (items: Product[]) => {
      await bulkPutProducts(items);
      await reloadAll();
    },
    [reloadAll],
  );

  const removeProduct = useCallback(async (product: Product) => {
    await deleteRecord(STORES.PRODUCTS, product.id);
    if (product.imageBlobId) {
      await deleteMediaBlob(product.imageBlobId);
    }
    setProducts((prev) => prev.filter((p) => p.id !== product.id));
  }, []);

  const savePromotion = useCallback(async (promo: Promotion) => {
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
  }, []);

  const removePromotion = useCallback(async (id: string) => {
    await deleteRecord(STORES.PROMOTIONS, id);
    setPromotions((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const saveCustomer = useCallback(async (customer: Customer) => {
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
  }, []);

  const removeCustomer = useCallback(async (id: string) => {
    await deleteRecord(STORES.CUSTOMERS, id);
    setCustomers((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addSale = useCallback(
    async (sale: Sale) => {
      await recordSaleWithStockDeduction(sale);
      playSaleFeedbackBeep(proSettings.soundFeedback);
      await reloadAll();
    },
    [reloadAll, proSettings.soundFeedback],
  );

  const removeSale = useCallback(async (id: string) => {
    await deleteRecord(STORES.SALES, id);
    setSales((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const saveOrder = useCallback(async (order: Order) => {
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
  }, []);

  const removeOrder = useCallback(async (id: string) => {
    await deleteRecord(STORES.ORDERS, id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

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
    },
    [reloadAll, proSettings.receiptPrefix, proSettings.soundFeedback],
  );

  const saveCatalog = useCallback(async (catalog: SavedCatalog) => {
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
  }, []);

  const removeCatalog = useCallback(async (id: string) => {
    await deleteRecord(STORES.CATALOGS, id);
    setCatalogs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const saveExpense = useCallback(async (expense: Expense) => {
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
  }, []);

  const removeExpense = useCallback(async (id: string) => {
    await deleteRecord(STORES.EXPENSES, id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const addCreditTransaction = useCallback(
    async (entry: CreditTransaction) => {
      await recordCreditLedgerEntry(entry);
      await reloadAll();
    },
    [reloadAll],
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
    async (pin: string): Promise<{ok: boolean; error?: string; lockedUntil?: number}> => {
      const cooldown = getLockCooldownState();
      if (cooldown.lockedUntil > Date.now()) {
        return {
          ok: false,
          error: 'Trop de tentatives. Patientez quelques secondes.',
          lockedUntil: cooldown.lockedUntil,
        };
      }
      const valid = await verifyPinCode(pin, securitySettings.pinHash, securitySettings.pinSalt);
      if (valid) {
        clearPinCooldown();
        lastActivityRef.current = Date.now();
        setIsLocked(false);
        logSecurityEvent('Déverrouillage', 'Session déverrouillée par code PIN');
        return {ok: true};
      }
      const nextCool = recordFailedPinAttempt();
      logSecurityEvent('Alerte sécurité', `Code PIN incorrect (tentative #${nextCool.attempts})`);
      return {
        ok: false,
        error:
          nextCool.lockedUntil > Date.now()
            ? '5 tentatives échouées : verrouillage temporaire de 30 secondes.'
            : 'Code PIN incorrect.',
        lockedUntil: nextCool.lockedUntil,
      };
    },
    [securitySettings.pinHash, securitySettings.pinSalt, logSecurityEvent],
  );

  const verifyCurrentPin = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!securitySettings.pinEnabled) return true;
      return verifyPinCode(pin, securitySettings.pinHash, securitySettings.pinSalt);
    },
    [securitySettings.pinEnabled, securitySettings.pinHash, securitySettings.pinSalt],
  );

  const lockAppNow = useCallback(() => {
    if (!securitySettings.pinEnabled) return;
    setIsLocked(true);
    logSecurityEvent('Verrouillage', 'Application verrouillée manuellement');
  }, [securitySettings.pinEnabled, logSecurityEvent]);

  const enablePinLock = useCallback(
    async (pin: string) => {
      const {hash, salt} = await hashPinCode(pin);
      const next: AppSecuritySettings = {
        ...securitySettings,
        pinEnabled: true,
        pinHash: hash,
        pinSalt: salt,
      };
      saveSecuritySettings(next);
      setSecuritySettings(next);
      clearPinCooldown();
      lastActivityRef.current = Date.now();
      logSecurityEvent('Sécurité PIN', 'Code PIN de verrouillage activé / modifié');
    },
    [securitySettings, logSecurityEvent],
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
    logSecurityEvent('Sécurité PIN', 'Code PIN de verrouillage désactivé');
  }, [securitySettings, logSecurityEvent]);

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
        appMode,
        showOnboardingChoice,
        storeSlots,
        activeStoreId,
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
        securitySettings,
        proSettings,
        securityAuditLog,
        isLocked,
        notify,
        dismissToast,
        reloadAll,
        enterDemoMode,
        resetDemoMode,
        startRealStore,
        switchStore,
        createNewStore,
        removeSecondaryStore,
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
