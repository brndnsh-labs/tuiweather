# Dep update landmines

- **@opentui/react + @opentui/core** (0.5.x) — re-verify every quirk in AGENTS.md after upgrading: escape needs `pressEscape()` plus a tick, scrollbox wants `viewportCulling={false}` under char-frame capture, scrollbar hidden via `scrollbarOptions.visible:false`, two-tone ascii-font colors, no degree glyph in the tiny font. Expect wholesale `.snap` shifts; the UI tests are the canary. Upgrade `react` in the same change.
- **react** — pinned against @opentui/react's expectations; never upgrade alone.
- **zustand** v5 — `src/app/store.ts` uses the `create<T>()(fn)` dual form (React hook selector-style *and* imperative `getState()`/`setState()` via prop). API drift breaks both usage styles at once; check both call sites after updating.
- **bun** — `engines >= 1.3.0` in package.json while CI pins `bun-version: 1.3.13` (.github/workflows/ci.yml). Raise both together; confirm `bun.lock` format survives.
- **typescript** (^7) / **zod** (v4) — strictness or schema-behavior changes surface as typecheck failures or config-validation changes; run all gates and watch `superRefine`/`prefault` semantics in `src/lib/config/schema.ts`.
