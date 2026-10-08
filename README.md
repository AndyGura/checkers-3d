# Checkers 3D

A 3D browser frontend for the live **Checkers** game on the Internet
Computer (<https://eag45-ayaaa-aaaac-qhela-cai.icp.net>), built on
[duel-game-core](https://github.com/research-ag/duel-core).

This project has **no backend of its own**. It talks to the game's
existing backend canister, `ejfxb-wqaaa-aaaac-qhekq-cai`, so players here
and players on the original page sit at the same tables.

- Full 3D table (three.js): orbit with drag, zoom with scroll, double-click
  or ⟲ to reset the camera.
- Moves animate: steps slide, jumps arc and flip over each captured piece,
  and captured pieces burn away into embers.
- Kings (crowned on the far row) turn into polished metal with a glowing
  crown, a halo and orbiting sparks.
- The last move stays marked: lit origin and landing squares, landing dots,
  a scorch mark on every captured square, and the flight path traced above
  the board. The HUD also names it ("Black c3×e5×g7").
- Lobby, protected tables (access codes), rematch, forfeit, claim-win,
  leaderboard and bot challenges come from duel-game-core's shell, restyled
  as a HUD.

## Layout

```
icp.yaml                  backend = the live game's own wasm (local testing only), frontend = this site
backend.wasm              downloaded from https://ejfxb-wqaaa-aaaac-qhekq-cai.raw.icp0.io/wasm (sha256 pinned in icp.yaml)
backend.did               the backend's Candid (icp canister metadata … candid:service)
.icp/data/mappings/ic.ids.json   "backend" -> the live id, for the ic environment
frontend/
  build.js                esbuild bundle -> frontend/dist
  src/app.js              bootstrap: backend id, agent, transport, shell, scene binding, leaderboard/bots
  src/checkers-plugin.js  GamePlugin: Candid State/Action, HUD scoreboard, applyLocal
  src/checkers-rules.js   cosmetic mirror of the rules (legal targets, applyLocal, last-move diff)
  src/screens.js          HUD versions of every shell screen
  src/scene/              the 3D table (board, pieces, effects, tweens, controller)
  src/duel-game-core/     duel-game-core's frontend/src/*.ts, copied unchanged (not on npm)
  src/_headers            CSP and other headers served by the asset canister
```

**Which backend the page uses:** `PUBLIC_CANISTER_ID:backend` from the
`ic_env` cookie the asset canister sets. When the page is deployed locally,
that's the local copy. When it's deployed to mainnet after the `link` below,
that's the live game. Anywhere else (no cookie), the page falls back to
`ejfxb-wqaaa-aaaac-qhekq-cai`. Whenever the target is the live backend, the
agent talks to `https://icp0.io`.

## Run it locally (against a private copy of the backend)

```bash
cd frontend && npm install --legacy-peer-deps && cd ..
icp network start -d
icp deploy                    # private local backend copy + this frontend
# open the "frontend:" URL it prints, e.g. http://frontend.local.localhost:8000/
# a second browser tab is a second player
icp network stop              # when done
```

After editing anything under `frontend/src`, run `icp deploy frontend` again.
The local backend starts empty: no bots, empty leaderboard.

## Take it live

You need an icp-cli identity with cycles on mainnet. Run these from this
folder:

```bash
icp canister link backend ejfxb-wqaaa-aaaac-qhekq-cai -e ic --force
icp deploy frontend -e ic
icp canister status frontend -e ic -i
```

1. `link` points the name `backend` at the live game for the `ic`
   environment. It was already run once while building this project;
   `--force` makes it safe to repeat.
2. `icp deploy frontend -e ic` creates your own frontend canister on mainnet
   (this spends cycles) and uploads `frontend/dist`. **Always name
   `frontend`**: a bare `icp deploy -e ic` would also try to install into
   the live backend, which isn't yours, and fail.
3. `icp canister status frontend -e ic -i` prints your new frontend's
   canister id, `<FRONTEND_ID>`.

Your live page is then at `https://<FRONTEND_ID>.icp0.io/` (also served at
`https://<FRONTEND_ID>.icp.net/`). The id is also recorded in
`.icp/data/mappings/ic.ids.json`, next to `backend`.

Finally, register `<FRONTEND_ID>` on the Duel dashboard as its own entry,
with your own title, description and banner.

## Development notes

- `cd frontend && npm run typecheck` type-checks the vendored duel-game-core
  sources; `npm run build` bundles.
- In the browser console, `checkers.scene` and `checkers.client` are
  exposed for debugging. `checkers.scene.pump(seconds)` steps the animation
  clock by hand, for a tab the browser keeps hidden (where
  requestAnimationFrame doesn't run).
- Never point a development build at the live backend. If you must test
  against it, use a table with an access code so real players aren't
  disturbed.
