#!/usr/bin/env bash
set -euo pipefail

TAG="${TAG_NAME:?TAG_NAME is required}"
VERSION="${TAG#v}"
REPO="brndnsh-labs/tuiweather"
TAP_REPO="brndnsh-labs/homebrew-tap"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

if [[ -z "${TAP_TOKEN:-}" ]]; then
  echo "HOMEBREW_TAP_TOKEN secret is not configured; skipping tap update" >&2
  exit 0
fi

declare -A SHA
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  file="tuiweather-${target}.tar.gz"
  SHA["${target}"]=$(curl -fsSL "${BASE_URL}/${file}.sha256" | awk '{print $1}')
done

cat > tuiweather.rb.next <<EOF
class Tuiweather < Formula
  desc "Keyboard-driven terminal weather app powered by Open-Meteo"
  homepage "https://github.com/${REPO}"
  version "${VERSION}"
  license "MIT"

  on_macos do
    if Hardware::CPU.intel?
      url "${BASE_URL}/tuiweather-darwin-x64.tar.gz"
      sha256 "${SHA[darwin-x64]}"
    else
      url "${BASE_URL}/tuiweather-darwin-arm64.tar.gz"
      sha256 "${SHA[darwin-arm64]}"
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "${BASE_URL}/tuiweather-linux-x64.tar.gz"
      sha256 "${SHA[linux-x64]}"
    else
      url "${BASE_URL}/tuiweather-linux-arm64.tar.gz"
      sha256 "${SHA[linux-arm64]}"
    end
  end

  def install
    bin.install "tuiweather"
  end
end
EOF

workdir=$(mktemp -d)
trap 'rm -rf "${workdir}"' EXIT
git clone --depth 1 "https://x-access-token:${TAP_TOKEN}@github.com/${TAP_REPO}.git" "${workdir}/tap"
mkdir -p "${workdir}/tap/Formula"

if [[ -f "${workdir}/tap/Formula/tuiweather.rb" ]] && diff -q tuiweather.rb.next "${workdir}/tap/Formula/tuiweather.rb" >/dev/null; then
  echo "tap formula unchanged for ${TAG}; nothing to push"
  exit 0
fi
mv tuiweather.rb.next "${workdir}/tap/Formula/tuiweather.rb"

cd "${workdir}/tap"
git config user.name "tuiweather-release-bot"
git config user.email "noreply@github.com"
git add Formula/tuiweather.rb
git commit -m "tuiweather ${VERSION}"
git push origin HEAD
