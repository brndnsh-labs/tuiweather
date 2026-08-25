# Merge guard

Merging to `main` ships nothing. There is no continuous deployment.

1. Releases are cut manually by Brandon from clean synced `main`: `./scripts/release.sh <major|minor|patch>`.
2. The script runs the release gates, bumps `package.json`, prepends a changelog section generated from conventional commits, tags `vX.Y.Z`, and atomically pushes the release commit and tag.
3. The `release` workflow then prepares exact artifacts, publishes to npm via OIDC trusted publishing, and attaches standalone binaries + checksums to the GitHub release.

Agents never run `release.sh`, never push tags, never bump versions — see the release-path brake in §5. Deep reference: [docs/RELEASING.md](../../docs/RELEASING.md).
