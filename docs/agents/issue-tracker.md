# Issue tracker: GitHub Issues

Issues and PRDs for this repo live in **GitHub Issues** on `rayson-x/maxpower` (private). The old local Markdown tracker under `.scratch/` is retired (2026-08-16); historical files remain on disk locally but are not version-controlled.

## Conventions

- One issue per unit of work; link PRD/spec docs in `docs/design/` or `docs/specs/` from the issue body.
- Triage state uses GitHub labels (see `triage-labels.md`).
- Use `gh issue` with the repo-local token: `set -a; source .env.local; set +a` first so commands run as the personal account (rayson-x), not the enterprise account.

When a skill says to publish to the issue tracker, create the corresponding GitHub issue.
