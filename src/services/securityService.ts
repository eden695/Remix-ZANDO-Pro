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

// Pure-JS SHA-256 / HMAC-SHA256 / Stream cipher fallback pour WebView file:// (Website 2 APK) sans crypto.subtle
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function pureSha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data, 0);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (v: number, n: number) => (v >>> n) | (v << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, h[i], false);
  }
  return out;
}

function pureHmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = key.length > 64 ? pureSha256(key) : key;
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  ipad.fill(0x36);
  opad.fill(0x5c);
  for (let i = 0; i < k.length; i++) {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad, 0);
  inner.set(msg, 64);
  const innerHash = pureSha256(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad, 0);
  outer.set(innerHash, 64);
  return pureSha256(outer);
}

function deriveLocalStreamKeys(secret: Uint8Array, salt: Uint8Array, rounds = 2048): {
  encKey: Uint8Array;
  macKey: Uint8Array;
} {
  let block = new Uint8Array(salt.length + 4);
  block.set(salt, 0);
  block[salt.length + 3] = 1;
  let u = pureHmacSha256(secret, block);
  const acc = new Uint8Array(u);
  for (let i = 1; i < rounds; i++) {
    u = pureHmacSha256(secret, u);
    for (let j = 0; j < 32; j++) acc[j] ^= u[j];
  }
  const encKey = pureHmacSha256(acc, new TextEncoder().encode('enc'));
  const macKey = pureHmacSha256(acc, new TextEncoder().encode('mac'));
  return {encKey, macKey};
}

function pureStreamXor(data: Uint8Array, encKey: Uint8Array, iv: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  const blockInput = new Uint8Array(iv.length + 4);
  blockInput.set(iv, 0);
  const view = new DataView(blockInput.buffer);
  let offset = 0;
  let counter = 0;
  while (offset < data.length) {
    view.setUint32(iv.length, counter++, false);
    const keystream = pureHmacSha256(encKey, blockInput);
    const take = Math.min(32, data.length - offset);
    for (let i = 0; i < take; i++) {
      out[offset + i] = data[offset + i] ^ keystream[i];
    }
    offset += take;
  }
  return out;
}

function legacyFnvHash(pin: string, saltBytes: Uint8Array): string {
  let acc = 0x811c9dc5;
  const input = `${bytesToBase64(saltBytes)}:${pin}`;
  for (let i = 0; i < input.length; i++) {
    acc ^= input.charCodeAt(i);
    acc = Math.imul(acc, 0x01000193);
  }
  return `fb_${(acc >>> 0).toString(16)}`;
}

function getRandomBytesSafe(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
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
  const {encKey} = deriveLocalStreamKeys(new TextEncoder().encode(pin), saltBytes, 2048);
  return `sha256_${bytesToBase64(encKey)}`;
}

