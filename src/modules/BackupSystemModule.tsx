import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ArrowLeftRight,
  ArrowUpCircle,
  BellRing,
  CheckCircle2,
  Compass,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileKey2,
  Grid3X3,
  HardDrive,
  History,
  Info,
  KeyRound,
  Lock,
  LogOut,
  Moon,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Sun,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {AboutPrivacyModal} from '../components/AboutPrivacyModal';
import {ModernSelect} from '../components/ModernSelect';
import {PatternLockGrid} from '../components/PatternLockGrid';
import {PinConfirmModal} from '../components/PinConfirmModal';
import {SheetModal} from '../components/SheetModal';
import {
  StoreTransferModal,
  StoreTransferModalState,
} from '../components/StoreTransferModal';
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
import {copyTextSafely, downloadBlobSafely} from '../services/androidShareService';
import {
  exportFullBackup,
  restoreBackupPayload,
  validateBackupJson,
} from '../services/backupService';
import {clearAllCachedUrls} from '../services/mediaService';
import {requestBrowserNotificationPermission} from '../services/notificationService';
import {checkServerHealth} from '../services/onlineCatalogService';
import {
  decryptBackupText,
  encryptBackupText,
  getLockMethodLabel,
} from '../services/securityService';
import {loadSampleCommerceData} from '../services/seedService';
import {LockMethod, StoreSlot, ThemeMode, ZandoBackupPayload} from '../types/commerce';
import {formatBytes, formatDateTime} from '../utils/format';

interface BackupSystemModuleProps {
  onOpenGuide?: () => void;
}

