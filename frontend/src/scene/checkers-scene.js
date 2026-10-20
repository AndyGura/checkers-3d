// The 3D table. `show()` is handed every board that reaches the screen, in
// order; the scene works out what happened between the board it is
// showing and the new one (the move, from a diff of the two, since View
// carries no history) and plays it: a slide for a step, an arcing flip
// over each captured piece for a jump, the captured pieces burning away
// into embers, a crown forging onto a promoted man. The squares of the
// last move stay lit, with its flight path traced above them, until the
// next move. On your turn, clicks on the board pick a piece and its
// landing squares and hand the finished Action to `onAction`.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import {
  colOf,
  inferMove,
  initialTags,
  isDark,
  movablePieces,
  ownerOf,
  rowOf,
  sameTags,
  selectionTargets,
} from "../checkers-rules.js";
import { Board, squareAt, squareX, squareZ } from "./board.js";
import { Piece, PIECE_H, TEAM, makeGhost } from "./pieces.js";
import { Fx, Trail } from "./fx.js";
import { Tweens, ease } from "./tween.js";

const GOLD = new THREE.Color("#ffd27a");
const TARGET_DONE = new THREE.Color("#7dffb2");
const TARGET_MORE = new THREE.Color("#ffd27a");

const midSquare = (a, b) => ((rowOf(a) + rowOf(b)) / 2) * 8 + (colOf(a) + colOf(b)) / 2;
const toWire = (action) =>
  "move" in action
    ? { move: { from: BigInt(action.move.from), to: BigInt(action.move.to) } }
    : { jump: { path: action.jump.path.map((s) => BigInt(s)) } };

