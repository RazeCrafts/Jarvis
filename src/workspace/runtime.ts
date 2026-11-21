/**
 * JARVIS Sealed 3D Workshop Runtime (Prompt Pack 07-15)
 *
 * Bundled by `tools/build-workspace-runtime.mjs` into `src/workspace/runtime.generated.js`
 * and injected inside the sandboxed workshop iframe (`sandbox="allow-scripts allow-pointer-lock"`).
 * Exposes `window.JARVIS`, `window.W` (Workshop Kit + Architect Kit), and global `THREE`.
 * Guardrail: NO `.anisotropy` set on materials/textures.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

type Vec3 = [number, number, number];
type LightingMood = "studio" | "day" | "sunset" | "night";

interface SceneOptions {
  background?: string | number;
  fog?: boolean;
}

interface CameraOptions {
  fov?: number;
  position?: Vec3;
  lookAt?: Vec3;
  near?: number;
  far?: number;
}

interface LightOptions {
  ambient?: number;
  key?: number;
  fill?: number;
}

interface MatOptions {
  metalness?: number;
  roughness?: number;
  emissive?: string | number;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  flatShading?: boolean;
  wireframe?: boolean;
}

interface PlaceOptions {
  rotation?: Vec3;
  scale?: Vec3 | number;
}

interface FrameOptions {
  padding?: number;
}

interface OrbitOptions {
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  damping?: boolean;
}

interface WAddOptions {
  name?: string;
  label?: string;
  explode?: Vec3;
  layer?: string;
  isFloor?: boolean;
}

const host = window.parent || window;
let reported = false;

function describe(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  return String(error);
}

function post(message: Record<string, unknown>): void {
  try {
    host.postMessage({ source: "jarvis-artifact", ...message }, "*");
  } catch {
    /* parent detached */
  }
}

function report(error: unknown): void {
  if (reported) return;
  reported = true;
  post({ type: "error", error: describe(error) });
}

window.addEventListener("error", (event) => {
  report(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  report(event.reason);
});

/* ---------------------------------------------------------------- renderer + stage */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x0c101a, 1);
document.body.appendChild(renderer.domElement);

const world = new THREE.Scene();
world.background = new THREE.Color("#0c101a");

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.05,
  5000,
);
camera.position.set(3.4, 2.4, 5.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.addEventListener("start", () => {
  post({ type: "user_interacted" });
});

/* ---------------------------------------------------------------- SVG Leader-Line Labels Overlay */

const labelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
labelSvg.setAttribute("width", "100%");
labelSvg.setAttribute("height", "100%");
Object.assign(labelSvg.style, {
  position: "fixed",
  inset: "0",
  pointerEvents: "none",
  zIndex: "10",
  display: "none",
});
document.body.appendChild(labelSvg);

const labelOverlay = document.createElement("div");
Object.assign(labelOverlay.style, {
  position: "fixed",
  inset: "0",
  pointerEvents: "none",
  zIndex: "11",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  display: "none",
});
document.body.appendChild(labelOverlay);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------------------------------------------------------- procedural softbox PMREM & lighting moods */

const pmrem = new THREE.PMREMGenerator(renderer);
let currentEnvTex: THREE.Texture | null = null;

function buildStudioEnvironment(mood: LightingMood): THREE.Texture {
  const envScene = new THREE.Scene();
  const bgColors: Record<LightingMood, number> = {
    studio: 0x111722,
    day: 0xdbeafe,
    sunset: 0x2b192e,
    night: 0x050811,
  };
  envScene.background = new THREE.Color(bgColors[mood]);

  const panelConfigs: Array<{ pos: Vec3; scale: Vec3; color: number }> =
    mood === "sunset"
      ? [
          { pos: [6, 5, 4], scale: [6, 4, 0.2], color: 0xffb37a },
          { pos: [-6, 4, -3], scale: [5, 4, 0.2], color: 0x8fa8ff },
          { pos: [0, 8, 0], scale: [7, 0.2, 7], color: 0xffe4c4 },
        ]
      : mood === "day"
        ? [
            { pos: [6, 7, 5], scale: [8, 5, 0.2], color: 0xffffff },
            { pos: [-6, 5, -4], scale: [6, 4, 0.2], color: 0xe0f2fe },
            { pos: [0, 9, 0], scale: [9, 0.2, 9], color: 0xf8fafc },
          ]
        : mood === "night"
          ? [
              { pos: [5, 6, 4], scale: [4, 3, 0.2], color: 0x7dd3fc },
              { pos: [-5, 4, -5], scale: [4, 3, 0.2], color: 0x6366f1 },
              { pos: [0, 8, 0], scale: [5, 0.2, 5], color: 0x38bdf8 },
            ]
          : [
              { pos: [6, 6, 5], scale: [6, 4, 0.2], color: 0xffffff },
              { pos: [-6, 4, -5], scale: [5, 3, 0.2], color: 0xbae6fd },
              { pos: [0, 8, 0], scale: [7, 0.2, 7], color: 0xf1f5f9 },
            ];

  for (const cfg of panelConfigs) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: cfg.color }),
    );
    m.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    m.scale.set(cfg.scale[0], cfg.scale[1], cfg.scale[2]);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  }

  const rt = pmrem.fromScene(envScene, 0.04);
  return rt.texture;
}

