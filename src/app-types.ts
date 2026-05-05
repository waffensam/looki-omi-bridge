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

export interface LookiInlineFile {
  temporary_url: string;
  media_type: "IMAGE" | "VIDEO" | "AUDIO" | string;
  size?: number | null;
  duration_ms?: number | null;
}

export interface LookiForYouItem {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  content?: string | null;
  cover?: LookiInlineFile | null;
  file?: LookiInlineFile | null;
  created_at: string;
  recorded_at: string;
}

export interface SanitizedLookiForYouItem {
  id: string;
  type: string;
  title: string;
  description?: string;
  content?: string;
  createdAt: string;
  recordedAt: string;
  mediaTypes: string[];
}

export interface SanitizedLookiForYouHint extends SanitizedLookiForYouItem {
  score: number;
  matchReason: "time" | "text" | "time_text";
  role: "audio_context" | "memory_evidence" | "day_context";
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
  forYouHints?: SanitizedLookiForYouHint[];
  forYouScore?: number;
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
  sourceType?: "moment" | "for_you";
  sourceId?: string;
  momentId?: string;
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
  status: "queued" | "processing" | "imported" | "skipped" | "failed";
  reason?: string;
  omiId?: string;
  candidate?: LookiMemoryCandidate;
  transcript?: NormalizedTranscript;
}

export interface ImportResult {
  items: ImportResultItem[];
}
