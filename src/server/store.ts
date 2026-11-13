import { MemoryKiranRepository } from "./memory-store.ts";
import { SupabaseKiranRepository } from "./supabase-store.ts";
import type { KiranRepository } from "./types.ts";

let singleton: KiranRepository | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function getRepository(): KiranRepository {
  if (singleton) return singleton;
  if (isSupabaseConfigured()) {
    singleton = new SupabaseKiranRepository(
      process.env.SUPABASE_URL!.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    );
  } else {
    singleton = new MemoryKiranRepository();
  }
  return singleton;
}
