/**
 * JARVIS Workspace runtime (Phase 6).
 *
 * This file is bundled by `tools/build-workspace-runtime.mjs` into
 * `src/workspace/runtime.generated.js`, which the app inlines into the
 * sandboxed artifact iframe. It never runs inside the React app itself.
 *
 * It gives the model a tiny helper API (`window.JARVIS`) plus a real `THREE`
 * global, so artifact code stays short and always renders offline.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

type Vec3 = [number, number, number];

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

/* ---------------------------------------------------------------- stage */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x0a0a12, 1);
document.body.appendChild(renderer.domElement);

const world = new THREE.Scene();
world.background = new THREE.Color("#0a0a12");

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.05,
  5000,
);
camera.position.set(3.2, 2.2, 5.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------------------------------------------------------- lights */

const lightRoot = new THREE.Group();
world.add(lightRoot);

function lights(options: LightOptions = {}): Record<string, THREE.Light> {
  const { ambient = 0.5, key = 2.2, fill = 0.6 } = options;
  lightRoot.clear();
  const a = new THREE.AmbientLight(0xffffff, ambient);
  const k = new THREE.DirectionalLight(0xffffff, key);
  k.position.set(6, 10, 7);
  k.castShadow = true;
  k.shadow.mapSize.set(1024, 1024);
  const f = new THREE.DirectionalLight(0x99bbff, fill);
  f.position.set(-7, 4, -6);
  lightRoot.add(a, k, f);
  return { ambient: a, key: k, fill: f };
}

lights();

/* ---------------------------------------------------------------- shapes */

function mat(
  color: string | number = "#c9d1e8",
  options: MatOptions = {},
): THREE.MeshStandardMaterial {
  const opacity = options.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color: color as THREE.ColorRepresentation,
    metalness: options.metalness ?? 0.35,
    roughness: options.roughness ?? 0.45,
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

function box(
  width = 1,
  height = 1,
  depth = 1,
  material: THREE.Material = mat(),
): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function sphere(
  radius = 1,
  material: THREE.Material = mat(),
  segments = 32,
): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(radius, segments, segments), material);
}

function cylinder(
  radiusTop = 0.5,
  radiusBottom = 0.5,
  height = 1,
  material: THREE.Material = mat(),
): THREE.Mesh {
  return mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32),
    material,
  );
}

function cone(
  radius = 0.5,
  height = 1,
  material: THREE.Material = mat(),
): THREE.Mesh {
  return mesh(new THREE.ConeGeometry(radius, height, 32), material);
}

function torus(
  radius = 0.8,
  tube = 0.2,
  material: THREE.Material = mat(),
): THREE.Mesh {
  return mesh(new THREE.TorusGeometry(radius, tube, 20, 64), material);
}

function plane(
  width = 10,
  height = 10,
  material: THREE.Material = mat(),
): THREE.Mesh {
  const item = mesh(new THREE.PlaneGeometry(width, height), material);
  item.rotation.x = -Math.PI / 2;
  item.receiveShadow = true;
  item.castShadow = false;
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
    object.rotation.set(
      options.rotation[0],
      options.rotation[1],
      options.rotation[2],
    );
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

/* ---------------------------------------------------------------- camera */

function configureCamera(options: CameraOptions = {}): THREE.PerspectiveCamera {
  if (options.fov !== undefined) camera.fov = options.fov;
  if (options.position) {
    camera.position.set(
      options.position[0],
      options.position[1],
      options.position[2],
    );
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
    world.background = new THREE.Color(
      options.background as THREE.ColorRepresentation,
    );
  }
  if (options.fog) {
    world.fog = new THREE.FogExp2(0x0a0a12, 0.02);
  }
  return world;
}

const bounds = new THREE.Box3();
let fitted = false;
/* The artifact may place the camera itself; then the load-time auto-fit must
 * not override it (mostly to respect a deliberate hero angle). */
let cameraConfigured = false;

/**
 * Bounds of the actual content, ignoring huge flat ground planes. Models
 * almost always add a 20x20 floor, and framing that makes the subject tiny.
 */
function contentBounds(target: THREE.Box3): THREE.Box3 {
  target.makeEmpty();
  world.updateWorldMatrix(true, true);
  world.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const meshBox = new THREE.Box3().setFromObject(object);
    if (meshBox.isEmpty() || groundLikeBox(meshBox)) return;
    target.union(meshBox);
  });
  return target;
}

/** A very large, very thin mesh is a floor/sky panel, not the subject. */
function groundLikeBox(meshBox: THREE.Box3): boolean {
  const size = meshBox.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  const thinnest = Math.min(size.x, size.y, size.z);
  return extent > 3 && thinnest / extent < 0.01;
}

