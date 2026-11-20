import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Mic, MicOff, PhoneCall, ScanSearch, Sparkles } from "lucide-react";
import { useAgentStore, useChatStore, useHudStore, useOrbStore, useUiStore } from "@/store";
import { getOrbStyle, NOISE, type OrbStyle } from "@/components/orb/styles";
import { getThemeById } from "@/lib/themes";
import { audioLevel as liveAudioLevel } from "@/lib/voiceEngine";
import { toggleMic as toggleVoiceMic } from "@/lib/voiceController";
import { agentService } from "@/lib/agentService";
import { cn } from "@/lib/cn";

export interface OrbProps {
  isListening: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  audioLevel?: number;
  compact?: boolean;
  onStartLiveCall?: () => void;
}

function detectSoftwareGl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return true;
    const dbg = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return false;
    const renderer = String((gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
    return /SwiftShader|llvmpipe|Software/i.test(renderer);
  } catch {
    return true;
  }
}

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
  gl_FragColor = vec4(uColor * i * uEnergy * 1.5, 1.0);
}
`;

function randomPoints(count: number, radius: number, shell = false): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = (shell ? 0.62 + Math.random() * 0.42 : Math.cbrt(Math.random())) * radius;
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
  particleDensity: number;
  intensity: number;
  speedSetting: number;
  primaryHex: string;
  secondaryHex: string;
  softwareGl: boolean;
}

function Scene({
  stateRef,
  style,
  ring,
  particleDensity,
  intensity,
  speedSetting,
  primaryHex,
  secondaryHex,
  softwareGl,
}: SceneProps) {
  const blobMat = useRef<THREE.ShaderMaterial>(null);
  const glowMat = useRef<THREE.ShaderMaterial>(null);
  const spinGroup = useRef<THREE.Group>(null);
  const ringMesh = useRef<THREE.Mesh>(null);
  const outerRingMesh = useRef<THREE.Mesh>(null);
  const eqRingMesh = useRef<THREE.Mesh>(null);
  const stars = useRef<THREE.Group>(null);
  const swirl = useRef<THREE.Group>(null);
  const swirlMat = useRef<THREE.PointsMaterial | null>(null);

  const primaryColor = useMemo(() => new THREE.Color(primaryHex), [primaryHex]);
  const secondaryColor = useMemo(() => new THREE.Color(secondaryHex), [secondaryHex]);

  const cur = useRef({
    amp: 0.1,
    speed: 0.35,
    energy: 0.55,
    audio: 0,
    spin: 0.12,
    think: 0,
    phase: 0,
    time: 0,
    color: new THREE.Color(primaryHex),
    secondary: new THREE.Color(secondaryHex),
  });

  const blobUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uAmp: { value: 0.1 },
      uAudio: { value: 0 },
      uColor: { value: new THREE.Color(primaryHex) },
      uSecondary: { value: new THREE.Color(secondaryHex) },
      uEnergy: { value: 0.55 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style.id],
  );

  const glowUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(primaryHex) }, uEnergy: { value: 0.55 } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const starCount = Math.round((softwareGl ? 90 : 190) * particleDensity);
  const swirlCount = Math.round((softwareGl ? 65 : 140) * particleDensity);
  const starPositions = useMemo(() => randomPoints(starCount, 9, true), [starCount]);
  const swirlPositions = useMemo(() => randomPoints(swirlCount, 0.85), [swirlCount]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = stateRef.current;
    const c = cur.current;
    const D = THREE.MathUtils.damp;
    const levelNow = typeof s.audioLevel === "number" ? s.audioLevel : liveAudioLevel;
    const audio = s.isSpeaking || s.isListening ? THREE.MathUtils.clamp(levelNow, 0, 1) : 0;

    let amp = 0.09;
    let speed = 0.38;
    let energy = 0.62;
    let spin = 0.14;
    let target = primaryColor;

    if (s.isThinking) {
      amp = 0.12;
      speed = 0.72;
      energy = 0.9;
      spin = 0.62;
      target = secondaryColor;
    }
    if (s.isListening) {
      amp = 0.16;
      speed = 1.15;
      energy = 1.05;
      spin = 0.24;
      target = secondaryColor;
    }
    if (s.isSpeaking) {
      amp = 0.12 + audio * 0.28;
      speed = 0.95 + audio * 1.25;
      energy = 0.92 + audio * 0.45;
      target = secondaryColor;
    }

    amp *= style.dispScale * intensity;
    speed *= speedSetting;
    energy = THREE.MathUtils.clamp(energy * (0.75 + 0.35 * intensity), 0, 1.65);

    c.amp = D(c.amp, amp, 5, dt);
    c.speed = D(c.speed, speed, 4, dt);
    c.energy = D(c.energy, energy, 4, dt);
    c.audio = D(c.audio, audio, 14, dt);
    c.spin = D(c.spin, spin * speedSetting, 3, dt);
    c.think = D(c.think, s.isThinking && !s.isSpeaking ? 1 : 0, 3, dt);
    c.color.lerp(target, 1 - Math.exp(-4 * dt));
    c.secondary.lerp(secondaryColor, 1 - Math.exp(-4 * dt));
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
      u.uSecondary.value.copy(c.secondary);
    }
    if (glowMat.current) {
      glowMat.current.uniforms.uEnergy.value = c.energy;
      glowMat.current.uniforms.uColor.value.copy(c.color);
    }
    if (spinGroup.current) {
      spinGroup.current.rotation.y += dt * c.spin;
      const pulse = 1 + c.audio * 0.08;
      spinGroup.current.scale.setScalar(pulse);
    }
    if (ringMesh.current) {
      ringMesh.current.rotation.z += dt * (0.18 + c.audio * 0.5) * speedSetting;
      ringMesh.current.rotation.x += dt * 0.05 * speedSetting;
    }
    if (outerRingMesh.current) {
      outerRingMesh.current.rotation.z -= dt * (0.12 + c.think * 0.35) * speedSetting;
      outerRingMesh.current.rotation.y += dt * 0.08 * speedSetting;
    }
    if (eqRingMesh.current) {
      eqRingMesh.current.rotation.y -= dt * 0.22 * speedSetting;
      eqRingMesh.current.scale.setScalar(1 + c.audio * 0.14);
    }
    if (stars.current) stars.current.rotation.y += dt * 0.015 * speedSetting;
    if (swirl.current) {
      swirl.current.rotation.y += dt * (0.45 + c.think * 2.2) * speedSetting;
      swirl.current.rotation.x += dt * c.think * 0.9;
    }
    if (swirlMat.current) swirlMat.current.opacity = Math.max(0.18, c.think * 0.85 + c.audio * 0.4);
  });

  return (
    <>
      <group ref={stars}>
        <Points positions={starPositions} size={0.025} opacity={0.48} color={secondaryHex} />
      </group>

      {ring && (
        <>
          <mesh ref={ringMesh} rotation={[1.15, 0.18, 0]}>
            <torusGeometry args={[1.48, 0.008, 10, softwareGl ? 96 : 180]} />
            <meshBasicMaterial color={primaryHex} transparent opacity={0.48} />
          </mesh>
          <mesh ref={outerRingMesh} rotation={[-0.95, 0.35, 0]}>
            <torusGeometry args={[1.78, 0.005, 8, softwareGl ? 96 : 180]} />
            <meshBasicMaterial color={secondaryHex} transparent opacity={0.28} />
          </mesh>
          <mesh ref={eqRingMesh} rotation={[0.25, 0.9, 0.4]}>
            <torusGeometry args={[1.3, 0.004, 8, softwareGl ? 72 : 140]} />
            <meshBasicMaterial color={primaryHex} transparent opacity={0.24} />
          </mesh>
        </>
      )}

      <group ref={spinGroup}>
        <mesh>
          {style.geometry === "octahedron" ? (
            <octahedronGeometry args={[1.05, 0]} />
          ) : style.geometry === "torusKnot" ? (
            <torusKnotGeometry args={[0.68, 0.22, softwareGl ? 64 : 120, 16]} />
          ) : (
            <icosahedronGeometry args={[1, softwareGl ? 16 : 32]} />
          )}
          <shaderMaterial
            key={style.id}
            ref={blobMat}
            vertexShader={BLOB_VERT}
            fragmentShader={style.frag}
            uniforms={blobUniforms}
          />
        </mesh>

        {(style.geometry === "wireShell" || style.geometry === "octahedron") && (
          <mesh scale={1.18}>
            <icosahedronGeometry args={[1, 2]} />
            <meshBasicMaterial color={secondaryHex} wireframe transparent opacity={0.28} />
          </mesh>
        )}
      </group>

      <group ref={swirl}>
        <Points
          positions={swirlPositions}
          size={0.032}
          opacity={0.2}
          color={secondaryHex}
          additive
          innerRef={swirlMat}
        />
      </group>

      <mesh scale={style.glowScale}>
        <sphereGeometry args={[1, softwareGl ? 24 : 44, softwareGl ? 24 : 44]} />
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

function ArcCoreFallback({
  accent,
  secondary,
  activeState,
}: {
  accent: string;
  secondary: string;
  activeState: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg viewBox="0 0 220 220" className="h-56 w-56 opacity-90" aria-label={`JARVIS Core ${activeState}`}>
        <circle cx="110" cy="110" r="88" stroke={accent} strokeWidth="1.5" strokeDasharray="10 6" fill="none" opacity="0.55" />
        <circle cx="110" cy="110" r="66" stroke={secondary} strokeWidth="2.2" fill="none" opacity="0.75" />
        <circle cx="110" cy="110" r="34" stroke={accent} strokeWidth="3" fill="none" />
        <circle cx="110" cy="110" r="14" fill={accent} opacity="0.85" />
      </svg>
    </div>
  );
}

function StarkReticleOverlay({ accent, secondary, activeLabel }: { accent: string; secondary: string; activeLabel: string }) {
  return (
    <svg
      viewBox="0 0 320 320"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-55"
      aria-hidden
    >
      <circle
        cx="160"
        cy="160"
        r="138"
        fill="none"
        stroke={accent}
        strokeWidth="0.85"
        strokeDasharray="6 8 18 8"
      />
      <circle
        cx="160"
        cy="160"
        r="116"
        fill="none"
        stroke={secondary}
        strokeWidth="0.7"
        strokeDasharray="2 6"
        opacity="0.75"
      />
      <path d="M 160 12 L 160 28 M 160 292 L 160 308 M 12 160 L 28 160 M 292 160 L 308 160" stroke={accent} strokeWidth="1.2" />
      <text
        x="160"
        y="302"
        textAnchor="middle"
        fill={accent}
        fontSize="8"
        fontFamily="monospace"
        letterSpacing="2"
      >
        {activeLabel.toUpperCase()}
      </text>
    </svg>
  );
}

export default function JarvisOrb(props: Partial<OrbProps>) {
  const storeListening = useChatStore((s) => s.isListening);
  const storeSpeaking = useChatStore((s) => s.isSpeaking);
  const storeThinking = useAgentStore((s) => s.isThinking);
  const styleId = useOrbStore((s) => s.style);
  const ring = useOrbStore((s) => s.ring);
  const reticle = useOrbStore((s) => s.reticle);
  const particleDensity = useOrbStore((s) => s.particleDensity);
  const intensity = useOrbStore((s) => s.intensity);
  const speedSetting = useOrbStore((s) => s.speed);

  const themeId = useHudStore((s) => s.themeId);
  const customAccent = useHudStore((s) => s.customAccent);
  const visualizerAbilities = useHudStore((s) => s.visualizerAbilities);
  const setCircleToSearchOpen = useUiStore((s) => s.setCircleToSearchOpen);

  const activeTheme = useMemo(() => getThemeById(themeId), [themeId]);
  const primaryHex = customAccent.trim() || activeTheme.orbPrimary;
  const secondaryHex = activeTheme.orbSecondary;

  const style = useMemo(() => getOrbStyle(styleId), [styleId]);
  const softwareGl = useMemo(() => detectSoftwareGl(), []);
  const [contextLost, setContextLost] = useState(false);

  const stateRef = useRef<OrbProps>({
    isListening: false,
    isSpeaking: false,
    isThinking: false,
  });
  stateRef.current = {
    isListening: props.isListening ?? storeListening,
    isSpeaking: props.isSpeaking ?? storeSpeaking,
    isThinking: props.isThinking ?? storeThinking,
    audioLevel: props.audioLevel,
  };

  useEffect(() => {
    setContextLost(false);
  }, [styleId, themeId]);

  const activeLabel = stateRef.current.isSpeaking
    ? "Speaking"
    : stateRef.current.isListening
      ? "Listening"
      : stateRef.current.isThinking
        ? "Reasoning"
        : "Standby";

  const toggleMic = () => {
    void toggleVoiceMic("manual");
  };

  return (
    <div data-testid="jarvis-core" className="relative h-full w-full overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={toggleMic}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggleMic();
        }}
        title="Click Core to toggle Voice Input"
        className="h-full w-full cursor-pointer outline-none"
      >
        {contextLost ? (
          <ArcCoreFallback accent={primaryHex} secondary={secondaryHex} activeState={activeLabel} />
        ) : (
          <Canvas
            camera={{ position: [0, 0, 5.5], fov: 44 }}
            dpr={softwareGl ? 1 : [1, 1.75]}
            gl={{ alpha: true, antialias: !softwareGl, powerPreference: "high-performance" }}
            style={{ background: "transparent" }}
            onCreated={({ gl }) => {
              const el = gl.domElement;
              el.addEventListener("webglcontextlost", (e) => {
                e.preventDefault();
                setContextLost(true);
              });
              el.addEventListener("webglcontextrestored", () => {
                setContextLost(false);
              });
            }}
          >
            <Scene
              stateRef={stateRef}
              style={style}
              ring={ring}
              particleDensity={particleDensity}
              intensity={intensity}
              speedSetting={speedSetting}
              primaryHex={primaryHex}
              secondaryHex={secondaryHex}
              softwareGl={softwareGl}
            />
          </Canvas>
        )}
      </div>

      {reticle && !props.compact && (
        <StarkReticleOverlay accent={primaryHex} secondary={secondaryHex} activeLabel={activeLabel} />
      )}

      {visualizerAbilities && !props.compact && (
        <div
          className="absolute inset-x-2 bottom-2 z-10 grid grid-cols-4 gap-1"
          data-testid="orb-abilities"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleMic();
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1.5 text-[10px] font-medium transition-colors",
              stateRef.current.isListening
                ? "border-accent bg-accent text-background"
                : "border-border bg-surface text-fg hover:border-accent/60",
            )}
            title="Tap to Speak"
          >
            {stateRef.current.isListening ? <MicOff size={12} /> : <Mic size={12} />}
            <span>{stateRef.current.isListening ? "Mute" : "Talk"}</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCircleToSearchOpen(true);
            }}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-surface px-1.5 py-1.5 text-[10px] font-medium text-fg transition-colors hover:border-accent/60"
            title="Circle part of the screen to analyze & search"
          >
            <ScanSearch size={12} className="text-accent" />
            <span>Circle</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (props.onStartLiveCall) props.onStartLiveCall();
              else window.dispatchEvent(new CustomEvent("jarvis-toggle-live-call"));
            }}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-surface px-1.5 py-1.5 text-[10px] font-medium text-fg transition-colors hover:border-accent/60"
            title="Start or toggle Live Voice Call"
          >
            <PhoneCall size={12} className="text-accent" />
            <span>Live</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              agentService.send("Give me a crisp system, calendar, and smart home status briefing with a live chart.");
            }}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-surface px-1.5 py-1.5 text-[10px] font-medium text-fg transition-colors hover:border-accent/60"
            title="Run instant proactive diagnostics & briefing"
          >
            <Sparkles size={12} className="text-accent" />
            <span>Scan</span>
          </button>
        </div>
      )}
    </div>
  );
}
