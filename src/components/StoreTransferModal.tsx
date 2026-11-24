import React, {useEffect, useRef, useState} from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  CloudDownload,
  Copy,
  Download,
  FileUp,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import {PinConfirmModal} from './PinConfirmModal';
import {SheetModal} from './SheetModal';
import {TransferPackageResult, useStore} from '../context/StoreContext';
import {copyTextSafely, downloadBlobSafely} from '../services/androidShareService';
import {
  acknowledgeTransferOnline,
  fetchPendingTransfersOnline,
  getCollaboratorRoleLabel,
  getPresetPermissions,
  isValidZandoId,
  normalizeZandoId,
  pushTransferOnline,
} from '../services/storeTransferService';
import {
  CollaboratorPresetRole,
  StorePermissions,
  StoreSlot,
  StoreTransferEnvelope,
} from '../types/commerce';
import {formatDateTime} from '../utils/format';

export type StoreTransferModalState =
  | {mode: 'buy'}
  | {mode: 'sell'; store: StoreSlot}
  | {mode: 'collaborate'; store: StoreSlot}
  | null;

interface StoreTransferModalProps {
  state: StoreTransferModalState;
  onClose: () => void;
}

const PERMISSION_OPTIONS: Array<{key: keyof StorePermissions; label: string}> = [
  {key: 'canManageProducts', label: 'Produits & modification des stocks'},
  {key: 'canRecordSales', label: 'Enregistrer des ventes / Caisse'},
  {key: 'canManageOrders', label: 'Gérer les commandes clients'},
  {key: 'canManageCustomersCredits', label: 'Clients & gestion des crédits'},
  {key: 'canViewFinances', label: 'Consulter Bénéfices & Dépenses'},
  {key: 'canManageCatalogs', label: 'Créer / partager catalogues & social'},
  {key: 'canManageSettings', label: 'Accéder aux réglages & identité boutique'},
];