const lightRoot = new THREE.Group();
world.add(lightRoot);

const stagePedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(8, 8, 0.06, 64),
  new THREE.MeshStandardMaterial({
    color: 0x0f1522,
    metalness: 0.25,
    roughness: 0.72,
  }),
);
stagePedestal.position.y = -0.04;
stagePedestal.receiveShadow = true;
stagePedestal.userData.__stageFloor = true;
world.add(stagePedestal);

let stagePedestalHomeY = -0.04;

function applyLightingMood(mood: LightingMood): void {
  if (currentEnvTex) currentEnvTex.dispose();
  currentEnvTex = buildStudioEnvironment(mood);
  world.environment = currentEnvTex;

  if (mood === "day") {
    world.background = new THREE.Color("#dbe5f0");
    renderer.setClearColor(0xdbe5f0, 1);
    (stagePedestal.material as THREE.MeshStandardMaterial).color.setHex(0xc8d4e3);
    lights({ ambient: 0.75, key: 2.6, fill: 0.9 });
  } else if (mood === "sunset") {
    world.background = new THREE.Color("#1b1322");
    renderer.setClearColor(0x1b1322, 1);
    (stagePedestal.material as THREE.MeshStandardMaterial).color.setHex(0x21182b);
    lights({ ambient: 0.52, key: 2.3, fill: 0.8 });
  } else if (mood === "night") {
    world.background = new THREE.Color("#050811");
    renderer.setClearColor(0x050811, 1);
    (stagePedestal.material as THREE.MeshStandardMaterial).color.setHex(0x090e1a);
    lights({ ambient: 0.3, key: 1.8, fill: 0.7 });
  } else {
    world.background = new THREE.Color("#0c101a");
    renderer.setClearColor(0x0c101a, 1);
    (stagePedestal.material as THREE.MeshStandardMaterial).color.setHex(0x0f1522);
    lights({ ambient: 0.55, key: 2.4, fill: 0.75 });
  }
}

function lights(options: LightOptions = {}): Record<string, THREE.Light> {
  const { ambient = 0.55, key = 2.4, fill = 0.75 } = options;
  lightRoot.clear();
  const a = new THREE.HemisphereLight(0xeef6ff, 0x1e293b, ambient);
  const k = new THREE.DirectionalLight(0xffffff, key);
  k.position.set(6, 10, 7);
  k.castShadow = true;
  k.shadow.mapSize.set(1024, 1024);
  const f = new THREE.DirectionalLight(0x99ccff, fill);
  f.position.set(-7, 4, -6);
  const rim = new THREE.DirectionalLight(0x7dd3fc, fill * 0.65);
  rim.position.set(0, 5, -9);
  lightRoot.add(a, k, f, rim);
  return { ambient: a, key: k, fill: f, rim };
}

applyLightingMood("studio");

/* ---------------------------------------------------------------- materials & primitives */

function mat(
  color: string | number = "#c9d1e8",
  options: MatOptions = {},
): THREE.MeshStandardMaterial {
  const opacity = options.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color: color as THREE.ColorRepresentation,
    metalness: options.metalness ?? 0.35,
    roughness: options.roughness ?? 0.42,
    emissive: (options.emissive ?? 0x000000) as THREE.ColorRepresentation,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    opacity,
    transparent: options.transparent ?? opacity < 1,
    flatShading: options.flatShading ?? false,
    wireframe: options.wireframe ?? false,
  });
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function box(w = 1, h = 1, d = 1, material: THREE.Material = mat()): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), material);
}

function sphere(radius = 1, material: THREE.Material = mat(), segments = 32): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(radius, segments, segments), material);
}

function cylinder(
  radiusTop = 0.5,
  radiusBottom = 0.5,
  height = 1,
  material: THREE.Material = mat(),
): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32), material);
}

