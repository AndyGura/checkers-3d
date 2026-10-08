// The HUD drawn over the 3D table: every screen of duel-game-core's
// default shell, restyled and re-laid-out, but with the same `data-*`
// hooks and element ids, so the shell's click handling, spinners,
// countdowns, and confirm/access-code overlays keep working unchanged
// (frontend/README.md, "Replacing screens").

import {
  DUEL_CLAIM_BUTTON_ID,
  DUEL_CLAIM_WARNING_ID,
  DUEL_IDLE_WARNING_ID,
  atRiskWarningText,
  claimWarningText,
  claimWarningThreshold,
  debriefVerdict,
  esc,
  idleWarningText,
  idleWarningThreshold,
  truncatePlayerId,
  waitingText,
} from "./duel-game-core/render.js";
import { claimRoleOf, oppSeatOf, tag } from "./duel-game-core/client.js";

const chip = (seat) => `<span class="chip chip-${seat}"></span>`;

function seatButton(plugin, seat, attrs, sub) {
  return `
    <button class="seat seat-${seat}" ${attrs}>
      ${chip(seat)}
      <span class="seat-text"><span class="seat-label">${esc(plugin.seatLabel(seat))}</span><small>${sub}</small></span>
    </button>`;
}

function tableRow(r, plugin) {
  const seat = (s, open, occ) => {
    const who = !open && occ.length ? truncatePlayerId(occ[0]).text : open ? "open seat" : "taken";
    return seatButton(
      plugin,
      s,
      `data-join-table-id="${r.id}" data-join-table="${s}"${r.protected ? " data-protected" : ""} ${open ? "" : "disabled"}`,
      esc(who),
    );
  };
  return `
    <div class="table-row">
      <div class="table-row-head">
        <span class="table-id">Table #${r.id}</span>
        ${r.protected ? `<span class="badge" title="Requires an access code">🔒 Protected</span>` : ""}
        <span class="muted" data-wait-base="${r.waitingSecs}">${waitingText(r.waitingSecs)}</span>
      </div>
      <div class="seat-pick">${seat("p1", r.p1Open, r.p1Session)}${seat("p2", r.p2Open, r.p2Session)}</div>
    </div>`;
}

