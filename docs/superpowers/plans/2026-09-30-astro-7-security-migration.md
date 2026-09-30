# Astro 7 Security Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining dependency vulnerabilities by moving the application to the supported Astro 7 and Vercel adapter 11 stack without changing product behaviour.

**Architecture:** Update Astro, its Vercel deployment adapter, and direct Astro tooling as a compatible group through pnpm. Retain the existing SSR/Vercel configuration and make only compatibility repairs proven by the compiler, test runner, build, or local server. Use the existing unit tests, type validation, build, audit, and browser test as regression boundaries.

**Tech Stack:** Astro 7, Vite 8 (transitive), `@astrojs/vercel` 11, pnpm 12, TypeScript 5, Vitest 4, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-30-astro-7-security-migration-design.md`

## Global Constraints

- Upgrade `astro` to 7.x and `@astrojs/vercel` to 11.x as a compatible pair.
- Keep TypeScript on 5.x and Vitest on 4.x.
- Do not upgrade Vercel Analytics or Speed Insights to a new major version.
- Preserve the Neon, PayPal, SSR, and Vercel deployment behaviour.
- Do not commit secrets or real environment values.
- Astro 7 requires Node.js 22.12.0 or newer; target Node.js 24.x explicitly for local and Vercel runtime selection.
- Do not hide known vulnerabilities with broad pnpm overrides.
- Do not merge the pull request automatically.

## Review Focus

- A clean frozen install must select exactly the audited lockfile versions; verify it after dependency changes in Task 1.
- Server-side rendering must still instantiate database configuration from Astro’s environment; run the existing database unit test in Task 2.
- Vercel SSR adapter configuration must remain accepted by Astro 7; validate it with `astro check` and the production build in Task 2.
- The home page must render when supplied with local environment configuration and no secret may enter Git; start and request the local server in Task 3.
- The pre-existing donation-flow E2E failure must not be misrepresented as a migration regression; compare its command output with `main` in Task 3.

---

## File structure

- Modify: `package.json` — declare Astro 7 / Vercel adapter 11 compatible direct dependencies and Node runtime floor.
- Modify: `pnpm-lock.yaml` — resolved direct and transitive dependency graph after pnpm’s supported upgrade.
- Modify only if validation proves necessary: `astro.config.mjs`, `vitest.config.ts`, and application files reported by Astro/Vite diagnostics.
- Create: `docs/superpowers/specs/2026-09-30-astro-7-security-migration-design.md` — committed architecture specification.
- Create: `docs/superpowers/plans/2026-09-30-astro-7-security-migration.md` — this executable plan.

### Task 1: Upgrade the framework dependency graph

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `package.json` direct dependency constraints and pnpm workspace configuration.
- Produces: a reproducible pnpm lockfile containing Astro 7, Vercel adapter 11, and patched transitive dependencies.

- [ ] **Step 1: Record the installed runtime and baseline audit**

Run:
```bash
node --version
pnpm --version
pnpm audit
```

Expected: Node is `v24.x`; pnpm is available; audit records the pre-upgrade vulnerability count.

- [ ] **Step 2: Upgrade the Astro stack as a peer-compatible group**

Run:
```bash
pnpm up astro@^7 @astrojs/vercel@^11 @astrojs/check@latest
```

Expected: pnpm changes the direct Astro packages and refreshes `pnpm-lock.yaml` without peer-resolution errors.

- [ ] **Step 3: Declare the supported Node runtime**

Edit `package.json` to add this top-level field if it is absent:

```json
"engines": {
  "node": "24.x"
}
```

Expected: local and hosted installs have an explicit runtime floor that matches Astro 7.

- [ ] **Step 4: Reinstall from the generated lockfile**

Run:
```bash
pnpm install --frozen-lockfile
```

Expected: exit code 0 and no changes to `pnpm-lock.yaml`.

- [ ] **Step 5: Inspect the dependency diff and audit**

Run:
```bash
git diff --check
git diff -- package.json pnpm-lock.yaml
pnpm audit
```

Expected: no whitespace errors; direct changes are limited to the Astro compatibility group and Node floor; audit has no vulnerability findings, or reports only an exact documented package path that Astro 7 cannot resolve.

- [ ] **Step 6: Commit the dependency graph**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: upgrade Astro security dependencies"
```

### Task 2: Repair proven compatibility issues and protect application behaviour

**Files:**
- Modify only if diagnostics require it: `astro.config.mjs`
- Modify only if diagnostics require it: `vitest.config.ts`
- Modify only if diagnostics require it: affected `src/**/*.ts` or `src/**/*.astro`
- Test: `src/tests/lib/db.test.ts`
- Test: `src/tests/api/create-order.test.ts`
- Test: `src/tests/api/capture-order.test.ts`

