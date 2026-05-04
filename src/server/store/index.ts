import { FileAppStore } from "./file-store";
import { SupabaseAppStore } from "./supabase-store";
import type { AppStore } from "./types";

let store: AppStore | null = null;

export function getStore(): AppStore {
  if (store) return store;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    store = new SupabaseAppStore();
  } else {
    store = new FileAppStore();
  }
  return store;
}
