export interface RuntimeStatus {
  store: "supabase" | "file";
  omiConfigured: boolean;
  asrConfigured: boolean;
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
    asrConfigured: isAsrConfigured(),
    providerMode: process.env.AI_PROVIDER_MODE || "managed",
  };
}

function isAsrConfigured(): boolean {
  const provider = (process.env.ASR_PROVIDER || "bailian").toLowerCase();
  if (provider === "bailian" || provider === "dashscope") {
    return Boolean(
      process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
    );
  }
  if (provider === "xfyun") {
    return Boolean(
      process.env.XFYUN_APP_ID &&
      process.env.XFYUN_API_KEY &&
      process.env.XFYUN_API_SECRET,
    );
  }
  return false;
}
