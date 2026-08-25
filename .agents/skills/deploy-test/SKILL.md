---
name: deploy-test
description: tuiweather has no separate test environment — a stub that redirects to /deploy-prod's gate rather than letting an ungated deploy reach production. Usage `/deploy-test`.
---
<!-- cycle:rendered template=skills/deploy-test.md.tmpl hash=c9adc007caad — managed by the-cycle; edit the template, not this file -->

# /deploy-test — not applicable here

**`deploy.test` is not set in `.cycle/config.jsonc`.** tuiweather has no lower-stakes target to
preview a branch or a dirty tree on, so there is nothing for this skill to deploy to.

**Do not substitute the production deploy.** The test flow is deliberately ungated — *no gate, no
explicit go* — because a test box is cheap to get wrong. Pointing that ceremony at the only
environment there is would turn a low-ceremony preview into an unreviewed production release.
That inversion is the exact mistake this stub exists to prevent.

# Deploy

Environments: the **npm registry** (prod) and **GitHub Releases** (artifacts). There is no staging.

Sequence (maintainer-only, from clean synced `main`):

1. `./scripts/release.sh <major|minor|patch>` — verifies the tree, runs release gates, bumps `package.json`, prepends a changelog section generated from conventional commits, tags `vX.Y.Z`, atomically pushes commit + tag.
2. The `release` workflow prepares exact artifacts and publishes to npm through OIDC trusted publishing (no long-lived token involved).
3. Binaries + checksums are attached to the GitHub release.

Verification: `gh release view vX.Y.Z`, `npm view tuiweather version` shows the new version. Deep details in [docs/RELEASING.md](../../docs/RELEASING.md).

Rollback: npm's unpublish window is short — treat publish as irreversible. Fix forward with a patch release; never re-tag a version.

Agents decline `/deploy-prod` here and hand off to Brandon.

## If you were asked to preview something

1. **Say plainly there is no test environment here** — don't improvise one, and don't reach for
   the production deploy command.
2. **If it genuinely needs to ship,** hand off to `/deploy-prod`, which carries the explicit-go
   gate a real deploy requires.
3. **If it only needs looking at,** run it locally instead.
