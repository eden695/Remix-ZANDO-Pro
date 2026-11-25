import React, {useCallback, useEffect, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {
  checkSyncServerAvailability,
  getCustomSyncApiOrigin,
  getSyncApiOrigin,
  InitialSyncProgress,
  InitialSyncStepId,
  readSyncCheckpoint,
  runInitialSync,
  setCustomSyncApiOrigin,
} from '../services/initialSyncService';
import {InitialSyncRecord, SyncProgressCheckpoint} from '../types/commerce';
import {ZandoLogo} from './ZandoLogo';

interface InitialSyncScreenProps {
  onSyncCompleted: (record: InitialSyncRecord) => void;
}

const SYNC_STEPS: Array<{id: InitialSyncStepId; label: string}> = [
  {id: 'network', label: 'Connexion Internet & manifeste des ressources'},
  {id: 'assets', label: 'Téléchargement & contrôle d’intégrité des fichiers'},
  {id: 'data', label: 'Synchronisation des paramètres et données initiales'},
  {id: 'verify', label: 'Vérification du stockage local persistant (IndexedDB)'},
];

export const InitialSyncScreen: React.FC<InitialSyncScreenProps> = ({onSyncCompleted}) => {
  const isOnline = useOnlineStatus();

  const [serverOriginInput, setServerOriginInput] = useState(() => getCustomSyncApiOrigin());
  const [serverConfigOpen, setServerConfigOpen] = useState(false);
  const [checkingServer, setCheckingServer] = useState(false);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [serverInfoMsg, setServerInfoMsg] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<SyncProgressCheckpoint | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<InitialSyncProgress>({
    step: 'network',
    percent: 0,
    message: 'Prêt pour la synchronisation initiale.',
    resumedFromCheckpoint: false,
    completedAssets: [],
    totalAssets: 0,
  });
  const [completedSteps, setCompletedSteps] = useState<InitialSyncStepId[]>([]);
  const [failedStep, setFailedStep] = useState<InitialSyncStepId | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [verifiedRecord, setVerifiedRecord] = useState<InitialSyncRecord | null>(null);

  const loadCheckpoint = useCallback(async () => {
    const cp = await readSyncCheckpoint();
    setCheckpoint(cp);
  }, []);

  const probeServer = useCallback(async () => {
    setCheckingServer(true);
    setErrorText(null);
    const res = await checkSyncServerAvailability();
    setServerReachable(res.reachable);
    setServerInfoMsg(
      res.reachable
        ? res.mode === 'static'
          ? `Prêt pour mise en cache hors ligne (${res.manifest?.requiredAssets.length ?? 0} ressources)`
          : `Serveur prêt (${res.manifest?.requiredAssets.length ?? 0} ressources à vérifier)`
        : res.error || 'Serveur de synchronisation indisponible.',
    );
    if (!res.reachable && !res.origin && getCustomSyncApiOrigin()) {
      setServerConfigOpen(true);
    }
    setCheckingServer(false);
  }, []);

  useEffect(() => {
    loadCheckpoint();
  }, [loadCheckpoint]);

  useEffect(() => {
    if (isOnline) {
      probeServer();
    } else {
      setServerReachable(false);
      setServerInfoMsg('Connexion Internet requise pour télécharger les ressources initiales.');
    }
  }, [isOnline, probeServer]);

  const handleSaveServerUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);
    try {
      setCustomSyncApiOrigin(serverOriginInput);
      setServerConfigOpen(false);
      await probeServer();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Adresse serveur invalide.');
    }
  };

  const handleStartSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setErrorText(null);
    setFailedStep(null);
    setCompletedSteps([]);

    let lastStep: InitialSyncStepId = 'network';
    try {
      const record = await runInitialSync({
        onProgress: (p) => {
          setProgress(p);
          if (p.step !== lastStep) {
            const order: InitialSyncStepId[] = ['network', 'assets', 'data', 'verify'];
            const nextIdx = order.indexOf(p.step);
            setCompletedSteps(order.slice(0, Math.max(0, nextIdx)));
            lastStep = p.step;
          }
        },
      });
      setCompletedSteps(['network', 'assets', 'data', 'verify']);
      setVerifiedRecord(record);
    } catch (err) {
      setFailedStep(lastStep);
      setErrorText(
        err instanceof Error
          ? err.message
          : 'La synchronisation a été interrompue avant la fin.',
      );
      await loadCheckpoint();
    } finally {
      setSyncing(false);
    }
  };

  const hasResumableCheckpoint = Boolean(
    checkpoint && (checkpoint.completedAssets.length > 0 || checkpoint.dataVerified),
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/60">
          <div className="space-y-1">
            <ZandoLogo />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Préparation et synchronisation initiale obligatoire pour le mode hors ligne
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
              isOnline
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{isOnline ? 'En ligne' : 'Hors ligne'}</span>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {verifiedRecord ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>Synchronisation initiale vérifiée et complète</span>
                </div>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                  <strong>{verifiedRecord.verifiedAssets.length}</strong> ressources obligatoires et
                  vos données locales sont enregistrées durablement dans la mémoire de l’appareil.
                  Vous pouvez désormais utiliser l’application sans connexion Internet, même après
                  fermeture ou redémarrage du téléphone.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5 space-y-1.5 text-xs">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  Ressources vérifiées en local :
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {verifiedRecord.verifiedAssets.map((asset) => (
                    <div
                      key={asset.name}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
                    >
                      <span className="font-mono text-[11px] truncate">{asset.name}</span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSyncCompleted(verifiedRecord)}
                className="w-full min-h-[48px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Accéder à l’application (prêt hors ligne)</span>
              </button>
            </div>
          ) : (
            <>
              {/* Offline prompt at first launch */}
              {!isOnline && (
                <div className="rounded-2xl border border-rose-200 dark:border-rose-900/70 bg-rose-50/80 dark:bg-rose-950/40 p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-rose-900 dark:text-rose-200">
                    <WifiOff className="w-4 h-4 shrink-0" />
                    <span>Connexion Internet requise au premier lancement</span>
                  </div>
                  <p className="text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
                    Aucune synchronisation initiale n’a encore été finalisée sur cet appareil.
                    Activez le Wi-Fi ou les données mobiles pour télécharger et vérifier les
                    ressources indispensables au mode hors ligne.
                  </p>
                  <button
                    type="button"
                    onClick={probeServer}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 text-xs font-semibold text-rose-900 dark:text-rose-200 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Vérifier la connexion et réessayer</span>
                  </button>
                </div>
              )}

              {/* Resume checkpoint notice */}
              {hasResumableCheckpoint && !syncing && (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  <strong>Reprise intelligente prête :</strong>{' '}
                  {checkpoint?.completedAssets.length ?? 0} ressource(s) déjà vérifiée(s) sont
                  conservées localement. La synchronisation reprendra uniquement là où elle s’est
                  arrêtée.
                </div>
              )}

              {/* Server status & optional APK server URL */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                      {checkingServer
                        ? 'Vérification du serveur de synchronisation...'
                        : serverInfoMsg || 'Serveur prêt'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={probeServer}
                      disabled={checkingServer || !isOnline}
                      className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer disabled:opacity-45"
                    >
                      Tester
                    </button>
                    <button
                      type="button"
                      onClick={() => setServerConfigOpen((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>{serverConfigOpen ? 'Masquer URL' : 'Serveur APK'}</span>
                    </button>
                  </div>
                </div>

                {serverConfigOpen && (
                  <form onSubmit={handleSaveServerUrl} className="pt-1 space-y-2">
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                      Adresse HTTPS du serveur de synchronisation (nécessaire pour APK autonome si non intégrée au build) :
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={serverOriginInput}
                        onChange={(e) => setServerOriginInput(e.target.value)}
                        placeholder="https://votre-serveur.run.app"
                        className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                      />
                      <button
                        type="submit"
                        className="min-h-[40px] px-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                      >
                        Appliquer
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Progress Bar & Steps */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-700 dark:text-slate-200 truncate pr-2">
                    {progress.message}
                  </span>
                  <span className="tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                    {progress.percent}%
                  </span>
                </div>

                <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      failedStep ? 'bg-rose-500' : 'bg-emerald-600'
                    }`}
                    style={{width: `${Math.max(syncing ? 5 : 0, progress.percent)}%`}}
                  />
                </div>

                <div className="space-y-2 pt-1">
                  {SYNC_STEPS.map((st) => {
                    const done = completedSteps.includes(st.id);
                    const failed = failedStep === st.id;
                    const active = syncing && progress.step === st.id && !failed;
                    return (
                      <div key={st.id} className="flex items-center gap-2 text-xs">
                        {done ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : failed ? (
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        ) : active ? (
                          <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
                        ) : (
                          <Database className="w-4 h-4 text-slate-300 dark:text-slate-700 shrink-0" />
                        )}
                        <span
                          className={
                            failed
                              ? 'font-semibold text-rose-600'
                              : done
                                ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                : active
                                  ? 'font-semibold text-slate-900 dark:text-white'
                                  : 'text-slate-400 dark:text-slate-500'
                          }
                        >
                          {st.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {errorText && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorText}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleStartSync}
                disabled={syncing || !isOnline}
                className="w-full min-h-[48px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45"
              >
                {syncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <HardDriveDownload className="w-4 h-4" />
                )}
                <span>
                  {syncing
                    ? 'Téléchargement et vérification en cours...'
                    : hasResumableCheckpoint
                      ? 'Reprendre la synchronisation'
                      : 'Télécharger et synchroniser maintenant'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
