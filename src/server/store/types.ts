import type { AppLedgerRecord, UserProfile } from "@/src/app-types";
import type { ImportStatus } from "@/src/contracts.js";

export interface ImportJobQuery {
  uid?: string;
  statuses?: ImportStatus[];
  limit?: number;
}

export interface AppStore {
  getProfile(uid: string): Promise<UserProfile | null>;
  saveProfile(profile: UserProfile): Promise<void>;
  listLedger(uid: string): Promise<AppLedgerRecord[]>;
  listImportJobs(query?: ImportJobQuery): Promise<AppLedgerRecord[]>;
  findLedger(
    uid: string,
    idempotencyKey: string,
  ): Promise<AppLedgerRecord | null>;
  appendLedger(record: AppLedgerRecord): Promise<void>;
}
