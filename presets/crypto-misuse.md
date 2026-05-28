---
id: crypto-misuse
version: 2
name: Crypto misuse check (vibe-coded apps)
appliesTo: []
rules:
  - ruleId: math-random-for-crypto
    label: Math.random() used near token/id/password/key/secret variable
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "`Math.random()` is a non-cryptographic PRNG seeded from a 32-bit value; output is predictable and reproducible across processes. Anything that gates access (session token, password reset id, API key, nonce, salt) must come from `crypto.randomBytes` / `crypto.randomUUID`. The grep matches a Math.random call within ~5 lines of a token/id/password/key/secret/nonce/salt identifier."
    detection:
      pattern: (token|tokenId|sessionId|password|passwd|secret|apiKey|api_key|nonce|salt|resetCode|csrf)[A-Za-z0-9_$]*\s*=\s*[^;]*Math\.random\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: use crypto.randomBytes(N).toString(\"hex\") or crypto.randomUUID() for any value that gates access'"
      verifyCommand: "! grep -rE '(token|sessionId|password|secret|apiKey|nonce|salt|csrf)[A-Za-z0-9_$]*\\s*=\\s*[^;]*Math\\.random\\s*\\(' src/"
  - ruleId: crypto-createcipher-deprecated
    label: Deprecated crypto.createCipher() used (no IV / weak KDF)
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "`crypto.createCipher(algo, password)` derives the key with MD5-based EVP_BytesToKey and uses a zero / constant IV. Two ciphertexts with the same password leak structure. Node has deprecated it since 10.x. Use `crypto.createCipheriv(algo, key, iv)` with a 16-byte random IV and a real KDF (`scrypt`/`pbkdf2`) for the key."
    detection:
      pattern: crypto\.createCipher\s*\(
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace createCipher with createCipheriv(algo, key, crypto.randomBytes(16)); derive key via scrypt or pbkdf2'"
      verifyCommand: "! grep -rE 'crypto\\.createCipher\\s*\\(' src/"
  - ruleId: md5-for-password
    label: MD5 hash used near password/token variable
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "MD5 is collision-broken, fast on commodity GPUs (~100 GH/s), and has no work factor. Passwords must use a memory-hard password KDF (argon2id, scrypt) or at minimum bcrypt with high rounds. Tokens that need integrity must use HMAC-SHA-256 or better."
    detection:
      pattern: createHash\s*\(\s*['"`]md5['"`]\s*\)[\s\S]{0,200}(password|passwd|token|secret|apiKey)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace MD5 with argon2id / bcrypt (passwords) or HMAC-SHA-256 (tokens). Re-hash on next login.'"
      verifyCommand: "! grep -rE 'createHash\\s*\\(\\s*[\\`'\\''\"]md5[\\`'\\''\"]\\s*\\)' src/"
  - ruleId: sha1-for-password
    label: SHA-1 hash used near password/token variable
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "SHA-1 has known collisions (SHAttered, 2017) and like SHA-256 is a *fast* hash with no work factor. For passwords use argon2id / bcrypt. SHA-1 is also being deprecated for TLS certificates; do not introduce new dependencies on it."
    detection:
      pattern: createHash\s*\(\s*['"`]sha1['"`]\s*\)[\s\S]{0,200}(password|passwd|token|secret)
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: replace SHA-1 with argon2id / bcrypt (passwords) or SHA-256+ (integrity). Re-hash on next login.'"
      verifyCommand: "! grep -rE 'createHash\\s*\\(\\s*[\\`'\\''\"]sha1[\\`'\\''\"]\\s*\\)' src/"
  - ruleId: pbkdf2-low-iterations
    label: PBKDF2 with iteration count below 100k
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "OWASP 2023 PBKDF2-SHA-256 minimum is 600k iterations (310k for SHA-512). Anything under 100k is trivially crackable on a single GPU. The grep matches literal iteration counts < 100000."
    detection:
      pattern: pbkdf2(Sync)?\s*\([^,]+,[^,]+,\s*([0-9]{1,4}|[1-9][0-9]{4})\s*,
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: raise pbkdf2 iterations to >=600_000 for SHA-256 (OWASP 2023), or migrate to argon2id / scrypt'"
      verifyCommand: "! grep -rE 'pbkdf2(Sync)?\\s*\\([^,]+,[^,]+,\\s*([0-9]{1,4}|[1-9][0-9]{4})\\s*,' src/"
  - ruleId: bcrypt-low-rounds
    label: bcrypt.hash() called with cost factor <= 8
    severity: P2
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "bcrypt cost factor controls work — each +1 doubles time. OWASP 2023 minimum is 10; 12 is recommended. Cost <= 8 finishes in tens of milliseconds, making offline cracking cheap."
    detection:
      pattern: bcrypt(js)?\.(hash|hashSync)\s*\(\s*[^,]+,\s*[0-8]\s*[,)]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: raise bcrypt cost factor to 12 (or 10 minimum). Migrate existing hashes on next login.'"
      verifyCommand: "! grep -rE 'bcrypt(js)?\\.(hash|hashSync)\\s*\\(\\s*[^,]+,\\s*[0-8]\\s*[,)]' src/"
  - ruleId: fixed-iv
    label: createCipheriv called with literal / Buffer.from(string) IV
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "A constant IV with the same key produces identical ciphertext for identical plaintext, leaking structure and enabling chosen-plaintext attacks (CBC/CTR). The IV must be a fresh `crypto.randomBytes(blockSize)` per encryption and stored alongside the ciphertext."
    detection:
      pattern: createCipheriv\s*\([^,]+,[^,]+,\s*(Buffer\.from\s*\(\s*['"`][^'"`]+['"`]|['"`][^'"`]+['"`])
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: generate IV with crypto.randomBytes(16) per encryption; store IV alongside ciphertext (e.g. iv:ct hex)'"
      verifyCommand: "! grep -rE 'createCipheriv\\s*\\([^,]+,[^,]+,\\s*(Buffer\\.from\\s*\\(\\s*[\\`'\\''\"][^\\`'\\''\"]+|[\\`'\\''\"][^\\`'\\''\"]+[\\`'\\''\"])' src/"
  - ruleId: jwt-none-alg
    label: jwt.sign / jwt.verify accepts algorithm 'none'
    severity: P1
    mechanism: static-grep
    source: crypto-misuse/v2
    rationale: "`algorithm: 'none'` produces a JWT with an empty signature. Any token-issuing or token-verifying call that allows 'none' lets an attacker forge tokens by setting the alg header. Pin algorithms to a specific value like 'HS256' or 'RS256'."
    detection:
      pattern: jwt\.(sign|verify)\s*\([\s\S]{0,200}algorithms?\s*:\s*(\[\s*)?['"`]none['"`]
      filePattern: src/**/*.{ts,tsx,js,jsx,mjs,cjs}
    fix:
      kind: template
      command: "echo 'manual remediation: pin algorithms: [\"HS256\"] (or RS256); reject any token whose alg header is not in the allow-list'"
      verifyCommand: "! grep -rE 'jwt\\.(sign|verify)\\s*\\([\\s\\S]{0,200}algorithms?\\s*:\\s*(\\[\\s*)?[\\`'\\''\"]none[\\`'\\''\"]' src/"
---

# Crypto misuse check

Eight high-impact crypto footguns that vibe-coded apps repeatedly ship.

1. **`math-random-for-crypto`** — predictable PRNG used for a value that
   gates access. Use `crypto.randomBytes` / `crypto.randomUUID`.
2. **`crypto-createcipher-deprecated`** — `createCipher` derives a weak key
   and uses a constant IV. Replace with `createCipheriv` + random IV.
3. **`md5-for-password`** / **`sha1-for-password`** — fast, GPU-cheap
   hashes used near a password/token variable. Use argon2id / bcrypt.
4. **`pbkdf2-low-iterations`** — iteration count below 100k. Raise to
   ≥600k (SHA-256) per OWASP 2023.
5. **`bcrypt-low-rounds`** — cost factor ≤ 8 makes offline cracking
   trivial. Raise to 12 (10 minimum).
6. **`fixed-iv`** — literal IV passed to `createCipheriv`. Generate a
   fresh `randomBytes(16)` per encryption.
7. **`jwt-none-alg`** — token verifier accepts `alg: 'none'`. Pin the
   algorithm allow-list to `['HS256']` or `['RS256']`.

## Remediation patterns

```ts
// Random tokens
import { randomBytes, randomUUID } from 'node:crypto';
const sessionId = randomBytes(32).toString('hex');
const requestId = randomUUID();
```

```ts
// AES-256-GCM with fresh IV
import { createCipheriv, randomBytes } from 'node:crypto';
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
// store: iv (12) + tag (16) + ct
```

```ts
// Password hashing (argon2id preferred, bcrypt acceptable)
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);
```

```ts
// JWT with pinned algorithm
import jwt from 'jsonwebtoken';
const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
```

After applying fixes, re-run `zerou audit` and confirm zero findings remain.
