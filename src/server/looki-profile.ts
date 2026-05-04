import type { ProviderMode, PublicProfile, UserProfile } from "@/src/app-types";
import { decryptSecret, encryptSecret } from "./crypto";
import { HttpError } from "./errors";
import { LookiClient } from "./looki-client";
import { getStore } from "./store";

export interface SaveLookiProfileInput {
  uid: string;
  lookiBaseUrl: string;
  lookiApiKey?: string;
  providerMode?: ProviderMode;
}

export async function getPublicProfile(
  uid: string,
): Promise<PublicProfile | null> {
  const profile = await getStore().getProfile(uid);
  if (!profile) return null;
  return toPublicProfile(profile);
}

export async function saveLookiProfile(
  input: SaveLookiProfileInput,
): Promise<PublicProfile> {
  const uid = input.uid.trim();
  const lookiBaseUrl = input.lookiBaseUrl.trim();
  const providerMode = input.providerMode || "managed";

  if (!uid) throw new HttpError(400, "Omi uid is required");
  if (!lookiBaseUrl) throw new HttpError(400, "Looki base URL is required");
  if (!["managed", "user_key", "subscription"].includes(providerMode)) {
    throw new HttpError(400, "Invalid provider mode");
  }

  const store = getStore();
  const existing = await store.getProfile(uid);
  const apiKey =
    input.lookiApiKey?.trim() ||
    (existing ? decryptSecret(existing.encryptedLookiApiKey) : "");
  if (!apiKey) throw new HttpError(400, "Looki API key is required");

  await LookiClient.verifyBaseUrl(lookiBaseUrl);
  await new LookiClient(lookiBaseUrl, apiKey).getMe();

  const now = new Date().toISOString();
  const profile: UserProfile = {
    uid,
    lookiBaseUrl,
    encryptedLookiApiKey: encryptSecret(apiKey),
    providerMode,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await store.saveProfile(profile);
  return toPublicProfile(profile);
}

export async function getLookiClientForUid(
  uid: string,
): Promise<{ client: LookiClient; profile: UserProfile }> {
  if (!uid.trim()) throw new HttpError(400, "Omi uid is required");
  const profile = await getStore().getProfile(uid.trim());
  if (!profile)
    throw new HttpError(404, "Looki profile is not configured for this uid");
  return {
    client: new LookiClient(
      profile.lookiBaseUrl,
      decryptSecret(profile.encryptedLookiApiKey),
    ),
    profile,
  };
}

function toPublicProfile(profile: UserProfile): PublicProfile {
  return {
    uid: profile.uid,
    lookiBaseUrl: profile.lookiBaseUrl,
    providerMode: profile.providerMode,
    configured: true,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
