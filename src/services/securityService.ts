import {
  AppSecuritySettings,
  LockMethod,
  ProAppSettings,
  SecurityAuditEntry,
} from '../types/commerce';
import {generateId} from '../utils/format';

const SECURITY_SETTINGS_KEY = 'zando_pro_security_settings_v1';
const PRO_SETTINGS_KEY = 'zando_pro_app_settings_v1';
const AUDIT_LOG_KEY = 'zando_pro_security_audit_v1';
const LOCK_COOLDOWN_KEY = 'zando_pro_lock_cooldown_v1';
const ZANDO_DEVICE_ID_KEY = 'zando_pro_device_id_v1';

export const DEFAULT_SECURITY_SETTINGS: AppSecuritySettings = {
  pinEnabled: false,
  lockMethod: 'pin',
  autoLockSeconds: 300,
  requirePinForSensitiveActions: true,
  privacyModeEnabled: false,
  backupReminderDays: 14,
  browserNotificationsEnabled: false,
};

export const DEFAULT_PRO_SETTINGS: ProAppSettings = {
  receiptPrefix: 'FAC-',
  orderPrefix: 'CMD-',
  defaultTaxPercent: 0,
  defaultLowStockThreshold: 3,
  receiptFooter: 'Merci pour votre confiance !',
  soundFeedback: true,
};

export function getLockMethodLabel(method?: LockMethod): string {
  if (method === 'password') return 'Mot de passe';
  if (method === 'pattern') return 'Schéma';
  return 'Code PIN';
}

export function getOrCreateZandoDeviceId(): string {
  try {
    const existing = localStorage.getItem(ZANDO_DEVICE_ID_KEY);
    if (existing && /^ZND-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Ignore storage access issue
  }

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  const formatted = `ZND-${code.slice(0, 4)}-${code.slice(4, 8)}`;
  try {
    localStorage.setItem(ZANDO_DEVICE_ID_KEY, formatted);
  } catch {
    // Ignore storage quota error
  }
  return formatted;
}

export function getSecuritySettings(): AppSecuritySettings {
  try {
    const raw = localStorage.getItem(SECURITY_SETTINGS_KEY);
    if (!raw) return DEFAULT_SECURITY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSecuritySettings>;
    const autoLockSeconds =
      typeof parsed.autoLockSeconds === 'number'
        ? parsed.autoLockSeconds
        : typeof parsed.autoLockMinutes === 'number'
          ? parsed.autoLockMinutes * 60
          : DEFAULT_SECURITY_SETTINGS.autoLockSeconds;
    return {
      ...DEFAULT_SECURITY_SETTINGS,
      ...parsed,
      lockMethod: parsed.lockMethod || 'pin',
      autoLockSeconds,
    };
  } catch {
    return DEFAULT_SECURITY_SETTINGS;
  }
}

export function saveSecuritySettings(next: AppSecuritySettings): void {
  try {
    localStorage.setItem(SECURITY_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota restriction
  }
}

export function getProAppSettings(): ProAppSettings {
  try {
    const raw = localStorage.getItem(PRO_SETTINGS_KEY);
    if (!raw) return DEFAULT_PRO_SETTINGS;
    return {...DEFAULT_PRO_SETTINGS, ...JSON.parse(raw)};
  } catch {
    return DEFAULT_PRO_SETTINGS;
  }
}

export function saveProAppSettings(next: ProAppSettings): void {
  try {
    localStorage.setItem(PRO_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota restriction
  }
}

export function getSecurityAuditLog(): SecurityAuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendSecurityAudit(action: string, detail: string): SecurityAuditEntry[] {
  const entry: SecurityAuditEntry = {
    id: generateId('sec'),
    action,
    detail,
    timestamp: Date.now(),
  };
  const current = getSecurityAuditLog();
  const next = [entry, ...current].slice(0, 60);
  try {
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}

export function clearSecurityAuditLog(): void {
  try {
    localStorage.removeItem(AUDIT_LOG_KEY);
  } catch {
    // Ignore
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function derivePinHash(pin: string, saltBytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(pin),
      {name: 'PBKDF2'},
      false,
      ['deriveBits'],
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );
    return bytesToBase64(new Uint8Array(derived));
  }
  // Fallback uniquement pour WebView HTTP non-sécurisé sans crypto.subtle
  let acc = 0x811c9dc5;
  const input = `${bytesToBase64(saltBytes)}:${pin}`;
  for (let i = 0; i < input.length; i++) {
    acc ^= input.charCodeAt(i);
    acc = Math.imul(acc, 0x01000193);
  }
  return `fb_${(acc >>> 0).toString(16)}`;
}

export async function hashPinCode(pin: string): Promise<{hash: string; salt: string}> {
  const saltBytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(saltBytes);
  } else {
    for (let i = 0; i < saltBytes.length; i++) {
      saltBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hash = await derivePinHash(pin, saltBytes);
  return {hash, salt: bytesToBase64(saltBytes)};
}

export async function verifyPinCode(
  pin: string,
  expectedHash?: string,
  saltB64?: string,
): Promise<boolean> {
  if (!expectedHash || !saltB64) return false;
  try {
    const saltBytes = base64ToBytes(saltB64);
    const computed = await derivePinHash(pin, saltBytes);
    return constantTimeEqual(computed, expectedHash);
  } catch {
    return false;
  }
}

export function getLockCooldownState(): {attempts: number; lockedUntil: number} {
  try {
    const raw = localStorage.getItem(LOCK_COOLDOWN_KEY);
    if (!raw) return {attempts: 0, lockedUntil: 0};
    return JSON.parse(raw) as {attempts: number; lockedUntil: number};
  } catch {
    return {attempts: 0, lockedUntil: 0};
  }
}

export function recordFailedPinAttempt(): {attempts: number; lockedUntil: number} {
  const cur = getLockCooldownState();
  const attempts = cur.attempts + 1;
  const lockedUntil = attempts >= 5 ? Date.now() + 30000 : 0;
  const next = {attempts, lockedUntil};
  try {
    localStorage.setItem(LOCK_COOLDOWN_KEY, JSON.stringify(next));
  } catch {
    // Ignore
  }
  return next;
}

export function clearPinCooldown(): void {
  try {
    localStorage.removeItem(LOCK_COOLDOWN_KEY);
  } catch {
    // Ignore
  }
}

export async function encryptBackupText(plainJson: string, passphrase: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('Le chiffrement AES-GCM nécessite un contexte sécurisé (HTTPS ou localhost).');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    {name: 'PBKDF2'},
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    {name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256'},
    keyMaterial,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt'],
  );
  const cipherBuffer = await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv},
    aesKey,
    enc.encode(plainJson),
  );

  return JSON.stringify({
    format: 'zando-pro-encrypted-backup',
    alg: 'AES-256-GCM-PBKDF2',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    createdAt: Date.now(),
  });
}

export async function decryptBackupText(encryptedJson: string, passphrase: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('Le déchiffrement AES-GCM nécessite un contexte sécurisé (HTTPS ou localhost).');
  }
  const parsed = JSON.parse(encryptedJson) as {
    format?: string;
    salt?: string;
    iv?: string;
    ciphertext?: string;
  };
  if (
    parsed.format !== 'zando-pro-encrypted-backup' ||
    !parsed.salt ||
    !parsed.iv ||
    !parsed.ciphertext
  ) {
    throw new Error('Format de sauvegarde chiffrée invalide.');
  }

  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const ciphertext = base64ToBytes(parsed.ciphertext);
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    {name: 'PBKDF2'},
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    {name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 120000, hash: 'SHA-256'},
    keyMaterial,
    {name: 'AES-GCM', length: 256},
    false,
    ['decrypt'],
  );
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: iv.buffer as ArrayBuffer},
      aesKey,
      ciphertext.buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    throw new Error('Mot de passe incorrect ou fichier de sauvegarde chiffré altéré.');
  }
}

