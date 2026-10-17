import { useRef, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Starfield } from '../components/scene/Starfield';
import { MoorSenseEarth } from '../components/scene/MoorSenseEarth';
import { CelestialSun } from '../components/scene/CelestialSun';
import { CelestialMoon } from '../components/scene/CelestialMoon';
import { BuoyMarkersLayer } from '../components/scene/buoy/BuoyMarkersLayer';
import { CameraController } from '../components/scene/CameraController';
import { HandControlWidget } from '../components/ui/HandControlWidget';
import { HandCrosshair } from '../components/ui/HandCrosshair';
import { BuoyDetailsPanel } from '../components/ui/BuoyDetailsPanel';
import { useBuoyData } from '../services/buoy/buoyService';
import { useHandGesture } from '../hooks/useHandGesture';
import type { CameraStage, Station, DepthLevel } from '../types/ocean';
import type { BuoyLocation } from '../services/buoy/buoyTypes';
import type { CloudMetadata } from '../services/cloudService';
import { LocalOcean3D, LocalOceanUI } from '../components/localocean/LocalOceanScene';
import { RotateCcw, Hand, Shield, Tag, Menu, ChevronDown } from 'lucide-react';
import { EEZLegendHUD } from '../components/ui/EEZLegendHUD';
import { OnlineBuoysModal } from '../components/ui/OnlineBuoysModal';
import { OfflineBuoysModal } from '../components/ui/OfflineBuoysModal';
import { PillMenuPopover } from '../components/ui/PillMenuPopover';
import { SolarTimeHUD } from '../components/ui/SolarTimeHUD';
import { calculateSolarEphemeris } from '../utils/solarCalculator';
import { InitialLoadingScreen } from '../components/intro/InitialLoadingScreen';

const WatchCircleLab = lazy(() => import('./WatchCircleLab'));

interface ExplorerProps {
  initialStage?: CameraStage;
}

