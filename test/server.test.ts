import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { API_KEY, FakeCopyseekerApi } from "./fakeApi.js";

const SERVER = join(import.meta.dirname, "..", "build", "index.js");

interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

describe("copyseeker MCP server", () => {
  const api = new FakeCopyseekerApi();
  let apiUrl = "";
  let client: Client;
  let imagePath = "";

  async function connect(apiKey: string): Promise<Client> {
    const connected = new Client({ name: "test", version: "0.0.0" });
    await connected.connect(new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...getDefaultEnvironment(), COPYSEEKER_API_KEY: apiKey, COPYSEEKER_API_URL: apiUrl },
    }));
    return connected;
  }

  async function call(name: string, args: Record<string, unknown>, using: Client = client): Promise<ToolResult> {
    return (await using.callTool({ name, arguments: args })) as unknown as ToolResult;
  }

  function textOf(result: ToolResult): string {
    return result.content.map((c) => c.text ?? "").join("\n");
  }

  before(async () => {
    apiUrl = await api.start();
    client = await connect(API_KEY);
    imagePath = join(await mkdtemp(join(tmpdir(), "copyseeker-mcp-")), "photo.png");
    await writeFile(imagePath, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
  });

  after(async () => {
    await client.close();
    await api.stop();
  });

  it("lists the three tools in a stable order", async () => {
    const { tools } = await client.listTools();

    assert.deepEqual(tools.map((t) => t.name), ["reverse_image_search", "detect_ai_image", "detect_nsfw"]);
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true && t.outputSchema));
  });

  it("searches an image URL with the API key and trims to max_results", async () => {
    const result = await call("reverse_image_search", { image: "https://img.example/cat.jpg", max_results: 5 });

    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent?.totalPages, 30);
    assert.equal((result.structuredContent?.pages as unknown[]).length, 5);
    const sent = api.calls.at(-1)!;
    assert.equal(sent.method, "GET");
    assert.equal(sent.path, "/reverse-image-search");
    assert.equal(sent.imageUrl, "https://img.example/cat.jpg");
    assert.equal(sent.apiKey, API_KEY);
  });

  it("uploads a local file as multipart", async () => {
    const result = await call("detect_ai_image", { image: imagePath });

    assert.deepEqual(result.structuredContent, { isAiGenerated: true, confidence: 0.9731 });
    const sent = api.calls.at(-1)!;
    assert.equal(sent.method, "POST");
    assert.equal(sent.path, "/ai-detection");
    assert.match(sent.contentType ?? "", /^multipart\/form-data/);
    assert.match(sent.body, /filename="photo.png"/);
  });

  it("returns NSFW results", async () => {
    const nsfw = await call("detect_nsfw", { image: "https://img.example/beach.jpg" });

    assert.deepEqual(nsfw.structuredContent, { isNsfw: false, confidence: 0.99 });
  });

  it("explains an empty balance so the assistant can tell the user to top up", async () => {
    const result = await call("reverse_image_search", { image: "https://img.example/quota.jpg" });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /no credits left.*account#searches/);
  });

  it("passes on how long to wait when rate limited", async () => {
    const result = await call("detect_nsfw", { image: "https://img.example/rate.jpg" });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /Retry after 7 seconds/);
  });

  it("tells the assistant a web page is not an image", async () => {
    const result = await call("reverse_image_search", { image: "https://site.example/page.html" });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /direct link to the image file/);
  });

  it("refuses a path that is neither a URL nor a file without calling the API", async () => {
    const before = api.calls.length;

    const result = await call("detect_ai_image", { image: "/no/such/image.jpg" });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /neither an http\(s\) image URL nor a readable local file/);
    assert.equal(api.calls.length, before);
  });

  it("points to the account page when the key is wrong", async () => {
    const wrongKey = await connect("wrong-key");
    try {
      const result = await call("detect_ai_image", { image: "https://img.example/cat.jpg" }, wrongKey);

      assert.equal(result.isError, true);
      assert.match(textOf(result), /missing or invalid.*account#api/);
    } finally {
      await wrongKey.close();
    }
  });

  it("still serves clients that open with the 2025 initialize handshake", async () => {
    const lines = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "detect_nsfw", arguments: { image: "https://img.example/beach.jpg" } } },
    ];

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [SERVER], { env: { ...process.env, COPYSEEKER_API_KEY: API_KEY, COPYSEEKER_API_URL: apiUrl } });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes('"id":2')) {
          child.stdin.end();
        }
      });
      child.on("error", reject);
      child.on("close", () => resolve(stdout));
      child.stdin.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    });

    const responses = output.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(responses[0].result.protocolVersion, "2025-06-18");
    assert.deepEqual(responses[1].result.structuredContent, { isNsfw: false, confidence: 0.99 });
  });
});
