import type {
  ImportStage,
  NormalizedTranscript,
  NormalizedTranscriptSegment,
} from "@/src/contracts.js";
import { getManagedProviderConfig } from "../config";
import { fetchWithTimeout, readTimeoutMs } from "../fetch-timeout";
import { sha256 } from "../hash";
import { joinUrl } from "../url";
import type { AsrProvider, AsrResult } from "./types";

interface BailianProgress {
  (stage: ImportStage, message: string, attempt?: number): Promise<void> | void;
}

interface BailianTaskResult {
  file_url?: string;
  transcription_url?: string;
  subtask_status?: string;
  code?: string;
  message?: string;
}

interface BailianTaskResponse {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    results?: BailianTaskResult[];
  };
  usage?: {
    duration?: number;
  };
  code?: string;
  message?: string;
}

export class BailianAsrProvider implements AsrProvider {
  readonly inputMode = "url" as const;

  async transcribeAudio(input: {
    audio?: ArrayBuffer;
    audioUrl?: string;
    fileName: string;
    durationMs?: number;
    onProgress?: BailianProgress;
  }): Promise<AsrResult> {
    const config = getManagedProviderConfig();
    if (!config.bailianApiKey) {
      throw new Error(
        "BAILIAN_API_KEY or DASHSCOPE_API_KEY is required for Bailian ASR",
      );
    }
    if (!input.audioUrl) {
      throw new Error("Bailian ASR requires an audio URL");
    }

    const taskId = await this.submitTask(
      config.bailianBaseUrl,
      config.bailianApiKey,
      config.bailianModel,
      input.audioUrl,
      config.bailianLanguageHints,
      config.bailianDiarizationEnabled,
      input.onProgress,
    );
    const taskPayload = await this.pollTask(
      config.bailianBaseUrl,
      config.bailianApiKey,
      taskId,
      input.onProgress,
    );
    const transcriptionUrl = findSucceededTranscriptionUrl(taskPayload);
    const resultPayload = await this.fetchTranscriptionResult(transcriptionUrl);
    const transcript = normalizeBailianTranscriptionResult(
      resultPayload,
      taskId,
    );

    return {
      transcript,
      audit: {
        provider: "bailian",
        model: config.bailianModel,
        requestId: taskId,
        outputSha256: sha256(
          JSON.stringify({
            task: taskPayload.output?.task_id,
            usage: taskPayload.usage,
            result: resultPayload,
          }),
        ),
      },
    };
  }

  private async submitTask(
    baseUrl: string,
    apiKey: string,
    model: string,
    audioUrl: string,
    languageHints: string[],
    diarizationEnabled: boolean,
    onProgress?: BailianProgress,
  ): Promise<string> {
    await onProgress?.("asr_upload", "提交音频到百炼 Paraformer");
    const response = await fetchWithTimeout(
      joinUrl(baseUrl, "/api/v1/services/audio/asr/transcription"),
      {
        method: "POST",
        headers: bailianHeaders(apiKey),
        body: JSON.stringify({
          model,
          input: { file_urls: [audioUrl] },
          parameters: {
            channel_id: [0],
            ...(languageHints.length > 0
              ? { language_hints: languageHints }
              : {}),
            ...(diarizationEnabled ? { diarization_enabled: true } : {}),
          },
        }),
      },
      readTimeoutMs("BAILIAN_SUBMIT_TIMEOUT_MS", 30_000),
      "Bailian ASR submit",
    );
    const payload = await parseBailianResponse(response, "submit");
    const taskId = payload.output?.task_id;
    if (!taskId) {
      throw new Error("Bailian ASR submit response did not include task_id");
    }
    return taskId;
  }

