import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildMcpConfigFile } from './claude-mcp-cfg.js';

function freshTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('claude-mcp-cfg', () => {
  it('writes mcpServers: {} when project has no .mcp.json', () => {
    const tmpDir = freshTmp('d2p-mcp-test-');
    const projectRoot = freshTmp('d2p-proj-empty-');
    const r = buildMcpConfigFile({ runId: 'r1', projectRoot, tmpDir });
    const parsed = JSON.parse(fs.readFileSync(r.tempPath, 'utf8'));
    expect(parsed.mcpServers).toEqual({});
    expect(r.serverCount).toBe(0);
    r.cleanup();
    expect(fs.existsSync(r.tempPath)).toBe(false);
  });

  it('passes through project .mcp.json mcpServers entries', () => {
    const tmpDir = freshTmp('d2p-mcp-test-');
    const projectRoot = freshTmp('d2p-proj-');
    fs.writeFileSync(
      path.join(projectRoot, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          notion: { command: 'npx', args: ['notion-mcp'] },
          github: { command: 'gh-mcp' },
        },
      }),
      'utf8',
    );
    const r = buildMcpConfigFile({ runId: 'r2', projectRoot, tmpDir });
    const parsed = JSON.parse(fs.readFileSync(r.tempPath, 'utf8'));
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(['github', 'notion']);
    expect(parsed.mcpServers.notion.command).toBe('npx');
    expect(r.serverCount).toBe(2);
    r.cleanup();
  });

  it('handles malformed .mcp.json by emitting empty servers', () => {
    const tmpDir = freshTmp('d2p-mcp-test-');
    const projectRoot = freshTmp('d2p-proj-bad-');
    fs.writeFileSync(path.join(projectRoot, '.mcp.json'), '{ this is not json', 'utf8');
    const r = buildMcpConfigFile({ runId: 'r3', projectRoot, tmpDir });
    const parsed = JSON.parse(fs.readFileSync(r.tempPath, 'utf8'));
    expect(parsed.mcpServers).toEqual({});
    r.cleanup();
  });

  it('uses unique temp paths per runId', () => {
    const tmpDir = freshTmp('d2p-mcp-test-');
    const a = buildMcpConfigFile({ runId: 'A', tmpDir });
    const b = buildMcpConfigFile({ runId: 'B', tmpDir });
    expect(a.tempPath).not.toEqual(b.tempPath);
    expect(a.tempPath).toContain('A');
    expect(b.tempPath).toContain('B');
    a.cleanup();
    b.cleanup();
  });

  it('throws when runId missing', () => {
    // @ts-expect-error testing runtime validation
    expect(() => buildMcpConfigFile({})).toThrow(/runId/);
  });
});
