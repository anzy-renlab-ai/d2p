import { useState } from 'react';
import { useLocale } from '../i18n/useLocale.js';
import {
  mockPresetItemsRich,
  type MockPresetItem,
  type MockMechanism,
} from '../mock/data.js';
import { CountUp } from './CountUp.js';

// Full 32-item preset rendering — pulls from mockPresetItemsRich which carries
// severity / mechanism / source / appliesTo (the F2 source-of-truth table from
// docs/plans/2026-05-13-track-c-features.md). Real wire-in will swap this
// import for a store selector once the daemon exposes the rich shape.

const LABEL_ZH: Record<string, string> = {
  'build-typecheck': '类型检查能跑过 / 编译通过',
  'build-reproducible': '在干净仓库上 build 能 0 退出',
  'test-runner-present': '装了测试 runner + 至少 1 个测试文件',
  'test-happy-path-passes': 'npm test 全过',
  'test-edge-cases': '每个公开函数至少 1 个负向测试',
  'readme-quickstart': 'README 有「安装 + 运行」代码块',
  'license-file': 'LICENSE 文件 + SPDX 合规',
  'env-example': '.env.example 覆盖所有 env 变量',
  'no-hardcoded-secrets': '没硬编码 API key / 密码',
  'lockfile-present': '依赖 lockfile 已提交',
  'deps-no-high-vuln': '依赖审计 · 0 个高危漏洞',
  'port-from-env': '服务端口从 env 读',
  'sigterm-handler': '收到 SIGTERM 优雅关闭',
  'stdout-logging': '日志走 stdout（不写文件）',
  'health-endpoint': 'GET /health 返回 200',
  'structured-logs': '结构化日志（JSON / 带 request id）',
  'error-handler-present': '顶层错误处理 / boundary',
  'auth-on-mutating-routes': '非 GET 路由套了鉴权',
  'password-hash-strong': '只用 bcrypt / argon2 / scrypt',
  'https-only-prod': '生产无 http:// · cookie Secure',
  'rate-limit-public': '公网路由套了限流',
  'sql-parameterized': 'SQL 不拼字符串 · 参数化',
  'cors-not-wildcard': 'Origin:* 不能带 credentials',
  'a11y-axe-clean': 'axe-core 0 个严重无障碍问题',
  'viewport-meta': '<meta viewport> 存在',
  'error-boundary': '根级错误边界组件',
  'ci-pipeline': 'CI 在 PR 上跑测试 + build',
  'ci-token-perms': 'CI workflow 显式声明 permissions',
  'deploy-config': '目标部署配置有效',
  'package-publishable': 'npm pack / build 能成功（库）',
  'binary-not-committed': 'dist/ 外没 .exe / .dll',
  'vision-verdict': '产品满足用户 vision',
};

const MECHANISM_ICON: Record<MockMechanism, string> = {
  'test-execution':     '▶',
  'file-exists':        '☐',
  'static-grep':        '⌕',
  'cross-file-cohesion':'↔',
  'llm-judgment':       '✻',
};

const MECHANISM_KEY: Record<MockMechanism, string> = {
  'test-execution':     'preset.mech.test',
  'file-exists':        'preset.mech.file',
  'static-grep':        'preset.mech.grep',
  'cross-file-cohesion':'preset.mech.cohesion',
  'llm-judgment':       'preset.mech.llm',
};

const SEVERITY_COLOR: Record<MockPresetItem['severity'], string> = {
  P1: 'bg-rust/10 text-rust',
  P2: 'bg-coralsoft text-coral',
  P3: 'bg-paper text-muted/70',
};

type Status = MockPresetItem['status'];

const STATUS_STYLE: Record<Status, { chip: string; dot: string; key: string }> = {
  missing: { chip: 'bg-rust/10 text-rust',     dot: 'bg-rust',     key: 'preset.status.missing' },
  partial: { chip: 'bg-coralsoft text-coral',  dot: 'bg-coral',    key: 'preset.status.partial' },
  done:    { chip: 'bg-sage-50 text-sage-600', dot: 'bg-sage-600', key: 'preset.status.done' },
};

const APPLIES_LABEL: Record<string, string> = {
  W: 'Web', A: 'API', C: 'CLI', L: 'Lib', S: 'Static', M: 'Mobile', D: 'Desktop', ML: 'ML',
};

