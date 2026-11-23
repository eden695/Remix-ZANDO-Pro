import React, {useMemo, useState} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Compass,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  MessageSquareText,
  Package,
  Plus,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {BlobImage} from '../components/BlobImage';
import {useStore} from '../context/StoreContext';
import {MAX_STORES} from '../db/indexedDb';
import {computeCreditSummaries} from '../services/creditEngine';
import {calculateFinanceSummary} from '../services/financeEngine';
import {loadSampleCommerceData} from '../services/seedService';
import {formatDateTime, formatMoney, getContrastTextColor, isPromotionCurrentlyActive} from '../utils/format';

export type ModuleRoute =
  | 'dashboard'
  | 'products'
  | 'sales'
  | 'finances'
  | 'credits'
  | 'assistant'
  | 'orders'
  | 'customers'
  | 'promotions'
  | 'catalogs'
  | 'social'
  | 'store'
  | 'backup';

interface DashboardModuleProps {
  onNavigate: (route: ModuleRoute) => void;
  onQuickSale: () => void;
  onQuickProduct: () => void;
  onOpenGuide: () => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  onNavigate,
  onQuickSale,
  onQuickProduct,
  onOpenGuide,
}) => {
  const {
    appMode,
    storeProfile,
    products,
    sales,
    orders,
    customers,
    promotions,
    expenses,
    creditTransactions,
    schemaMeta,
    storeSlots,
    securitySettings,
    updateSecuritySettings,
    reloadAll,
    notify,
  } = useStore();
  const [seeding, setSeeding] = useState(false);

  const backupDue = useMemo(() => {
    if (!securitySettings.backupReminderDays || securitySettings.backupReminderDays <= 0) {
      return false;
    }
    if (products.length === 0 && sales.length === 0) return false;
    const lastBackup = schemaMeta?.lastBackupAt ?? 0;
    if (!lastBackup) return true;
    return Date.now() - lastBackup > securitySettings.backupReminderDays * 86400000;
  }, [securitySettings.backupReminderDays, products.length, sales.length, schemaMeta?.lastBackupAt]);

  const metrics = useMemo(() => {
    const monthFinance = calculateFinanceSummary({
      sales,
      products,
      expenses,
      creditTransactions,
      period: 'month',
    });
    const {kpis: creditKpis} = computeCreditSummaries(customers, creditTransactions);
    const activeOrders = orders.filter(
      (o) => o.status === 'pending' || o.status === 'confirmed' || o.status === 'delivering',
    );
    const lowStockProducts = products.filter((p) => p.isActive && p.stock <= p.lowStockThreshold);
    const inventoryValue = products.reduce((acc, p) => acc + p.price * Math.max(0, p.stock), 0);
    const activePromos = promotions.filter((p) => isPromotionCurrentlyActive(p));

    return {
      monthRevenue: monthFinance.netRevenue,
      monthNetProfit: monthFinance.netProfit,
      remainingDebt: creditKpis.totalRemainingToRecover,
      debtorCount: creditKpis.debtorCount,
      activeOrdersCount: activeOrders.length,
      lowStockProducts,
      inventoryValue,
      activePromosCount: activePromos.length,
    };
  }, [sales, orders, products, promotions, expenses, creditTransactions, customers]);

  const handleLoadSample = async () => {
    try {
      setSeeding(true);
      await loadSampleCommerceData();
      await reloadAll();
      notify('Boutique exemple chargée dans IndexedDB.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors du chargement.', 'error');
    } finally {
      setSeeding(false);
    }
  };

  const isEmptyWorkspace = products.length === 0 && sales.length === 0 && orders.length === 0;
  const accentColor = storeProfile.accentColor || '#059669';
  const accentFg = getContrastTextColor(accentColor);

  return (
    <div className="space-y-6">
      {/* Merchant Store Banner Card */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="h-2 w-full" style={{backgroundColor: accentColor}} />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0">
              <BlobImage
                blobId={storeProfile.logoBlobId}
                alt={storeProfile.name}
                fallbackLabel={storeProfile.name.slice(0, 2).toUpperCase()}
              />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Boutique active · {storeProfile.currency}
                {appMode === 'real' && ` · ${storeSlots.length}/${MAX_STORES} boutiques`}
                {appMode === 'demo' && ' · Données de démonstration'}
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">
                {storeProfile.name}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1">
                {storeProfile.description || 'Configurez l’identité et les coordonnées de votre boutique.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                updateSecuritySettings({
                  privacyModeEnabled: !securitySettings.privacyModeEnabled,
                })
              }
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              title={
                securitySettings.privacyModeEnabled
                  ? 'Afficher les montants financiers'
                  : 'Masquer les montants financiers (Mode Discret)'
              }
            >
              {securitySettings.privacyModeEnabled ? (
                <Eye className="w-4 h-4 text-emerald-600" />
              ) : (
                <EyeOff className="w-4 h-4 text-slate-500" />
              )}
              <span className="hidden sm:inline">
                {securitySettings.privacyModeEnabled ? 'Afficher montants' : 'Mode discret'}
              </span>
            </button>
            {appMode === 'demo' && (
              <button
                type="button"
                onClick={onOpenGuide}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Compass className="w-4 h-4 text-emerald-600" />
                <span>Guide interactif</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('store')}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Identité boutique
            </button>
            <button
              type="button"
              onClick={onQuickSale}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-opacity hover:opacity-95 cursor-pointer"
              style={{backgroundColor: accentColor, color: accentFg}}
            >
              <Plus className="w-4 h-4" />
              <span>Nouvelle vente</span>
            </button>
          </div>
        </div>
      </section>

      {backupDue && (
        <section className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm text-amber-950 dark:text-amber-100">
              <div className="font-bold">Rappel de sauvegarde recommandé</div>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                {schemaMeta?.lastBackupAt
                  ? `Dernière sauvegarde le ${formatDateTime(schemaMeta.lastBackupAt)} (rappel tous les ${securitySettings.backupReminderDays} jours).`
                  : 'Aucune sauvegarde chiffrée ou JSON enregistrée récemment sur cet appareil.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('backup')}
            className="min-h-[40px] px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sauvegarder maintenant
          </button>
        </section>
      )}

      {isEmptyWorkspace && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Démarrer votre espace commercial hors ligne
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Toutes vos données sont stockées localement sur votre appareil via IndexedDB et fonctionnent sans connexion Internet. Ajoutez votre premier produit ou importez un fichier Excel/CSV.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onQuickProduct}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
              style={{backgroundColor: accentColor, color: accentFg}}
            >
              <Plus className="w-4 h-4" />
              <span>Ajouter mon premier produit</span>
            </button>
            <button
              type="button"
              onClick={handleLoadSample}
              disabled={seeding}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              <span>{seeding ? 'Chargement...' : 'Charger des produits exemples'}</span>
            </button>
          </div>
        </section>
      )}

      {/* 4-column KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums">
        <div
          onClick={() => onNavigate('finances')}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 cursor-pointer hover:border-emerald-500/40 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Bénéfice net (ce mois)</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {securitySettings.privacyModeEnabled
              ? '••••'
              : formatMoney(metrics.monthNetProfit, storeProfile.currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            CA mois :{' '}
            {securitySettings.privacyModeEnabled
              ? '••••'
              : formatMoney(metrics.monthRevenue, storeProfile.currency)}
          </div>
        </div>

        <div
          onClick={() => onNavigate('credits')}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 cursor-pointer hover:border-emerald-500/40 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Créances à récupérer</span>
            <CreditCard className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            {securitySettings.privacyModeEnabled
              ? '••••'
              : formatMoney(metrics.remainingDebt, storeProfile.currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics.debtorCount} client{metrics.debtorCount > 1 ? 's' : ''} endetté{metrics.debtorCount > 1 ? 's' : ''}
          </div>
        </div>

        <div
          onClick={() => onNavigate('products')}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 cursor-pointer hover:border-emerald-500/40 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Produits & Stock</span>
            <Package className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            {products.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            Valeur :{' '}
            {securitySettings.privacyModeEnabled
              ? '••••'
              : formatMoney(metrics.inventoryValue, storeProfile.currency)}
          </div>
        </div>

        <div
          onClick={() => onNavigate('assistant')}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 cursor-pointer hover:border-emerald-500/40 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Assistant local</span>
            <MessageSquareText className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-sm sm:text-base font-bold text-slate-900 dark:text-white">
            Poser une question
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics.activeOrdersCount} cmd · {metrics.activePromosCount} promo{metrics.activePromosCount > 1 ? 's' : ''}
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('finances')}
          className="flex items-center gap-3 min-h-[56px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500/50 text-left transition-colors cursor-pointer"
        >
          <TrendingUp className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Bénéfices réels</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Marges & dépenses</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('credits')}
          className="flex items-center gap-3 min-h-[56px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500/50 text-left transition-colors cursor-pointer"
        >
          <CreditCard className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Crédits clients</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Dettes & avances</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('catalogs')}
          className="flex items-center gap-3 min-h-[56px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500/50 text-left transition-colors cursor-pointer"
        >
          <BookOpen className="w-5 h-5 text-slate-700 dark:text-slate-200 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Catalogues</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">HTML & PDF</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('backup')}
          className="flex items-center gap-3 min-h-[56px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-500/50 text-left transition-colors cursor-pointer"
        >
          <Database className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Sauvegarde</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Exporter JSON</div>
          </div>
        </button>
      </section>

      {/* Two-Column Detail Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Alertes de stock</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline min-h-[40px] cursor-pointer"
            >
              <span>Voir le stock</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {metrics.lowStockProducts.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
              Aucun produit sous le seuil d’alerte actuellement.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.lowStockProducts.slice(0, 5).map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {p.category} · Seuil {p.lowStockThreshold}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-bold tabular-nums shrink-0 ${
                      p.stock <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {p.stock <= 0 ? 'Rupture (0)' : `${p.stock} ${p.unit}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Dernières ventes
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline min-h-[40px] cursor-pointer"
            >
              <span>Historique</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {sales.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
              Aucune vente enregistrée pour le moment.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {sales.slice(0, 5).map((sale) => (
                <div key={sale.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {sale.customerName || 'Client comptoir'}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {sale.receiptNumber} · {sale.channel} · {formatDateTime(sale.createdAt)}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                    {securitySettings.privacyModeEnabled
                      ? '••••'
                      : formatMoney(sale.total, storeProfile.currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