export const BackupSystemModule: React.FC<BackupSystemModuleProps> = ({onOpenGuide}) => {
  const {
    schemaMeta,
    appMode,
    zandoDeviceId,
    storeProfile,
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
    removeStoreSlot,
    saveStoreProfile,
    lockAppNow,
    enableSecurityLock,
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

  // Multi-store & Transfer state
  const [newStoreModalOpen, setNewStoreModalOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreCurrency, setNewStoreCurrency] = useState('FCFA');
  const [creatingStore, setCreatingStore] = useState(false);
  const [deleteStoreTarget, setDeleteStoreTarget] = useState<StoreSlot | null>(null);
  const [transferModal, setTransferModal] = useState<StoreTransferModalState>(null);

  // Security Lock modal (PIN / Password / Pattern)
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockAction, setLockAction] = useState<'configure' | 'disable'>('configure');
  const [targetMethod, setTargetMethod] = useState<LockMethod>(
    securitySettings.lockMethod || 'pin',
  );
  const [currentSecret, setCurrentSecret] = useState('');
  const [currentVerified, setCurrentVerified] = useState(!securitySettings.pinEnabled);
  const [newSecret, setNewSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [patternStep, setPatternStep] = useState<'draw' | 'confirm'>('draw');
  const [firstPattern, setFirstPattern] = useState('');
  const [lockError, setLockError] = useState('');

  // About & Privacy modal
  const [aboutModalTab, setAboutModalTab] = useState<'about' | 'privacy' | null>(null);

  // Pro settings local form state
  const [proDraft, setProDraft] = useState(proSettings);
  const [resetStoreConfirmOpen, setResetStoreConfirmOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProDraft(proSettings);
  }, [proSettings]);

  // 100% Hors ligne : aucune requête réseau n'est lancée automatiquement ici !
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
          setSwStatus('pending');
        }
      } catch {
        setSwStatus('pending');
      }
    } else {
      setSwStatus('unsupported');
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

  // Réseau sollicité UNIQUEMENT quand l'utilisateur clique sur "Mettre à jour l'application"
  const handleCheckAndApplyUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateNote(null);
    try {
      if (!navigator.onLine) {
        setUpdateNote('Vous êtes hors ligne : impossible de contacter le serveur de mise à jour.');
        notify('Connexion Internet requise pour vérifier les mises à jour.', 'error');
        return;
      }

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

  const openLockSetupModal = (method: LockMethod, action: 'configure' | 'disable' = 'configure') => {
    setLockAction(action);
    setTargetMethod(method);
    setCurrentSecret('');
    setCurrentVerified(!securitySettings.pinEnabled);
    setNewSecret('');
    setConfirmSecret('');
    setShowNewPwd(false);
    setPatternStep('draw');
    setFirstPattern('');
    setLockError('');
    setLockModalOpen(true);
  };

  const handleVerifyExistingSecret = async (candidate: string) => {
    setLockError('');
    const ok = await verifyCurrentPin(candidate);
    if (!ok) {
      setLockError(`${getLockMethodLabel(securitySettings.lockMethod)} actuel incorrect.`);
      return;
    }
    if (lockAction === 'disable') {
      disablePinLock();
      setLockModalOpen(false);
      notify('Paramètres sauvegardés. Verrouillage désactivé.', 'info');
      return;
    }
    setCurrentVerified(true);
    setCurrentSecret('');
  };

  const handleSaveNewLockSecret = async (secretToSave: string) => {
    setLockError('');
    if (targetMethod === 'pin') {
      if (!/^\d{4,6}$/.test(secretToSave)) {
        setLockError('Le code PIN doit contenir entre 4 et 6 chiffres.');
        return;
      }
      if (secretToSave !== confirmSecret) {
        setLockError('Les deux codes PIN ne correspondent pas.');
        return;
      }
    } else if (targetMethod === 'password') {
      if (secretToSave.length < 4) {
        setLockError('Le mot de passe doit contenir au moins 4 caractères.');
        return;
      }
      if (secretToSave !== confirmSecret) {
        setLockError('Les deux mots de passe ne correspondent pas.');
        return;
      }
    } else if (targetMethod === 'pattern') {
      const pts = secretToSave.split('-').filter(Boolean);
      if (pts.length < 4) {
        setLockError('Reliez au moins 4 points pour créer un schéma sûr.');
        return;
      }
    }

    await enableSecurityLock(targetMethod, secretToSave);
    setLockModalOpen(false);
    notify(
      `Paramètres sauvegardés. Mode de verrouillage : ${getLockMethodLabel(targetMethod)}.`,
      'success',
    );
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

  const currentLockMethod = securitySettings.lockMethod || 'pin';
  const existingLockMethod = securitySettings.lockMethod || 'pin';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 1. Mode Démonstration & Guide */}
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

      {/* 2. Multi-boutiques, Basculer, Acheter / Rejoindre & Collaboration */}
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
              Basculez entre vos {MAX_STORES} boutiques locales, achetez ou rejoignez une boutique, ou accordez un accès en collaboration.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTransferModal({mode: 'buy'})}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4 text-emerald-600" />
              <span>Acheter / Rejoindre</span>
            </button>
            <button
              type="button"
              disabled={storeSlots.length >= MAX_STORES}
              onClick={() => setNewStoreModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>
                {storeSlots.length >= MAX_STORES
                  ? `Limite (${MAX_STORES}/${MAX_STORES})`
                  : 'Ouvrir boutique'}
              </span>
            </button>
          </div>
        </div>

        {/* Device ZANDO ID pill-free banner */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Votre Identifiant ZANDO : </span>
            <strong className="font-mono text-slate-900 dark:text-white tracking-wide">
              {zandoDeviceId}
            </strong>
          </div>
          <button
            type="button"
            onClick={async () => {
              await copyTextSafely(zandoDeviceId);
              notify(`Identifiant ${zandoDeviceId} copié.`, 'success');
            }}
            className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copier identifiant</span>
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
          {storeSlots.map((slot, idx) => {
            const isActive = appMode !== 'demo' && slot.id === activeStoreId;
            const isCollab = slot.role === 'collaborator';
            return (
              <div
                key={slot.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                    <span className="truncate">{slot.name}</span>
                    {isActive && (
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        · Active
                      </span>
                    )}
                    {isCollab && (
                      <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                        · Collaboration ({slot.ownerZandoId})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Boutique #{idx + 1} · Devise {slot.currency} · {slot.dbName}
                    {!isCollab && (slot.collaborators?.length ?? 0) > 0
                      ? ` · ${slot.collaborators!.length} collaborateur(s)`
                      : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => switchStore(slot.id)}
                      className="min-h-[36px] px-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                    >
                      Basculer
                    </button>
                  )}
                  {!isCollab && (
                    <>
                      <button
                        type="button"
                        onClick={() => setTransferModal({mode: 'collaborate', store: slot})}
                        className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        title="Accorder des droits d’utilisation sans céder la boutique"
                      >
                        <Users className="w-3.5 h-3.5 text-sky-600" />
                        <span>Collaboration</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTransferModal({mode: 'sell', store: slot})}
                        className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer"
                        title="Vendre cette boutique à un autre utilisateur ZANDO Pro"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        <span>Vendre</span>
                      </button>
                    </>
                  )}
                  {storeSlots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDeleteStoreTarget(slot)}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
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

      {/* 2b. Apparence (Thème Clair / Sombre) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              {storeProfile.themeMode === 'dark' ? (
                <Moon className="w-4 h-4 text-emerald-600" />
              ) : (
                <Sun className="w-4 h-4 text-emerald-600" />
              )}
              <span>Apparence & Thème d’affichage</span>
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Choisissez le thème clair ou sombre de ZANDO Pro sur cet appareil.
            </p>
          </div>

          <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-full sm:w-64 shrink-0">
            {(['light', 'dark'] as ThemeMode[]).map((mode) => {
              const active = storeProfile.themeMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={async () => {
                    if (storeProfile.themeMode === mode) return;
                    await saveStoreProfile({...storeProfile, themeMode: mode});
                    notify('Paramètres sauvegardés.', 'success');
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {mode === 'light' ? (
                    <Sun className="w-4 h-4 text-amber-500" />
                  ) : (
                    <Moon className="w-4 h-4 text-sky-400" />
                  )}
                  <span>{mode === 'light' ? 'Clair' : 'Sombre'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. Sécurité, Verrouillage (PIN, Mot de passe, Schéma) & Confidentialité */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Sécurité, Verrouillage & Notifications</span>
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Choisissez votre méthode de verrouillage (Code PIN, Mot de passe ou Schéma) et le délai de verrouillage automatique dès 15 secondes.
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

        {/* Mode de verrouillage : Code PIN / Mot de passe / Schéma */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-600" />
              <span>
                Mode de verrouillage :{' '}
                <span
                  className={
                    securitySettings.pinEnabled
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500'
                  }
                >
                  {securitySettings.pinEnabled
                    ? `${getLockMethodLabel(currentLockMethod)} actif`
                    : 'Désactivé'}
                </span>
              </span>
            </div>
            {securitySettings.pinEnabled && (
              <button
                type="button"
                onClick={() => openLockSetupModal(currentLockMethod, 'disable')}
                className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
              >
                Désactiver le verrouillage
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(
              [
                {
                  id: 'pin' as LockMethod,
                  label: 'Code PIN',
                  desc: '4 à 6 chiffres rapides',
                  icon: KeyRound,
                },
                {
                  id: 'password' as LockMethod,
                  label: 'Mot de passe',
                  desc: 'Lettres, chiffres & symboles',
                  icon: Lock,
                },
                {
                  id: 'pattern' as LockMethod,
                  label: 'Schéma',
                  desc: 'Tracé tactile sur grille 3×3',
                  icon: Grid3X3,
                },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const isSelected = securitySettings.pinEnabled && currentLockMethod === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => openLockSetupModal(opt.id, 'configure')}
                  className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Icon className="w-4 h-4 text-emerald-600" />
                      <span>{opt.label}</span>
                    </span>
                    {isSelected && (
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                        Actif
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {opt.desc}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Cliquez sur Code PIN, Mot de passe ou Schéma pour le configurer immédiatement. Verrouillage temporaire de 30s après 5 tentatives erronées.
          </p>
        </div>

        {/* Security Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Verrouillage auto après inactivité
            </label>
            <ModernSelect
              value={String(securitySettings.autoLockSeconds)}
              onChange={(val) => {
                updateSecuritySettings({autoLockSeconds: Number(val)});
                notify('Paramètres sauvegardés.', 'success');
              }}
              options={[
                {value: '0', label: 'Jamais'},
                {value: '15', label: 'Après 15 secondes'},
                {value: '30', label: 'Après 30 secondes'},
                {value: '60', label: 'Après 1 minute'},
                {value: '300', label: 'Après 5 minutes'},
                {value: '900', label: 'Après 15 minutes'},
                {value: '1800', label: 'Après 30 minutes'},
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Rappel de sauvegarde locale
            </label>
            <ModernSelect
              value={String(securitySettings.backupReminderDays)}
              onChange={(val) => {
                updateSecuritySettings({backupReminderDays: Number(val) as 0 | 7 | 14 | 30});
                notify('Paramètres sauvegardés.', 'success');
              }}
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
              onChange={(e) => {
                updateSecuritySettings({privacyModeEnabled: e.target.checked});
                notify('Paramètres sauvegardés.', 'success');
              }}
              className="w-5 h-5 accent-emerald-600 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer">
            <div className="flex items-center gap-2.5 min-w-0">
              <Lock className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="text-xs">
                <div className="font-bold text-slate-900 dark:text-white">
                  Exiger le verrouillage pour les actions sensibles
                </div>
                <div className="text-slate-500">
                  Protège la suppression ou vente de boutique, la restauration complète et la réinitialisation.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={securitySettings.requirePinForSensitiveActions}
              onChange={(e) => {
                updateSecuritySettings({requirePinForSensitiveActions: e.target.checked});
                notify('Paramètres sauvegardés.', 'success');
              }}
              className="w-5 h-5 accent-emerald-600 shrink-0"
            />
          </label>

          <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer">
            <div className="flex items-center gap-2.5 min-w-0">
              <BellRing className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="text-xs">
                <div className="font-bold text-slate-900 dark:text-white">
                  Notifications système hors ligne (stock, crédits, transferts)
                </div>
                <div className="text-slate-500">
                  En plus du Centre de notifications intégré, affiche les alertes sur l’appareil si autorisé.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(securitySettings.browserNotificationsEnabled)}
              onChange={async (e) => {
                const want = e.target.checked;
                if (want) {
                  await requestBrowserNotificationPermission();
                }
                updateSecuritySettings({browserNotificationsEnabled: want});
                notify('Paramètres sauvegardés.', 'success');
              }}
              className="w-5 h-5 accent-emerald-600 shrink-0"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              updateSecuritySettings({});
              notify('Paramètres sauvegardés.', 'success');
            }}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Enregistrer la sécurité</span>
          </button>
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
              notify('Paramètres sauvegardés.', 'success');
            }}
            className="inline-flex items-center gap-1.5 min-h-[42px] px-5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Enregistrer les paramètres</span>
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

      {/* 6. Stockage local, Actualisation & Mise à jour (Sans bilan boutique & sans appel réseau automatique) */}
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
            <div className="text-xs text-slate-500 dark:text-slate-400">Mode hors ligne local</div>
            <div className="mt-1 font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                {swStatus === 'active'
                  ? 'Actif et prêt hors ligne'
                  : 'Pack local prêt hors ligne'}
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

      {/* 7. À propos & Confidentialité (sans téléchargement de logo ZANDO Pro) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600" />
              <span>À propos & Confidentialité</span>
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              ZANDO Pro v{APP_VERSION} fonctionne sans connexion dès l’installation. Vos données restent strictement privées sur cet appareil.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setAboutModalTab('about')}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 text-emerald-600" />
              <span>À propos</span>
            </button>
            <button
              type="button"
              onClick={() => setAboutModalTab('privacy')}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Confidentialité</span>
            </button>
          </div>
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

      {/* Modal: Configurer / Modifier / Désactiver Code PIN, Mot de passe ou Schéma */}
      <SheetModal
        open={lockModalOpen}
        onClose={() => setLockModalOpen(false)}
        title={
          lockAction === 'disable'
            ? `Désactiver le verrouillage (${getLockMethodLabel(existingLockMethod)})`
            : `Configurer le verrouillage : ${getLockMethodLabel(targetMethod)}`
        }
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          {!currentVerified ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Pour modifier ou désactiver votre sécurité, confirmez d’abord votre{' '}
                <strong>{getLockMethodLabel(existingLockMethod).toLowerCase()}</strong> actuel :
              </p>

              {existingLockMethod === 'pattern' ? (
                <PatternLockGrid
                  errorState={Boolean(lockError)}
                  helperText="Dessinez votre schéma actuel"
                  onComplete={(pat) => handleVerifyExistingSecret(pat)}
                />
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleVerifyExistingSecret(currentSecret);
                  }}
                  className="space-y-3"
                >
                  <input
                    type="password"
                    inputMode={existingLockMethod === 'pin' ? 'numeric' : undefined}
                    required
                    autoFocus
                    value={currentSecret}
                    onChange={(e) => {
                      const val =
                        existingLockMethod === 'pin'
                          ? e.target.value.replace(/\D/g, '').slice(0, 6)
                          : e.target.value;
                      setCurrentSecret(val);
                      setLockError('');
                    }}
                    placeholder={
                      existingLockMethod === 'pin'
                        ? 'Code PIN actuel (4 à 6 chiffres)'
                        : 'Mot de passe actuel'
                    }
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setLockModalOpen(false)}
                      className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                    >
                      Continuer
                    </button>
                  </div>
                </form>
              )}
              {lockError && <p className="text-xs font-semibold text-rose-600">{lockError}</p>}
            </div>
          ) : targetMethod === 'pattern' ? (
            <div className="space-y-3.5">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200">
                {patternStep === 'draw'
                  ? 'Étape 1/2 : Dessinez un nouveau schéma en reliant au moins 4 points sur la grille.'
                  : 'Étape 2/2 : Dessinez exactement le même schéma une seconde fois pour le confirmer.'}
              </div>

              <PatternLockGrid
                key={patternStep}
                errorState={Boolean(lockError)}
                helperText={
                  patternStep === 'draw'
                    ? 'Reliez au moins 4 points'
                    : 'Confirmez votre schéma'
                }
                onComplete={(pat) => {
                  setLockError('');
                  const pts = pat.split('-').filter(Boolean);
                  if (pts.length < 4) {
                    setLockError('Reliez au moins 4 points sur la grille.');
                    return;
                  }
                  if (patternStep === 'draw') {
                    setFirstPattern(pat);
                    setPatternStep('confirm');
                  } else {
                    if (pat !== firstPattern) {
                      setLockError('Les deux schémas ne correspondent pas. Recommencez.');
                      setFirstPattern('');
                      setPatternStep('draw');
                      return;
                    }
                    setConfirmSecret(pat);
                    setNewSecret(pat);
                  }
                }}
              />

              {patternStep === 'confirm' && firstPattern && newSecret === firstPattern && (
                <div className="text-center text-xs font-bold text-emerald-600">
                  Schéma confirmé ! Enregistrez votre mode de verrouillage.
                </div>
              )}

              {lockError && (
                <p className="text-center text-xs font-semibold text-rose-600">{lockError}</p>
              )}

              <div className="flex justify-between items-center gap-2 pt-1">
                {patternStep === 'confirm' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPatternStep('draw');
                      setFirstPattern('');
                      setNewSecret('');
                      setConfirmSecret('');
                      setLockError('');
                    }}
                    className="text-xs font-semibold text-slate-500 hover:underline cursor-pointer"
                  >
                    Recommencer le tracé
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLockModalOpen(false)}
                    className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={!newSecret || newSecret !== firstPattern}
                    onClick={() => handleSaveNewLockSecret(newSecret)}
                    className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-45"
                  >
                    Enregistrer ce verrouillage
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveNewLockSecret(newSecret);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold mb-1">
                  {targetMethod === 'pin'
                    ? 'Nouveau code PIN (4 à 6 chiffres) *'
                    : 'Nouveau mot de passe (4 caractères min.) *'}
                </label>
                <div className="relative">
                  <input
                    type={targetMethod === 'password' && showNewPwd ? 'text' : 'password'}
                    inputMode={targetMethod === 'pin' ? 'numeric' : undefined}
                    required
                    autoFocus
                    value={newSecret}
                    onChange={(e) => {
                      const val =
                        targetMethod === 'pin'
                          ? e.target.value.replace(/\D/g, '').slice(0, 6)
                          : e.target.value;
                      setNewSecret(val);
                      setLockError('');
                    }}
                    placeholder={
                      targetMethod === 'pin' ? 'Ex : 2580' : 'Choisissez un mot de passe'
                    }
                    className="w-full min-h-[44px] pl-3.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                  {targetMethod === 'password' && (
                    <button
                      type="button"
                      onClick={() => setShowNewPwd((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 cursor-pointer"
                    >
                      {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  {targetMethod === 'pin' ? 'Confirmer le code PIN *' : 'Confirmer le mot de passe *'}
                </label>
                <input
                  type={targetMethod === 'password' && showNewPwd ? 'text' : 'password'}
                  inputMode={targetMethod === 'pin' ? 'numeric' : undefined}
                  required
                  value={confirmSecret}
                  onChange={(e) => {
                    const val =
                      targetMethod === 'pin'
                        ? e.target.value.replace(/\D/g, '').slice(0, 6)
                        : e.target.value;
                    setConfirmSecret(val);
                    setLockError('');
                  }}
                  placeholder={
                    targetMethod === 'pin' ? 'Répétez le code PIN' : 'Répétez le mot de passe'
                  }
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>

              {lockError && <p className="text-xs font-semibold text-rose-600">{lockError}</p>}

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setLockModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          )}
        </div>
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
        description="Cette opération supprime définitivement la base IndexedDB de cette boutique sur cet appareil (produits, ventes, clients et catalogues associés)."
        confirmLabel="Supprimer la boutique"
        danger
        onConfirm={async () => {
          if (deleteStoreTarget) {
            await removeStoreSlot(deleteStoreTarget.id);
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

      <StoreTransferModal
        state={transferModal}
        onClose={() => {
          setTransferModal(null);
          refreshDiagnostics();
        }}
      />

      <AboutPrivacyModal
        open={aboutModalTab !== null}
        initialTab={aboutModalTab || 'about'}
        zandoDeviceId={zandoDeviceId}
        onClose={() => setAboutModalTab(null)}
      />
    </div>
  );
};
