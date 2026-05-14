import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';

export function PresetOverrideEditor() {
  const [open, setOpen] = useState(false);
  const [yamlText, setYamlText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const r = await api.currentPreset();
      const ov = r.overrides as { add?: unknown[]; remove?: unknown[]; skip?: unknown[] } | null;
      const seed = {
        add: ov?.add ?? [],
        remove: ov?.remove ?? [],
        skip: ov?.skip ?? [],
      };
      setYamlText(serialize(seed));
    } catch {
      setYamlText(serialize({ add: [], remove: [], skip: [] }));
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function onSave() {
    setError(null);
    setSaved(false);
    let parsed: unknown;
    try {
      parsed = parseOverrideYaml(yamlText);
    } catch (e) {
      setError(`yaml 解析失败：${(e as Error).message}`);
      return;
    }
    setBusy(true);
    try {
      await api.savePresetOverride(parsed);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        自定义 preset（增/删/跳过）
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg p-4 bg-paper border border-warmline">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Preset 覆盖（yaml）</span>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink text-sm">
          收起
        </button>
      </div>
      <div className="text-xs text-muted leading-relaxed">
        Schema: <code className="bg-cream px-1 rounded">add: [{`{slug, category, description, severity}`}]</code>,{' '}
        <code className="bg-cream px-1 rounded">remove: [...slug]</code>,{' '}
        <code className="bg-cream px-1 rounded">skip: [...slug]</code>
      </div>
      <textarea
        value={yamlText}
        onChange={(e) => setYamlText(e.target.value)}
        rows={10}
        className="input input-mono text-xs"
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {saved && <div className="text-forest text-sm">✓ 已保存。下次 differ 自动应用。</div>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void load()} disabled={busy}>重置</Button>
        <Button onClick={() => void onSave()} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </div>
    </div>
  );
}

function serialize(o: { add: unknown[]; remove: unknown[]; skip: unknown[] }): string {
  const lines: string[] = [];
  lines.push('add:');
  if (o.add.length === 0) lines.push('  []');
  for (const a of o.add as Array<{ slug?: string; category?: string; description?: string; severity?: string }>) {
    lines.push(`  - slug: ${a.slug ?? ''}`);
    lines.push(`    category: ${a.category ?? ''}`);
    lines.push(`    description: ${JSON.stringify(a.description ?? '')}`);
    lines.push(`    severity: ${a.severity ?? 'P2'}`);
  }
  lines.push('remove:');
  if (o.remove.length === 0) lines.push('  []');
  for (const s of o.remove) lines.push(`  - ${String(s)}`);
  lines.push('skip:');
  if (o.skip.length === 0) lines.push('  []');
  for (const s of o.skip) lines.push(`  - ${String(s)}`);
  return lines.join('\n') + '\n';
}

function parseOverrideYaml(text: string): unknown {
  const out: { add: unknown[]; remove: string[]; skip: string[] } = { add: [], remove: [], skip: [] };
  const lines = text.split(/\r?\n/);
  let section: 'add' | 'remove' | 'skip' | null = null;
  let cur: Record<string, unknown> | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^add:\s*$/.test(line)) { section = 'add'; cur = null; continue; }
    if (/^remove:\s*$/.test(line)) { section = 'remove'; cur = null; continue; }
    if (/^skip:\s*$/.test(line)) { section = 'skip'; cur = null; continue; }
    if (/^\s*\[\]\s*$/.test(line)) continue;
    const itemMatch = /^\s+-\s+(.*)$/.exec(line);
    if (itemMatch && section === 'remove') {
      out.remove.push(itemMatch[1]!.trim());
      continue;
    }
    if (itemMatch && section === 'skip') {
      out.skip.push(itemMatch[1]!.trim());
      continue;
    }
    if (itemMatch && section === 'add') {
      const kv = /^([a-z_]+):\s*(.*)$/.exec(itemMatch[1]!.trim());
      cur = {};
      if (kv) cur[kv[1]!] = stripQuotes(kv[2]!);
      out.add.push(cur);
      continue;
    }
    const subMatch = /^\s+([a-z_]+):\s*(.*)$/.exec(line);
    if (subMatch && cur && section === 'add') {
      cur[subMatch[1]!] = stripQuotes(subMatch[2]!);
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}
