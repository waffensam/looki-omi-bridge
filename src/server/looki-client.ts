import type {
  LookiFile,
  LookiMoment,
  SanitizedLookiMoment,
} from "@/src/app-types";
import { joinUrl } from "./url";

interface LookiResponse<T> {
  code: number;
  detail: string;
  data: T;
}

interface LookiFilesPage {
  items: LookiFile[];
  next_cursor_id: string | null;
  has_more: boolean;
}

export class LookiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  static async verifyBaseUrl(baseUrl: string): Promise<void> {
    if (process.env.LOOKI_SKIP_VERIFY === "true") return;
    const verifyUrl = new URL("https://open.looki.ai/api/v1/verify");
    verifyUrl.searchParams.set("endpoint", baseUrl);
    const response = await fetch(verifyUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(
        `Looki base_url verification failed with HTTP ${response.status}`,
      );
    }
  }

  async listMoments(date: string): Promise<LookiMoment[]> {
    const url = this.url("/moments");
    url.searchParams.set("on_date", date);
    const payload = await this.get<LookiMoment[]>(url);
    return payload.data;
  }

  async getMoment(momentId: string): Promise<LookiMoment> {
    const payload = await this.get<LookiMoment>(
      this.url(`/moments/${encodeURIComponent(momentId)}`),
    );
    return payload.data;
  }

  async getMe(): Promise<unknown> {
    const payload = await this.get<unknown>(this.url("/me"));
    return payload.data;
  }

  async listFiles(momentId: string): Promise<LookiFile[]> {
    const files: LookiFile[] = [];
    let cursor: string | null = null;
    do {
      const url = this.url(`/moments/${encodeURIComponent(momentId)}/files`);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor_id", cursor);
      const payload = await this.get<LookiFilesPage>(url);
      files.push(...payload.data.items);
      cursor = payload.data.has_more ? payload.data.next_cursor_id : null;
    } while (cursor);
    return files;
  }

  async downloadFile(temporaryUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(temporaryUrl);
    if (!response.ok) {
      throw new Error(
        `Looki media download failed with HTTP ${response.status}`,
      );
    }
    return response.arrayBuffer();
  }

  private async get<T>(url: URL): Promise<LookiResponse<T>> {
    const response = await fetch(url, {
      headers: {
        "X-API-Key": this.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Looki API request failed with HTTP ${response.status}`);
    }
    return (await response.json()) as LookiResponse<T>;
  }

  private url(path: string): URL {
    return joinUrl(this.baseUrl, path);
  }
}

export function sanitizeMoment(moment: LookiMoment): SanitizedLookiMoment {
  const sanitized: SanitizedLookiMoment = {
    id: moment.id,
    title: moment.title,
    mediaTypes: moment.media_types,
    date: moment.date,
    tz: moment.tz,
    startTime: moment.start_time,
    endTime: moment.end_time,
  };
  if (moment.description) sanitized.description = moment.description;
  if (moment.cover_file?.location)
    sanitized.coverLocation = moment.cover_file.location;
  return sanitized;
}

export function findAudioFile(files: LookiFile[]): LookiFile | null {
  return files.find((file) => file.file?.media_type === "AUDIO") || null;
}
