import { useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { BuoyLocation, BuoyStatus } from '../../../services/buoy/buoyTypes';
import { latLonToXYZ } from '../../../utils/oceanCalc';

interface BuoyMarkerProps {
  buoy: BuoyLocation;
  isSelected: boolean;
  isHandHovered?: boolean;
  onSelect: (buoy: BuoyLocation) => void;
  onHover?: (buoy: BuoyLocation | null) => void;
  truePosition?: THREE.Vector3;
  offsetPosition?: THREE.Vector3;
  isClustered?: boolean;
  labelDirection?: 'left' | 'right' | 'top' | 'bottom' | 'top-right' | 'bottom-left';
  index?: number;
}

import { OFFLINE_STATION_REGISTRY } from '../../ui/OfflineBuoysModal';

/**
 * Buoy state & disposition color mapping matching the Offline Buoys modal & telemetry standards:
 * - OMNI-AD06 (LOST AT SEA) → Resonant Rose-Red (#f43f5e)
 * - OMNI-AD07 / OMNI-BD09 (PURPOSEFULLY REMOVED) → Resonant Amber / Golden Yellow (#eab308)
 * - Active OMNI Fleet Telemetry → High-Tech Electric Cyan (#00f0ff)
 * - Standard Maritime Telemetry:
 *   - Green → SAFE (#10b981)
 *   - Yellow/Amber → WARNING (#f59e0b)
 *   - Red → CRITICAL / ADRIFT (#ef4444)
 *   - Amber → OFFLINE (#eab308)
 */
export function getBuoyColor(status?: BuoyStatus | string, buoyId?: string): string {
  // 1. Precise station disposition check matching the Offline Buoys registry
  if (buoyId && OFFLINE_STATION_REGISTRY[buoyId]) {
    const offlineStation = OFFLINE_STATION_REGISTRY[buoyId];
    if (offlineStation.disposition === 'LOST') {
      return '#f43f5e'; // Resonant Rose-Red (LOST AT SEA - OMNI-AD06)
    }
    if (offlineStation.disposition === 'PURPOSEFULLY_REMOVED') {
      return '#eab308'; // Resonant Amber / Golden Yellow (PURPOSEFULLY REMOVED - OMNI-AD07, OMNI-BD09)
    }
  }

  // 2. Status / Freshness-based color mapping
  switch (status) {
    case 'SAFE':
      return '#10b981'; // Luminous emerald
    case 'WARNING':
      return '#f59e0b'; // Amber
    case 'CRITICAL':
    case 'ADRIFT':
      return '#f43f5e'; // High-visibility marine emergency red
    case 'OFFLINE':
      return '#eab308'; // Purposefully removed / offline amber
    default:
      // Active in-situ OMNI stations default to high-tech telemetry cyan
      return '#00f0ff';
  }
}

// ── Procedural Gaussian Ocean Ripple Texture ─────────────────────────────────
// Generates a silky-smooth, ethereal sonar wave with soft Gaussian falloff.
// Eliminates harsh solid donut edges, creating gentle, cool, organic ocean ripples.
let cachedRippleTexture: THREE.CanvasTexture | null = null;
function getRippleTexture(): THREE.CanvasTexture {
  if (cachedRippleTexture) return cachedRippleTexture;
  if (typeof document === 'undefined') {
    return new THREE.CanvasTexture(null as any);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const cx = 128;
  const cy = 128;
  const imgData = ctx.createImageData(256, 256);
  const data = imgData.data;

  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = (x - cx) / 128;
      const dy = (y - cy) / 128;
      const r = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * 256 + x) * 4;

      if (r > 0.98 || r < 0.08) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 0;
        continue;
      }

      // Delicate sharp wave crest line at r = 0.70
      const d = r - 0.70;
      const sharpCrest = Math.exp(-Math.pow(d / 0.040, 2));
      // Soft ethereal atmospheric dispersion aura
      const softAura = 0.45 * Math.exp(-Math.pow(d / 0.13, 2));

      // Secondary faint harmonic echo ring at r = 0.42
      const echo = 0.22 * Math.exp(-Math.pow((r - 0.42) / 0.05, 2));

      // Radial window to ensure smooth zero at boundaries
      const window = Math.sin(Math.min(1.0, (r - 0.08) / 0.90) * Math.PI);
      const intensity = Math.min(1.0, sharpCrest + softAura + echo) * window;

      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.floor(intensity * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  cachedRippleTexture = new THREE.CanvasTexture(canvas);
  cachedRippleTexture.needsUpdate = true;
  return cachedRippleTexture;
}

/**
 * High-Visibility 3D Oceanographic Surface Buoy Marker:
 * - Prominent 3D discus hull with marine safety yellow & international orange collar
 * - Vertical holographic telemetry uplink beacon beam for effortless orbital visibility
 * - Adaptive distance scaling so buoys are clearly visible and clickable from high orbit
 * - Smooth, slow, and cool multi-tier expanding sonar wake ripples
 * - Anti-collision decluttering: connects to ground anchor datum via glowing tether line
 * - Non-overlapping floating station ID pill badge with hemisphere culling
 */
export function BuoyMarker({
  buoy,
  isSelected,
  isHandHovered = false,
  onSelect,
  onHover,
  truePosition: propTruePos,
  offsetPosition: propOffsetPos,
  isClustered = false,
  labelDirection = 'top-right',
  index = 0,
}: BuoyMarkerProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const modelGroupRef = useRef<THREE.Group>(null!);
  const innerRingRef = useRef<THREE.Mesh>(null!);
  const outerRingRef = useRef<THREE.Mesh>(null!);
  const beaconMeshRef = useRef<THREE.Mesh>(null!);
  const tetherLineRef = useRef<THREE.Line>(null!);
  const anchorDatumRef = useRef<THREE.Group>(null!);

  const rippleTexture = useMemo(() => getRippleTexture(), []);
  const [isHemisphereVisible, setIsHemisphereVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const { gl } = useThree();

  // Altitude radius resting precisely on ocean surface
  const markerRadius = 2.006;

  // True GPS location on globe
  const truePosition = useMemo(() => {
    if (propTruePos) return propTruePos;
    const [x, y, z] = latLonToXYZ(buoy.latitude, buoy.longitude, markerRadius);
    return new THREE.Vector3(x, y, z);
  }, [propTruePos, buoy.latitude, buoy.longitude, markerRadius]);

  // Anti-collision decluttered position
  const offsetPosition = useMemo(() => {
    return propOffsetPos || truePosition;
  }, [propOffsetPos, truePosition]);

  // Current interpolated position for smooth transitions
  const currentPosition = useRef(offsetPosition.clone());

  // Distinct phase offset so nearby buoys pulse out of phase
  const phaseOffset = useMemo(() => index * 1.57, [index]);

  const color = useMemo(() => getBuoyColor(buoy.status, buoy.id), [buoy.status, buoy.id]);

  // Short clean station code (e.g. "BD08", "BD09", "AD06")
  const shortId = useMemo(() => {
    return buoy.id.replace(/^OMNI-/, '');
  }, [buoy.id]);

  // Dynamic tether buffer geometry connecting buoy to true GPS anchor
  const tetherGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const posArray = new Float32Array(6); // 2 vertices: (0,0,0) to relTrue
    geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    return geo;
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const camPos = state.camera.position;
    const dist = camPos.distanceTo(currentPosition.current);

    // 1. Hemisphere Culling: hide when on backside of Earth
    const camDir = camPos.clone().normalize();
    const normal = currentPosition.current.clone().normalize();
    const dot = normal.dot(camDir);
    const isFacing = dot > 0.06;
    if (isFacing !== isHemisphereVisible) {
      setIsHemisphereVisible(isFacing);
    }

    if (!isFacing) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;

    // 2. Position buoy directly at true GPS coordinates on Earth surface
    currentPosition.current.lerp(truePosition, Math.min(1.0, delta * 8.0));
    groupRef.current.position.copy(currentPosition.current);

    // Orient buoy tangent to Earth curvature (+Z points radially outward)
    groupRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    // 3. Adaptive Visual Scale Factor (compact, sleek, proportional from orbit)
    const distScale = THREE.MathUtils.clamp((dist - 1.8) * 0.20, 0.65, 1.25);
    const selectScale = isSelected ? 1.45 : (isHandHovered || isHovered) ? 1.25 : 1.0;
    const totalScale = distScale * selectScale;
    if (modelGroupRef.current) {
      modelGroupRef.current.scale.setScalar(totalScale);
    }

    // 5. Pulsing Navigational Strobe Beacon (Rhythmic marine flash; faster distress cadence for lost buoy)
    if (beaconMeshRef.current) {
      const isLost = buoy.id === 'OMNI-AD06';
      const flashSpeed = isLost ? 6.5 : 4.0;
      const strobe = Math.sin(state.clock.elapsedTime * flashSpeed + phaseOffset) > 0.4 ? 1.35 : 0.85;
      beaconMeshRef.current.scale.setScalar(strobe);
    }

    // 6. Smooth, Slow, and Cool Oceanic Sonar Wave Ripples (Period: ~4.2s)
    const t = state.clock.elapsedTime * 0.24 + phaseOffset;

    if (innerRingRef.current) {
      const p1 = t % 1.0;
      // Scale: starts smoothly at buoy hull and gently expands outward to 2.4x
      const scale1 = 0.7 + Math.pow(p1, 0.85) * 2.2;
      innerRingRef.current.scale.setScalar(scale1);

      // Opacity: smooth sine envelope with luminous resonant peak
      const mat1 = innerRingRef.current.material as THREE.MeshBasicMaterial;
      if (mat1) {
        mat1.opacity = Math.sin(p1 * Math.PI) * 0.60;
      }
    }

    if (outerRingRef.current) {
      const p2 = (t + 0.50) % 1.0;
      const scale2 = 0.7 + Math.pow(p2, 0.85) * 2.2;
      outerRingRef.current.scale.setScalar(scale2);

      const mat2 = outerRingRef.current.material as THREE.MeshBasicMaterial;
      if (mat2) {
        mat2.opacity = Math.sin(p2 * Math.PI) * 0.46;
      }
    }
  });

  // Directional offsets for station ID badge to prevent label collisions
  const labelOffset = useMemo(() => {
    switch (labelDirection) {
      case 'bottom-left':
        return { x: -24, y: 18 };
      case 'top-right':
        return { x: 24, y: -18 };
      case 'left':
        return { x: -28, y: 0 };
      case 'right':
        return { x: 28, y: 0 };
      case 'bottom':
        return { x: 0, y: 22 };
      case 'top':
      default:
        return { x: 0, y: -22 };
    }
  }, [labelDirection]);

  return (
    <group ref={groupRef} name={`omni-buoy-${buoy.id}`}>


      {/* ── 2. Generous Invisible Raycast Interaction Hitbox ── */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(buoy);
        }}
        onPointerEnter={(e) => {
          e.stopPropagation();
          gl.domElement.style.cursor = 'pointer';
          setIsHovered(true);
          onHover?.(buoy);
        }}
        onPointerLeave={(e) => {
          e.stopPropagation();
          gl.domElement.style.cursor = 'default';
          setIsHovered(false);
          onHover?.(null);
        }}
      >
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* ── 3. Smooth, Slow, and Cool Oceanic Sonar Wave Ripples ── */}
      <mesh ref={innerRingRef} position={[0, 0, 0.0012]}>
        <planeGeometry args={[0.040, 0.040]} />
        <meshBasicMaterial
          map={rippleTexture}
          color={color}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={outerRingRef} position={[0, 0, 0.0014]}>
        <planeGeometry args={[0.040, 0.040]} />
        <meshBasicMaterial
          map={rippleTexture}
          color={color}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* ── 4. High-Fidelity 3D Marine Surface Buoy Model ── */}
      <group
        ref={modelGroupRef}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1.0, 1.0, 1.0]}
      >
        {/* 4a. Waterline Ocean Contact Ripple Glow (Luminous Accent matching telemetry/disposition color) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0006, 0]}>
          <ringGeometry args={[0.013, 0.018, 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.42}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* 4b. Discus Hull Bottom Chamfer (Marine Safety Yellow) */}
        <mesh position={[0, 0.0025, 0]}>
          <cylinderGeometry args={[0.014, 0.009, 0.0045, 20]} />
          <meshStandardMaterial color="#ffd000" roughness={0.3} metalness={0.1} />
        </mesh>

        {/* 4c. Main Upper Discus Float (Marine High-Visibility Yellow) */}
        <mesh position={[0, 0.006, 0]}>
          <cylinderGeometry args={[0.0132, 0.0145, 0.0035, 20]} />
          <meshStandardMaterial color="#facc15" roughness={0.25} metalness={0.1} />
        </mesh>

        {/* 4d. High-Visibility Marine Yellow Collar Bumper Stripe */}
        <mesh position={[0, 0.0085, 0]}>
          <cylinderGeometry args={[0.0138, 0.0138, 0.0018, 20]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>

        {/* 4e. Central Instrument Hub Deck */}
        <mesh position={[0, 0.010, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.0018, 16]} />
          <meshStandardMaterial color="#1e293b" roughness={0.35} metalness={0.4} />
        </mesh>

        {/* 4f. Galvanized Tripod Instrument Mast Tower */}
        <mesh position={[0, 0.018, 0]}>
          <cylinderGeometry args={[0.003, 0.007, 0.016, 10]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.2} metalness={0.5} />
        </mesh>

        {/* 4g. Dual Met-Ocean Solar Power Wings */}
        <mesh position={[0, 0.024, 0]}>
          <boxGeometry args={[0.016, 0.0015, 0.006]} />
          <meshStandardMaterial color="#0284c7" roughness={0.2} metalness={0.6} />
        </mesh>

        {/* 4h. Top Sensor Disc Capsule */}
        <mesh position={[0, 0.027, 0]}>
          <cylinderGeometry args={[0.0055, 0.0055, 0.0025, 14]} />
          <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.7} />
        </mesh>

        {/* 4i. Flashing Navigational Beacon LED Strobe */}
        <mesh ref={beaconMeshRef} position={[0, 0.031, 0]}>
          <sphereGeometry args={[0.0038, 14, 14]} />
          <meshBasicMaterial color={color} />
        </mesh>

        {/* 4j. Luminous Navigational Beacon Glow Corona */}
        <mesh position={[0, 0.031, 0]}>
          <sphereGeometry args={[0.011, 14, 14]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.55}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* 4k. VERTICAL HOLOGRAPHIC UPLINK BEACON BEAM (The resonant telemetry stick visible from orbit!) */}
        <mesh position={[0, 0.075, 0]}>
          <cylinderGeometry args={[0.0014, 0.0032, 0.082, 10]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.88}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Top telemetry beam pulse diamond */}
        <mesh position={[0, 0.118, 0]}>
          <octahedronGeometry args={[0.0042, 0]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0.118, 0]}>
          <sphereGeometry args={[0.009, 12, 12]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.65}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* ── 5. Selection Concentric Multi-Ring Radar Target ── */}
      {isSelected && (
        <group position={[0, 0, 0.002]}>
          <mesh>
            <ringGeometry args={[0.022, 0.025, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.95}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <ringGeometry args={[0.036, 0.0385, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.6}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <ringGeometry args={[0.050, 0.052, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.3}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* ── 6. Station ID Badge (Shows ONLY on hover or selection, sleek & compact) ── */}
      {isHemisphereVisible && (isHovered || isHandHovered || isSelected) && (
        <Html
          position={[0, 0, 0.08]}
          center
          style={{
            pointerEvents: 'none',
            transform: `translate(${labelOffset.x}px, ${labelOffset.y}px)`,
            userSelect: 'none',
            zIndex: isSelected ? 50 : 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: isSelected ? '2px 7px' : '2px 5px',
              borderRadius: '4px',
              background: isSelected
                ? `${color}e6`
                : 'rgba(6, 12, 24, 0.88)',
              border: isSelected
                ? `1px solid ${color}`
                : `1px solid ${color}80`,
              boxShadow: isSelected
                ? `0 0 14px ${color}, 0 2px 6px rgba(0,0,0,0.8)`
                : `0 0 8px ${color}35, 0 2px 4px rgba(0,0,0,0.7)`,
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Live Status Pip */}
            <span
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: isSelected ? '#04101e' : color,
                boxShadow: `0 0 5px ${isSelected ? '#ffffff' : color}`,
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {/* Short Station Identifier (e.g. BD08, BD09, AD06) */}
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Outfit', monospace",
                fontSize: '9.5px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: isSelected ? '#030c18' : '#f8fafc',
                lineHeight: 1,
              }}
            >
              {shortId}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}
