# GASMAN — Claude Code instructions

## Branch rules (strict)

| Branch    | Purpose                        | Direct commits |
|-----------|-------------------------------|----------------|
| `develop` | All active development        | ✅ Yes          |
| `main`    | Production — mirrors develop  | ❌ Never        |

**All work goes to `develop` first. `main` is updated only by fast-forward merge from `develop`.**

### Promote develop → main
```bash
git checkout main
git merge --ff-only origin/develop
git push origin main
git checkout develop
```

If `--ff-only` fails, stop — something is out of sync. Do not force.

## Project layout

- `frontend/` — Vite + React SPA
- `frontend/src/` — React components, pages, helpers
- Build: `cd frontend && node_modules/.bin/vite build`
- GA4 helper: `frontend/src/analytics.js`

## Commit style

Plain English, present tense first line, 72 chars max.
Append `https://claude.ai/code/session_01TKZ5tGRM2PBXSzwxCjFZjo` at the end.
