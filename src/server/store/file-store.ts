import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { AppLedgerRecord, UserProfile } from "@/src/app-types";
import type { AppStore, ImportJobQuery } from "./types";

interface FileStoreShape {
  profiles: UserProfile[];
  ledger: AppLedgerRecord[];
}

const STORE_PATH =
  process.env.LOCAL_APP_STORE_PATH || path.join("data", "app-store.json");

export class FileAppStore implements AppStore {
  async getProfile(uid: string): Promise<UserProfile | null> {
    const store = await readStore();
    return store.profiles.find((profile) => profile.uid === uid) || null;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    const store = await readStore();
    const nextProfiles = store.profiles.filter(
      (item) => item.uid !== profile.uid,
    );
    nextProfiles.push(profile);
    await writeStore({ ...store, profiles: nextProfiles });
  }

  async listLedger(uid: string): Promise<AppLedgerRecord[]> {
    const store = await readStore();
    return store.ledger.filter((entry) => entry.uid === uid);
  }

  async listImportJobs(query: ImportJobQuery = {}): Promise<AppLedgerRecord[]> {
    const store = await readStore();
    const statuses = new Set(query.statuses || ["queued"]);
    return store.ledger
      .filter((entry) => statuses.has(entry.record.status))
      .filter((entry) => !query.uid || entry.uid === query.uid)
      .sort((a, b) => a.record.updatedAt.localeCompare(b.record.updatedAt))
      .slice(0, query.limit || store.ledger.length);
  }

  async findLedger(
    uid: string,
    idempotencyKey: string,
  ): Promise<AppLedgerRecord | null> {
    const store = await readStore();
    return (
      store.ledger.find(
        (entry) =>
          entry.uid === uid && entry.record.idempotencyKey === idempotencyKey,
      ) || null
    );
  }

  async appendLedger(record: AppLedgerRecord): Promise<void> {
    const store = await readStore();
    const withoutDuplicate = store.ledger.filter(
      (entry) =>
        !(
          entry.uid === record.uid &&
          entry.record.idempotencyKey === record.record.idempotencyKey
        ),
    );
    withoutDuplicate.push(record);
    await writeStore({ ...store, ledger: withoutDuplicate });
  }
}

async function readStore(): Promise<FileStoreShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as FileStoreShape;
  } catch {
    return { profiles: [], ledger: [] };
  }
}

async function writeStore(store: FileStoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
