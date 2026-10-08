// Checker pieces: a turned (lathe) disc with a recessed face, a glossy
// clear-coated material per piece, a dissolve shader (noise threshold with
// a burning edge) for captures, and a king form: stacked double disc,
// polished metal, a glowing crown, a halo and orbiting sparks.

import * as THREE from "three";

export const TEAM = {
  p1: {
    base: new THREE.Color("#0c0d11"),
    king: new THREE.Color("#3a4150"),
    glow: new THREE.Color("#46c8ff"),
    edge: new THREE.Color("#5fd4ff"),
    ember: new THREE.Color("#9ee7ff"),
  },
  p2: {
    base: new THREE.Color("#a3101b"),
    king: new THREE.Color("#ff7a3d"),
    glow: new THREE.Color("#ff5a2a"),
    edge: new THREE.Color("#ffb04a"),
    ember: new THREE.Color("#ffcf6b"),
  },
};

export const PIECE_H = 0.15;
const PIVOT_Y = 0.1;
const R = 0.4;

function discGeometry() {
  // (radius, height) profile, bottom to top, spun around Y.
  const p = [
    [0, 0],
    [R - 0.03, 0],
    [R, 0.02],
    [R + 0.01, 0.045],
    [R - 0.005, 0.06],
    [R + 0.01, 0.08],
    [R - 0.005, 0.095],
    [R + 0.01, 0.115],
    [R, PIECE_H - 0.012],
    [R - 0.025, PIECE_H],
    [R - 0.07, PIECE_H],
    [R - 0.09, PIECE_H - 0.018],
    [R - 0.12, PIECE_H - 0.018],
    [R - 0.14, PIECE_H - 0.004],
    [R - 0.2, PIECE_H - 0.004],
    [R - 0.215, PIECE_H - 0.016],
    [0, PIECE_H - 0.016],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(p, 72);
  g.computeVertexNormals();
  return g;
}

function crownGeometry() {
  const parts = [];
  const band = new THREE.TorusGeometry(0.2, 0.035, 12, 48);
  band.rotateX(Math.PI / 2);
  parts.push(band);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const spike = new THREE.ConeGeometry(0.045, 0.16, 10);
    spike.translate(Math.cos(a) * 0.2, 0.09, Math.sin(a) * 0.2);
    parts.push(spike);
    const gem = new THREE.SphereGeometry(0.032, 12, 8);
    gem.translate(Math.cos(a) * 0.2, 0.18, Math.sin(a) * 0.2);
    parts.push(gem);
  }
  return mergeGeometries(parts);
}

