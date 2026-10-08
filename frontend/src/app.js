// Bootstrap: find the backend, build the actor and transport, run
// duel-game-core's shell (`start()`) with our HUD screens for every
// lobby/staging/rematch/debrief mechanic, and drive the 3D table from the
// same client (frontend/README.md "Persistent DOM alongside the default
// shell": one connection, the scene a sibling of #screen). Bundled by
// esbuild (../build.js).

import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { safeGetCanisterEnv } from "@icp-sdk/core/agent/canister-env";
import { Principal } from "@icp-sdk/core/principal";
import { makeIdlFactory, buildBotPlayIdlFactory } from "./duel-game-core/idl.js";
import { start } from "./duel-game-core/app.js";
import { connectTransport } from "./duel-game-core/transport.js";
import { regenerateAnonymousIdentity, resolveAnonymousIdentity } from "./duel-game-core/anon-identity.js";
import { deriveHost } from "./duel-game-core/ic-env.js";
import { oppSeatOf, viewOf, viewTagOf, withLocalMove } from "./duel-game-core/client.js";
import { debriefVerdict, errText, esc, renderBotList, renderLeaderboard, renderSeatChoice, tag } from "./duel-game-core/render.js";
import { plugin } from "./checkers-plugin.js";
import { tagsOf } from "./checkers-rules.js";
import { screens } from "./screens.js";
import { CheckersScene } from "./scene/checkers-scene.js";

// The live Checkers backend (https://eag45-ayaaa-aaaac-qhela-cai.icp.net
// publishes it in its ic_env cookie). Not ours: this page only talks to it.
const LIVE_BACKEND = "ejfxb-wqaaa-aaaac-qhekq-cai";

// A page deployed with icp-cli names its backend in the ic_env cookie: the
// private local copy during development, the linked live canister once
// deployed with `icp deploy frontend -e ic`. Any other hosting falls back
// to the live id.
const env = safeGetCanisterEnv();
const canisterId = env?.["PUBLIC_CANISTER_ID:backend"] ?? LIVE_BACKEND;
const live = canisterId === LIVE_BACKEND;

// Talking to the live backend always goes through icp0.io (deriveHost()
// assumes the backend sits behind this page's own origin, which is wrong
// for localhost or a foreign host); the local copy needs the local
// replica and its root key.
const host = live ? "https://icp0.io" : deriveHost();

// A keypair per tab, persisted in sessionStorage: a second tab is a second
// player. The same identity signs every call; the backend checks it.
const session = {
  ...resolveAnonymousIdentity(),
  async regenerate() {
    regenerateAnonymousIdentity();
    location.reload();
  },
};

const agent = await HttpAgent.create({
  host,
  identity: session.identity,
  ...(live ? {} : { rootKey: env?.IC_ROOT_KEY }),
});
const actor = Actor.createActor(makeIdlFactory(plugin.idlTypes), { agent, canisterId });
const ws = connectTransport({ actor, gameIdlTypes: plugin.idlTypes });

const client = start({ plugin, ws, session, screens });
document.getElementById("backend-id").textContent = canisterId;

// ── The 3D table ──────────────────────────────────────────────────────────

let scene = null;
try {
  scene = new CheckersScene(document.getElementById("stage"));
  scene.onAction = (action) => void client.submit(action);
  window.checkers = { scene, client }; // for poking at from the console
} catch (e) {
  console.error(e);
  document.body.classList.add("no-webgl");
}
document.getElementById("reset-view").addEventListener("click", () => scene?.resetView());

const applyLocal = plugin.applyLocal.bind(plugin);

function syncScene(state) {
  // Your own move shows at once: the scene animates the board with the
  // pending move applied, and the real view lands on the same picture.
  const shown = withLocalMove(state.status, state.pending, applyLocal);
  const screen = viewTagOf(shown) ?? "connecting";
  document.body.dataset.screen = screen;

  const inGame = viewOf(shown, "inGame");
  const debrief = viewOf(shown, "debrief");
  const staging = viewOf(shown, "stagingYou");
  let opts = { mode: "idle" };
  if (inGame) {
    const me = tag(inGame.seat);
    const myTurn = !inGame.youSubmitted;
    opts = {
      mode: "play",
      tags: tagsOf(inGame.game.board),
      mySeat: me,
      turnSeat: myTurn ? me : oppSeatOf(me),
      interactive: myTurn && state.pending === null && state.connection === "open",
    };
    document.body.dataset.turn = myTurn ? "mine" : "theirs";
  } else if (debrief) {
    const me = tag(debrief.seat);
    const { outcome } = debriefVerdict(debrief.end, me);
    const winner = outcome === "win" ? me : outcome === "lose" ? oppSeatOf(me) : null;
    opts = { mode: "debrief", tags: tagsOf(debrief.finalGame.board), mySeat: me, turnSeat: winner, outcome };
    document.body.dataset.outcome = outcome;
  } else if (staging) {
    opts = { mode: "staging", mySeat: tag(staging.seat) };
  }
  if (!inGame) delete document.body.dataset.turn;
  if (!debrief) delete document.body.dataset.outcome;
  document.body.dataset.seat = opts.mySeat ?? "";
  scene?.show(opts);
}

client.subscribe((state, prev) => {
  if (state.status !== prev.status || state.pending !== prev.pending || state.connection !== prev.connection) {
    syncScene(state);
  }
});
syncScene(client.getState());

