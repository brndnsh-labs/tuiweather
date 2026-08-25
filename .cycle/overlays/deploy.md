# Deploy

Environments: the **npm registry** (prod) and **GitHub Releases** (artifacts). There is no staging.

Sequence (maintainer-only, from clean synced `main`):

1. `./scripts/release.sh <major|minor|patch>` — verifies the tree, runs release gates, bumps `package.json`, prepends a changelog section generated from conventional commits, tags `vX.Y.Z`, atomically pushes commit + tag.
2. The `release` workflow prepares exact artifacts and publishes to npm through OIDC trusted publishing (no long-lived token involved).
3. Binaries + checksums are attached to the GitHub release.

Verification: `gh release view vX.Y.Z`, `npm view tuiweather version` shows the new version. Deep details in [docs/RELEASING.md](../../docs/RELEASING.md).

Rollback: npm's unpublish window is short — treat publish as irreversible. Fix forward with a patch release; never re-tag a version.

Agents decline `/deploy-prod` here and hand off to Brandon.
