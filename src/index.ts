#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CopyseekerClient, DEFAULT_API_URL } from "./client.js";
import { createServer } from "./server.js";

const apiKey = process.env.COPYSEEKER_API_KEY?.trim();

if (!apiKey) {
  // stdout carries the protocol, so everything for people goes to stderr.
  console.error("COPYSEEKER_API_KEY is not set. Create an API key at https://copyseeker.net/account#api and add it to this server's env in your MCP client config.");
  process.exit(1);
}

const client = new CopyseekerClient(apiKey, process.env.COPYSEEKER_API_URL?.trim() || DEFAULT_API_URL);

// One factory serves both clients that open with the 2025 initialize handshake and stateless 2026-07-28 clients.
serveStdio(() => createServer(client), {
  onerror: (error) => {
    console.error(`[copyseeker-mcp] ${error.message}`);
  },
});