export function PresetChecklistView() {
  const { t } = useLocale();
  const items = mockPresetItemsRich;
  const groups: Record<Status, MockPresetItem[]> = { missing: [], partial: [], done: [] };
  for (const i of items) groups[i.status].push(i);

  const total = items.length;
  const doneCount = groups.done.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="h-full flex flex-col bg-paper">
      {/* Header — big progress + counts */}
      <div className="bg-cream px-6 py-5 border-b border-warmline/60">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-2xl font-medium text-ink">
              <CountUp value={doneCount} />
              <span className="text-muted/60 text-lg font-normal"> / {total}</span>
            </div>
            <div className="text-xs text-muted/70 mt-0.5">
              {t('preset.header.completion')} ·{' '}
              <span className="italic">{t('preset.header.source')}</span>
            </div>
          </div>
          <CountUp
            value={pct}
            className="text-3xl font-mono text-sage-600 leading-none"
            format={(n) => `${Math.round(n)}%`}
          />
        </div>
        <div className="w-full h-2 bg-paper rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sage-600 to-sage-600/70 transition-all duration-700 ease-out-quart"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex gap-2 mt-3 text-xs">
          <CountChip status="missing" n={groups.missing.length} />
          <CountChip status="partial" n={groups.partial.length} />
          <CountChip status="done" n={groups.done.length} />
        </div>
      </div>

      {/* Grouped items */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {(['missing', 'partial', 'done'] as Status[]).map((s) => (
          <Group key={s} status={s} items={groups[s]} defaultOpen={s !== 'done'} />
        ))}
      </div>
    </div>
  );
}

function CountChip({ status, n }: { status: Status; n: number }) {
  const { t } = useLocale();
  const meta = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans ${meta.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {t(meta.key)} {n}
    </span>
  );
}

function Group({
  status,
  items,
  defaultOpen,
}: {
  status: Status;
  items: MockPresetItem[];
  defaultOpen: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(defaultOpen);
  const meta = STATUS_STYLE[status];

  if (items.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 mb-3 group"
        aria-expanded={open}
      >
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className="text-sm font-medium text-ink">{t(meta.key)}</span>
        <span className="text-xs text-muted/70 font-sans">{items.length} {t('preset.group.items')}</span>
        <span className="flex-1" />
        <span className="text-xs text-muted/60 group-hover:text-ink font-sans transition-colors">
          {open ? t('preset.group.collapse') : t('preset.group.expand')}
        </span>
      </button>
      {open && (
        <ul className="space-y-2.5">
          {items.map((i, idx) => (
            <div
              key={i.id}
              className="anim-stagger"
              style={{ ['--i' as 'width']: idx as unknown as string }}
            >
              <ItemCard item={i} />
            </div>
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemCard({ item }: { item: MockPresetItem }) {
  const { t, locale } = useLocale();
  // English mode: prefer the original (English) label from mockPresetItemsRich;
  // Chinese mode: prefer the translated label, fall back to original.
  const primary = locale === 'en' ? item.label : (LABEL_ZH[item.id] ?? item.label);
  // Show the alt-language line only in zh mode (where primary is Chinese and
  // English original is a useful sub-line). In en mode the primary IS the
  // English original — don't add a Chinese sub-line.
  const secondary = locale === 'en' ? '' : item.label;
  const mechZh = t(MECHANISM_KEY[item.mechanism]);
  const mechIcon = MECHANISM_ICON[item.mechanism];
  return (
    <li className="bg-cream rounded-xl shadow-card ring-1 ring-warmline/60 px-4 py-3.5 lift-on-hover">
      <div className="flex items-start gap-3 mb-2">
        <span className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-sans font-medium ${SEVERITY_COLOR[item.severity]}`}>
          {item.severity}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink leading-snug">{primary}</div>
          {secondary && secondary !== primary && (
            <div className="text-[11px] text-muted/70 font-mono mt-0.5">{secondary}</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-10">
        <span
          className="inline-flex items-center gap-1 text-[10px] text-muted/80 font-sans bg-paper px-2 py-0.5 rounded-full"
          title={mechZh}
        >
          <span>{mechIcon}</span>
          {mechZh}
        </span>
        <span
          className="text-[10px] text-muted/80 font-sans bg-paper px-2 py-0.5 rounded-full font-mono"
          title={item.source}
        >
          {item.source}
        </span>
        {item.appliesTo.length < 8 && (
          <span className="text-[10px] text-muted/80 font-sans bg-paper px-2 py-0.5 rounded-full">
            {item.appliesTo.map((a) => APPLIES_LABEL[a] ?? a).join(' · ')}
          </span>
        )}
        {item.note && (
          <span className="flex-1 text-[11px] text-muted italic min-w-0 truncate" title={item.note}>
            — {item.note}
          </span>
        )}
      </div>
    </li>
  );
}
