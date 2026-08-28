#!/usr/bin/env bash
# Generates one CHANGELOG.md section from conventional-commit subjects in a git range.
# usage: scripts/changelog-notes.sh <tag> <date> [<range>]   (range defaults to HEAD)
# Writes markdown to stdout and "features=N fixes=N other=N" to stderr.
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <tag> <date> [<range>]" >&2
  exit 2
fi
TAG="$1"
DATE="$2"
RANGE="${3:-HEAD}"

SUBJECTS=$(mktemp)
trap 'rm -f "${SUBJECTS}"' EXIT
git log --format='%s%x09%h' "${RANGE}" >"${SUBJECTS}"

FEATURES=""
FIXES=""
OTHER=""
N_FEATURES=0
N_FIXES=0
N_OTHER=0

while IFS=$'\t' read -r SUBJECT HASH || [[ -n "${SUBJECT}" ]]; do
  [[ -n "${SUBJECT}" ]] || continue
  LINE="- ${SUBJECT} (${HASH})"
  case "${SUBJECT}" in
    feat:* | feat\(* | feat!*)
      FEATURES+="${LINE}"$'\n'
      N_FEATURES=$((N_FEATURES + 1))
      ;;
    fix:* | fix\(* | fix!*)
      FIXES+="${LINE}"$'\n'
      N_FIXES=$((N_FIXES + 1))
      ;;
    *)
      OTHER+="${LINE}"$'\n'
      N_OTHER=$((N_OTHER + 1))
      ;;
  esac
done <"${SUBJECTS}"

{
  echo "## ${TAG} (${DATE})"
  echo ""
  if [[ ${N_FEATURES} -gt 0 ]]; then
    echo "### Features"
    printf '%s' "${FEATURES}"
    echo ""
  fi
  if [[ ${N_FIXES} -gt 0 ]]; then
    echo "### Fixes"
    printf '%s' "${FIXES}"
    echo ""
  fi
  if [[ ${N_OTHER} -gt 0 ]]; then
    echo "### Other"
    printf '%s' "${OTHER}"
    echo ""
  fi
}

echo "changelog: features=${N_FEATURES} fixes=${N_FIXES} other=${N_OTHER}" >&2

if [[ ${N_FEATURES} -eq 0 && ${N_FIXES} -eq 0 ]]; then
  MATCHING=$(git log --format='%s' "${RANGE}" | { grep -cE '^(feat|fix)(:|\(|!)' || true; })
  if [[ ${MATCHING} -gt 0 ]]; then
    echo "error: ${MATCHING} feat/fix subjects detected by prefix but zero were classified" >&2
    exit 1
  fi
fi
