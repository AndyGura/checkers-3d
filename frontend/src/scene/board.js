// The board and its surroundings: a beveled obsidian slab with a neon rim
// (lit in the colour of the seat on turn), a procedurally painted top
// (veined ivory and dark slate squares, coordinates on the frame), one
// overlay per dark square that draws the last-move marks, legal targets,
// selection and hover, a holographic arena floor, and a starfield.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { SIZE, colOf, idx, isDark, rowOf } from "../checkers-rules.js";

export const squareX = (i) => colOf(i) - 3.5;
export const squareZ = (i) => rowOf(i) - 3.5;
export function squareAt(x, z) {
  const c = Math.floor(x + 4);
  const r = Math.floor(z + 4);
  if (c < 0 || c >= SIZE || r < 0 || r >= SIZE) return null;
  return idx(r, c);
}

const FRAME = 0.62; // frame width beyond the 8x8 squares, in squares

function paintTop() {
  const px = 2048;
  const total = SIZE + FRAME * 2;
  const unit = px / total;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");

  // Frame: dark lacquer with a fine inner gold line.
  g.fillStyle = "#0b0d12";
  g.fillRect(0, 0, px, px);
  const o = FRAME * unit;

  // Seeded noise so the board looks the same on every load.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  for (let r = 0; r < SIZE; r++) {
    for (let col = 0; col < SIZE; col++) {
      const x = o + col * unit;
      const y = o + r * unit;
      const dark = (r + col) % 2 === 1;
      const grad = g.createLinearGradient(x, y, x + unit, y + unit);
      if (dark) {
        grad.addColorStop(0, "#1a2a31");
        grad.addColorStop(1, "#0f1a20");
      } else {
        grad.addColorStop(0, "#c2b6a0");
        grad.addColorStop(1, "#a89b83");
      }
      g.fillStyle = grad;
      g.fillRect(x, y, unit, unit);
      // Veins.
      g.save();
      g.beginPath();
      g.rect(x, y, unit, unit);
      g.clip();
      for (let v = 0; v < (dark ? 4 : 6); v++) {
        g.beginPath();
        let vx = x + rnd() * unit;
        let vy = y;
        g.moveTo(vx, vy);
        for (let s = 0; s < 8; s++) {
          vx += (rnd() - 0.5) * unit * 0.35;
          vy += unit / 7;
          g.lineTo(vx, vy);
        }
        g.strokeStyle = dark ? `rgba(90,170,190,${0.05 + rnd() * 0.07})` : `rgba(120,100,80,${0.08 + rnd() * 0.12})`;
        g.lineWidth = 0.6 + rnd() * 2.2;
        g.stroke();
      }
      g.restore();
    }
  }
  // Grid seams.
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.lineWidth = 2;
  for (let k = 0; k <= SIZE; k++) {
    g.beginPath();
    g.moveTo(o + k * unit, o);
    g.lineTo(o + k * unit, o + SIZE * unit);
    g.moveTo(o, o + k * unit);
    g.lineTo(o + SIZE * unit, o + k * unit);
    g.stroke();
  }
  g.strokeStyle = "rgba(214,178,106,0.75)";
  g.lineWidth = 4;
  g.strokeRect(o - 10, o - 10, SIZE * unit + 20, SIZE * unit + 20);
  g.strokeStyle = "rgba(214,178,106,0.3)";
  g.lineWidth = 1.5;
  g.strokeRect(o - 22, o - 22, SIZE * unit + 44, SIZE * unit + 44);

  // Coordinates, readable from both ends of the table.
  g.fillStyle = "rgba(214,178,106,0.85)";
  g.font = `600 ${Math.round(unit * 0.26)}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 0; k < SIZE; k++) {
    const letter = String.fromCharCode(97 + k);
    const number = String(SIZE - k);
    const mid = o + (k + 0.5) * unit;
    g.fillText(letter, mid, px - o / 2); // near Black (row 7 side)
    g.fillText(number, o / 2, mid);
    g.save();
    g.translate(mid, o / 2);
    g.rotate(Math.PI);
    g.fillText(letter, 0, 0); // near Red, upside down for Black
    g.restore();
    g.save();
    g.translate(px - o / 2, mid);
    g.rotate(Math.PI);
    g.fillText(number, 0, 0);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const OVERLAY_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

// kinds for uLastKind: 0 from, 1 via, 2 to, 3 captured
const OVERLAY_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uLast; uniform float uLastKind; uniform vec3 uLastColor;
  uniform float uTarget; uniform vec3 uTargetColor;
  uniform float uSelectable; uniform float uSelected; uniform float uHover; uniform float uPending;
  uniform vec3 uMineColor;
  float box(vec2 p, float a, float b) { float d = max(abs(p.x), abs(p.y)); return smoothstep(a - 0.012, a, d) * (1.0 - smoothstep(b, b + 0.012, d)); }
  void main() {
    vec2 p = vUv - 0.5;
    float d = max(abs(p.x), abs(p.y));
    float r = length(p);
    vec3 col = vec3(0.0);

    if (uLast > 0.0) {
      float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
      if (uLastKind < 0.5) {
        col += uLastColor * (box(p, 0.42, 0.47) * 1.1 + 0.08);
      } else if (uLastKind < 1.5) {
        col += uLastColor * ((1.0 - smoothstep(0.07, 0.09, r)) * 1.6 + box(p, 0.44, 0.47) * 0.6);
      } else if (uLastKind < 2.5) {
        col += uLastColor * (0.07 + 0.05 * pulse + box(p, 0.40, 0.47) * (1.5 + pulse));
      } else {
        // Scorch where a captured piece burned away.
        float ember = 0.65 + 0.35 * sin(uTime * 4.0 + p.x * 30.0) * sin(uTime * 3.1 + p.y * 27.0);
        float burn = (1.0 - smoothstep(0.05, 0.38, r));
        col += vec3(1.0, 0.36, 0.08) * burn * 0.55 * ember;
        float cross = (1.0 - smoothstep(0.012, 0.03, abs(p.x - p.y))) + (1.0 - smoothstep(0.012, 0.03, abs(p.x + p.y)));
        col += uLastColor * cross * step(r, 0.24) * 0.5;
      }
      col *= uLast;
    }

    if (uSelectable > 0.0) {
      // Corner brackets around a piece you can move.
      float corner = box(p, 0.43, 0.47) * step(0.3, min(abs(p.x), abs(p.y)));
      float breathe = 0.6 + 0.4 * sin(uTime * 2.5);
      col += uMineColor * corner * 1.4 * breathe * uSelectable;
    }
    if (uSelected > 0.0) {
      col += uMineColor * (box(p, 0.40, 0.47) * 2.4 + 0.16) * uSelected;
    }
    if (uTarget > 0.0) {
      float t = fract(uTime * 0.9);
      float ring = smoothstep(0.03, 0.0, abs(r - (0.12 + 0.24 * t))) * (1.0 - t);
      float core = smoothstep(0.03, 0.0, abs(r - 0.2));
      col += uTargetColor * (ring * 2.0 + core * 1.4 + 0.1) * uTarget;
    }
    if (uPending > 0.0) {
      col += vec3(1.0, 0.25, 0.15) * (box(p, 0.30, 0.36) * 1.6) * uPending * (0.6 + 0.4 * sin(uTime * 8.0));
    }
    if (uHover > 0.0) {
      col += vec3(1.0) * (0.06 + box(p, 0.45, 0.48) * 0.35) * uHover;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Board {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = { value: 0 };

    // Slab.
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(SIZE + FRAME * 2 + 0.3, 0.6, SIZE + FRAME * 2 + 0.3, 6, 0.14),
      new THREE.MeshPhysicalMaterial({
        color: "#0a0c11",
        metalness: 0.55,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.15,
      }),
    );
    slab.position.y = -0.3;
    slab.receiveShadow = true;
    this.group.add(slab);

    // Painted top.
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE + FRAME * 2, SIZE + FRAME * 2),
      new THREE.MeshPhysicalMaterial({
        map: paintTop(),
        roughness: 0.55,
        metalness: 0.0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.45,
      }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.001;
    top.receiveShadow = true;
    this.group.add(top);
    this.top = top;

    // Neon rim: a glowing band hugging the slab.
    this.rimMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#46c8ff"), toneMapped: false });
    const w = SIZE + FRAME * 2 + 0.34;
    const rimShape = new THREE.Shape();
    const h = w / 2;
    rimShape.moveTo(-h, -h);
    rimShape.lineTo(h, -h);
    rimShape.lineTo(h, h);
    rimShape.lineTo(-h, h);
    rimShape.lineTo(-h, -h);
    const hole = new THREE.Path();
    const hi = h - 0.035;
    hole.moveTo(-hi, -hi);
    hole.lineTo(-hi, hi);
    hole.lineTo(hi, hi);
    hole.lineTo(hi, -hi);
    hole.lineTo(-hi, -hi);
    rimShape.holes.push(hole);
    const rim = new THREE.Mesh(new THREE.ShapeGeometry(rimShape), this.rimMaterial);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.42;
    rim.scale.setScalar(1.002);
    this.group.add(rim);
    const rimTop = rim.clone();
    rimTop.position.y = 0.004;
    rimTop.scale.setScalar(0.985);
    this.group.add(rimTop);
    this.rimColor = this.rimMaterial.color;
    this.rimTarget = this.rimMaterial.color.clone();

    // Square overlays (dark squares only).
    this.overlays = new Map();
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (!isDark(i)) continue;
      const m = new THREE.ShaderMaterial({
        vertexShader: OVERLAY_VERT,
        fragmentShader: OVERLAY_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: this.time,
          uLast: { value: 0 },
          uLastKind: { value: 0 },
          uLastColor: { value: new THREE.Color() },
          uTarget: { value: 0 },
          uTargetColor: { value: new THREE.Color("#7dffb2") },
          uSelectable: { value: 0 },
          uSelected: { value: 0 },
          uHover: { value: 0 },
          uPending: { value: 0 },
          uMineColor: { value: new THREE.Color("#ffffff") },
        },
      });
      const mesh = new THREE.Mesh(plane, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(squareX(i), 0.006, squareZ(i));
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.overlays.set(i, m.uniforms);
    }

    this.addFloor(scene);
    this.addStars(scene);
    this.addDust(scene);
  }

  addFloor(scene) {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: this.time, uColor: { value: this.rimColor } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vP; uniform float uTime; uniform vec3 uColor;
        void main() {
          float r = length(vP);
          vec2 g = abs(fract(vP * 0.5) - 0.5) / fwidth(vP * 0.5);
          float grid = 1.0 - min(min(g.x, g.y), 1.0);
          float rings = smoothstep(0.44, 0.5, abs(fract(r * 0.25 - uTime * 0.08) - 0.5));
          float fade = exp(-r * 0.09) * smoothstep(5.5, 7.5, r);
          vec3 c = uColor * (grid * 0.12 + rings * 0.16) * fade;
          c += vec3(0.02, 0.03, 0.06) * exp(-r * 0.15);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(48, 96), m);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.4;
    scene.add(floor);
  }

  addStars(scene) {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 0.9 + 0.05;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 70 + Math.random() * 30;
      pos.set([s * Math.cos(a) * R, u * R - 8, s * Math.sin(a) * R], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time, uPixel: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPixel; varying float vA;
        void main() {
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 40.0));
          vA *= 0.4 + aSeed * 0.6;
          gl_PointSize = (1.0 + aSeed * 2.2) * uPixel;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vec3(0.75,0.85,1.0) * smoothstep(0.5,0.0,d) * vA, 1.0); }`,
    });
    scene.add(new THREE.Points(g, m));
  }

  // Slow embers rising around the table.
  addDust(scene) {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 12;
      pos.set([Math.cos(a) * r, Math.random() * 8 - 1.4, Math.sin(a) * r], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time, uColor: { value: this.rimColor }, uPixel: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPixel; varying float vA;
        void main() {
          vec3 p = position;
          p.y = -1.4 + mod(position.y + 1.4 + uTime * (0.12 + aSeed * 0.25), 9.0);
          p.x += sin(uTime * 0.3 + aSeed * 20.0) * 0.4;
          vA = smoothstep(-1.4, 0.0, p.y) * (1.0 - smoothstep(5.0, 7.6, p.y)) * (0.4 + 0.6 * aSeed);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + aSeed * 3.0) * uPixel * (12.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(uColor * smoothstep(0.5,0.0,d) * vA * 0.9, 1.0); }`,
    });
    scene.add(new THREE.Points(g, m));
  }

  setRim(color) {
    this.rimTarget.copy(color);
  }

  tick(time, dt) {
    this.time.value = time;
    this.rimColor.lerp(this.rimTarget, 1 - Math.exp(-dt * 4));
  }

  overlay(i) {
    return this.overlays.get(i);
  }
}
