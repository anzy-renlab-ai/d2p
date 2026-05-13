import { useEffect, useState } from 'react';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { useStore } from '../store.js';

type EngineKind = 'claude-cli' | 'openai-compat' | 'anthropic-api';

interface ModelMap { haiku: string; sonnet: string; opus: string }
interface FormState {
  engineKind: EngineKind;
  cliBin: string;
  openaiBaseUrl: string;
  openaiKey: string;
  openaiModels: ModelMap;
  openaiExtraHeaders: string; // JSON text
  anthBaseUrl: string;
  anthKey: string;
  anthModels: ModelMap;
  githubToken: string;
  githubBaseBranch: string;
}

const DEFAULTS: FormState = {
  engineKind: 'claude-cli',
  cliBin: '',
  openaiBaseUrl: 'https://openrouter.ai/api/v1',
  openaiKey: '',
  openaiModels: {
    haiku: 'anthropic/claude-3-5-haiku',
    sonnet: 'anthropic/claude-sonnet-4-5',
    opus: 'anthropic/claude-opus-4-1',
  },
  openaiExtraHeaders: '',
  anthBaseUrl: 'https://api.anthropic.com',
  anthKey: '',
  anthModels: {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-7',
  },
  githubToken: '',
  githubBaseBranch: 'main',
};

const PRESETS: { label: string; baseUrl: string; models: ModelMap; extraHeaders?: string }[] = [
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: {
      haiku: 'anthropic/claude-3-5-haiku',
      sonnet: 'anthropic/claude-sonnet-4-5',
      opus: 'anthropic/claude-opus-4-1',
    },
    extraHeaders: '{"HTTP-Referer":"https://d2p.local","X-Title":"d2p"}',
  },
  {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: {
      haiku: 'deepseek-chat',
      sonnet: 'deepseek-chat',
      opus: 'deepseek-reasoner',
    },
  },
  {
    label: 'Z.ai (智谱 GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: { haiku: 'glm-4.5-flash', sonnet: 'glm-4.5', opus: 'glm-4.5-air' },
  },
  {
    label: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: { haiku: 'kimi-k2-turbo', sonnet: 'kimi-k2', opus: 'kimi-k2-thinking' },
  },
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'gpt-4.1' },
  },
  {
    label: 'Qwen (DashScope OpenAI-compat)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { haiku: 'qwen-turbo', sonnet: 'qwen-plus', opus: 'qwen-max' },
  },
];

