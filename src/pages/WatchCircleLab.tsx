import { useState, useMemo, useEffect, useCallback } from 'react';
import { WatchCircleScene } from '../components/watchcircle/WatchCircleScene';
import { WatchCircleHUD } from '../components/watchcircle/WatchCircleHUD';
import {
  calculateMooringPhysics,
  PRESET_SCENARIOS,
  type EnvironmentalConditions,
  type MooringConfig,
  type GPSTrailPoint,
  type WatchCircleDepthLevel,
  type PhysicsEngineMode,
} from '../components/watchcircle/watchCircleTypes';
import {
  fetchLiveWatchCircleData,
  type LiveWatchCirclePackage,
} from '../services/buoy/mooringService';
import { KNOWN_STATIONS } from '../utils/eezJurisdiction';

interface WatchCircleLabProps {
  onExit?: () => void;
  initialBuoyId?: string;
}

export default function WatchCircleLab({ onExit, initialBuoyId = 'OMNI-BD10' }: WatchCircleLabProps) {
  // Current active buoy station ID
  const [activeBuoyId, setActiveBuoyId] = useState<string>(initialBuoyId);

  // Live Real-Time Telemetry Mode (true by default)
  const [isLiveMode, setIsLiveMode] = useState<boolean>(true);
  const [liveLoading, setLiveLoading] = useState<boolean>(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [livePackage, setLivePackage] = useState<LiveWatchCirclePackage | null>(null);

  // Environmental Conditions (default from initial scenario or live data)
  const [env, setEnv] = useState<EnvironmentalConditions>({
    ...PRESET_SCENARIOS.monsoon.env,
  });

  // Mooring Configuration (depth, scope, radius)
  const initialKnown = KNOWN_STATIONS[initialBuoyId];
  const [config, setConfig] = useState<MooringConfig>({
    buoyId: initialBuoyId,
    waterDepth: 2627,
    watchCircleRadius: 360,
    nominalLatitude: initialKnown?.latitude ?? 16.3617,
    nominalLongitude: initialKnown?.longitude ?? 87.9903,
    scope: 1.22,
    mbl_kN: 245.0,
  });

  // Exploration Depth Level (0 = Surface, 10, 50, 100, 500, 1000, 2500 = Seabed)
  const [currentDepth, setCurrentDepth] = useState<WatchCircleDepthLevel>(0);

  // Selected Mooring Line Segment
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);

  // Selected Mooring Material for Load Calculator & 3D Interactive Inspection
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('nylon_rope');

  // Visualization Toggles
  const [showBoundary, setShowBoundary] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [showExcursionVector, setShowExcursionVector] = useState(true);
  const [showUnderwater, setShowUnderwater] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // Physics engine selection: 'rapier' (Rust WebAssembly) or 'kinematic' (Analytical ODE)
  const [physicsEngine, setPhysicsEngine] = useState<PhysicsEngineMode>('rapier');

  // Camera preset command
  const [cameraPreset, setCameraPreset] = useState<'top' | 'surface' | 'profile' | 'anchor' | null>(null);

  // GPS Trajectory Breadcrumb Trail
  const [gpsTrail, setGpsTrail] = useState<GPSTrailPoint[]>([]);

  // Prediction vs. Actual Toggle ('actual' by default)
  const [telemetryMode, setTelemetryMode] = useState<'actual' | 'prediction'>('actual');

  // Real-time camera heading tracked from 3D OrbitControls (for Bottom-Left Compass HUD)
  const [cameraHeading, setCameraHeading] = useState<number>(0);

  // Satellite AI Predicted Waypoint derived from live Digital Twin response
  const predictedPos = useMemo(() => {
    if (!livePackage?.response) return null;
    const offset = livePackage.response.predicted_offset_m ?? 90;
    const bearingDeg = livePackage.response.predicted_bearing_deg ?? 304.88;
    const rad = (bearingDeg * Math.PI) / 180;
    return {
      x: offset * Math.sin(rad),
      z: -offset * Math.cos(rad),
      offsetMeters: offset,
      bearingDeg,
    };
  }, [livePackage?.response]);

  // Function to pull live data for active station
  const loadLiveData = useCallback(async (buoyId: string, applyLive = true) => {
    setLiveLoading(true);
    setLiveError(null);
    try {
      const pkg = await fetchLiveWatchCircleData(buoyId);
      setLivePackage(pkg);
      if (applyLive) {
        setEnv(pkg.env);
        setConfig(pkg.config);
      }
    } catch (err: any) {
      console.warn('Failed to pull live mooring data, falling back to engineering simulation:', err);
      setLiveError('Live telemetry stream unavailable, using calibrated physics model');
    } finally {
      setLiveLoading(false);
    }
  }, []);

  // Fetch real-time data on mount and whenever active buoy changes
  useEffect(() => {
    loadLiveData(activeBuoyId, isLiveMode);
  }, [activeBuoyId, isLiveMode, loadLiveData]);

  // Periodic polling to update live telemetry every 25 seconds
  useEffect(() => {
    if (!isLiveMode) return;
    const timer = setInterval(() => {
      loadLiveData(activeBuoyId, true);
    }, 25000);
    return () => clearInterval(timer);
  }, [activeBuoyId, isLiveMode, loadLiveData]);

  // Physics Model outputs — memoized against environmental inputs and live solver telemetry
  const physicsData = useMemo(() => {
    let liveOverride = undefined;
    if (isLiveMode && livePackage?.response) {
      const dt = livePackage.response;
      if (telemetryMode === 'prediction') {
        // Satellite AI Prediction mode: use the predicted offset, bearing, and tension forecasts
        liveOverride = {
          steadyExcursionMeters: dt.predicted_offset_m ?? undefined,
          forceResultantAngle:
            dt.predicted_bearing_deg != null
              ? (dt.predicted_bearing_deg * Math.PI) / 180
              : undefined,
          fairleadTension_kN:
            dt.fairlead_tension_n != null
              ? Math.round((dt.fairlead_tension_n / 1000) * 10) / 10
              : undefined,
          anchorTension_kN:
            dt.anchor_tension_n != null
              ? Math.round((dt.anchor_tension_n / 1000) * 10) / 10
              : undefined,
          safetyFactor: dt.safety_factor ?? undefined,
        };
      } else {
        // Live Telemetry mode: actual reported buoy GPS position and measured hardware tension
        const dLat = (livePackage.latitude ?? config.nominalLatitude) - config.nominalLatitude;
        const dLon = (livePackage.longitude ?? config.nominalLongitude) - config.nominalLongitude;
        const mLat = dLat * 111320;
        const mLon = dLon * 111320 * Math.cos((config.nominalLatitude * Math.PI) / 180);
        const actualDist = Math.sqrt(mLon * mLon + mLat * mLat);

        liveOverride = {
          steadyExcursionMeters: actualDist > 4 ? actualDist : undefined,
          forceResultantAngle: actualDist > 4 ? Math.atan2(mLon, mLat) : undefined,
          fairleadTension_kN:
            dt.fairlead_tension_n != null
              ? Math.round((dt.fairlead_tension_n / 1000) * 10) / 10
              : undefined,
          anchorTension_kN:
            dt.anchor_tension_n != null
              ? Math.round((dt.anchor_tension_n / 1000) * 10) / 10
              : undefined,
          safetyFactor: dt.safety_factor ?? undefined,
        };
      }
    }

    const raw = calculateMooringPhysics(env, config, 0, liveOverride);

    // Use authoritative segments if available
    if (livePackage?.segments && livePackage.segments.length > 0) {
      // Map live calculated points into the authoritative segments
      const mergedSegments = livePackage.segments.map((seg, idx) => {
        const fallbackSeg = raw.segments[idx];
        return {
          ...seg,
          localTension_kN: fallbackSeg?.localTension_kN ?? seg.localTension_kN,
          localAngle_deg: fallbackSeg?.localAngle_deg ?? seg.localAngle_deg,
          points3D: fallbackSeg?.points3D ?? [],
        };
      });
      return {
        ...raw,
        segments: mergedSegments,
      };
    }

    return raw;
  }, [env, config, isLiveMode, livePackage, telemetryMode]);

  // Gentle breadcrumb recording when excursion shifts or over time
  useEffect(() => {
    if (isPaused) return;

    setGpsTrail((prev) => {
      const nextPoint = {
        x: physicsData.buoyState.excursionX,
        z: physicsData.buoyState.excursionZ,
        time: Date.now() / 1000,
        breach: physicsData.buoyState.status === 'BREACH',
      };
      const next = [...prev, nextPoint];
      return next.slice(-100);
    });
  }, [physicsData, isPaused]);

  // Handle station switch
  const handleSelectBuoyId = (newBuoyId: string) => {
    setActiveBuoyId(newBuoyId);
    setGpsTrail([]);
  };

  // Handle camera viewpoint preset selection
  const handleSetCameraPreset = (preset: 'top' | 'surface' | 'profile' | 'anchor') => {
    setCameraPreset(preset);
    if (preset === 'surface' || preset === 'top') {
      setCurrentDepth(0);
    } else if (preset === 'anchor') {
      setCurrentDepth(2500);
    } else if (preset === 'profile') {
      setCurrentDepth(500);
    }
  };

  const handleResetCamera = () => {
    setCameraPreset('surface');
    setCurrentDepth(0);
    setSelectedSegmentIndex(null);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#020617', overflow: 'hidden' }}>
      {/* ── 3D Scene Canvas (Isolated in Lower Stacking Context z-index: 1) ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <WatchCircleScene
          env={env}
          config={config}
          buoyState={physicsData.buoyState}
          catenaryPoints={physicsData.catenaryPoints}
          segments={physicsData.segments}
          selectedSegmentIndex={selectedSegmentIndex}
          onSelectSegment={setSelectedSegmentIndex}
          selectedMaterialId={selectedMaterialId}
          onSelectMaterial={setSelectedMaterialId}
          gpsTrail={gpsTrail}
          showBoundary={showBoundary}
          showTrail={showTrail}
          showExcursionVector={showExcursionVector}
          showUnderwater={showUnderwater}
          cameraPreset={cameraPreset}
          onCameraPresetHandled={() => setCameraPreset(null)}
          currentDepth={currentDepth}
          onDepthChange={setCurrentDepth}
          onHeadingChange={setCameraHeading}
          predictedPos={predictedPos}
          isPredictionMode={telemetryMode === 'prediction'}
          physicsEngine={physicsEngine}
        />
      </div>

      {/* ── 2D Interactive Scientific HUD Dashboard (Elevated in Foreground Stacking Context z-index: 50) ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
        <WatchCircleHUD
          env={env}
          setEnv={setEnv}
          config={config}
          setConfig={setConfig}
          buoyState={physicsData.buoyState}
          segments={physicsData.segments}
          selectedSegmentIndex={selectedSegmentIndex}
          onSelectSegment={setSelectedSegmentIndex}
          selectedMaterialId={selectedMaterialId}
          onSelectMaterial={setSelectedMaterialId}
          currentDepth={currentDepth}
          onDepthChange={setCurrentDepth}
          physicsEngine={physicsEngine}
          setPhysicsEngine={setPhysicsEngine}
          showBoundary={showBoundary}
          setShowBoundary={setShowBoundary}
          showTrail={showTrail}
          setShowTrail={setShowTrail}
          showExcursionVector={showExcursionVector}
          setShowExcursionVector={setShowExcursionVector}
          showUnderwater={showUnderwater}
          setShowUnderwater={setShowUnderwater}
          isPaused={isPaused}
          setIsPaused={setIsPaused}
          onClearTrail={() => setGpsTrail([])}
          onResetCamera={handleResetCamera}
          onSetCameraPreset={handleSetCameraPreset}
          onExit={onExit}
          isLiveMode={isLiveMode}
          setIsLiveMode={setIsLiveMode}
          liveLoading={liveLoading}
          liveError={liveError}
          livePackage={livePackage}
          activeBuoyId={activeBuoyId}
          onSelectBuoyId={handleSelectBuoyId}
          onRefreshLive={() => loadLiveData(activeBuoyId, true)}
          telemetryMode={telemetryMode}
          setTelemetryMode={setTelemetryMode}
          cameraHeading={cameraHeading}
          predictedPos={predictedPos}
        />
      </div>
    </div>
  );
}