function cone(radius = 0.5, height = 1, material: THREE.Material = mat()): THREE.Mesh {
  return mesh(new THREE.ConeGeometry(radius, height, 32), material);
}

function torus(radius = 0.8, tube = 0.2, material: THREE.Material = mat()): THREE.Mesh {
  return mesh(new THREE.TorusGeometry(radius, tube, 20, 64), material);
}

function plane(w = 10, h = 10, material: THREE.Material = mat()): THREE.Mesh {
  const item = mesh(new THREE.PlaneGeometry(w, h), material);
  item.rotation.x = -Math.PI / 2;
  item.receiveShadow = true;
  item.castShadow = false;
  item.userData.__stageFloor = true;
  return item;
}

function group(...objects: THREE.Object3D[]): THREE.Group {
  const holder = new THREE.Group();
  for (const object of objects) holder.add(object);
  return holder;
}

function at<T extends THREE.Object3D>(
  object: T,
  position: Vec3 = [0, 0, 0],
  options: PlaceOptions = {},
): T {
  object.position.set(position[0], position[1], position[2]);
  if (options.rotation) {
    object.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  }
  if (typeof options.scale === "number") {
    object.scale.setScalar(options.scale);
  } else if (options.scale) {
    object.scale.set(options.scale[0], options.scale[1], options.scale[2]);
  }
  return object;
}

function add(...objects: THREE.Object3D[]): THREE.Object3D[] {
  for (const object of objects) world.add(object);
  return objects;
}

/* ---------------------------------------------------------------- W Workshop Kit + Architect Kit */

interface RegisteredPart {
  object: THREE.Object3D;
  name: string;
  label: string;
  explodeVec?: Vec3;
  layer?: string;
}

const registeredParts: RegisteredPart[] = [];

const METAL_PRESETS: Record<string, { color: number; metalness: number; roughness: number }> = {
  titanium: { color: 0x8d99ae, metalness: 0.88, roughness: 0.26 },
  gold: { color: 0xf4c44e, metalness: 0.92, roughness: 0.2 },
  "rose-gold": { color: 0xe6a69c, metalness: 0.9, roughness: 0.22 },
  chrome: { color: 0xe2e8f0, metalness: 0.96, roughness: 0.1 },
  copper: { color: 0xd97746, metalness: 0.9, roughness: 0.25 },
  steel: { color: 0x64748b, metalness: 0.85, roughness: 0.34 },
  dark: { color: 0x1e293b, metalness: 0.78, roughness: 0.38 },
};

function wMetal(kind = "titanium"): THREE.MeshStandardMaterial {
  const p = METAL_PRESETS[kind.toLowerCase()] || METAL_PRESETS.titanium;
  return new THREE.MeshStandardMaterial({
    color: p.color,
    metalness: p.metalness,
    roughness: p.roughness,
  });
}

function wGlass(color: string | number = 0xbae6fd): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: color as THREE.ColorRepresentation,
    metalness: 0.05,
    roughness: 0.08,
    transmission: 0.72,
    opacity: 0.55,
    transparent: true,
    ior: 1.48,
  });
}

function wPlastic(color: string | number = 0x334155): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color as THREE.ColorRepresentation,
    metalness: 0.08,
    roughness: 0.45,
  });
}

function wWood(color: string | number = 0x8b5a2b): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color as THREE.ColorRepresentation,
    metalness: 0.02,
    roughness: 0.76,
  });
}

function wEmissive(color: string | number = 0x38bdf8, intensity = 2.2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color as THREE.ColorRepresentation,
    emissive: color as THREE.ColorRepresentation,
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.25,
  });
}

function wText(text: string, pos: Vec3 = [0, 0, 0], color = "#e2e8f0"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(8, 18, 496, 92);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 18, 496, 92);
    ctx.fillStyle = color;
    ctx.font = "bold 40px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 24), 256, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.position.set(pos[0], pos[1], pos[2]);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

function wAdd<T extends THREE.Object3D>(object: T, opts: WAddOptions = {}): T {
  const name = opts.name || object.name || `part-${registeredParts.length + 1}`;
  object.name = name;
  if (opts.layer) object.userData.layer = opts.layer;
  if (opts.isFloor) object.userData.__stageFloor = true;
  if (opts.explode) object.userData.explodeVec = opts.explode;
  if (opts.label || opts.name) object.userData.label = opts.label || opts.name;
  world.add(object);
  if (!opts.isFloor) {
    registeredParts.push({
      object,
      name,
      label: opts.label || opts.name || name,
      explodeVec: opts.explode,
      layer: opts.layer,
    });
  }
  return object;
}

