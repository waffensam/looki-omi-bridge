import { createHmac, randomUUID } from "crypto";

import type {
  NormalizedTranscript,
  NormalizedTranscriptSegment,
} from "@/src/contracts.js";
import { getManagedProviderConfig } from "../config";
import { sha256 } from "../hash";
import { joinUrl } from "../url";
import type { AsrProvider, AsrResult } from "./types";

export class XfyunAsrProvider implements AsrProvider {
  async transcribeAudio(input: {
    audio: ArrayBuffer;
    fileName: string;
    durationMs?: number;
  }): Promise<AsrResult> {
    const config = getManagedProviderConfig();
    if (!config.xfyunAppId || !config.xfyunApiKey || !config.xfyunApiSecret) {
      throw new Error(
        "XFYUN_APP_ID, XFYUN_API_KEY, and XFYUN_API_SECRET are required for audio conversation imports",
      );
    }

    const uploadParams: Record<string, string | number> = {
      appId: config.xfyunAppId,
      accessKeyId: config.xfyunApiKey,
      dateTime: timestamp(),
      signatureRandom: randomUUID(),
      fileSize: input.audio.byteLength,
      fileName: input.fileName,
      duration: input.durationMs || 0,
      language: config.xfyunLanguage,
    };
    const uploadUrl = signedUrl(
      config.xfyunBaseUrl,
      "/v2/upload",
      uploadParams,
      config.xfyunApiSecret,
    );
    const form = new FormData();
    form.append("file", new Blob([input.audio]), input.fileName);
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: form,
    });
    if (!uploadResponse.ok) {
      throw new Error(`XFYun upload failed with HTTP ${uploadResponse.status}`);
    }
    const uploadPayload = (await uploadResponse.json()) as {
      content?: { orderId?: string };
      orderId?: string;
    };
    const orderId = uploadPayload.content?.orderId || uploadPayload.orderId;
    if (!orderId) {
      throw new Error("XFYun upload response did not include orderId");
    }

    const resultPayload = await this.pollResult(
      config.xfyunBaseUrl,
      config.xfyunApiKey,
      config.xfyunApiSecret,
      orderId,
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
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const params: Record<string, string> = {
        accessKeyId: apiKey,
        dateTime: timestamp(),
        signatureRandom: randomUUID(),
        orderId,
        resultType: "transfer",
      };
      const url = signedUrl(baseUrl, "/v2/getResult", params, apiSecret);
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        throw new Error(`XFYun getResult failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        content?: { orderInfo?: { status?: number } };
      };
      if (payload.content?.orderInfo?.status === 4) return payload;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("XFYun transcription did not complete in time");
  }
}

function signedUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number>,
  secret: string,
): URL {
  const url = joinUrl(baseUrl, path);
  const signature = signParams(params, secret);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("signature", signature);
  return url;
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
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(
    now.getUTCMinutes(),
  )}${pad(now.getUTCSeconds())}`;
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
