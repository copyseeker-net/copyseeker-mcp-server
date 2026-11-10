# Copyseeker MCP Server

Give Claude, Cursor, VS Code Copilot, Windsurf, OpenAI Codex, Gemini CLI and any other [MCP](https://modelcontextprotocol.io) client three image tools from [Copyseeker](https://copyseeker.net):

| Tool | What it does | Cost |
|---|---|---|
| `reverse_image_search` | Finds the web pages that show an image, ranked by prominence, with the copies each page uses | 1 search |
| `detect_ai_image` | Tells whether an image is AI-generated, with a confidence score | 0.01 searches |
| `detect_nsfw` | Tells whether an image contains nudity or sexual content, with a confidence score | 0.01 searches |

Each tool takes a direct image URL or the path to a local image file (up to 20 MB). Calls draw from the same search balance as the website, Monitor and the [Copyseeker API](https://copyseeker.net/apis).

## Requirements

- Node.js 20 or newer
- A paid Copyseeker plan and an API key: create one under **Account → Developers** at [copyseeker.net/account](https://copyseeker.net/account#api)

## Setup

### Claude Code

```bash
claude mcp add copyseeker -e COPYSEEKER_API_KEY=your_api_key -- npx -y copyseeker-mcp-server
```

### Claude Desktop

Add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "copyseeker": {
      "command": "npx",
      "args": ["-y", "copyseeker-mcp-server"],
      "env": {
        "COPYSEEKER_API_KEY": "your_api_key"
      }
    }
  }
}
```

### Cursor

Add the same `mcpServers` entry as for Claude Desktop to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).

### VS Code (GitHub Copilot)

Add this to `.vscode/mcp.json` in your project. VS Code asks for the key on first use and stores it securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "copyseeker-api-key",
      "description": "Copyseeker API key",
      "password": true
    }
  ],
  "servers": {
    "copyseeker": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "copyseeker-mcp-server"],
      "env": {
        "COPYSEEKER_API_KEY": "${input:copyseeker-api-key}"
      }
    }
  }
}
```

Then use the tools from Copilot Chat in agent mode.

### Windsurf

Add the same `mcpServers` entry as for Claude Desktop to `~/.codeium/windsurf/mcp_config.json`.

### OpenAI Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.copyseeker]
command = "npx"
args = ["-y", "copyseeker-mcp-server"]
env = { COPYSEEKER_API_KEY = "your_api_key" }
```

### Gemini CLI

Add the same `mcpServers` entry as for Claude Desktop to `~/.gemini/settings.json`.

### Other clients

Any MCP client that can launch a local (stdio) server works. Configure it to run `npx -y copyseeker-mcp-server` with the `COPYSEEKER_API_KEY` environment variable set.

ChatGPT connectors only accept remote MCP servers reached over HTTPS, so this local server does not work there.

## Examples

- "Where else on the web does https://example.com/photo.jpg appear? Who published it first?"
- "Is ~/Downloads/portrait.png AI-generated?"
- "Check these five product images for NSFW content before I upload them."

## Errors

Failures come back to the assistant as plain explanations it can act on: an invalid key, a missing plan, an empty balance (with the top-up link), the rate limit of 60 calls per minute (with how long to wait), or a URL that points to a web page instead of an image. A search that fails on Copyseeker's side is refunded.

## Upgrading from 1.x

Version 2 calls the Copyseeker API directly instead of RapidAPI:

- Replace `COPYSEEKER_RAPIDAPI_KEY` with `COPYSEEKER_API_KEY`, a key from your Copyseeker account.
- The tools are now `reverse_image_search`, `detect_ai_image` and `detect_nsfw`. `analyze_image_copyright`, `find_exact_matches` and `find_similar_images` are gone: `reverse_image_search` covers them.
- Node.js 20 or newer is required.

## Development

```bash
npm install
npm test        # builds, then runs the server against a fake Copyseeker API
```

`COPYSEEKER_API_URL` points the server at another API base URL (default `https://api.copyseeker.net`).

## License

MIT
