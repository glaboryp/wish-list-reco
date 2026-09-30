# Astro 7 Security Migration

## Objective

Eliminate the 15 dependency vulnerabilities that remain on the dependency-health branch by migrating Astro and its Vercel adapter to supported, patched major versions. Keep the application behaviour, Neon database integration, and current deployment model unchanged.

## Scope

- Upgrade `astro` from 5.x to a compatible 7.x release that includes the security fixes.
- Upgrade `@astrojs/vercel` from 9.x to its compatible 11.x release.
- Upgrade any directly related Astro tooling only when the new framework version requires it, including `@astrojs/check`.
- Regenerate `pnpm-lock.yaml` with pnpm and keep the existing `packageManager` declaration.
- Declare Node.js 24.x as the project and Vercel runtime.
- Update Astro or Vercel configuration and application code only when compatibility checks demonstrate that the migration requires it.
- Update the existing dependency-health PR with the final audit and validation evidence.

## Explicit exclusions

- Do not upgrade TypeScript from 5.x to 7.x.
- Do not upgrade Vitest from 4.x to 5.x.
- Do not upgrade Vercel Analytics or Speed Insights to a new major version.
- Do not change the data model, Neon connection behaviour, PayPal flow, deployment settings, or application features.
- Do not automatically merge the pull request.

## Technical design

The migration updates Astro and `@astrojs/vercel` as a matched framework-and-adapter pair. The package manifest remains the single source of direct dependency constraints, and pnpm regenerates the lockfile so transitive patched versions are selected consistently.

Existing `astro.config.mjs` continues to use server output and the Vercel adapter. It will only be changed if Astro 7 or adapter 11 rejects its current API. The Vitest configuration will remain on Vitest 4; any type or configuration incompatibility is addressed at the smallest compatible boundary rather than by expanding the upgrade scope.

The prior database environment-variable correction stays unchanged. Runtime checks use locally supplied environment configuration and never commit credentials.

## Validation and acceptance criteria

1. `pnpm install --frozen-lockfile` succeeds after the lockfile is committed.
2. `pnpm audit` reports no remaining known package vulnerabilities, or any unresolved advisory is identified by package path and documented in the PR.
3. `pnpm exec astro check` passes except for a failure proven to exist unchanged on `main`; such a baseline issue is reported separately.
4. `pnpm exec vitest run` passes.
5. `pnpm run build` passes.
6. `pnpm exec playwright test` is run. The known donation-flow failure is compared with `main` and treated as pre-existing only if its symptom remains identical.
7. The pull-request preview or local server renders the home page with a valid local database environment, when credentials and network access are available.
8. The final repository status is clean after a conventional commit and the existing PR is updated.

## Error handling

If the upgrade requires an excluded major dependency or introduces a material behavioural change, stop that portion of the migration and report the exact compatibility constraint. Do not mask dependency advisories with broad overrides when a supported framework upgrade is the selected remediation.
