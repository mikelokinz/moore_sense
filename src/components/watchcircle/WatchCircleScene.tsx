import { useRef, useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { WaveSurface } from '../localocean/WaveSurface';
import { OceanSkyDome } from './OceanSkyDome';
import { SeabedEnvironment } from './SeabedEnvironment';
import { MooringBuoy3D } from './MooringBuoy3D';
import { MooringLine3D } from './MooringLine3D';
import { WatchCircleOverlay } from './WatchCircleOverlay';
import { MooringPartCallout } from './MooringPartCallout';
import { UnderwaterEnvironment } from '../localocean/UnderwaterEnvironment';
import { DynamicLighting } from '../localocean/LocalOceanScene';
import { computeWaveParams } from '../../utils/waveMath';
import type {
  EnvironmentalConditions,
  MooringConfig,
  BuoyState,
  GPSTrailPoint,
  WatchCircleDepthLevel,
  MooringSegmentData,
  PhysicsEngineMode,
} from './watchCircleTypes';
import { compassBus } from './compassBus';

interface WatchCircleSceneProps {
  env: EnvironmentalConditions;
  config: MooringConfig;
  buoyState: BuoyState;
  catenaryPoints: THREE.Vector3[];
  segments?: MooringSegmentData[];
  selectedSegmentIndex?: number | null;
  onSelectSegment?: (index: number | null) => void;
  selectedMaterialId?: string;
  onSelectMaterial?: (id: string) => void;
  gpsTrail: GPSTrailPoint[];
  showBoundary: boolean;
  showTrail: boolean;
  showExcursionVector: boolean;
  showUnderwater: boolean;
  cameraPreset: 'top' | 'surface' | 'profile' | 'anchor' | null;
  onCameraPresetHandled: () => void;
  currentDepth: WatchCircleDepthLevel;
  onDepthChange?: (depth: WatchCircleDepthLevel) => void;
  onHeadingChange?: (heading: number) => void;
  predictedPos?: { x: number; z: number } | null;
  isPredictionMode?: boolean;
  physicsEngine?: PhysicsEngineMode;
  disableInspection?: boolean;
  showBadges?: boolean;
  cameraLocked?: boolean;
  buoyPosition?: 'center' | 'left';
}

// ── Physical 3D Elevation Mapping for Each Exploration Depth Level ───────────
const DEPTH_Y_MAPPING: Record<WatchCircleDepthLevel, number> = {
  0: 0.35,      // Surface discus buoy & deck superstructure
  10: -2.2,     // 10m: Keel pad eye & ADCP cage frame
  50: -4.5,     // 50m: Armored inductive wire rope & clamped CT sensors
  100: -6.8,    // 100m: Compliant Nylon S-loop U-bend, CTD sensor & trawl float
  500: -11.0,   // 500m: Bathypelagic catenary belly
  1000: -14.6,  // 1000m: Glass flotation spheres cluster & acoustic release top
  2500: -17.15, // 2500m: Seabed ground anchor chain & bottom sinker clump
};

// ── Camera Eye Viewing Angles & Offsets Relative to Mooring Target ────────────
const DEPTH_EYE_OFFSETS: Record<WatchCircleDepthLevel, { x: number; y: number; z: number }> = {
  0: { x: 5.2, y: 3.2, z: 8.2 },      // Surface: elevated 30° view focused directly on buoy & mast
  10: { x: 3.2, y: 0.6, z: 4.5 },     // 10m: close inspection of fairlead & ADCP frame
  50: { x: 3.6, y: 0.6, z: 4.8 },     // 50m: inspection of inductive cable and CT sensors
  100: { x: 4.0, y: 0.8, z: 5.5 },    // 100m: inspection of CTD sensor and Nylon S-loop U-bend
  500: { x: 4.8, y: 0.8, z: 6.2 },    // 500m: catenary curvature belly in the twilight zone
  1000: { x: 4.2, y: 0.8, z: 5.5 },   // 1000m: glass spheres cluster and acoustic release
  2500: { x: 4.5, y: 1.2, z: 6.0 },   // 2500m: seabed ground chain and bottom sinker weight
};

// ── Locate Exact 3D Coordinate of Mooring Line at Selected Depth ──────────────
function findMooringPointAtDepth(
  depth: WatchCircleDepthLevel,
  catenaryPoints: THREE.Vector3[],
  buoy3D: THREE.Vector3
): THREE.Vector3 {
  // Surface: always focus directly on the buoy
  if (depth === 0) {
    return new THREE.Vector3(buoy3D.x, 0.35, buoy3D.z);
  }

  const targetY = DEPTH_Y_MAPPING[depth] ?? -2.2;

  // Search actual computed catenary spline points to find where the mooring line resides at this depth
  if (catenaryPoints && catenaryPoints.length > 0) {
    let bestPt = catenaryPoints[0];
    let minDiff = Math.abs(bestPt.y - targetY);

    for (let i = 1; i < catenaryPoints.length; i++) {
      const pt = catenaryPoints[i];
      const diff = Math.abs(pt.y - targetY);
      if (diff < minDiff) {
        minDiff = diff;
        bestPt = pt;
      }
    }
    return bestPt.clone();
  }

  // Graceful interpolation fallback if catenary points are not yet populated
  const frac = Math.min(1, Math.max(0, -targetY / 17.5));
  return new THREE.Vector3(
    buoy3D.x * (1 - frac),
    targetY,
    buoy3D.z * (1 - frac)
  );
}

function angleDelta(target: number, current: number): number {
  let diff = (target - current) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

function CameraCompassTracker() {
  const tempFwd = useMemo(() => new THREE.Vector3(), []);
  const tempUp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    // 1. Camera forward viewing direction in world space
    camera.getWorldDirection(tempFwd);
    // 2. Camera screen-up axis in world space (points towards top of user's screen)
    tempUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const fwdHorizLen = Math.hypot(tempFwd.x, tempFwd.z);
    let hx: number;
    let hz: number;

    if (fwdHorizLen > 0.05) {
      // Standard oblique or horizon view (both surface and underwater)
      hx = tempFwd.x;
      hz = tempFwd.z;
    } else if (tempFwd.y < 0) {
      // Pure or near top-down view: screen-up vector defines map viewing direction
      hx = tempUp.x;
      hz = tempUp.z;
    } else {
      // Pure or near bottom-up view: looking straight up
      hx = -tempUp.x;
      hz = -tempUp.z;
    }

    // World Coordinates: True North is -Z, East is +X, South is +Z, West is -X
    const rad = Math.atan2(hx, -hz);
    const hdgDeg = ((rad * 180) / Math.PI + 360) % 360;

    compassBus.emit(hdgDeg);
  });

  return null;
}

