import type { CatalogSkuInput } from "../lib/catalog.ts";
export type { DeliveryOrder, RouteStop, SKU, Salon } from "../lib/data.ts";
import type { OutboxFn } from "../lib/outbox/types.ts";

export type UserRole = "rep" | "manager" | "owner";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  territory: string;
  monthlyVisitTarget: number;
  deviceStatus?: "pending" | "approved" | "revoked" | null;
  accountStatus?: "active" | "suspended" | "offboarded";
  aalLevel?: "aal1" | "aal2" | null;
  mfaRequired?: boolean;
}

export interface SalonAreaOption {
  id: string;
  name: string;
  territoryId?: string;
  territoryName?: string;
}

export interface RepShift {
  id: string;
  repId: string;
  repName: string;
  status: "open" | "closed";
  openingBagCount: number;
  closingBagCount: number | null;
  expectedBagCount: number | null;
  varianceUnits: number;
  countRecordId: string | null;
  openedAt: string;
  closedAt: string | null;
  approvalStatus: "pending" | "approved" | "flagged";
}

export interface VisitRecord {
  id: string;
  repId: string;
  salonId: string;
  notes: string;
  lat: number | null;
  lng: number | null;
  capturedAt: string;
}

export interface PaymentRecord {
  id: string;
  repId: string;
  salonId: string;
  salonName?: string;
  amount: number;
  method: string;
  capturedAt: string;
  receiptNumber?: string | null;
  bankName?: string | null;
  bankReference?: string | null;
  recordedByName?: string | null;
  recordedByRole?: UserRole;
  reversed?: boolean;
  reversalReason?: string | null;
  reversedAt?: string | null;
  mayReverse?: boolean;
}

