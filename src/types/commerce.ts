export type ThemeMode = 'light' | 'dark';
export type ProductLayoutMode = 'grid' | 'list';
export type SalesChannel = 'WhatsApp' | 'Instagram' | 'Facebook' | 'Boutique' | 'Autre';
export type PaymentMethod = 'Espèces' | 'Mobile Money' | 'Virement' | 'Carte' | 'Crédit';
export type SalePaymentStatus = 'paid' | 'partial' | 'credit';
export type OrderStatus = 'pending' | 'confirmed' | 'delivering' | 'delivered' | 'cancelled';
export type DiscountType = 'percent' | 'fixed';
export type PromotionScope = 'all' | 'category' | 'products';
export type AppMode = 'unset' | 'real' | 'demo';

export type ExpenseCategory =
  | 'Approvisionnement'
  | 'Transport & Livraison'
  | 'Loyer & Électricité'
  | 'Publicité'
  | 'Emballage'
  | 'Salaires'
  | 'Frais divers';

export type CreditTransactionType =
  | 'credit_sale'
  | 'partial_payment'
  | 'advance'
  | 'refund'
  | 'correction';

export interface StoreProfile {
  id: 'default';
  name: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
  themeMode: ThemeMode;
  layoutMode: ProductLayoutMode;
  logoBlobId?: string;
  bannerBlobId?: string;
  instagramHandle: string;
  facebookPage: string;
  tiktokHandle: string;
  updatedAt: number;
}

export interface MediaBlobRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  createdAt: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  costPrice: number;
  extraFees?: number; // Frais supplémentaires par unité (transport, emballage...)
  supplier?: string;  // Fournisseur
  stock: number;
  lowStockThreshold: number;
  unit: string;
  imageBlobId?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Promotion {
  id: string;
  title: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  scope: PromotionScope;
  targetCategory?: string;
  targetProductIds: string[];
  startsAt: string; // YYYY-MM-DD
  endsAt: string;   // YYYY-MM-DD
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  channel: SalesChannel;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  originalPrice: number;
  costPrice?: number;
  extraFees?: number;
  discountApplied: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  receiptNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  channel: SalesChannel;
  paymentMethod: PaymentMethod;
  paymentStatus?: SalePaymentStatus; // Défaut 'paid' pour rétrocompatibilité v1
  amountPaid?: number;               // Montant réellement encaissé à ce jour
  refundedAmount?: number;           // Remboursements effectués
  extraFees?: number;                // Frais additionnels sur la vente
  dueDate?: string;                  // Échéance crédit YYYY-MM-DD
  items: SaleItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  notes: string;
  createdAt: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  channel: SalesChannel;
  status: OrderStatus;
  items: SaleItem[];
  total: number;
  notes: string;
  stockDeducted: boolean;
  linkedSaleId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  date: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  notes: string;
  createdAt: number;
}

export interface CreditTransaction {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  type: CreditTransactionType;
  amount: number; // Toujours >= 0
  direction: 'debt_increase' | 'debt_decrease';
  saleId?: string;
  receiptNumber?: string;
  dueDate?: string; // YYYY-MM-DD
  note: string;
  referenceTransactionId?: string; // Pour correction traçable
  createdAt: number;
}

export interface AssistantMetric {
  label: string;
  value: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  metrics?: AssistantMetric[];
  details?: string[];
  recommendations?: string[];
  followUps?: string[];
  actionRoute?: string;
  actionLabel?: string;
  createdAt: number;
}

export interface CatalogSnapshotProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  originalPrice: number;
  finalPrice: number;
  promoLabel?: string;
  stock: number;
  unit: string;
  imageDataUrl?: string;
}

export interface SavedCatalog {
  id: string;
  title: string;
  subtitle: string;
  createdAt: number;
  updatedAt?: number;
  storeName: string;
  storePhone: string;
  storeEmail: string;
  storeAddress: string;
  storeDescription: string;
  currency: string;
  primaryColor: string;
  accentColor: string;
  logoDataUrl?: string;
  bannerDataUrl?: string;
  showStock: boolean;
  showPromotions: boolean;
  categories: string[];
  products: CatalogSnapshotProduct[];
  htmlSizeBytes: number;
  onlineSlug?: string;
  onlineUrl?: string;
  manageToken?: string;
}

export type LockMethod = 'pin' | 'password' | 'pattern';
export type StoreAccessRole = 'owner' | 'collaborator';
export type CollaboratorPresetRole = 'seller' | 'manager' | 'viewer' | 'custom';

