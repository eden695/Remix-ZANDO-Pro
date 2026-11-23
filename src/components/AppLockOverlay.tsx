import React, {useEffect, useState} from 'react';
import {Delete, Lock, ShieldCheck} from 'lucide-react';
import {ZandoLogo} from './ZandoLogo';
import {useStore} from '../context/StoreContext';
import {getLockCooldownState} from '../services/securityService';

export const AppLockOverlay: React.FC = () => {
  const {isLocked, storeProfile, unlockWithPin} = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);

  useEffect(() => {
    if (!isLocked) return;
    const syncCooldown = () => {
      const state = getLockCooldownState();
      const rem = Math.max(0, Math.ceil((state.lockedUntil - Date.now()) / 1000));
      setCooldownSec(rem);
    };
    syncCooldown();
    const timer = window.setInterval(syncCooldown, 1000);
    return () => window.clearInterval(timer);
  }, [isLocked]);

  useEffect(() => {
    if (!isLocked) {
      setPin('');
      setError('');
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const submitPin = async (candidate: string) => {
    if (cooldownSec > 0 || checking || candidate.length < 4) return;
    setChecking(true);
    setError('');
    try {
      const res = await unlockWithPin(candidate);
      if (!res.ok) {
        setError(res.error || 'Code PIN incorrect.');
        setPin('');
        if (res.lockedUntil && res.lockedUntil > Date.now()) {
          setCooldownSec(Math.ceil((res.lockedUntil - Date.now()) / 1000));
        }
      }
    } finally {
      setChecking(false);
    }
  };

  const handleDigit = (d: string) => {
    if (cooldownSec > 0 || checking || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError('');
  };

  const handleBackspace = () => {
    if (checking) return;
    setPin((p) => p.slice(0, -1));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-5 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Verrouillage par code PIN"
    >
      <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-7 space-y-5 shadow-2xl">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="mb-1">
            <ZandoLogo />
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Lock className="w-5 h-5 text-emerald-400" />
          </div>
          <h1 className="text-base font-bold text-white">Session verrouillée</h1>
          <p className="text-xs text-slate-400">
            Saisissez votre code PIN (4 à 6 chiffres) pour accéder à{' '}
            <strong className="text-slate-200">{storeProfile.name}</strong>.
          </p>
        </div>

        {/* PIN visual dots + accessible password input fallback */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPin(pin);
          }}
          className="space-y-3"
        >
          <div className="flex items-center justify-center gap-2.5 py-2">
            {[0, 1, 2, 3, 4, 5].map((idx) => (
              <div
                key={idx}
                className={`w-3.5 h-3.5 rounded-full border transition-all ${
                  idx < pin.length
                    ? 'bg-emerald-400 border-emerald-400 scale-110'
                    : idx < 4
                      ? 'border-slate-600 bg-slate-800'
                      : 'border-slate-700/60 bg-slate-900'
                }`}
              />
            ))}
          </div>

          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            disabled={cooldownSec > 0 || checking}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setPin(digits);
              setError('');
            }}
            placeholder="Code PIN (4 à 6 chiffres)"
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-700 bg-slate-950 text-center text-sm tracking-widest text-white placeholder:text-slate-500 placeholder:tracking-normal"
          />

          {cooldownSec > 0 ? (
            <div className="text-center text-xs font-semibold text-amber-400 tabular-nums">
              Verrouillage temporaire : réessayez dans {cooldownSec}s
            </div>
          ) : (
            error && <div className="text-center text-xs font-semibold text-rose-400">{error}</div>
          )}

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={cooldownSec > 0 || checking}
                onClick={() => handleDigit(digit)}
                className="min-h-[48px] rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-base font-bold text-white transition cursor-pointer disabled:opacity-40"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              disabled={checking || pin.length === 0}
              onClick={handleBackspace}
              className="min-h-[48px] rounded-xl bg-slate-800/70 hover:bg-slate-700 flex items-center justify-center text-slate-300 cursor-pointer disabled:opacity-40"
              aria-label="Effacer"
            >
              <Delete className="w-5 h-5" />
            </button>
            <button
              type="button"
              disabled={cooldownSec > 0 || checking}
              onClick={() => handleDigit('0')}
              className="min-h-[48px] rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-base font-bold text-white transition cursor-pointer disabled:opacity-40"
            >
              0
            </button>
            <button
              type="submit"
              disabled={cooldownSec > 0 || checking || pin.length < 4}
              className="min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>OK</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
