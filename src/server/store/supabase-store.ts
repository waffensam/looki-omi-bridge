import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AppLedgerRecord, UserProfile } from "@/src/app-types";
import type { AppStore, ImportJobQuery } from "./types";

let client: SupabaseClient | null = null;

export class SupabaseAppStore implements AppStore {
  async getProfile(uid: string): Promise<UserProfile | null> {
    const { data, error } = await getClient()
      .from("looki_profiles")
      .select("*")
      .eq("uid", uid)
      .maybeSingle();
    if (error) throw new Error(`Failed to read profile: ${error.message}`);
    if (!data) return null;
    return {
      uid: data.uid,
      lookiBaseUrl: data.looki_base_url,
      encryptedLookiApiKey: data.encrypted_looki_api_key,
      providerMode: data.provider_mode,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    const { error } = await getClient().from("looki_profiles").upsert({
      uid: profile.uid,
      looki_base_url: profile.lookiBaseUrl,
      encrypted_looki_api_key: profile.encryptedLookiApiKey,
      provider_mode: profile.providerMode,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    });
    if (error) throw new Error(`Failed to save profile: ${error.message}`);
  }

  async listLedger(uid: string): Promise<AppLedgerRecord[]> {
    const { data, error } = await getClient()
      .from("import_ledger")
      .select("uid, record, provider")
      .eq("uid", uid)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list ledger: ${error.message}`);
    return (data || []) as AppLedgerRecord[];
  }

  async listImportJobs(query: ImportJobQuery = {}): Promise<AppLedgerRecord[]> {
    const statuses = query.statuses || ["queued"];
    let builder = getClient()
      .from("import_ledger")
      .select("uid, record, provider")
      .in("status", statuses)
      .order("updated_at", { ascending: true });
    if (query.uid) builder = builder.eq("uid", query.uid);
    if (query.limit) builder = builder.limit(query.limit);
    const { data, error } = await builder;
    if (error) throw new Error(`Failed to list import jobs: ${error.message}`);
    return (data || []) as AppLedgerRecord[];
  }

  async findLedger(
    uid: string,
    idempotencyKey: string,
  ): Promise<AppLedgerRecord | null> {
    const { data, error } = await getClient()
      .from("import_ledger")
      .select("uid, record, provider")
      .eq("uid", uid)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw new Error(`Failed to read ledger: ${error.message}`);
    return (data as AppLedgerRecord | null) || null;
  }

  async appendLedger(record: AppLedgerRecord): Promise<void> {
    const { error } = await getClient()
      .from("import_ledger")
      .upsert({
        uid: record.uid,
        idempotency_key: record.record.idempotencyKey,
        record: record.record,
        provider: record.provider || null,
        target: record.record.target,
        status: record.record.status,
        created_at: record.record.createdAt,
        updated_at: record.record.updatedAt,
      });
    if (error) throw new Error(`Failed to append ledger: ${error.message}`);
  }
}

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase store",
    );
  }
  client = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return client;
}
