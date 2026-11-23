import React, {useEffect, useState} from 'react';
import {ShieldAlert} from 'lucide-react';
import {SheetModal} from './SheetModal';
import {useStore} from '../context/StoreContext';

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
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const needsPin = securitySettings.pinEnabled && securitySettings.requirePinForSensitiveActions;

  useEffect(() => {
    if (!open) {
      setPin('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (needsPin) {
        const ok = await verifyCurrentPin(pin);
        if (!ok) {
          setError('Code PIN incorrect.');
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

        {needsPin && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Saisissez votre code PIN pour autoriser l’opération *
            </label>
            <input
              type="password"
              inputMode="numeric"
              required
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError('');
              }}
              placeholder="Code PIN (4 à 6 chiffres)"
              className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm tracking-widest"
            />
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
            disabled={busy || (needsPin && pin.length < 4)}
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
