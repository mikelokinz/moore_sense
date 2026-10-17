import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { BuoyState, GPSTrailPoint } from './watchCircleTypes';
import type { WaveParams } from '../../utils/waveMath';
import { computeWaveParams, getWaveDisplacement, getWaveNormal } from '../../utils/waveMath';

interface WatchCircleOverlayProps {
  radiusMeters: number;
  buoyState: BuoyState;
  gpsTrail: GPSTrailPoint[];
  showBoundary?: boolean;
  showTrail?: boolean;
  showExcursionVector?: boolean;
  waveParams?: WaveParams;
  liveMotionRef?: React.MutableRefObject<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    keelPosition: THREE.Vector3;
  }>;
  predictedPos?: { x: number; z: number } | null;
  isPredictionMode?: boolean;
  showBadges?: boolean;
}

// ── Shared Gerstner Wave Vertex Shader for Conforming Overlays ──────────────
// Uses the EXACT 4-harmonic Gerstner wave formulation as WaveSurface.tsx
// Evaluates normal via finite differences and applies a normal offset so
// the overlay hovers dynamically just above the moving water film without clipping.
const waveOverlayVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uChoppiness;
  uniform float uFrequency;
  uniform vec2 uDirection;
  uniform float uNormalOffset;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWaveNormal;
  varying float vElevation;

  vec3 gerstnerWave(vec2 pos, float amp, float freq, vec2 dir, float phase, float steep) {
    float d = dot(dir, pos);
    float s = sin(d * freq - phase);
    float c = cos(d * freq - phase);
    vec3 offset;
    offset.x = steep * amp * dir.x * c;
    offset.z = steep * amp * dir.y * c;
    offset.y = amp * s;
    return offset;
  }
  
  vec2 rotateVec2(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }
  
  vec3 getDisplacement(vec2 p, float amp, float freq, vec2 dir, float t, float steep) {
    vec2 d1 = dir;
    vec2 d2 = rotateVec2(dir, 0.5);
    vec2 d3 = rotateVec2(dir, -0.7);
    vec2 d4 = rotateVec2(dir, 1.2);
    
    vec3 w1 = gerstnerWave(p, amp, freq, d1, t * 1.2, steep);
    vec3 w2 = gerstnerWave(p, amp * 0.45, freq * 1.7, d2, t * 1.5, steep * 0.8);
    vec3 w3 = gerstnerWave(p, amp * 0.3, freq * 2.3, d3, t * 1.8, steep * 0.6);
    vec3 w4 = gerstnerWave(p, amp * 0.15, freq * 4.1, d4, t * 2.5, steep * 0.3);
    
    return w1 + w2 + w3 + w4;
  }
  
  void main() {
    vUv = uv;
    vec3 pos = position; // Local vertex in X-Z plane (already pre-rotated by rotateX(-PI/2))
    
    vec3 offset = getDisplacement(pos.xz, uAmplitude, uFrequency, uDirection, uTime, uChoppiness);
    vec3 displaced = pos + offset;
    
    // Finite difference for exact surface normal matching WaveSurface
    float eps = 0.08;
    vec3 px = pos + vec3(eps, 0.0, 0.0) + getDisplacement(pos.xz + vec2(eps, 0.0), uAmplitude, uFrequency, uDirection, uTime, uChoppiness);
    vec3 pz = pos + vec3(0.0, 0.0, eps) + getDisplacement(pos.xz + vec2(0.0, eps), uAmplitude, uFrequency, uDirection, uTime, uChoppiness);
    vec3 waveNorm = normalize(cross(pz - displaced, px - displaced));
    vWaveNormal = waveNorm;
    
    // Displace along normal so overlay floats gracefully above water surface film
    displaced += waveNorm * uNormalOffset;
    
    vElevation = displaced.y;
    vWorldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
  }
