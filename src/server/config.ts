import type { ProviderMode } from "@/src/app-types";

export interface OmiIntegrationConfig {
  baseUrl: string;
  appId: string;
  apiKey: string;
}

export interface OmiOAuthConfig {
  appId: string;
  callbackUrl: string;
}

export interface ManagedProviderConfig {
  mode: ProviderMode;
  asrProvider: string;
  asrMaxAudioDurationMs?: number;
  asrMonthlyBillableLimitMs?: number;
  bailianApiKey?: string;
  bailianBaseUrl: string;
  bailianModel: string;
  bailianLanguageHints: string[];
  bailianDiarizationEnabled: boolean;
  xfyunBaseUrl: string;
  xfyunAppId?: string;
  xfyunApiKey?: string;
  xfyunApiSecret?: string;
  xfyunLanguage: string;
}

export function getOmiIntegrationConfig(): OmiIntegrationConfig {
  const appId = process.env.OMI_APP_ID;
  const apiKey = process.env.OMI_APP_API_KEY;
  if (!appId || !apiKey) {
    throw new Error(
      "OMI_APP_ID and OMI_APP_API_KEY are required for Omi integration writes",
    );
  }
  return {
    baseUrl: process.env.OMI_API_BASE_URL || "https://api.omi.me",
    appId,
    apiKey,
  };
}

export function getOmiOAuthConfig(): OmiOAuthConfig {
  const appId = process.env.OMI_APP_ID;
  if (!appId) {
    throw new Error("OMI_APP_ID is required for Omi OAuth");
  }
  return {
    appId,
    callbackUrl:
      process.env.OMI_OAUTH_CALLBACK_URL ||
      `${getBaseUrl().replace(/\/$/, "")}/api/oauth/callback`,
  };
}

export function getManagedProviderConfig(): ManagedProviderConfig {
  const mode = (process.env.AI_PROVIDER_MODE || "managed") as ProviderMode;
  const bailianApiKey =
    process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  return {
    mode,
    asrProvider: process.env.ASR_PROVIDER || "bailian",
    ...optionalMinutesToMs(
      "asrMaxAudioDurationMs",
      process.env.ASR_MAX_AUDIO_DURATION_MINUTES,
    ),
    ...optionalMinutesToMs(
      "asrMonthlyBillableLimitMs",
      process.env.ASR_MONTHLY_BILLABLE_LIMIT_MINUTES,
    ),
    ...(bailianApiKey ? { bailianApiKey } : {}),
    bailianBaseUrl:
      process.env.BAILIAN_BASE_URL || "https://dashscope.aliyuncs.com",
    bailianModel: process.env.BAILIAN_ASR_MODEL || "paraformer-v2",
    bailianLanguageHints: parseCsv(
      process.env.BAILIAN_LANGUAGE_HINTS || "zh,en",
    ),
    bailianDiarizationEnabled:
      process.env.BAILIAN_DIARIZATION_ENABLED === "true",
    xfyunBaseUrl:
      process.env.XFYUN_BASE_URL || "https://office-api-ist-dx.iflyaisol.com",
    ...(process.env.XFYUN_APP_ID
      ? { xfyunAppId: process.env.XFYUN_APP_ID }
      : {}),
    ...(process.env.XFYUN_API_KEY
      ? { xfyunApiKey: process.env.XFYUN_API_KEY }
      : {}),
    ...(process.env.XFYUN_API_SECRET
      ? { xfyunApiSecret: process.env.XFYUN_API_SECRET }
      : {}),
    xfyunLanguage: process.env.XFYUN_LANGUAGE || "autodialect",
  };
}

export function getBaseUrl(): string {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalMinutesToMs<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, number>> {
  if (!value?.trim()) return {};
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return {};
  return { [key]: Math.round(minutes * 60_000) } as Partial<Record<K, number>>;
}