export const screens = {
  connecting() {
    return `<div class="hud-center"><div class="loader"></div><p>Entering the arena…</p></div>`;
  },

  tableBadge(id) {
    return `<div class="table-badge">Table <strong>#${id}</strong></div>`;
  },

  browsing(v, plugin) {
    return `
      <section class="panel">
        <h2 class="panel-title">The Arena</h2>
        <p class="tagline">English draughts. Black moves first, captures are mandatory, and a man reaching the far row is crowned.</p>

        <div class="block">
          <h3>New table</h3>
          <div class="option-group">
            <label class="radio"><input type="radio" name="table-visibility" value="open" checked /> <span>Open — anyone can join</span></label>
            <label class="radio"><input type="radio" name="table-visibility" value="code" /> <span>Protected — share a code</span></label>
            <input type="text" id="create-code" class="table-code-input" placeholder="access code" autocomplete="off" hidden />
          </div>
          <div class="seat-pick">
            ${seatButton(plugin, "p1", `data-create-table="p1"`, "moves first")}
            ${seatButton(plugin, "p2", `data-create-table="p2"`, "moves second")}
          </div>
          <button class="ghost wide" data-open-bots>🤖 Challenge a bot</button>
        </div>

        <div class="block">
          <h3>Tables <span class="count">${v.tables.length}</span></h3>
          ${
            v.tables.length === 0
              ? `<p class="muted">No tables right now — open one above, or open this page in a second tab to play yourself.</p>`
              : v.tables.map((r) => tableRow(r, plugin)).join("")
          }
        </div>
      </section>`;
  },

  lobby(v, plugin) {
    return `
      <section class="panel">
        <h2 class="panel-title">Choose your seat</h2>
        <div class="seat-pick">
          ${seatButton(plugin, "p1", `data-join-table="p1" ${v.p1Open ? "" : "disabled"}`, v.p1Open ? "seat open" : "taken")}
          ${seatButton(plugin, "p2", `data-join-table="p2" ${v.p2Open ? "" : "disabled"}`, v.p2Open ? "seat open" : "taken")}
        </div>
        ${v.resetAvailable ? `<button data-reset class="ghost wide">Clear the abandoned board</button>` : ""}
      </section>`;
  },

  busy(v) {
    return `
      <section class="panel">
        <h2 class="panel-title">Board in use</h2>
        <p>Another game is under way.</p>
        <p class="countdown">${v.secondsUntilTakeover}s until it can be taken over</p>
      </section>`;
  },

  stagingYou(v, plugin) {
    const seat = tag(v.seat);
    const code = "code" in v.visibility ? v.visibility.code : null;
    return `
      <section class="panel panel-compact">
        <h2 class="panel-title">Waiting for an opponent</h2>
        <p class="you-hold">${chip(seat)} You play <strong class="seat-label">${esc(plugin.seatLabel(seat))}</strong></p>
        ${
          v.reservedForPartner
            ? `<p class="muted">The other seat is held for your last opponent for a while — after that anyone may take it.</p>`
            : code !== null
              ? `<p class="muted">Protected. Share this table's number and the code with a friend; nobody else can join.</p>
                 <p class="code-display"><code class="table-code">${esc(code)}</code></p>`
              : `<p class="muted">Anyone in the arena can take the other seat — on this page or on the original Checkers. Or open this page in a second tab.</p>`
        }
        <div class="pulse-dots"><span></span><span></span><span></span></div>
        <div class="row">
          <button class="ghost" data-open-bots>🤖 Add a bot</button>
          <button data-leave class="ghost">Leave</button>
        </div>
      </section>`;
  },

  awaitingRematch(v, plugin) {
    const seat = tag(v.openSeat);
    return `
      <section class="panel panel-compact">
        <h2 class="panel-title">Rematch offered</h2>
        <p>Your last opponent wants another game and holds ${chip(seat)} <strong class="seat-label">${esc(plugin.seatLabel(seat))}</strong> for you.</p>
        <div class="row">
          <button data-rematch class="primary">Accept rematch</button>
          <button data-leave class="ghost">Decline</button>
        </div>
        <p class="muted">Decline (or ignore it) and the seat opens to anyone.</p>
      </section>`;
  },

  inGame(v, plugin) {
    const me = tag(v.seat);
    const opp = oppSeatOf(me);
    const myTurn = !v.youSubmitted;
    const idleHidden = v.youSubmitted || v.secondsUntilIdleReset > idleWarningThreshold(v.idleTimeoutSecs);
    const role = claimRoleOf(v);
    let claim = "";
    if (role !== null) {
      const text = role === "waiting" ? claimWarningText(v.secondsUntilClaimable) : atRiskWarningText(v.secondsUntilClaimable);
      const hidden =
        (role === "waiting" && v.claimWinAvailable) || v.secondsUntilClaimable > claimWarningThreshold(v.claimTimeoutSecs);
      claim = `<p class="countdown" id="${DUEL_CLAIM_WARNING_ID}"${hidden ? " hidden" : ""}>${text}</p>`;
      if (role === "waiting") {
        claim += `<button id="${DUEL_CLAIM_BUTTON_ID}" data-claim-win class="primary"${v.claimWinAvailable ? "" : " hidden"}>Claim the win</button>`;
      }
    }
    return `
      <div class="turn-banner ${myTurn ? `mine turn-${me}` : `theirs turn-${opp}`}">
        <span class="move-no">Move ${v.turn + 1n}</span>
        <strong>${myTurn ? "Your move" : `${esc(plugin.seatLabel(opp))} is thinking…`}</strong>
      </div>
      <div class="game-bottom">
        ${plugin.renderBoard(v.game, me, opp, myTurn)}
        <div class="game-actions">
          ${myTurn ? plugin.renderActions(v.game, me) : `<p class="hint">Waiting for your opponent's move…</p>`}
          <p class="countdown" id="${DUEL_IDLE_WARNING_ID}"${idleHidden ? " hidden" : ""}>${idleWarningText(v.secondsUntilIdleReset)}</p>
          ${claim}
          <div class="row">
            <button data-leave data-confirm="Forfeit this game? Your opponent will win." class="ghost small">Forfeit</button>
          </div>
        </div>
      </div>`;
  },

  debrief(v, plugin) {
    const me = tag(v.seat);
    const opp = oppSeatOf(me);
    const { title, outcome } = debriefVerdict(v.end, me);
    const word = { win: "Victory", lose: "Defeat", draw: "Game over" }[outcome];
    return `
      <div class="verdict-wrap">
        <h2 class="verdict ${outcome}" data-text="${word}">${word}</h2>
        <p class="verdict-sub">${esc(title)} · ${v.turns} move${v.turns === 1n ? "" : "s"}</p>
      </div>
      <div class="game-bottom">
        ${plugin.renderBoard(v.finalGame, me, opp)}
        <div class="game-actions">
          <div class="row">
            <button data-rematch class="primary">Rematch</button>
            <button data-leave class="ghost">Return to lobby</button>
          </div>
        </div>
      </div>`;
  },

  endedByOther() {
    return `
      <section class="panel panel-compact">
        <h2 class="panel-title">Your game was ended</h2>
        <p>The board sat idle too long and was reclaimed. Your game is gone.</p>
        <button data-ack class="primary wide">Return to lobby</button>
      </section>`;
  },
};
