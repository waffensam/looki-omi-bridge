import { createHmac, randomBytes } from "crypto";

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

interface XfyunProgress {
  (stage: ImportStage, message: string, attempt?: number): Promise<void> | void;
}

export class XfyunAsrProvider implements AsrProvider {
  readonly inputMode = "audio" as const;

  async transcribeAudio(input: {
    audio?: ArrayBuffer;
    audioUrl?: string;
    fileName: string;
    durationMs?: number;
    onProgress?: XfyunProgress;
  }): Promise<AsrResult> {
    if (!input.audio) {
      throw new Error("XFYun ASR requires downloaded audio bytes");
    }
    const config = getManagedProviderConfig();
    if (!config.xfyunAppId || !config.xfyunApiKey || !config.xfyunApiSecret) {
      throw new Error(
        "XFYUN_APP_ID, XFYUN_API_KEY, and XFYUN_API_SECRET are required for audio conversation imports",
      );
    }

    const signatureRandom = nonce();
    const uploadParams: Record<string, string | number> = {
      appId: config.xfyunAppId,
      accessKeyId: config.xfyunApiKey,
      dateTime: timestamp(),
      signatureRandom,
      fileSize: input.audio.byteLength,
      fileName: input.fileName,
      duration: input.durationMs || 0,
      language: config.xfyunLanguage,
    };
    const uploadRequest = buildXfyunSignedRequest(
      config.xfyunBaseUrl,
      "/v2/upload",
      uploadParams,
      config.xfyunApiSecret,
    );
    await input.onProgress?.("asr_upload", "上传音频到讯飞");
    const uploadResponse = await fetchWithTimeout(
      uploadRequest.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          signature: uploadRequest.signature,
        },
        body: input.audio,
      },
      readTimeoutMs("XFYUN_UPLOAD_TIMEOUT_MS", 120_000),
      "XFYun upload",
    );
    if (!uploadResponse.ok) {
      throw new Error(`XFYun upload failed with HTTP ${uploadResponse.status}`);
    }
    const uploadPayload = (await uploadResponse.json()) as {
      code?: string;
      descInfo?: string;
      content?: { orderId?: string };
      orderId?: string;
    };
    assertXfyunSuccess(uploadPayload, "upload");
    const orderId = uploadPayload.content?.orderId || uploadPayload.orderId;
    if (!orderId) {
      throw new Error("XFYun upload response did not include orderId");
    }

    const resultPayload = await this.pollResult(
      config.xfyunBaseUrl,
      config.xfyunApiKey,
      config.xfyunApiSecret,
      orderId,
      signatureRandom,
      input.onProgress,
    );
    const transcript = normalizeXfyunResult(resultPayload, orderId);
    return {
      transcript,
      audit: {
        provider: "xfyun",
        model: "recording-file-asr-large",
        requestId: orderId,
        outputSha256: sha256(JSON.stringify(resultPayload)),
      },
    };
  }

  private async pollResult(
    baseUrl: string,
    apiKey: string,
    apiSecret: string,
    orderId: string,
    signatureRandom: string,
    onProgress?: XfyunProgress,
  ): Promise<unknown> {
    const startedAt = Date.now();
    const pollTimeoutMs = readTimeoutMs("XFYUN_POLL_TIMEOUT_MS", 900_000);
    const intervalMs = readTimeoutMs("XFYUN_POLL_INTERVAL_MS", 3_000);
    let attempt = 0;
    while (Date.now() - startedAt < pollTimeoutMs) {
      attempt += 1;
      await onProgress?.("asr_poll", "等待讯飞转写结果", attempt);
      const params: Record<string, string> = {
        accessKeyId: apiKey,
        dateTime: timestamp(),
        signatureRandom,
        orderId,
        resultType: "transfer",
      };
      const resultRequest = buildXfyunSignedRequest(
        baseUrl,
        "/v2/getResult",
        params,
        apiSecret,
      );
      const response = await fetchWithTimeout(
        resultRequest.url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            signature: resultRequest.signature,
          },
          body: "{}",
        },
        readTimeoutMs("XFYUN_RESULT_TIMEOUT_MS", 20_000),
        "XFYun getResult",
      );
      if (!response.ok) {
        throw new Error(`XFYun getResult failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        code?: string;
        descInfo?: string;
        content?: { orderInfo?: { status?: number } };
      };
      assertXfyunSuccess(payload, "getResult");
      if (payload.content?.orderInfo?.status === 4) return payload;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `XFYun transcription did not complete within ${pollTimeoutMs}ms`,
    );
  }
}

export function buildXfyunSignedRequest(
  baseUrl: string,
  path: string,
  params: Record<string, string | number>,
  secret: string,
): { url: URL; signature: string } {
  const url = joinUrl(baseUrl, path);
  const signature = signParams(params, secret);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return { url, signature };
}

function signParams(
  params: Record<string, string | number>,
  secret: string,
): string {
  const base = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
  return createHmac("sha1", secret).update(base).digest("base64");
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(
    now.getUTCMinutes(),
  )}:${pad(now.getUTCSeconds())}+0000`;
}

function nonce(): string {
  return randomBytes(8).toString("hex");
}

function assertXfyunSuccess(
  payload: { code?: string; descInfo?: string },
  stage: "upload" | "getResult",
): void {
  if (!payload.code || payload.code === "000000") return;
  throw new Error(
    `XFYun ${stage} failed: code=${payload.code}${payload.descInfo ? `, descInfo=${payload.descInfo}` : ""}`,
  );
}

function normalizeXfyunResult(
  payload: unknown,
  orderId: string,
): NormalizedTranscript {
  const raw = payload as { content?: { orderResult?: string | object } };
  const orderResult = raw.content?.orderResult;
  const parsed =
    typeof orderResult === "string" ? JSON.parse(orderResult) : orderResult;
  const lattice =
    (parsed as { lattice?: unknown[] } | undefined)?.lattice || [];
  const segments: NormalizedTranscriptSegment[] = [];

  for (const item of lattice) {
    const best = (item as { json_1best?: string | object }).json_1best;
    if (!best) continue;
    const jsonBest = typeof best === "string" ? JSON.parse(best) : best;
    const st = (
      jsonBest as {
        st?: { bg?: string; ed?: string; rl?: string; rt?: unknown[] };
      }
    ).st;
    if (!st) continue;
    const text = extractWords(st.rt || []);
    if (!text.trim()) continue;
    const speakerId = Number.parseInt(st.rl || "0", 10) || 0;
    segments.push({
      text,
      speaker: `SPEAKER_${String(speakerId).padStart(2, "0")}`,
      isUser: speakerId === 0,
      start: Number(st.bg || 0) / 1000,
      end: Number(st.ed || 0) / 1000,
    });
  }

  const text = segments.map((segment) => segment.text).join("");
  return {
    provider: "xfyun",
    providerOrderId: orderId,
    text,
    segments,
  };
}

function extractWords(rt: unknown[]): string {
  const words: string[] = [];
  for (const rtItem of rt) {
    const ws = (rtItem as { ws?: unknown[] }).ws || [];
    for (const wsItem of ws) {
      const cw = (wsItem as { cw?: unknown[] }).cw || [];
      for (const cwItem of cw) {
        const word = (cwItem as { w?: string }).w;
        if (word) words.push(word);
      }
    }
  }
  return words.join("");
}
