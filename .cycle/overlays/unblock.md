# Unblock — hands-on verification

TUI changes verify in a live terminal, not just in captured frames.

Card format:

```
Claim: <what should now work>
Widths exercised: <lg/md/sm/xs actually resized through>
Keyboard path: <keys driven, e.g. /search → type → enter → esc>
Theme: <day / night / both, if theme touched>
Verdict: Works | Doesn't work | Not now
```

A change only qualifies for "Works" when:

- `bun run dev` was actually run;
- the terminal was resized through all four tiers — lg ≥96, md 68–95, sm 48–67, xs 32–47 — with no crash or overflow, and clamp+ellipsis below 32;
- the keyboard path was driven end to end (search open → navigate → select → escape), not mouse-assisted;
- both themes checked if anything visual changed.

Char-frame captures (`test/ui/` helpers) prove structure, not color or alignment taste — they never substitute for this lane.
"Not now" stays first-class: parked with what you saw, no shame in it.
