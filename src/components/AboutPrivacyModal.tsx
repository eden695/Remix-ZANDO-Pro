import React, {useEffect, useState} from 'react';
import {Database, Info, Lock, ShieldCheck, Smartphone, WifiOff} from 'lucide-react';
import {SheetModal} from './SheetModal';
import {ZandoLogo} from './ZandoLogo';
import {APP_VERSION} from '../db/indexedDb';

interface AboutPrivacyModalProps {
  open: boolean;
  initialTab?: 'about' | 'privacy';
  zandoDeviceId: string;
  onClose: () => void;
}

export const AboutPrivacyModal: React.FC<AboutPrivacyModalProps> = ({
  open,
  initialTab = 'about',
  zandoDeviceId,
  onClose,
}) => {
  const [tab, setTab] = useState<'about' | 'privacy'>(initialTab);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  return (
    <SheetModal
      open={open}
      onClose={onClose}
      title={tab === 'about' ? 'À propos de ZANDO Pro' : 'Confidentialité & Sécurité'}
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setTab('about')}
            className={`min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              tab === 'about'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>À propos</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('privacy')}
            className={`min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              tab === 'privacy'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Confidentialité</span>
          </button>
        </div>

        {tab === 'about' ? (
          <div className="space-y-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 flex items-center justify-between gap-3">
              <div>
                <ZandoLogo />
                <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Version <strong>v{APP_VERSION}</strong> · Gestion commerciale Offline-First
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Identifiant appareil</div>
                <div className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  {zandoDeviceId}
                </div>
              </div>
            </div>

            <p>
              <strong>ZANDO Pro</strong> est conçu pour les commerçants, gérants et vendeurs sur les
              réseaux sociaux (WhatsApp, Facebook, Instagram) qui veulent une caisse fiable, rapide
              et autonome sans dépendre d’une connexion Internet.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <WifiOff className="w-4 h-4 text-emerald-600" />
                  <span>Synchronisation initiale puis mode hors ligne</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Une connexion Internet est requise au premier lancement pour télécharger et
                  vérifier toutes les ressources nécessaires. Ensuite, ZANDO Pro fonctionne sans réseau.
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-600" />
                  <span>Multi-boutiques & Transferts</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Jusqu’à 3 boutiques isolées, vente de boutique complète ou collaboration avec droits.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 space-y-1.5">
              <div className="font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                <Database className="w-4 h-4" />
                <span>Stockage strictement local sur votre appareil</span>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-200/90">
                Vos produits, photos, clients, ventes, bénéfices, crédits et catalogues restent
                enregistrés dans la base IndexedDB de votre téléphone ou ordinateur. ZANDO Pro ne
                collecte aucune statistique, aucune télémétrie et aucun compte cloud obligatoire.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5">
              <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-emerald-600" />
                <span>Chiffrement & Contrôle d’accès</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                <li>
                  <strong>Code PIN, Mot de passe & Schéma :</strong> hachés localement avec sel
                  aléatoire (PBKDF2-SHA256) — jamais stockés en clair.
                </li>
                <li>
                  <strong>Sauvegardes & Transferts de boutiques :</strong> chiffrés en local via
                  AES-256-GCM et liés exclusivement à l’Identifiant ZANDO du destinataire.
                </li>
                <li>
                  <strong>Synchronisation initiale & mises à jour discrètes :</strong> le premier
                  lancement télécharge et vérifie les ressources indispensables localement. Lorsque
                  Internet revient, une synchronisation non bloquante met à jour vos données sans
                  doublons ni perte locale.
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </SheetModal>
  );
};
