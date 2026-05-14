import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';

export function InputsEditor() {
  const [inputs, setInputs] = useState<{ name: string; size: number; modifiedAt: number }[]>([]);
  const [name, setName] = useState('prd.md');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = await api.listInputs().catch(() => ({ inputs: [] }));
    setInputs(r.inputs);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSave() {
    setError(null);
    if (!name.trim()) {
      setError('需要文件名');
      return;
    }
    if (!body.trim()) {
      setError('内容是空的');
      return;
    }
    setBusy(true);
    try {
      await api.saveInput(name.trim(), body);
      setBody('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted leading-relaxed">
        附加非代码材料（PRD / API spec / mockup 笔记…）。vision 提问时会读这些做背景。
      </div>
      {inputs.length > 0 && (
        <ul className="text-xs space-y-1 font-mono">
          {inputs.map((i) => (
            <li key={i.name} className="flex items-center justify-between px-2 py-1 bg-paper rounded">
              <code className="text-ink">{i.name}</code>
              <span className="text-muted/70">{i.size} 字节</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 prd.md"
          className="input input-mono"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="贴一段 PRD / API spec / mockup 描述…"
          rows={5}
          className="input input-mono"
        />
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div className="flex justify-end">
          <Button onClick={() => void onSave()} disabled={busy} variant="secondary">
            {busy ? '保存中…' : '保存附件'}
          </Button>
        </div>
      </div>
    </div>
  );
}
