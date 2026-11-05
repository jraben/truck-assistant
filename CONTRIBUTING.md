# Contributing

Thanks for looking. This started as one owner's dash for his own Slate truck
and is meant to be useful to other Slate owners. It is **not affiliated with
Slate Auto**; please don't present it as official.

## Ground rules

- **Read-only on the truck.** Nothing here writes to the Slate's own systems.
  Relays only switch circuits the owner added. A change that writes to the
  truck's CAN bus won't be merged.
- **Unknown is null, never a guess.** The UI shows "—" with the reason.
  Don't invent Slate numbers (intervals, pack size, efficiency): leave them
  empty or clearly marked as a placeholder to check.
- **Secrets stay on the truck.** API keys and tokens are entered on
  `/settings` and stored in the data dir, never in the repo, `.env`, logs or
  MQTT. See `docs/security.md`.
- **The contract comes first.** `docs/contract.md` is the interface between
  the brain, the UI, the truck box and Home Assistant. Change it in the same
  pull request as the code, under the right heading.
- **Phoenix heat.** Anything printed for the cab is ASA or PETG-CF.

## Setup

```sh
npm install
npm run dev          # brain (SIM=1) on :8080 + Vite on :5173
npm run typecheck
npm test
npm run build
```

Node 24 or newer (the brain uses `node:sqlite` and runs TypeScript directly in
dev). No MQTT broker, GPS or Home Assistant is needed on a desk.

## Pull requests

- One topic per PR; keep unrelated reformatting out.
- Add or update tests for logic (`brain/test`, `ui/test`). Pure functions are
  preferred so they can be tested without hardware.
- New code goes in new modules where it can; keep edits to shared files
  (`App.tsx`, `server.ts`, `types.ts`, `settings.ts`) small.
- Shell scripts and Pi config files stay LF (`.gitattributes`) and must be
  safe to run twice.
- Say how you tested it: on a desk with `SIM=1`, on a bench Pi, or in a truck.

## Renaming

The public name is undecided. It lives in one constant,
`brain/src/project.ts` (`PROJECT_NAME`); change it there.

## License

By contributing you agree your contribution is released under the MIT
license in `LICENSE`.
