// A cosmetic mirror of the live backend's rules, taken from its
// /semantics text (English draughts). The backend's own `validate` is the
// only judge: nothing here is ever sent except the Action the player
// picked, and a move this file thinks is illegal is still submitted when
// the player insists, so the backend's rejection text reaches the screen.
//
// Board: 64 squares, row-major, index = row * 8 + col; only dark squares,
// (row + col) odd, are used. A square decodes from Candid `opt Piece` as
// `[]` or `[{ manP1: null }]`. p1 (Black) starts on rows 5..7 and moves
// toward row 0; p2 (Red) starts on rows 0..2 and moves toward row 7.

export const SIZE = 8;
const DIAGS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;
export const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const isDark = (i) => (rowOf(i) + colOf(i)) % 2 === 1;

/// "a1".."h8", letters by column and numbers counted up from Black's
/// home row, the same for both seats.
export function squareName(i) {
  return `${String.fromCharCode(97 + colOf(i))}${SIZE - rowOf(i)}`;
}

/// `"manP1" | "manP2" | "kingP1" | "kingP2" | null`
export function pieceAt(board, i) {
  const cell = board[i];
  return cell && cell.length ? Object.keys(cell[0])[0] : null;
}
export const ownerOf = (tag) => (tag.endsWith("P1") ? "p1" : "p2");
export const isKing = (tag) => tag.startsWith("king");
const forward = (seat) => (seat === "p1" ? -1 : 1);
const farRow = (seat) => (seat === "p1" ? 0 : SIZE - 1);
const cellOf = (tag) => (tag === null ? [] : [{ [tag]: null }]);

/// The board as plain tags, the shape the scene works with.
export function tagsOf(board) {
  return Array.from({ length: SIZE * SIZE }, (_, i) => pieceAt(board, i));
}
export function sameTags(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/// The starting position, for the idle scene.
export function initialTags() {
  const out = new Array(SIZE * SIZE).fill(null);
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!isDark(i)) continue;
    if (rowOf(i) <= 2) out[i] = "manP2";
    else if (rowOf(i) >= 5) out[i] = "manP1";
  }
  return out;
}

// ── Move generation over tag arrays ─────────────────────────────────────

function dirsFor(tag) {
  if (isKing(tag)) return DIAGS;
  return DIAGS.filter(([dr]) => dr === forward(ownerOf(tag)));
}

export function stepTargets(tags, i, tag = tags[i]) {
  const out = [];
  for (const [dr, dc] of dirsFor(tag)) {
    const r = rowOf(i) + dr;
    const c = colOf(i) + dc;
    if (inBoard(r, c) && tags[idx(r, c)] === null) out.push(idx(r, c));
  }
  return out;
}

/// `[{ over, land }]`: each capture available to the piece `tag` on `i`.
export function jumpTargets(tags, i, tag = tags[i]) {
  const out = [];
  for (const [dr, dc] of dirsFor(tag)) {
    const r = rowOf(i) + 2 * dr;
    const c = colOf(i) + 2 * dc;
    if (!inBoard(r, c)) continue;
    const over = idx(rowOf(i) + dr, colOf(i) + dc);
    const land = idx(r, c);
    const victim = tags[over];
    if (tags[land] === null && victim !== null && ownerOf(victim) !== ownerOf(tag)) {
      out.push({ over, land });
    }
  }
  return out;
}

export function seatHasCapture(tags, seat) {
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t && ownerOf(t) === seat && jumpTargets(tags, i).length > 0) return true;
  }
  return false;
}

/// Squares holding a piece of `seat` that has a legal first leg.
export function movablePieces(tags, seat) {
  const capture = seatHasCapture(tags, seat);
  const out = new Set();
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (!t || ownerOf(t) !== seat) continue;
    if ((capture ? jumpTargets(tags, i) : stepTargets(tags, i)).length > 0) out.add(i);
  }
  return out;
}

const midOf = (a, b) => idx((rowOf(a) + rowOf(b)) / 2, (colOf(a) + colOf(b)) / 2);

/// For a selection `path` ([origin, ...landings so far]), the legal next
/// squares: Map<square, Action | null>, where null means the capture
/// chain must go on from there. Also returns the squares captured so far.
export function selectionTargets(tags, seat, path) {
  const origin = path[0];
  const tag = tags[origin];
  const targets = new Map();
  const captured = [];
  if (!tag || ownerOf(tag) !== seat) return { targets, captured };
  // Replay the legs chosen so far (a man is never promoted mid-chain).
  let sim = tags.slice();
  for (let k = 0; k + 1 < path.length; k++) {
    const over = midOf(path[k], path[k + 1]);
    captured.push(over);
    sim[path[k]] = null;
    sim[over] = null;
    sim[path[k + 1]] = tag;
  }
  const cur = path[path.length - 1];
  if (!seatHasCapture(tags, seat)) {
    if (path.length === 1) {
      for (const to of stepTargets(sim, cur, tag)) targets.set(to, { move: { from: origin, to } });
    }
    return { targets, captured };
  }
  for (const { over, land } of jumpTargets(sim, cur, tag)) {
    const after = sim.slice();
    after[cur] = null;
    after[over] = null;
    after[land] = tag;
    const done = jumpTargets(after, land, tag).length === 0;
    targets.set(land, done ? { jump: { path: [...path, land] } } : null);
  }
  return { targets, captured };
}