/** Architect Kit helpers (Floor Plans, Furniture & Toggleable Roofs) */
function wFloorplan(
  rooms: Array<{
    name?: string;
    x: number;
    z: number;
    w: number;
    d: number;
    wallHeight?: number;
    floorColor?: string;
    wallColor?: string;
  }>,
): THREE.Group {
  const holder = new THREE.Group();
  const wallHDefault = 2.6;
  const wallT = 0.14;
  rooms.forEach((r, idx) => {
    const h = r.wallHeight ?? wallHDefault;
    const slab = box(r.w, 0.08, r.d, wWood(r.floorColor || "#6e4e32"));
    slab.position.set(r.x, 0.04, r.z);
    slab.receiveShadow = true;

    const wallMat = wPlastic(r.wallColor || "#d6dce6");
    const nWall = box(r.w, h, wallT, wallMat);
    nWall.position.set(r.x, h / 2, r.z - r.d / 2);
    const sWall = box(r.w, h, wallT, wallMat);
    sWall.position.set(r.x, h / 2, r.z + r.d / 2);
    const wWall = box(wallT, h, r.d, wallMat);
    wWall.position.set(r.x - r.w / 2, h / 2, r.z);
    const eWall = box(wallT, h, r.d, wallMat);
    eWall.position.set(r.x + r.w / 2, h / 2, r.z);

    const roomGroup = group(slab, nWall, sWall, wWall, eWall);
    roomGroup.name = r.name || `Room ${idx + 1}`;
    roomGroup.userData.label = roomGroup.name;
    holder.add(roomGroup);
  });
  return holder;
}

function wFurniture(
  kind: "bed" | "sofa" | "table" | "desk" | "island" | "chair",
  pos: Vec3 = [0, 0, 0],
): THREE.Group {
  const g = new THREE.Group();
  if (kind === "bed") {
    const frame = at(box(1.9, 0.25, 2.2, wWood()), [0, 0.12, 0]);
    const mattress = at(box(1.78, 0.26, 2.05, wPlastic("#f1f5f9")), [0, 0.36, 0]);
    const headboard = at(box(1.9, 0.85, 0.12, wWood("#5c3a21")), [0, 0.45, -1.04]);
    g.add(frame, mattress, headboard);
  } else if (kind === "sofa") {
    const seat = at(box(2.2, 0.38, 0.9, wPlastic("#475569")), [0, 0.22, 0]);
    const back = at(box(2.2, 0.55, 0.22, wPlastic("#334155")), [0, 0.5, -0.34]);
    g.add(seat, back);
  } else if (kind === "island" || kind === "table" || kind === "desk") {
    const w = kind === "island" ? 2.2 : 1.5;
    const d = kind === "island" ? 1.0 : 0.8;
    const top = at(box(w, 0.08, d, wWood("#b48a60")), [0, 0.78, 0]);
    const base = at(box(w - 0.16, 0.74, d - 0.16, wPlastic("#cbd5e1")), [0, 0.37, 0]);
    g.add(top, base);
  } else {
    const seat = at(box(0.5, 0.08, 0.5, wPlastic("#64748b")), [0, 0.45, 0]);
    const back = at(box(0.5, 0.48, 0.08, wPlastic("#475569")), [0, 0.7, -0.21]);
    g.add(seat, back);
  }
  g.position.set(pos[0], pos[1], pos[2]);
  g.userData.label = kind;
  return g;
}

function wRoof(spec: { width?: number; depth?: number; height?: number; y?: number } = {}): THREE.Group {
  const w = spec.width ?? 8;
  const d = spec.depth ?? 6;
  const h = spec.height ?? 1.4;
  const y = spec.y ?? 2.65;
  const g = new THREE.Group();
  g.userData.layer = "roof";
  g.userData.label = "Roof Assembly";
  const slab = at(box(w + 0.3, 0.12, d + 0.3, wMetal("steel")), [0, y, 0]);
  const cap = at(box(w * 0.85, h * 0.12, d * 0.85, wPlastic("#475569")), [0, y + 0.25, 0]);
  g.add(slab, cap);
  wAdd(g, { name: "roof", label: "Roof Assembly", explode: [0, 2.5, 0], layer: "roof" });
  return g;
}

function wScanFloor(_dataUrl?: string): void {
  /* Floor-plan backdrop marker hook (real geometry placed by W.floorplan) */
}

