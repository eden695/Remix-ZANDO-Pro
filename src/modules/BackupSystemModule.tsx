import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  Compass,
  Database,
  Download,
  EyeOff,
  FileKey2,
  HardDrive,
  History,
  KeyRound,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';
import {ModernSelect} from '../components/ModernSelect';
import {PinConfirmModal} from '../components/PinConfirmModal';
import {SheetModal} from '../components/SheetModal';
import {
  createZandoLogoPngBlob,
  createZandoLogoSvgBlob,
  ZandoLogo,
} from '../components/ZandoLogo';
import {useStore} from '../context/StoreContext';
import {
  APP_VERSION,
  clearStore,
  getStorageDiagnostics,
  MAX_STORES,
  StorageDiagnostic,
  STORES,
} from '../db/indexedDb';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {downloadBlobSafely} from '../services/androidShareService';
import {
  exportFullBackup,
  restoreBackupPayload,
  validateBackupJson,
} from '../services/backupService';
import {clearAllCachedUrls} from '../services/mediaService';
import {checkServerHealth} from '../services/onlineCatalogService';
import {decryptBackupText, encryptBackupText} from '../services/securityService';
import {loadSampleCommerceData} from '../services/seedService';
import {StoreSlot, ZandoBackupPayload} from '../types/commerce';
import {formatBytes, formatDateTime} from '../utils/format';

interface BackupSystemModuleProps {
  onOpenGuide?: () => void;
}

