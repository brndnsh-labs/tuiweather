#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: ./scripts/release.sh <major|minor|patch>" >&2
  exit 1
}

[[ $# -eq 1 ]] || usage
BUMP="$1"
case "${BUMP}" in
  major | minor | patch) ;;
  *) usage ;;
esac

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${BRANCH}" != "main" ]]; then
  echo "releases are cut from main (currently on ${BRANCH})" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is not clean" >&2
  exit 1
fi
git fetch origin main --tags --quiet
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "main is not in sync with origin/main" >&2
  exit 1
fi

bun run typecheck
bun run lint
bun run test
bun run build
npm pack --dry-run --json >/dev/null

CURRENT=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("package.json","utf8")).version)')
IFS='.' read -r MAJOR MINOR PATCH <<<"${CURRENT}"
case "${BUMP}" in
  major) NEXT="$((MAJOR + 1)).0.0" ;;
  minor) NEXT="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) NEXT="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
esac
TAG="v${NEXT}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "tag ${TAG} already exists" >&2
  exit 1
fi

echo "releasing ${CURRENT} -> ${NEXT}"

bun -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.version = process.argv[1];
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "${NEXT}"

CHANGELOG="CHANGELOG.md"
if [[ ! -f "${CHANGELOG}" ]]; then
  printf '# Changelog\n\nAll notable changes to this project are documented here.\n\n' > "${CHANGELOG}"
fi

PREV_TAG=$(git describe --abbrev=0 --tags 2>/dev/null || true)
RANGE="${PREV_TAG:+${PREV_TAG}..}HEAD"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NOTES_FILE=$(mktemp)
trap 'rm -f "${NOTES_FILE}"' EXIT
"${SCRIPT_DIR}/changelog-notes.sh" "${TAG}" "$(date +%Y-%m-%d)" "${RANGE}" >"${NOTES_FILE}"

{
  awk '/^## /{exit} {print}' "${CHANGELOG}"
  cat "${NOTES_FILE}"
  awk '/^## /{f=1} f' "${CHANGELOG}"
} > "${CHANGELOG}.next"
mv "${CHANGELOG}.next" "${CHANGELOG}"

git add package.json CHANGELOG.md
git commit -q -m "chore(release): ${TAG}"
git tag "${TAG}"
git push --atomic origin main "${TAG}"

echo ""
echo "tagged ${TAG}; the release workflow will build binaries and publish to npm."
echo "watch: gh run watch \$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')"
