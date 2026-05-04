import type { AppLedgerRecord, UserProfile } from "@/src/app-types";

export interface AppStore {
  getProfile(uid: string): Promise<UserProfile | null>;
  saveProfile(profile: UserProfile): Promise<void>;
  listLedger(uid: string): Promise<AppLedgerRecord[]>;
  findLedger(
    uid: string,
    idempotencyKey: string,
  ): Promise<AppLedgerRecord | null>;
  appendLedger(record: AppLedgerRecord): Promise<void>;
}