export function Settings({ onClose }: { onClose?: () => void }) {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const refreshAll = useStore((s) => s.refreshAll);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config').then((r) => r.json() as Promise<{
          config: {
            engine: Record<string, unknown> & { kind: EngineKind };
            github?: { baseBranch: string };
          };
        }>);
        if (cancelled) return;
        const cfg = res.config;
        setForm((f) => {
          const next = { ...f, engineKind: cfg.engine.kind };
          if (cfg.engine.kind === 'openai-compat') {
            const e = cfg.engine as unknown as { baseUrl: string; models: ModelMap; extraHeaders?: Record<string, string> };
            next.openaiBaseUrl = e.baseUrl;
            next.openaiModels = e.models;
            next.openaiExtraHeaders = e.extraHeaders ? JSON.stringify(e.extraHeaders) : '';
          } else if (cfg.engine.kind === 'anthropic-api') {
            const e = cfg.engine as unknown as { baseUrl?: string; models: ModelMap };
            next.anthBaseUrl = e.baseUrl ?? DEFAULTS.anthBaseUrl;
            next.anthModels = e.models;
          } else {
            const e = cfg.engine as unknown as { bin?: string };
            next.cliBin = e.bin ?? '';
          }
          if (cfg.github) next.githubBaseBranch = cfg.github.baseBranch;
          return next;
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function applyPreset(p: (typeof PRESETS)[number]) {
    setForm((f) => ({
      ...f,
      engineKind: 'openai-compat',
      openaiBaseUrl: p.baseUrl,
      openaiModels: p.models,
      openaiExtraHeaders: p.extraHeaders ?? '',
    }));
  }

  async function onSave() {
    setError(null);
    setSaved(false);
    let engine: Record<string, unknown>;
    if (form.engineKind === 'claude-cli') {
      engine = { kind: 'claude-cli' };
      if (form.cliBin.trim()) (engine as { bin: string }).bin = form.cliBin.trim();
    } else if (form.engineKind === 'openai-compat') {
      if (!form.openaiKey) {
        setError('API key 不能为空');
        return;
      }
      let extra: Record<string, string> | undefined;
      if (form.openaiExtraHeaders.trim()) {
        try {
          extra = JSON.parse(form.openaiExtraHeaders);
        } catch {
          setError('extraHeaders 不是合法 JSON');
          return;
        }
      }
      engine = {
        kind: 'openai-compat',
        baseUrl: form.openaiBaseUrl,
        apiKey: form.openaiKey,
        models: form.openaiModels,
        ...(extra ? { extraHeaders: extra } : {}),
      };
    } else {
      if (!form.anthKey) {
        setError('API key 不能为空');
        return;
      }
      engine = {
        kind: 'anthropic-api',
        baseUrl: form.anthBaseUrl,
        apiKey: form.anthKey,
        models: form.anthModels,
      };
    }
    const body: Record<string, unknown> = { engine };
    if (form.githubToken.trim()) {
      body.github = { token: form.githubToken.trim(), baseBranch: form.githubBaseBranch.trim() || 'main' };
    }
    setBusy(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setSaved(true);
      // clear plain-text key fields so the form doesn't keep them in memory
      setForm((f) => ({ ...f, openaiKey: '', anthKey: '', githubToken: '' }));
      void refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-6 text-slate-500">加载中…</div>;

  return (
    <div className="max-w-2xl mx-auto py-8 px-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">设置</h1>
        {onClose && (
          <Button variant="ghost" onClick={onClose}>返回</Button>
        )}
      </header>

      <section className="bg-white rounded border">
        <div className="px-4 py-3 border-b bg-slate-50 font-medium">LLM 引擎</div>
        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            {(['claude-cli', 'openai-compat', 'anthropic-api'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="engineKind"
                  checked={form.engineKind === k}
                  onChange={() => setForm((f) => ({ ...f, engineKind: k }))}
                />
                <span>{k}</span>
              </label>
            ))}
          </div>

          {form.engineKind === 'claude-cli' && (
            <div>
              <label className="block text-sm mb-1">claude binary 路径（留空走 PATH）</label>
              <input
                type="text"
                value={form.cliBin}
                onChange={(e) => setForm((f) => ({ ...f, cliBin: e.target.value }))}
                className="w-full px-2 py-1 border rounded text-sm font-mono"
                placeholder="claude"
              />
              <div className="text-xs text-slate-500 mt-1">
                用你 `claude login` 过的本地 Claude Code，免费走订阅额度。
              </div>
            </div>
          )}

          {form.engineKind === 'openai-compat' && (
            <>
              <div>
                <div className="text-sm mb-1">快速预设</div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => applyPreset(p)}
                      className="text-xs px-2 py-1 border rounded hover:bg-slate-100"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="baseUrl" value={form.openaiBaseUrl} mono
                onChange={(v) => setForm((f) => ({ ...f, openaiBaseUrl: v }))} />
              <Field label="API key" value={form.openaiKey} secret mono
                onChange={(v) => setForm((f) => ({ ...f, openaiKey: v }))} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="haiku model" value={form.openaiModels.haiku} mono
                  onChange={(v) => setForm((f) => ({ ...f, openaiModels: { ...f.openaiModels, haiku: v } }))} />
                <Field label="sonnet model" value={form.openaiModels.sonnet} mono
                  onChange={(v) => setForm((f) => ({ ...f, openaiModels: { ...f.openaiModels, sonnet: v } }))} />
                <Field label="opus model" value={form.openaiModels.opus} mono
                  onChange={(v) => setForm((f) => ({ ...f, openaiModels: { ...f.openaiModels, opus: v } }))} />
              </div>
              <Field label="extraHeaders (JSON, optional)" value={form.openaiExtraHeaders} mono
                onChange={(v) => setForm((f) => ({ ...f, openaiExtraHeaders: v }))} />
            </>
          )}

          {form.engineKind === 'anthropic-api' && (
            <>
              <Field label="baseUrl" value={form.anthBaseUrl} mono
                onChange={(v) => setForm((f) => ({ ...f, anthBaseUrl: v }))} />
              <Field label="API key" value={form.anthKey} secret mono
                onChange={(v) => setForm((f) => ({ ...f, anthKey: v }))} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="haiku" value={form.anthModels.haiku} mono
                  onChange={(v) => setForm((f) => ({ ...f, anthModels: { ...f.anthModels, haiku: v } }))} />
                <Field label="sonnet" value={form.anthModels.sonnet} mono
                  onChange={(v) => setForm((f) => ({ ...f, anthModels: { ...f.anthModels, sonnet: v } }))} />
                <Field label="opus" value={form.anthModels.opus} mono
                  onChange={(v) => setForm((f) => ({ ...f, anthModels: { ...f.anthModels, opus: v } }))} />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="bg-white rounded border">
        <div className="px-4 py-3 border-b bg-slate-50 font-medium">GitHub PR 模式（可选）</div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-500">
            填了 token 后，新建 session 时可以选 GitHub PR 模式：fix 分支自动 push 到 origin、自动开 PR、不自动 merge。
          </div>
          <Field label="GitHub PAT (repo scope)" value={form.githubToken} secret mono
            onChange={(v) => setForm((f) => ({ ...f, githubToken: v }))} />
          <Field label="默认 base branch" value={form.githubBaseBranch} mono
            onChange={(v) => setForm((f) => ({ ...f, githubBaseBranch: v }))} />
        </div>
      </section>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {saved && <div className="text-green-700 text-sm">✓ 保存成功，下次 agent 调用立刻生效。</div>}

      <div className="flex justify-end">
        <Button onClick={() => void onSave()} disabled={busy}>
          {busy ? '保存中…' : '保存设置'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, secret, mono,
}: {
  label: string; value: string; onChange: (v: string) => void; secret?: boolean; mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm mb-1 text-slate-700">{label}</label>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-2 py-1 border rounded text-sm ${mono ? 'font-mono' : ''}`}
        spellCheck={false}
        autoComplete={secret ? 'new-password' : 'off'}
      />
    </div>
  );
}