**Interfaces:**
- Consumes: Astro 7’s configuration API and the dependency graph from Task 1.
- Produces: an Astro 7-compatible SSR build while retaining `output: 'server'`, `vercel({})`, and the existing Astro environment-variable interface.

- [ ] **Step 1: Run the focused database configuration regression test**

Run:
```bash
pnpm exec vitest run src/tests/lib/db.test.ts
```

Expected: the test passes, proving that a missing `POSTGRES_URL` remains a clear server-side error and the mocked Neon client is not instantiated.

- [ ] **Step 2: Run static validation and capture all diagnostics**

Run:
```bash
pnpm exec astro check
```

Expected: Astro 7 accepts the adapter and project configuration. The current `main` branch has one known `vitest.config.ts` type diagnostic (`test` is not part of `UserConfig`); compare any remaining diagnostic with `git show main:vitest.config.ts` and record it as baseline only when it is identical. If diagnostics identify a new API incompatibility, change only the reported configuration or source API and rerun this command; preserve the current SSR and environment behaviour.

- [ ] **Step 3: Run the complete unit suite after any compatibility repair**

Run:
```bash
pnpm exec vitest run
```

Expected: every unit test passes. If a compatibility repair changes a testable interface, add a focused Vitest test that fails before the repair and passes after it, then rerun this suite.

- [ ] **Step 4: Build the production artifact**

Run:
```bash
pnpm run build
```

Expected: exit code 0 with Vercel SSR output generated successfully.

- [ ] **Step 5: Commit only necessary compatibility repairs**

```bash
git add astro.config.mjs vitest.config.ts src
git diff --cached --check
git commit -m "fix: adapt application to Astro 7"
```

Expected: skip this commit when no compatibility files changed. Do not stage unrelated files.

### Task 3: Validate runtime behaviour, classify the E2E baseline, and update the pull request

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-astro-7-security-migration-design.md`
- Modify: `docs/superpowers/plans/2026-09-30-astro-7-security-migration.md`

**Interfaces:**
- Consumes: the upgraded and built application from Tasks 1–2 plus developer-provided local environment values.
- Produces: reproducible verification evidence, a documented distinction between migration results and baseline E2E behaviour, and an updated existing pull request.

- [ ] **Step 1: Verify the local SSR page without printing credentials**

Run:
```bash
pnpm dev --port 4322
```

In a separate terminal, with the local `.env` already loaded by Astro:

```bash
curl --fail --silent --show-error http://localhost:4322/ > /tmp/wish-list-reco-home.html
rg -q '<html' /tmp/wish-list-reco-home.html
```

Expected: the request returns HTML successfully. Stop the development server after the check; never display or commit `.env`.

- [ ] **Step 2: Compare the browser test with the baseline branch**

Run on the migration branch:
```bash
pnpm exec playwright test
```

Then inspect the known baseline test without altering branches:

```bash
git show main:tests/e2e/donation-flow.spec.ts
```

Expected: record the result. If the failure remains the existing post-click URL staying at `/` instead of containing `/item/`, label it pre-existing; otherwise investigate it as a migration regression before continuing.

- [ ] **Step 3: Repeat release validation**

Run:
```bash
pnpm install --frozen-lockfile
pnpm audit
pnpm exec astro check
pnpm exec vitest run
pnpm run build
git status --short
```

Expected: frozen install, audit, type validation, unit tests, and build pass; only the spec and plan documentation may remain uncommitted before the documentation commit.

- [ ] **Step 4: Commit the design artifacts and push the branch**

```bash
git add docs/superpowers/specs/2026-09-30-astro-7-security-migration-design.md docs/superpowers/plans/2026-09-30-astro-7-security-migration.md
git commit -m "docs: plan Astro 7 security migration"
git push origin chore/dependency-health-2026-09
```

Expected: the remote branch backing the existing pull request contains the migration commits and verification documentation.

- [ ] **Step 5: Update the existing pull request**

Run:
```bash
gh pr edit 2 --repo glaboryp/wish-list-reco --body-file /tmp/wish-list-reco-pr-body.md
```

Write `/tmp/wish-list-reco-pr-body.md` with the exact Astro/adapter versions, audit outcome, passing commands, the E2E baseline result, and a statement that TypeScript, Vitest, Analytics, and Speed Insights major upgrades were intentionally excluded.

Expected: [PR #2](https://github.com/glaboryp/wish-list-reco/pull/2) accurately reports the final migration and validation evidence without merging it.