`;

// ── Semi-transparent Zone Disc Fragment Shader ──────────────────────────────
const discFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uTime;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWaveNormal;
  varying float vElevation;

  void main() {
    float r = length(vWorldPosition.xz);
    float normR = clamp(r / uRadius, 0.0, 1.0);
    
    // Concentric radar telemetry range rings at 25%, 50%, 75%, 100%
    float ringDist = fract(normR * 4.0);
    float ringLine = smoothstep(0.95, 0.985, ringDist) + smoothstep(0.05, 0.015, ringDist);
    
    // Rotating radar sweep beam (slow circular scanning shimmer)
    float angle = atan(vWorldPosition.z, vWorldPosition.x);
    float sweep = fract((angle + uTime * 0.35) / 6.2831853);
    float sweepTrail = smoothstep(0.0, 0.25, sweep) * (1.0 - sweep);
    
    // Subtle wave crest highlight (reactive to local wave height)
    float crestGlow = smoothstep(0.05, 0.40, vElevation) * 0.16;
    
    // Base soft alpha (slightly denser toward center)
    float baseAlpha = 0.045 + 0.035 * (1.0 - normR);
    float ringAlpha = ringLine * 0.12;
    float sweepAlpha = sweepTrail * 0.07;
    
    float totalAlpha = (baseAlpha + ringAlpha + sweepAlpha + crestGlow) * uOpacity;
    
    // Soft anti-aliased edge falloff right at boundary perimeter
    float edgeFade = smoothstep(1.0, 0.965, normR);
    totalAlpha *= edgeFade;
    
    vec3 col = uColor + vec3(0.09, 0.14, 0.18) * ringLine + vec3(0.08, 0.12, 0.16) * sweepTrail;
    
    gl_FragColor = vec4(col, totalAlpha);
  }
`;

