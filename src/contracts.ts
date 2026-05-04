export type IsoDateTime = string;
export type IsoDate = string;

export interface LookiTimelineEvent {
  id: string;
  title: string;
  description?: string;
  date: IsoDate;
  tz: string;
  startTime: IsoDateTime;
  endTime: IsoDateTime;
  mediaTypes: string[];
}

export interface LookiAudioMoment {
  id: string;
  title: string;
  description?: string;
  date: IsoDate;
  tz: string;
  startTime: IsoDateTime;
  endTime: IsoDateTime;
  mediaTypes: string[];
  audio: {
    temporaryUrl: string;
    mediaType: "AUDIO";
    size?: number;
    durationMs?: number;
  };
}

export type LookiMemorySourceKind =
  | "daily_timeline"
  | "audio"
  | "video"
  | "multimodal_cluster";

export interface LookiMemoryEvidence {
  kind: "visual" | "asr" | "ocr" | "timeline" | "user_review";
  summary: string;
  confidence?: number;
  sourceMomentId?: string;
}

export interface NormalizedTranscriptSegment {
  text: string;
  speaker: string;
  isUser: boolean;
  start: number;
  end: number;
}

export interface NormalizedTranscript {
  provider: string;
  providerOrderId?: string;
  text: string;
  segments: NormalizedTranscriptSegment[];
}

export interface OmiFromSegmentsPayload {
  source: "unknown";
  language: string;
  started_at: IsoDateTime;
  finished_at?: IsoDateTime;
  transcript_segments: Array<{
    text: string;
    speaker: string;
    is_user: boolean;
    start: number;
    end: number;
  }>;
}

export type ImportDecision = "import" | "skip" | "review";
export type ImportStatus =
  | "planned"
  | "skipped"
  | "transcribed"
  | "imported"
  | "failed";
export type ImportTarget = "conversation" | "memory";
export type MemoryWritePolicy = "auto_write" | "stage_only" | "never_write";
export type MemoryEvidenceDepth =
  | "moment_summary"
  | "targeted_media_required"
  | "targeted_media"
  | "user_review";

export interface OmiMemoryCreatePayload {
  content: string;
  visibility: "private" | "public";
  category?: "manual" | "system" | "interesting";
  tags: string[];
}

export interface OmiMemoryEnrichment {
  confidence?: number;
  source?: "looki";
  sourceApp?: "Looki";
  contextSummary?: string;
  currentActivity?: string;
  windowTitle?: string;
  headline?: string;
}

export interface LookiMemoryCandidate {
  idempotencyKey: string;
  content: string;
  eventDate: IsoDate;
  sourceKind: LookiMemorySourceKind;
  sourceMomentIds: string[];
  eventType: string;
  confidence: number;
  evidenceDepth: MemoryEvidenceDepth;
  writePolicy: MemoryWritePolicy;
  visibility: "private" | "public";
  tags: string[];
  headline?: string;
  contextSummary: string;
  currentActivity?: string;
  evidence: LookiMemoryEvidence[];
}

export interface ImportLedgerRecord {
  idempotencyKey: string;
  target: ImportTarget;
  status: ImportStatus;
  decision?: ImportDecision;
  looki: {
    momentId: string;
    title?: string;
    startTime: IsoDateTime;
    endTime: IsoDateTime;
    durationMs?: number;
    mediaTypes?: string[];
  };
  memory?: {
    content?: string;
    writePolicy?: MemoryWritePolicy;
    evidenceDepth?: MemoryEvidenceDepth;
    confidence?: number;
    eventDate?: IsoDate;
    eventType?: string;
    tags?: string[];
  };
  asr?: {
    provider: string;
    orderId?: string;
    transcriptSha256?: string;
  };
  omi?: {
    conversationId?: string;
    memoryId?: string;
    method?: "from_segments" | "text_fallback" | "memory_create";
    source?: "unknown" | "looki";
    richMetadataSynced?: boolean;
  };
  local?: {
    enriched?: boolean;
    sqliteCacheOnly?: boolean;
  };
  error?: {
    stage: "looki" | "asr" | "normalize" | "memory" | "omi" | "ledger";
    message: string;
    retryable: boolean;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
