// A tiny frame-driven tween runner. Every tween advances on the scene's
// own clock (scaled by `timeScale`, which the board raises to catch up when
// views queue up) and resolves a Promise when done.

export const ease = {
  linear: (k) => k,
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inCubic: (k) => k * k * k,
  outQuad: (k) => 1 - (1 - k) * (1 - k),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
  outBack: (k) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
  outElastic: (k) => {
    if (k === 0 || k === 1) return k;
    return Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (k) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (k < 1 / d1) return n1 * k * k;
    if (k < 2 / d1) return n1 * (k -= 1.5 / d1) * k + 0.75;
    if (k < 2.5 / d1) return n1 * (k -= 2.25 / d1) * k + 0.9375;
    return n1 * (k -= 2.625 / d1) * k + 0.984375;
  },
};

export class Tweens {
  constructor() {
    this.list = [];
    this.timeScale = 1;
  }

  /// `update(k)` gets the eased progress 0..1 every frame, then exactly 1.
  run(durationMs, update, easing = ease.linear, delayMs = 0) {
    return new Promise((resolve) => {
      this.list.push({ elapsed: -delayMs, durationMs, update, easing, resolve });
    });
  }

  wait(ms) {
    return this.run(ms, () => {});
  }

  /// Finishes every running tween at once (their last frame still runs).
  finishAll() {
    for (const t of this.list) t.elapsed = t.durationMs;
    this.tick(0);
  }

  tick(dtMs) {
    if (this.list.length === 0) return;
    const step = dtMs * this.timeScale;
    const done = [];
    for (const t of this.list) {
      t.elapsed += step;
      if (t.elapsed < 0) continue;
      const k = t.durationMs <= 0 ? 1 : Math.min(1, t.elapsed / t.durationMs);
      t.update(t.easing(k), k);
      if (k >= 1) done.push(t);
    }
    if (done.length) {
      this.list = this.list.filter((t) => !done.includes(t));
      for (const t of done) t.resolve();
    }
  }
}
