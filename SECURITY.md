# Security Policy

## Supported versions

tuiweather is pre-release; only the latest commit on `main` is supported. Security fixes land in the next release and are not backported.

## Reporting a vulnerability

Please do not open public issues for suspected vulnerabilities. Use GitHub's private vulnerability reporting on this repository (Security tab -> Report a vulnerability), which notifies maintainers without disclosing details publicly.

Include what you can of: affected component, reproduction steps or proof of concept, impact assessment, and any suggested mitigation.

You can expect an initial response within 7 days. We will keep you informed of progress and credit you in the release notes if desired.

## Scope

- **In scope:** the TUI and CLI (`src/`), config parsing/loading, the Open-Meteo client, cache handling, and anything executed from the bundled binaries.
- **Out of scope:** the Open-Meteo service itself — report upstream concerns via [open-meteo.com](https://open-meteo.com).

## Design notes

- tuiweather stores no API keys today; Open-Meteo's free endpoints need none. If key-bearing providers are added, keys will resolve env var first, then config file, and will never be logged or embedded in error messages.
- Config writes are atomic (temp file plus rename) to avoid torn state.
- The one-line mode writes only to stdout and reads only local cached/config data plus the configured provider endpoint.