  private async pollTask(
    baseUrl: string,
    apiKey: string,
    taskId: string,
    onProgress?: BailianProgress,
  ): Promise<BailianTaskResponse> {
    const startedAt = Date.now();
    const pollTimeoutMs = readTimeoutMs("BAILIAN_POLL_TIMEOUT_MS", 900_000);
    const intervalMs = readTimeoutMs("BAILIAN_POLL_INTERVAL_MS", 3_000);
    let attempt = 0;
    while (Date.now() - startedAt < pollTimeoutMs) {
      attempt += 1;
      await onProgress?.("asr_poll", "等待百炼转写结果", attempt);
      const response = await fetchWithTimeout(
        joinUrl(baseUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`),
        {
          method: "POST",
          headers: bailianHeaders(apiKey),
        },
        readTimeoutMs("BAILIAN_QUERY_TIMEOUT_MS", 30_000),
        "Bailian ASR query",
      );
      const payload = await parseBailianResponse(response, "query");
      const status = payload.output?.task_status;
      if (status === "SUCCEEDED") return payload;
      if (status && status !== "PENDING" && status !== "RUNNING") {
        throw new Error(`Bailian ASR task failed with status ${status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Bailian ASR transcription did not complete within ${pollTimeoutMs}ms`,
    );
  }

  private async fetchTranscriptionResult(url: string): Promise<unknown> {
    const response = await fetchWithTimeout(
      url,
      {},
      readTimeoutMs("BAILIAN_RESULT_TIMEOUT_MS", 60_000),
      "Bailian ASR result",
    );
    if (!response.ok) {
      throw new Error(
        `Bailian ASR result download failed with HTTP ${response.status}`,
      );
    }
    return response.json();
  }
}

export function normalizeBailianTranscriptionResult(
  payload: unknown,
  taskId: string,
): NormalizedTranscript {
  const raw = payload as {
    properties?: {
      original_duration?: number;
      original_duration_in_milliseconds?: number;
    };
    transcripts?: Array<{
      text?: string;
      content_duration?: number;
      content_duration_in_milliseconds?: number;
      sentences?: Array<{
        begin_time?: number;
        end_time?: number;
        text?: string;
        speaker_id?: number | string;
      }>;
    }>;
  };
  const segments: NormalizedTranscriptSegment[] = [];

  for (const transcript of raw.transcripts || []) {
    for (const sentence of transcript.sentences || []) {
      const text = (sentence.text || "").trim();
      const beginMs = Number(sentence.begin_time || 0);
      const endMs = Number(sentence.end_time || 0);
      if (!text || endMs <= beginMs) continue;
      const speakerId =
        Number.parseInt(String(sentence.speaker_id ?? "0"), 10) || 0;
      segments.push({
        text,
        speaker: `SPEAKER_${String(speakerId).padStart(2, "0")}`,
        isUser: speakerId === 0,
        start: beginMs / 1000,
        end: endMs / 1000,
      });
    }
  }

  if (segments.length === 0) {
    for (const transcript of raw.transcripts || []) {
      const text = (transcript.text || "").trim();
      const durationMs =
        raw.properties?.original_duration_in_milliseconds ??
        raw.properties?.original_duration ??
        0;
      if (!text || durationMs <= 0) continue;
      segments.push({
        text,
        speaker: "SPEAKER_00",
        isUser: true,
        start: 0,
        end: durationMs / 1000,
      });
    }
  }

  const originalDurationMs =
    raw.properties?.original_duration_in_milliseconds ??
    raw.properties?.original_duration;
  const billableSpeechMs = sumBailianContentDuration(raw.transcripts || []);

  return {
    provider: "bailian",
    providerOrderId: taskId,
    ...(typeof originalDurationMs === "number" ? { originalDurationMs } : {}),
    ...(typeof billableSpeechMs === "number" ? { billableSpeechMs } : {}),
    text:
      segments.map((segment) => segment.text).join("") ||
      (raw.transcripts || [])
        .map((transcript) => transcript.text || "")
        .join("")
        .trim(),
    segments,
  };
}

function sumBailianContentDuration(
  transcripts: Array<{
    content_duration?: number;
    content_duration_in_milliseconds?: number;
  }>,
): number | undefined {
  let total = 0;
  let found = false;
  for (const transcript of transcripts) {
    const duration =
      transcript.content_duration_in_milliseconds ??
      transcript.content_duration;
    if (typeof duration !== "number") continue;
    total += duration;
    found = true;
  }
  return found ? total : undefined;
}

function bailianHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-DashScope-Async": "enable",
  };
}

async function parseBailianResponse(
  response: Response,
  stage: "submit" | "query",
): Promise<BailianTaskResponse> {
  const payload = (await response
    .json()
    .catch(() => ({}))) as BailianTaskResponse;
  if (!response.ok) {
    throw new Error(
      `Bailian ASR ${stage} failed with HTTP ${response.status}${safeBailianDetail(payload)}`,
    );
  }
  if (payload.code) {
    throw new Error(
      `Bailian ASR ${stage} failed: code=${payload.code}${payload.message ? `, message=${sanitizeMessage(payload.message)}` : ""}`,
    );
  }
  return payload;
}

function findSucceededTranscriptionUrl(payload: BailianTaskResponse): string {
  const result = (payload.output?.results || []).find(
    (item) => item.subtask_status === "SUCCEEDED" && item.transcription_url,
  );
  if (!result?.transcription_url) {
    const failed = (payload.output?.results || []).find(
      (item) => item.subtask_status === "FAILED",
    );
    throw new Error(
      `Bailian ASR did not return a succeeded transcription_url${failed?.code ? `: code=${failed.code}` : ""}${failed?.message ? `, message=${sanitizeMessage(failed.message)}` : ""}`,
    );
  }
  return result.transcription_url;
}

function safeBailianDetail(payload: BailianTaskResponse): string {
  const parts = [
    payload.code ? `code=${payload.code}` : "",
    payload.message ? `message=${sanitizeMessage(payload.message)}` : "",
  ].filter(Boolean);
  return parts.length ? `: ${parts.join(", ")}` : "";
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>()]+/g, "[redacted-url]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/x-looki-token=[^"&\s]+/g, "x-looki-token=[redacted]")
    .slice(0, 600)
    .trim();
}
