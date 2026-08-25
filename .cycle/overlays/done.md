# Done — post-landing checklist

- User-facing surface changed (config keys, keymap, CLI flags, breakpoints)? → README / config docs updated in the same PR.
- `.snap` diffs present? → justified line by line in the PR body.
- Squashed commit title follows conventional commits (`feat:`, `fix:`, `chore:`) — release.sh turns merged titles into changelog entries verbatim.

Nothing else manual: version bump and changelog assembly happen at release time, maintainer-only.
