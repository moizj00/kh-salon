import { MemoryKiranRepository } from "./memory-store.ts";
import { SupabaseKiranRepository } from "./supabase-store.ts";
import { RpcError, type KiranRepository } from "./types.ts";

let singleton: KiranRepository | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function isUninitializedSchemaError(err: unknown): boolean {
  return (
    err instanceof RpcError &&
    (err.code === "PGRST205" || err.code === "42P01" || err.status === 503)
  );
}

class ResilientKiranRepository implements KiranRepository {
  private primary: SupabaseKiranRepository;
  private fallback = new MemoryKiranRepository();
  private useFallback = false;

  constructor(url: string, serviceRoleKey: string) {
    this.primary = new SupabaseKiranRepository(url, serviceRoleKey);
  }

  private async run<T>(fn: (repo: KiranRepository) => Promise<T>): Promise<T> {
    if (this.useFallback) {
      return fn(this.fallback);
    }
    try {
      return await fn(this.primary);
    } catch (err) {
      if (isUninitializedSchemaError(err)) {
        this.useFallback = true;
        return fn(this.fallback);
      }
      throw err;
    }
  }

  getBootstrap: KiranRepository["getBootstrap"] = (user) =>
    this.run((repo) => repo.getBootstrap(user));

  executeRpc: KiranRepository["executeRpc"] = (user, fnName, args) =>
    this.run((repo) => repo.executeRpc(user, fnName, args));

  getSalonActivity: KiranRepository["getSalonActivity"] = (salonId) =>
    this.run((repo) => repo.getSalonActivity(salonId));

  createShopOrder: KiranRepository["createShopOrder"] = (input) =>
    this.run((repo) => repo.createShopOrder(input));

  listShopOrders: KiranRepository["listShopOrders"] = () =>
    this.run((repo) => repo.listShopOrders());

  getManagerOverview: KiranRepository["getManagerOverview"] = (user) =>
    this.run((repo) => repo.getManagerOverview(user));

  handleManagerApproval: KiranRepository["handleManagerApproval"] = (input) =>
    this.run((repo) => repo.handleManagerApproval(input));

  notifyDelivery: KiranRepository["notifyDelivery"] = (orderId) =>
    this.run((repo) => repo.notifyDelivery(orderId));

  bulkImportSalons: KiranRepository["bulkImportSalons"] = (salons, createdBy) =>
    this.run((repo) => repo.bulkImportSalons(salons, createdBy));
}

export function getRepository(): KiranRepository {
  if (singleton) return singleton;
  if (isSupabaseConfigured()) {
    singleton = new ResilientKiranRepository(
      process.env.SUPABASE_URL!.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    );
  } else {
    singleton = new MemoryKiranRepository();
  }
  return singleton;
}
