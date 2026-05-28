---
id: xml-xxe-injection
version: 2
name: XML External Entity (XXE) injection check
appliesTo: ['saas-web', 'api-service', 'library']
rules:
  - ruleId: libxmljs-noent-enabled
    label: libxmljs parseXml called with noent:true (external entity expansion enabled)
    severity: P1
    mechanism: static-grep
    source: xml-xxe-injection/v2
    rationale: libxmljs's noent option controls entity expansion. With noent:true the parser dereferences external entities — including file:// and http:// SYSTEM references — allowing an attacker to read /etc/passwd or trigger SSRF via a crafted DOCTYPE. The safe default is omitting noent or setting it to false.
    detection:
      pattern: libxmljs\.parseXml(?:String)?\s*\([^)]*noent\s*:\s*true
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: remove noent:true from parseXml options. If entity expansion is required, sanitise the DOCTYPE first and ensure no external SYSTEM references reach the parser.'"
      verifyCommand: "! grep -rE 'libxmljs\\.parseXml(String)?\\s*\\([^)]*noent\\s*:\\s*true' src/"
  - ruleId: libxmljs-parseXml-default
    label: libxmljs parseXml called without explicit safe options
    severity: P2
    mechanism: static-grep
    source: xml-xxe-injection/v2
    rationale: libxmljs's behavior changed between versions. Calling parseXml without explicit { noent: false, nonet: true } leaves entity expansion at the library default, which has varied. Document intent and lock down the parser explicitly.
    detection:
      pattern: libxmljs\.parseXml(?:String)?\s*\(\s*(?:req|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: pass explicit options: libxmljs.parseXml(input, { noent: false, nonet: true, noblanks: true }). Reject the input if it contains a DOCTYPE.'"
      verifyCommand: "! grep -rE 'libxmljs\\.parseXml(String)?\\s*\\(\\s*(req|input|params|body|query)' src/"
  - ruleId: xml2js-explicitEntities
    label: xml2js parser config enables external entity processing
    severity: P1
    mechanism: static-grep
    source: xml-xxe-injection/v2
    rationale: Any xml2js / sax-js config that turns on entity processing (explicitEntities:true, resolveExternals:true, or a custom strict:false combined with entity hooks) opens the door to XXE. xml2js by default is mostly safe, but custom configs frequently re-enable the dangerous knobs.
    detection:
      pattern: (?:explicitEntities|resolveExternals|expandEntities)\s*:\s*true
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: set explicitEntities:false, resolveExternals:false, expandEntities:false. Reject documents whose source begins with a DOCTYPE declaration.'"
      verifyCommand: "! grep -rE '(explicitEntities|resolveExternals|expandEntities)\\s*:\\s*true' src/"
  - ruleId: fast-xml-parser-processEntities
    label: fast-xml-parser used without processEntities:false
    severity: P2
    mechanism: static-grep
    source: xml-xxe-injection/v2
    rationale: fast-xml-parser supports custom entities and DOCTYPE processing. On user-controlled input the safe option is processEntities:false plus htmlEntities:false. Default config has historically processed character entities that could be abused.
    detection:
      pattern: (?:XMLParser|new\s+XMLParser)\s*\(\s*\{[^}]*\}\s*\)\s*\.parse\s*\(\s*(?:req|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: configure XMLParser({ processEntities: false, htmlEntities: false, ignoreDeclaration: true, ignoreAttributes: false }) before parsing untrusted XML.'"
      verifyCommand: "! grep -rE '(XMLParser|new\\s+XMLParser)\\s*\\(\\s*\\{[^}]*\\}\\s*\\)\\.parse\\s*\\(\\s*(req|input|params|body|query)' src/"
  - ruleId: xmldom-default-config
    label: xmldom DOMParser used on user input without disabling external entities
    severity: P2
    mechanism: static-grep
    source: xml-xxe-injection/v2
    rationale: xmldom (@xmldom/xmldom and the older xmldom) has had multiple XXE CVEs across versions. Default config on untrusted input has at times allowed DOCTYPE processing. Pin a current version and pass an errorHandler that rejects DOCTYPE.
    detection:
      pattern: new\s+DOMParser\s*\(\s*\)\s*\.parseFromString\s*\(\s*(?:req|input|params|body|query)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: upgrade @xmldom/xmldom to the latest version and wrap parseFromString with a pre-check that rejects DOCTYPE: if (/<!DOCTYPE/i.test(input)) throw new BadRequest();'"
      verifyCommand: "! grep -rE 'new\\s+DOMParser\\s*\\(\\s*\\)\\.parseFromString\\s*\\(\\s*(req|input|params|body|query)' src/"
---

# XML External Entity (XXE) injection check

XML parsers that resolve external entities expand `<!ENTITY xxe SYSTEM
"file:///etc/passwd">` to the file's contents at parse time. The attacker
submits XML; the server reads its own files, makes outbound HTTP requests,
or hangs on entity-expansion bombs (billion laughs).

Five sinks:

1. **`libxmljs-noent-enabled`** — explicit noent:true is dangerous.
2. **`libxmljs-parseXml-default`** — default options on untrusted input.
3. **`xml2js-explicitEntities`** — explicitEntities/resolveExternals turned on.
4. **`fast-xml-parser-processEntities`** — processEntities not disabled.
5. **`xmldom-default-config`** — DOMParser default config on untrusted XML.

## Remediation

### Reject documents that declare a DOCTYPE

```js
function safeParseXml(input) {
  if (/<!DOCTYPE/i.test(input)) {
    throw new Error('XML DOCTYPE not permitted');
  }
  return libxmljs.parseXml(input, { noent: false, nonet: true });
}
```

### fast-xml-parser — safe defaults

```js
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
});
const data = parser.parse(input);
```

### Prefer JSON for new endpoints

If you control both ends, switch from XML to JSON. JSON has no entity
expansion semantics and no external reference surface.

After fixes, re-run `zerou audit` and confirm zero findings remain.