export async function encryptForZandoReceiver(
  plainJson: string,
  receiverZandoId: string,
): Promise<{alg: 'AES-256-GCM' | 'XOR-OBF-V1'; salt?: string; iv?: string; ciphertext: string}> {
  const normalizedTarget = receiverZandoId.trim().toUpperCase();
  const secretKey = `ZANDO-STORE-TRANSFER::${normalizedTarget}::V1`;
  const enc = new TextEncoder();

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretKey),
      {name: 'PBKDF2'},
      false,
      ['deriveKey'],
    );
    const aesKey = await crypto.subtle.deriveKey(
      {name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256'},
      keyMaterial,
      {name: 'AES-GCM', length: 256},
      false,
      ['encrypt'],
    );
    const cipherBuf = await crypto.subtle.encrypt(
      {name: 'AES-GCM', iv},
      aesKey,
      enc.encode(plainJson),
    );
    return {
      alg: 'AES-256-GCM',
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    };
  }

  // Fallback hors-contexte sécurisé
  const raw = enc.encode(plainJson);
  const key = enc.encode(secretKey);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] ^ key[i % key.length];
  }
  return {
    alg: 'XOR-OBF-V1',
    ciphertext: bytesToBase64(out),
  };
}

export async function decryptForZandoReceiver(
  envelope: {alg: string; salt?: string; iv?: string; ciphertext: string},
  receiverZandoId: string,
): Promise<string> {
  const normalizedTarget = receiverZandoId.trim().toUpperCase();
  const secretKey = `ZANDO-STORE-TRANSFER::${normalizedTarget}::V1`;
  const enc = new TextEncoder();

  if (envelope.alg === 'AES-256-GCM') {
    if (typeof crypto === 'undefined' || !crypto.subtle || !envelope.salt || !envelope.iv) {
      throw new Error('Déchiffrement AES-GCM impossible dans cet environnement.');
    }
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretKey),
      {name: 'PBKDF2'},
      false,
      ['deriveKey'],
    );
    const aesKey = await crypto.subtle.deriveKey(
      {name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 60000, hash: 'SHA-256'},
      keyMaterial,
      {name: 'AES-GCM', length: 256},
      false,
      ['decrypt'],
    );
    try {
      const plainBuf = await crypto.subtle.decrypt(
        {name: 'AES-GCM', iv: iv.buffer as ArrayBuffer},
        aesKey,
        ciphertext.buffer as ArrayBuffer,
      );
      return new TextDecoder().decode(plainBuf);
    } catch {
      throw new Error(
        'Ce transfert est chiffré pour un autre Identifiant ZANDO Pro. Vérifiez l’identifiant utilisé.',
      );
    }
  }

  const raw = base64ToBytes(envelope.ciphertext);
  const key = enc.encode(secretKey);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw[i] ^ key[i % key.length];
  }
  return new TextDecoder().decode(out);
}

export function playSaleFeedbackBeep(enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      setTimeout(() => ctx.close().catch(() => {}), 250);
    }
    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
  } catch {
    // Ignore audio restrictions
  }
}
