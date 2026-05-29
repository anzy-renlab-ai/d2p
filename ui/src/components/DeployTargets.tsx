import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Target {
  id: string;
  name: string;
  confidence: number;
  evidence: string[];
  recommendedCommand: string;
  docsUrl: string;
}

export function DeployTargets() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .deployTargets()
      .then((r) => {
        if (!cancelled) {
          setTargets(r.targets);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return <div className="text-sm text-muted/80 font-mono">扫描部署目标…</div>;
  if (targets.length === 0) {
    return (
      <div className="text-sm text-muted leading-relaxed">
        没找到现成的部署配置。可以让下一轮 loop 帮你加（在 vision 里加上"部署到 Vercel/Fly/etc."）。
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted leading-relaxed">检测到这些可能的部署目标。ZeroU 不会自动 push — 你拿着命令自己跑。</div>
      <ul className="space-y-2">
        {targets.map((t) => (
          <li key={t.id} className="border border-warmline rounded-md p-3 bg-paper">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ink">{t.name}</span>
                <span className="text-xs text-muted ml-2">
                  confidence {(t.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <a
                href={t.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-coral hover:underline"
              >
                docs ↗
              </a>
            </div>
            <ul className="mt-1.5 text-xs text-muted list-disc pl-5">
              {t.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <code className="block mt-2 text-xs bg-cream px-2.5 py-1.5 rounded border border-warmline break-all font-mono">
              {t.recommendedCommand}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