export const BackupSystemModule: React.FC<BackupSystemModuleProps> = ({onOpenGuide}) => {
  const {
    schemaMeta,
    appMode,
    storeSlots,
    activeStoreId,
    securitySettings,
    proSettings,
    securityAuditLog,
    reloadAll,
    enterDemoMode,
    resetDemoMode,
    startRealStore,
    switchStore,
    createNewStore,
    removeSecondaryStore,
    lockAppNow,
    enablePinLock,
    disablePinLock,
    verifyCurrentPin,
    updateSecuritySettings,
    updateProSettings,
    logSecurityEvent,
    clearAuditLog,
    notify,
  } = useStore();
  const isOnline = useOnlineStatus();

  const [diag, setDiag] = useState<StorageDiagnostic | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [swStatus, setSwStatus] = useState<'active' | 'unsupported' | 'pending'>('pending');
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  // Backup / Encrypted export / Restore state
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<ZandoBackupPayload | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [encryptModalOpen, setEncryptModalOpen] = useState(false);
  const [encryptPassphrase, setEncryptPassphrase] = useState('');
  const [encryptPassphraseConfirm, setEncryptPassphraseConfirm] = useState('');
  const [pendingDecryptText, setPendingDecryptText] = useState<string | null>(null);
  const [decryptPassphrase, setDecryptPassphrase] = useState('');
  const [decryptError, setDecryptError] = useState('');

  // Multi-store modal
  const [newStoreModalOpen, setNewStoreModalOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreCurrency, setNewStoreCurrency] = useState('FCFA');
  const [creatingStore, setCreatingStore] = useState(false);
  const [deleteStoreTarget, setDeleteStoreTarget] = useState<StoreSlot | null>(null);

  // PIN config modal
  const [pinModalMode, setPinModalMode] = useState<'enable' | 'change' | 'disable' | null>(null);
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [pinFormError, setPinFormError] = useState('');

  // Pro settings local form state
  const [proDraft, setProDraft] = useState(proSettings);
  const [resetStoreConfirmOpen, setResetStoreConfirmOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProDraft(proSettings);
  }, [proSettings]);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const info = await getStorageDiagnostics();
      setDiag(info);
    } catch {
      // Ignoré
    }
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active) {
          setSwStatus('active');
        } else {
          await navigator.serviceWorker.ready;
          setSwStatus('active');
        }
      } catch {
        setSwStatus('pending');
      }
    } else {
      setSwStatus('unsupported');
    }
    if (navigator.onLine) {
      const health = await checkServerHealth();
      if (health.ok && health.version) {
        setServerVersion(health.version);
      }
    }
    setLastRefreshedAt(Date.now());
  }, []);

  useEffect(() => {
    refreshDiagnostics();
  }, [appMode, activeStoreId, refreshDiagnostics]);

  const handleManualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await reloadAll();
      await refreshDiagnostics();
      notify('Stockage local, état système et données actualisés.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de l’actualisation.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCheckAndApplyUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateNote(null);
    try {
      let appliedSw = false;
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          if (reg.waiting) {
            reg.waiting.postMessage({type: 'SKIP_WAITING'});
            appliedSw = true;
          }
        }
      }

      if (!navigator.onLine) {
        setUpdateNote('Vous êtes hors ligne : impossible de contacter le serveur de mise à jour.');
        notify('Connexion Internet requise pour vérifier les mises à jour.', 'error');
        return;
      }

      const health = await checkServerHealth();
      if (health.ok && health.version) {
        setServerVersion(health.version);
      }

      if (appliedSw) {
        setUpdateNote('Nouvelle mise à jour prête : rechargement de ZANDO Pro...');
        notify('Mise à jour installée ! Rechargement en cours...', 'success');
        setTimeout(() => window.location.reload(), 900);
        return;
      }

      if (health.ok && health.version && health.version !== APP_VERSION) {
        setUpdateNote(
          `Nouvelle version serveur détectée (v${health.version} vs v${APP_VERSION}). Rechargement recommandé.`,
        );
        notify(`Version v${health.version} disponible. Actualisation de la page...`, 'info');
        setTimeout(() => window.location.reload(), 1000);
        return;
      }

      setUpdateNote(`ZANDO Pro est déjà à jour (v${APP_VERSION}).`);
      notify(`Votre application est à jour (v${APP_VERSION}).`, 'success');
    } catch {
      setUpdateNote('Vérification impossible pour le moment.');
      notify('Erreur lors de la vérification de mise à jour.', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const {blob, filename} = await exportFullBackup();
      await downloadBlobSafely(blob, filename);
      await reloadAll();
      await refreshDiagnostics();
      logSecurityEvent('Sauvegarde', `Exportation JSON (${filename})`);
      notify(`Sauvegarde exportée (${filename}).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Échec de l’exportation.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleEncryptedExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (encryptPassphrase.length < 6) {
      notify('Le mot de passe doit contenir au moins 6 caractères.', 'error');
      return;
    }
    if (encryptPassphrase !== encryptPassphraseConfirm) {
      notify('Les deux mots de passe ne correspondent pas.', 'error');
      return;
    }
    setExporting(true);
    try {
      const {payload, filename} = await exportFullBackup();
      const plainJson = JSON.stringify(payload);
      const encrypted = await encryptBackupText(plainJson, encryptPassphrase);
      const encBlob = new Blob([encrypted], {type: 'application/json;charset=utf-8'});
      const encFilename = filename.replace(/\.json$/, '.zando');
      await downloadBlobSafely(encBlob, encFilename);
      setEncryptModalOpen(false);
      setEncryptPassphrase('');
      setEncryptPassphraseConfirm('');
      await reloadAll();
      await refreshDiagnostics();
      logSecurityEvent('Sauvegarde chiffrée', `Exportation AES-256-GCM (${encFilename})`);
      notify(`Sauvegarde chiffrée exportée (${encFilename}).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Échec du chiffrement.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsedPeek = JSON.parse(text) as {format?: string};
      if (parsedPeek?.format === 'zando-pro-encrypted-backup') {
        setPendingDecryptText(text);
        setDecryptPassphrase('');
        setDecryptError('');
        return;
      }
      const validated = validateBackupJson(text);
      setPendingRestore(validated);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Fichier de sauvegarde invalide.', 'error');
    }
  };

  const handleDecryptAndPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingDecryptText) return;
    setDecryptError('');
    try {
      const plainJson = await decryptBackupText(pendingDecryptText, decryptPassphrase);
      const validated = validateBackupJson(plainJson);
      setPendingDecryptText(null);
      setDecryptPassphrase('');
      setPendingRestore(validated);
    } catch (err) {
      setDecryptError(
        err instanceof Error ? err.message : 'Impossible de déchiffrer la sauvegarde.',
      );
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestore) return;
    setRestoring(true);
    try {
      await restoreBackupPayload(pendingRestore, restoreMode);
      await reloadAll();
      await refreshDiagnostics();
      logSecurityEvent(
        'Restauration',
        `Restauration (${restoreMode === 'replace' ? 'remplacement' : 'fusion'}) depuis ${pendingRestore.storeProfile.name}`,
      );
      setPendingRestore(null);
      notify('Sauvegarde restaurée avec succès dans IndexedDB.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de la restauration.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const handleLoadDemoInSpace = async () => {
    await loadSampleCommerceData();
    await reloadAll();
    await refreshDiagnostics();
    notify('Données exemple ajoutées dans cet espace.', 'success');
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim()) {
      notify('Indiquez le nom de la nouvelle boutique.', 'error');
      return;
    }
    setCreatingStore(true);
    try {
      await createNewStore(newStoreName.trim(), newStoreCurrency);
      setNewStoreModalOpen(false);
      setNewStoreName('');
      await refreshDiagnostics();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Impossible d’ouvrir la boutique.', 'error');
    } finally {
      setCreatingStore(false);
    }
  };

  const handlePinFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinFormError('');
    if (pinModalMode === 'change' || pinModalMode === 'disable') {
      const ok = await verifyCurrentPin(currentPinInput);
      if (!ok) {
        setPinFormError('Code PIN actuel incorrect.');
        return;
      }
    }
    if (pinModalMode === 'disable') {
      disablePinLock();
      setPinModalMode(null);
      setCurrentPinInput('');
      notify('Verrouillage par code PIN désactivé.', 'info');
      return;
    }
    if (!/^\d{4,6}$/.test(newPinInput)) {
      setPinFormError('Le code PIN doit contenir entre 4 et 6 chiffres.');
      return;
    }
    if (newPinInput !== confirmPinInput) {
      setPinFormError('Les deux codes PIN ne correspondent pas.');
      return;
    }
    await enablePinLock(newPinInput);
    setPinModalMode(null);
    setCurrentPinInput('');
    setNewPinInput('');
    setConfirmPinInput('');
    notify('Code PIN de sécurité enregistré (hachage PBKDF2-SHA256).', 'success');
  };

  const handleResetActiveStoreData = async () => {
    clearAllCachedUrls();
    const storeNames = [
      STORES.MEDIA_BLOBS,
      STORES.PRODUCTS,
      STORES.PROMOTIONS,
      STORES.CUSTOMERS,
      STORES.SALES,
      STORES.ORDERS,
      STORES.CATALOGS,
      STORES.EXPENSES,
      STORES.CREDIT_TRANSACTIONS,
      STORES.ASSISTANT_MESSAGES,
    ];
    for (const s of storeNames) {
      await clearStore(s);
    }
    await reloadAll();
    await refreshDiagnostics();
    logSecurityEvent('Réinitialisation', 'Données de la boutique active effacées');
    notify('Les données de la boutique active ont été réinitialisées.', 'info');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 1. Bouton Activer / Désactiver Mode Démo & Guide */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-emerald-600" />
              <span>Mode Démonstration & Guide interactif</span>
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              {appMode === 'demo'
                ? 'Le Mode Démonstration est activé sur une base isolée. Désactivez-le à tout moment pour revenir sur vos boutiques réelles.'
                : 'Activez le Mode Démonstration pour tester l’application avec des données fictives sans modifier vos boutiques réelles.'}
            </p>
          </div>

          <button
            type="button"
            onClick={appMode === 'demo' ? startRealStore : enterDemoMode}
            className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              appMode === 'demo'
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {appMode === 'demo' ? (
              <>
                <LogOut className="w-4 h-4" />
                <span>Désactiver la démo</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Activer la démo</span>
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {appMode === 'demo' && (
            <button
              type="button"
              onClick={resetDemoMode}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs sm:text-sm font-semibold cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Réinitialiser les données démo</span>
            </button>
          )}
          {onOpenGuide && (
            <button
              type="button"
              onClick={onOpenGuide}
              className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Compass className="w-4 h-4 text-emerald-600" />
              <span>Ouvrir le Guide interactif</span>
            </button>
          )}
        </div>
      </section>

      {/* 2. Multi-boutiques (jusqu'à 3 boutiques) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Store className="w-4 h-4 text-emerald-600" />
              <span>
                Mes Boutiques ({storeSlots.length} / {MAX_STORES})
              </span>
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Ouvrez jusqu’à {MAX_STORES} boutiques indépendantes avec bases IndexedDB séparées (stocks, ventes, clients et catalogues isolés).
            </p>
          </div>
          <button
            type="button"
            disabled={storeSlots.length >= MAX_STORES}
            onClick={() => setNewStoreModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            <span>
              {storeSlots.length >= MAX_STORES
                ? `Limite atteinte (${MAX_STORES}/${MAX_STORES})`
                : 'Ouvrir une boutique'}
            </span>
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
          {storeSlots.map((slot, idx) => {
            const isActive = appMode !== 'demo' && slot.id === activeStoreId;
            return (
              <div
                key={slot.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span className="truncate">{slot.name}</span>
                    {isActive && (
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        · Active
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Boutique #{idx + 1} · Devise {slot.currency} · {slot.dbName}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => switchStore(slot.id)}
                      className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                    >
                      Basculer
                    </button>
                  )}
                  {idx > 0 && storeSlots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDeleteStoreTarget(slot)}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      aria-label={`Supprimer ${slot.name}`}
                      title="Supprimer cette boutique"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Sécurité & Protection des données */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Sécurité, Verrouillage & Confidentialité</span>
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Protégez l’accès à votre caisse et vos chiffres sensibles par code PIN (hachage PBKDF2-SHA256 salé) et sauvegarde chiffrée AES-256-GCM.
            </p>
          </div>
          {securitySettings.pinEnabled && (
            <button
              type="button"
              onClick={lockAppNow}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Verrouiller maintenant</span>
            </button>
          )}
        </div>

        {/* PIN Controls */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-600" />
              <span>
                Code PIN d’accès :{' '}
                <span
                  className={
                    securitySettings.pinEnabled
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500'
                  }
                >
                  {securitySettings.pinEnabled ? 'Activé' : 'Désactivé'}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verrouillage temporaire de 30s après 5 tentatives erronées.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {!securitySettings.pinEnabled ? (
              <button
                type="button"
                onClick={() => {
                  setPinFormError('');
                  setNewPinInput('');
                  setConfirmPinInput('');
                  setPinModalMode('enable');
                }}
                className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                Configurer un code PIN
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPinFormError('');
                    setCurrentPinInput('');
                    setNewPinInput('');
                    setConfirmPinInput('');
                    setPinModalMode('change');
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer"
                >
                  Modifier PIN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPinFormError('');
                    setCurrentPinInput('');
                    setPinModalMode('disable');
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 text-xs font-semibold cursor-pointer"
                >
                  Désactiver
                </button>
              </>
            )}
          </div>
        </div>

        {/* Security Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Verrouillage auto après inactivité
            </label>
            <ModernSelect
              value={String(securitySettings.autoLockMinutes)}
              onChange={(val) =>
                updateSecuritySettings({autoLockMinutes: Number(val) as 0 | 1 | 5 | 15 | 30})
              }
              options={[
                {value: '0', label: 'Jamais'},
                {value: '1', label: 'Après 1 minute'},
                {value: '5', label: 'Après 5 minutes'},
                {value: '15', label: 'Après 15 minutes'},
                {value: '30', label: 'Après 30 minutes'},
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Rappel de sauvegarde locale
            </label>
            <ModernSelect
              value={String(securitySettings.backupReminderDays)}
              onChange={(val) =>
                updateSecuritySettings({backupReminderDays: Number(val) as 0 | 7 | 14 | 30})
              }
              options={[
                {value: '0', label: 'Désactivé'},
                {value: '7', label: 'Tous les 7 jours'},
                {value: '14', label: 'Tous les 14 jours'},
                {value: '30', label: 'Tous les 30 jours'},
              ]}
            />
          </div>
        </div>

        <div className="space-y-2.5">
          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer">
            <div className="flex items-center gap-2.5 min-w-0">
              <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="text-xs">
                <div className="font-bold text-slate-900 dark:text-white">
                  Mode Discret (masquer les montants sensibles)
                </div>
                <div className="text-slate-500">
                  Remplace le chiffre d’affaires, les bénéfices et les dettes par •••• en public.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={securitySettings.privacyModeEnabled}
              onChange={(e) => updateSecuritySettings({privacyModeEnabled: e.target.checked})}
              className="w-5 h-5 accent-emerald-600 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer">
            <div className="flex items-center gap-2.5 min-w-0">
              <Lock className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="text-xs">
                <div className="font-bold text-slate-900 dark:text-white">
                  Exiger le code PIN pour les actions sensibles
                </div>
                <div className="text-slate-500">
                  Protège la suppression de boutique, la restauration complète et la réinitialisation.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={securitySettings.requirePinForSensitiveActions}
              onChange={(e) =>
                updateSecuritySettings({requirePinForSensitiveActions: e.target.checked})
              }
              className="w-5 h-5 accent-emerald-600 shrink-0"
            />
          </label>
        </div>

        {/* Security Audit Log */}
        {securityAuditLog.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-emerald-600" />
                <span>Journal local d’activité & sécurité</span>
              </span>
              <button
                type="button"
                onClick={clearAuditLog}
                className="text-xs font-semibold text-slate-500 hover:underline cursor-pointer"
              >
                Effacer le journal
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {securityAuditLog.slice(0, 15).map((entry) => (
                <div key={entry.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="text-slate-700 dark:text-slate-300 truncate">
                    <strong>{entry.action}</strong> · {entry.detail}
                  </span>
                  <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                    {formatDateTime(entry.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 4. Paramètres Commerciaux Pro */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-emerald-600" />
          <span>Paramètres commerciaux professionnels</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">Préfixe factures / reçus</label>
            <input
              type="text"
              value={proDraft.receiptPrefix}
              onChange={(e) => setProDraft({...proDraft, receiptPrefix: e.target.value})}
              placeholder="FAC-"
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Préfixe commandes</label>
            <input
              type="text"
              value={proDraft.orderPrefix}
              onChange={(e) => setProDraft({...proDraft, orderPrefix: e.target.value})}
              placeholder="CMD-"
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Seuil alerte stock défaut</label>
            <input
              type="number"
              min="0"
              value={proDraft.defaultLowStockThreshold}
              onChange={(e) =>
                setProDraft({
                  ...proDraft,
                  defaultLowStockThreshold: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">TVA / Taxe défaut (%)</label>
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={proDraft.defaultTaxPercent}
              onChange={(e) =>
                setProDraft({
                  ...proDraft,
                  defaultTaxPercent: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                })
              }
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold mb-1">Message pied de reçu / facture</label>
            <input
              type="text"
              value={proDraft.receiptFooter}
              onChange={(e) => setProDraft({...proDraft, receiptFooter: e.target.value})}
              placeholder="Merci pour votre confiance !"
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>

          <label className="flex items-center justify-between gap-3 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Bip sonore & vibration à la validation d’une vente
            </span>
            <input
              type="checkbox"
              checked={proDraft.soundFeedback}
              onChange={(e) => setProDraft({...proDraft, soundFeedback: e.target.checked})}
              className="w-4 h-4 accent-emerald-600"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              updateProSettings(proDraft);
              notify('Paramètres commerciaux enregistrés.', 'success');
            }}
            className="min-h-[42px] px-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Enregistrer les paramètres Pro
          </button>
        </div>
      </section>

      {/* 5. Sauvegarde & Restauration (JSON + Chiffrée AES-256-GCM) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-600" />
            <span>Sauvegarde et restauration complète</span>
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Exportez vos données complètes (produits, images, ventes, dépenses, crédits, commandes, clients, promotions et catalogues) en JSON standard ou en fichier chiffré par mot de passe (.zando).
          </p>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Base active :{' '}
            <strong className="text-slate-700 dark:text-slate-200">
              {diag?.databaseName || 'zando_pro_local_db'}
            </strong>
          </span>
          {schemaMeta?.lastBackupAt && (
            <span>
              Dernière sauvegarde :{' '}
              <strong className="text-slate-700 dark:text-slate-200">
                {formatDateTime(schemaMeta.lastBackupAt)}
              </strong>
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setEncryptModalOpen(true)}
            disabled={exporting}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <FileKey2 className="w-4 h-4" />
            <span>Exporter chiffrée (.zando)</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Préparation...' : 'Exporter JSON (.json)'}</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Restaurer (.zando / .json)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zando,application/json"
            onChange={handleFileSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={handleLoadDemoInSpace}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-600" />
            <span>Charger exemple ici</span>
          </button>
        </div>
      </section>

      {/* 6. Stockage local, Actualisation & Mise à jour de l'application (SANS bilan boutique) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <span>Système, stockage local & mise à jour</span>
            </h2>
            {lastRefreshedAt && (
              <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                Actualisé à {new Date(lastRefreshedAt).toLocaleTimeString('fr-FR')}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={handleManualRefresh}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Actualisation...' : 'Actualiser'}</span>
            </button>
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={handleCheckAndApplyUpdate}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              <ArrowUpCircle className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-pulse' : ''}`} />
              <span>{checkingUpdate ? 'Vérification...' : 'Mettre à jour l’application'}</span>
            </button>
          </div>
        </div>

        {updateNote && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            {updateNote}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70">
            <div className="text-xs text-slate-500 dark:text-slate-400">Version & réseau</div>
            <div className="mt-1 font-bold text-slate-900 dark:text-white">
              v{APP_VERSION} · {isOnline ? 'En ligne' : 'Hors ligne'}
            </div>
            {serverVersion && (
              <div className="text-[11px] text-slate-500">Serveur v{serverVersion}</div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70">
            <div className="text-xs text-slate-500 dark:text-slate-400">Cache PWA hors ligne</div>
            <div className="mt-1 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              {swStatus === 'active' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              <span>
                {swStatus === 'active'
                  ? 'Actif et prêt hors ligne'
                  : swStatus === 'unsupported'
                    ? 'Non supporté par ce WebView'
                    : 'Initialisation...'}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 tabular-nums">
            <div className="text-xs text-slate-500 dark:text-slate-400">Espace local utilisé</div>
            <div className="mt-1 font-bold text-slate-900 dark:text-white">
              {diag
                ? `${formatBytes(diag.usageBytes)}${diag.quotaBytes ? ` / ${formatBytes(diag.quotaBytes)}` : ''}`
                : 'Calcul...'}
            </div>
            {diag?.isPersisted && (
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Stockage persistant protégé
              </div>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Migrations schéma IndexedDB v{schemaMeta?.currentVersion ?? 2} sans perte de données.
          </span>
          <button
            type="button"
            onClick={() => setResetStoreConfirmOpen(true)}
            className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
          >
            Réinitialiser les données de cette boutique
          </button>
        </div>
      </section>

      {/* 7. Official ZANDO Pro Logo Export */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="space-y-1">
          <ZandoLogo />
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 pt-1">
            Téléchargez directement le logo officiel de <strong>ZANDO Pro</strong> pour vos visuels ou documents.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={async () => {
              try {
                const pngBlob = await createZandoLogoPngBlob(1024);
                await downloadBlobSafely(pngBlob, 'zando-pro-logo-1024.png');
                notify('Logo PNG (1024×1024) téléchargé.', 'success');
              } catch (err) {
                notify(err instanceof Error ? err.message : 'Erreur export PNG.', 'error');
              }
            }}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Logo PNG (1024×1024)</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              const svgBlob = createZandoLogoSvgBlob('icon');
              await downloadBlobSafely(svgBlob, 'zando-pro-icone.svg');
              notify('Icône SVG téléchargée.', 'success');
            }}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Icône (.svg)</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              const svgBlob = createZandoLogoSvgBlob('wordmark');
              await downloadBlobSafely(svgBlob, 'zando-pro-logo-complet.svg');
              notify('Logo complet « ZANDO Pro » (.svg) téléchargé.', 'success');
            }}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Logo complet (.svg)</span>
          </button>
        </div>
      </section>

      {/* Modal: Ouvrir une nouvelle boutique (max 3) */}
      <SheetModal
        open={newStoreModalOpen}
        onClose={() => setNewStoreModalOpen(false)}
        title={`Ouvrir une nouvelle boutique (${storeSlots.length + 1}/${MAX_STORES})`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleCreateStore} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">Nom de la boutique *</label>
            <input
              type="text"
              required
              autoFocus
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              placeholder="Ex : Boutique Gombe, Annexe Matonge..."
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Devise</label>
            <ModernSelect
              value={newStoreCurrency}
              onChange={setNewStoreCurrency}
              options={['FCFA', 'CDF', 'XOF', 'XAF', 'GNF', 'MAD', 'EUR (€)', 'USD ($)'].map(
                (c) => ({value: c, label: c}),
              )}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setNewStoreModalOpen(false)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={creatingStore}
              className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {creatingStore ? 'Création...' : 'Créer et ouvrir'}
            </button>
          </div>
        </form>
      </SheetModal>

      {/* Modal: PIN Enable / Change / Disable */}
      <SheetModal
        open={!!pinModalMode}
        onClose={() => setPinModalMode(null)}
        title={
          pinModalMode === 'enable'
            ? 'Configurer le code PIN'
            : pinModalMode === 'change'
              ? 'Modifier le code PIN'
              : 'Désactiver le code PIN'
        }
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handlePinFormSubmit} className="space-y-4">
          {(pinModalMode === 'change' || pinModalMode === 'disable') && (
            <div>
              <label className="block text-xs font-semibold mb-1">Code PIN actuel *</label>
              <input
                type="password"
                inputMode="numeric"
                required
                value={currentPinInput}
                onChange={(e) => setCurrentPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="4 à 6 chiffres"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tracking-widest"
              />
            </div>
          )}
          {pinModalMode !== 'disable' && (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Nouveau code PIN (4 à 6 chiffres) *
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  value={newPinInput}
                  onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Ex : 2580"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tracking-widest"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  Confirmer le code PIN *
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  value={confirmPinInput}
                  onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Répétez le code PIN"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tracking-widest"
                />
              </div>
            </>
          )}
          {pinFormError && <p className="text-xs font-semibold text-rose-600">{pinFormError}</p>}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setPinModalMode(null)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              className={`min-h-[44px] px-5 rounded-xl text-white text-sm font-semibold cursor-pointer ${
                pinModalMode === 'disable'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              Valider
            </button>
          </div>
        </form>
      </SheetModal>

      {/* Modal: Export Sauvegarde Chiffrée AES-256-GCM */}
      <SheetModal
        open={encryptModalOpen}
        onClose={() => setEncryptModalOpen(false)}
        title="Exporter une sauvegarde chiffrée (.zando)"
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleEncryptedExport} className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Votre sauvegarde sera chiffrée en local (AES-256-GCM + PBKDF2). Choisissez un mot de passe robuste dont vous vous souviendrez lors de la restauration.
          </p>
          <div>
            <label className="block text-xs font-semibold mb-1">
              Mot de passe de chiffrement (6 car. min.) *
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={encryptPassphrase}
              onChange={(e) => setEncryptPassphrase(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Confirmer le mot de passe *</label>
            <input
              type="password"
              required
              minLength={6}
              value={encryptPassphraseConfirm}
              onChange={(e) => setEncryptPassphraseConfirm(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setEncryptModalOpen(false)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={exporting}
              className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {exporting ? 'Chiffrement...' : 'Exporter (.zando)'}
            </button>
          </div>
        </form>
      </SheetModal>

      {/* Modal: Déchiffrer fichier .zando */}
      <SheetModal
        open={!!pendingDecryptText}
        onClose={() => setPendingDecryptText(null)}
        title="Déverrouiller la sauvegarde chiffrée"
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleDecryptAndPreview} className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Ce fichier est chiffré. Saisissez le mot de passe utilisé lors de l’exportation.
          </p>
          <input
            type="password"
            required
            autoFocus
            value={decryptPassphrase}
            onChange={(e) => {
              setDecryptPassphrase(e.target.value);
              setDecryptError('');
            }}
            placeholder="Mot de passe de la sauvegarde"
            className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
          />
          {decryptError && <p className="text-xs font-semibold text-rose-600">{decryptError}</p>}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => setPendingDecryptText(null)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
            >
              Déchiffrer
            </button>
          </div>
        </form>
      </SheetModal>

      {/* Restore Preview Modal */}
      <SheetModal
        open={!!pendingRestore}
        onClose={() => setPendingRestore(null)}
        title="Confirmer la restauration"
        maxWidthClass="max-w-lg"
      >
        {pendingRestore && (
          <div className="space-y-4">
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <div>
                Boutique source : <strong>{pendingRestore.storeProfile.name}</strong>
              </div>
              <div>
                Date d’exportation : <strong>{formatDateTime(pendingRestore.exportedAt)}</strong>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="restoreMode"
                  checked={restoreMode === 'replace'}
                  onChange={() => setRestoreMode('replace')}
                  className="mt-1 accent-emerald-600"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900 dark:text-white">
                    Remplacer toutes les données actuelles
                  </div>
                  <div className="text-slate-500">
                    Restaure exactement l’état de la sauvegarde sur la boutique active.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="restoreMode"
                  checked={restoreMode === 'merge'}
                  onChange={() => setRestoreMode('merge')}
                  className="mt-1 accent-emerald-600"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900 dark:text-white">
                    Fusionner avec les données existantes
                  </div>
                  <div className="text-slate-500">
                    Ajoute les éléments de la sauvegarde sans supprimer vos ajouts récents.
                  </div>
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmRestore}
                disabled={restoring}
                className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                {restoring ? 'Restauration...' : 'Restaurer maintenant'}
              </button>
            </div>
          </div>
        )}
      </SheetModal>

      {/* PIN-Confirmed Delete Store Modal */}
      <PinConfirmModal
        open={!!deleteStoreTarget}
        onClose={() => setDeleteStoreTarget(null)}
        title={`Supprimer « ${deleteStoreTarget?.name ?? ''} » ?`}
        description="Cette opération supprime définitivement la base IndexedDB de cette boutique secondaire (produits, ventes, clients et catalogues associés)."
        confirmLabel="Supprimer la boutique"
        danger
        onConfirm={async () => {
          if (deleteStoreTarget) {
            await removeSecondaryStore(deleteStoreTarget.id);
            await refreshDiagnostics();
          }
        }}
      />

      {/* PIN-Confirmed Reset Active Store Modal */}
      <PinConfirmModal
        open={resetStoreConfirmOpen}
        onClose={() => setResetStoreConfirmOpen(false)}
        title="Réinitialiser cette boutique ?"
        description="Toutes les données locales de la boutique actuellement ouverte (produits, ventes, commandes, clients, dépenses, crédits et catalogues) seront effacées. Exportez d’abord une sauvegarde si nécessaire."
        confirmLabel="Effacer les données"
        danger
        onConfirm={handleResetActiveStoreData}
      />
    </div>
  );
};
