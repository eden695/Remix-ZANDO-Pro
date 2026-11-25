/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {
  Bell,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Compass,
  CreditCard,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  Percent,
  Plus,
  RotateCcw,
  Settings,
  Share2,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import {InitialSyncScreen} from './components/InitialSyncScreen';
import {AppLockOverlay} from './components/AppLockOverlay';
import {DemoOnboardingOverlay} from './components/DemoOnboardingOverlay';
import {NotificationCenterModal} from './components/NotificationCenterModal';
import {SheetModal} from './components/SheetModal';
import {ToastBanner} from './components/ToastBanner';
import {ZandoLogo} from './components/ZandoLogo';
import {StoreProvider, useStore} from './context/StoreContext';
import {getActiveStoreSlot} from './db/indexedDb';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {AssistantModule} from './modules/AssistantModule';
import {BackupSystemModule} from './modules/BackupSystemModule';
import {CatalogsModule} from './modules/CatalogsModule';
import {CreditsModule} from './modules/CreditsModule';
import {CustomersModule} from './modules/CustomersModule';
import {DashboardModule, ModuleRoute} from './modules/DashboardModule';
import {FinancesModule} from './modules/FinancesModule';
import {OrdersModule} from './modules/OrdersModule';
import {ProductsModule} from './modules/ProductsModule';
import {PromotionsModule} from './modules/PromotionsModule';
import {SalesModule} from './modules/SalesModule';
import {SocialShareModule} from './modules/SocialShareModule';
import {StoreIdentityModule} from './modules/StoreIdentityModule';
import {StorePermissions} from './types/commerce';

interface NavItemConfig {
  id: ModuleRoute;
  label: string;
  subtitle: string;
  group: 'operations' | 'growth' | 'system';
  icon: React.ComponentType<{className?: string}>;
  requiredPerm?: keyof StorePermissions;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    subtitle: 'Vue globale & indicateurs clés',
    group: 'operations',
    icon: LayoutDashboard,
  },
  {
    id: 'products',
    label: 'Produits & Stock',
    subtitle: 'Articles, prix, photos & seuils',
    group: 'operations',
    icon: Package,
    requiredPerm: 'canManageProducts',
  },
  {
    id: 'sales',
    label: 'Ventes & Caisse',
    subtitle: 'Encaissements & tickets PDF',
    group: 'operations',
    icon: ShoppingCart,
    requiredPerm: 'canRecordSales',
  },
  {
    id: 'orders',
    label: 'Commandes',
    subtitle: 'Suivi clients & livraisons',
    group: 'operations',
    icon: ClipboardList,
    requiredPerm: 'canManageOrders',
  },
  {
    id: 'finances',
    label: 'Bénéfices & Dépenses',
    subtitle: 'Marges, charges & trésorerie',
    group: 'operations',
    icon: TrendingUp,
    requiredPerm: 'canViewFinances',
  },
  {
    id: 'credits',
    label: 'Crédits Clients',
    subtitle: 'Dettes, avances & échéances',
    group: 'growth',
    icon: CreditCard,
    requiredPerm: 'canManageCustomersCredits',
  },
  {
    id: 'customers',
    label: 'Clients',
    subtitle: 'Répertoire & historique d’achats',
    group: 'growth',
    icon: Users,
    requiredPerm: 'canManageCustomersCredits',
  },
  {
    id: 'promotions',
    label: 'Promotions',
    subtitle: 'Remises & campagnes actives',
    group: 'growth',
    icon: Percent,
    requiredPerm: 'canManageProducts',
  },
  {
    id: 'catalogs',
    label: 'Catalogues HTML / PDF',
    subtitle: 'Vitrines autonomes partageables',
    group: 'growth',
    icon: BookOpen,
    requiredPerm: 'canManageCatalogs',
  },
  {
    id: 'social',
    label: 'Publication Sociale',
    subtitle: 'WhatsApp, Facebook, Instagram',
    group: 'growth',
    icon: Share2,
    requiredPerm: 'canManageCatalogs',
  },
  {
    id: 'assistant',
    label: 'Assistant Local',
    subtitle: 'Analyses & meilleures heures',
    group: 'growth',
    icon: MessageSquareText,
  },
  {
    id: 'store',
    label: 'Identité Boutique',
    subtitle: 'Logo, bannière, couleurs & coordonnées',
    group: 'system',
    icon: Store,
    requiredPerm: 'canManageSettings',
  },
  {
    id: 'backup',
    label: 'Paramètres & Sauvegarde',
    subtitle: 'Boutiques, thème, discret, sécurité & à propos',
    group: 'system',
    icon: Settings,
  },
];

