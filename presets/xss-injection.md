---
id: xss-injection
version: 2
name: XSS & template-injection check
appliesTo: []
rules:
  - ruleId: react-dangerously-set
    label: React dangerouslySetInnerHTML used (likely unsanitised)
    severity: P1
    mechanism: static-grep
    source: xss-injection/v2
    rationale: React intentionally bypasses its auto-escaping when you pass `dangerouslySetInnerHTML={{ __html: ... }}`. Any user-controlled content reaching that prop is an instant stored/reflected XSS sink. Sanitise with DOMPurify or render as text.
    detection:
      pattern: dangerouslySetInnerHTML\s*=\s*\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace dangerouslySetInnerHTML with text rendering, or sanitise via DOMPurify.sanitize(html) before injection'"
      verifyCommand: "! grep -rE 'dangerouslySetInnerHTML\\s*=\\s*\\{' src/"
  - ruleId: innerhtml-assignment
    label: Direct innerHTML assignment (DOM-XSS sink)
    severity: P1
    mechanism: static-grep
    source: xss-injection/v2
    rationale: Assigning to `el.innerHTML` parses the right-hand string as HTML. Combined with any non-literal source (variables, fetch responses, request input) this is the classic DOM-XSS sink. Use `textContent` for text or sanitise first.
    detection:
      pattern: \.innerHTML\s*=\s*[^'"`]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: use el.textContent = value for text, or DOMPurify.sanitize(html) before assigning to innerHTML'"
      verifyCommand: "! grep -rE '\\.innerHTML\\s*=\\s*[^'\\''\"\\`]' src/"
  - ruleId: document-write-input
    label: document.write fed from request or input
    severity: P1
    mechanism: static-grep
    source: xss-injection/v2
    rationale: `document.write` parses HTML and runs `<script>` tags inline. Sourcing it from `req.*`, `input`, `location.*`, or any URL parameter gives the attacker full DOM control. The API is deprecated for exactly this reason.
    detection:
      pattern: document\.write(?:ln)?\s*\(\s*(req\.|input|location\.|window\.location)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: stop using document.write — build the DOM via createElement / textContent or use a templating engine that auto-escapes'"
      verifyCommand: "! grep -rE 'document\\.write(ln)?\\s*\\(\\s*(req\\.|input|location\\.|window\\.location)' src/"
  - ruleId: vue-v-html
    label: Vue template uses v-html directive
    severity: P2
    mechanism: static-grep
    source: xss-injection/v2
    rationale: Vue's `v-html` directive renders its argument as raw HTML, skipping the auto-escape that mustache `{{ }}` interpolation provides. Use `{{ }}` for text, or sanitise with DOMPurify before binding to v-html.
    detection:
      pattern: v-html\s*=
      filePattern: src/**/*.{vue,ts,tsx,js,jsx,html}
    fix:
      kind: template
      command: "echo 'manual remediation: replace v-html with mustache interpolation, or sanitise via DOMPurify.sanitize(html) before binding'"
      verifyCommand: "! grep -rE 'v-html\\s*=' src/"
  - ruleId: handlebars-triple-stash
    label: Handlebars triple-stash {{{...}}} emits raw HTML
    severity: P2
    mechanism: static-grep
    source: xss-injection/v2
    rationale: `{{value}}` in Handlebars HTML-escapes; `{{{value}}}` does not. Any triple-stash with user-controlled data leaks raw HTML into the page. Switch to double-stash unless the value is a vetted SafeString.
    detection:
      pattern: \{\{\{[^}]+\}\}\}
      filePattern: src/**/*.{hbs,handlebars,html,ts,tsx,js,jsx}
    fix:
      kind: template
      command: "echo 'manual remediation: switch {{{value}}} to {{value}} unless the value is a vetted Handlebars.SafeString'"
      verifyCommand: "! grep -rE '\\{\\{\\{[^}]+\\}\\}\\}' src/"
  - ruleId: pug-unescape-interpolation
    label: Pug unescaped interpolation (!= operator)
    severity: P2
    mechanism: static-grep
    source: xss-injection/v2
    rationale: Pug's `!= expression` emits the value without HTML escaping. The escaped variant is `= expression`. Any unescaped interpolation that touches user content is an XSS sink.
    detection:
      pattern: ^\s*!=\s+
      filePattern: src/**/*.{pug,jade}
    fix:
      kind: template
      command: "echo 'manual remediation: replace != with = to enable HTML escaping unless the value is pre-sanitised'"
      verifyCommand: "! grep -rE '^\\s*!=\\s+' src/"
  - ruleId: html-tagged-template-with-input
    label: Tagged html`...` template interpolates non-literal value
    severity: P1
    mechanism: static-grep
    source: xss-injection/v2
    rationale: Many libraries expose an `html` tag (lit, hyperhtml, lit-html, common.js helpers) that auto-escapes only when the tag itself does. Ad-hoc `html\`...${userInput}...\`` template strings used to build HTML strings emit raw content. Use a real template engine or escape via DOMPurify.
    detection:
      pattern: \bhtml`[^`]*\$\{
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: use a templating engine with auto-escape (React JSX, lit-html), or escape values via DOMPurify before splicing them into HTML strings'"
      verifyCommand: "! grep -rE '\\bhtml`[^`]*\\$\\{' src/"
  - ruleId: response-html-unsafe
    label: Server emits HTML response with user-controlled content (likely unescaped)
    severity: P2
    mechanism: llm-judgment
    source: xss-injection/v2
    rationale: Endpoints that respond with HTML (e.g. `res.send('<div>' + req.query.name + '</div>')`) frequently skip escaping. LLM reviews the handler to judge whether the user content is escaped via a templating engine or sanitiser before reaching the response.
    detection:
      pattern: res\.(send|write|end)\s*\([`'"][^`'"]*<[^>]+>[^`'"]*(\+|\$\{)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: llm-only
      command: "echo 'manual remediation: render HTML via a templating engine with auto-escape (Handlebars {{ }}, EJS <%= %>, React renderToString), or escape via he/escape-html before concatenation'"
      verifyCommand: "echo 'manual review required'"
---

# XSS & template-injection check

User-controlled strings reaching an HTML sink without escaping is the single
most common vulnerability in vibe-coded apps. This preset surfaces eight
sinks that bypass each framework's default protections:

1. **`react-dangerously-set`** — `dangerouslySetInnerHTML` opts out of React escaping.
2. **`innerhtml-assignment`** — direct DOM-XSS sink.
3. **`document-write-input`** — deprecated and fully exploitable.
4. **`vue-v-html`** — Vue's raw-HTML directive.
5. **`handlebars-triple-stash`** — `{{{x}}}` bypasses HTML escaping.
6. **`pug-unescape-interpolation`** — Pug `!= value` emits raw HTML.
7. **`html-tagged-template-with-input`** — ad-hoc `html\`${x}\`` string builds.
8. **`response-html-unsafe`** — server-rendered HTML response with concatenated input (LLM-judged).

## Remediation

### React

```jsx
// Bad
<div dangerouslySetInnerHTML={{ __html: comment }} />

// Good — text rendering
<div>{comment}</div>

// Good — if you really need HTML, sanitise first
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment) }} />
```

### Vanilla DOM

```js
// Bad
el.innerHTML = req.query.name;

// Good
el.textContent = req.query.name;
```

### Vue

```html
<!-- Bad -->
<div v-html="rawHtml"></div>

<!-- Good -->
<div>{{ rawHtml }}</div>
```

### Server HTML

```js
// Bad
res.send(`<h1>Hello ${req.query.name}</h1>`);

// Good — escape
import escape from 'escape-html';
res.send(`<h1>Hello ${escape(req.query.name)}</h1>`);
```

After fixes, re-run `zerou audit` and confirm zero findings remain.
