import { getManagedProviderConfig } from "../config";
import { BailianAsrProvider } from "./bailian-asr";
import type { AsrProvider } from "./types";
import { XfyunAsrProvider } from "./xfyun-asr";

export function createAsrProvider(): AsrProvider {
  const provider = getManagedProviderConfig().asrProvider.toLowerCase();
  if (provider === "bailian" || provider === "dashscope") {
    return new BailianAsrProvider();
  }
  if (provider === "xfyun") {
    return new XfyunAsrProvider();
  }
  throw new Error(`Unsupported ASR_PROVIDER: ${provider}`);
}