interface WatchCircleCameraManagerProps {
  preset: 'top' | 'surface' | 'profile' | 'anchor' | null;
  onPresetHandled: () => void;
  currentDepth: WatchCircleDepthLevel;
  orbitRef: React.RefObject<OrbitControlsImpl>;
  buoyState: BuoyState;
  catenaryPoints: THREE.Vector3[];
  liveMotionRef?: React.MutableRefObject<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    keelPosition: THREE.Vector3;
  }>;
  config?: MooringConfig;
  cameraLocked?: boolean;
  buoyPosition?: 'center' | 'left';
}

function WatchCircleCameraManager({
  preset,
  onPresetHandled,
  currentDepth,
  orbitRef,
  buoyState,
  catenaryPoints,
  liveMotionRef,
  config,
  cameraLocked = false,
  buoyPosition = 'center',
}: WatchCircleCameraManagerProps) {
  const { camera } = useThree();
  const targetEye = useRef(new THREE.Vector3(6, 3.5, 12));
  const targetLook = useRef(new THREE.Vector3(0, 0.5, 0));
  const isTransitioning = useRef(false);
  const hasInitialized = useRef(false);
  const lastTrackedBuoy = useRef(new THREE.Vector3());
  const activePresetRef = useRef<'top' | 'surface' | 'profile' | 'anchor' | null>(null);

  // Compute 3D position of the buoy (1 unit = 30m)
  const getBuoy3D = useCallback(() => {
    if (liveMotionRef?.current) {
      return new THREE.Vector3(
        liveMotionRef.current.position.x,
        0.35,
        liveMotionRef.current.position.z
      );
    }
    return new THREE.Vector3(
      (Number.isFinite(buoyState?.excursionX) ? buoyState.excursionX : 0) / 30,
      0.35,
      (Number.isFinite(buoyState?.excursionZ) ? buoyState.excursionZ : 0) / 30
    );
  }, [buoyState?.excursionX, buoyState?.excursionZ, liveMotionRef]);

  // Initial mount: immediately focus camera onto the buoy
  useEffect(() => {
    if (!orbitRef.current) return;
    const controls = orbitRef.current;
    const buoy3D = getBuoy3D();
    const rx = 0.8445;
    const rz = -0.5355;
    const shift = buoyPosition === 'left' ? 3.5 : 0;
    const shiftX = rx * shift;
    const shiftZ = rz * shift;

    targetLook.current.set(buoy3D.x + shiftX, 0.35, buoy3D.z + shiftZ);
    targetEye.current.set(
      buoy3D.x + DEPTH_EYE_OFFSETS[0].x + shiftX,
      buoy3D.y + DEPTH_EYE_OFFSETS[0].y,
      buoy3D.z + DEPTH_EYE_OFFSETS[0].z + shiftZ
    );

    camera.position.copy(targetEye.current);
    controls.target.copy(targetLook.current);
    controls.update();
    hasInitialized.current = true;
    lastTrackedBuoy.current.copy(buoy3D);
  }, [getBuoy3D, camera, orbitRef, buoyPosition]);

  // Depth change triggers smooth camera translation to the actual mooring line at that depth
  useEffect(() => {
    if (!orbitRef.current) return;
    activePresetRef.current = null;

    const buoy3D = getBuoy3D();
    const mooringPt = findMooringPointAtDepth(currentDepth, catenaryPoints, buoy3D);
    const offset = DEPTH_EYE_OFFSETS[currentDepth] || DEPTH_EYE_OFFSETS[0];

    targetLook.current.copy(mooringPt);
    targetEye.current.set(
      mooringPt.x + offset.x,
      mooringPt.y + offset.y,
      mooringPt.z + offset.z
    );
    isTransitioning.current = true;
  }, [currentDepth, getBuoy3D, catenaryPoints, orbitRef]);

  // When buoy position shifts significantly at surface (e.g. scenario or station switch), keep focus on buoy
  useEffect(() => {
    if (currentDepth !== 0 || !orbitRef.current || activePresetRef.current === 'top') return;
    const buoy3D = getBuoy3D();
    if (lastTrackedBuoy.current.distanceTo(buoy3D) > 0.4) {
      lastTrackedBuoy.current.copy(buoy3D);
      targetLook.current.set(buoy3D.x, 0.35, buoy3D.z);
      targetEye.current.set(
        buoy3D.x + DEPTH_EYE_OFFSETS[0].x,
        0.35 + DEPTH_EYE_OFFSETS[0].y,
        buoy3D.z + DEPTH_EYE_OFFSETS[0].z
      );
      isTransitioning.current = true;
    }
  }, [buoyState?.excursionX, buoyState?.excursionZ, currentDepth, getBuoy3D, orbitRef]);

  // Preset viewpoint override
  useEffect(() => {
    if (!preset || !orbitRef.current) return;

    const buoy3D = getBuoy3D();

    if (preset === 'top') {
      activePresetRef.current = 'top';
      const rOuter = (config?.watchCircleRadius || 240) * 1.30;
      const rOuter3D = rOuter / 30;
      const buoyDist3D = Math.hypot(buoy3D.x, buoy3D.z);
      // Ensure both the entire outer boundary circle and the buoy fit comfortably
      const maxSpan3D = Math.max(rOuter3D, buoyDist3D);
      // Half-angle of vertical FOV 42 deg is 21 deg
      const halfFovTan = Math.tan((21 * Math.PI) / 180);
      // Generous 1.45 margin ensures HUD bars and badges don't clip the outer boundary
      const topEyeY = Math.max(42, (maxSpan3D * 1.45) / halfFovTan);

      // Centered directly on the watch circle anchor datum origin [0, 0, 0]
      targetLook.current.set(0, 0.1, 0);
      // Looking straight down from above with small positive Z offset so North points straight UP
      targetEye.current.set(0, topEyeY, 0.02);
    } else if (preset === 'surface') {
      activePresetRef.current = 'surface';
      targetLook.current.set(buoy3D.x, 0.35, buoy3D.z);
      targetEye.current.set(
        buoy3D.x + DEPTH_EYE_OFFSETS[0].x,
        0.35 + DEPTH_EYE_OFFSETS[0].y,
        buoy3D.z + DEPTH_EYE_OFFSETS[0].z
      );
    } else if (preset === 'profile') {
      activePresetRef.current = 'profile';
      const midMooring = findMooringPointAtDepth(500, catenaryPoints, buoy3D);
      targetLook.current.copy(midMooring);
      targetEye.current.set(midMooring.x + 20, midMooring.y + 1.0, midMooring.z + 15);
    } else if (preset === 'anchor') {
      activePresetRef.current = 'anchor';
      const anchorPt = findMooringPointAtDepth(2500, catenaryPoints, buoy3D);
      targetLook.current.copy(anchorPt);
      targetEye.current.set(
        anchorPt.x + DEPTH_EYE_OFFSETS[2500].x,
        anchorPt.y + DEPTH_EYE_OFFSETS[2500].y,
        anchorPt.z + DEPTH_EYE_OFFSETS[2500].z
      );
    }

    isTransitioning.current = true;
    onPresetHandled();
  }, [preset, onPresetHandled, getBuoy3D, catenaryPoints, orbitRef, config]);

  // Gracefully yield transition if user manually interacts with OrbitControls
  useEffect(() => {
    const controls = orbitRef.current;
    if (!controls) return;
    const handleStart = () => {
      isTransitioning.current = false;
      activePresetRef.current = null;
    };
    controls.addEventListener('start', handleStart);
    return () => {
      controls.removeEventListener('start', handleStart);
    };
  }, [orbitRef]);

  useFrame(() => {
    if (!orbitRef.current) return;
    const controls = orbitRef.current;

    // Lock camera angle strictly when requested
    if (cameraLocked) {
      const buoy3D = getBuoy3D();
      const rx = 0.8445;
      const rz = -0.5355;
      const shift = buoyPosition === 'left' ? 3.5 : 0;
      const shiftX = rx * shift;
      const shiftZ = rz * shift;

      targetLook.current.set(buoy3D.x + shiftX, 0.35, buoy3D.z + shiftZ);
      targetEye.current.set(
        buoy3D.x + DEPTH_EYE_OFFSETS[0].x + shiftX,
        0.35 + DEPTH_EYE_OFFSETS[0].y,
        buoy3D.z + DEPTH_EYE_OFFSETS[0].z + shiftZ
      );
      camera.position.copy(targetEye.current);
      controls.target.copy(targetLook.current);
      controls.update();
      return;
    }

    // Safety initialization on first render frame
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      const buoy3D = getBuoy3D();
      const rx = 0.8445;
      const rz = -0.5355;
      const shift = buoyPosition === 'left' ? 3.5 : 0;
      const shiftX = rx * shift;
      const shiftZ = rz * shift;

      targetLook.current.set(buoy3D.x + shiftX, 0.35, buoy3D.z + shiftZ);
      targetEye.current.set(
        buoy3D.x + DEPTH_EYE_OFFSETS[0].x + shiftX,
        0.35 + DEPTH_EYE_OFFSETS[0].y,
        buoy3D.z + DEPTH_EYE_OFFSETS[0].z + shiftZ
      );
      camera.position.copy(targetEye.current);
      controls.target.copy(targetLook.current);
      controls.update();
      isTransitioning.current = false;
      return;
    }

    if (!isTransitioning.current) return;

    camera.position.lerp(targetEye.current, 0.08);
    controls.target.lerp(targetLook.current, 0.08);
    controls.update();

    if (
      camera.position.distanceTo(targetEye.current) < 0.04 &&
      controls.target.distanceTo(targetLook.current) < 0.04
    ) {
      isTransitioning.current = false;
    }
  });

  return null;
}

