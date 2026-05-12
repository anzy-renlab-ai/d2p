---
type: api-service
name: API Service / Backend
version: 1
high_sensitivity_categories: [auth, input-validation, sql, network, crypto]
---

# API Service Preset

## Identity & Auth
- [ ] auth-strategy: 至少一种鉴权（API key / JWT / OAuth）落地
- [ ] auth-scoping: 资源访问按用户/租户隔离
- [ ] auth-token-rotation: token / API key 有撤销或轮换机制

## Data
- [ ] db-real: 持久层非 mock
- [ ] db-migrations: 可重放迁移机制
- [ ] db-indexing: 主查询路径有索引
- [ ] db-connection-pool: 连接池管理

## API Contract
- [ ] api-spec: 有 OpenAPI / API 文档
- [ ] api-versioning: 版本策略
- [ ] api-error-codes: 错误码列表 + 含义
- [ ] api-rate-limit: 全局或按 key 的限流

## Input & Validation
- [ ] input-schema: 所有 endpoint 输入有 schema 校验
- [ ] input-size-limit: body 体积上限
- [ ] input-error-format: 4xx 含一致错误格式

## Reliability
- [ ] err-handler: 全局错误处理
- [ ] err-observability: 结构化日志 + 错误上报 hook
- [ ] timeouts: 上下游调用超时
- [ ] tests-smoke: e2e 跑通主要 endpoint
- [ ] tests-unit: 业务逻辑单测
- [ ] tests-contract: API 契约测试

## Productization
- [ ] deploy-config: 部署配置
- [ ] deploy-env-doc: 环境变量文档
- [ ] ci-pipeline: CI
- [ ] docs-readme: README 三段
- [ ] docs-curl-examples: README 含 curl 示例
- [ ] license: LICENSE
- [ ] gitignore: 妥当
