---
id: command-injection
version: 2
name: Command injection & dynamic-code-execution check
appliesTo: []
rules:
  - ruleId: child-process-exec-input
    label: child_process.exec with concatenated or interpolated input
    severity: P1
    mechanism: static-grep
    source: command-injection/v2
    rationale: `exec()` and `execSync()` route the command string through a shell, so any concatenated user input becomes shell syntax — `; rm -rf /` style attacks. Replace with `execFile`/`spawn` and pass arguments as an array.
    detection:
      pattern: \b(exec|execSync)\s*\(\s*[`'"][^`'"]*(\$\{|\+)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace exec(`cmd ${user}`) with execFile(\"cmd\", [user]) — pass arguments as an array, not a shell-parsed string'"
      verifyCommand: "! grep -rE '\\b(exec|execSync)\\s*\\(\\s*[`'\\''\"][^`'\\''\"]*(\\$\\{|\\+)' src/"
  - ruleId: spawn-shell-with-input
    label: spawn / execFile invoked with shell + user input
    severity: P1
    mechanism: static-grep
    source: command-injection/v2
    rationale: `spawn('sh', ['-c', userInput])` and `spawn(cmd, args, { shell: true })` re-introduce shell interpretation, defeating the array-argument protection. Either turn off `shell:` or never feed user input into `-c`.
    detection:
      pattern: (spawn|execFile)\s*\([^)]*(shell\s*:\s*true|['"]sh['"]\s*,\s*\[\s*['"]-c['"])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: drop shell:true, and never pass user input as the -c argument; use spawn(cmd, [arg1, arg2]) form'"
      verifyCommand: "! grep -rE '(spawn|execFile)\\s*\\([^)]*(shell\\s*:\\s*true|[\\\"'\\'']sh[\\\"'\\'']\\s*,\\s*\\[\\s*[\\\"'\\'']-c[\\\"'\\''])' src/"
  - ruleId: dynamic-require
    label: require() called with a non-literal expression
    severity: P1
    mechanism: static-grep
    source: command-injection/v2
    rationale: `require(variable)` lets an attacker load arbitrary modules — including `child_process` for full RCE. Static analysers and bundlers also fail on dynamic requires. Replace with a hardcoded map of allowed modules.
    detection:
      pattern: \brequire\s*\(\s*(?!['"`])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace require(variable) with an allow-list map: const mod = { foo: require(\"./foo\") }[key]'"
      verifyCommand: "! grep -rE '\\brequire\\s*\\(\\s*(?![`'\\''\"])' src/"
  - ruleId: eval-direct
    label: eval() called anywhere
    severity: P1
    mechanism: static-grep
    source: command-injection/v2
    rationale: `eval()` parses and executes any string as JavaScript. Even if the current call site uses a constant, the function is too easy to mutate into an RCE sink. Modern code almost never needs `eval` — use `JSON.parse`, function maps, or a real expression parser.
    detection:
      pattern: \beval\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: delete eval(). For parsing data use JSON.parse; for dispatch use a lookup table; for expressions use mathjs or expr-eval.'"
      verifyCommand: "! grep -rE '\\beval\\s*\\(' src/"
  - ruleId: new-function-constructor
    label: new Function() constructor used (eval-equivalent)
    severity: P1
    mechanism: static-grep
    source: command-injection/v2
    rationale: `new Function('return ' + body)` is functionally identical to `eval` — it compiles a string into executable JS at runtime. Same RCE risk, same remediation.
    detection:
      pattern: new\s+Function\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace new Function() with a static function or lookup table; never compile user input into JS'"
      verifyCommand: "! grep -rE 'new\\s+Function\\s*\\(' src/"
  - ruleId: vm-run-with-input
    label: node:vm executes a script built from input
    severity: P1
    mechanism: static-grep
    source: command-injection/v2
    rationale: `vm.runInThisContext` / `vm.runInNewContext` evaluate JS strings. `vm` is NOT a security boundary (Node documents this explicitly) — sandbox escapes are trivial. Any user-influenced script body is RCE.
    detection:
      pattern: vm\.(runInThisContext|runInNewContext|runInContext|compileFunction)\s*\([`'"]*[^`'"]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: do not use node:vm to sandbox untrusted code. Use a real isolate (isolated-vm) or run untrusted code in a separate process with seccomp / container limits.'"
      verifyCommand: "! grep -rE 'vm\\.(runInThisContext|runInNewContext|runInContext|compileFunction)\\s*\\([`'\\''\"]*[^`'\\''\"]*\\$\\{' src/"
---

# Command injection & dynamic-code-execution check

Any path that turns a runtime string into shell input or JavaScript is an RCE
sink unless the string is fully under developer control. This preset surfaces
the six most reachable patterns:

1. **`child-process-exec-input`** — `exec` / `execSync` with concatenated input.
2. **`spawn-shell-with-input`** — `spawn(..., { shell: true })` or `sh -c userInput`.
3. **`dynamic-require`** — `require(variable)` enables arbitrary module load.
4. **`eval-direct`** — `eval()` parses any string as JS.
5. **`new-function-constructor`** — `new Function(body)` equals `eval`.
6. **`vm-run-with-input`** — `node:vm` is not a sandbox; user-supplied scripts mean RCE.

## Remediation

### Replace exec with execFile

```js
// Bad — shell-parsed
const { exec } = require('child_process');
exec(`convert ${file} out.png`);

// Good — argv array, no shell
const { execFile } = require('child_process');
execFile('convert', [file, 'out.png']);
```

### Bind requires statically

```js
// Bad
const mod = require(req.query.name);

// Good
const handlers = {
  resize: require('./resize.js'),
  rotate: require('./rotate.js'),
};
const mod = handlers[req.query.name];
if (!mod) return res.status(400).end();
```

### Replace eval with parser

```js
// Bad
const result = eval(req.body.expression);

// Good
import { Parser } from 'expr-eval';
const result = new Parser().parse(req.body.expression).evaluate(scope);
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