export default function Explorer({ initialStage = 'exploration' }: ExplorerProps) {
  // Camera stage state
  const [stage, setStage] = useState<CameraStage>(initialStage);
  const [isReadyToInteract, setIsReadyToInteract] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [isIntroDismissed, setIsIntroDismissed] = useState(false);

  // Floating Pill & Modal States
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isOnlineModalOpen, setIsOnlineModalOpen] = useState(false);
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState(false);

  // Local Ocean Area Dive Simulation State
  const [isLocalOcean, setIsLocalOcean] = useState(false);
  const [localOceanDepth, setLocalOceanDepth] = useState<DepthLevel>(0);
  const [exploreStation, setExploreStation] = useState<Station | null>(null);

  // Mooring Watch Circle 3D Mode State
  const [isWatchCircleMode, setIsWatchCircleMode] = useState(false);
  const [selectedWatchBuoyId, setSelectedWatchBuoyId] = useState<string>('OMNI-BD10');

  // Maritime Exclusive Economic Zone (EEZ) Overlay Toggle
  const [showEEZ, setShowEEZ] = useState(false);
  const [showEEZLabels, setShowEEZLabels] = useState(true);
  const [showBuoys, setShowBuoys] = useState(true);

  // Buoy Data Layer
  const { buoys, selectedBuoy, selectedBuoyId, selectBuoy } = useBuoyData();

  // Buoy status partitioning: Online (9) vs Offline (3)
  const isBuoyOffline = useCallback((b: BuoyLocation): boolean => {
    return (
      b.freshness?.state === 'OFFLINE' ||
      b.id === 'OMNI-AD06' ||
      b.id === 'OMNI-AD07' ||
      b.id === 'OMNI-BD09'
    );
  }, []);

  const onlineBuoys = buoys.filter((b) => !isBuoyOffline(b));
  const offlineBuoys = buoys.filter((b) => isBuoyOffline(b));

  const handleSelectOnlineBuoy = useCallback(
    (b: BuoyLocation) => {
      selectBuoy(b.id);
      setIsOnlineModalOpen(false);
    },
    [selectBuoy]
  );

  const handleSelectOfflineBuoy = useCallback(
    (b: BuoyLocation) => {
      selectBuoy(b.id);
      setIsOfflineModalOpen(false);
    },
    [selectBuoy]
  );

  // Stable memoized target station for camera focus transitions
  const memoizedTargetStation = useMemo(() => {
    if (!selectedBuoy) return null;
    return {
      latitude: selectedBuoy.latitude,
      longitude: selectedBuoy.longitude,
    };
  }, [selectedBuoy?.id, selectedBuoy?.latitude, selectedBuoy?.longitude]);

  // Hand Gesture Control
  const hand = useHandGesture();
  const handHoverRef = useRef<boolean>(false);

  // Orbit controls ref & camera target ref
  const orbitRef = useRef<OrbitControlsImpl>(null!);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  // ═══ ASTRONOMICAL SOLAR ENGINE (Dynamic Sun by Real-Time) ═══
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const [isLiveTime, setIsLiveTime] = useState<boolean>(true);
  const [simulatedHour, setSimulatedHour] = useState<number>(() => {
    const now = new Date();
    return now.getUTCHours() + now.getUTCMinutes() / 60;
  });

  // Real-time ticking every second in live mode
  useEffect(() => {
    if (!isLiveTime) return;
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, [isLiveTime]);

  // Compute active date for astronomical calculations
  const activeSolarDate = useMemo(() => {
    if (isLiveTime) return currentTime;
    const d = new Date(currentTime);
    const hrs = Math.floor(simulatedHour);
    const mins = Math.floor((simulatedHour - hrs) * 60);
    const secs = Math.floor(((simulatedHour - hrs) * 60 - mins) * 60);
    d.setUTCHours(hrs, mins, secs, 0);
    return d;
  }, [isLiveTime, currentTime, simulatedHour]);

  // Compute exact celestial subsolar coordinates & India lighting regime
  const solarEphemeris = useMemo(() => {
    return calculateSolarEphemeris(activeSolarDate);
  }, [activeSolarDate]);

  const sunPosition: [number, number, number] = solarEphemeris.position;

  // Handlers for solar time HUD
  const handleToggleLive = useCallback(() => {
    setIsLiveTime((prev) => {
      const next = !prev;
      if (next) {
        const now = new Date();
        setCurrentTime(now);
        setSimulatedHour(now.getUTCHours() + now.getUTCMinutes() / 60);
      }
      return next;
    });
  }, []);

  const handleHourChange = useCallback((hourFraction: number) => {
    setIsLiveTime(false);
    setSimulatedHour(hourFraction);
  }, []);

  // Helper to convert BuoyLocation to Station for Local Ocean Simulation
  const buoyToStation = useCallback((buoy: BuoyLocation | null): Station => {
    const b = buoy || (buoys.length > 0 ? buoys[0] : {
      id: 'OMNI-BD10',
      name: 'OMNI-BD10',
      type: 'buoy',
      latitude: 16.3617,
      longitude: 87.9903,
      coordinateKind: 'registry',
      metadataSource: 'GEBCO_OMNI_SEED',
    });

    return {
      id: b.id,
      name: b.name || b.id,
      type: 'buoy',
      region: b.latitude > 14 && b.longitude > 80 ? 'BAY OF BENGAL' : 'ARABIAN SEA',
      latitude: b.latitude,
      longitude: b.longitude,
      depth: 2627,
      isOnline: true,
      lastSyncMinutes: 10,
      temperature: 28.5,
      salinity: 34.4,
      waveHeight: 1.45,
      currentSpeed: 0.38,
      seaLevel: 0.12,
      modelTemperature: 28.2,
      modelSalinity: 34.1,
      modelWaveHeight: 1.40,
      modelCurrentSpeed: 0.35,
      modelSeaLevel: 0.10,
      status: 'normal',
    };
  }, [buoys]);

  // Handler to enter Local Ocean Mode
  const handleExploreOcean = useCallback((buoy?: BuoyLocation | null) => {
    const target = buoy || selectedBuoy || (buoys.length > 0 ? buoys[0] : null);
    setExploreStation(buoyToStation(target));
    setLocalOceanDepth(0);
    setIsLocalOcean(true);
  }, [buoyToStation, selectedBuoy, buoys]);

  // Handler to enter Watch Circle 3D Mode
  const handleOpenWatchCircle = useCallback((buoy?: BuoyLocation | null) => {
    const targetId = buoy?.id || selectedBuoy?.id || (buoys.length > 0 ? buoys[0].id : 'OMNI-BD10');
    setSelectedWatchBuoyId(targetId);
    setIsWatchCircleMode(true);
  }, [selectedBuoy, buoys]);

  // When snappy start rotation finishes (~1.0s), enable user interactions and OrbitControls
  const handleStageComplete = useCallback((completedStage: CameraStage) => {
    if (completedStage === 'exploration') {
      setIsReadyToInteract(true);
      if (orbitRef.current) {
        orbitRef.current.enabled = true;
      }
    }
  }, []);

  const isExploring = stage === 'exploration';

  const [recenterKey, setRecenterKey] = useState(0);
  const [isAutoRotating, setIsAutoRotating] = useState(false);

  // Smooth orbital re-center view handler focusing closer on India & buoys
  const handleRecenter = useCallback(() => {
    if (selectedBuoy) {
      selectBuoy(null);
    }
    setRecenterKey((k) => k + 1);
  }, [selectedBuoy, selectBuoy]);

  // Hook up hand gesture events for buoy deselection & recenter
  useEffect(() => {
    hand.onCloseEvent(() => {
      if (isWatchCircleMode) {
        setIsWatchCircleMode(false);
      } else if (isLocalOcean) {
        setIsLocalOcean(false);
      } else if (selectedBuoy) {
        selectBuoy(null);
      }
    });
  }, [hand, selectedBuoy, selectBuoy, isLocalOcean, isWatchCircleMode]);

  useEffect(() => {
    hand.onRecenterEvent(() => {
      if (!isLocalOcean && !isWatchCircleMode) handleRecenter();
    });
  }, [hand, handleRecenter, isLocalOcean, isWatchCircleMode]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#000208',
        overflow: 'hidden',
      }}
    >
      {/* ═══ 3D WATCH CIRCLE LAB MODE ═══ */}
      {isWatchCircleMode ? (
        <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#020617' }} />}>
          <WatchCircleLab
            onExit={() => setIsWatchCircleMode(false)}
            initialBuoyId={selectedWatchBuoyId}
          />
        </Suspense>
      ) : isLocalOcean && exploreStation ? (
        /* ═══ 3D LOCAL OCEAN UNDERWATER DIVE MODE ═══ */
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: '#051b36' }}>
          <Canvas
            camera={{ position: [6, 3.5, 12], fov: 46, near: 0.1, far: 3000 }}
            gl={{
              antialias: true,
              alpha: false,
              powerPreference: 'high-performance',
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.1,
            }}
            dpr={[1, 2]}
            style={{ width: '100%', height: '100%', background: '#051b36' }}
          >
            <LocalOcean3D
              station={exploreStation}
              depth={localOceanDepth}
              layer="observation"
              parameter="temperature"
              handDeltaRef={hand.deltaRot}
              handZoomRef={hand.zoomFactor}
              isHandEnabled={hand.isEnabled}
            />
          </Canvas>

          <LocalOceanUI
            station={exploreStation}
            parameter="temperature"
            depth={localOceanDepth}
            onDepthChange={setLocalOceanDepth}
            onExit={() => setIsLocalOcean(false)}
          />
        </div>
      ) : (
        /* ═══ 3D PLANETARY EARTH GLOBE MODE ═══ */
        <>
          <Canvas
            camera={{ position: [4.45, 1.64, -0.72], fov: 42, near: 0.1, far: 50000 }}
            gl={{
              antialias: true,
              alpha: false,
              powerPreference: 'high-performance',
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.05,
            }}
            dpr={[1, 2]}
            style={{ background: '#000208' }}
          >
            {/* Deep cosmos stars */}
            <Starfield count={3200} />

            {/* Radiant Photorealistic Sun positioned in celestial space with dynamic sunlight */}
            <CelestialSun position={sunPosition} intensity={2.2} />

            {/* Realistic Celestial Moon in background (Pic 2 reference) */}
            <CelestialMoon sunPosition={sunPosition} />

            {/* Ambient starlight */}
            <ambientLight intensity={0.06} />

            {/* MoorSense Earth Base Layer + Operational OMNI Buoy Markers */}
            <MoorSenseEarth
              sunPosition={sunPosition}
              depth={0}
              showClouds={true}
              showEEZ={showEEZ}
              showEEZLabels={showEEZLabels}
            >
              <BuoyMarkersLayer
                buoys={buoys}
                selectedBuoyId={selectedBuoyId}
                onSelectBuoy={(b) => selectBuoy(b.id)}
                visible={showBuoys && hasEntered}
              />
            </MoorSenseEarth>

            {/* Camera Controller */}
            <CameraController
              stage={stage}
              hasStarted={hasEntered}
              onStageComplete={handleStageComplete}
              targetStation={memoizedTargetStation}
              isExploring={isExploring}
              handDelta={hand.deltaRot}
              handZoom={hand.zoomFactor}
              currentTargetRef={cameraTargetRef}
              orbitControlsRef={orbitRef}
              recenterKey={recenterKey}
              onAutoRotateChange={setIsAutoRotating}
            />

            {/* OrbitControls */}
            <OrbitControls
              ref={orbitRef}
              enabled={isExploring}
              enablePan={false}
              minDistance={selectedBuoy ? 0.35 : 2.8}
              maxDistance={selectedBuoy ? 3.5 : 14.0}
              rotateSpeed={0.4}
              zoomSpeed={0.6}
              enableDamping
              dampingFactor={0.06}
              autoRotate={isAutoRotating}
              autoRotateSpeed={0.35}
              makeDefault={false}
            />
          </Canvas>

          {/* Cinematic Vignette Overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: 'radial-gradient(circle at center, transparent 40%, rgba(1, 4, 9, 0.75) 100%)',
              zIndex: 1,
            }}
          />

          {/* ═══ TOP FLOATING CONTROLS (NO FULL-WIDTH NAVBAR) ═══ */}
          <div
            style={{
              position: 'absolute',
              top: '20px',
              left: '24px',
              right: '24px',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              zIndex: 35,
              pointerEvents: 'none',
              opacity: hasEntered ? 1 : 0,
              transform: hasEntered ? 'translateY(0)' : 'translateY(-16px)',
              transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.35s, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.35s',
            }}
          >
            {/* Top Left: Application Name + Quote (NO background box) & Vertically Arranged Buoy Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', pointerEvents: 'auto' }}>
              {/* Application Name & Quote — strictly NO background box */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      background: '#22d3ee',
                      boxShadow: '0 0 12px #22d3ee, 0 0 24px rgba(34, 211, 238, 0.85)',
                    }}
                  />
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      letterSpacing: '0.24em',
                      color: '#ffffff',
                      fontFamily: "'Space Grotesk', system-ui, sans-serif",
                      lineHeight: 1,
                      textShadow: '0 0 22px rgba(34, 211, 238, 0.55), 0 2px 10px rgba(0, 0, 0, 0.9)',
                    }}
                  >
                    MOORSENSE
                  </div>
                </div>
                <div
                  style={{
                    paddingLeft: '19px',
                    fontSize: '9.5px',
                    letterSpacing: '0.14em',
                    fontStyle: 'italic',
                    color: 'rgba(186, 230, 253, 0.85)',
                    fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    textShadow: '0 1px 8px rgba(0, 0, 0, 0.9)',
                  }}
                >
                  “Where ocean depth meets digital twin intelligence”
                </div>
              </div>

              {/* Vertically Arranged Liquid Glass Buoy Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', alignItems: 'flex-start' }}>
                {/* ── Liquid Glass Online Buoys Button ── */}
                <button
                  data-buoy-trigger="online"
                  onClick={() => {
                    setIsOnlineModalOpen((prev) => !prev);
                    setIsOfflineModalOpen(false);
                    setIsMenuOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    background: isOnlineModalOpen
                      ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(16, 185, 129, 0.16) 50%, rgba(255, 255, 255, 0.04) 100%)'
                      : 'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(16, 185, 129, 0.07) 50%, rgba(255, 255, 255, 0.02) 100%)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: isOnlineModalOpen
                      ? '1px solid rgba(52, 211, 153, 0.5)'
                      : '1px solid rgba(255, 255, 255, 0.18)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.65)',
                    borderRadius: '30px',
                    padding: '8px 18px 8px 14px',
                    color: '#ffffff',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    boxShadow: isOnlineModalOpen
                      ? '0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.3), 0 0 16px rgba(16, 185, 129, 0.25)'
                      : '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(16, 185, 129, 0.1)',
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                    e.currentTarget.style.boxShadow =
                      '0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1.5px 2px rgba(255, 255, 255, 0.7), 0 0 18px rgba(16, 185, 129, 0.28)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = isOnlineModalOpen
                      ? '0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.3), 0 0 16px rgba(16, 185, 129, 0.25)'
                      : '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(16, 185, 129, 0.1)';
                  }}
                  title="View active online buoys with coordinates and pull times"
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#34d399',
                      boxShadow: '0 0 10px #34d399, 0 0 16px #10b981',
                    }}
                  />
                  <span style={{ textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)' }}>ONLINE BUOYS</span>
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.12)',
                      border: '1px solid rgba(255, 255, 255, 0.35)',
                      boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.4)',
                      color: '#ffffff',
                      fontSize: '9.5px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '12px',
                    }}
                  >
                    {onlineBuoys.length}
                  </span>
                </button>

                {/* ── Liquid Glass Offline Buoys Button ── */}
                <button
                  data-buoy-trigger="offline"
                  onClick={() => {
                    setIsOfflineModalOpen((prev) => !prev);
                    setIsOnlineModalOpen(false);
                    setIsMenuOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    background: isOfflineModalOpen
                      ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(244, 63, 94, 0.16) 50%, rgba(255, 255, 255, 0.04) 100%)'
                      : 'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(244, 63, 94, 0.07) 50%, rgba(255, 255, 255, 0.02) 100%)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: isOfflineModalOpen
                      ? '1px solid rgba(251, 113, 133, 0.5)'
                      : '1px solid rgba(255, 255, 255, 0.18)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.65)',
                    borderRadius: '30px',
                    padding: '8px 18px 8px 14px',
                    color: '#ffffff',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    boxShadow: isOfflineModalOpen
                      ? '0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.3), 0 0 16px rgba(244, 63, 94, 0.25)'
                      : '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(244, 63, 94, 0.1)',
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                    e.currentTarget.style.boxShadow =
                      '0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1.5px 2px rgba(255, 255, 255, 0.7), 0 0 18px rgba(244, 63, 94, 0.28)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = isOfflineModalOpen
                      ? '0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.3), 0 0 16px rgba(244, 63, 94, 0.25)'
                      : '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(244, 63, 94, 0.1)';
                  }}
                  title="View offline buoys (purposefully removed vs lost)"
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#fb7185',
                      boxShadow: '0 0 10px #fb7185, 0 0 16px #f43f5e',
                    }}
                  />
                  <span style={{ textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)' }}>OFFLINE BUOYS</span>
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.12)',
                      border: '1px solid rgba(255, 255, 255, 0.35)',
                      boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.4)',
                      color: '#ffffff',
                      fontSize: '9.5px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '12px',
                    }}
                  >
                    {offlineBuoys.length}
                  </span>
                </button>
              </div>
            </div>

            {/* Top Right: Astronomical Solar Time HUD & Liquid Glass Menu */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', pointerEvents: 'auto' }}>
              <SolarTimeHUD
                ephemeris={solarEphemeris}
                isLiveTime={isLiveTime}
                onToggleLive={handleToggleLive}
                onHourChange={handleHourChange}
                currentSimulatedHour={simulatedHour}
              />

              <div style={{ position: 'relative' }}>
                <button
                  data-menu-trigger="true"
                  onClick={() => {
                    setIsMenuOpen((prev) => !prev);
                    setIsOnlineModalOpen(false);
                    setIsOfflineModalOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: isMenuOpen
                      ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(14, 165, 233, 0.16) 50%, rgba(255, 255, 255, 0.04) 100%)'
                      : 'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(14, 165, 233, 0.07) 50%, rgba(255, 255, 255, 0.02) 100%)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    border: isMenuOpen
                      ? '1px solid rgba(56, 189, 248, 0.5)'
                      : '1px solid rgba(255, 255, 255, 0.18)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.65)',
                    borderRadius: '30px',
                    padding: '8px 18px',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    boxShadow: isMenuOpen
                      ? '0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.3), 0 0 16px rgba(14, 165, 233, 0.25)'
                      : '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(14, 165, 233, 0.1)',
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                    e.currentTarget.style.boxShadow =
                      '0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1.5px 2px rgba(255, 255, 255, 0.7), 0 0 18px rgba(56, 189, 248, 0.28)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = isMenuOpen
                      ? '0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 1.5px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.3), 0 0 16px rgba(14, 165, 233, 0.25)'
                      : '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(14, 165, 233, 0.1)';
                  }}
                  title="Open system controls (Gesture, Economic Zone, Alerts)"
                >
                  <Menu size={14} color="#38bdf8" />
                  <span style={{ textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)' }}>MENU</span>
                  <ChevronDown
                    size={13}
                    style={{
                      transform: isMenuOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>

                {/* Pill Menu Dropdown Popover */}
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px' }}>
                  <PillMenuPopover
                    isOpen={isMenuOpen}
                    onClose={() => setIsMenuOpen(false)}
                    isHandEnabled={hand.isEnabled}
                    onToggleHand={hand.toggleEnabled}
                    showEEZ={showEEZ}
                    onToggleEEZ={() => setShowEEZ((prev) => !prev)}
                    showEEZLabels={showEEZLabels}
                    onToggleEEZLabels={() => setShowEEZLabels((prev) => !prev)}
                    onRecenter={handleRecenter}
                  />
                </div>
              </div>
            </div>
          </div>

          <BuoyDetailsPanel
            buoy={selectedBuoy}
            onClose={() => selectBuoy(null)}
            onOpenWatchCircle={handleOpenWatchCircle}
            onExploreOcean={handleExploreOcean}
          />

          {/* Modals for Online & Offline Buoys */}
          <OnlineBuoysModal
            isOpen={isOnlineModalOpen}
            onClose={() => setIsOnlineModalOpen(false)}
            buoys={onlineBuoys}
            selectedBuoyId={selectedBuoyId}
            onSelectBuoy={handleSelectOnlineBuoy}
          />

          <OfflineBuoysModal
            isOpen={isOfflineModalOpen}
            onClose={() => setIsOfflineModalOpen(false)}
            buoys={offlineBuoys}
            onSelectBuoy={handleSelectOfflineBuoy}
          />

          {/* Maritime EEZ Demarcations Information HUD */}
          <EEZLegendHUD
            visible={showEEZ}
            onClose={() => setShowEEZ(false)}
            showLabels={showEEZLabels}
            onToggleLabels={() => setShowEEZLabels((prev) => !prev)}
            buoys={buoys}
            onSelectBuoy={(id) => selectBuoy(id)}
          />

          {/* Hand Gesture Control Widget */}
          {isReadyToInteract && (
            <HandControlWidget
              isEnabled={hand.isEnabled}
              onToggle={hand.toggleEnabled}
              onTurnOff={hand.disable}
              status={hand.status}
              gesture={hand.gesture}
              confidence={hand.confidence}
              videoRef={hand.videoRef}
              canvasRef={hand.canvasRef}
            />
          )}

          {/* Hand Gesture Spatial Aiming Crosshair */}
          <HandCrosshair
            isEnabled={hand.isEnabled}
            pointerRef={hand.pointerRef}
            hoverRef={handHoverRef}
          />

          {/* Bottom Left: Liquid Glass Recenter View Button */}
          {isReadyToInteract && (
            <div
              style={{
                position: 'absolute',
                bottom: '24px',
                left: '24px',
                zIndex: 35,
                pointerEvents: 'auto',
                animation: 'slideInFromLeft 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <button
                onClick={handleRecenter}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(14, 165, 233, 0.07) 50%, rgba(255, 255, 255, 0.02) 100%)',
                  backdropFilter: 'blur(20px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  borderTop: '1px solid rgba(255, 255, 255, 0.65)',
                  borderRadius: '30px',
                  padding: '9px 18px',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(14, 165, 233, 0.1)',
                  transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                  e.currentTarget.style.boxShadow =
                    '0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1.5px 2px rgba(255, 255, 255, 0.7), 0 0 18px rgba(56, 189, 248, 0.28)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow =
                    '0 8px 24px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45), inset 0 -1px 1px rgba(0, 0, 0, 0.2), 0 0 8px rgba(14, 165, 233, 0.1)';
                }}
                title="Rotate globe and zoom in to focus on India & Indian Ocean OMNI Buoys"
              >
                <RotateCcw size={14} color="#38bdf8" />
                <span style={{ textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)' }}>RECENTER INDIA</span>
              </button>
            </div>
          )}

          {/* Camera Stage Status Indicator */}
          {stage !== 'exploration' && (
            <div
              style={{
                position: 'absolute',
                bottom: '48px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '9px',
                letterSpacing: '0.24em',
                color: 'rgba(34, 211, 238, 0.8)',
                fontFamily: 'monospace',
                zIndex: 20,
                pointerEvents: 'none',
                background: 'rgba(2, 8, 22, 0.75)',
                padding: '6px 18px',
                borderRadius: '4px',
                border: '1px solid rgba(34, 211, 238, 0.25)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
              }}
            >
              {stage === 'space' && '● ORBITAL SATELLITE VIEW'}
              {stage === 'earth' && '● APPROACHING PLANET EARTH'}
              {stage === 'indianOcean' && '● LOCKING TARGET: INDIAN OCEAN BASIN'}
              {stage === 'bayOfBengal' && '● FOCUSING OBSERVATION GRID: BAY OF BENGAL'}
            </div>
          )}

          {/* Exploration Mode Hint */}
          {isReadyToInteract && !selectedBuoy && (
            <div
              style={{
                position: 'absolute',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '8.5px',
                letterSpacing: '0.18em',
                color: 'rgba(148, 163, 184, 0.65)',
                fontFamily: 'monospace',
                zIndex: 20,
                pointerEvents: 'none',
                background: 'rgba(2, 8, 22, 0.6)',
                padding: '4px 14px',
                borderRadius: '3px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              CLICK BUOY TO INSPECT TELEMETRY &nbsp;·&nbsp; DRAG TO ROTATE GLOBE &nbsp;·&nbsp; SCROLL TO ZOOM
            </div>
          )}
        </>
      )}

      {/* ── Initial Loading Page (Stable Ocean in Circle + Buoy & Moore + Loading / Launch Hub) ── */}
      {!isIntroDismissed && (
        <InitialLoadingScreen
          onEnter={() => setHasEntered(true)}
          onDismissed={() => setIsIntroDismissed(true)}
        />
      )}
    </div>
  );
}
