/**
 * Registry of JARVIS Core Visualizer engines.
 * Uniforms provided by JarvisOrb.tsx:
 *   uColor (vec3), uSecondary (vec3), uEnergy (float), uTime (float), uAudio (float 0..1)
 */

export type OrbStyleId =
  | "reactor"
  | "neural"
  | "tesseract"
  | "plasma"
  | "holo"
  | "swirl"
  | "core";

export interface OrbStyle {
  id: OrbStyleId;
  label: string;
  description: string;
  geometry: "icosahedron" | "octahedron" | "torusKnot" | "wireShell";
  frag: string;
  glowScale: number;
  dispScale: number;
  preview: string;
}

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const FBM = /* glsl */ `
float fbm(vec3 p){
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    f += a * snoise(p);
    p = p * 2.03 + vec3(11.7, 5.3, 7.1);
    a *= 0.5;
  }
  return f;
}
`;

const REACTOR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSecondary;
uniform float uEnergy;
uniform float uTime;
uniform float uAudio;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.9);
  float angle = atan(vObjPos.z, vObjPos.x);
  float blades = smoothstep(0.35, 0.92, cos(angle * 10.0 + uTime * 1.4));
  float rings = smoothstep(0.65, 0.98, sin(length(vObjPos.xy) * 18.0 - uTime * 2.2));
  vec3 base = mix(vec3(0.02, 0.05, 0.10), uColor * 0.45, blades * 0.55);
  vec3 coreGlow = mix(uColor, uSecondary, rings * 0.4) * (0.45 + uAudio * 0.8 + blades * 0.4);
  vec3 col = mix(base, coreGlow, clamp(fres * 0.85 + rings * 0.35, 0.0, 1.0)) * uEnergy;
  col += vec3(0.85, 0.97, 1.0) * pow(fres, 3.0) * (0.4 + uAudio * 0.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

const NEURAL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSecondary;
uniform float uEnergy;
uniform float uTime;
uniform float uAudio;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
${NOISE}
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.6);
  float net = abs(snoise(vObjPos * 3.8 + vec3(uTime * 0.25)));
  float synapse = smoothstep(0.18, 0.02, net);
  vec3 col = vec3(0.02, 0.04, 0.09);
  col += mix(uColor, uSecondary, 0.35) * synapse * (1.2 + uAudio * 0.9) * uEnergy;
  col += uColor * fres * 0.65 * uEnergy;
  gl_FragColor = vec4(col, 1.0);
}
`;

const TESSERACT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSecondary;
uniform float uEnergy;
uniform float uTime;
uniform float uAudio;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.8);
  float facet = max(dot(N, normalize(vec3(0.5, 0.8, 0.6))), 0.0);
  vec3 edge = mix(uColor, uSecondary, sin(uTime + vObjPos.y * 3.0) * 0.5 + 0.5);
  vec3 col = edge * (0.22 + facet * 0.55 + fres * 0.95) * (0.85 + uAudio * 0.5) * uEnergy;
  gl_FragColor = vec4(col, 1.0);
}
`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uEnergy;
varying vec3 vViewPos;
varying float vDisp;
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2);
  vec3 core = vec3(0.01, 0.03, 0.07);
  vec3 col = mix(core, uColor, fres * uEnergy);
  col += uColor * (0.5 + vDisp * 2.5) * 0.16 * uEnergy;
  float spec = pow(max(dot(N, normalize(vec3(0.4, 0.7, 0.6))), 0.0), 24.0);
  col += vec3(0.8, 0.95, 1.0) * spec * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SWIRL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uEnergy;
uniform float uTime;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
${NOISE}
${FBM}
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.7);
  vec3 p = vObjPos;
  vec2 warp = vec2(fbm(p * 1.4 + uTime * 0.06), fbm(p * 1.4 + vec3(4.7) - uTime * 0.04));
  float bands = fbm(vec3(p.x * 1.5, p.y * 4.2, p.z * 1.5) + vec3(warp, 0.0) * 0.9);
  float swirl = smoothstep(-0.55, 0.85, bands + 0.15);
  vec3 deep = uColor * 0.16;
  vec3 mid = uColor * 0.75;
  vec3 hot = mix(uColor, vec3(0.75, 0.97, 1.0), 0.55) * 1.35;
  vec3 col = mix(deep, mid, swirl);
  col = mix(col, hot, smoothstep(0.62, 1.0, swirl) * 0.85);
  col += uColor * fres * (0.35 + 0.45 * uEnergy);
  float spec = pow(max(dot(N, normalize(vec3(0.4, 0.7, 0.6))), 0.0), 18.0);
  col += vec3(0.85, 0.96, 1.0) * spec * 0.28 * uEnergy;
  col += uColor * max(vDisp, 0.0) * 1.4 * uEnergy;
  gl_FragColor = vec4(col, 1.0);
}
`;

const PLASMA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uEnergy;
uniform float uTime;
uniform float uAudio;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
${NOISE}
${FBM}
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.5);
  float n = fbm(vObjPos * 2.4 + vec3(0.0, -uTime * 0.35, uTime * 0.15));
  float ridge = clamp(1.0 - abs(n) * 1.6, 0.0, 1.0);
  float hot = pow(ridge, 3.0) * (0.75 + uAudio * 0.5);
  vec3 col = uColor * 0.10;
  col = mix(col, uColor * 1.5, hot);
  col = mix(col, vec3(0.9, 0.98, 1.0), pow(ridge, 6.0) * 0.9);
  col += uColor * fres * 1.1 * uEnergy;
  col += uColor * (0.30 + 0.22 * sin(uTime * 2.4)) * uEnergy;
  gl_FragColor = vec4(col, 1.0);
}
`;