/// Applies `action` for `seat` if this mirror considers it legal; null
/// otherwise. Used for `applyLocal` only.
export function applyAction(tags, seat, action) {
  const num = (n) => Number(n);
  let path;
  if ("move" in action) path = [num(action.move.from), num(action.move.to)];
  else if ("jump" in action) path = action.jump.path.map(num);
  else return null;
  if (path.length < 2 || path.some((s) => !(s >= 0 && s < 64))) return null;
  for (let k = 1; k < path.length; k++) {
    const { targets } = selectionTargets(tags, seat, path.slice(0, k));
    if (!targets.has(path[k])) return null;
    const act = targets.get(path[k]);
    if (k < path.length - 1) {
      if (act !== null) return null; // the chain was already over
    } else if (act === null || "move" in act !== "move" in action) {
      return null; // the chain must go on, or the wrong kind of action
    }
  }
  const tag = tags[path[0]];
  const out = tags.slice();
  out[path[0]] = null;
  for (let k = 0; k + 1 < path.length; k++) {
    if (Math.abs(rowOf(path[k + 1]) - rowOf(path[k])) === 2) out[midOf(path[k], path[k + 1])] = null;
  }
  const end = path[path.length - 1];
  out[end] = !isKing(tag) && rowOf(end) === farRow(ownerOf(tag)) ? tag.replace("man", "king") : tag;
  return out;
}

export function boardOf(tags) {
  return tags.map(cellOf);
}

// ── Reading a move back out of two boards ───────────────────────────────

/// The single move that turns `before` into `after`, or null when the two
/// differ any other way (a new game, a missed view, a rejected move put
/// back). `{ mover, tag, from, to, path, captured: [{ sq, tag }],
/// promoted }`, `path` being every square the piece stands on in order.
/// View carries no history, so this is how the opponent's last move is
/// found (/semantics, CLIENT NOTES).
export function inferMove(before, after) {
  if (!before || !after || before.length !== after.length) return null;
  const vacated = [];
  const appeared = [];
  for (let i = 0; i < after.length; i++) {
    const a = before[i];
    const b = after[i];
    if (a === b) continue;
    if (a !== null && b === null) vacated.push(i);
    else if (a === null && b !== null) appeared.push(i);
    else return null; // a piece changed in place
  }
  if (appeared.length > 1) return null;

  if (appeared.length === 0) {
    // A king's capture chain can end on the square it started from: only
    // the captured pieces change.
    if (vacated.length === 0) return null;
    const victimOwner = ownerOf(before[vacated[0]]);
    if (vacated.some((i) => ownerOf(before[i]) !== victimOwner)) return null;
    const mover = victimOwner === "p1" ? "p2" : "p1";
    for (let sq = 0; sq < before.length; sq++) {
      const tag = before[sq];
      if (!tag || !isKing(tag) || ownerOf(tag) !== mover || after[sq] !== tag) continue;
      const path = chainPath(before, sq, sq, tag, vacated);
      if (path) {
        return { mover, tag, from: sq, to: sq, promoted: false, path, captured: vacated.map((v) => ({ sq: v, tag: before[v] })) };
      }
    }
    return null;
  }

  const to = appeared[0];
  const endTag = after[to];
  const mover = ownerOf(endTag);
  const froms = vacated.filter((i) => ownerOf(before[i]) === mover);
  if (froms.length !== 1) return null;
  const from = froms[0];
  const tag = before[from];
  if (tag !== endTag && !(endTag === tag.replace("man", "king") && rowOf(to) === farRow(mover))) return null;
  const victims = vacated.filter((i) => ownerOf(before[i]) !== mover);
  const base = { mover, tag, from, to, promoted: tag !== endTag };

  if (victims.length === 0) {
    if (Math.abs(rowOf(to) - rowOf(from)) !== 1 || Math.abs(colOf(to) - colOf(from)) !== 1) return null;
    return { ...base, path: [from, to], captured: [] };
  }
  const path = chainPath(before, from, to, tag, victims);
  if (!path) return null;
  return { ...base, path, captured: victims.map((sq) => ({ sq, tag: before[sq] })) };
}

// The landing order of a capture chain from `from` to `to` that jumps
// exactly `victims`, or null.
function chainPath(before, from, to, tag, victims) {
  const victimSet = new Set(victims);
  const used = new Set();
  const search = (cur, path) => {
    if (used.size === victimSet.size) return cur === to ? path : null;
    for (const [dr, dc] of dirsFor(tag)) {
      const r = rowOf(cur) + 2 * dr;
      const c = colOf(cur) + 2 * dc;
      if (!inBoard(r, c)) continue;
      const over = idx(rowOf(cur) + dr, colOf(cur) + dc);
      const land = idx(r, c);
      if (!victimSet.has(over) || used.has(over)) continue;
      if (before[land] !== null && land !== from) continue;
      used.add(over);
      const found = search(land, [...path, land]);
      used.delete(over);
      if (found) return found;
    }
    return null;
  };
  return search(from, [from]);
}

/// "c3–d4" or "c3×e5×g7".
export function moveText(m) {
  return m.path.map(squareName).join(m.captured.length ? "×" : "–");
}