export const StoreTransferModal: React.FC<StoreTransferModalProps> = ({state, onClose}) => {
  const {
    zandoDeviceId,
    securitySettings,
    verifyCurrentPin,
    sellStoreSlot,
    createCollaborationPackage,
    revokeStoreCollaborator,
    importStoreTransfer,
    notify,
    storeSlots,
  } = useStore();

  // Buy / Join state
  const [pastedCode, setPastedCode] = useState('');
  const [importing, setImporting] = useState(false);
  const [checkingOnline, setCheckingOnline] = useState(false);
  const [onlineTransfers, setOnlineTransfers] = useState<StoreTransferEnvelope[]>([]);
  const [onlineStatusMsg, setOnlineStatusMsg] = useState('');
  const transferFileRef = useRef<HTMLInputElement>(null);

  // Sell / Collaborate shared state
  const [targetId, setTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [note, setNote] = useState('');
  const [preset, setPreset] = useState<CollaboratorPresetRole>('seller');
  const [permissions, setPermissions] = useState<StorePermissions>(() =>
    getPresetPermissions('seller'),
  );
  const [busy, setBusy] = useState(false);
  const [pinConfirmOpen, setPinConfirmOpen] = useState(false);
  const [generatedPkg, setGeneratedPkg] = useState<{
    kind: 'sale' | 'collaboration';
    storeName: string;
    pkg: TransferPackageResult;
  } | null>(null);
  const [pushingOnline, setPushingOnline] = useState(false);

  // Resolve live collaborators list for active store in modal
  const liveCollabStore =
    state?.mode === 'collaborate'
      ? storeSlots.find((s) => s.id === state.store.id) ?? state.store
      : null;

  useEffect(() => {
    setPastedCode('');
    setOnlineTransfers([]);
    setOnlineStatusMsg('');
    setTargetId('');
    setTargetName('');
    setSalePrice('');
    setNote('');
    setPreset('seller');
    setPermissions(getPresetPermissions('seller'));
    setGeneratedPkg(null);
    setBusy(false);
    setImporting(false);
  }, [state]);

  if (!state) return null;

  const title = generatedPkg
    ? generatedPkg.kind === 'sale'
      ? 'Boutique cédée & prête à remettre'
      : 'Accès collaboration prêt'
    : state.mode === 'buy'
      ? 'Acheter ou rejoindre une boutique'
      : state.mode === 'sell'
        ? `Vendre « ${state.store.name} »`
        : `Collaboration sur « ${state.store.name} »`;

  const handleImportCodeOrText = async (raw: string, ackTransferId?: string) => {
    setImporting(true);
    try {
      const res = await importStoreTransfer(raw);
      if (ackTransferId) {
        await acknowledgeTransferOnline(zandoDeviceId, ackTransferId);
      }
      if (res.kind === 'sale') {
        onClose();
      } else {
        onClose();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de l’importation.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleImportOnlineEnvelope = async (env: StoreTransferEnvelope) => {
    setImporting(true);
    try {
      await importStoreTransfer(env);
      await acknowledgeTransferOnline(zandoDeviceId, env.transferId);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de la réception.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleTransferFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    await handleImportCodeOrText(text);
  };

  const handleCheckOnlineTransfers = async () => {
    setCheckingOnline(true);
    setOnlineStatusMsg('');
    try {
      const res = await fetchPendingTransfersOnline(zandoDeviceId);
      if (!res.ok) {
        setOnlineStatusMsg(res.error || 'Relais indisponible.');
      } else if (res.transfers.length === 0) {
        setOnlineStatusMsg('Aucun transfert en attente sur le serveur pour votre identifiant.');
      } else {
        setOnlineTransfers(res.transfers);
      }
    } finally {
      setCheckingOnline(false);
    }
  };

  const executeSell = async () => {
    if (state.mode !== 'sell') return;
    setBusy(true);
    try {
      const pkg = await sellStoreSlot({
        storeId: state.store.id,
        buyerZandoId: targetId,
        buyerName: targetName,
        salePrice,
        note,
      });
      setGeneratedPkg({kind: 'sale', storeName: state.store.name, pkg});
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Échec de la cession de boutique.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidZandoId(targetId)) {
      notify('Saisissez un Identifiant ZANDO valide (ex : ZND-AB12-CD34).', 'error');
      return;
    }
    if (securitySettings.pinEnabled && securitySettings.requirePinForSensitiveActions) {
      setPinConfirmOpen(true);
      return;
    }
    await executeSell();
  };

  const handleCollaborateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.mode !== 'collaborate') return;
    if (!isValidZandoId(targetId)) {
      notify('Saisissez l’Identifiant ZANDO du collaborateur (ex : ZND-AB12-CD34).', 'error');
      return;
    }
    if (!targetName.trim()) {
      notify('Indiquez le nom du collaborateur.', 'error');
      return;
    }
    setBusy(true);
    try {
      const pkg = await createCollaborationPackage({
        storeId: state.store.id,
        collaboratorZandoId: targetId,
        collaboratorName: targetName.trim(),
        preset,
        permissions,
        note,
      });
      setGeneratedPkg({kind: 'collaboration', storeName: state.store.name, pkg});
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur création collaboration.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const normalizedEnteredId = normalizeZandoId(targetId);
  const isSelfId = normalizedEnteredId && normalizedEnteredId === zandoDeviceId;

  // Keep verifyCurrentPin in scope even though PinConfirmModal handles it directly
  void verifyCurrentPin;

  return (
    <>
      <SheetModal open={!!state} onClose={onClose} title={title} maxWidthClass="max-w-lg">
        {generatedPkg ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-300">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>
                  {generatedPkg.kind === 'sale'
                    ? `« ${generatedPkg.storeName} » a été supprimée de cet appareil et chiffrée pour ${generatedPkg.pkg.envelope.receiverZandoId}.`
                    : `Accès collaboration prêt pour ${generatedPkg.pkg.envelope.receiverName || generatedPkg.pkg.envelope.receiverZandoId}.`}
                </span>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-200/90">
                {generatedPkg.kind === 'sale'
                  ? 'Remettez le fichier ou le code ci-dessous au client (par WhatsApp, Bluetooth, partage de proximité ou câble), ou envoyez-le en ligne s’il est connecté.'
                  : 'Votre boutique reste bien sur votre appareil. Le collaborateur pourra ouvrir cette boutique avec les droits attribués en important le fichier ou le code.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={async () => {
                  await downloadBlobSafely(generatedPkg.pkg.blob, generatedPkg.pkg.filename);
                  notify(`Fichier ${generatedPkg.pkg.filename} téléchargé.`, 'success');
                }}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-semibold cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger le fichier</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await copyTextSafely(generatedPkg.pkg.transferCode);
                  notify('Code de transfert chiffré copié.', 'success');
                }}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>Copier le code hors ligne</span>
              </button>
            </div>

            <button
              type="button"
              disabled={pushingOnline}
              onClick={async () => {
                setPushingOnline(true);
                try {
                  const res = await pushTransferOnline(generatedPkg.pkg.envelope);
                  if (res.ok) {
                    notify(
                      `Paquet déposé en ligne pour ${generatedPkg.pkg.envelope.receiverZandoId}.`,
                      'success',
                    );
                  } else {
                    notify(res.error || 'Envoi en ligne impossible.', 'error');
                  }
                } finally {
                  setPushingOnline(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>
                {pushingOnline
                  ? 'Envoi en ligne...'
                  : 'Envoyer directement en ligne au destinataire (optionnel)'}
              </span>
            </button>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
              >
                Terminer
              </button>
            </div>
          </div>
        ) : state.mode === 'buy' ? (
          <div className="space-y-4">
            {/* Step 1: User's unique ZANDO ID */}
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-2">
              <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>1. Votre Identifiant ZANDO Pro unique</span>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-200/90 leading-relaxed">
                Communiquez cet identifiant au vendeur (pour acheter sa boutique) ou au propriétaire
                (pour collaborer sur sa boutique). Fonctionne 100% hors ligne :
              </p>
              <div className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2.5">
                <span className="font-mono text-base font-extrabold tracking-wider text-slate-900 dark:text-white select-all">
                  {zandoDeviceId}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await copyTextSafely(zandoDeviceId);
                    notify(`Identifiant ${zandoDeviceId} copié.`, 'success');
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copier</span>
                </button>
              </div>
            </div>

            {/* Step 2: Offline file or pasted code */}
            <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                2. Recevoir la boutique (Hors ligne ou en ligne)
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => transferFileRef.current?.click()}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <FileUp className="w-4 h-4" />
                  <span>Importer fichier (.zando-boutique / .zando-collab)</span>
                </button>
                <input
                  ref={transferFileRef}
                  type="file"
                  accept=".zando-boutique,.zando-collab,.json,application/json"
                  onChange={handleTransferFile}
                  className="hidden"
                />

                <button
                  type="button"
                  disabled={checkingOnline}
                  onClick={handleCheckOnlineTransfers}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <CloudDownload className="w-4 h-4 text-emerald-600" />
                  <span>{checkingOnline ? 'Vérification...' : 'Vérifier en ligne'}</span>
                </button>
              </div>

              {onlineStatusMsg && (
                <p className="text-xs text-slate-500 dark:text-slate-400">{onlineStatusMsg}</p>
              )}

              {onlineTransfers.length > 0 && (
                <div className="space-y-2 pt-1">
                  {onlineTransfers.map((trf) => (
                    <div
                      key={trf.transferId}
                      className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 text-xs">
                        <div className="font-bold text-slate-900 dark:text-white truncate">
                          {trf.kind === 'sale' ? 'Achat boutique' : 'Invitation collaboration'} :{' '}
                          {trf.storeName}
                        </div>
                        <div className="text-slate-500">
                          De {trf.senderZandoId} · {formatDateTime(trf.createdAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={importing}
                        onClick={() => handleImportOnlineEnvelope(trf)}
                        className="min-h-[36px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer shrink-0"
                      >
                        Accepter
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Ou collez le code de transfert reçu (ZANDO-TR1:...)
                </label>
                <textarea
                  rows={3}
                  value={pastedCode}
                  onChange={(e) => setPastedCode(e.target.value)}
                  placeholder="Collez ici le code ZANDO-TR1:... communiqué par le vendeur"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={importing || !pastedCode.trim()}
                    onClick={() => handleImportCodeOrText(pastedCode)}
                    className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-45"
                  >
                    {importing ? 'Importation...' : 'Déchiffrer & importer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : state.mode === 'sell' ? (
          <form onSubmit={handleSellSubmit} className="space-y-4">
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <strong>Attention — Cession définitive :</strong> une fois les informations du client
              validées, tous les produits, ventes, clients et images de{' '}
              <strong>« {state.store.name} »</strong> seront chiffrés exclusivement pour l’acheteur,
              et <strong>cette boutique sera supprimée de votre appareil</strong>.
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Identifiant ZANDO de l’acheteur *
              </label>
              <input
                type="text"
                required
                value={targetId}
                onChange={(e) => setTargetId(e.target.value.toUpperCase())}
                placeholder="Ex : ZND-K7P2-M9Q4"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono uppercase"
              />
              {isSelfId && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Note : cet identifiant correspond à votre propre appareil actuel.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Nom de l’acheteur *</label>
                <input
                  type="text"
                  required
                  value={targetName}
                  onChange={(e) => setTargetName(e.target.value)}
                  placeholder="Ex : Jean-Luc Mbala"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Prix / Référence cession</label>
                <input
                  type="text"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder="Ex : 250 000 FCFA"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Note pour l’acheteur</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex : Cession complète du fonds et carnet clients"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span>{busy ? 'Transfert...' : 'Vendre & supprimer ici'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/30 p-3.5 text-xs text-sky-900 dark:text-sky-200 leading-relaxed">
              <strong>Mode Collaboration :</strong> la boutique{' '}
              <strong>« {state.store.name} » reste sur votre appareil</strong>. Le collaborateur
              reçoit l’accès avec uniquement les droits que vous choisissez ci-dessous.
            </div>

            <form onSubmit={handleCollaborateSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Identifiant ZANDO collaborateur *
                  </label>
                  <input
                    type="text"
                    required
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value.toUpperCase())}
                    placeholder="ZND-XXXX-YYYY"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Nom du collaborateur *</label>
                  <input
                    type="text"
                    required
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    placeholder="Ex : Nadège (Caissière)"
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
              </div>

              {/* Role presets */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold">Profil de droits d’utilisation</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['seller', 'manager', 'viewer'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setPreset(r);
                        setPermissions(getPresetPermissions(r));
                      }}
                      className={`min-h-[38px] px-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                        preset === r
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {getCollaboratorRoleLabel(r)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Granular permissions */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                  Droits accordés ({getCollaboratorRoleLabel(preset)})
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {PERMISSION_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer py-0.5"
                    >
                      <span>{opt.label}</span>
                      <input
                        type="checkbox"
                        checked={permissions[opt.key]}
                        onChange={(e) => {
                          setPreset('custom');
                          setPermissions((prev) => ({...prev, [opt.key]: e.target.checked}));
                        }}
                        className="w-4 h-4 accent-emerald-600"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{busy ? 'Génération...' : 'Accorder les droits'}</span>
                </button>
              </div>
            </form>

            {/* Recorded collaborators list */}
            {liveCollabStore && (liveCollabStore.collaborators?.length ?? 0) > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Collaborateurs enregistrés sur cette boutique</span>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {liveCollabStore.collaborators!.map((col) => (
                    <div
                      key={col.id}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white truncate">
                          {col.name}{' '}
                          <span className="font-mono text-[11px] text-emerald-600">
                            ({col.zandoId})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {getCollaboratorRoleLabel(col.preset)} · {formatDateTime(col.createdAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => revokeStoreCollaborator(liveCollabStore.id, col.id)}
                        className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        title="Retirer ce collaborateur"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetModal>

      <PinConfirmModal
        open={pinConfirmOpen}
        onClose={() => setPinConfirmOpen(false)}
        title="Autoriser la vente de boutique"
        description={`Confirmez votre code de sécurité pour vendre et supprimer « ${
          state.mode === 'sell' ? state.store.name : ''
        } » de votre appareil.`}
        confirmLabel="Confirmer la vente"
        danger
        onConfirm={executeSell}
      />
    </>
  );
};
