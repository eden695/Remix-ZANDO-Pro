import {computeCreditSummaries} from './creditEngine';
import {
  AppNotification,
  AppSecuritySettings,
  CreditTransaction,
  Customer,
  Order,
  Product,
  Sale,
  SchemaMeta,
  StoreSlot,
} from '../types/commerce';
import {formatMoney, generateId} from '../utils/format';

const NOTIFICATIONS_STORAGE_KEY = 'zando_pro_notifications_v1';
const READ_DYNAMIC_IDS_KEY = 'zando_pro_read_dynamic_notifications_v1';

export function getStoredNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredNotifications(items: AppNotification[]): void {
  try {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(items.slice(0, 80)));
  } catch {
    // Ignore quota issues
  }
}

export function getReadDynamicIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_DYNAMIC_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReadDynamicIds(ids: string[]): void {
  try {
    localStorage.setItem(READ_DYNAMIC_IDS_KEY, JSON.stringify(ids.slice(-150)));
  } catch {
    // Ignore quota issues
  }
}

export function appendLocalNotification(
  input: Omit<AppNotification, 'id' | 'createdAt' | 'read'> & {read?: boolean},
  browserEnabled = false,
): AppNotification[] {
  const entry: AppNotification = {
    id: generateId('notif'),
    createdAt: Date.now(),
    read: Boolean(input.read),
    ...input,
  };
  const next = [entry, ...getStoredNotifications()].slice(0, 80);
  saveStoredNotifications(next);
  if (browserEnabled) {
    notifyDesktopIfPermitted(entry.title, entry.message);
  }
  return next;
}