const DRAWER_GROUPS: Array<{key: NavItemConfig['group']; title: string}> = [
  {key: 'operations', title: 'Activité & Caisse'},
  {key: 'growth', title: 'Clients, Catalogues & Assistant'},
  {key: 'system', title: 'Configuration & Paramètres'},
];

const ZandoShell: React.FC = () => {
  const {
    loading,
    error,
    syncChecking,
    initialSyncRecord,
    completeInitialSync,
    appMode,
    storeProfile,
    activeStoreSlot,
    activePermissions,
    securitySettings,
    unreadNotificationsCount,
    reloadAll,
    resetDemoMode,
    startRealStore,
    lockAppNow,
    notify,
  } = useStore();
  const isOnline = useOnlineStatus();

  const [route, setRoute] = useState<ModuleRoute>('dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [leaveDemoConfirmOpen, setLeaveDemoConfirmOpen] = useState(false);
  const [quickSaleTrigger, setQuickSaleTrigger] = useState(0);
  const [quickProductTrigger, setQuickProductTrigger] = useState(0);

  const visibleNavItems = useMemo(() => {
    return NAV_ITEMS.filter((item) => {
      if (!item.requiredPerm) return true;
      return activePermissions[item.requiredPerm];
    });
  }, [activePermissions]);

  useEffect(() => {
    const allowed = visibleNavItems.some((i) => i.id === route);
    if (!allowed) {
      setRoute('dashboard');
    }
  }, [visibleNavItems, route]);

  const activeNav = NAV_ITEMS.find((n) => n.id === route) ?? NAV_ITEMS[0];

  const handleNavigate = useCallback((next: ModuleRoute | string) => {
    setRoute(next as ModuleRoute);
    setMoreOpen(false);
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  const triggerQuickSale = useCallback(() => {
    if (!activePermissions.canRecordSales) {
      notify('Votre rôle en collaboration ne permet pas d’enregistrer des ventes.', 'error');
      return;
    }
    setRoute('sales');
    setMoreOpen(false);
    setQuickSaleTrigger((n) => n + 1);
  }, [activePermissions.canRecordSales, notify]);

  const triggerQuickProduct = useCallback(() => {
    if (!activePermissions.canManageProducts) {
      notify('Votre rôle en collaboration ne permet pas de modifier les produits.', 'error');
      return;
    }
    setRoute('products');
    setMoreOpen(false);
    setQuickProductTrigger((n) => n + 1);
  }, [activePermissions.canManageProducts, notify]);

  const consumeQuickSaleTrigger = useCallback(() => setQuickSaleTrigger(0), []);
  const consumeQuickProductTrigger = useCallback(() => setQuickProductTrigger(0), []);

  if (syncChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 gap-4">
        <ZandoLogo />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Vérification de la synchronisation locale...
        </p>
      </div>
    );
  }

  if (!initialSyncRecord) {
    return (
      <>
        <InitialSyncScreen onSyncCompleted={completeInitialSync} />
        <ToastBanner />
      </>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 gap-4">
        <ZandoLogo />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Ouverture de votre espace local IndexedDB...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 text-center gap-4">
        <ZandoLogo />
        <div className="max-w-md rounded-2xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 p-6 space-y-3">
          <h1 className="text-base font-bold text-slate-900 dark:text-white">
            Base locale inaccessible
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
          <button
            type="button"
            onClick={reloadAll}
            className="min-h-[44px] px-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  const isMoreRouteActive = [
    'credits',
    'assistant',
    'orders',
    'customers',
    'promotions',
    'catalogs',
    'social',
    'store',
    'backup',
  ].includes(route);

  const isCollabStore = appMode !== 'demo' && activeStoreSlot?.role === 'collaborator';
  const currentStoreTitle =
    appMode === 'demo' ? 'Mode Démonstration' : activeStoreSlot?.name || storeProfile.name;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-30">
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          <ZandoLogo />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Navigation principale">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 min-h-[42px] px-3.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Minimal Active Store Status & Session Lock Footer */}
        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
          <div className="px-1">
            <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Boutique ouverte
            </div>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
              {currentStoreTitle} · {storeProfile.currency}
            </div>
          </div>

          {securitySettings.pinEnabled && (
            <button
              type="button"
              onClick={lockAppNow}
              className="w-full flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              title="Verrouiller la session maintenant"
            >
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>Verrouiller l’app</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Single-row Sticky Top App Bar */}
        <header className="sticky top-0 z-20 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="lg:hidden">
              <ZandoLogo compact />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
              {activeNav.label}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!isOnline && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-semibold whitespace-nowrap">
                <WifiOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Hors ligne</span>
              </span>
            )}

            {/* Notification Bell with unread badge */}
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label={`Notifications (${unreadNotificationsCount} non lues)`}
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                </span>
              )}
            </button>

            {activePermissions.canRecordSales && (
              <button
                type="button"
                onClick={triggerQuickSale}
                className="hidden sm:inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer"
                style={{
                  backgroundColor: 'var(--brand-accent, #059669)',
                  color: 'var(--brand-accent-fg, #FFFFFF)',
                }}
              >
                <Plus className="w-4 h-4" />
                <span>Vente rapide</span>
              </button>
            )}
          </div>
        </header>

        {/* Demo Mode Isolation Banner */}
        {appMode === 'demo' && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/70 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              Mode Démonstration actif — Données fictives isolées de votre entreprise réelle.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Guide</span>
              </button>
              <button
                type="button"
                onClick={resetDemoMode}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Réinitialiser la démonstration</span>
              </button>
              <button
                type="button"
                onClick={() => setLeaveDemoConfirmOpen(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Créer mon entreprise</span>
              </button>
            </div>
          </div>
        )}

        {/* Collaborator Mode Banner */}
        {isCollabStore && (
          <div className="bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900/70 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-900 dark:text-sky-200">
            <div>
              <strong>Boutique partagée en Collaboration</strong> · Propriétaire :{' '}
              <span className="font-mono">{activeStoreSlot.ownerZandoId}</span> · Accès selon vos droits attribués.
            </div>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 pb-24 lg:pb-8">
          {route === 'dashboard' && (
            <DashboardModule
              onNavigate={handleNavigate}
              onQuickSale={triggerQuickSale}
              onQuickProduct={triggerQuickProduct}
              onOpenGuide={() => setGuideOpen(true)}
            />
          )}
          {route === 'products' && (
            <ProductsModule
              openCreateTrigger={quickProductTrigger}
              onConsumeCreateTrigger={consumeQuickProductTrigger}
            />
          )}
          {route === 'sales' && (
            <SalesModule
              openCreateTrigger={quickSaleTrigger}
              onConsumeCreateTrigger={consumeQuickSaleTrigger}
            />
          )}
          {route === 'finances' && <FinancesModule />}
          {route === 'credits' && <CreditsModule />}
          {route === 'assistant' && <AssistantModule onNavigate={handleNavigate} />}
          {route === 'orders' && <OrdersModule />}
          {route === 'customers' && <CustomersModule />}
          {route === 'promotions' && <PromotionsModule />}
          {route === 'catalogs' && <CatalogsModule />}
          {route === 'social' && <SocialShareModule />}
          {route === 'store' && <StoreIdentityModule />}
          {route === 'backup' && (
            <BackupSystemModule onOpenGuide={() => setGuideOpen(true)} />
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Thumb-Zone Navigation */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 h-16 pb-safe"
        aria-label="Navigation mobile"
      >
        {(
          [
            {id: 'dashboard', label: 'Accueil', icon: LayoutDashboard},
            {id: 'products', label: 'Produits', icon: Package},
            {id: 'sales', label: 'Ventes', icon: ShoppingCart},
            {id: 'finances', label: 'Bénéfices', icon: TrendingUp},
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = route === tab.id;
          const disabled =
            tab.id === 'products'
              ? !activePermissions.canManageProducts
              : tab.id === 'sales'
                ? !activePermissions.canRecordSales
                : tab.id === 'finances'
                  ? !activePermissions.canViewFinances
                  : false;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              onClick={() => handleNavigate(tab.id)}
              className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-35 ${
                active
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span className="truncate max-w-full px-1">{tab.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`flex flex-col items-center justify-center min-h-[44px] text-[11px] font-semibold transition-colors cursor-pointer ${
            isMoreRouteActive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Menu className="w-5 h-5 mb-0.5" />
          <span>Plus</span>
        </button>
      </nav>

      {/* Modern Right-to-Left Sliding Navigation Drawer */}
      <AnimatePresence>
        {moreOpen && (
          <div
            className="fixed inset-0 z-50 flex justify-end"
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navigation ZANDO Pro"
          >
            {/* Backdrop */}
            <motion.div
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              transition={{duration: 0.22, ease: 'easeOut'}}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            />

            {/* Sliding Panel from Right to Left */}
            <motion.aside
              initial={{x: '100%'}}
              animate={{x: 0}}
              exit={{x: '100%'}}
              transition={{type: 'spring', damping: 30, stiffness: 320, mass: 0.9}}
              className="relative z-10 w-[86vw] max-w-[372px] h-full bg-slate-50 dark:bg-slate-950 rounded-l-3xl border-l border-slate-200/90 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Modern Drawer Header */}
              <div className="px-5 pt-4 pb-3.5 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <ZandoLogo compact />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {currentStoreTitle}
                    </div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      {appMode === 'demo' ? 'Espace démo isolé' : 'Espace local actif'} ·{' '}
                      {storeProfile.currency}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="min-h-[44px] min-w-[44px] rounded-2xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  aria-label="Fermer le menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Quick POS Actions Strip */}
              {(activePermissions.canRecordSales || securitySettings.pinEnabled) && (
                <div className="px-4 pt-3.5 pb-1 flex gap-2 shrink-0">
                  {activePermissions.canRecordSales && (
                    <button
                      type="button"
                      onClick={triggerQuickSale}
                      className="flex-1 min-h-[44px] px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-opacity hover:opacity-95"
                      style={{
                        backgroundColor: 'var(--brand-accent, #059669)',
                        color: 'var(--brand-accent-fg, #FFFFFF)',
                      }}
                    >
                      <Plus className="w-4 h-4" />
                      <span>Nouvelle vente</span>
                    </button>
                  )}
                  {securitySettings.pinEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        lockAppNow();
                      }}
                      className="min-h-[44px] px-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                      aria-label="Verrouiller l’application"
                    >
                      <Lock className="w-4 h-4 text-amber-600" />
                      {!activePermissions.canRecordSales && <span>Verrouiller</span>}
                    </button>
                  )}
                </div>
              )}

              {/* Grouped Interactive Module Tap Lists */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
                {DRAWER_GROUPS.map((grp) => {
                  const items = visibleNavItems.filter((item) => item.group === grp.key);
                  if (items.length === 0) return null;
                  return (
                    <section key={grp.key} className="space-y-1.5">
                      <h3 className="px-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {grp.title}
                      </h3>
                      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden shadow-2xs">
                        {items.map((item) => {
                          const Icon = item.icon;
                          const active = route === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleNavigate(item.id)}
                              className={`w-full flex items-center gap-3 min-h-[54px] px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                                active
                                  ? 'bg-emerald-50/90 dark:bg-emerald-950/35'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 active:bg-slate-100 dark:active:bg-slate-800'
                              }`}
                            >
                              <span
                                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                                  active
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                <Icon className="w-4 h-4" />
                              </span>
                              <span className="flex-1 min-w-0">
                                <span
                                  className={`block text-[13px] font-bold truncate ${
                                    active
                                      ? 'text-emerald-800 dark:text-emerald-300'
                                      : 'text-slate-900 dark:text-slate-100'
                                  }`}
                                >
                                  {item.label}
                                </span>
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {item.subtitle}
                                </span>
                              </span>
                              <ChevronRight
                                className={`w-4 h-4 shrink-0 ${
                                  active
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-300 dark:text-slate-600'
                                }`}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>

              {/* Clean Offline Footer */}
              <div className="px-5 py-3 bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center justify-between shrink-0">
                <span>ZANDO Pro</span>
                <span>Synchronisé · Prêt hors ligne</span>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Leave Demo Confirmation Modal */}
      <SheetModal
        open={leaveDemoConfirmOpen}
        onClose={() => setLeaveDemoConfirmOpen(false)}
        title="Quitter le mode démonstration ?"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Vous allez passer vers votre espace boutique réel (<strong>{getActiveStoreSlot().dbName}</strong>). Aucune donnée fictive de la démonstration ne sera importée dans votre entreprise réelle.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setLeaveDemoConfirmOpen(false)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
            >
              Rester en démo
            </button>
            <button
              type="button"
              onClick={async () => {
                setLeaveDemoConfirmOpen(false);
                await startRealStore();
                handleNavigate('store');
              }}
              className="min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold cursor-pointer"
            >
              Configurer mon entreprise
            </button>
          </div>
        </div>
      </SheetModal>

      <NotificationCenterModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onNavigate={handleNavigate}
      />

      <DemoOnboardingOverlay
        guideOpen={guideOpen}
        onCloseGuide={() => setGuideOpen(false)}
        onNavigate={handleNavigate}
      />

      <AppLockOverlay />

      <ToastBanner />
    </div>
  );
};

export default function App() {
  return (
    <StoreProvider>
      <ZandoShell />
    </StoreProvider>
  );
}
