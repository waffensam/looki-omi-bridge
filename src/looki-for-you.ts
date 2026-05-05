import type {
  LookiForYouItem,
  SanitizedLookiForYouHint,
  SanitizedLookiForYouItem,
  SanitizedLookiMoment,
} from "./app-types";

const FOR_YOU_TEXT_LIMIT = 1_800;
const TIME_MATCH_WINDOW_MS = 15 * 60_000;
const TEXT_MATCH_THRESHOLD = 0.36;
const STOP_CHARS = new Set(
  "的一是在了和与及或但这那你我他她它们个有就都也很还会到把被从中为上下午今天今日然后一个一些可能可以".split(
    "",
  ),
);

export function sanitizeForYouItem(
  item: LookiForYouItem,
): SanitizedLookiForYouItem {
  const description = sanitizeForYouText(item.description || "", 500);
  const content = sanitizeForYouText(item.content || "", FOR_YOU_TEXT_LIMIT);
  return {
    id: item.id,
    type: item.type,
    title: sanitizeInlineText(item.title, 120) || "For You",
    ...(description ? { description } : {}),
    ...(content ? { content } : {}),
    createdAt: item.created_at,
    recordedAt: item.recorded_at,
    mediaTypes: uniqueStrings([
      item.cover?.media_type || "",
      item.file?.media_type || "",
    ]),
  };
}

