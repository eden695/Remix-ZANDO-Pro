import React, {useEffect, useState} from 'react';
import {Eye, EyeOff, ShieldAlert} from 'lucide-react';
import {PatternLockGrid} from './PatternLockGrid';
import {SheetModal} from './SheetModal';
import {useStore} from '../context/StoreContext';
import {getLockMethodLabel} from '../services/securityService';

interface PinConfirmModalProps {
  open: boolean;
  title?: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export const PinConfirmModal: React.FC<PinConfirmModalProps> = ({
  open,
  title = 'Confirmation de sécurité',
  description,
  confirmLabel = 'Confirmer',
  danger = false,
  onConfirm,
  onClose,
}) => {
  const {securitySettings, verifyCurrentPin} = useStore();
  const [secret, setSecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lockMethod = securitySettings.lockMethod || 'pin';
  const methodLabel = getLockMethodLabel(lockMethod);
  const needsAuth = securitySettings.pinEnabled && securitySettings.requirePinForSensitiveActions;

  useEffect(() => {
    if (!open) {
      setSecret('');
      setShowPassword(false);
      setError('');
      setBusy(false);
    }
  }, [open]);

  const isSecretReady = () => {
    if (!needsAuth) return true;
    if (lockMethod === 'pattern') {
      return secret.split('-').filter(Boolean).length >= 4;
    }
    return secret.length >= 4;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (needsAuth) {
        const ok = await verifyCurrentPin(secret);
        if (!ok) {
          setError(`${methodLabel} incorrect.`);
          if (lockMethod === 'pattern') setSecret('');
          setBusy(false);
          return;
        }
      }
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la validation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal open={open} onClose={onClose} title={title} maxWidthClass="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
          <ShieldAlert
            className={`w-5 h-5 shrink-0 mt-0.5 ${danger ? 'text-rose-600' : 'text-amber-600'}`}
          />
          <p className="leading-relaxed">{description}</p>
        </div>

        {needsAuth && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {lockMethod === 'pattern'
                ? 'Dessinez votre schéma pour autoriser l’opération *'
                : lockMethod === 'password'
                  ? 'Saisissez votre mot de passe pour autoriser l’opération *'
                  : 'Saisissez votre code PIN pour autoriser l’opération *'}
            </label>

            {lockMethod === 'pattern' ? (
              <PatternLockGrid
                errorState={Boolean(error)}
                helperText={
                  isSecretReady()
                    ? 'Schéma saisi — cliquez sur le bouton de confirmation'
                    : 'Reliez au moins 4 points'
                }
                onComplete={(pat) => {
                  setSecret(pat);
                  setError('');
                }}
              />
            ) : lockMethod === 'password' ? (
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setError('');
                  }}
                  placeholder="Mot de passe (4 car. min.)"
                  className="w-full min-h-[44px] pl-3.5 pr-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 cursor-pointer"
                  aria-label="Afficher ou masquer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <input
                type="password"
                inputMode="numeric"
                required
                autoFocus
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                placeholder="Code PIN (4 à 6 chiffres)"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tracking-widest"
              />
            )}
          </div>
        )}

        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

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
            disabled={busy || !isSecretReady()}
            className={`min-h-[44px] px-5 rounded-xl text-white text-sm font-semibold cursor-pointer disabled:opacity-50 ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {busy ? 'Validation...' : confirmLabel}
          </button>
        </div>
      </form>
    </SheetModal>
  );
};
