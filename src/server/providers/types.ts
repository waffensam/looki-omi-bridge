import type {
  LookiMoment,
  ProviderAudit,
  SanitizedLookiForYouHint,
} from "@/src/app-types";
import type {
  ImportStage,
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
    forYouHints?: SanitizedLookiForYouHint[],
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
    onProgress?: (
      stage: ImportStage,
      message: string,
      attempt?: number,
    ) => Promise<void> | void;
  }): Promise<AsrResult>;
}