// ── Leaderboard ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const leaderboardPanel = $("leaderboard-panel");
const leaderboardBody = $("leaderboard-body");
$("leaderboard-toggle").addEventListener("click", async () => {
  botPanel.hidden = true;
  leaderboardPanel.hidden = false;
  leaderboardBody.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const [entries, bots] = await Promise.all([actor.get_leaderboard(), actor.list_bots().catch(() => [])]);
    const botNames = new Map(bots.map((b) => [b.principal.toString(), b.name]));
    leaderboardBody.innerHTML = renderLeaderboard(entries, plugin, { yourSid: session.sid, botNames });
  } catch (err) {
    leaderboardBody.innerHTML = `<p class="error">Could not load the leaderboard.</p>`;
    console.error(err);
  }
});
$("leaderboard-back").addEventListener("click", () => (leaderboardPanel.hidden = true));

// ── Bots ──────────────────────────────────────────────────────────────────
// Two entry points (a "🤖" button on the lobby or staging screen, and a
// leaderboard row's Challenge button) converge on one flow that calls the
// chosen bot's own `play` (frontend/README.md, "Bot registry").

const hostPrincipal = Principal.fromText(canisterId);
const botPanel = $("bot-challenge-panel");
const botBody = $("bot-challenge-body");

// The bot and table of the last successful `play`, so a Rematch from that
// game re-invites it once the reserved staging lands.
const LAST_BOT_KEY = "duel-last-bot";
let lastBot = null;
try {
  const saved = JSON.parse(sessionStorage.getItem(LAST_BOT_KEY));
  if (saved) lastBot = { ...saved, tableId: BigInt(saved.tableId) };
} catch (_) {}
function setLastBot(bot) {
  lastBot = bot;
  try {
    if (bot) sessionStorage.setItem(LAST_BOT_KEY, JSON.stringify({ ...bot, tableId: bot.tableId.toString() }));
    else sessionStorage.removeItem(LAST_BOT_KEY);
  } catch (_) {}
}

let pendingBot = null;

// This session's own staging: { tableId, openSeat, code } or null.
function stagingOf(status) {
  const v = viewOf(status, "stagingYou");
  if (!v) return null;
  return {
    tableId: status.atTable.id,
    openSeat: tag(v.seat) === "p1" ? { p2: null } : { p1: null },
    code: "code" in v.visibility ? [v.visibility.code] : [],
    reserved: v.reservedForPartner,
  };
}

client.subscribe((state, prev) => {
  if (state.status === prev.status) return;
  const status = state.status;
  const atTable = status && "atTable" in status ? status.atTable : null;
  if (lastBot && !(atTable && atTable.id === lastBot.tableId)) setLastBot(null);
  const staging = stagingOf(status);
  if (staging && lastBot && staging.reserved && !pendingBot) {
    onChallenge(lastBot.principalText, lastBot.name, lastBot.complexity);
  }
});

async function loadBotList() {
  pendingBot = null;
  leaderboardPanel.hidden = true;
  botPanel.hidden = false;
  botBody.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const bots = await actor.list_bots();
    botBody.innerHTML = renderBotList(bots, plugin);
  } catch (err) {
    botBody.innerHTML = `<p class="error">Could not load bots.</p>`;
    console.error(err);
  }
}

async function inviteBot(seat) {
  const { principalText, name, complexity } = pendingBot;
  botBody.innerHTML = `<p class="muted">Inviting ${esc(name)} (${esc(complexity)})…</p>`;
  try {
    let staging = stagingOf(client.getState().status);
    if (!staging) {
      const res = await client.createTable(seat, { open: null }, "");
      if (!res.ok) throw new Error(res.message ?? "Could not open a table.");
      staging = stagingOf(res.view);
      if (!staging) throw new Error("Could not open a table.");
    }
    const bot = Actor.createActor(buildBotPlayIdlFactory, { agent, canisterId: principalText });
    const res = await bot.play(hostPrincipal, staging.tableId, staging.openSeat, staging.code, complexity);
    if ("err" in res) throw new Error(errText(res.err));
    setLastBot({ principalText, name, complexity, tableId: staging.tableId });
    botPanel.hidden = true;
    pendingBot = null;
  } catch (e) {
    botBody.innerHTML = `<p class="error">${esc(e?.message ?? String(e))}</p>`;
    pendingBot = null;
  }
}

function onChallenge(principalText, name, complexity) {
  pendingBot = { principalText, name, complexity };
  leaderboardPanel.hidden = true;
  botPanel.hidden = false;
  if (stagingOf(client.getState().status)) void inviteBot(undefined);
  else botBody.innerHTML = renderSeatChoice(plugin);
}

$("bot-challenge-back").addEventListener("click", () => {
  botPanel.hidden = true;
  pendingBot = null;
});
$("screen").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-open-bots]")) void loadBotList();
});
for (const el of [botBody, leaderboardBody]) {
  el.addEventListener("click", (ev) => {
    const seatBtn = ev.target.closest("[data-challenge-seat]");
    if (seatBtn && pendingBot) {
      void inviteBot(seatBtn.dataset.challengeSeat);
      return;
    }
    const botBtn = ev.target.closest("[data-challenge-bot]");
    if (botBtn) {
      onChallenge(
        botBtn.dataset.challengeBot,
        botBtn.dataset.botName || botBtn.dataset.challengeBot,
        botBtn.dataset.botComplexity || "",
      );
    }
  });
}
