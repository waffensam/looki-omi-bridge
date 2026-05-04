import type { LookiMoment } from "@/src/app-types";
import type { LookiMemoryCandidate } from "@/src/contracts.js";
import { validateMemoryCandidate } from "@/src/memory";
import { getManagedProviderConfig } from "../config";
import { sha256 } from "../hash";
import { memoryIdempotencyKey } from "../idempotency";
import type { MemoryGateProvider, MemoryGateResult } from "./types";

export class ManagedMemoryGateProvider implements MemoryGateProvider {
  async buildCandidate(
    moment: LookiMoment,
    existingMemoryContents: string[],
  ): Promise<MemoryGateResult> {
    const config = getManagedProviderConfig();
    if (!config.openaiApiKey) {
      const candidate = buildHeuristicCandidate(moment);
      return {
        candidate,
        audit: {
          provider: "rules_fallback",
          model: "moment-summary-v1",
          outputSha256: sha256(JSON.stringify(candidate)),
        },
      };
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.llmModel,
        instructions:
          "You convert Looki moment metadata into Omi memory candidates. Only create durable, reusable memories. Keep dates and provenance out of content. Return strict JSON.",
        input: JSON.stringify({
          moment: {
            id: moment.id,
            title: moment.title,
            description: moment.description || "",
            date: moment.date,
            start_time: moment.start_time,
            end_time: moment.end_time,
            media_types: moment.media_types,
          },
          existingMemoryContents,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "looki_memory_candidate_core",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "content",
                "eventType",
                "confidence",
                "writePolicy",
                "evidenceDepth",
                "tags",
                "headline",
                "contextSummary",
              ],
              properties: {
                content: { type: "string" },
                eventType: { type: "string" },
                confidence: { type: "number" },
                writePolicy: {
                  enum: ["auto_write", "stage_only", "never_write"],
                },
                evidenceDepth: {
                  enum: [
                    "moment_summary",
                    "targeted_media_required",
                    "targeted_media",
                    "user_review",
                  ],
                },
                tags: { type: "array", items: { type: "string" } },
                headline: { type: "string" },
                contextSummary: { type: "string" },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Managed LLM memory gate failed with HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      id?: string;
      output_text?: string;
      output?: unknown[];
    };
    const rawText = extractOutputText(payload);
    const core = JSON.parse(rawText) as Omit<
      LookiMemoryCandidate,
      | "idempotencyKey"
      | "eventDate"
      | "sourceKind"
      | "sourceMomentIds"
      | "visibility"
      | "currentActivity"
      | "evidence"
    >;
    const candidate: LookiMemoryCandidate = {
      ...core,
      idempotencyKey: memoryIdempotencyKey(
        moment.date,
        core.eventType,
        moment.id,
      ),
      eventDate: moment.date,
      sourceKind: moment.media_types.includes("VIDEO")
        ? "multimodal_cluster"
        : "daily_timeline",
      sourceMomentIds: [moment.id],
      visibility: "private",
      evidence: [
        {
          kind: "timeline",
          summary: `${moment.title}${moment.description ? `: ${moment.description}` : ""}`,
          confidence: core.confidence,
          sourceMomentId: moment.id,
        },
      ],
    };
    const errors = validateMemoryCandidate(candidate);
    if (errors.length > 0) {
      throw new Error(
        `Managed LLM returned invalid memory candidate: ${errors.join("; ")}`,
      );
    }

    return {
      candidate,
      audit: {
        provider: "openai",
        model: config.llmModel,
        ...(payload.id ? { requestId: payload.id } : {}),
        outputSha256: sha256(rawText),
      },
    };
  }
}

function buildHeuristicCandidate(moment: LookiMoment): LookiMemoryCandidate {
  const description = moment.description?.trim();
  const content = description || moment.title;
  const eventType = inferEventType(`${moment.title} ${description || ""}`);
  const candidate: LookiMemoryCandidate = {
    idempotencyKey: memoryIdempotencyKey(moment.date, eventType, moment.id),
    content,
    eventDate: moment.date,
    sourceKind: moment.media_types.includes("VIDEO")
      ? "multimodal_cluster"
      : "daily_timeline",
    sourceMomentIds: [moment.id],
    eventType,
    confidence: 0.86,
    evidenceDepth: "moment_summary",
    writePolicy: "auto_write",
    visibility: "private",
    tags: [eventType],
    headline: moment.title.slice(0, 40),
    contextSummary: `${moment.title}${description ? `: ${description}` : ""}`,
    evidence: [
      {
        kind: "timeline",
        summary: `${moment.title}${description ? `: ${description}` : ""}`,
        confidence: 0.86,
        sourceMomentId: moment.id,
      },
    ],
  };
  const errors = validateMemoryCandidate(candidate);
  if (errors.length > 0) {
    return {
      ...candidate,
      writePolicy: "stage_only",
      confidence: 0.7,
      evidenceDepth: "targeted_media_required",
    };
  }
  return candidate;
}

function inferEventType(text: string): string {
  if (/孩子|亲子|家人|家庭|自行车|学校/.test(text)) return "family_milestone";
  if (/会议|客户|工作|项目|方案/.test(text)) return "work_decision";
  if (/买|购买|下单|维修|调试/.test(text)) return "important_purchase";
  if (/医院|体检|医生|健康/.test(text)) return "health_event";
  return "looki_moment";
}

function extractOutputText(payload: {
  output_text?: string;
  output?: unknown[];
}): string {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const maybeText = (contentItem as { text?: unknown }).text;
      if (typeof maybeText === "string") return maybeText;
    }
  }
  throw new Error("Managed LLM response did not contain output text");
}
