# UI design skills

Five project skills Claude Code loads when a task needs them. Run them in this order on any UI work:

| # | Skill | Job | Source (commit) |
|---|-------|-----|-----------------|
| 1 | `ui-ux-pro-max` | Builds the design system: style, palette, font pairing, spacing, anti-patterns | nextlevelbuilder/ui-ux-pro-max-skill (6ec2bb5), MIT |
| 2 | `frontend-design` | Gives it a bold, non-generic direction inside that system | anthropics/skills (e4bb5d9) |
| 3 | `impeccable` | Critique + polish commands (`init` first, then critique, typeset, layout, polish…) | pbakaus/impeccable (b49177d), Apache-2.0 |
| 4 | `web-design-guidelines` | Accessibility / UX audit against 100+ rules, `file:line` findings | vercel-labs/agent-skills (5a37a63) |
| 5 | `webapp-testing` | Runs the app in a real browser, screenshots mobile + desktop, fixes breaks | anthropics/skills (e4bb5d9) |

## Stack prompt

> Use the UI skills in order: ui-ux-pro-max to set the design system, frontend-design for direction, impeccable to critique and polish, web-design-guidelines to audit and fix, then webapp-testing to screenshot every changed page at phone and desktop size and fix what breaks.

For a quick pass on one page, steps 3–5 alone (critique → audit → screenshot test) catch most problems.

## Notes

- `impeccable` downloads its scanning engine from GitHub releases on first use; the download is checked against `impeccable/scripts/engine-checksums.txt`.
- `webapp-testing` needs Python + Playwright (`pip install playwright && playwright install chromium`).
- Updating: re-copy the skill folder from its source repo and bump the commit in this table.
