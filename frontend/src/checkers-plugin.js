// GamePlugin for the live Checkers backend. `View`/`Action`/`Options` are
// a literal translation of its Candid (`icp canister metadata … candid:service`). The board itself is the 3D scene
// (scene/), so `renderBoard` only draws the HUD's scoreboard and the last
// move in words, and `renderActions` a hint; `applyLocal` lets the scene
// play your move the instant you make it.

import { esc } from "@research-ag/duel-game-core/render.js";
import { applyAction, boardOf, inferMove, isKing, moveText, ownerOf, sameTags, seatHasCapture, tagsOf } from "./checkers-rules.js";

export const SEAT_NAME = { p1: "Black", p2: "Red" };

/// The last move, read by diffing consecutive boards (View carries no
/// history). Fed every board that reaches the screen, in order, by both the
/// HUD and the scene; noting the same board twice is a no-op, and a board
/// equal to the one before the last move (a rejected move put back) undoes
/// that move.
export class MoveTracker {
  constructor() {
    this.stack = []; // [{ tags, move }], newest last
  }
  note(tags) {
    const top = this.stack[this.stack.length - 1];
    if (top && sameTags(top.tags, tags)) return top.move;
    const prev = this.stack[this.stack.length - 2];
    if (prev && sameTags(prev.tags, tags)) {
      this.stack.pop();
      return prev.move;
    }
    const move = top ? inferMove(top.tags, tags) : null;
    if (!move) this.stack = [];
    this.stack.push({ tags, move });
    if (this.stack.length > 8) this.stack.shift();
    return move;
  }
}

export const tracker = new MoveTracker();

function counts(tags, seat) {
  let men = 0;
  let kings = 0;
  for (const t of tags) {
    if (!t || ownerOf(t) !== seat) continue;
    if (isKing(t)) kings++;
    else men++;
  }
  return { men, kings };
}

function sideCard(tags, seat, mySeat) {
  const { men, kings } = counts(tags, seat);
  const who = seat === mySeat ? "You" : "Opponent";
  return `
    <div class="side side-${seat}${seat === mySeat ? " me" : ""}">
      <span class="chip chip-${seat}"></span>
      <span class="side-name"><small>${who}</small>${esc(SEAT_NAME[seat])}</span>
      <span class="side-count" title="pieces left">${men + kings}</span>
      ${kings ? `<span class="side-kings" title="kings">♛${kings}</span>` : ""}
    </div>`;
}

export const plugin = {
  idlTypes({ IDL }) {
    const Piece = IDL.Variant({
      manP1: IDL.Null,
      manP2: IDL.Null,
      kingP1: IDL.Null,
      kingP2: IDL.Null,
    });
    const Seat = IDL.Variant({ p1: IDL.Null, p2: IDL.Null });
    const View = IDL.Record({ board: IDL.Vec(IDL.Opt(Piece)), toMove: Seat });
    const Action = IDL.Variant({
      move: IDL.Record({ from: IDL.Nat, to: IDL.Nat }),
      jump: IDL.Record({ path: IDL.Vec(IDL.Nat) }),
    });
    // Plain English draughts: no table options.
    const Options = IDL.Record({});
    return { Action, View, Options };
  },

  seatLabel(seat) {
    return SEAT_NAME[seat];
  },

  // The scoreboard and the last move in words; the 3D scene draws (and
  // marks) the board. Called live and on the debrief, where the move
  // that ended the game is still named.
  renderBoard(gameState, mySeat) {
    const tags = tagsOf(gameState.board);
    const last = tracker.note(tags);
    const lastHtml = last
      ? `<div class="last-move last-${last.mover}"><small>Last move</small>${esc(SEAT_NAME[last.mover])} ${esc(moveText(last))}${last.promoted ? " ♛" : ""}</div>`
      : `<div class="last-move"><small>Last move</small>—</div>`;
    const opp = mySeat === "p1" ? "p2" : "p1";
    return `<div class="scoreboard">${sideCard(tags, mySeat, mySeat)}${lastHtml}${sideCard(tags, opp, mySeat)}</div>`;
  },

  // Moves are made on the board itself; this is only the hint under it.
  renderActions(gameState, mySeat) {
    const mustJump = seatHasCapture(tagsOf(gameState.board), mySeat);
    return mustJump
      ? `<p class="hint hint-capture">Capture available — you must jump. Pick a glowing piece, then each landing square.</p>`
      : `<p class="hint">Pick one of your glowing pieces, then a target square.</p>`;
  },

  applyLocal(gameState, mySeat, move) {
    const after = applyAction(tagsOf(gameState.board), mySeat, move);
    // A finished move always hands the turn over (a capture chain is one
    // `jump` action).
    return after ? { ...gameState, board: boardOf(after), toMove: { [mySeat === "p1" ? "p2" : "p1"]: null } } : null;
  },
};
