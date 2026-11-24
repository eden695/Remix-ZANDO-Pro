import React, {useMemo, useState} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CreditCard,
  Database,
  Info,
  Package,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {useStore} from '../context/StoreContext';
import {AppNotification, NotificationCategory} from '../types/commerce';
import {formatDateTime} from '../utils/format';

interface NotificationCenterModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

function getCategoryIcon(category: NotificationCategory) {
  switch (category) {
    case 'stock':
      return Package;
    case 'credit':
      return CreditCard;
    case 'order':
      return ShoppingBag;
    case 'backup':
      return Database;
    case 'security':
      return ShieldAlert;
    case 'transfer':
      return Sparkles;
    default:
      return Info;
  }
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  open,
  onClose,
  onNavigate,
}) => {
  const {
    notifications,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
    clearReadNotifications,
  } = useStore();
  const [filter, setFilter] = useState<'all' | 'unread' | NotificationCategory>('all');

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.read;
      if (filter !== 'all') return n.category === filter;
      return true;
    });
  }, [notifications, filter]);

  const handleAction = (n: AppNotification) => {
    markNotificationRead(n.id);
    if (n.actionRoute) {
      onNavigate(n.actionRoute);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Centre de notifications">
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.2}}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/55 backdrop-blur-xs"
          />

          <motion.aside
            initial={{x: '100%'}}
            animate={{x: 0}}
            exit={{x: '100%'}}
            transition={{type: 'spring', damping: 30, stiffness: 320}}
            className="relative z-10 w-full max-w-md h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    Notifications ({unreadNotificationsCount} non lue{unreadNotificationsCount > 1 ? 's' : ''})
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Alertes stock, crédits, commandes, sécurité & transferts
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Fermer les notifications"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filters & quick actions */}
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 space-y-2 shrink-0 bg-slate-50/60 dark:bg-slate-950/40">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    {id: 'all', label: 'Toutes'},
                    {id: 'unread', label: 'Non lues'},
                    {id: 'stock', label: 'Stock'},
                    {id: 'credit', label: 'Crédits'},
                    {id: 'order', label: 'Commandes'},
                    {id: 'security', label: 'Sécurité'},
                    {id: 'transfer', label: 'Boutiques'},
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                      filter === item.id
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Tout marquer comme lu</span>
                </button>
                <button
                  type="button"
                  onClick={clearReadNotifications}
                  className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Effacer l’historique lu</span>
                </button>
              </div>
            </div>

            {/* Notification items */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filtered.length === 0 ? (
                <div className="text-center py-12 px-4 space-y-2">
                  <Bell className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Aucune notification dans cette vue
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    ZANDO Pro vous alerte automatiquement dès qu’un stock baisse, qu’un crédit arrive à échéance ou qu’une opération importante survient.
                  </p>
                </div>
              ) : (
                filtered.map((n) => {
                  const Icon = getCategoryIcon(n.category);
                  const severityBadge =
                    n.severity === 'urgent'
                      ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900'
                      : n.severity === 'warning'
                        ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900'
                        : n.severity === 'success'
                          ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900'
                          : 'text-sky-600 bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-900';

                  return (
                    <div
                      key={n.id}
                      onClick={() => !n.read && markNotificationRead(n.id)}
                      className={`rounded-2xl border p-3.5 transition-colors ${
                        n.read
                          ? 'border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 opacity-75'
                          : 'border-slate-300 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/50 shadow-xs'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${severityBadge}`}
                        >
                          {n.severity === 'urgent' ? (
                            <AlertTriangle className="w-4 h-4" />
                          ) : (
                            <Icon className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                              {!n.read && (
                                <span
                                  className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle"
                                  aria-label="Non lue"
                                />
                              )}
                              {n.title}
                            </div>
                            <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                              {formatDateTime(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {n.message}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {n.actionRoute && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(n);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-semibold cursor-pointer"
                              >
                                {n.actionLabel || 'Ouvrir'}
                              </button>
                            )}
                            {!n.read && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markNotificationRead(n.id);
                                }}
                                className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer"
                              >
                                Marquer lu
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};
