import type {
  LookiMemoryCandidate,
  NormalizedTranscript,
} from "@/src/contracts.js";
import { buildMemoryTags } from "@/src/memory";
import { getOmiIntegrationConfig } from "./config";
import { fetchWithTimeout, readTimeoutMs } from "./fetch-timeout";
import { joinUrl } from "./url";

interface IntegrationMemory {
  id: string;
  content: string;
  tags?: string[];
}

interface IntegrationMemoriesResponse {
  memories: IntegrationMemory[];
}

interface IntegrationConversation {
  id: string;
  started_at?: string;
  finished_at?: string;
  transcript_segments?: Array<{ text: string }>;
}

interface IntegrationConversationsResponse {
  conversations: IntegrationConversation[];
}

export class OmiIntegrationClient {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly apiKey: string;

  constructor() {
    const config = getOmiIntegrationConfig();
    this.baseUrl = config.baseUrl;
    this.appId = config.appId;
    this.apiKey = config.apiKey;
  }

  async createMemory(
    uid: string,
    candidate: LookiMemoryCandidate,
  ): Promise<string | undefined> {
    await this.post(
      `/v2/integrations/${encodeURIComponent(this.appId)}/user/memories`,
      uid,
      {
        text: candidate.contextSummary,
        text_source: "other",
        text_source_spec: "looki",
        memories: [
          {
            content: candidate.content,
            tags: buildMemoryTags(candidate),
          },
        ],
      },
    );

    const memories = await this.get<IntegrationMemoriesResponse>(
      `/v2/integrations/${encodeURIComponent(this.appId)}/memories`,
      uid,
      { limit: "1000", offset: "0" },
    );
    return memories.memories.find(
      (memory) => memory.content === candidate.content,
    )?.id;
  }

  async createConversation(
    uid: string,
    momentTitle: string,
    startedAt: string,
    finishedAt: string,
    transcript: NormalizedTranscript,
  ): Promise<string | undefined> {
    await this.post(
      `/v2/integrations/${encodeURIComponent(this.appId)}/user/conversations`,
      uid,
      {
        text: transcript.text,
        text_source: "audio_transcript",
        text_source_spec: `looki:${momentTitle}`,
        started_at: startedAt,
        finished_at: finishedAt,
        language: "zh",
      },
    );

    const response = await this.get<IntegrationConversationsResponse>(
      `/v2/integrations/${encodeURIComponent(this.appId)}/conversations`,
      uid,
      {
        start_date: startedAt,
        end_date: finishedAt,
        limit: "20",
        offset: "0",
        max_transcript_segments: "-1",
      },
    );
    const firstText =
      transcript.segments[0]?.text || transcript.text.slice(0, 32);
    return response.conversations.find((conversation) =>
      (conversation.transcript_segments || []).some((segment) =>
        segment.text.includes(firstText),
      ),
    )?.id;
  }

  private async post(path: string, uid: string, body: unknown): Promise<void> {
    const url = this.url(path, uid);
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      readTimeoutMs("OMI_API_TIMEOUT_MS", 30_000),
      "Omi integration write",
    );
    if (!response.ok) {
      throw new Error(
        `Omi integration request failed with HTTP ${response.status}`,
      );
    }
  }

  private async get<T>(
    path: string,
    uid: string,
    query: Record<string, string>,
  ): Promise<T> {
    const url = this.url(path, uid);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
      readTimeoutMs("OMI_API_TIMEOUT_MS", 30_000),
      "Omi integration read",
    );
    if (!response.ok) {
      throw new Error(
        `Omi integration read failed with HTTP ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }

  private url(path: string, uid: string): URL {
    const url = joinUrl(this.baseUrl, path);
    url.searchParams.set("uid", uid);
    return url;
  }
}
