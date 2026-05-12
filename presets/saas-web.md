---
type: saas-web
name: SaaS Web Application
version: 1
high_sensitivity_categories: [auth, input-validation, sql, crypto]
---

# SaaS Web Application Preset

## Identity & Auth
- [ ] auth-signup: 用户能完成注册（邮箱+密码或 SSO 至少一种）
- [ ] auth-login: 用户能登录并拿到合法 session
- [ ] auth-session-safety: session 使用 HttpOnly / Secure cookie，含过期与续期
- [ ] auth-csrf: 关键写操作有 CSRF 保护或 SameSite 严格
- [ ] auth-password-storage: 密码以 bcrypt/argon2 等加盐 hash 存储，不存明文
- [ ] auth-recovery: 提供忘记密码或邮件验证流程（至少占位实现）

## Data Persistence
- [ ] db-real: 持久层非 in-memory 或 mock；进程重启数据不丢
- [ ] db-migrations: 有可重放的 schema 迁移机制
- [ ] db-backup-path: 至少有一种导出 / 备份手段
- [ ] db-connection-pool: 数据库连接经池管理

## Input & Validation
- [ ] input-schema: 所有外部输入有 schema 校验
- [ ] input-error-format: 校验失败返回结构化错误，含字段定位

## Reliability
- [ ] err-handler: 有全局错误处理中间件，不裸泄 stack
- [ ] err-observability: 至少 stderr 结构化日志或接 Sentry 同类 hook
- [ ] timeouts: 关键外部调用（DB / HTTP / RPC）有超时
- [ ] tests-smoke: 至少 1 个 e2e smoke 覆盖核心 flow
- [ ] tests-unit: 关键业务逻辑有单元测试

## Productization
- [ ] deploy-config: 有部署配置（Dockerfile / Procfile / fly.toml / vercel.json 其一）
- [ ] deploy-env-doc: README 或 ENV_VARS.md 列出所有环境变量及示例
- [ ] ci-pipeline: 有 CI 配置文件跑 lint+test
- [ ] docs-readme: README 含 安装 / 启动 / 部署 三段
- [ ] docs-changelog: 有 CHANGELOG.md
- [ ] license: 仓库根有 LICENSE 文件且 manifest 声明 license 字段
- [ ] gitignore: .gitignore 覆盖 node_modules / 构建产物 / .env*

## UX Polish
- [ ] ui-loading: 异步操作有 loading 态视觉
- [ ] ui-error: 失败有用户可见错误提示
- [ ] ui-empty-state: 关键列表 / 页面有空态文案
- [ ] a11y-basic: 表单标签关联、按钮有 accessible name