export async function hashPinCode(pin: string): Promise<{hash: string; salt: string}> {
  const saltBytes = getRandomBytesSafe(16);
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
    if (expectedHash.startsWith('fb_')) {
      return constantTimeEqual(legacyFnvHash(pin, saltBytes), expectedHash);
    }
    if (expectedHash.startsWith('sha256_')) {
      const {encKey} = deriveLocalStreamKeys(new TextEncoder().encode(pin), saltBytes, 2048);
      return constantTimeEqual(`sha256_${bytesToBase64(encKey)}`, expectedHash);
    }
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
  const salt = getRandomBytesSafe(16);
  const iv = getRandomBytesSafe(12);
  const enc = new TextEncoder();

  if (typeof crypto !== 'undefined' && crypto.subtle) {
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
      ['encrypt'],
    );
    const cipherBuffer = await crypto.subtle.encrypt(
      {name: 'AES-GCM', iv: iv.buffer as ArrayBuffer},
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

  // Fallback authentifié 100% hors ligne pour WebView file:// (Website 2 APK Builder)
  const {encKey, macKey} = deriveLocalStreamKeys(enc.encode(passphrase), salt, 2048);
  const ciphertext = pureStreamXor(enc.encode(plainJson), encKey, iv);
  const macInput = new Uint8Array(salt.length + iv.length + ciphertext.length);
  macInput.set(salt, 0);
  macInput.set(iv, salt.length);
  macInput.set(ciphertext, salt.length + iv.length);
  const mac = pureHmacSha256(macKey, macInput);

  return JSON.stringify({
    format: 'zando-pro-encrypted-backup',
    alg: 'ZANDO-SHA256-STREAM-V1',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    mac: bytesToBase64(mac),
    ciphertext: bytesToBase64(ciphertext),
    createdAt: Date.now(),
  });
}

export async function decryptBackupText(encryptedJson: string, passphrase: string): Promise<string> {
  const parsed = JSON.parse(encryptedJson) as {
    format?: string;
    alg?: string;
    salt?: string;
    iv?: string;
    mac?: string;
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

  if (parsed.alg === 'ZANDO-SHA256-STREAM-V1') {
    if (!parsed.mac) {
      throw new Error('Fichier de sauvegarde chiffré incomplet.');
    }
    const {encKey, macKey} = deriveLocalStreamKeys(enc.encode(passphrase), salt, 2048);
    const macInput = new Uint8Array(salt.length + iv.length + ciphertext.length);
    macInput.set(salt, 0);
    macInput.set(iv, salt.length);
    macInput.set(ciphertext, salt.length + iv.length);
    const expectedMac = bytesToBase64(pureHmacSha256(macKey, macInput));
    if (!constantTimeEqual(expectedMac, parsed.mac)) {
      throw new Error('Mot de passe incorrect ou fichier de sauvegarde chiffré altéré.');
    }
    const plainBytes = pureStreamXor(ciphertext, encKey, iv);
    return new TextDecoder().decode(plainBytes);
  }

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Ce fichier AES-GCM a été créé en mode HTTPS : ouvrez ZANDO Pro sur navigateur HTTPS pour le déchiffrer.',
    );
  }

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
): Promise<{
  alg: 'AES-256-GCM' | 'SHA256-STREAM-V1' | 'XOR-OBF-V1';
  salt?: string;
  iv?: string;
  ciphertext: string;
}> {
  const normalizedTarget = receiverZandoId.trim().toUpperCase();
  const secretKey = `ZANDO-STORE-TRANSFER::${normalizedTarget}::V1`;
  const enc = new TextEncoder();

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const salt = getRandomBytesSafe(16);
    const iv = getRandomBytesSafe(12);
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
      ['encrypt'],
    );
    const cipherBuf = await crypto.subtle.encrypt(
      {name: 'AES-GCM', iv: iv.buffer as ArrayBuffer},
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

  // Fallback chiffré authentifié SHA-256 compatible file:// APK
  const salt = getRandomBytesSafe(16);
  const iv = getRandomBytesSafe(12);
  const {encKey, macKey} = deriveLocalStreamKeys(enc.encode(secretKey), salt, 1024);
  const cipherBytes = pureStreamXor(enc.encode(plainJson), encKey, iv);
  const macInput = new Uint8Array(salt.length + iv.length + cipherBytes.length);
  macInput.set(salt, 0);
  macInput.set(iv, salt.length);
  macInput.set(cipherBytes, salt.length + iv.length);
  const mac = pureHmacSha256(macKey, macInput);
  const combined = new Uint8Array(32 + cipherBytes.length);
  combined.set(mac, 0);
  combined.set(cipherBytes, 32);

  return {
    alg: 'SHA256-STREAM-V1',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(combined),
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
      throw new Error('Déchiffrement AES-GCM indisponible dans ce WebView : utilisez un transfert généré localement.');
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

  if (envelope.alg === 'SHA256-STREAM-V1' && envelope.salt && envelope.iv) {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const combined = base64ToBytes(envelope.ciphertext);
    if (combined.length < 32) {
      throw new Error('Paquet de transfert incomplet.');
    }
    const mac = bytesToBase64(combined.subarray(0, 32));
    const cipherBytes = combined.subarray(32);
    const {encKey, macKey} = deriveLocalStreamKeys(enc.encode(secretKey), salt, 1024);
    const macInput = new Uint8Array(salt.length + iv.length + cipherBytes.length);
    macInput.set(salt, 0);
    macInput.set(iv, salt.length);
    macInput.set(cipherBytes, salt.length + iv.length);
    const expectedMac = bytesToBase64(pureHmacSha256(macKey, macInput));
    if (!constantTimeEqual(expectedMac, mac)) {
      throw new Error(
        'Ce transfert est chiffré pour un autre Identifiant ZANDO Pro. Vérifiez l’identifiant utilisé.',
      );
    }
    return new TextDecoder().decode(pureStreamXor(cipherBytes, encKey, iv));
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
