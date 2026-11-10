import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_API_URL = "https://api.copyseeker.net";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Reverse image search can take tens of seconds on images found on many pages.
const REQUEST_TIMEOUT_MS = 120_000;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

export type Endpoint = "reverse-image-search" | "ai-detection" | "nsfw-detection";

export interface ApiPage {
  url: string;
  title: string | null;
  rank: number;
  matchingImages: string[];
}

export interface ReverseImageSearchResponse {
  pages: ApiPage[];
}

export interface AiDetectionResponse {
  isAiGenerated: boolean;
  confidence: number;
}

export interface NsfwDetectionResponse {
  isNsfw: boolean;
  confidence: number;
}

// A failure the assistant can explain to the user and often fix (new key, top-up, other image).
export class CopyseekerError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "CopyseekerError";
  }
}

export class CopyseekerClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiUrl: string = DEFAULT_API_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(endpoint: Endpoint, image: string): Promise<T> {
    const source = image.trim();
    const headers: Record<string, string> = { "X-API-Key": this.apiKey, Accept: "application/json" };
    let response: Response;

    try {
      if (isHttpUrl(source)) {
        const url = `${this.apiUrl}/${endpoint}?imageUrl=${encodeURIComponent(source)}`;
        response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } else {
        const body = new FormData();
        const file = await readImageFile(source);
        body.append("file", new Blob([file.bytes], { type: file.mimeType }), file.name);
        response = await this.fetchImpl(`${this.apiUrl}/${endpoint}`, { method: "POST", headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      }
    } catch (error) {
      if (error instanceof CopyseekerError) {
        throw error;
      }

      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new CopyseekerError(`Copyseeker did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again in a moment.`, "TIMEOUT");
      }

      throw new CopyseekerError(`Could not reach Copyseeker (${error instanceof Error ? error.message : String(error)}). Check the internet connection.`, "NETWORK_ERROR");
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    throw await toError(response);
  }
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function readImageFile(source: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string; mimeType: string }> {
  const path = source.toLowerCase().startsWith("file://") ? fileURLToPath(source) : source;

  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new CopyseekerError(`"${source}" is not a file. Pass a direct image URL (http/https) or the path to a local image file.`, "INVALID_IMAGE");
    }
    size = info.size;
  } catch (error) {
    if (error instanceof CopyseekerError) {
      throw error;
    }
    throw new CopyseekerError(`"${source}" is neither an http(s) image URL nor a readable local file.`, "INVALID_IMAGE");
  }

  if (size === 0 || size > MAX_FILE_BYTES) {
    throw new CopyseekerError(`"${source}" is ${size === 0 ? "empty" : "larger than 20 MB"}. Copyseeker accepts images up to 20 MB.`, "INVALID_IMAGE");
  }

  const name = basename(path);
  return { bytes: new Uint8Array(await readFile(path)), name, mimeType: MIME_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream" };
}

async function toError(response: Response): Promise<CopyseekerError> {
  let code = "";
  try {
    code = ((await response.json()) as { error?: string })?.error ?? "";
  } catch {
    // Not JSON (a gateway error page); the status code still tells what happened.
  }

  switch (code) {
    case "INVALID_API_KEY":
      return new CopyseekerError("The Copyseeker API key is missing or invalid. Create one at https://copyseeker.net/account#api and set it as COPYSEEKER_API_KEY in the MCP server config.", code);

    case "PLAN_REQUIRED":
      return new CopyseekerError("API access needs a paid Copyseeker plan. See https://copyseeker.net/pricing.", code);

    case "QUOTA_EXHAUSTED":
      return new CopyseekerError("The Copyseeker account has no searches left for this call. Top up at https://copyseeker.net/account#searches or wait for the monthly reset.", code);

    case "RATE_LIMITED": {
      const retryAfter = response.headers.get("Retry-After");
      return new CopyseekerError(`Copyseeker's rate limit (60 calls per minute) was hit. Retry after ${retryAfter ?? "a few"} seconds.`, code);
    }

    case "INVALID_IMAGE":
      return new CopyseekerError("Copyseeker could not read an image there. Use a direct link to the image file itself (not a web page that shows it), or a local file path. Nothing was charged.", code);

    case "SEARCH_FAILED":
      return new CopyseekerError("The search failed on Copyseeker's side and its searches were refunded. Try again.", code);

    default:
      return new CopyseekerError(`Copyseeker answered HTTP ${response.status}${code ? ` (${code})` : ""}.`, code || `HTTP_${response.status}`);
  }
}