export function buildDynamicStoreAlerts(params: {
  products: Product[];
  sales: Sale[];
  orders: Order[];
  customers: Customer[];
  creditTransactions: CreditTransaction[];
  schemaMeta: SchemaMeta | null;
  securitySettings: AppSecuritySettings;
  currency: string;
  activeStoreSlot?: StoreSlot;
  readDynamicIds: string[];
}): AppNotification[] {
  const {
    products,
    orders,
    customers,
    creditTransactions,
    schemaMeta,
    securitySettings,
    currency,
    activeStoreSlot,
    readDynamicIds,
  } = params;

  const readSet = new Set(readDynamicIds);
  const alerts: AppNotification[] = [];
  const now = Date.now();

  // 1. Ruptures de stock
  const outOfStock = products.filter((p) => p.isActive && p.stock <= 0);
  if (outOfStock.length > 0) {
    const id = `dyn_stock_out_${outOfStock.length}_${outOfStock.map((p) => p.id).slice(0, 3).join('_')}`;
    alerts.push({
      id,
      category: 'stock',
      severity: 'urgent',
      title: `${outOfStock.length} produit${outOfStock.length > 1 ? 's' : ''} en rupture de stock`,
      message: outOfStock
        .slice(0, 3)
        .map((p) => p.name)
        .join(', ') + (outOfStock.length > 3 ? ` (+${outOfStock.length - 3} autres)` : ''),
      createdAt: now - 1000,
      read: readSet.has(id),
      actionRoute: 'products',
      actionLabel: 'Voir le stock',
      dynamic: true,
    });
  }

  // 2. Stock faible
  const lowStock = products.filter(
    (p) => p.isActive && p.stock > 0 && p.stock <= p.lowStockThreshold,
  );
  if (lowStock.length > 0) {
    const id = `dyn_stock_low_${lowStock.length}_${lowStock.map((p) => p.id).slice(0, 3).join('_')}`;
    alerts.push({
      id,
      category: 'stock',
      severity: 'warning',
      title: `${lowStock.length} stock${lowStock.length > 1 ? 's' : ''} critique${lowStock.length > 1 ? 's' : ''}`,
      message: lowStock
        .slice(0, 3)
        .map((p) => `${p.name} (${p.stock} ${p.unit})`)
        .join(' · '),
      createdAt: now - 2000,
      read: readSet.has(id),
      actionRoute: 'products',
      actionLabel: 'Réapprovisionner',
      dynamic: true,
    });
  }

  // 3. Commandes en attente
  const pendingOrders = orders.filter((o) => o.status === 'pending' || o.status === 'confirmed');
  if (pendingOrders.length > 0) {
    const totalPending = pendingOrders.reduce((acc, o) => acc + o.total, 0);
    const id = `dyn_orders_pending_${pendingOrders.length}_${Math.round(totalPending)}`;
    alerts.push({
      id,
      category: 'order',
      severity: 'info',
      title: `${pendingOrders.length} commande${pendingOrders.length > 1 ? 's' : ''} à traiter`,
      message: `Montant cumulé : ${formatMoney(totalPending, currency)} en attente de livraison/encaissement.`,
      createdAt: now - 3000,
      read: readSet.has(id),
      actionRoute: 'orders',
      actionLabel: 'Ouvrir commandes',
      dynamic: true,
    });
  }

  // 4. Crédits clients en retard / impayés
  if (creditTransactions.length > 0) {
    const {kpis} = computeCreditSummaries(customers, creditTransactions);
    if (kpis.overdueCount > 0) {
      const id = `dyn_credit_overdue_${kpis.overdueCount}_${Math.round(kpis.totalRemainingToRecover)}`;
      alerts.push({
        id,
        category: 'credit',
        severity: 'urgent',
        title: `${kpis.overdueCount} créance${kpis.overdueCount > 1 ? 's' : ''} échue${kpis.overdueCount > 1 ? 's' : ''}`,
        message: `Total à recouvrer : ${formatMoney(kpis.totalRemainingToRecover, currency)} auprès de ${kpis.debtorCount} client(s).`,
        createdAt: now - 4000,
        read: readSet.has(id),
        actionRoute: 'credits',
        actionLabel: 'Relancer clients',
        dynamic: true,
      });
    } else if (kpis.totalRemainingToRecover > 0) {
      const id = `dyn_credit_due_${kpis.debtorCount}_${Math.round(kpis.totalRemainingToRecover)}`;
      alerts.push({
        id,
        category: 'credit',
        severity: 'warning',
        title: `Crédits clients en cours (${kpis.debtorCount})`,
        message: `Solde restant à encaisser : ${formatMoney(kpis.totalRemainingToRecover, currency)}.`,
        createdAt: now - 5000,
        read: readSet.has(id),
        actionRoute: 'credits',
        actionLabel: 'Gérer crédits',
        dynamic: true,
      });
    }
  }

  // 5. Rappel de sauvegarde locale
  if (securitySettings.backupReminderDays > 0) {
    const lastBackup = schemaMeta?.lastBackupAt ?? 0;
    const daysSince = lastBackup > 0 ? Math.floor((now - lastBackup) / 86400000) : 999;
    const hasActivity = products.length > 0 || orders.length > 0 || creditTransactions.length > 0;
    if (hasActivity && (lastBackup === 0 || daysSince >= securitySettings.backupReminderDays)) {
      const id = `dyn_backup_due_${lastBackup === 0 ? 'never' : daysSince}`;
      alerts.push({
        id,
        category: 'backup',
        severity: 'warning',
        title:
          lastBackup === 0
            ? 'Aucune sauvegarde locale effectuée'
            : `Sauvegarde recommandée (${daysSince} j sans export)`,
        message:
          'Exportez votre boutique en fichier chiffré (.zando) ou JSON pour protéger vos données hors ligne.',
        createdAt: now - 6000,
        read: readSet.has(id),
        actionRoute: 'backup',
        actionLabel: 'Sauvegarder',
        dynamic: true,
      });
    }
  }

  // 6. Rappel sécurité (verrouillage non configuré)
  if (!securitySettings.pinEnabled) {
    const id = 'dyn_security_nolock';
    alerts.push({
      id,
      category: 'security',
      severity: 'info',
      title: 'Verrouillage d’application désactivé',
      message:
        'Activez un code PIN, un mot de passe ou un schéma dans les Paramètres pour protéger votre caisse.',
      createdAt: now - 7000,
      read: readSet.has(id),
      actionRoute: 'backup',
      actionLabel: 'Configurer sécurité',
      dynamic: true,
    });
  }

  // 7. Statut boutique collaborateur
  if (activeStoreSlot?.role === 'collaborator') {
    const id = `dyn_collab_role_${activeStoreSlot.id}`;
    alerts.push({
      id,
      category: 'transfer',
      severity: 'info',
      title: `Mode Collaboration : ${activeStoreSlot.name}`,
      message: `Accès partagé par ${activeStoreSlot.ownerZandoId || 'le propriétaire'} selon vos autorisations attribuées.`,
      createdAt: now - 8000,
      read: readSet.has(id),
      actionRoute: 'store',
      actionLabel: 'Voir boutique',
      dynamic: true,
    });
  }

  return alerts;
}

export async function requestBrowserNotificationPermission(): Promise<
  'granted' | 'denied' | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  try {
    const result = await Notification.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export function notifyDesktopIfPermitted(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(`ZANDO Pro · ${title}`, {body});
  } catch {
    // Certains navigateurs Android exigent ServiceWorkerRegistration.showNotification
    try {
      navigator.serviceWorker?.getRegistration().then((reg) => {
        reg?.showNotification(`ZANDO Pro · ${title}`, {body});
      });
    } catch {
      // Ignorer sans bloquer l'app hors ligne
    }
  }
}
