import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";

export const API_KEY = "test-key";

export interface RecordedCall {
  method: string;
  path: string;
  imageUrl: string | null;
  apiKey: string | undefined;
  contentType: string | undefined;
  body: string;
}

// Stands in for api.copyseeker.net. Image URLs ending in a known name answer with that API error.
export class FakeCopyseekerApi {
  readonly calls: RecordedCall[] = [];
  private server: Server | null = null;

  async start(): Promise<string> {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = await readBody(req);
      const call: RecordedCall = {
        method: req.method ?? "",
        path: url.pathname,
        imageUrl: url.searchParams.get("imageUrl"),
        apiKey: req.headers["x-api-key"] as string | undefined,
        contentType: req.headers["content-type"],
        body,
      };
      this.calls.push(call);

      const [status, payload, headers] = answer(call);
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    });

    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

function answer(call: RecordedCall): [number, unknown, Record<string, string>?] {
  if (call.apiKey !== API_KEY) {
    return [401, { error: "INVALID_API_KEY" }];
  }

  const image = call.imageUrl ?? "";
  if (image.endsWith("/quota.jpg")) {
    return [403, { error: "QUOTA_EXHAUSTED" }];
  }
  if (image.endsWith("/rate.jpg")) {
    return [429, { error: "RATE_LIMITED" }, { "Retry-After": "7" }];
  }
  if (image.endsWith("/page.html")) {
    return [400, { error: "INVALID_IMAGE" }];
  }

  switch (call.path) {
    case "/reverse-image-search":
      return [200, { pages: Array.from({ length: 30 }, (_, i) => ({ url: `https://site${i}.example/post`, title: `Post ${i}`, rank: i + 1, matchingImages: [`https://site${i}.example/a.jpg`] })) }];

    case "/ai-detection":
      return [200, { isAiGenerated: true, confidence: 0.9731 }];

    case "/nsfw-detection":
      return [200, { isNsfw: false, confidence: 0.99 }];

    default:
      return [404, {}];
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("latin1");
}
