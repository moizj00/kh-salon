import type { DeliveryOrder, RouteStop, SKU, Salon } from "../lib/data.ts";
import type { OutboxFn } from "../lib/outbox/types.ts";

export type UserRole = "rep" | "manager";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  territory: string;
  monthlyVisitTarget: number;
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
  status: "pending_approval" | "approved" | "rejected";
  capturedAt: string;
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
  authMode: "supabase" | "demo";
}

export interface SalonActivityPayload {
  salon: SalonWithApproval;
  visits: VisitRecord[];
  payments: PaymentRecord[];
  orderCards: OrderCardRecord[];
}

export interface ManagerOverviewPayload {
  pendingSalons: SalonWithApproval[];
  pendingOrderCards: OrderCardRecord[];
  shifts: RepShift[];
  recentPayments: PaymentRecord[];
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

export type ManagerApprovalAction =
  | { action: "approve_salon"; id: string; stage?: "trial" | "regular" | "vip" }
  | { action: "reject_salon"; id: string }
  | { action: "approve_order_card"; id: string }
  | { action: "reject_order_card"; id: string }
  | { action: "approve_shift"; id: string }
  | { action: "flag_shift"; id: string }
  | { action: "update_shop_order_status"; id: string; status: "pending" | "confirmed" | "dispatched" };

export class RpcError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface KiranRepository {
  getBootstrap(user: UserProfile): Promise<BootstrapPayload>;
  executeRpc(user: UserProfile, fn: OutboxFn, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  getSalonActivity(salonId: string): Promise<SalonActivityPayload>;
  createShopOrder(input: CreateShopOrderInput): Promise<PublicShopOrder>;
  listShopOrders(): Promise<PublicShopOrder[]>;
  getManagerOverview(user: UserProfile): Promise<ManagerOverviewPayload>;
  handleManagerApproval(input: ManagerApprovalAction): Promise<{ ok: true; message: string }>;
}
