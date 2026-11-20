import { useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAgentStore, useChatStore, useOrbStore } from "@/store";
import { getOrbStyle, NOISE, type OrbStyle } from "@/components/orb/styles";

export interface OrbProps {
  isListening: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  /** Voice amplitude, 0 to 1. */
  audioLevel: number;
}

const COLORS = {
  idle: new THREE.Color("#00d4ff"),
  listening: new THREE.Color("#6df2ff"),
  speaking: new THREE.Color("#35e0ff"),
};

/* ---------- Shaders ---------- */

const BLOB_VERT = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uPhase;
uniform float uAmp;
uniform float uAudio;
varying vec3 vViewPos;
varying vec3 vObjPos;
varying float vDisp;
void main() {
  vec3 p = position;
  float n = snoise(p * 1.4 + vec3(0.0, uPhase, uPhase * 0.6));
  float ripple = sin(p.y * 7.0 - uTime * 7.0) * uAudio * 0.06;
  float d = n * uAmp + ripple;
  vDisp = d;
  vObjPos = position;
  vec4 mv = modelViewMatrix * vec4(p + normal * d, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_VERT = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uEnergy;
varying vec3 vN;
void main() {
  float i = pow(max(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  gl_FragColor = vec4(uColor * i * uEnergy * 1.6, 1.0);
}
`;

/* ---------- Scene ---------- */

function randomPoints(count: number, radius: number, shell = false): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = (shell ? 0.6 + Math.random() * 0.4 : Math.cbrt(Math.random())) * radius;
    const s = Math.sqrt(1 - u * u);
    arr[i * 3] = r * s * Math.cos(t);
    arr[i * 3 + 1] = r * u;
    arr[i * 3 + 2] = r * s * Math.sin(t);
  }
  return arr;
}

function Points({
  positions,
  size,
  opacity,
  color = "#ffffff",
  additive = false,
  innerRef,
}: {
  positions: Float32Array;
  size: number;
  opacity: number;
  color?: string;
  additive?: boolean;
  innerRef?: MutableRefObject<THREE.PointsMaterial | null>;
}) {
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        ref={innerRef}
        size={size}
        sizeAttenuation
        transparent
        opacity={opacity}
        color={color}
        depthWrite={false}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  );
}

interface SceneProps {
  stateRef: MutableRefObject<OrbProps>;
  style: OrbStyle;
  ring: boolean;
  intensity: number;
  speedSetting: number;
}

function Scene({ stateRef, style, ring, intensity, speedSetting }: SceneProps) {
  const blobMat = useRef<THREE.ShaderMaterial>(null);
  const glowMat = useRef<THREE.ShaderMaterial>(null);
  const spinGroup = useRef<THREE.Group>(null);
  const ringMesh = useRef<THREE.Mesh>(null);
  const stars = useRef<THREE.Group>(null);
  const swirl = useRef<THREE.Group>(null);
  const swirlMat = useRef<THREE.PointsMaterial | null>(null);

  const cur = useRef({
    amp: 0.1,
    speed: 0.35,
    energy: 0.55,
    audio: 0,
    spin: 0.08,
    think: 0,
    phase: 0,
    time: 0,
    color: new THREE.Color(COLORS.idle),
  });

  // Recreated whenever the style changes so the new shader compiles fresh.
  const blobUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uAmp: { value: 0.1 },
      uAudio: { value: 0 },
      uColor: { value: new THREE.Color(COLORS.idle) },
      uEnergy: { value: 0.55 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style.id],
  );
  const glowUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(COLORS.idle) }, uEnergy: { value: 0.55 } }),
    [],
  );

  const starPositions = useMemo(() => randomPoints(200, 9, true), []);
  const swirlPositions = useMemo(() => randomPoints(140, 0.78), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = stateRef.current;
    const c = cur.current;
    const D = THREE.MathUtils.damp;
    const audio = s.isSpeaking ? THREE.MathUtils.clamp(s.audioLevel, 0, 1) : 0;

    let amp = 0.1, speed = 0.35, energy = 0.55, spin = 0.08;
    let target = COLORS.idle;
    if (s.isThinking) { amp = 0.12; speed = 0.6; energy = 0.8; spin = 0.5; }
    if (s.isListening) { amp = 0.16; speed = 1.1; energy = 1.0; spin = 0.15; target = COLORS.listening; }
    if (s.isSpeaking) { amp = 0.12 + audio * 0.28; speed = 0.9 + audio * 1.2; energy = 0.9 + audio * 0.4; target = COLORS.speaking; }

    // User customization: per-style displacement scale + global intensity/speed.
    amp *= style.dispScale * intensity;
    speed *= speedSetting;
    energy = THREE.MathUtils.clamp(energy * (0.75 + 0.35 * intensity), 0, 1.6);

    c.amp = D(c.amp, amp, 5, dt);
    c.speed = D(c.speed, speed, 4, dt);
    c.energy = D(c.energy, energy, 4, dt);
    c.audio = D(c.audio, audio, 14, dt);
    c.spin = D(c.spin, spin, 3, dt);
    c.think = D(c.think, s.isThinking && !s.isSpeaking ? 1 : 0, 3, dt);
    c.color.lerp(target, 1 - Math.exp(-4 * dt));
    c.time += dt;
    c.phase += dt * c.speed;

    if (blobMat.current) {
      const u = blobMat.current.uniforms;
      u.uTime.value = c.time;
      u.uPhase.value = c.phase;
      u.uAmp.value = c.amp;
      u.uAudio.value = c.audio;
      u.uEnergy.value = c.energy;
      u.uColor.value.copy(c.color);
    }
    if (glowMat.current) {
      glowMat.current.uniforms.uEnergy.value = c.energy;
      glowMat.current.uniforms.uColor.value.copy(c.color);
    }
    if (spinGroup.current) spinGroup.current.rotation.y += dt * c.spin;
    if (ringMesh.current) ringMesh.current.rotation.z += dt * 0.12;
    if (stars.current) stars.current.rotation.y += dt * 0.01;
    if (swirl.current) {
      swirl.current.rotation.y += dt * (0.4 + c.think * 2.2);
      swirl.current.rotation.x += dt * c.think * 0.9;
    }
    if (swirlMat.current) swirlMat.current.opacity = c.think * 0.85;
  });

  return (
    <>
      <group ref={stars}>
        <Points positions={starPositions} size={0.025} opacity={0.5} />
      </group>

      {ring && (
        <mesh ref={ringMesh} rotation={[1.2, 0, 0]}>
          <torusGeometry args={[1.6, 0.004, 8, 220]} />
          <meshBasicMaterial color="#00d4ff" transparent opacity={0.22} />
        </mesh>
      )}

      <group ref={spinGroup}>
        <mesh>
          <icosahedronGeometry args={[1, 40]} />
          <shaderMaterial
            key={style.id}
            ref={blobMat}
            vertexShader={BLOB_VERT}
            fragmentShader={style.frag}
            uniforms={blobUniforms}
          />
        </mesh>
      </group>

      <group ref={swirl}>
        <Points positions={swirlPositions} size={0.035} opacity={0} color="#9ff4ff" additive innerRef={swirlMat} />
      </group>

      <mesh scale={style.glowScale}>
        <sphereGeometry args={[1, 48, 48]} />
        <shaderMaterial
          ref={glowMat}
          vertexShader={GLOW_VERT}
          fragmentShader={GLOW_FRAG}
          uniforms={glowUniforms}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/**
 * The JARVIS orb. State props are optional: anything you leave out is read from
 * the chat and agent stores, so layers 3 and 5 only need to pass `audioLevel`.
 * Visual style, ring, intensity and speed come from the orb store (Settings in
 * the customizer panel on Home), persisted to localStorage.
 */
export default function JarvisOrb(props: Partial<OrbProps>) {
  const storeListening = useChatStore((s) => s.isListening);
  const storeSpeaking = useChatStore((s) => s.isSpeaking);
  const storeThinking = useAgentStore((s) => s.isThinking);
  const styleId = useOrbStore((s) => s.style);
  const ring = useOrbStore((s) => s.ring);
  const intensity = useOrbStore((s) => s.intensity);
  const speedSetting = useOrbStore((s) => s.speed);

  const style = useMemo(() => getOrbStyle(styleId), [styleId]);

  const stateRef = useRef<OrbProps>({ isListening: false, isSpeaking: false, isThinking: false, audioLevel: 0 });
  stateRef.current = {
    isListening: props.isListening ?? storeListening,
    isSpeaking: props.isSpeaking ?? storeSpeaking,
    isThinking: props.isThinking ?? storeThinking,
    audioLevel: props.audioLevel ?? 0,
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          /* Just a soft edge vignette; owner wants no blue wash on the background. */
          background: "radial-gradient(120% 100% at 50% 50%, transparent 55%, rgb(0 0 0 / 0.55))",
        }}
      />
      <Canvas
        /* Camera pulled back from 4.4 → 5.8 so the orb stays clearly behind the
           chat (owner: "the blob is too big and you can't see the messages"). */
        camera={{ position: [0, 0, 5.8], fov: 45 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
      >
        <Scene
          key={style.id}
          stateRef={stateRef}
          style={style}
          ring={ring}
          intensity={intensity}
          speedSetting={speedSetting}
        />
      </Canvas>
    </div>
  );
}
