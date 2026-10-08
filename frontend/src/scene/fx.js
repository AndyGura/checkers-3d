// One-shot effects, each animated entirely on the GPU from a start time:
// particle bursts (a captured piece turning to embers, promotion sparks,
// victory fireworks), shockwave rings, and the glowing flight trail of the
// last move.

import * as THREE from "three";

const PIXEL = () => Math.min(window.devicePixelRatio, 2);

const BURST_VERT = /* glsl */ `
  attribute vec3 aVel; attribute vec3 aColor; attribute float aSeed;
  uniform float uTime; uniform float uLife; uniform float uGravity; uniform float uSwirl; uniform float uSize; uniform float uPixel; uniform float uDrag;
  varying vec3 vColor; varying float vAlpha; varying float vHot;
  void main() {
    float life = uLife * (0.55 + 0.45 * aSeed);
    float t = min(uTime, life);
    float k = t / life;
    // Exponential drag: distance travelled saturates.
    float dist = (1.0 - exp(-uDrag * t)) / uDrag;
    vec3 p = position + aVel * dist;
    p.y += -0.5 * uGravity * t * t;
    float a = uSwirl * t * (0.5 + aSeed);
    vec2 xz = p.xz - position.xz;
    p.xz = position.xz + vec2(xz.x * cos(a) - xz.y * sin(a), xz.x * sin(a) + xz.y * cos(a));
    vColor = aColor;
    vAlpha = (uTime >= life) ? 0.0 : pow(1.0 - k, 1.4);
    vHot = 1.0 - smoothstep(0.0, 0.25, k);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.5 + aSeed) * (1.0 - 0.5 * k) * uPixel * (10.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const BURST_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha; varying float vHot;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float s = smoothstep(0.5, 0.05, d);
    vec3 c = mix(vColor, vec3(1.0, 0.95, 0.85), vHot * 0.6);
    gl_FragColor = vec4(c * s * vAlpha * 2.2, 1.0);
  }`;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.live = []; // { obj, born, life, update?(age) }
    this.time = 0;
  }

  /// `origin`: Vector3. `shape(i, out)` writes a start offset; `vel(i, out)`
  /// a velocity. Colors are picked from `palette` at random.
  burst({ origin, count, life, shape, vel, palette, gravity = 0, swirl = 0, size = 6, drag = 1.2 }) {
    const pos = new Float32Array(count * 3);
    const v = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      shape(i, tmp);
      tmp.add(origin);
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
      vel(i, tmp);
      v.set([tmp.x, tmp.y, tmp.z], i * 3);
      const c = palette[(Math.random() * palette.length) | 0];
      col.set([c.r, c.g, c.b], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aVel", new THREE.BufferAttribute(v, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: life },
        uGravity: { value: gravity },
        uSwirl: { value: swirl },
        uSize: { value: size },
        uPixel: { value: PIXEL() },
        uDrag: { value: drag },
      },
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.add(pts, life, (age) => (m.uniforms.uTime.value = age));
  }

  /// A captured piece turning to ash and embers: sampled from its disc's
  /// volume, drifting up and swirling away.
  dissolveBurst(origin, team) {
    const R = 0.42;
    this.burst({
      origin,
      count: 900,
      life: 2.2,
      size: 5,
      gravity: -0.35,
      swirl: 1.6,
      drag: 1.5,
      palette: [team.edge, team.ember, team.glow, team.base.clone().multiplyScalar(2.5), new THREE.Color("#ffffff")],
      shape: (i, out) => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        out.set(Math.cos(a) * r, Math.random() * 0.16, Math.sin(a) * r);
      },
      vel: (i, out) => {
        const a = Math.random() * Math.PI * 2;
        const s = 0.4 + Math.random() * 1.6;
        out.set(Math.cos(a) * s, 0.6 + Math.random() * 2.2, Math.sin(a) * s);
      },
    });
  }

  /// Sparks fountaining from a promoted piece.
  crownBurst(origin, team) {
    this.burst({
      origin,
      count: 700,
      life: 1.8,
      size: 6,
      gravity: 4.5,
      drag: 0.6,
      swirl: 0.8,
      palette: [new THREE.Color("#ffd27a"), new THREE.Color("#fff3c4"), team.glow, team.edge],
      shape: (i, out) => out.set((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3),
      vel: (i, out) => {
        const a = Math.random() * Math.PI * 2;
        const s = 0.6 + Math.random() * 2.4;
        out.set(Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s);
      },
    });
  }

  /// A victory shell bursting in the sky over the board.
  firework(origin, colors) {
    this.burst({
      origin,
      count: 650,
      life: 2.4,
      size: 7,
      gravity: 1.6,
      drag: 1.8,
      palette: colors,
      shape: (i, out) => out.set(0, 0, 0),
      vel: (i, out) => {
        // Uniform on a sphere, with a dense shell.
        const u = Math.random() * 2 - 1;
        const a = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const speed = 3.6 + Math.random() * 1.2;
        out.set(s * Math.cos(a) * speed, u * speed, s * Math.sin(a) * speed);
      },
    });
  }

  /// A flat expanding ring on the board.
  shockwave(origin, color, { radius = 1.6, life = 0.9, width = 0.12, intensity = 3 } = {}) {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uK: { value: 0 }, uColor: { value: color.clone() }, uW: { value: width }, uI: { value: intensity } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uK; uniform vec3 uColor; uniform float uW; uniform float uI;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(uK - uW, uK, r) * (1.0 - smoothstep(uK, uK + uW * 0.4, r));
          float inner = (1.0 - smoothstep(0.0, uK, r)) * 0.15;
          float a = (ring + inner) * pow(1.0 - uK, 1.3);
          gl_FragColor = vec4(uColor * a * uI, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(origin);
    mesh.position.y += 0.02;
    mesh.renderOrder = 3;
    this.add(mesh, life, (age) => (m.uniforms.uK.value = Math.min(1, age / life)));
  }

  add(obj, life, update) {
    this.scene.add(obj);
    this.live.push({ obj, born: this.time, life, update });
  }

  tick(time) {
    this.time = time;
    if (this.live.length === 0) return;
    const keep = [];
    for (const e of this.live) {
      const age = time - e.born;
      if (age > e.life + 0.05) {
        this.scene.remove(e.obj);
        e.obj.geometry.dispose();
        e.obj.material.dispose();
      } else {
        e.update?.(age);
        keep.push(e);
      }
    }
    this.live = keep;
  }
}

/// The last move's flight path: a glowing tube that draws itself along
/// the arc, then keeps flowing softly until the next move replaces it.
export class Trail {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDraw: { value: 0 },
        uFade: { value: 0 },
        uColor: { value: new THREE.Color() },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uTime; uniform float uDraw; uniform float uFade; uniform vec3 uColor;
        void main() {
          if (vUv.x > uDraw) discard;
          float flow = 0.55 + 0.45 * sin((vUv.x * 18.0 - uTime * 5.0));
          float head = smoothstep(uDraw - 0.12, uDraw, vUv.x) * step(uDraw, 0.999);
          float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
          float a = (0.25 + 0.35 * flow + head * 2.0) * ends * uFade;
          gl_FragColor = vec4(uColor * a * 1.6, 1.0);
        }`,
    });
  }

  /// `points`: world positions the piece passed through (already arced).
  set(points, color) {
    this.clear();
    const curve = new THREE.CatmullRomCurve3(points);
    const g = new THREE.TubeGeometry(curve, Math.max(24, points.length * 6), 0.028, 8, false);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.renderOrder = 4;
    this.material.uniforms.uColor.value.copy(color);
    this.material.uniforms.uDraw.value = 0;
    this.material.uniforms.uFade.value = 1;
    this.scene.add(this.mesh);
  }

  clear() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  tick(time) {
    this.material.uniforms.uTime.value = time;
  }
}
