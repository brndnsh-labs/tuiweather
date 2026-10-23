---
name: dep-update
description: Routine dependency hygiene for tuiweather — survey what's outdated, bump it in risk-sized steps, run the gates, and land one dependency commit. Tells a stale test expectation from a real regression. Never force-fixes advisories; never auto-pushes. Usage `/dep-update` (or `/dep-update <package>`).
---
<!-- cycle:rendered template=skills/dep-update.md.tmpl hash=c17b5df5a1ea — managed by the-cycle; edit the template, not this file -->

# /dep-update — dependency hygiene

**Shared rules in `.agents/skills/DOCTRINE.md` — read it if not already in context** (§4 gates, §6
branch and commit policy).

# Dep update landmines

- **@opentui/react + @opentui/core** (0.5.x) — re-verify every quirk in AGENTS.md after upgrading: escape needs `pressEscape()` plus a tick, scrollbox wants `viewportCulling={false}` under char-frame capture, scrollbar hidden via `scrollbarOptions.visible:false`. Expect wholesale `.snap` shifts; the UI tests are the canary. The native `@opentui/core-*` platform packages must all land on the same version — a lockstep miss is a silent ABI skew, so check the install output, not just the exit code. Bump `react` in the same change *only if* the new `@opentui/react` peer range excludes the version we already have (0.5.12 peers `react >=19.2.0`, so 19.3.0 was already fine).
- **react** — pinned against @opentui/react's peer range; never upgrade alone, and don't upgrade it just because opentui moved.
- **zustand** v5 — `src/app/store.ts` uses the `create<T>()(fn)` dual form (React hook selector-style *and* imperative `getState()`/`setState()` via prop). API drift breaks both usage styles at once; check both call sites after updating.
- **bun** — the version lives *only* in CI: `bun-version: "1.3.13"` in both the `verify` and `windows-smoke` jobs of `.github/workflows/ci.yml`. `package.json` `engines` constrains Node (`>=20`), not bun — there is no bun entry to raise. Bump the two workflow pins together and confirm the `bun.lock` format survives.
- **typescript** (^7) / **zod** (v4) — strictness or schema-behavior changes surface as typecheck failures or config-validation changes; run all gates and watch `superRefine`/`prefault` semantics in `src/lib/config/schema.ts`. `zod` is exact-pinned (no caret) on purpose, so a bump is a `package.json` edit, not a range widening.

1. **Survey:** `bun outdated` and `bun audit`. Patch/minor bumps of leaf packages are routine; a
   major, a framework, or anything with a native build step is not — take those **one at a time**,
   so a failure can be attributed.
2. **Branch** (§6), then update: `bun update` for the routine set; name packages for the rest.
   Read the install output, not just the exit code — a silently skipped patch or a native rebuild
   against the wrong ABI exits 0 and breaks at runtime.
3. **Advisories:** fix each on its own terms. An advisory only a major bump clears is a separate change —
   surface the tradeoff.
4. **Gates (§4).** A red gate is one of two opposite things: a **stale expectation** (the dependency
   legitimately changed its output — update the test and say so in the commit) or a **real
   regression** (pin back and file it; don't bless it). Can't tell which → surface it.
5. **Commit once** (§6) with explicit paths: `package.json`, plus any test a stale
   expectation required. A formatter bump that reformats untouched files gets its own commit.
6. **Report** what moved, what's held back and why, and gate status. **Don't push** — a dependency
   bump lands on Brandon's schedule.

**Lockfile drift with nothing outdated** (`bun install` rewrote `bun.lock` with no version change) is a legitimate
standalone commit — say so; don't bury it in another diff. Nothing outdated → say so and stop.