// ── Solid Perimeter Boundary Ring Fragment Shader ───────────────────────────
const perimeterRingFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uIsBreach;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWaveNormal;
  varying float vElevation;

  void main() {
    float r = length(vWorldPosition.xz);
    float distFromRadius = abs(r - uRadius);
    
    // Razor-sharp laser center core with luminous bloom falloff
    float core = smoothstep(0.042, 0.0, distFromRadius);
    float halo = smoothstep(0.155, 0.0, distFromRadius);
    
    // Circumferential tick notch pattern (72 tick dashes around 360°)
    float angle = atan(vWorldPosition.z, vWorldPosition.x);
    float tickPattern = sin(angle * 72.0);
    float tickGlow = smoothstep(0.2, 0.9, tickPattern) * 0.20;
    
    // Traveling energetic pulse along the ring
    float speed = uIsBreach > 0.5 ? 4.5 : 1.8;
    float pulse = sin(angle * 4.0 - uTime * speed);
    float pulseGlow = smoothstep(0.3, 1.0, pulse) * 0.35;
    
    float alpha = (core * 0.92 + halo * 0.45 + tickGlow + pulseGlow) * uOpacity;
    
    vec3 col = uColor + vec3(0.28) * core + vec3(0.18) * pulseGlow;
    
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Pulsing Warning Outer Halo Ring Fragment Shader ─────────────────────────
const haloFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeed;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vElevation;

  void main() {
    float r = length(vWorldPosition.xz);
    float outerDist = r - uRadius;
    float normDist = clamp((outerDist - 0.16) / 0.49, 0.0, 1.0);
    float radialFade = (1.0 - normDist) * (1.0 - normDist);
    
    // Rhythmic breathing pulse
    float pulse = 0.5 + 0.5 * sin(uTime * uSpeed);
    float alpha = radialFade * (0.08 + 0.35 * pulse) * uOpacity;
    
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// ── GPS Trajectory Breadcrumb Trail Shader ──────────────────────────────────
const trailVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uChoppiness;
  uniform float uFrequency;
  uniform vec2 uDirection;
  uniform float uNormalOffset;

  varying vec3 vWorldPosition;

  vec3 gerstnerWave(vec2 pos, float amp, float freq, vec2 dir, float phase, float steep) {
    float d = dot(dir, pos);
    float s = sin(d * freq - phase);
    float c = cos(d * freq - phase);
    vec3 offset;
    offset.x = steep * amp * dir.x * c;
    offset.z = steep * amp * dir.y * c;
    offset.y = amp * s;
    return offset;
  }
  
  vec2 rotateVec2(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }
  
  vec3 getDisplacement(vec2 p, float amp, float freq, vec2 dir, float t, float steep) {
    vec2 d1 = dir;
    vec2 d2 = rotateVec2(dir, 0.5);
    vec2 d3 = rotateVec2(dir, -0.7);
    vec2 d4 = rotateVec2(dir, 1.2);
    
    vec3 w1 = gerstnerWave(p, amp, freq, d1, t * 1.2, steep);
    vec3 w2 = gerstnerWave(p, amp * 0.45, freq * 1.7, d2, t * 1.5, steep * 0.8);
    vec3 w3 = gerstnerWave(p, amp * 0.3, freq * 2.3, d3, t * 1.8, steep * 0.6);
    vec3 w4 = gerstnerWave(p, amp * 0.15, freq * 4.1, d4, t * 2.5, steep * 0.3);
    
    return w1 + w2 + w3 + w4;
  }

  void main() {
    vec3 pos = position;
    vec3 offset = getDisplacement(pos.xz, uAmplitude, uFrequency, uDirection, uTime, uChoppiness);
    vec3 displaced = pos + offset;
    
    float eps = 0.08;
    vec3 px = pos + vec3(eps, 0.0, 0.0) + getDisplacement(pos.xz + vec2(eps, 0.0), uAmplitude, uFrequency, uDirection, uTime, uChoppiness);
    vec3 pz = pos + vec3(0.0, 0.0, eps) + getDisplacement(pos.xz + vec2(0.0, eps), uAmplitude, uFrequency, uDirection, uTime, uChoppiness);
    vec3 waveNorm = normalize(cross(pz - displaced, px - displaced));
    
    displaced += waveNorm * uNormalOffset;
    vWorldPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
  }
`;

const trailFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

export function WatchCircleOverlay({
  radiusMeters,
  buoyState,
  gpsTrail,
  showBoundary = true,
  showTrail = true,
  showExcursionVector = true,
  waveParams,
  liveMotionRef,
  predictedPos = null,
  isPredictionMode = false,
  showBadges = true,
}: WatchCircleOverlayProps) {
  // Conversion: 1 3D scene unit = 30 meters
  const M_TO_3D = 1 / 30;

  // 1. Calm Condition Circle (Green): Normal calm weather excursion limit (~38% of radius, ~137m in real water)
  const calmRadiusMeters = radiusMeters * 0.38;
  const calmRadius3D = calmRadiusMeters * M_TO_3D;

  // 2. Inner Circle (Yellow / Gold): Primary nominal watch circle perimeter (~360m in real water)
  const innerRadius3D = radiusMeters * M_TO_3D;

  // 3. Outer Circle (Red): Maximum excursion / heavy-weather boundary (1.30x radius, ~468m in real water)
  const outerRadiusMeters = radiusMeters * 1.30;
  const outerRadius3D = outerRadiusMeters * M_TO_3D;

  // Active wave parameters (deterministic fallback if not provided)
  const activeWaveParams = useMemo(() => {
    return waveParams || computeWaveParams(1.5, 1.5, 0.4, 28.0);
  }, [waveParams]);

  // Nominal fallback buoy position in 3D units
  const buoyPos3D = useMemo(() => {
    return new THREE.Vector3(
      buoyState.excursionX * M_TO_3D,
      0.08,
      buoyState.excursionZ * M_TO_3D
    );
  }, [buoyState.excursionX, buoyState.excursionZ, M_TO_3D]);

  // ── High-density Subdivided Geometries (Pre-rotated to X-Z plane) ───────────
  // 1. Calm Condition Circle (Green)
  const calmDiscGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(0.15, calmRadius3D, 140, 24);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [calmRadius3D]);

  const calmPerimeterGeo = useMemo(() => {
    const inner = Math.max(0.1, calmRadius3D - 0.12);
    const outer = calmRadius3D + 0.12;
    const geo = new THREE.RingGeometry(inner, outer, 220, 4);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [calmRadius3D]);

  // 2. Inner Primary Watch Circle (Yellow / Gold) - spans from calmRadius3D to innerRadius3D
  const innerDiscGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(calmRadius3D, innerRadius3D, 160, 28);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [calmRadius3D, innerRadius3D]);

  const innerPerimeterGeo = useMemo(() => {
    const inner = Math.max(0.1, innerRadius3D - 0.14);
    const outer = innerRadius3D + 0.14;
    const geo = new THREE.RingGeometry(inner, outer, 240, 4);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [innerRadius3D]);

  // 3. Outer Maximum Excursion Boundary (Red / Heavy Weather)
  const outerPerimeterGeo = useMemo(() => {
    const inner = Math.max(0.1, outerRadius3D - 0.16);
    const outer = outerRadius3D + 0.16;
    const geo = new THREE.RingGeometry(inner, outer, 240, 4);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [outerRadius3D]);

  const outerHaloGeo = useMemo(() => {
    const inner = outerRadius3D + 0.16;
    const outer = outerRadius3D + 0.65;
    const geo = new THREE.RingGeometry(inner, outer, 240, 4);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [outerRadius3D]);

  // ── Custom Shader Materials with Wave Conformance ─────────────────────────
  const calmDiscMatRef = useRef<THREE.ShaderMaterial>(null!);
  const calmPerimeterMatRef = useRef<THREE.ShaderMaterial>(null!);
  const innerDiscMatRef = useRef<THREE.ShaderMaterial>(null!);
  const innerPerimeterMatRef = useRef<THREE.ShaderMaterial>(null!);
  const outerPerimeterMatRef = useRef<THREE.ShaderMaterial>(null!);
  const outerHaloMatRef = useRef<THREE.ShaderMaterial>(null!);

  const calmDiscMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: waveOverlayVertexShader,
      fragmentShader: discFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.024 },
        uColor: { value: new THREE.Color('#10b981') }, // Emerald Green
        uRadius: { value: calmRadius3D },
        uOpacity: { value: 0.70 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [activeWaveParams, calmRadius3D]);

  const calmPerimeterMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: waveOverlayVertexShader,
      fragmentShader: perimeterRingFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.036 },
        uColor: { value: new THREE.Color('#10b981') }, // Glowing Emerald Green
        uRadius: { value: calmRadius3D },
        uOpacity: { value: 0.95 },
        uIsBreach: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [activeWaveParams, calmRadius3D]);

  const innerDiscMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: waveOverlayVertexShader,
      fragmentShader: discFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.025 },
        uColor: { value: new THREE.Color('#f59e0b') }, // Yellow / Gold
        uRadius: { value: innerRadius3D },
        uOpacity: { value: 0.75 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [activeWaveParams, innerRadius3D]);

  const innerPerimeterMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: waveOverlayVertexShader,
      fragmentShader: perimeterRingFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.038 },
        uColor: { value: new THREE.Color('#fbbf24') }, // Glowing Yellow
        uRadius: { value: innerRadius3D },
        uOpacity: { value: 0.95 },
        uIsBreach: { value: buoyState.status === 'BREACH' ? 1.0 : 0.0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [activeWaveParams, innerRadius3D, buoyState.status]);

  const outerPerimeterMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: waveOverlayVertexShader,
      fragmentShader: perimeterRingFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.040 },
        uColor: { value: new THREE.Color('#ef4444') }, // Glowing Crimson Red
        uRadius: { value: outerRadius3D },
        uOpacity: { value: 0.95 },
        uIsBreach: { value: 1.0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [activeWaveParams, outerRadius3D]);

  const outerHaloMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: waveOverlayVertexShader,
      fragmentShader: haloFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.048 },
        uColor: { value: new THREE.Color('#dc2626') }, // Deep Red Warning Halo
        uRadius: { value: outerRadius3D },
        uOpacity: { value: buoyState.status === 'BREACH' ? 0.9 : 0.4 },
        uSpeed: { value: buoyState.status === 'BREACH' ? 4.5 : 1.8 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }, [activeWaveParams, outerRadius3D, buoyState.status]);

  // Clean up materials on unmount
  useEffect(() => {
    return () => {
      calmDiscMaterial.dispose();
      calmPerimeterMaterial.dispose();
      innerDiscMaterial.dispose();
      innerPerimeterMaterial.dispose();
      outerPerimeterMaterial.dispose();
      outerHaloMaterial.dispose();
      calmDiscGeo.dispose();
      calmPerimeterGeo.dispose();
      innerDiscGeo.dispose();
      innerPerimeterGeo.dispose();
      outerPerimeterGeo.dispose();
      outerHaloGeo.dispose();
    };
  }, [
    calmDiscMaterial,
    calmPerimeterMaterial,
    innerDiscMaterial,
    innerPerimeterMaterial,
    outerPerimeterMaterial,
    outerHaloMaterial,
    calmDiscGeo,
    calmPerimeterGeo,
    innerDiscGeo,
    innerPerimeterGeo,
    outerPerimeterGeo,
    outerHaloGeo,
  ]);

  // ── Dynamic Scene Component Refs ──────────────────────────────────────────
  const centerDatumRef = useRef<THREE.Group>(null!);
  const calmTickRefs = useRef<(THREE.Group | null)[]>([null, null, null, null]);
  const compassTickRefs = useRef<(THREE.Group | null)[]>([null, null, null, null]);
  const outerTickRefs = useRef<(THREE.Group | null)[]>([null, null, null, null]);
  const excursionMeshRef = useRef<THREE.Mesh>(null!);
  const excursionTargetSphereRef = useRef<THREE.Mesh>(null!);
  const predictedWaypointRef = useRef<THREE.Group>(null!);
  const predTrajectoryMeshRef = useRef<THREE.Mesh>(null!);

  // ── Wave-Conforming GPS Trail Line ────────────────────────────────────────
  const trailLine = useMemo(() => {
    if (!gpsTrail || gpsTrail.length < 2) return null;
    const positions = new Float32Array(gpsTrail.length * 3);
    for (let i = 0; i < gpsTrail.length; i++) {
      positions[i * 3] = gpsTrail[i].x * M_TO_3D;
      positions[i * 3 + 1] = 0.04;
      positions[i * 3 + 2] = gpsTrail[i].z * M_TO_3D;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: trailVertexShader,
      fragmentShader: trailFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: activeWaveParams.amplitude },
        uChoppiness: { value: activeWaveParams.choppiness },
        uFrequency: { value: activeWaveParams.frequency },
        uDirection: { value: activeWaveParams.direction },
        uNormalOffset: { value: 0.042 },
        uColor: { value: new THREE.Color('#06b6d4') },
        uOpacity: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false,
    });
    return new THREE.Line(geo, mat);
  }, [gpsTrail, M_TO_3D, activeWaveParams]);

  // Dynamic excursion vector color based on zone
  const excursionVectorColor =
    buoyState.status === 'BREACH'
      ? '#ef4444'
      : buoyState.excursionDistance > calmRadiusMeters
      ? '#fbbf24'
      : '#10b981';

  // ── Real-Time Dynamic Wave Motion Loop ────────────────────────────────────
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { amplitude, choppiness, frequency, direction } = activeWaveParams;

    // 1. Update GPU Shaders
    if (calmDiscMatRef.current) {
      const mat = calmDiscMatRef.current;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAmplitude.value = amplitude;
      mat.uniforms.uChoppiness.value = choppiness;
      mat.uniforms.uFrequency.value = frequency;
      mat.uniforms.uDirection.value = direction;
      mat.uniforms.uRadius.value = calmRadius3D;
    }

    if (calmPerimeterMatRef.current) {
      const mat = calmPerimeterMatRef.current;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAmplitude.value = amplitude;
      mat.uniforms.uChoppiness.value = choppiness;
      mat.uniforms.uFrequency.value = frequency;
      mat.uniforms.uDirection.value = direction;
      mat.uniforms.uRadius.value = calmRadius3D;
    }

    if (innerDiscMatRef.current) {
      const mat = innerDiscMatRef.current;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAmplitude.value = amplitude;
      mat.uniforms.uChoppiness.value = choppiness;
      mat.uniforms.uFrequency.value = frequency;
      mat.uniforms.uDirection.value = direction;
      mat.uniforms.uRadius.value = innerRadius3D;
    }

    if (innerPerimeterMatRef.current) {
      const mat = innerPerimeterMatRef.current;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAmplitude.value = amplitude;
      mat.uniforms.uChoppiness.value = choppiness;
      mat.uniforms.uFrequency.value = frequency;
      mat.uniforms.uDirection.value = direction;
      mat.uniforms.uRadius.value = innerRadius3D;
      mat.uniforms.uIsBreach.value = buoyState.status === 'BREACH' ? 1.0 : 0.0;
    }

    if (outerPerimeterMatRef.current) {
      const mat = outerPerimeterMatRef.current;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAmplitude.value = amplitude;
      mat.uniforms.uChoppiness.value = choppiness;
      mat.uniforms.uFrequency.value = frequency;
      mat.uniforms.uDirection.value = direction;
      mat.uniforms.uRadius.value = outerRadius3D;
    }

    if (outerHaloMatRef.current) {
      const mat = outerHaloMatRef.current;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uAmplitude.value = amplitude;
      mat.uniforms.uChoppiness.value = choppiness;
      mat.uniforms.uFrequency.value = frequency;
      mat.uniforms.uDirection.value = direction;
      mat.uniforms.uRadius.value = outerRadius3D;
      mat.uniforms.uOpacity.value = buoyState.status === 'BREACH' ? 0.9 : 0.45;
      mat.uniforms.uSpeed.value = buoyState.status === 'BREACH' ? 4.5 : 1.8;
    }

    if (trailLine) {
      const mat = trailLine.material as THREE.ShaderMaterial;
      if (mat?.uniforms) {
        mat.uniforms.uTime.value = t;
        mat.uniforms.uAmplitude.value = amplitude;
        mat.uniforms.uChoppiness.value = choppiness;
        mat.uniforms.uFrequency.value = frequency;
        mat.uniforms.uDirection.value = direction;
      }
    }

    // 2. Animate Nominal Center Datum Marker on Ocean Surface Swell
    const disp0 = getWaveDisplacement(0, 0, t, activeWaveParams);
    const norm0 = getWaveNormal(0, 0, t, activeWaveParams);
    if (centerDatumRef.current) {
      centerDatumRef.current.position.set(
        disp0.x + norm0.x * 0.038,
        disp0.y + norm0.y * 0.038,
        disp0.z + norm0.z * 0.038
      );
      centerDatumRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm0);
    }

    // 3. Animate Cardinal Compass Ticks along Calm Green, Inner Yellow & Outer Red Perimeters
    const cardinalAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (let idx = 0; idx < 4; idx++) {
      const angle = cardinalAngles[idx];

      // Calm Green ticks
      const calmTickRef = calmTickRefs.current[idx];
      if (calmTickRef) {
        const baseX = Math.sin(angle) * calmRadius3D;
        const baseZ = Math.cos(angle) * calmRadius3D;
        const disp = getWaveDisplacement(baseX, baseZ, t, activeWaveParams);
        const norm = getWaveNormal(baseX, baseZ, t, activeWaveParams);
        calmTickRef.position.set(
          baseX + disp.x + norm.x * 0.045,
          disp.y + norm.y * 0.045,
          baseZ + disp.z + norm.z * 0.045
        );
        const qNorm = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        calmTickRef.quaternion.copy(qNorm).multiply(qYaw);
      }

      // Inner Yellow ticks
      const tickRef = compassTickRefs.current[idx];
      if (tickRef) {
        const baseX = Math.sin(angle) * innerRadius3D;
        const baseZ = Math.cos(angle) * innerRadius3D;
        const disp = getWaveDisplacement(baseX, baseZ, t, activeWaveParams);
        const norm = getWaveNormal(baseX, baseZ, t, activeWaveParams);
        tickRef.position.set(
          baseX + disp.x + norm.x * 0.045,
          disp.y + norm.y * 0.045,
          baseZ + disp.z + norm.z * 0.045
        );
        const qNorm = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        tickRef.quaternion.copy(qNorm).multiply(qYaw);
      }

      // Outer Red ticks
      const outerTickRef = outerTickRefs.current[idx];
      if (outerTickRef) {
        const baseX = Math.sin(angle) * outerRadius3D;
        const baseZ = Math.cos(angle) * outerRadius3D;
        const disp = getWaveDisplacement(baseX, baseZ, t, activeWaveParams);
        const norm = getWaveNormal(baseX, baseZ, t, activeWaveParams);
        outerTickRef.position.set(
          baseX + disp.x + norm.x * 0.045,
          disp.y + norm.y * 0.045,
          baseZ + disp.z + norm.z * 0.045
        );
        const qNorm = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), norm);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        outerTickRef.quaternion.copy(qNorm).multiply(qYaw);
      }
    }

    // 4. Animate Dynamic Excursion Vector connecting Center Datum to Buoy
    let currentBuoyPos = buoyPos3D;
    if (liveMotionRef?.current) {
      currentBuoyPos = liveMotionRef.current.position;
    } else {
      const bx = buoyState.excursionX * M_TO_3D;
      const bz = buoyState.excursionZ * M_TO_3D;
      const bDisp = getWaveDisplacement(bx, bz, t, activeWaveParams);
      currentBuoyPos = new THREE.Vector3(bx + bDisp.x, bDisp.y + 0.26, bz + bDisp.z);
    }

    if (excursionMeshRef.current && showExcursionVector && buoyState.excursionDistance > 3) {
      const origin = new THREE.Vector3(
        disp0.x + norm0.x * 0.05,
        disp0.y + norm0.y * 0.05,
        disp0.z + norm0.z * 0.05
      );

      const target = currentBuoyPos;
      const dist = origin.distanceTo(target);
      if (dist > 0.15) {
        excursionMeshRef.current.visible = true;
        const mid = new THREE.Vector3().addVectors(origin, target).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(target, origin).normalize();
        const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        excursionMeshRef.current.position.copy(mid);
        excursionMeshRef.current.quaternion.copy(orientation);
        excursionMeshRef.current.scale.set(1, dist, 1);

        if (excursionTargetSphereRef.current) {
          excursionTargetSphereRef.current.position.copy(target);
          excursionTargetSphereRef.current.visible = true;
        }
      } else {
        excursionMeshRef.current.visible = false;
        if (excursionTargetSphereRef.current) {
          excursionTargetSphereRef.current.visible = false;
        }
      }
    }

    // 5. Animate Satellite AI Prediction Waypoint & Trajectory Arc
    if (predictedPos && predictedWaypointRef.current) {
      const px = predictedPos.x * M_TO_3D;
      const pz = predictedPos.z * M_TO_3D;
      const pDisp = getWaveDisplacement(px, pz, t, activeWaveParams);
      const pNorm = getWaveNormal(px, pz, t, activeWaveParams);
      const predTarget = new THREE.Vector3(
        px + pDisp.x + pNorm.x * 0.06,
        pDisp.y + pNorm.y * 0.06 + 0.14,
        pz + pDisp.z + pNorm.z * 0.06
      );

      predictedWaypointRef.current.position.copy(predTarget);
      predictedWaypointRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pNorm);

      // Trajectory connecting current live buoy position to forecasted AI position
      if (predTrajectoryMeshRef.current) {
        const pDist = currentBuoyPos.distanceTo(predTarget);
        if (pDist > 0.2) {
          predTrajectoryMeshRef.current.visible = true;
          const pMid = new THREE.Vector3().addVectors(currentBuoyPos, predTarget).multiplyScalar(0.5);
          const pDir = new THREE.Vector3().subVectors(predTarget, currentBuoyPos).normalize();
          const pOrient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pDir);
          predTrajectoryMeshRef.current.position.copy(pMid);
          predTrajectoryMeshRef.current.quaternion.copy(pOrient);
          predTrajectoryMeshRef.current.scale.set(1, pDist, 1);
        } else {
          predTrajectoryMeshRef.current.visible = false;
        }
      }
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* ── 1. TRIPLE-ZONE CONCENTRIC WATCH BOUNDARY (Wave Conforming) ── */}
      {showBoundary && (
        <group>
          {/* ── CALM CONDITION CIRCLE (Emerald Green): Normal Calm Sea Excursion ── */}
          <mesh
            geometry={calmDiscGeo}
            material={calmDiscMaterial}
            ref={(m) => {
              if (m) calmDiscMatRef.current = m.material as THREE.ShaderMaterial;
            }}
          />
          <mesh
            geometry={calmPerimeterGeo}
            material={calmPerimeterMaterial}
            ref={(m) => {
              if (m) calmPerimeterMatRef.current = m.material as THREE.ShaderMaterial;
            }}
          />

          {/* ── INNER CIRCLE (Yellow / Gold): Primary Nominal Watch Zone ── */}
          <mesh
            geometry={innerDiscGeo}
            material={innerDiscMaterial}
            ref={(m) => {
              if (m) innerDiscMatRef.current = m.material as THREE.ShaderMaterial;
            }}
          />
          <mesh
            geometry={innerPerimeterGeo}
            material={innerPerimeterMaterial}
            ref={(m) => {
              if (m) innerPerimeterMatRef.current = m.material as THREE.ShaderMaterial;
            }}
          />

          {/* ── OUTER CIRCLE (Red): Maximum Excursion Heavy-Weather Boundary ── */}
          <mesh
            geometry={outerPerimeterGeo}
            material={outerPerimeterMaterial}
            ref={(m) => {
              if (m) outerPerimeterMatRef.current = m.material as THREE.ShaderMaterial;
            }}
          />
          <mesh
            geometry={outerHaloGeo}
            material={outerHaloMaterial}
            ref={(m) => {
              if (m) outerHaloMatRef.current = m.material as THREE.ShaderMaterial;
            }}
          />

          {/* 4 Cardinal Compass Tick Marks on Calm Green Perimeter */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((_, idx) => (
            <group
              key={`calm-tick-${idx}`}
              ref={(el) => {
                calmTickRefs.current[idx] = el;
              }}
            >
              <mesh>
                <boxGeometry args={[0.07, 0.022, 0.55]} />
                <meshBasicMaterial color="#10b981" transparent opacity={0.92} depthWrite={false} />
              </mesh>
            </group>
          ))}

          {/* 4 Cardinal Compass Tick Marks on Inner Yellow Perimeter */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((_, idx) => (
            <group
              key={`inner-tick-${idx}`}
              ref={(el) => {
                compassTickRefs.current[idx] = el;
              }}
            >
              <mesh>
                <boxGeometry args={[0.08, 0.024, 0.7]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.92} depthWrite={false} />
              </mesh>
            </group>
          ))}

          {/* 4 Cardinal Warning Ticks on Outer Red Perimeter */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((_, idx) => (
            <group
              key={`outer-tick-${idx}`}
              ref={(el) => {
                outerTickRefs.current[idx] = el;
              }}
            >
              <mesh>
                <boxGeometry args={[0.09, 0.026, 0.9]} />
                <meshBasicMaterial color="#ef4444" transparent opacity={0.92} depthWrite={false} />
              </mesh>
            </group>
          ))}

          {/* 3D Floating Zone Limit Badges along the Northern Perimeter (Disabled in pure Watch Circle no-HUD mode) */}
          {showBadges && (
            <>
              <group position={[0, 0.35, -calmRadius3D]}>
                <Html center distanceFactor={26} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'rgba(6, 78, 59, 0.90)',
                      border: '1px solid #10b981',
                      borderRadius: '12px',
                      padding: '3px 10px',
                      boxShadow: '0 0 12px rgba(16, 185, 129, 0.55)',
                      whiteSpace: 'nowrap',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 800, color: '#a7f3d0', letterSpacing: '0.08em' }}>
                      CALM SEA EXCURSION (~{Math.round(calmRadiusMeters)}m)
                    </span>
                  </div>
                </Html>
              </group>

              <group position={[0, 0.35, -innerRadius3D]}>
                <Html center distanceFactor={26} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'rgba(120, 53, 15, 0.90)',
                      border: '1px solid #fbbf24',
                      borderRadius: '12px',
                      padding: '3px 10px',
                      boxShadow: '0 0 12px rgba(251, 191, 36, 0.55)',
                      whiteSpace: 'nowrap',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', boxShadow: '0 0 8px #fbbf24' }} />
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 800, color: '#fde68a', letterSpacing: '0.08em' }}>
                      WATCH CIRCLE LIMIT (~{Math.round(radiusMeters)}m)
                    </span>
                  </div>
                </Html>
              </group>

              <group position={[0, 0.35, -outerRadius3D]}>
                <Html center distanceFactor={26} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'rgba(127, 29, 29, 0.90)',
                      border: '1px solid #ef4444',
                      borderRadius: '12px',
                      padding: '3px 10px',
                      boxShadow: '0 0 12px rgba(239, 68, 68, 0.55)',
                      whiteSpace: 'nowrap',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444' }} />
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 800, color: '#fecaca', letterSpacing: '0.08em' }}>
                      MAX BREACH HAZARD (~{Math.round(outerRadiusMeters)}m)
                    </span>
                  </div>
                </Html>
              </group>
            </>
          )}
        </group>
      )}

      {/* ── 2. NOMINAL POSITION MARKER (Center Datum crosshair floating on waves) ── */}
      <group ref={centerDatumRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.45, 32]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.92} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.12, 24]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.92} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.005, 0]}>
          <boxGeometry args={[1.6, 0.02, 0.04]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.92} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.005, 0]}>
          <boxGeometry args={[0.04, 0.02, 1.6]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.92} depthWrite={false} />
        </mesh>
      </group>

      {/* ── 3. EXCURSION VECTOR (Dynamic line connecting wave center to buoy) ── */}
      {showExcursionVector && buoyState.excursionDistance > 3 && (
        <group>
          {/* Glowing Vector Cylinder Line (Green inside calm, Yellow in watch circle, Red in breach) */}
          <mesh ref={excursionMeshRef}>
            <cylinderGeometry args={[0.038, 0.038, 1, 12]} />
            <meshBasicMaterial
              color={excursionVectorColor}
              transparent
              opacity={0.88}
              depthWrite={false}
            />
          </mesh>

          {/* Vector Marker Sphere at Current Buoy Position */}
          <mesh ref={excursionTargetSphereRef}>
            <sphereGeometry args={[0.18, 16, 16]} />
            <meshBasicMaterial
              color={excursionVectorColor}
              transparent
              opacity={0.92}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* ── 4. SATELLITE AI PREDICTION WAYPOINT & TRAJECTORY ── */}
      {predictedPos && (
        <group>
          {/* Predictive Trajectory Arc connecting actual buoy to AI waypoint */}
          <mesh ref={predTrajectoryMeshRef}>
            <cylinderGeometry args={[0.024, 0.024, 1, 10]} />
            <meshBasicMaterial color="#06b6d4" transparent opacity={0.85} depthWrite={false} />
          </mesh>

          {/* AI Predicted Waypoint Beacon Marker */}
          <group ref={predictedWaypointRef}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.32, 0.44, 32]} />
              <meshBasicMaterial color="#06b6d4" transparent opacity={0.9} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.14, 24]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} depthWrite={false} />
            </mesh>
            {/* Vertical beacon column */}
            <mesh position={[0, 0.45, 0]}>
              <cylinderGeometry args={[0.015, 0.015, 0.9, 8]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} depthWrite={false} />
            </mesh>
          </group>
        </group>
      )}

      {/* ── 5. GPS TRAJECTORY TRACK (Wave-conforming breadcrumbs) ── */}
      {showTrail && trailLine && <primitive object={trailLine} />}
    </group>
  );
}