export interface StorePermissions {
  canManageProducts: boolean;
  canRecordSales: boolean;
  canManageOrders: boolean;
  canManageCustomersCredits: boolean;
  canViewFinances: boolean;
  canManageCatalogs: boolean;
  canManageSettings: boolean;
}

export interface StoreCollaborator {
  id: string;
  zandoId: string;
  name: string;
  preset: CollaboratorPresetRole;
  permissions: StorePermissions;
  createdAt: number;
}

export interface StoreSlot {
  id: string;
  dbName: string;
  name: string;
  currency: string;
  createdAt: number;
  role?: StoreAccessRole;
  ownerZandoId?: string;
  collaboratorName?: string;
  permissions?: StorePermissions;
  collaborators?: StoreCollaborator[];
}

export interface AppSecuritySettings {
  pinEnabled: boolean;
  lockMethod?: LockMethod;
  pinHash?: string;
  pinSalt?: string;
  autoLockSeconds: number; // 0 = manuel / démarrage, 15, 30, 60, 300, 900, 1800
  autoLockMinutes?: number; // rétrocompatibilité
  requirePinForSensitiveActions: boolean;
  privacyModeEnabled: boolean;
  backupReminderDays: number; // 0 = désactivé, 7, 14, 30
  browserNotificationsEnabled?: boolean;
}

export interface ProAppSettings {
  receiptPrefix: string;
  orderPrefix: string;
  defaultTaxPercent: number;
  defaultLowStockThreshold: number;
  receiptFooter: string;
  soundFeedback: boolean;
}

export interface SecurityAuditEntry {
  id: string;
  action: string;
  detail: string;
  timestamp: number;
}

export type NotificationCategory =
  | 'stock'
  | 'credit'
  | 'order'
  | 'backup'
  | 'security'
  | 'transfer'
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'urgent' | 'success';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  actionRoute?: string;
  actionLabel?: string;
  dynamic?: boolean;
}

export interface StoreTransferEnvelope {
  format: 'zando-pro-store-transfer';
  version: 1;
  transferId: string;
  kind: 'sale' | 'collaboration';
  senderZandoId: string;
  receiverZandoId: string;
  receiverName?: string;
  storeName: string;
  salePrice?: string;
  note?: string;
  permissions?: StorePermissions;
  createdAt: number;
  alg: 'AES-256-GCM' | 'SHA256-STREAM-V1' | 'XOR-OBF-V1';
  salt?: string;
  iv?: string;
  ciphertext: string;
}

export interface MigrationRecord {
  version: number;
  appliedAt: number;
  description: string;
}

export interface SchemaMeta {
  id: 'schema';
  currentVersion: number;
  appVersion: string;
  lastUpdatedAt: number;
  lastBackupAt?: number;
  migrations: MigrationRecord[];
}

export interface BackupSerializedBlob {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  createdAt: number;
  dataUrl: string;
}

export interface ZandoBackupPayload {
  format: 'zando-pro-backup';
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  storeProfile: StoreProfile;
  products: Product[];
  promotions: Promotion[];
  customers: Customer[];
  sales: Sale[];
  orders: Order[];
  catalogs: SavedCatalog[];
  expenses?: Expense[];
  creditTransactions?: CreditTransaction[];
  mediaBlobs: BackupSerializedBlob[];
}

export interface InitialSyncAssetInfo {
  name: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
}

export interface SyncBundleData {
  appVersion: string;
  dataVersion: number;
  defaultCurrencyOptions: string[];
  defaultLowStockThreshold: number;
  defaultTaxPercent: number;
  receiptFooter: string;
  offlineTips: string[];
}

export interface SyncProgressCheckpoint {
  startedAt: number;
  completedAssets: string[];
  verifiedAssets: InitialSyncAssetInfo[];
  dataDownloaded: boolean;
  dataVerified: boolean;
  bundleSha256?: string;
  bundleData?: SyncBundleData;
  storageVerified: boolean;
  manifestVersion?: string;
}

export interface InitialSyncRecord {
  version: 1;
  completed: boolean;
  completedAt: number;
  deviceId: string;
  appVersion: string;
  serverOrigin: string;
  verifiedAssets: InitialSyncAssetInfo[];
  verifiedDataHash: string;
  bundleDataVersion: number;
  storagePersisted: boolean;
  lastSyncedAt: number;
}

export interface SyncState {
  syncing: boolean;
  lastSyncedAt: number | null;
  pendingChanges: number;
  lastError: string | null;
  lastDeduplicatedCount?: number;
}

