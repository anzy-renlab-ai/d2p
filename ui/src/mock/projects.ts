// Mock data for the multi-project home page. Real wire-in will swap this
// for a daemon API once the backend tracks multiple projects.

export type ProjectStatus = 'looping' | 'paused' | 'done' | 'idle' | 'setup' | 'error';

export interface ProjectSummary {
  id: number;
  name: string;
  path: string;
  inferredType: 'saas-web' | 'api-service' | 'cli-tool' | 'library' | 'static-site' | 'mobile' | 'desktop-app' | 'ml-script';
  status: ProjectStatus;
  agentsWorking: number;
  agentsTotal: number;
  presetDone: number;
  presetTotal: number;
  visionVerdict: 'yes' | 'partial' | 'no' | 'pending';
  lastCommitTs: number;
  lastCommitMsg: string;
  costUsd: number;
  pinned: boolean;
}

const NOW = Date.now();
const m = (mins: number) => NOW - mins * 60_000;
const h = (hours: number) => NOW - hours * 60 * 60_000;
const d = (days: number) => NOW - days * 24 * 60 * 60_000;

export const mockProjects: ProjectSummary[] = [
  {
    id: 7,
    name: 'notes-saas',
    path: 'D:\\demos\\notes-saas',
    inferredType: 'saas-web',
    status: 'looping',
    agentsWorking: 1,
    agentsTotal: 7,
    presetDone: 20,
    presetTotal: 32,
    visionVerdict: 'partial',
    lastCommitTs: m(4),
    lastCommitMsg: 'feat(env): document 6 env vars in .env.example',
    costUsd: 1.27,
    pinned: true,
  },
  {
    id: 6,
    name: 'cli-todo',
    path: 'D:\\demos\\cli-todo',
    inferredType: 'cli-tool',
    status: 'paused',
    agentsWorking: 0,
    agentsTotal: 5,
    presetDone: 14,
    presetTotal: 28,
    visionVerdict: 'pending',
    lastCommitTs: h(2),
    lastCommitMsg: 'feat(parser): support --json output flag',
    costUsd: 0.54,
    pinned: true,
  },
  {
    id: 5,
    name: 'mini-blog',
    path: 'D:\\demos\\mini-blog',
    inferredType: 'static-site',
    status: 'done',
    agentsWorking: 0,
    agentsTotal: 7,
    presetDone: 26,
    presetTotal: 26,
    visionVerdict: 'yes',
    lastCommitTs: d(2),
    lastCommitMsg: 'docs(readme): final ship — RSS + analytics + a11y',
    costUsd: 3.18,
    pinned: false,
  },
  {
    id: 4,
    name: 'team-tasker',
    path: 'D:\\demos\\team-tasker',
    inferredType: 'saas-web',
    status: 'error',
    agentsWorking: 0,
    agentsTotal: 7,
    presetDone: 8,
    presetTotal: 32,
    visionVerdict: 'no',
    lastCommitTs: h(8),
    lastCommitMsg: '(implementer 卡在第 4 attempt · NEED_HUMAN)',
    costUsd: 0.81,
    pinned: false,
  },
  {
    id: 3,
    name: 'embed-lib',
    path: 'D:\\demos\\embed-lib',
    inferredType: 'library',
    status: 'idle',
    agentsWorking: 0,
    agentsTotal: 5,
    presetDone: 18,
    presetTotal: 24,
    visionVerdict: 'partial',
    lastCommitTs: d(5),
    lastCommitMsg: 'test(coverage): bump to 84%',
    costUsd: 0.93,
    pinned: false,
  },
];

export const STATUS_META: Record<ProjectStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'mute' | 'active' }> = {
  looping:  { label: '正在跑',   tone: 'active' },
  paused:   { label: '已暂停',   tone: 'warn'   },
  done:     { label: '已完工',   tone: 'good'   },
  setup:    { label: '配置中',   tone: 'mute'   },
  idle:     { label: '空闲',     tone: 'mute'   },
  error:    { label: '需介入',   tone: 'bad'    },
};

export const TYPE_LABEL: Record<ProjectSummary['inferredType'], string> = {
  'saas-web': 'SaaS Web',
  'api-service': 'API Service',
  'cli-tool': 'CLI Tool',
  'library': 'Library',
  'static-site': 'Static Site',
  'mobile': 'Mobile App',
  'desktop-app': 'Desktop App',
  'ml-script': 'ML Script',
};
