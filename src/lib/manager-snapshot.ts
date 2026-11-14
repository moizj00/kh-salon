import type { DeliveryOrderFull, SalonWithApproval } from "../server/types.ts";

export interface ManagerQuickSnapshot {
  totalPendingDeliveries: number;
  pendingDeliveriesValuePkr: number;
  totalDeliveredCount: number;
  totalOutstandingBalancePkr: number;
  salonsWithBalanceCount: number;
  totalSalonsCount: number;
}

export function computeManagerQuickSnapshot(
  salons: readonly SalonWithApproval[],
  deliveryOrders: readonly DeliveryOrderFull[],
): ManagerQuickSnapshot {
  let totalPendingDeliveries = 0;
  let pendingDeliveriesValuePkr = 0;
  let totalDeliveredCount = 0;

  for (const order of deliveryOrders) {
    if (order.status === "pending_delivery") {
      totalPendingDeliveries += 1;
      pendingDeliveriesValuePkr += Number(order.total_amount || 0);
    } else if (order.status === "delivered") {
      totalDeliveredCount += 1;
    }
  }

  let totalOutstandingBalancePkr = 0;
  let salonsWithBalanceCount = 0;
  for (const salon of salons) {
    const balance = Number(salon.outstanding_balance || 0);
    totalOutstandingBalancePkr += balance;
    if (balance > 0) {
      salonsWithBalanceCount += 1;
    }
  }

  return {
    totalPendingDeliveries,
    pendingDeliveriesValuePkr,
    totalDeliveredCount,
    totalOutstandingBalancePkr,
    salonsWithBalanceCount,
    totalSalonsCount: salons.length,
  };
}
