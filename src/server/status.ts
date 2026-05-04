export interface RuntimeStatus {
  store: "supabase" | "file";
  omiConfigured: boolean;
  asrConfigured: boolean;
  llmConfigured: boolean;
  providerMode: string;
}

export function getRuntimeStatus(): RuntimeStatus {
  const hasSupabase = Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  return {
    store: hasSupabase ? "supabase" : "file",
    omiConfigured: Boolean(
      process.env.OMI_APP_ID && process.env.OMI_APP_API_KEY,
    ),
    asrConfigured: Boolean(
      process.env.XFYUN_APP_ID &&
      process.env.XFYUN_API_KEY &&
      process.env.XFYUN_API_SECRET,
    ),
    llmConfigured: Boolean(process.env.MANAGED_OPENAI_API_KEY),
    providerMode: process.env.AI_PROVIDER_MODE || "managed",
  };
}