const HOLO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uEnergy;
uniform float uTime;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.6);
  float lat = sin(vObjPos.y * 34.0 - uTime * 1.6);
  float scan = smoothstep(0.86, 1.0, lat) * 0.30;
  float lon = sin(atan(vObjPos.z, vObjPos.x) * 22.0);
  float grid = smoothstep(0.90, 1.0, lon) * 0.16;
  float flicker = 0.93 + 0.07 * sin(uTime * 23.0) * sin(uTime * 7.3);
  vec3 col = uColor * 0.05;
  col += uColor * (fres * 0.55 + scan + grid) * uEnergy * flicker;
  col += vec3(0.7, 0.95, 1.0) * scan * 0.35 * uEnergy;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const ORB_STYLES: OrbStyle[] = [
  {
    id: "reactor",
    label: "Arc Reactor",
    description: "Mark LXXXV segmented palladium turbine core with counter-rotating gimbals.",
    geometry: "icosahedron",
    frag: REACTOR_FRAG,
    glowScale: 1.32,
    dispScale: 0.45,
    preview:
      "radial-gradient(circle at 50% 50%, #e0fcff 0%, #22d3ee 32%, #0c4a6e 68%, #040b14 100%)",
  },
  {
    id: "neural",
    label: "Neural Lattice",
    description: "Synaptic energy filaments firing dynamically with thinking and speech.",
    geometry: "wireShell",
    frag: NEURAL_FRAG,
    glowScale: 1.28,
    dispScale: 0.75,
    preview:
      "radial-gradient(circle at 42% 38%, #67e8f9 0%, #0284c7 40%, #0a1b33 78%, #030712 100%)",
  },
  {
    id: "tesseract",
    label: "Cyber Prism",
    description: "Faceted octahedral quantum prism nested inside dual gyroscopic cages.",
    geometry: "octahedron",
    frag: TESSERACT_FRAG,
    glowScale: 1.24,
    dispScale: 0.3,
    preview:
      "linear-gradient(135deg, #38bdf8 0%, #0f172a 55%, #f59e0b 100%)",
  },
  {
    id: "plasma",
    label: "Solar Plasma",
    description: "Turbulent white-hot plasma ridges reacting cleanly to microphone audio.",
    geometry: "icosahedron",
    frag: PLASMA_FRAG,
    glowScale: 1.3,
    dispScale: 1.35,
    preview:
      "radial-gradient(circle at 48% 42%, #eafcff 0%, #58e6ff 28%, #0a6f9e 62%, #021018 100%)",
  },
  {
    id: "holo",
    label: "Holo Telemetry",
    description: "Projected scanline globe with Stark meridian coordinates.",
    geometry: "icosahedron",
    frag: HOLO_FRAG,
    glowScale: 1.2,
    dispScale: 0.55,
    preview:
      "repeating-linear-gradient(0deg, rgb(0 212 255 / 0.30) 0 1px, transparent 1px 4px)," +
      " radial-gradient(circle at 50% 50%, #06283a 0%, #02090f 68%, #0e7ea6 100%)",
  },
  {
    id: "swirl",
    label: "Vortex Storm",
    description: "Domain-warped atmospheric fluid currents inside containment.",
    geometry: "icosahedron",
    frag: SWIRL_FRAG,
    glowScale: 1.34,
    dispScale: 0.85,
    preview:
      "radial-gradient(circle at 36% 30%, #7df0ff 0%, #0891cc 34%, #0a3b66 68%, #041226 100%)",
  },
  {
    id: "core",
    label: "Obsidian Core",
    description: "Brushed stealth titanium core with razor Fresnel rim highlights.",
    geometry: "icosahedron",
    frag: CORE_FRAG,
    glowScale: 1.22,
    dispScale: 0.9,
    preview:
      "radial-gradient(circle at 50% 48%, #0f172a 0%, #020617 56%, #0a5f78 84%, #00d4ff 102%)",
  },
];

export function getOrbStyle(id: OrbStyleId): OrbStyle {
  return ORB_STYLES.find((s) => s.id === id) ?? ORB_STYLES[0];
}
