---
type: cli-tool
name: Command Line Tool
version: 1
high_sensitivity_categories: [file-ops, input-validation]
---

# CLI Tool Preset

## Surface
- [ ] cli-help: --help 输出列出所有子命令 + flags + 示例
- [ ] cli-version: --version 输出语义化版本
- [ ] cli-exit-codes: 不同失败用不同 exit code，0 仅代表成功
- [ ] cli-stderr-stdout: 提示信息到 stderr，机器可读输出到 stdout
- [ ] cli-flags-consistent: 长短 flag 一致，help 一致

## Input
- [ ] input-validation: flag / args 校验
- [ ] input-stdin: 支持 stdin 输入（如果适用）
- [ ] file-paths-safe: 文件路径处理含 .. 校验

## Behavior
- [ ] idempotent: 重复跑同一命令对状态不重复破坏
- [ ] dry-run: 关键破坏性命令有 --dry-run
- [ ] confirm-destructive: --force 显式才执行破坏性动作

## Reliability
- [ ] err-messages: 错误信息含怎么修建议
- [ ] tests-smoke: 至少一个端到端命令调用 smoke
- [ ] tests-unit: 关键解析 / 业务函数单测

## Productization
- [ ] package-bin: package.json 含 bin 字段
- [ ] install-instructions: README 含本地 / global 安装方式
- [ ] docs-readme: README 含 安装 / 用法 / 示例 三段
- [ ] changelog: CHANGELOG 起点
- [ ] license: LICENSE
- [ ] ci-pipeline: CI 跑 test on linux/macos/windows ≥1 个
