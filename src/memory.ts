import type {
  LookiMemoryCandidate,
  MemoryEvidenceDepth,
  MemoryWritePolicy,
  OmiMemoryCreatePayload,
  OmiMemoryEnrichment,
} from "./contracts.js";

const ISO_DATE_PREFIX = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[，,\s:：-]+/;
const VALID_EVIDENCE_DEPTHS: MemoryEvidenceDepth[] = [
  "moment_summary",
  "for_you_enriched_summary",
  "targeted_media_required",
  "targeted_media",
  "user_review",
];

export function lookiDateTag(eventDate: string): string {
  return `looki_${eventDate.replaceAll("-", "_")}`;
}

export function buildMemoryTags(
  candidate: Pick<LookiMemoryCandidate, "eventDate" | "eventType" | "tags">,
): string[] {
  return uniqueStrings([
    "looki",
    "looki_daily",
    lookiDateTag(candidate.eventDate),
    candidate.eventType,
    ...candidate.tags,
  ]);
}

export function contentLooksDatePrefixed(content: string): boolean {
  return ISO_DATE_PREFIX.test(content.trim());
}

export function validateMemoryCandidate(
  candidate: LookiMemoryCandidate,
): string[] {
  const errors: string[] = [];

  if (!candidate.content.trim()) {
    errors.push("content is required");
  }
  if (contentLooksDatePrefixed(candidate.content)) {
    errors.push(
      "content must not start with the event date; store date in tags and ledger metadata",
    );
  }
  if (candidate.confidence < 0 || candidate.confidence > 1) {
    errors.push("confidence must be between 0 and 1");
  }
  if (candidate.writePolicy === "auto_write" && candidate.confidence < 0.85) {
    errors.push("auto_write requires confidence >= 0.85");
  }
  if (!VALID_EVIDENCE_DEPTHS.includes(candidate.evidenceDepth)) {
    errors.push("evidenceDepth is invalid");
  }
  if (
    candidate.writePolicy === "auto_write" &&
    candidate.evidenceDepth === "targeted_media_required"
  ) {
    errors.push("auto_write cannot use targeted_media_required evidence");
  }
  if (!candidate.sourceMomentIds.length) {
    errors.push("at least one sourceMomentId is required");
  }
  if (!candidate.contextSummary.trim()) {
    errors.push("contextSummary is required for review and local enrichment");
  }

  return errors;
}

export function buildOmiMemoryCreatePayload(
  candidate: LookiMemoryCandidate,
): OmiMemoryCreatePayload {
  const errors = validateMemoryCandidate(candidate);
  if (errors.length > 0) {
    throw new Error(`Invalid memory candidate: ${errors.join("; ")}`);
  }

  return {
    content: candidate.content.trim(),
    visibility: candidate.visibility,
    category: "manual",
    tags: buildMemoryTags(candidate),
  };
}

export function buildOmiMemoryEnrichment(
  candidate: LookiMemoryCandidate,
): OmiMemoryEnrichment {
  return {
    confidence: candidate.confidence,
    source: "looki",
    sourceApp: "Looki",
    contextSummary: candidate.contextSummary,
    ...(candidate.currentActivity
      ? { currentActivity: candidate.currentActivity }
      : {}),
    windowTitle: `Looki ${candidate.eventDate} daily timeline`,
    ...(candidate.headline ? { headline: candidate.headline } : {}),
  };
}

export function shouldWriteMemory(policy: MemoryWritePolicy): boolean {
  return policy === "auto_write";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
