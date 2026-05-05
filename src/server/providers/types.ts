import type { ProviderAudit } from "@/src/app-types";
import type { ImportStage, NormalizedTranscript } from "@/src/contracts.js";

export interface AsrResult {
  transcript: NormalizedTranscript;
  audit: ProviderAudit;
}

export interface AsrProvider {
  inputMode: "audio" | "url";
  transcribeAudio(input: {
    audio?: ArrayBuffer;
    audioUrl?: string;
    fileName: string;
    durationMs?: number;
    onProgress?: (
      stage: ImportStage,
      message: string,
      attempt?: number,
    ) => Promise<void> | void;
  }): Promise<AsrResult>;
}
