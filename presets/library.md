---
type: library
name: Library / SDK
version: 1
high_sensitivity_categories: [input-validation]
---

# Library Preset

## API Surface
- [ ] api-typed: 公开 API 有类型定义
- [ ] api-no-side-effects-on-import: import 不产生副作用
- [ ] api-versioning: semver 起点 + CHANGELOG
- [ ] api-deprecation: 公开 API 改动可见性

## Quality
- [ ] tests-unit: 公开 API 单测覆盖
- [ ] tests-snapshot-or-property: 关键路径有 snapshot 或 property test
- [ ] docs-api: API 文档
- [ ] docs-readme: README 含 安装 / 30 秒上手 / 链接到完整 API 三段

## Packaging
- [ ] package-exports: 包导出字段正确
- [ ] tree-shakeable: ESM 默认；公开符号 named export
- [ ] sourcemap: 发布产物含 sourcemap
- [ ] no-dev-deps-in-runtime: runtime 只 import 声明的依赖
- [ ] license: LICENSE + manifest license 字段

## Operations
- [ ] ci-pipeline: CI 跑 test + typecheck
- [ ] release-script: 一键发布脚本或文档
- [ ] examples-folder: examples/ 或 README 示例可跑