export interface CashLedgerEntry {
  id: string;
  entryNumber: string;
  entryType: "cash_collection" | "bank_transfer" | "settlement" | "expense" | "reversal";
  amountPkr: number;
  balanceAfterPkr: number;
  referenceType: "payment" | "receipt" | "reversal" | "handover";
  referenceId: string;
  salonId?: string;
  salonName?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
  status: "pending" | "verified" | "approved" | "reversed";
  bankName?: string | null;
  bankReference?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface OrderCardRecord {
  id: string;
  repId: string;
  salonId: string;
  salonName?: string;
  skuId: string;
  skuName: string;
  qty: number;
  totalAmount: number;
  notes?: string | null;
  status: "pending_approval" | "approved" | "rejected";
  capturedAt: string;
  version?: number;
}

export interface LostDemandRecord {
  id: string;
  repId: string;
  skuName: string;
  qty: number;
  capturedAt: string;
}

export interface PublicShopOrder {
  id: string;
  orderNumber: string;
  productId: string;
  productName: string;
  shadeCode: string;
  shadeVariant: string;
  qty: number;
  unitPricePkr: number;
  totalPkr: number;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  status: "pending" | "confirmed" | "dispatched";
  createdAt: string;
}

export interface RepMonthlyStats {
  visitsCompleted: number;
  visitsTarget: number;
  cashCollectedPkr: number;
  ordersCount: number;
  monthLabel: string;
}

export interface SalonWithApproval extends Salon {
  approval_status?: "approved" | "pending_review" | "rejected";
}

export interface DeliveryOrderFull extends DeliveryOrder {
  signature_data?: string | null;
  created_at?: string | null;
}

export interface BootstrapPayload {
  profile: UserProfile;
  salons: SalonWithApproval[];
  route: RouteStop[];
  skus: SKU[];
  orders: DeliveryOrderFull[];
  activeShift: RepShift | null;
  currentBagCount: number;
  stats: RepMonthlyStats;
  areas?: SalonAreaOption[];
  authMode: "supabase";
}

export interface SalonActivityPayload {
  salon: SalonWithApproval;
  visits: VisitRecord[];
  payments: PaymentRecord[];
  orderCards: OrderCardRecord[];
  recentOrders: DeliveryOrderFull[];
}

export interface ManagerOverviewPayload {
  pendingSalons: SalonWithApproval[];
  pendingOrderCards: OrderCardRecord[];
  shifts: RepShift[];
  recentPayments: PaymentRecord[];
  cashLedgerEntries?: CashLedgerEntry[];
  salons: SalonWithApproval[];
  shopOrders: PublicShopOrder[];
  deliveryOrders: DeliveryOrderFull[];
  lostDemand: LostDemandRecord[];
  skus: SKU[];
  stats: RepMonthlyStats;
}

export interface CreateShopOrderInput {
  productId: string;
  productName: string;
  shadeCode: string;
  shadeVariant: string;
  qty: number;
  unitPricePkr: number;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
}

export interface OfficeDeliverySignatureInput {
  outcome: "signed" | "refused" | "unable";
  signatoryName: string;
  designation: string;
  pngBase64?: string | null;
  note?: string | null;
}

export type ManagerApprovalAction =
  | { action: "approve_salon"; id: string; stage?: "trial" | "regular" | "vip" }
  | { action: "reject_salon"; id: string }
  | { action: "approve_order_card"; id: string }
  | { action: "reject_order_card"; id: string }
  | { action: "bulk_process_order_cards"; ids: string[]; decision: "approve" | "reject" }
  | { action: "mark_delivery_delivered"; id: string; signature?: OfficeDeliverySignatureInput }
  | { action: "mark_deliveries_delivered"; ids: string[] }
  | {
      action: "record_office_payment";
      salonId: string;
      method: "bank_transfer" | "cash";
      amountPkr: number;
      bankName?: string;
      bankReference?: string;
    }
  | {
      action: "reverse_office_payment";
      paymentId: string;
      reason: string;
    };

export interface DeliveryNotificationResult {
  ok: true;
  orderId: string;
  orderNumber: string;
  salonName: string;
  recipientPhone: string;
  notifiedAt: string;
  message: string;
}

// =============================================================================
// Comprehensive Kiran Company Domain Interfaces (Portal, Operations, Finance)
// =============================================================================

export type SalonMembershipStatus =
  | "active"
  | "suspended"
  | "revoked"
  | "applied"
  | "application_rejected"
  | null;

export interface SalonLoginStatus {
  membershipStatus: SalonMembershipStatus;
  salonName: string | null;
}

export type SalonType =
  | "ladies_parlor"
  | "mens_salon"
  | "unisex"
  | "bridal_studio"
  | "barber"
  | "hair_studio"
  | "spa_wellness"
  | "home_parlor"
  | "academy"
  | "other";

export interface SalonPortalProfile {
  salonId: string;
  salonName: string;
  type: SalonType;
  stage: "prospect" | "trial" | "regular" | "vip";
  address: string | null;
  areaName: string;
  contactName: string | null;
  email: string;
  creditLimitPaisa: number;
  planEligibility: string;
  blocked: boolean;
}

export interface SalonCatalogueItem {
  productId: string;
  brandLabel: string;
  productName: string;
  description: string | null;
  imagePath: string | null;
  groupName: string;
  skuId: string;
  code: string;
  variant: string;
  unit: string;
  sizeValue: number | null;
  pricePaisa: number;
  ownPrice: boolean;
}

export interface SalonPortalRequestLine {
  skuId: string;
  code: string;
  productName: string;
  variant: string;
  qty: number;
  unitPricePaisa: number;
  ownPrice: boolean;
}

export interface SalonPortalRequest {
  requestId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  note: string | null;
  lines: SalonPortalRequestLine[];
  status: "open" | "converted" | "dismissed" | "cancelled";
  orderId: string | null;
  reason: string | null;
}

export interface SalonPortalOrder {
  orderId: string;
  createdAt: string;
  status: string;
  plan: string;
  subtotalPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
  fromRequest: boolean;
  waitingOn: string | null;
  lines: Array<{
    lineNo: number;
    code: string;
    productName: string;
    variant: string;
    qty: number;
    unitPricePaisa: number;
  }>;
}

export interface SalonAccountSummary {
  balance: {
    invoicedPaisa: number;
    paidPaisa: number;
    balancePaisa: number;
    overduePaisa: number;
    nextDueOn: string | null;
  };
  installments: Array<{
    invoiceNumber: string;
    seq: number;
    ofCount: number;
    dueOn: string;
    amountDuePaisa: number;
    paidPaisa: number;
    remainingPaisa: number;
    status: string;
  }>;
  payments: Array<{
    receiptNumber: string;
    paidAt: string;
    method: string;
    amountPaisa: number;
  }>;
}

export interface SalonInvoiceRow {
  invoiceId: string;
  number: string;
  issuedAt: string;
  totalPaisa: number;
  paidPaisa: number;
  outstandingPaisa: number;
}

export interface RepBagItem {
  skuId: string;
  code: string;
  variant: string;
  onHand: number;
}

export interface RepPendingStockIssue {
  id: string;
  direction: "to_rep" | "to_warehouse";
  decisionNote: string | null;
  createdAt: string;
  skuIds: string[];
  skus: Array<{ skuId: string; code: string; variant: string }>;
}

export interface CommissionStatement {
  repId: string;
  from: string;
  to: string;
  defaultRateBp: number | null;
  earnedPaisa: number;
  paidPaisa: number;
  earnedToDatePaisa: number;
  paidToDatePaisa: number;
  owedPaisa: number;
  invoiceCount: number;
  invoices: Array<{
    invoiceId: string;
    number: string;
    issuedAt: string;
    salonName: string;
    totalPaisa: number;
    rateBp: number;
    commissionPaisa: number;
  }>;
  payments: Array<{
    paymentId: string;
    kind: "payment" | "reversal";
    amountPaisa: number;
    note: string | null;
    reason: string | null;
    reversesId: string | null;
    reversed: boolean;
    recordedAt: string;
    recordedByName: string;
  }>;
  salonRates: Array<{ salonId: string; salonName: string; rateBp: number | null }>;
}

export interface OfficePendingDelivery {
  submissionId: string;
  orderId: string;
  salonId: string;
  salonName: string;
  repId: string;
  repName: string;
  lines: Array<{
    skuId: string;
    code: string;
    variant: string;
    qty: number;
    unitPricePaisa: number;
  }>;
  totalPaisa: number;
  receivedByName: string;
  distanceFromPinM: number | null;
  mockLocation: boolean;
  flags: Record<string, unknown> | null;
  submittedAt: string;
}

export interface DeliverySignatureStatus {
  signatureId: string | null;
  outcome: string | null;
  signatoryName: string | null;
  signatoryDesignation: string | null;
  statementVersion: number | null;
  signedAt: string | null;
  note: string | null;
  valid: boolean;
  hasPicture: boolean;
}

export interface PendingReturnStockRow {
  submissionId: string;
  repId: string;
  repName: string;
  salonName: string;
  skuId: string;
  skuCode: string;
  unsettled: number;
  pendingLocationId: string;
  reason: string;
  decidedAt: string;
  requestId: string | null;
  requestStatus: string | null;
  requestMakerId: string | null;
  requestCheckerRole: UserRole | null;
  requestQty?: number | null;
  requestDecisionReason?: string | null;
}

export interface SalonSignupRequestRow {
  requestId: string;
  salonName: string;
  contactName: string;
  email: string;
  type: SalonType;
  address: string;
  createdAt: string;
  similarSalons: Array<{ id: string; name: string; area_name: string }>;
}

export interface OfficeInvitationRow {
  id: string;
  kind: "rep" | "salon";
  email: string;
  fullName: string;
  salonId: string | null;
  salonName: string | null;
  status: string;
  expiresAt: string;
  invitedByName: string;
  createdAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export interface OfficeDeviceRow {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  label: string | null;
  platform: string | null;
  status: "pending" | "approved" | "revoked";
  createdAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

export interface OfficeApprovalRequestRow {
  requestId: string;
  kind: "discount" | "adjustment" | string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  subjectType: string;
  subjectId: string;
  madeByMe: boolean;
  makerName: string;
  checkerRoleRequired: UserRole;
  reason: string;
  createdAt: string;
  orderStatus: string | null;
  salonId: string | null;
  salonName: string | null;
  subtotalPaisa: number | null;
  discountPaisa: number | null;
  totalPaisa: number | null;
  locationName: string | null;
  locationKind: string | null;
  skuId: string | null;
  skuCode: string | null;
  qtyDelta: number | null;
}

export interface StockLocationRow {
  id: string;
  name: string;
  kind: "warehouse" | "rep_bag" | "pending_delivery";
  ownerUserId: string | null;
  active: boolean;
}

export interface ProductGroupRow {
  id: string;
  name: string;
  defaultCycleDays: number;
  active: boolean;
}

export interface StockBalanceRow {
  locationId: string;
  skuId: string;
  onHand: number;
}

export interface LowStockAlertRow {
  skuId: string;
  code: string;
  onHand: number;
  reorderPoint: number;
}

export interface OfficeCommissionRepSummary {
  repId: string;
  fullName: string;
  status: string;
  defaultRateBp: number | null;
  earnedPaisa: number;
  paidPaisa: number;
  owedPaisa: number;
}

export interface InvestorSummaryRow {
  investorId: string | null;
  fullName: string;
  phone: string | null;
  status: string | null;
  isTotal: boolean;
  investedPaisa: number;
  principalReturnedPaisa: number;
  principalOutstandingPaisa: number;
  profitDecidedPaisa: number;
  profitPaidPaisa: number;
  profitOwedPaisa: number;
}

export interface InvestorInvestmentRow {
  investmentId: string;
  investedOn: string;
  note: string | null;
  recordedAt: string;
  reversed: boolean;
  investedPaisa: number;
  principalReturnedPaisa: number;
  principalOutstandingPaisa: number;
  profitDecidedPaisa: number;
  profitPaidPaisa: number;
  profitOwedPaisa: number;
}

export interface InvestorStatementEntry {
  entryKind: string;
  entryId: string;
  investmentId: string;
  entryOn: string;
  payoutKind: "principal" | "profit" | null;
  method: "cash" | "bank" | null;
  reference: string | null;
  amountPaisa: number;
  note: string | null;
  reason: string | null;
  reversesId: string | null;
  reversed: boolean;
  recordedByName: string;
  recordedAt: string;
  principalOutstandingPaisa: number;
  profitOwedPaisa: number;
}

export class RpcError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface BulkSalonInput {
  name: string;
  area?: string;
  phone?: string;
  contact?: string;
  creditLimit?: number;
}

export interface KiranRepository {
  getBootstrap(user: UserProfile): Promise<BootstrapPayload>;
  executeRpc(user: UserProfile, fn: OutboxFn, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  getSalonActivity(salonId: string): Promise<SalonActivityPayload>;
  createShopOrder(input: CreateShopOrderInput): Promise<PublicShopOrder>;
  listShopOrders(): Promise<PublicShopOrder[]>;
  getManagerOverview(user: UserProfile): Promise<ManagerOverviewPayload>;
  handleManagerApproval(input: ManagerApprovalAction, actor?: UserProfile): Promise<{ ok: true; message: string }>;
  notifyDelivery(orderId: string): Promise<DeliveryNotificationResult>;
  bulkImportSalons(salons: BulkSalonInput[], createdBy: string): Promise<number>;
  upsertCatalogSku(input: CatalogSkuInput, existingId?: string): Promise<SKU>;
  listCashLedgerEntries(): Promise<CashLedgerEntry[]>;
}