function wBeauty(_opts: { asis?: boolean } = {}): void {
  try {
    fit({ padding: 1.35 });
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- guard pass (Prompt 08/09) */

function sanitizeSceneMeshes(): void {
  world.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.attributes?.position;
    if (pos) {
      let dirty = false;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          pos.setXYZ(i, 0, 0, 0);
          dirty = true;
        }
      }
      if (dirty) pos.needsUpdate = true;
    }
    m.geometry.computeBoundingSphere();
  });
}

/* ---------------------------------------------------------------- camera & bounds */

function configureCamera(options: CameraOptions = {}): THREE.PerspectiveCamera {
  if (options.fov !== undefined) camera.fov = options.fov;
  if (options.position) {
    camera.position.set(options.position[0], options.position[1], options.position[2]);
  }
  if (options.lookAt) {
    camera.lookAt(options.lookAt[0], options.lookAt[1], options.lookAt[2]);
    controls.target.set(options.lookAt[0], options.lookAt[1], options.lookAt[2]);
  }
  if (options.near !== undefined) camera.near = options.near;
  if (options.far !== undefined) camera.far = options.far;
  camera.updateProjectionMatrix();
  controls.update();
  cameraConfigured = true;
  return camera;
}

function setScene(options: SceneOptions = {}): THREE.Scene {
  if (options.background !== undefined) {
    world.background = new THREE.Color(options.background as THREE.ColorRepresentation);
  }
  if (options.fog) {
    world.fog = new THREE.FogExp2(0x0a0a12, 0.02);
  }
  return world;
}

const bounds = new THREE.Box3();
let fitted = false;
let cameraConfigured = false;

function groundLikeBox(meshBox: THREE.Box3): boolean {
  const size = meshBox.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  const thinnest = Math.min(size.x, size.y, size.z);
  return extent > 3.5 && thinnest / extent < 0.015;
}

function contentBounds(target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  world.updateWorldMatrix(true, true);
  world.traverse((object) => {
    const m = object as THREE.Mesh;
    if (!m.isMesh || !m.visible || m.userData.__stageFloor) return;
    const meshBox = new THREE.Box3().setFromObject(m);
    if (meshBox.isEmpty() || groundLikeBox(meshBox)) return;
    target.union(meshBox);
  });
  return target;
}

function fit(options: FrameOptions = {}): void {
  sanitizeSceneMeshes();
  const padding = options.padding ?? 1.42;
  contentBounds(bounds);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const halfFov = (camera.fov * Math.PI) / 360;
  let distance = (maxDim / 2 / Math.tan(halfFov)) * padding;
  distance = Math.max(0.8, Math.min(distance, 250));

  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 0.0001) direction.set(1, 0.65, 1);
  direction.normalize();

  camera.position.copy(center).add(direction.multiplyScalar(distance));
  camera.near = Math.max(0.01, distance / 200);
  camera.far = Math.max(200, distance * 40);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = Math.max(0.1, distance * 0.15);
  controls.maxDistance = distance * 7;
  controls.update();

  // Snap pedestal beneath the lowest subject point when assembled
  if (!stageParts) {
    stagePedestalHomeY = bounds.min.y - 0.05;
    stagePedestal.position.y = stagePedestalHomeY;
  }
  fitted = true;
}

/* ---------------------------------------------------------------- loop */

const hooks: Array<(seconds: number, delta: number) => void> = [];
function onFrame(hook: (seconds: number, delta: number) => void): void {
  hooks.push(hook);
}

function orbit(options: OrbitOptions = {}): void {
  if (options.autoRotate !== undefined) controls.autoRotate = options.autoRotate;
  if (options.autoRotateSpeed !== undefined) controls.autoRotateSpeed = options.autoRotateSpeed;
  if (options.minDistance !== undefined) controls.minDistance = options.minDistance;
  if (options.maxDistance !== undefined) controls.maxDistance = options.maxDistance;
  controls.enableDamping = options.damping ?? true;
  controls.update();
}

let last = 0;
let started = false;

/* ---------------------------------------------------------------- stage controls, explode & callout labels */

type StagePartAnim = {
  object: THREE.Object3D;
  label: string;
  home: THREE.Vector3;
  offset: THREE.Vector3;
  targetT: number;
};

let stageParts: StagePartAnim[] | null = null;
let explodeProgress = 0;
let explodeTarget = 0;

let camTween: {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
} | null = null;

