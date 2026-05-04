import type { LookiMoment, ProviderAudit } from "@/src/app-types";
import type {
  LookiMemoryCandidate,
  NormalizedTranscript,
} from "@/src/contracts.js";

export interface MemoryGateResult {
  candidate: LookiMemoryCandidate;
  audit: ProviderAudit;
}

export interface MemoryGateProvider {
  buildCandidate(
    moment: LookiMoment,
    existingMemoryContents: string[],
  ): Promise<MemoryGateResult>;
}

export interface AsrResult {
  transcript: NormalizedTranscript;
  audit: ProviderAudit;
}

export interface AsrProvider {
  transcribeAudio(input: {
    audio: ArrayBuffer;
    fileName: string;
    durationMs?: number;
  }): Promise<AsrResult>;
}