export class CheckersScene {
  constructor(container) {
    this.container = container;
    this.onAction = null;

    // Renderer, camera, post.
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#03040a");
    scene.fog = new THREE.FogExp2("#03040a", 0.022);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 400);
    this.camera.position.set(0, 9, 15);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.32;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.target.set(0, -0.3, 0);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth / 2, container.clientHeight / 2), 0.8, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.addLights();

    this.board = new Board(scene);
    this.pieceRoot = new THREE.Group();
    scene.add(this.pieceRoot);
    this.fx = new Fx(scene);
    this.trail = new Trail(scene);
    this.tweens = new Tweens();

    // What is on the table now.
    this.pieces = new Map(); // square -> Piece
    this.displayed = new Array(64).fill(null);
    this.lastMove = null; // { move, before, prevLast } of the move shown last
    this.queue = [];
    this.busy = false;
    this.snapWhenHidden = true;

    // What `show()` last asked for.
    this.mode = null;
    this.mySeat = null;
    this.interactive = false;
    this.cameraSeat = undefined;
    this.cameraTween = false;
    this.outcome = null;
    this.idleRim = true;

    // Selection on your turn.
    this.path = [];
    this.ghost = null;
    this.hover = null;

    this.shakeAmp = 0;
    this.time = 0;
    this.prevNow = performance.now();
    this.fireworksUntil = 0;
    this.nextFirework = 0;

    this.bindInput();
    window.addEventListener("resize", () => this.resize());
    this.setCameraSeat(null, true);
    renderer.setAnimationLoop(() => this.frame());
  }

  addLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight("#9db8ff", "#1a0e08", 0.35));
    const key = new THREE.SpotLight("#fff1dc", 200, 0, 0.62, 0.55, 2);
    key.position.set(-1.5, 15, 1.5);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 6;
    key.shadow.camera.far = 30;
    s.add(key, key.target);
    const cool = new THREE.DirectionalLight("#46c8ff", 0.9);
    cool.position.set(9, 3, -5);
    const warm = new THREE.DirectionalLight("#ff5a2a", 0.7);
    warm.position.set(-9, 3, -5);
    const front = new THREE.DirectionalLight("#b9c8ff", 0.35);
    front.position.set(0, 4, 10);
    s.add(cool, warm, front);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /// `mode`: "idle" (no table: the start position, orbiting), "staging",
  /// "play" or "debrief". `tags` is the board to show (null = the start
  /// position). `turnSeat` lights the rim; `interactive` lets the player
  /// pick a move; `outcome` ("win"/"lose"/"draw") celebrates a debrief.
  show({ mode, tags, mySeat = null, turnSeat = null, interactive = false, outcome = null }) {
    const board = tags ?? initialTags();
    const seatChanged = mySeat !== this.mySeat;
    this.mode = mode;
    this.mySeat = mySeat;

    const target = this.queue.length ? this.queue[this.queue.length - 1] : this.displayed;
    if (!sameTags(target, board)) {
      this.clearSelection();
      this.queue.push(board);
      void this.drain();
    }

    this.setCameraSeat(mode === "idle" ? null : mySeat, false, seatChanged);
    this.idleRim = !turnSeat;
    if (turnSeat) this.board.setRim(TEAM[turnSeat].glow.clone().multiplyScalar(2.4));

    if (outcome !== this.outcome) {
      this.outcome = outcome;
      if (outcome === "win") {
        this.fireworksUntil = this.time + 6.5;
        this.nextFirework = this.time + 0.6;
      } else {
        this.fireworksUntil = 0;
      }
    }

    if (interactive !== this.interactive) {
      this.interactive = interactive;
      if (!interactive) this.clearSelection();
    }
    this.refreshHighlights();
  }

  resetView() {
    this.setCameraSeat(this.mode === "idle" ? null : this.mySeat, false, true);
  }

  // ── Board sync ─────────────────────────────────────────────────────────

  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        // Far behind (a tab in the background, a burst of views): jump to
        // the newest board instead of replaying every one.
        if (this.queue.length > 2) this.queue.splice(0, this.queue.length - 1);
        const next = this.queue.shift();
        this.tweens.timeScale = this.queue.length ? 2.5 : 1;
        if (document.hidden && this.snapWhenHidden) this.applyInstant(next);
        else await this.transition(next);
        this.refreshHighlights();
      }
    } catch (e) {
      console.error("[scene]", e);
    } finally {
      this.tweens.timeScale = 1;
      this.busy = false;
      this.refreshHighlights();
    }
  }

  async transition(next) {
    if (sameTags(this.displayed, next)) return;
    const move = inferMove(this.displayed, next);
    if (move && this.pieces.has(move.from)) {
      await this.playMove(move, next);
      return;
    }
    if (this.lastMove && sameTags(this.lastMove.before, next)) {
      await this.undoMove(next);
      return;
    }
    await this.rebuild(next);
  }

  /// Without animation: a hidden tab catching up.
  applyInstant(next) {
    const move = inferMove(this.displayed, next);
    for (const [, p] of this.pieces) this.removePiece(p);
    this.pieces.clear();
    for (let i = 0; i < 64; i++) if (next[i]) this.addPiece(next[i], i);
    if (move) this.markLastMove(move, this.displayed, false);
    else this.clearLastMove();
    this.displayed = next.slice();
  }

  async playMove(move, next) {
    const before = this.displayed;
    const prevLast = this.lastMove;
    this.clearLastMove();
    const piece = this.pieces.get(move.from);
    this.pieces.delete(move.from);
    const team = TEAM[move.mover];
    const segs = move.path.length - 1;
    this.trail.set(this.flightPoints(move.path), team.glow.clone().multiplyScalar(1.6));

    for (let k = 0; k < segs; k++) {
      const a = move.path[k];
      const b = move.path[k + 1];
      const jump = Math.abs(rowOf(b) - rowOf(a)) === 2;
      const ax = squareX(a);
      const az = squareZ(a);
      const bx = squareX(b);
      const bz = squareZ(b);
      const h = jump ? 1.25 : 0.45;
      const axis = new THREE.Vector3(bz - az, 0, -(bx - ax)).normalize();
      const victimSq = jump ? midSquare(a, b) : null;
      let struck = false;
      await this.tweens.run(
        jump ? 640 : 520,
        (e, raw) => {
          piece.group.position.set(ax + (bx - ax) * e, h * Math.sin(Math.PI * e), az + (bz - az) * e);
          if (jump) piece.pivot.quaternion.setFromAxisAngle(axis, -Math.PI * 2 * ease.inOutCubic(raw));
          this.trail.material.uniforms.uDraw.value = (k + raw) / segs;
          if (victimSq !== null && !struck && raw >= 0.5) {
            struck = true;
            this.capture(victimSq);
          }
        },
        ease.inOutSine,
      );
      piece.pivot.quaternion.identity();
      const at = new THREE.Vector3(bx, 0, bz);
      this.fx.shockwave(at, team.glow.clone().multiplyScalar(jump ? 1.2 : 0.6), { radius: jump ? 1.1 : 0.8, life: 0.6 });
      if (jump && k < segs - 1) await this.tweens.wait(60);
    }
    this.pieces.set(move.to, piece);
    if (move.promoted) await this.promote(piece, move.to);
    this.displayed = next.slice();
    this.markLastMove(move, before, true);
    this.lastMove.prevLast = prevLast;
  }

  /// A move this tab drew at once (`applyLocal`) that the backend then
  /// refused: put it back the way it came.
  async undoMove(next) {
    const { move, prevLast } = this.lastMove;
    const piece = this.pieces.get(move.to);
    this.clearLastMove();
    if (piece) {
      this.pieces.delete(move.to);
      if (move.promoted) piece.setKingAmount(0);
      const back = [...move.path].reverse();
      const pts = back.map((s) => new THREE.Vector3(squareX(s), 0, squareZ(s)));
      await this.tweens.run(
        320 * (pts.length - 1),
        (e) => {
          const f = e * (pts.length - 1);
          const i = Math.min(pts.length - 2, Math.floor(f));
          const t = f - i;
          piece.group.position.lerpVectors(pts[i], pts[i + 1], t);
          piece.group.position.y = 0.3 * Math.sin(Math.PI * t);
        },
        ease.inOutSine,
      );
      piece.group.position.y = 0;
      this.pieces.set(move.from, piece);
    }
    const back = [];
    for (const { sq, tag } of move.captured) {
      const p = this.addPiece(tag, sq);
      p.setDissolve(1);
      back.push(p);
    }
    if (back.length) await this.tweens.run(500, (e) => back.forEach((p) => p.setDissolve(1 - e)), ease.outCubic);
    this.displayed = next.slice();
    if (prevLast) this.markLastMove(prevLast.move, prevLast.before, false);
    this.lastMove = prevLast;
  }

  /// Anything that is not one move: a new game, a reload mid-game, a
  /// jump across several views. Old pieces burn away, new ones drop in.
  async rebuild(next) {
    this.clearLastMove();
    const gone = [];
    const arriving = [];
    for (let i = 0; i < 64; i++) {
      const was = this.displayed[i];
      const now = next[i];
      if (was === now) continue;
      const p = this.pieces.get(i);
      if (was && now && ownerOf(was) === ownerOf(now) && p) {
        p.setKingAmount(now.startsWith("king") ? 1 : 0);
        continue;
      }
      if (was && p) gone.push([i, p]);
      if (now) arriving.push(i);
    }
    for (const [i, p] of gone) {
      this.pieces.delete(i);
      this.vanish(p, gone.length > 4);
    }
    if (gone.length) await this.tweens.wait(gone.length > 4 ? 650 : 300);

    // Drop in as a wave rolling out from the centre line.
    const drops = arriving.map((i) => {
      const p = this.addPiece(next[i], i);
      p.group.position.y = 6;
      p.group.visible = false;
      const delay = Math.abs(rowOf(i) - 3.5) * 70 + colOf(i) * 18;
      return this.tweens.run(
        650,
        (e, raw) => {
          p.group.visible = true;
          p.group.position.y = 6 * (1 - e);
          if (raw >= 1) this.fx.shockwave(p.group.position.clone(), p.team.glow.clone().multiplyScalar(0.8), { radius: 0.75, life: 0.45 });
        },
        ease.outBounce,
        delay,
      );
    });
    await Promise.all(drops);
    this.displayed = next.slice();
  }

  // ── Pieces and effects ─────────────────────────────────────────────────

  addPiece(tag, sq) {
    const p = new Piece(tag);
    p.group.position.set(squareX(sq), 0, squareZ(sq));
    this.pieceRoot.add(p.group);
    this.pieces.set(sq, p);
    return p;
  }

  removePiece(p) {
    this.pieceRoot.remove(p.group);
    p.dispose();
  }

  /// A captured piece: lifts, burns from its edges inward and scatters
  /// as embers, with a ring of light and a jolt of the camera.
  capture(sq) {
    const p = this.pieces.get(sq);
    if (!p) return;
    this.pieces.delete(sq);
    const at = p.group.position.clone();
    this.fx.dissolveBurst(at, p.team);
    this.fx.shockwave(at, p.team.edge.clone().multiplyScalar(1.2), { radius: 1.5, life: 0.8, intensity: 1.6, width: 0.08 });
    this.shakeAmp = Math.max(this.shakeAmp, 0.13);
    void this.tweens
      .run(
        950,
        (e) => {
          p.setDissolve(e);
          p.group.position.y = 0.22 * ease.outCubic(e);
          p.pivot.rotation.y = e * 1.4;
        },
        ease.inOutSine,
      )
      .then(() => this.removePiece(p));
  }

  /// Like `capture`, quieter: pieces leaving outside a move.
  vanish(p, quiet) {
    const at = p.group.position.clone();
    if (!quiet || Math.random() < 0.5) this.fx.dissolveBurst(at, p.team);
    void this.tweens.run(600, (e) => p.setDissolve(e), ease.inOutSine, Math.random() * 120).then(() => this.removePiece(p));
  }

  /// A man reaching the far row: it rises, spins up in a fountain of
  /// sparks, takes on its polished, glowing king form, and settles.
  async promote(p, sq) {
    const at = new THREE.Vector3(squareX(sq), 0, squareZ(sq));
    await this.tweens.run(320, (e) => (p.group.position.y = 0.7 * e), ease.outCubic);
    this.fx.crownBurst(at, p.team);
    this.fx.shockwave(at, GOLD.clone().multiplyScalar(2), { radius: 2.6, life: 1.1, width: 0.16, intensity: 4 });
    this.shakeAmp = Math.max(this.shakeAmp, 0.08);
    await this.tweens.run(
      1000,
      (e, raw) => {
        p.setKingAmount(Math.min(1, raw * 1.15));
        p.pivot.rotation.y = ease.outCubic(raw) * Math.PI * 4;
      },
      ease.linear,
    );
    p.pivot.rotation.y = 0;
    await this.tweens.run(420, (e) => (p.group.position.y = 0.7 * (1 - e)), ease.outBounce);
    this.fx.shockwave(at, p.team.glow.clone().multiplyScalar(1.4), { radius: 1.2, life: 0.6 });
  }

  // The arc each leg of a move takes, a little above the pieces.
  flightPoints(path) {
    const pts = [];
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k];
      const b = path[k + 1];
      const jump = Math.abs(rowOf(b) - rowOf(a)) === 2;
      const h = jump ? 1.25 : 0.45;
      const n = 10;
      for (let s = k === 0 ? 0 : 1; s <= n; s++) {
        const t = s / n;
        pts.push(
          new THREE.Vector3(
            squareX(a) + (squareX(b) - squareX(a)) * t,
            PIECE_H + 0.05 + h * Math.sin(Math.PI * t),
            squareZ(a) + (squareZ(b) - squareZ(a)) * t,
          ),
        );
      }
    }
    return pts;
  }

  // ── Last move marks ────────────────────────────────────────────────────

  markLastMove(move, before, animate) {
    this.clearLastMove();
    const color = TEAM[move.mover].glow.clone().multiplyScalar(1.5);
    const marks = [];
    move.path.forEach((sq, k) => {
      const kind = k === 0 ? 0 : k === move.path.length - 1 ? 2 : 1;
      marks.push([sq, kind]);
    });
    for (const { sq } of move.captured) marks.push([sq, 3]);
    for (const [sq, kind] of marks) {
      const u = this.board.overlay(sq);
      u.uLastKind.value = kind;
      u.uLastColor.value.copy(color);
      u.uLast.value = animate ? 0 : 1;
    }
    if (animate) void this.tweens.run(500, (e) => marks.forEach(([sq]) => (this.board.overlay(sq).uLast.value = e)), ease.outCubic);
    if (!this.trail.mesh) this.trail.set(this.flightPoints(move.path), TEAM[move.mover].glow.clone().multiplyScalar(1.6));
    this.trail.material.uniforms.uDraw.value = 1;
    this.lastMove = { move, before: before.slice(), prevLast: null };
  }

  clearLastMove() {
    for (const [, u] of this.board.overlays) u.uLast.value = 0;
    this.trail.clear();
    this.lastMove = null;
  }

  // ── Input ──────────────────────────────────────────────────────────────

  bindInput() {
    const el = this.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    let down = null;
    el.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (e.button === 2) {
        this.clearSelection();
        return;
      }
      if (moved < 7 && quick) this.click(this.pick(e));
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      this.setHover(this.pick(e));
    });
    el.addEventListener("pointerleave", () => this.setHover(null));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("dblclick", () => this.resetView());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.clearSelection();
    });
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const discs = [];
    for (const [, p] of this.pieces) discs.push(p.lower, p.upper);
    const hit = this.raycaster.intersectObjects(discs, false)[0];
    if (hit) {
      for (const [sq, p] of this.pieces) if (p === hit.object.userData.piece) return sq;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, pt)) return null;
    return squareAt(pt.x, pt.z);
  }

  canAct() {
    return this.interactive && !this.busy && this.queue.length === 0 && this.mySeat;
  }

  click(sq) {
    if (!this.canAct()) return;
    const tags = this.displayed;
    const seat = this.mySeat;
    if (sq === null || !isDark(sq)) {
      this.clearSelection();
      return;
    }
    const own = tags[sq] && ownerOf(tags[sq]) === seat;
    if (this.path.length === 0) {
      // Any of your pieces can be picked; one without a legal move just
      // shows no targets (and the backend explains if you insist).
      if (own) this.select([sq]);
      return;
    }
    if (own) {
      if (sq === this.path[0] && this.path.length === 1) this.clearSelection();
      else this.select([sq]);
      return;
    }
    const { targets } = selectionTargets(tags, seat, this.path);
    if (targets.has(sq)) {
      const act = targets.get(sq);
      if (act) this.submit(act);
      else this.select([...this.path, sq]);
      return;
    }
    // Not a move this client believes is legal, but a plausible shape for
    // one: let the backend judge it, so its own reason reaches the player.
    const cur = this.path[this.path.length - 1];
    const dr = Math.abs(rowOf(sq) - rowOf(cur));
    const dc = Math.abs(colOf(sq) - colOf(cur));
    if (tags[sq] === null && dr === 1 && dc === 1 && this.path.length === 1) {
      this.submit({ move: { from: this.path[0], to: sq } });
    } else if (tags[sq] === null && dr === 2 && dc === 2) {
      this.submit({ jump: { path: [...this.path, sq] } });
    } else {
      this.clearSelection();
    }
  }

  submit(action) {
    this.clearSelection();
    this.onAction?.(toWire(action));
  }

  select(path) {
    this.path = path;
    this.refreshHighlights();
  }

  clearSelection() {
    if (this.path.length === 0) return;
    this.path = [];
    this.refreshHighlights();
  }

  setHover(sq) {
    if (sq === this.hover) return;
    if (this.hover !== null && this.board.overlay(this.hover)) this.board.overlay(this.hover).uHover.value = 0;
    this.hover = sq !== null && isDark(sq) ? sq : null;
    const active = this.hover !== null && this.canAct();
    if (active) this.board.overlay(this.hover).uHover.value = 1;
    this.renderer.domElement.style.cursor = active ? "pointer" : "";
  }

  refreshHighlights() {
    const act = this.canAct();
    const seat = this.mySeat;
    const tags = this.displayed;
    const mine = seat ? TEAM[seat].glow.clone().multiplyScalar(1.6) : new THREE.Color();
    const movable = act ? movablePieces(tags, seat) : new Set();
    const { targets, captured } = act && this.path.length ? selectionTargets(tags, seat, this.path) : { targets: new Map(), captured: [] };
    for (const [i, u] of this.board.overlays) {
      u.uMineColor.value.copy(mine);
      u.uSelectable.value = act && movable.has(i) ? (this.path.length ? 0.35 : 1) : 0;
      u.uSelected.value = act && this.path[0] === i ? 1 : 0;
      u.uTarget.value = targets.has(i) ? 1 : 0;
      u.uTargetColor.value.copy(targets.get(i) ? TARGET_DONE : TARGET_MORE).multiplyScalar(1.5);
      u.uPending.value = captured.includes(i) ? 1 : 0;
    }
    for (const [sq, p] of this.pieces) p.liftTarget = act && this.path[0] === sq ? 0.28 : 0;

    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.material.dispose();
      this.ghost = null;
    }
    if (act && this.path.length > 1) {
      const end = this.path[this.path.length - 1];
      this.ghost = makeGhost(seat);
      this.ghost.position.set(squareX(end), 0.02, squareZ(end));
      this.scene.add(this.ghost);
    }
  }

  // ── Camera ─────────────────────────────────────────────────────────────

  seatPose(seat) {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const f = aspect < 1.25 ? Math.min(2.3, 1.3 / aspect) : 1;
    const s = seat === "p2" ? -1 : 1;
    return {
      pos: new THREE.Vector3(0, 12.4 * f, 9.6 * s * f),
      target: new THREE.Vector3(0, -0.5, 0.9 * s),
    };
  }

  setCameraSeat(seat, instant = false, force = false) {
    if (seat === this.cameraSeat && !force) return;
    this.cameraSeat = seat;
    const c = this.controls;
    if (seat === null) {
      c.autoRotate = true;
      const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
      const f = aspect < 1.25 ? Math.min(2.2, 1.35 / aspect) : 1;
      this.flyTo(new THREE.Vector3(10 * f, 7.5 * f, 11 * f), new THREE.Vector3(0, -0.6, 0), instant ? 0 : 1800);
      return;
    }
    c.autoRotate = false;
    const { pos, target } = this.seatPose(seat);
    this.flyTo(pos, target, instant ? 0 : 1600);
  }

  flyTo(pos, target, ms) {
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    if (ms === 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      return;
    }
    // Swing around the table rather than through it.
    const a0 = Math.atan2(fromPos.x, fromPos.z);
    const a1 = Math.atan2(pos.x, pos.z);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const r0 = Math.hypot(fromPos.x, fromPos.z);
    const r1 = Math.hypot(pos.x, pos.z);
    this.cameraTween = true;
    const auto = this.controls.autoRotate;
    this.controls.autoRotate = false;
    const token = (this.flyToken = {});
    void this.tweens.run(
      ms,
      (e) => {
        if (this.flyToken !== token) return;
        const a = a0 + da * e;
        const r = r0 + (r1 - r0) * e;
        this.camera.position.set(Math.sin(a) * r, fromPos.y + (pos.y - fromPos.y) * e, Math.cos(a) * r);
        this.controls.target.lerpVectors(fromTarget, target, e);
        this.camera.lookAt(this.controls.target);
        if (e >= 1) {
          this.cameraTween = false;
          this.controls.autoRotate = auto;
        }
      },
      ease.inOutCubic,
    );
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    if (this.cameraSeat !== undefined) this.setCameraSeat(this.cameraSeat, true, true);
  }

  // ── Frame loop ─────────────────────────────────────────────────────────

  /// Test hook: advances the scene `seconds` by hand, for a tab the
  /// browser keeps hidden (no requestAnimationFrame there). Pair with
  /// `snapWhenHidden = false` to watch the animations.
  async pump(seconds, fps = 30) {
    for (let t = 0; t < seconds; t += 1 / fps) {
      this.frame(1 / fps);
      for (let k = 0; k < 4; k++) await new Promise((r) => queueMicrotask(r));
    }
  }

  frame(dtOverride) {
    const now = performance.now();
    const dt = dtOverride ?? Math.min(0.1, (now - this.prevNow) / 1000);
    this.prevNow = now;
    this.time += dt;
    const t = this.time;

    this.tweens.tick(dt * 1000);
    if (!this.cameraTween) this.controls.update(dt);

    if (this.idleRim) {
      const k = 0.5 + 0.5 * Math.sin(t * 0.5);
      this.board.setRim(TEAM.p1.glow.clone().lerp(TEAM.p2.glow, k).multiplyScalar(1.8));
    }
    this.board.tick(t, dt);
    for (const [, p] of this.pieces) p.update(t, dt);
    if (this.ghost) this.ghost.material.opacity = 0.3 + 0.2 * Math.sin(t * 5);
    this.fx.tick(t);
    this.trail.tick(t);

    if (this.outcome === "win" && t < this.fireworksUntil && t >= this.nextFirework) {
      this.nextFirework = t + 0.35 + Math.random() * 0.5;
      const team = TEAM[this.mySeat ?? "p1"];
      const at = new THREE.Vector3((Math.random() - 0.5) * 9, 3.5 + Math.random() * 3, (Math.random() - 0.5) * 9);
      this.fx.firework(at, [team.glow, team.edge, team.ember, GOLD, new THREE.Color("#ffffff")]);
    }

    // Camera shake, applied for this frame only.
    let shake = null;
    if (this.shakeAmp > 0.001) {
      shake = new THREE.Vector3(
        (Math.random() - 0.5) * this.shakeAmp,
        (Math.random() - 0.5) * this.shakeAmp,
        (Math.random() - 0.5) * this.shakeAmp,
      );
      this.camera.position.add(shake);
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.composer.render();
    if (shake) this.camera.position.sub(shake);
  }
}