function sampleSurfaceWorldPoint(object: THREE.Object3D, camPos: THREE.Vector3): THREE.Vector3 {
  const best = new THREE.Vector3();
  let found = false;
  let bestDist = Infinity;
  const v = new THREE.Vector3();
  object.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 24));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const d = v.distanceToSquared(camPos);
      if (d < bestDist) {
        bestDist = d;
        best.copy(v);
        found = true;
      }
    }
  });
  if (!found) object.getWorldPosition(best);
  return best;
}

function renderLeaderLabels(): void {
  if (!stageParts || stageParts.length === 0 || explodeProgress < 0.08) {
    labelSvg.style.display = "none";
    labelOverlay.style.display = "none";
    return;
  }

  labelSvg.style.display = "block";
  labelOverlay.style.display = "block";
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cx = W / 2;

  const projected: Array<{ label: string; sx: number; sy: number; side: "left" | "right" }> = [];
  const tmp = new THREE.Vector3();
  for (const part of stageParts.slice(0, 14)) {
    const worldPt = sampleSurfaceWorldPoint(part.object, camera.position);
    tmp.copy(worldPt).project(camera);
    if (tmp.z > 1) continue;
    const sx = (tmp.x * 0.5 + 0.5) * W;
    const sy = (-tmp.y * 0.5 + 0.5) * H;
    projected.push({
      label: part.label,
      sx,
      sy,
      side: sx < cx ? "left" : "right",
    });
  }

  const layoutSide = (items: typeof projected, side: "left" | "right") => {
    const sorted = [...items].sort((a, b) => a.sy - b.sy);
    const minGap = 28;
    let prevY = 38;
    return sorted.map((item) => {
      const ly = Math.max(prevY, Math.min(H - 36, item.sy));
      prevY = ly + minGap;
      const lx = side === "left" ? 18 : W - 18;
      return { ...item, lx, ly };
    });
  };

  const leftItems = layoutSide(projected.filter((p) => p.side === "left"), "left");
  const rightItems = layoutSide(projected.filter((p) => p.side === "right"), "right");
  const all = [...leftItems, ...rightItems];

  labelSvg.innerHTML = all
    .map((p) => {
      const anchorX = p.side === "left" ? p.lx + 115 : p.lx - 115;
      return `
        <polyline points="${p.sx.toFixed(1)},${p.sy.toFixed(1)} ${((p.sx + anchorX) / 2).toFixed(1)},${p.ly.toFixed(1)} ${anchorX.toFixed(1)},${p.ly.toFixed(1)}"
          fill="none" stroke="rgba(125,211,252,0.72)" stroke-width="1.25" />
        <circle cx="${p.sx.toFixed(1)}" cy="${p.sy.toFixed(1)}" r="3.2" fill="#38bdf8" />
      `;
    })
    .join("");

  labelOverlay.innerHTML = all
    .map((p) => {
      const style =
        p.side === "left"
          ? `left:${p.lx}px; top:${p.ly - 11}px; text-align:left;`
          : `right:${W - p.lx}px; top:${p.ly - 11}px; text-align:right;`;
      return `<div style="position:fixed; ${style} max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:rgba(10,16,28,0.84); color:#e2e8f0; border:1px solid rgba(56,189,248,0.45); border-radius:6px; padding:3px 8px; font-size:11px; font-weight:500;">${p.label.replace(/</g, "&lt;")}</div>`;
    })
    .join("");
}

onFrame((_seconds, delta) => {
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + delta / camTween.duration);
    const eased = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.fromPosition, camTween.toPosition, eased);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, eased);
    controls.update();
    if (camTween.t >= 1) camTween = null;
  }

  if (stageParts) {
    const diff = explodeTarget - explodeProgress;
    if (Math.abs(diff) > 0.002) {
      explodeProgress += diff * Math.min(1, delta * 8);
      for (const p of stageParts) {
        p.object.position.copy(p.home).addScaledVector(p.offset, explodeProgress);
      }
      // Sink stage pedestal beneath exploded view
      stagePedestal.position.y = stagePedestalHomeY - explodeProgress * 1.4;
    } else if (explodeTarget === 0 && explodeProgress <= 0.01) {
      for (const p of stageParts) p.object.position.copy(p.home);
      stageParts = null;
      explodeProgress = 0;
      stagePedestal.position.y = stagePedestalHomeY;
    }
    renderLeaderLabels();
  }
});

function startLoop(): void {
  if (started) return;
  started = true;
  renderer.setAnimationLoop((ms: number) => {
    const seconds = ms / 1000;
    const delta = last ? Math.min(0.1, seconds - last) : 1 / 60;
    last = seconds;
    for (const hook of hooks) {
      try {
        hook(seconds, delta);
      } catch (error) {
        report(error);
      }
    }
    controls.update();
    renderer.render(world, camera);
  });
}