export function WatchCircleScene({
  env,
  config,
  buoyState,
  catenaryPoints,
  segments,
  selectedSegmentIndex = null,
  onSelectSegment,
  selectedMaterialId,
  onSelectMaterial,
  gpsTrail,
  showBoundary,
  showTrail,
  showExcursionVector,
  showUnderwater,
  cameraPreset,
  onCameraPresetHandled,
  currentDepth,
  onHeadingChange,
  predictedPos,
  isPredictionMode = false,
  physicsEngine = 'rapier',
  disableInspection = false,
  showBadges = true,
  cameraLocked = false,
  buoyPosition = 'center',
}: WatchCircleSceneProps) {
  const orbitRef = useRef<OrbitControlsImpl>(null!);

  // Currently inspected component info callout state
  const [inspectedPart, setInspectedPart] = useState<{
    id: string;
    worldPos: [number, number, number];
  } | null>(null);

  // Shared live dynamic motion ref linking buoy kinematics with the mooring line connection
  const liveMotionRef = useRef<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    keelPosition: THREE.Vector3;
  }>({
    position: new THREE.Vector3(buoyState.excursionX / 30, 0, buoyState.excursionZ / 30),
    rotation: new THREE.Euler(0, 0, 0),
    keelPosition: new THREE.Vector3(buoyState.excursionX / 30, -1.95, buoyState.excursionZ / 30),
  });

  const initialBuoyX = (Number.isFinite(buoyState?.excursionX) ? buoyState.excursionX : 0) / 30;
  const initialBuoyZ = (Number.isFinite(buoyState?.excursionZ) ? buoyState.excursionZ : 0) / 30;

  // ── Ocean Wave & Current Flow Direction ─────────────────────────────────────
  // Aligns the physical ocean swell & surface current flow directly with the buoy's movement drift vector
  const effectiveOceanDirection = useMemo(() => {
    if (buoyState && buoyState.excursionDistance > 0.5) {
      // True North compass bearing of the displacement vector: North is -Z, East is +X
      const rad = Math.atan2(buoyState.excursionX, -buoyState.excursionZ);
      return ((rad * 180) / Math.PI + 360) % 360;
    }
    return env.currentDirection || 45;
  }, [buoyState?.excursionDistance, buoyState?.excursionX, buoyState?.excursionZ, env.currentDirection]);

  // Physically calibrated wave parameters matching buoy drift movement and gentle swell scale
  const waveParams = useMemo(() => {
    return computeWaveParams(
      env.waveHeight || 1.5,
      env.waveHeight || 1.5,
      env.currentSpeed || 0.4,
      28.0,
      effectiveOceanDirection,
      true
    );
  }, [env.waveHeight, env.currentSpeed, effectiveOceanDirection]);

  const initialShiftX = buoyPosition === 'left' ? 0.8445 * 3.5 : 0;
  const initialShiftZ = buoyPosition === 'left' ? -0.5355 * 3.5 : 0;

  return (
    <Canvas
      camera={{
        position: [initialBuoyX + 5.2 + initialShiftX, 3.5, initialBuoyZ + 8.2 + initialShiftZ],
        fov: 42,
        near: 0.1,
        far: 3000,
      }}
      gl={{
        antialias: true,
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.32,
        powerPreference: 'high-performance',
      }}
      dpr={[1, 2]}
      style={{ width: '100%', height: '100%', background: '#051b36' }}
    >
      {/* ── Seamless 360° Infinite Ocean Sky Dome & Atmospheric Horizon ── */}
      <OceanSkyDome sunDirection={[100, 32, -80]} />

      {/* ── Dynamic Lighting System with Enhanced Deep Penetration ── */}
      <DynamicLighting maxDepthY={18} />

      {/* ── Deep Ocean Supplemental Fill & Inspection Lights ── */}
      {/* Mid-water column inspection light (illuminating CTD, S-loop U-bend & Trawl Float) */}
      <pointLight position={[1.2, -6.5, 0.5]} color="#ffffff" intensity={1.8} distance={32} decay={1} />
      {/* Seabed tackle inspection light (illuminating glass spheres, release, chain & bottom weight) */}
      <pointLight position={[0, -15.8, 0]} color="#ffffff" intensity={2.0} distance={32} decay={1} />
      {/* Upward subsea bounce fill light for illuminated undersides */}
      <directionalLight position={[-30, -35, 30]} intensity={1.4} color="#38bdf8" />

      {/* ── Camera Heading Tracker for Fixed Bottom-Left Compass HUD ── */}
      <CameraCompassTracker />

      {/* ── 3D Scene Objects with Suspense for Assets ── */}
      <Suspense fallback={null}>
        <group>
          {/* Ocean Wave Surface with dynamic flow aligned with buoy movement drift direction */}
          <WaveSurface
            waveHeight={env.waveHeight}
            modelWaveHeight={env.waveHeight * 0.95}
            currentSpeed={env.currentSpeed}
            currentDirection={effectiveOceanDirection}
            temperature={28.0}
            depth={currentDepth === 2500 ? 1000 : currentDepth}
            isWatchCycle={true}
          />

          {/* ── Depth-Based Underwater Atmosphere & Floating Plankton Particles ── */}
          <UnderwaterEnvironment
            depth={currentDepth === 2500 ? 1000 : currentDepth}
            visible={showUnderwater}
            maxDepthY={18}
          />

          {/* ── Dual-Circle Watch Overlay & GPS Track (Inner Yellow & Outer Red Circles) ── */}
          <WatchCircleOverlay
            radiusMeters={config.watchCircleRadius}
            buoyState={buoyState}
            gpsTrail={gpsTrail}
            showBoundary={showBoundary}
            showTrail={showTrail}
            showExcursionVector={showExcursionVector}
            waveParams={waveParams}
            liveMotionRef={liveMotionRef}
            predictedPos={predictedPos}
            isPredictionMode={isPredictionMode}
            showBadges={showBadges}
          />

          {/* ── 3D Mooring Buoy with Rapier WebAssembly Physics ── */}
          <MooringBuoy3D
            buoyState={buoyState}
            buoyId={config.buoyId}
            waveHeight={env.waveHeight}
            wavePeriod={env.wavePeriod}
            windSpeed={env.windSpeed}
            currentSpeed={env.currentSpeed}
            liveMotionRef={liveMotionRef}
            waveParams={waveParams}
            physicsEngine={physicsEngine}
            onInspectPart={disableInspection ? undefined : (partId, worldPos) => {
              setInspectedPart({ id: partId, worldPos });
            }}
          />

          {/* ── 3D Multi-Segment Mooring Line with Interactive Inspection & Live Tracking ── */}
          <MooringLine3D
            catenaryPoints={catenaryPoints}
            buoyState={buoyState}
            segments={segments}
            selectedSegmentIndex={selectedSegmentIndex}
            onSelectSegment={onSelectSegment}
            selectedMaterialId={selectedMaterialId}
            onSelectMaterial={onSelectMaterial}
            liveMotionRef={liveMotionRef}
            showTensionBadges={showBadges}
            onInspectPart={disableInspection ? undefined : (partId, worldPos) => {
              setInspectedPart({ id: partId, worldPos });
            }}
          />

          {/* ── Seabed Bathymetry, Cast Anchor Sinker & Depth Scale Ruler ── */}
          <SeabedEnvironment waterDepth={config.waterDepth} seabedY={-18} />

          {/* ── Interactive 3D Component Inspection Callout (Camera-correlated DOM HUD) ── */}
          {!disableInspection && inspectedPart && (
            <MooringPartCallout
              partId={inspectedPart.id}
              position={inspectedPart.worldPos}
              env={env}
              config={config}
              buoyState={buoyState}
              onSelectMaterial={onSelectMaterial}
              onClose={() => setInspectedPart(null)}
            />
          )}
        </group>
      </Suspense>

      {/* ── Surface-to-Seabed Camera Transition Manager ── */}
      <WatchCircleCameraManager
        preset={cameraPreset}
        onPresetHandled={onCameraPresetHandled}
        currentDepth={currentDepth}
        orbitRef={orbitRef}
        buoyState={buoyState}
        catenaryPoints={catenaryPoints}
        liveMotionRef={liveMotionRef}
        config={config}
        cameraLocked={cameraLocked}
        buoyPosition={buoyPosition}
      />

      {/* ── OrbitControls for 360° Orbit, Pan, and Zoom at Any Depth ── */}
      <OrbitControls
        ref={orbitRef}
        target={[
          initialBuoyX + initialShiftX,
          0.35,
          initialBuoyZ + initialShiftZ,
        ]}
        enablePan={!cameraLocked}
        enableZoom={!cameraLocked}
        enableRotate={!cameraLocked}
        enabled={!cameraLocked}
        minDistance={2.5}
        maxDistance={350.0}
        maxPolarAngle={Math.PI / 2 + 0.4}
        dampingFactor={0.06}
        enableDamping={!cameraLocked}
      />
    </Canvas>
  );
}
