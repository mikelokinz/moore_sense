import { useState, useMemo, useEffect } from 'react';
import { WatchCircleScene } from '../watchcircle/WatchCircleScene';
import {
  calculateMooringPhysics,
  type EnvironmentalConditions,
  type MooringConfig,
  type GPSTrailPoint,
} from '../watchcircle/watchCircleTypes';

export function LoadingOceanCircle3D() {
  // Environmental Conditions for this dedicated sentinel buoy
  // Gentle, serene ocean swells without violent resonance or storm wobble
  const [env] = useState<EnvironmentalConditions>({
    currentSpeed: 0.40,
    currentDirection: 55,
    windSpeed: 5.0,
    windDirection: 45,
    waveHeight: 0.95,
    wavePeriod: 7.5,
    waveDirection: 50,
  });

  // Dedicated MoorSense Deep-Sea Sentinel platform (independent of OMNI-BD10 or any other buoy)
  const [config] = useState<MooringConfig>({
    buoyId: 'MOORSENSE-SENTINEL-X1',
    waterDepth: 2600,
    watchCircleRadius: 360,
    nominalLatitude: 12.0,
    nominalLongitude: 85.0,
    scope: 1.22,
    mbl_kN: 260.0,
  });

  // Calculate live engineering physics and catenary spline for this specific platform
  const physicsData = useMemo(() => {
    return calculateMooringPhysics(env, config, 0);
  }, [env, config]);

  // Gentle breadcrumb trail for this platform
  const [gpsTrail, setGpsTrail] = useState<GPSTrailPoint[]>([]);

  useEffect(() => {
    const pts: GPSTrailPoint[] = [];
    const bx = physicsData.buoyState.excursionX;
    const bz = physicsData.buoyState.excursionZ;
    for (let i = 8; i >= 0; i--) {
      const frac = 1 - i / 8;
      pts.push({
        x: bx * frac + Math.sin(i * 0.75) * 2.5,
        z: bz * frac - Math.cos(i * 0.75) * 1.8,
        time: Date.now() / 1000 - i * 15,
        breach: false,
      });
    }
    setGpsTrail(pts);
  }, [physicsData.buoyState.excursionX, physicsData.buoyState.excursionZ]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* 
        Exact 3D Ocean, Watch Circle Overlay, Buoy, and Mooring Line:
        - cameraLocked: freezes camera strictly at the exact oblique elevated perspective
        - showBadges={false}: zero floating HTML text badges on the 3D scene (no HUD)
        - disableInspection={true}: zero inspection cards or callouts
        - Only the 3D watch circle itself (concentric rings, datum crosshair, excursion vector) and the buoy!
      */}
      <WatchCircleScene
        env={env}
        config={config}
        buoyState={physicsData.buoyState}
        catenaryPoints={physicsData.catenaryPoints}
        segments={physicsData.segments}
        gpsTrail={gpsTrail}
        showBoundary={true}
        showTrail={true}
        showExcursionVector={true}
        showUnderwater={true}
        cameraPreset={null}
        onCameraPresetHandled={() => {}}
        currentDepth={0}
        physicsEngine="rapier"
        disableInspection={true}
        showBadges={false}
        cameraLocked={true}
        buoyPosition="left"
      />
    </div>
  );
}