// Merges plain non-indexed copies (enough for a handful of primitives;
// avoids pulling in BufferGeometryUtils for one call).
function mergeGeometries(geoms) {
  const flat = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = flat.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

const DISC = discGeometry();
const CROWN = crownGeometry();

// Shared GLSL: 3D value noise, used by the dissolve threshold.
const NOISE = /* glsl */ `
  float dsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dsNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dsHash(i + vec3(0,0,0)), dsHash(i + vec3(1,0,0)), f.x),
                   mix(dsHash(i + vec3(0,1,0)), dsHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(dsHash(i + vec3(0,0,1)), dsHash(i + vec3(1,0,1)), f.x),
                   mix(dsHash(i + vec3(0,1,1)), dsHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float dsFbm(vec3 p) { return 0.6 * dsNoise(p) + 0.3 * dsNoise(p * 2.13) + 0.1 * dsNoise(p * 4.37); }
`;

/// Adds `uDissolve` (0 = solid, 1 = gone) and a hot `uEdgeColor` rim to a
/// standard/physical material.
function addDissolve(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniforms.uDissolve;
    shader.uniforms.uEdgeColor = uniforms.uEdgeColor;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDsPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDsPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vDsPos;\nuniform float uDissolve;\nuniform vec3 uEdgeColor;\n${NOISE}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
         float dsN = dsFbm(vDsPos * 11.0) * 0.85 + (vDsPos.y / ${PIECE_H * 2.0}) * 0.15;
         if (uDissolve > 0.0 && dsN < uDissolve * 1.08) discard;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         if (uDissolve > 0.0) {
           float dsEdge = 1.0 - smoothstep(uDissolve * 1.08, uDissolve * 1.08 + 0.09, dsN);
           totalEmissiveRadiance += uEdgeColor * dsEdge * 9.0;
         }`,
      );
  };
  material.customProgramCacheKey = () => "checkers-dissolve";
}

let haloTexture = null;
function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

/// Sparks circling a king, animated entirely in the vertex shader.
function makeSparks(color) {
  const n = 28;
  const seeds = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    seeds[i * 3] = Math.random() * Math.PI * 2; // phase
    seeds[i * 3 + 1] = 0.35 + Math.random() * 0.18; // radius
    seeds[i * 3 + 2] = Math.random(); // speed / height seed
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color.clone() },
      uScale: { value: 0 },
      uPixel: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed; uniform float uTime; uniform float uScale; uniform float uPixel; varying float vA;
      void main() {
        float a = aSeed.x + uTime * (0.6 + aSeed.z * 1.2);
        float h = 0.12 + mod(aSeed.z * 7.0 + uTime * (0.15 + aSeed.z * 0.25), 1.0) * 0.55;
        vec3 p = vec3(cos(a) * aSeed.y, h, sin(a) * aSeed.y) * uScale;
        vA = (1.0 - smoothstep(0.45, 0.67, h)) * (0.6 + 0.4 * sin(uTime * 6.0 + aSeed.x * 9.0)) * uScale;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + aSeed.z * 3.0) * uPixel * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float s = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor * 2.5 * s * vA + vec3(1.0) * pow(s, 6.0) * vA, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/// One piece on the board. `group` is positioned by the board; `body`
/// holds the discs (lifted/flipped during a jump).
export class Piece {
  constructor(tag) {
    this.seat = tag.endsWith("P1") ? "p1" : "p2";
    this.team = TEAM[this.seat];
    this.king = false;
    this.kingAmount = 0; // 0..1, animates the transformation
    this.uniforms = {
      uDissolve: { value: 0 },
      uEdgeColor: { value: this.team.edge.clone() },
    };

    this.material = new THREE.MeshPhysicalMaterial({
      color: this.team.base.clone(),
      roughness: this.seat === "p1" ? 0.34 : 0.3,
      metalness: 0.12,
      clearcoat: this.seat === "p1" ? 0.55 : 1,
      clearcoatRoughness: this.seat === "p1" ? 0.22 : 0.12,
      emissive: this.team.glow.clone(),
      emissiveIntensity: 0,
      envMapIntensity: this.manEnv(),
    });
    addDissolve(this.material, this.uniforms);

    this.crownMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#ffd27a"),
      metalness: 1,
      roughness: 0.18,
      emissive: this.team.glow.clone().lerp(new THREE.Color("#ffd27a"), 0.45),
      emissiveIntensity: 2.2,
    });
    addDissolve(this.crownMaterial, this.uniforms);

    // group (board position) > pivot (piece centre: lifts, flips, spins)
    // > body (the discs, crown, halo and sparks).
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = PIVOT_Y;
    this.group.add(this.pivot);
    this.body = new THREE.Group();
    this.body.position.y = -PIVOT_Y;
    this.pivot.add(this.body);
    this.lift = 0; // eased toward `liftTarget` every frame
    this.liftTarget = 0;

    this.lower = new THREE.Mesh(DISC, this.material);
    this.lower.castShadow = true;
    this.lower.receiveShadow = true;
    this.body.add(this.lower);

    this.upper = new THREE.Mesh(DISC, this.material);
    this.upper.castShadow = true;
    this.upper.position.y = PIECE_H;
    this.upper.visible = false;
    this.body.add(this.upper);

    this.crown = new THREE.Mesh(CROWN, this.crownMaterial);
    this.crown.position.y = PIECE_H * 2 - 0.01;
    this.crown.visible = false;
    this.body.add(this.crown);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getHaloTexture(),
        color: this.team.glow.clone(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.halo.scale.setScalar(1.7);
    this.halo.position.y = 0.2;
    this.halo.visible = false;
    this.body.add(this.halo);

    this.sparks = makeSparks(this.team.glow);
    this.sparks.visible = false;
    this.body.add(this.sparks);

    // Raycast hits on any child find their piece through this.
    this.group.traverse((o) => (o.userData.piece = this));
    if (tag.startsWith("king")) this.setKingAmount(1);
  }

  // Black men reflect less, or the studio environment turns them silver.
  manEnv() {
    return this.seat === "p1" ? 0.4 : 0.9;
  }

  /// 0 = man, 1 = king; in between is the transformation.
  setKingAmount(k) {
    this.kingAmount = k;
    this.king = k >= 1;
    const t = this.team;
    const m = this.material;
    m.color.copy(t.base).lerp(t.king, k);
    m.metalness = 0.12 + 0.86 * k;
    m.roughness = (this.seat === "p1" ? 0.34 : 0.3) * (1 - k) + 0.08 * k;
    m.emissiveIntensity = 0.32 * k;
    m.envMapIntensity = this.manEnv() + (2.4 - this.manEnv()) * k;
    m.clearcoat = (this.seat === "p1" ? 0.55 : 1) * (1 - k) + k;
    m.clearcoatRoughness = (this.seat === "p1" ? 0.22 : 0.12) * (1 - k) + 0.05 * k;
    const on = k > 0;
    this.upper.visible = on;
    this.crown.visible = on;
    this.halo.visible = on;
    this.sparks.visible = on;
    this.upper.position.y = PIECE_H * Math.min(1, k * 1.4);
    this.upper.scale.setScalar(Math.min(1, 0.3 + k));
    const cs = THREE.MathUtils.clamp((k - 0.35) / 0.65, 0, 1);
    this.crown.scale.setScalar(cs);
    this.crown.position.y = this.upper.position.y + PIECE_H - 0.01;
    this.halo.material.opacity = 0.5 * k;
    this.sparks.material.uniforms.uScale.value = k;
  }

  setDissolve(v) {
    this.uniforms.uDissolve.value = v;
    this.halo.material.opacity = 0.5 * this.kingAmount * (1 - v);
  }

  /// Per-frame idle life: kings breathe and their crowns turn.
  update(time, dt) {
    this.lift += (this.liftTarget - this.lift) * (1 - Math.exp(-dt * 10));
    const bob = this.liftTarget > 0 ? Math.sin(time * 3.2) * 0.035 : 0;
    this.pivot.position.y = PIVOT_Y + this.lift + bob;
    if (this.kingAmount <= 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + this.group.position.x * 1.3);
    this.material.emissiveIntensity = (0.22 + 0.22 * pulse) * this.kingAmount;
    this.crownMaterial.emissiveIntensity = 1.6 + 1.4 * pulse;
    this.crown.rotation.y = time * 0.6;
    this.halo.scale.setScalar(1.5 + 0.35 * pulse);
    this.sparks.material.uniforms.uTime.value = time;
  }

  dispose() {
    this.material.dispose();
    this.crownMaterial.dispose();
    this.halo.material.dispose();
    this.sparks.geometry.dispose();
    this.sparks.material.dispose();
  }
}

/// A translucent stand-in showing where a capture chain being chosen has
/// got to.
export function makeGhost(seat) {
  const m = new THREE.MeshBasicMaterial({
    color: TEAM[seat].glow.clone().multiplyScalar(0.9),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(DISC, m);
  mesh.position.y = 0.02;
  return mesh;
}
