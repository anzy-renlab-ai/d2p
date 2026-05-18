import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Per-spawn `--mcp-config <file>` builder for Claude Code.
//
// d2p does not ship its own MCP server (cf. Cairn's cairn-wedge). The reason
// this file exists at all: cc requires `--mcp-config` paired with
// `--strict-mcp-config` so a malformed project-local `.mcp.json` can't
// silently strand a stream-json spawn. We pass through whatever
// `<projectRoot>/.mcp.json` declares (the user's notion / github / etc
// servers) and write a temp file that cc resolves deterministically.
//
// If the project has no .mcp.json, we still emit `{"mcpServers": {}}` —
// strict mode is still satisfied and cc spawns clean.

export interface BuildMcpConfigInput {
  runId: string;
  /** Project root to look for `.mcp.json` in. */
  projectRoot?: string;
  /** Override os.tmpdir() — used by tests. */
  tmpDir?: string;
}

export interface BuildMcpConfigResult {
  tempPath: string;
  serverCount: number;
  cleanup: () => void;
}

function readProjectMcpServers(projectRoot: string): Record<string, unknown> {
  const p = path.join(projectRoot, '.mcp.json');
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'mcpServers' in parsed &&
      typeof (parsed as { mcpServers: unknown }).mcpServers === 'object' &&
      (parsed as { mcpServers: unknown }).mcpServers !== null
    ) {
      return (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
    }
  } catch {
    /* malformed JSON — fall through to empty */
  }
  return {};
}

export function buildMcpConfigFile(input: BuildMcpConfigInput): BuildMcpConfigResult {
  if (!input.runId) throw new Error('runId required');
  const tmpDir = input.tmpDir ?? os.tmpdir();
  const tempPath = path.join(tmpDir, `d2p-mcp-${input.runId}.json`);

  const servers = input.projectRoot ? readProjectMcpServers(input.projectRoot) : {};
  const config = { mcpServers: servers };

  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* already gone */
    }
  };

  return { tempPath, serverCount: Object.keys(servers).length, cleanup };
}