window.requestAnimationFrame(() => {
  if (!fitted && !cameraConfigured) {
    try {
      fit();
    } catch {
      /* keep the default camera */
    }
  }
  startLoop();
  post({ type: "ready" });
});

/* ---------------------------------------------------------------- exporters (PNG, GLB, Binary STL) */

function exportPng(): string {
  renderer.render(world, camera);
  return renderer.domElement.toDataURL("image/png");
}

async function exportGlb(): Promise<ArrayBuffer> {
  renderer.render(world, camera);
  const result = await new GLTFExporter().parseAsync(world, {
    binary: true,
    onlyVisible: true,
  });
  return result as ArrayBuffer;
}

function exportStl(): ArrayBuffer {
  world.updateWorldMatrix(true, true);
  const triangles: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; n: THREE.Vector3 }> = [];
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  world.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || !m.visible || m.userData.__stageFloor) return;
    const geom = m.geometry;
    const pos = geom.attributes?.position;
    if (!pos) return;
    const index = geom.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let i = 0; i < triCount; i += 1) {
      const i0 = index ? index.getX(i * 3) : i * 3;
      const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
      const a = vA.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld).clone();
      const b = vB.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld).clone();
      const c = vC.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld).clone();
      cb.subVectors(c, b);
      ab.subVectors(a, b);
      const n = cb.cross(ab).normalize().clone();
      triangles.push({ a, b, c, n });
    }
  });

  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const t of triangles) {
    view.setFloat32(offset, t.n.x, true); offset += 4;
    view.setFloat32(offset, t.n.y, true); offset += 4;
    view.setFloat32(offset, t.n.z, true); offset += 4;
    for (const v of [t.a, t.b, t.c]) {
      view.setFloat32(offset, v.x, true); offset += 4;
      view.setFloat32(offset, v.y, true); offset += 4;
      view.setFloat32(offset, v.z, true); offset += 4;
    }
    view.setUint16(offset, 0, true); offset += 2;
  }
  return buffer;
}

function meshesInScene(): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  world.traverse((object) => {
    const m = object as THREE.Mesh;
    if (m.isMesh && !m.userData.__stageFloor) found.push(m);
  });
  return found;
}

function explodeScene(): void {
  if (stageParts && explodeTarget === 1) return;
  if (!stageParts) {
    contentBounds(bounds);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.001);
    const parentQuat = new THREE.Quaternion();
    const worldPosition = new THREE.Vector3();
    const parts: StagePartAnim[] = [];

    if (registeredParts.length > 0) {
      for (const reg of registeredParts) {
        reg.object.updateWorldMatrix(true, false);
        reg.object.getWorldPosition(worldPosition);
        let offsetVec: THREE.Vector3;
        if (reg.explodeVec) {
          offsetVec = new THREE.Vector3(reg.explodeVec[0], reg.explodeVec[1], reg.explodeVec[2]);
        } else {
          offsetVec = worldPosition.clone().sub(center).multiplyScalar(0.65);
          if (offsetVec.lengthSq() < 1e-6) offsetVec.set(0, extent * 0.35, 0);
          if (offsetVec.length() < extent * 0.12) offsetVec.setLength(extent * 0.12);
        }
        parts.push({
          object: reg.object,
          label: reg.label,
          home: reg.object.position.clone(),
          offset: offsetVec,
          targetT: 1,
        });
      }
    } else {
      for (const object of meshesInScene()) {
        if (groundLikeBox(new THREE.Box3().setFromObject(object))) continue;
        object.updateWorldMatrix(true, false);
        object.getWorldPosition(worldPosition);
        const radial = worldPosition.clone().sub(center).multiplyScalar(0.6);
        if (radial.lengthSq() < 1e-6) radial.set(0, extent * 0.35, 0);
        if (radial.length() < extent * 0.1) radial.setLength(extent * 0.1);
        if (object.parent) {
          object.parent.getWorldQuaternion(parentQuat);
          radial.applyQuaternion(parentQuat.invert());
        }
        parts.push({
          object,
          label: object.userData.label || object.name || `Part ${parts.length + 1}`,
          home: object.position.clone(),
          offset: radial,
          targetT: 1,
        });
      }
    }
    if (!parts.length) return;
    stageParts = parts;
  }
  explodeTarget = 1;
}

function assembleScene(): void {
  if (!stageParts) return;
  explodeTarget = 0;
}