export function sanitizeForYouText(value: string, maxLength: number): string {
  const text = value
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, " ")
    .replace(/[`*_>#|~]+/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

export function attachForYouHints(
  moment: SanitizedLookiMoment,
  forYouItems: SanitizedLookiForYouItem[],
): SanitizedLookiMoment {
  const hints = matchForYouItemsToMoment(moment, forYouItems);
  if (hints.length === 0) return moment;
  return {
    ...moment,
    forYouHints: hints,
    forYouScore: hints[0]?.score || 0,
  };
}

export function attachForYouHintsToMoments(
  moments: SanitizedLookiMoment[],
  forYouItems: SanitizedLookiForYouItem[],
): SanitizedLookiMoment[] {
  const candidates = moments.flatMap((moment, momentIndex) =>
    forYouItems
      .map((item) => buildForYouHint(moment, item))
      .filter(isHint)
      .map((hint) => ({ hint, momentIndex })),
  );
  const bestByItem = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const current = bestByItem.get(candidate.hint.id);
    if (!current || compareCandidate(candidate, current) < 0) {
      bestByItem.set(candidate.hint.id, candidate);
    }
  }

  const hintsByMoment = new Map<number, SanitizedLookiForYouHint[]>();
  for (const candidate of bestByItem.values()) {
    const hints = hintsByMoment.get(candidate.momentIndex) || [];
    hints.push(candidate.hint);
    hintsByMoment.set(candidate.momentIndex, hints);
  }

  return moments.map((moment, momentIndex) => {
    const hints = (hintsByMoment.get(momentIndex) || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (hints.length === 0) return moment;
    return {
      ...moment,
      forYouHints: hints,
      forYouScore: hints[0]?.score || 0,
    };
  });
}

export function matchForYouItemsToMoment(
  moment: SanitizedLookiMoment,
  forYouItems: SanitizedLookiForYouItem[],
  limit = 3,
): SanitizedLookiForYouHint[] {
  return forYouItems
    .map((item) => buildForYouHint(moment, item))
    .filter(isHint)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function scoreTimeMatch(
  moment: SanitizedLookiMoment,
  item: SanitizedLookiForYouItem,
): number {
  if (item.type !== "MOMENT_POST") return 0;
  const recordedAt = Date.parse(item.recordedAt);
  const start = Date.parse(moment.startTime);
  const end = Date.parse(moment.endTime);
  if ([recordedAt, start, end].some(Number.isNaN)) return 0;
  const distance =
    recordedAt < start
      ? start - recordedAt
      : recordedAt > end
        ? recordedAt - end
        : 0;
  if (distance <= TIME_MATCH_WINDOW_MS) return 0.72;
  return 0;
}

function scoreTextMatch(
  moment: SanitizedLookiMoment,
  item: SanitizedLookiForYouItem,
): number {
  const momentText = normalizeText(
    `${moment.title} ${moment.description || ""}`,
  );
  const itemText = normalizeText(
    `${item.title} ${item.description || ""} ${item.content || ""}`,
  );
  if (!momentText || !itemText) return 0;
  let score = 0;
  if (
    moment.title.length >= 4 &&
    itemText.includes(normalizeText(moment.title))
  ) {
    score += 0.42;
  }
  if (
    item.title.length >= 4 &&
    momentText.includes(normalizeText(item.title))
  ) {
    score += 0.28;
  }
  const titleOverlap = Math.max(
    ngramOverlap(normalizeText(item.title), momentText, 2),
    ngramOverlap(normalizeText(item.title), momentText, 3),
  );
  if (titleOverlap >= 0.3) {
    score += titleOverlap * 0.42;
  }
  const bodyOverlap = Math.max(
    ngramOverlap(momentText, itemText, 2),
    ngramOverlap(momentText, itemText, 3),
  );
  score += bodyOverlap * 0.5;
  const overlap = characterOverlap(momentText, itemText);
  score += overlap * 0.25;
  return Math.min(score, 0.7);
}

function buildForYouHint(
  moment: SanitizedLookiMoment,
  item: SanitizedLookiForYouItem,
): SanitizedLookiForYouHint | null {
  const timeScore = scoreTimeMatch(moment, item);
  const textScore = scoreTextMatch(moment, item);
  if (!shouldAttachHint(item)) return null;
  const timeMatched = timeScore > 0;
  const textMatched = textScore >= TEXT_MATCH_THRESHOLD;
  if (!timeMatched && !textMatched) return null;
  const score = Math.min(
    1,
    (timeMatched ? timeScore : 0) + (textMatched ? textScore : 0),
  );
  return {
    ...item,
    score,
    matchReason:
      timeMatched && textMatched ? "time_text" : timeMatched ? "time" : "text",
    role: roleForMatch(moment, item),
  };
}

function shouldAttachHint(item: SanitizedLookiForYouItem): boolean {
  if (item.type === "DAILY_VLOG" || item.type === "USER_EVENT_ANALYSIS") {
    return false;
  }
  return true;
}

function roleForMatch(
  moment: SanitizedLookiMoment,
  item: SanitizedLookiForYouItem,
): SanitizedLookiForYouHint["role"] {
  if (moment.mediaTypes.includes("AUDIO")) return "audio_context";
  if (item.type === "DAILY_VLOG" || item.type === "USER_EVENT_ANALYSIS") {
    return "day_context";
  }
  return "memory_evidence";
}

function compareCandidate(
  left: { hint: SanitizedLookiForYouHint; momentIndex: number },
  right: { hint: SanitizedLookiForYouHint; momentIndex: number },
): number {
  if (left.hint.score !== right.hint.score) {
    return right.hint.score - left.hint.score;
  }
  if (left.hint.matchReason !== right.hint.matchReason) {
    return (
      matchReasonRank(right.hint.matchReason) -
      matchReasonRank(left.hint.matchReason)
    );
  }
  return left.momentIndex - right.momentIndex;
}

function matchReasonRank(
  reason: SanitizedLookiForYouHint["matchReason"],
): number {
  if (reason === "time_text") return 3;
  if (reason === "time") return 2;
  return 1;
}

function sanitizeInlineText(value: string, maxLength: number): string {
  return sanitizeForYouText(value, maxLength);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function characterOverlap(left: string, right: string): number {
  const leftChars = significantChars(left);
  const rightChars = significantChars(right);
  const denominator = Math.min(leftChars.size, rightChars.size);
  if (denominator < 4) return 0;
  let shared = 0;
  for (const char of leftChars) {
    if (rightChars.has(char)) shared += 1;
  }
  return shared / denominator;
}

function ngramOverlap(left: string, right: string, size: number): number {
  const leftNgrams = significantNgrams(left, size);
  const rightNgrams = significantNgrams(right, size);
  const denominator = Math.min(leftNgrams.size, rightNgrams.size);
  if (denominator < 2) return 0;
  let shared = 0;
  for (const ngram of leftNgrams) {
    if (rightNgrams.has(ngram)) shared += 1;
  }
  return shared / denominator;
}

function significantNgrams(value: string, size: number): Set<string> {
  const chars = [...value];
  const ngrams = new Set<string>();
  for (let index = 0; index <= chars.length - size; index += 1) {
    const ngram = chars.slice(index, index + size).join("");
    if ([...ngram].some((char) => STOP_CHARS.has(char))) continue;
    ngrams.add(ngram);
  }
  return ngrams;
}

function significantChars(value: string): Set<string> {
  return new Set(
    [...value].filter(
      (char) => !STOP_CHARS.has(char) && /\p{L}|\p{N}/u.test(char),
    ),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isHint(
  value: SanitizedLookiForYouHint | null,
): value is SanitizedLookiForYouHint {
  return value !== null;
}
