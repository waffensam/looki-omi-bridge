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
  llmProvider: string;
  llmModel: string;
  openaiApiKey?: string;
  asrProvider: string;
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
    llmProvider: process.env.LLM_PROVIDER || "managed",
    llmModel: process.env.LLM_MODEL || "gpt-4.1-mini",
    ...(process.env.MANAGED_OPENAI_API_KEY
      ? { openaiApiKey: process.env.MANAGED_OPENAI_API_KEY }
      : {}),
    asrProvider: process.env.ASR_PROVIDER || "bailian",
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