function stageCamera(view: "top" | "front" | "side"): void {
  contentBounds(bounds);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);
  const halfFov = (camera.fov * Math.PI) / 360;
  const distance = (radius / Math.tan(halfFov)) * 1.18;
  const direction =
    view === "top"
      ? new THREE.Vector3(0.0001, 1, 0.0001)
      : view === "front"
        ? new THREE.Vector3(0, 0.18, 1)
        : new THREE.Vector3(1, 0.35, 0.0001);

  camTween = {
    fromPosition: camera.position.clone(),
    toPosition: center.clone().add(direction.normalize().multiplyScalar(distance)),
    fromTarget: controls.target.clone(),
    toTarget: center,
    t: 0,
    duration: 0.45,
  };
}

function zoomCamera(factor: number): void {
  const dir = camera.position.clone().sub(controls.target);
  const dist = Math.max(0.25, Math.min(200, dir.length() * factor));
  dir.setLength(dist);
  camera.position.copy(controls.target).add(dir);
  controls.update();
}

function toggleLayer(layer: string, visible: boolean): void {
  world.traverse((obj) => {
    if (obj.userData?.layer === layer) {
      obj.visible = visible;
    }
  });
}

function runStage(command: string): boolean {
  switch (command) {
    case "explode":
      explodeScene();
      return true;
    case "assemble":
      assembleScene();
      return true;
    case "camera_top":
      stageCamera("top");
      return true;
    case "camera_front":
      stageCamera("front");
      return true;
    case "camera_side":
      stageCamera("side");
      return true;
    case "zoom_in":
      zoomCamera(0.76);
      return true;
    case "zoom_out":
      zoomCamera(1.32);
      return true;
    case "spin_on":
      orbit({ autoRotate: true, autoRotateSpeed: 2.2 });
      return true;
    case "spin_off":
      orbit({ autoRotate: false });
      return true;
    case "roof_on":
      toggleLayer("roof", true);
      return true;
    case "roof_off":
      toggleLayer("roof", false);
      return true;
    case "light_studio":
      applyLightingMood("studio");
      return true;
    case "light_day":
      applyLightingMood("day");
      return true;
    case "light_sunset":
      applyLightingMood("sunset");
      return true;
    case "light_night":
      applyLightingMood("night");
      return true;
    default:
      return false;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== host) return;
  const data = event.data as {
    source?: string;
    type?: string;
    format?: string;
    command?: string;
  } | null;
  if (!data || data.source !== "jarvis-host") return;

  if (data.type === "stage_command" && typeof data.command === "string") {
    try {
      post({ type: "stage", command: data.command, ok: runStage(data.command) });
    } catch (error) {
      post({ type: "stage", command: data.command, ok: false, error: describe(error) });
    }
    return;
  }

  if (data.type !== "export") return;

  if (data.format === "png") {
    try {
      post({ type: "export", format: "png", data: exportPng() });
    } catch (error) {
      post({ type: "export", format: "png", error: describe(error) });
    }
    return;
  }

  if (data.format === "glb") {
    void exportGlb()
      .then((buffer) => post({ type: "export", format: "glb", data: buffer }))
      .catch((error) => post({ type: "export", format: "glb", error: describe(error) }));
    return;
  }

  if (data.format === "stl") {
    try {
      post({ type: "export", format: "stl", data: exportStl() });
    } catch (error) {
      post({ type: "export", format: "stl", error: describe(error) });
    }
  }
});

/* ---------------------------------------------------------------- globals */

const api = {
  THREE,
  scene: setScene,
  camera: configureCamera,
  lights,
  mat,
  box,
  sphere,
  cylinder,
  cone,
  torus,
  plane,
  group,
  at,
  add,
  fit,
  onFrame,
  orbit,
  stage: { explode: explodeScene, assemble: assembleScene, camera: stageCamera },
  export: { png: exportPng, glb: exportGlb, stl: exportStl },
  version: "2.0",
};

const workshopKit = {
  add: wAdd,
  frame: fit,
  onTick: onFrame,
  metal: wMetal,
  glass: wGlass,
  plastic: wPlastic,
  wood: wWood,
  emissive: wEmissive,
  text: wText,
  floorplan: wFloorplan,
  furniture: wFurniture,
  roof: wRoof,
  scanFloor: wScanFloor,
  beauty: wBeauty,
};

(window as unknown as Record<string, unknown>).JARVIS = api;
(window as unknown as Record<string, unknown>).W = workshopKit;
(window as unknown as Record<string, unknown>).THREE = THREE;