function fit(options: FrameOptions = {}): void {
  const padding = options.padding ?? 1.45;
  contentBounds(bounds);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const halfFov = (camera.fov * Math.PI) / 360;
  let distance = maxDim / 2 / Math.tan(halfFov);
  distance *= padding;

  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 0.0001) direction.set(1, 0.6, 1);
  direction.normalize();

  camera.position.copy(center).add(direction.multiplyScalar(distance));
  camera.near = Math.max(0.01, distance / 200);
  camera.far = Math.max(200, distance * 40);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = Math.max(0.1, distance * 0.2);
  controls.maxDistance = distance * 6;
  controls.update();
  fitted = true;
}

/* ---------------------------------------------------------------- loop */

const hooks: Array<(seconds: number, delta: number) => void> = [];

function onFrame(hook: (seconds: number, delta: number) => void): void {
  hooks.push(hook);
}

function orbit(options: OrbitOptions = {}): void {
  if (options.autoRotate !== undefined) controls.autoRotate = options.autoRotate;
  if (options.autoRotateSpeed !== undefined) {
    controls.autoRotateSpeed = options.autoRotateSpeed;
  }
  if (options.minDistance !== undefined) {
    controls.minDistance = options.minDistance;
  }
  if (options.maxDistance !== undefined) {
    controls.maxDistance = options.maxDistance;
  }
  controls.enableDamping = options.damping ?? true;
  controls.update();
}

let last = 0;
let started = false;

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

/* ---------------------------------------------------------------- export */

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

/* ---------------------------------------------------------------- stage */

/**
 * Host-driven workshop controls ("pull it apart", "camera from the top").
 * The artifact code is model-generated, so these work generically on the
 * scene graph instead of requiring cooperation from the model.
 */

type StagePart = {
  object: THREE.Object3D;
  home: THREE.Vector3;
  offset: THREE.Vector3;
};

let stageParts: StagePart[] | null = null;
let camTween: {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
} | null = null;

onFrame((_seconds, delta) => {
  if (!camTween) return;
  camTween.t = Math.min(1, camTween.t + delta / camTween.duration);
  const eased = 1 - Math.pow(1 - camTween.t, 3);
  camera.position.lerpVectors(camTween.fromPosition, camTween.toPosition, eased);
  controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, eased);
  controls.update();
  if (camTween.t >= 1) camTween = null;
});

function meshesInScene(): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  world.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh);
  });
  return found;
}

function explodeScene(): void {
  if (stageParts) return;
  contentBounds(bounds);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 0.001);
  const parentQuat = new THREE.Quaternion();
  const worldPosition = new THREE.Vector3();
  const parts: StagePart[] = [];

  for (const object of meshesInScene()) {
    if (groundLikeBox(new THREE.Box3().setFromObject(object))) continue;
    object.updateWorldMatrix(true, false);
    object.getWorldPosition(worldPosition);
    const radial = worldPosition.clone().sub(center).multiplyScalar(0.55);
    if (radial.lengthSq() < 1e-6) radial.set(0, extent * 0.35, 0);
    if (radial.length() < extent * 0.08) radial.setLength(extent * 0.08);
    // World-space offset -> the parent's local space, because positions are local.
    if (object.parent) {
      object.parent.getWorldQuaternion(parentQuat);
      radial.applyQuaternion(parentQuat.invert());
    }
    parts.push({ object, home: object.position.clone(), offset: radial });
  }

  if (!parts.length) return;
  for (const part of parts) part.object.position.copy(part.home).add(part.offset);
  stageParts = parts;
  try {
    fit({ padding: 1.25 });
  } catch {
    /* keep the current view */
  }
}

function assembleScene(): void {
  if (!stageParts) return;
  for (const part of stageParts) part.object.position.copy(part.home);
  stageParts = null;
  try {
    fit({ padding: 1.45 });
  } catch {
    /* keep the current view */
  }
}

function stageCamera(view: "top" | "front" | "side"): void {
  contentBounds(bounds);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);
  const halfFov = (camera.fov * Math.PI) / 360;
  const distance = (radius / Math.tan(halfFov)) * 1.15;
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
  camera.near = Math.max(0.01, distance / 200);
  camera.far = Math.max(200, distance * 40);
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(0.1, distance * 0.2);
  controls.maxDistance = distance * 6;
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
      .catch((error) =>
        post({ type: "export", format: "glb", error: describe(error) }),
      );
  }
});

/* ---------------------------------------------------------------- global */

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
  export: { png: exportPng, glb: exportGlb },
  version: "1.0",
};

(window as unknown as Record<string, unknown>).JARVIS = api;
(window as unknown as Record<string, unknown>).THREE = THREE;
