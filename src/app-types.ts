import type {
  ImportLedgerRecord,
  LookiMemoryCandidate,
  NormalizedTranscript,
} from "./contracts.js";

export interface LookiFile {
  id: string;
  file?: {
    temporary_url: string;
    media_type: "IMAGE" | "VIDEO" | "AUDIO" | string;
    size?: number | null;
    duration_ms?: number | null;
  } | null;
  thumbnail?: {
    temporary_url: string;
    media_type: string;
    size?: number | null;
    duration_ms?: number | null;
  } | null;
  location?: string | null;
  created_at: string;
  tz: string;
}

export interface LookiMoment {
  id: string;
  title: string;
  description?: string;
  media_types: string[];
  cover_file?: LookiFile | null;
  date: string;
  tz: string;
  start_time: string;
  end_time: string;
}

export interface SanitizedLookiMoment {
  id: string;
  title: string;
  description?: string;
  mediaTypes: string[];
  date: string;
  tz: string;
  startTime: string;
  endTime: string;
  coverLocation?: string;
}

export type ProviderMode = "managed" | "user_key" | "subscription";

export interface UserProfile {
  uid: string;
  lookiBaseUrl: string;
  encryptedLookiApiKey: string;
  providerMode: ProviderMode;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile {
  uid: string;
  lookiBaseUrl: string;
  providerMode: ProviderMode;
  configured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppLedgerRecord {
  uid: string;
  record: ImportLedgerRecord;
  provider?: {
    asr?: ProviderAudit;
    memoryGate?: ProviderAudit;
  };
}

export interface ProviderAudit {
  provider: string;
  model?: string;
  requestId?: string;
  outputSha256?: string;
}

export interface MomentSelection {
  momentId: string;
  importMemory: boolean;
  importConversation: boolean;
}

export interface ImportRequest {
  uid: string;
  date: string;
  selections: MomentSelection[];
}

export interface ImportResultItem {
  momentId: string;
  target: "memory" | "conversation";
  status: "imported" | "skipped" | "failed";
  reason?: string;
  omiId?: string;
  candidate?: LookiMemoryCandidate;
  transcript?: NormalizedTranscript;
}

export interface ImportResult {
  items: ImportResultItem[];
}
