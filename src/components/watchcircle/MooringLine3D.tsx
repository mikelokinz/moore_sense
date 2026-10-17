import { useMemo, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { BuoyState, MooringSegmentData } from './watchCircleTypes';

interface MooringLine3DProps {
  catenaryPoints: THREE.Vector3[];
  buoyState: BuoyState;
  segments?: MooringSegmentData[];
  selectedSegmentIndex?: number | null;
  onSelectSegment?: (index: number | null) => void;
  selectedMaterialId?: string;
  onSelectMaterial?: (id: string) => void;
  liveMotionRef?: React.MutableRefObject<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    keelPosition: THREE.Vector3;
  }>;
  onInspectPart?: (partId: string, worldPos: [number, number, number]) => void;
  showTensionBadges?: boolean;
}

// In-place dynamic buffer vertex updater for Three.js TubeGeometry
// Zero GPU buffer allocations, zero garbage collection pauses
function updateTubeVertices(
  geometry: THREE.BufferGeometry,
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments: number,
  radius: number,
  radialSegments: number
) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
  if (!positionAttr) return;
  const posArray = positionAttr.array as Float32Array;
  let idx = 0;

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    const p = curve.getPointAt(u);
    const N = frames.normals[i];
    const B = frames.binormals[i];

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const normalX = cos * N.x + sin * B.x;
      const normalY = cos * N.y + sin * B.y;
      const normalZ = cos * N.z + sin * B.z;

      posArray[idx++] = p.x + radius * normalX;
      posArray[idx++] = p.y + radius * normalY;
      posArray[idx++] = p.z + radius * normalZ;
    }
  }

  positionAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

// ── Mathematically exact cylindrical structural strut between two 3D coordinates ──
interface ConnectingBarProps {
  from: [number, number, number];
  to: [number, number, number];
  radius?: number;
  color?: string;
  roughness?: number;
  metalness?: number;
}

function ConnectingBar({
  from,
  to,
  radius = 0.012,
  color = '#e2e8f0',
  roughness = 0.20,
  metalness = 0.95,
}: ConnectingBarProps) {
  const { position, quaternion, length } = useMemo(() => {
    const p1 = new THREE.Vector3(...from);
    const p2 = new THREE.Vector3(...to);
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    return { position: mid, quaternion: q, length: len };
  }, [from, to]);

  return (
    <group>
      <mesh position={position} quaternion={quaternion} castShadow>
        <cylinderGeometry args={[radius, radius, length, 12]} />
        <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
      </mesh>
      <mesh position={from}>
        <sphereGeometry args={[radius * 1.25, 8, 8]} />
        <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
      </mesh>
      <mesh position={to}>
        <sphereGeometry args={[radius * 1.25, 8, 8]} />
        <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
      </mesh>
    </group>
  );
}

export function MooringLine3D({
  catenaryPoints,
  buoyState,
  segments,
  selectedSegmentIndex = null,
  onSelectSegment,
  selectedMaterialId,
  onSelectMaterial,
  liveMotionRef,
  onInspectPart,
  showTensionBadges = true,
}: MooringLine3DProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Material active state helper for visual highlight feedback
  const isMatActive = (id: string) => selectedMaterialId === id;

  // Group and mesh references for silky-smooth 60 FPS live kinematics
  const upperRiserRef = useRef<THREE.Group>(null!);
  const trawlFloatRef = useRef<THREE.Group>(null!);
  const seabedTackleRef = useRef<THREE.Group>(null!);
  const nylonRopeMeshRef = useRef<THREE.Mesh>(null!);
  const nylonHitboxMeshRef = useRef<THREE.Mesh>(null!);
  const polyRopeMeshRef = useRef<THREE.Mesh>(null!);
  const polyHitboxMeshRef = useRef<THREE.Mesh>(null!);
  const tautnessRef = useRef(0);

  // Real-time 3D Tension Telemetry & Vector Visualization Refs
  const fairleadTensionRef = useRef<THREE.Group>(null!);
  const midspanTensionRef = useRef<THREE.Group>(null!);
  const anchorTensionRef = useRef<THREE.Group>(null!);
  const fairleadVectorRef = useRef<THREE.Group>(null!);
  const anchorVectorRef = useRef<THREE.Group>(null!);

  // Horizontal offset direction for the buoyant trawl float (primarily +X for clear profile bend visibility)
  const floatOffset = useMemo(() => new THREE.Vector3(1.35, 0, 0.15), []);

  // Authentic procedural diamond netting texture matching reference schematic
  const netTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 512, 1024);

      // Diamond mesh cord lines (criss-cross lattice)
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';

      const numRows = 24;
      const numCols = 10;
      const colW = 512 / numCols;
      const rowH = 1024 / numRows;

      // Diagonal lines /
      for (let r = -numCols; r < numRows + numCols; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * rowH);
        ctx.lineTo(512, (r + numCols) * rowH);
        ctx.stroke();
      }

      // Diagonal lines \
      for (let r = -numCols; r < numRows + numCols; r++) {
        ctx.beginPath();
        ctx.moveTo(512, r * rowH);
        ctx.lineTo(0, (r + numCols) * rowH);
        ctx.stroke();
      }

      // Knot nodes at intersections
      ctx.fillStyle = '#ffffff';
      for (let r = 0; r <= numRows; r++) {
        for (let c = 0; c <= numCols * 2; c++) {
          const x = c * (colW / 2);
          const y = r * rowH + (c % 2 === 1 ? rowH / 2 : 0);
          ctx.beginPath();
          ctx.arc(x, y, 4.0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    return tex;
  }, []);

  // Nominal initial fairlead coordinate
  const initialKeelPos = useMemo(() => {
    return new THREE.Vector3(buoyState.excursionX / 30, -1.69, buoyState.excursionZ / 30);
  }, [buoyState.excursionX, buoyState.excursionZ]);

  // Initial curve for Nylon Rope U-Bend
  const initialNylonCurve = useMemo(() => {
    const pCtd = initialKeelPos.clone().add(new THREE.Vector3(0, -5.10, 0));
    const pFloat = initialKeelPos.clone().add(new THREE.Vector3(floatOffset.x, -4.61, floatOffset.z));
    const pDip = new THREE.Vector3(
      (pCtd.x + pFloat.x) * 0.5,
      Math.min(pCtd.y, pFloat.y) - 0.90,
      (pCtd.z + pFloat.z) * 0.5
    );
    const pDown = pCtd.clone().add(new THREE.Vector3(0, -0.42, 0));
    const pUp = pFloat.clone().add(new THREE.Vector3(0, -0.42, 0));
    return new THREE.CatmullRomCurve3([pCtd, pDown, pDip, pUp, pFloat], false, 'catmullrom', 0.5);
  }, [initialKeelPos, floatOffset]);

  // Initial curve for Deep Polypropylene Rope
  const initialPolyCurve = useMemo(() => {
    const pFloat = initialKeelPos.clone().add(new THREE.Vector3(floatOffset.x, -4.61, floatOffset.z));
    const pGlassTop = new THREE.Vector3(0, -14.60, 0);
    const pMid = new THREE.Vector3(
      pFloat.x * 0.40,
      (pFloat.y + pGlassTop.y) * 0.5,
      pFloat.z * 0.40
    );
    return new THREE.CatmullRomCurve3([pFloat, pMid, pGlassTop], false, 'catmullrom', 0.5);
  }, [initialKeelPos, floatOffset]);

  // Master curve for segment markers
  const masterCurve = useMemo(() => {
    if (!catenaryPoints || catenaryPoints.length < 2) return null;
    return new THREE.CatmullRomCurve3(catenaryPoints, false, 'catmullrom', 0.5);
  }, [catenaryPoints]);

  // Segment highlight states
  const isSeg0Active = selectedSegmentIndex === 0;
  const isSeg1Active = selectedSegmentIndex === 1;
  const isSeg2Active = selectedSegmentIndex === 2;

  const isSeg0Hovered = hoveredIndex === 0;
  const isSeg1Hovered = hoveredIndex === 1;
  const isSeg2Hovered = hoveredIndex === 2;

  // ══════════════════════════════════════════════════════════════════
  // LIVE FRAME KINEMATICS: 100% Locked Buoy Connection & Dynamic Flex
  // ══════════════════════════════════════════════════════════════════
  useFrame((state) => {
    if (!liveMotionRef?.current) return;
    const liveKeel = liveMotionRef.current.keelPosition;
    const liveRot = liveMotionRef.current.rotation;

    // Anchor pin coordinate atop bottom weight clump sinker
    const anchorPin = new THREE.Vector3(0, -17.115, 0);

    // Compute line direction from anchor to keel, and keel down to anchor
    const lineVec = new THREE.Vector3().subVectors(anchorPin, liveKeel);
    const dirDown = lineVec.clone().normalize();
    const dirUp = dirDown.clone().negate();

    // ── Physical Dynamic Tautness Driven by Live Buoy Excursion ──
    // The mooring line does NOT instantly snap straight when a storm preset is selected.
    // Instead, the line stretches in continuous physical unison with the live movement of the buoy:
    // - In calm / center: ample geometric slack; full compliant S-loop & U-bend (tautness = 0).
    // - As the storm pushes the buoy across the watch circle: slack is progressively pulled out.
    // - When the buoy reaches the boundary perimeter / breach: line pulls 100% straight (tautness = 1.0).
    const watchRadius3D =
      buoyState.excursionDistance > 0 && buoyState.excursionPercent > 0
        ? (buoyState.excursionDistance / (buoyState.excursionPercent / 100)) / 30
        : 12.0;

    // Live horizontal excursion from the anchor coordinate
    const liveHorizExcursion = Math.hypot(liveKeel.x - anchorPin.x, liveKeel.z - anchorPin.z);
    const liveExcursionRatio = liveHorizExcursion / Math.max(1.0, watchRadius3D);

    // Physical strain curve with catenary slack take-up threshold:
    // Below 22% excursion (~2.6m): slack compliant loop
    // Above 22% up to ~96% excursion (~11.5m): progressive strain hardening
    // At >= 96% excursion: 100% laser-straight taut line at boundary reach
    const slackThreshold = 0.22;
    const tautThreshold = 0.96;
    const normExcursion = THREE.MathUtils.clamp(
      (liveExcursionRatio - slackThreshold) / (tautThreshold - slackThreshold),
      0.0,
      1.0
    );
    // Non-linear strain stiffening typical of marine synthetic ropes
    const targetTautness = Math.pow(normExcursion, 1.55);

    // Responsive 60 FPS filter tracks buoy displacement smoothly without delay or lag
    tautnessRef.current = THREE.MathUtils.lerp(tautnessRef.current, targetTautness, 0.12);
    const tautness = tautnessRef.current;

    // 1. Position and orient Upper Riser Group (Components 1-4)
    if (upperRiserRef.current) {
      upperRiserRef.current.position.set(liveKeel.x, liveKeel.y, liveKeel.z);
      // In calm: pendulum wave response as cable hangs vertically
      const qRiserCalm = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(liveRot.x * 0.16, 0, liveRot.z * 0.16)
      );
      // In taut: Upper Riser points directly along dirDown toward the anchor
      const qRiserTaut = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        dirDown
      );
      upperRiserRef.current.quaternion.slerpQuaternions(qRiserCalm, qRiserTaut, tautness);
    }

    // World space position of CTD base (end of Upper Riser group, 5.10m from keel)
    const ctdOffsetLocal = new THREE.Vector3(0, -5.10, 0);
    ctdOffsetLocal.applyQuaternion(upperRiserRef.current.quaternion);
    const liveCtdBase = liveKeel.clone().add(ctdOffsetLocal);

    // 2. Position and orient Seabed Tackle Assembly (Components 8-10 + anchor shackle)
    if (seabedTackleRef.current) {
      seabedTackleRef.current.position.set(anchorPin.x, anchorPin.y, anchorPin.z);
      // In calm: stands vertically upright
      const qTackleCalm = new THREE.Quaternion(); // Identity
      // In taut: tilts at the anchor pin directly along dirUp toward the buoy
      const qTackleTaut = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dirUp
      );
      seabedTackleRef.current.quaternion.slerpQuaternions(qTackleCalm, qTackleTaut, tautness);
    }

    // World space position of Glass Spheres top (top of seabed tackle assembly, 2.665m from anchor pin)
    const glassTopLocal = new THREE.Vector3(0, 2.665, 0);
    glassTopLocal.applyQuaternion(seabedTackleRef.current.quaternion);
    const liveGlassTop = anchorPin.clone().add(glassTopLocal);

    // 3. Middle span between liveCtdBase and liveGlassTop (Nylon Rope, Junction, Polypropylene Rope)
    const spanVec = new THREE.Vector3().subVectors(liveGlassTop, liveCtdBase);
    const spanDist = spanVec.length();
    const dirDownSpan = spanDist > 0.001 ? spanVec.clone().normalize() : dirDown;

    // Single Mooring Line Junction Point (connecting Nylon Rope, Polypropylene Rope, and Trawl Float Tether):
    // In calm: compliant S-loop buoyancy apex (+1800N net upward arch from trawl float)
    const t = state.clock.elapsedTime;
    const floatHeave = (liveKeel.y - (-1.69)) * 0.22 + Math.sin(t * 1.35) * 0.04;
    const posJunctionCalm = new THREE.Vector3(
      liveKeel.x * 0.35 + floatOffset.x,
      -6.30 + floatHeave,
      liveKeel.z * 0.35 + floatOffset.z
    );

    // In taut: the junction point lies directly on the straight segment between liveCtdBase and liveGlassTop
    // Nylon rope takes ~26% of the CTD-to-Glass span
    const nylonTautLen = Math.max(1.6, spanDist * 0.26);
    const posJunctionTaut = liveCtdBase.clone().add(dirDownSpan.clone().multiplyScalar(nylonTautLen));

    // Continuous junction point in 3D world space:
    const liveJunction = new THREE.Vector3().lerpVectors(posJunctionCalm, posJunctionTaut, tautness);

    // Trawl Float Orientation & Single-Point Connection:
    // ONLY ONE POINT (the bottom plate / bridle eye at local Y = 0) connects to the mooring line at liveJunction.
    // The top crown shackle (local Y = 1.58m) is completely open to the water column.
    // The float is NOT part of the line and NEVER aligns with the diagonal line.
    // Its net positive buoyancy (+1800N) pulls it UPWARD towards the sea surface.
    const qFloatCalm = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.sin(t * 1.2) * 0.025, 0, Math.cos(t * 1.5) * 0.025)
    );
    // In storm / current: buoyant force keeps float pointing upward (+Y), with slight stream tilt down-drift
    const horizDrift = new THREE.Vector3(liveKeel.x, 0, liveKeel.z);
    const driftDir = horizDrift.length() > 0.05 ? horizDrift.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const floatUpVecTaut = new THREE.Vector3(driftDir.x * 0.20, 0.98, driftDir.z * 0.20).normalize();
    const qFloatTaut = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      floatUpVecTaut
    );

    if (trawlFloatRef.current) {
      trawlFloatRef.current.position.copy(liveJunction);
      trawlFloatRef.current.quaternion.slerpQuaternions(qFloatCalm, qFloatTaut, tautness);
    }

    // Dynamic 3D Tension Force Vectors and Telemetry HUD Positions
    if (fairleadTensionRef.current) {
      fairleadTensionRef.current.position.set(liveKeel.x + 0.42, liveKeel.y - 0.45, liveKeel.z);
    }
    if (fairleadVectorRef.current) {
      fairleadVectorRef.current.position.set(liveKeel.x, liveKeel.y - 0.15, liveKeel.z);
      fairleadVectorRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirDown);
    }
    if (midspanTensionRef.current) {
      midspanTensionRef.current.position.set(liveJunction.x + 0.42, liveJunction.y, liveJunction.z);
    }
    if (anchorTensionRef.current) {
      anchorTensionRef.current.position.set(anchorPin.x + 0.42, anchorPin.y + 0.35, anchorPin.z);
    }
    if (anchorVectorRef.current) {
      anchorVectorRef.current.position.set(anchorPin.x, anchorPin.y, anchorPin.z);
      anchorVectorRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirUp);
    }

    // 4. Update Compliant Nylon Rope:
    // In calm: distinct U-bend dip (~0.90m below CTD)
    // In extreme cyclone breach: flattens completely into a 100% straight cylinder ending at liveJunction!
    const liveDipCalm = new THREE.Vector3(
      (liveCtdBase.x + liveJunction.x) * 0.5,
      Math.min(liveCtdBase.y, liveJunction.y) - 0.90,
      (liveCtdBase.z + liveJunction.z) * 0.5
    );
    const pDownCalm = liveCtdBase.clone().add(new THREE.Vector3(0, -0.42, 0));
    const pUpCalm = liveJunction.clone().add(new THREE.Vector3(0, -0.42, 0));

    const liveDipTaut = new THREE.Vector3().lerpVectors(liveCtdBase, liveJunction, 0.50);
    const pDownTaut = new THREE.Vector3().lerpVectors(liveCtdBase, liveJunction, 0.25);
    const pUpTaut = new THREE.Vector3().lerpVectors(liveCtdBase, liveJunction, 0.75);

    const liveDip = new THREE.Vector3().lerpVectors(liveDipCalm, liveDipTaut, tautness);
    const pDown = new THREE.Vector3().lerpVectors(pDownCalm, pDownTaut, tautness);
    const pUp = new THREE.Vector3().lerpVectors(pUpCalm, pUpTaut, tautness);

    // When tautness >= 0.98, use pure LineCurve3 for mathematically perfect, laser-straight line geometry
    const liveNylonCurve =
      tautness >= 0.98
        ? new THREE.LineCurve3(liveCtdBase, liveJunction)
        : new THREE.CatmullRomCurve3(
            [liveCtdBase, pDown, liveDip, pUp, liveJunction],
            false,
            'catmullrom',
            0.5
          );

    if (nylonRopeMeshRef.current?.geometry) {
      updateTubeVertices(
        nylonRopeMeshRef.current.geometry,
        liveNylonCurve,
        32,
        isSeg1Active ? 0.048 : 0.038,
        8
      );
    }
    if (nylonHitboxMeshRef.current?.geometry) {
      updateTubeVertices(
        nylonHitboxMeshRef.current.geometry,
        liveNylonCurve,
        32,
        0.26,
        6
      );
    }

    // 5. Update Deep Polypropylene Rope:
    // Starts at liveJunction (the SAME single attachment point as Nylon Rope)
    // In calm: deep catenary curve
    // In extreme cyclone breach: flattens completely into a 100% straight cylinder!
    const polyMidCalm = new THREE.Vector3(
      liveJunction.x * 0.40,
      (liveJunction.y + liveGlassTop.y) * 0.5,
      liveJunction.z * 0.40
    );
    const polyMidTaut = new THREE.Vector3().lerpVectors(liveJunction, liveGlassTop, 0.50);
    const polyMid = new THREE.Vector3().lerpVectors(polyMidCalm, polyMidTaut, tautness);

    const livePolyCurve =
      tautness >= 0.98
        ? new THREE.LineCurve3(liveJunction, liveGlassTop)
        : new THREE.CatmullRomCurve3(
            [liveJunction, polyMid, liveGlassTop],
            false,
            'catmullrom',
            0.5
          );

    if (polyRopeMeshRef.current?.geometry) {
      updateTubeVertices(
        polyRopeMeshRef.current.geometry,
        livePolyCurve,
        32,
        isSeg1Active ? 0.046 : 0.036,
        8
      );
    }
    if (polyHitboxMeshRef.current?.geometry) {
      updateTubeVertices(
        polyHitboxMeshRef.current.geometry,
        livePolyCurve,
        32,
        0.26,
        6
      );
    }
  });

  return (
    <group>
      {/* ══════════════════════════════════════════════════════════════════
          SEGMENT 1 GROUP (Components 1-4):
          - Upper Chain locked through buoy keel pad eye
          - Inline ADCP instrument cage frame
          - 500m Inductive Cable with 9x Clamped CT Sensors
          - CTD Sensor at inductive cable base
          ══════════════════════════════════════════════════════════════════ */}
      <group ref={upperRiserRef}>
        {/* ── 1. UPPER MOORING CHAIN & TOP FAIRLEAD ATTACHMENT (At local [0, 0, 0]) ── */}
        <group
          position={[0, 0, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('upper_chain', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('upper_chain');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Upper Chain generous invisible hitbox */}
          <mesh
            position={[0, -0.35, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('upper_chain', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('upper_chain');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <cylinderGeometry args={[0.22, 0.22, 0.70, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* Top Heavy Marine Steel Bow Shackle interlocking through Buoy Keel Pad Eye */}
          <mesh position={[0, -0.02, 0]} castShadow>
            <torusGeometry args={[0.075, 0.022, 12, 24]} />
            <meshStandardMaterial
              color={isMatActive('upper_chain') ? '#38bdf8' : isSeg0Active ? '#38bdf8' : '#cbd5e1'}
              metalness={0.95}
              roughness={0.15}
              emissive={isMatActive('upper_chain') ? '#22d3ee' : isSeg0Active ? '#0284c7' : '#000000'}
              emissiveIntensity={isMatActive('upper_chain') ? 0.7 : isSeg0Active ? 0.6 : 0}
            />
          </mesh>
          {/* High-Strength Mooring Swivel Bearing Housing */}
          <mesh position={[0, -0.09, 0]} castShadow>
            <cylinderGeometry args={[0.055, 0.055, 0.12, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.25} />
          </mesh>
          {/* Galvanized Cable / Chain Thimble Loop */}
          <mesh position={[0, -0.17, 0]} castShadow>
            <torusGeometry args={[0.065, 0.020, 8, 16]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.2} />
          </mesh>

          {/* 10 Interlocking Stud-Link Chain Links connecting Keel to ADCP */}
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
            const y = -0.21 - i * 0.046;
            const isTurned = i % 2 === 1;
            return (
              <group key={`upper-chain-link-${i}`} position={[0, y, 0]}>
                <mesh rotation={[0, isTurned ? Math.PI / 2 : 0, 0]} castShadow>
                  <torusGeometry args={[0.048, 0.016, 8, 16]} />
                  <meshStandardMaterial
                    color={isMatActive('upper_chain') ? '#38bdf8' : isSeg0Active ? '#38bdf8' : isSeg0Hovered ? '#67e8f9' : '#64748b'}
                    metalness={0.92}
                    roughness={0.25}
                    emissive={isMatActive('upper_chain') ? '#22d3ee' : isSeg0Active ? '#0284c7' : '#000000'}
                    emissiveIntensity={isMatActive('upper_chain') ? 0.6 : isSeg0Active ? 0.5 : 0}
                  />
                </mesh>
                {/* Central Cross Stud Bar */}
                <mesh rotation={[Math.PI / 2, isTurned ? 0 : Math.PI / 2, 0]}>
                  <cylinderGeometry args={[0.010, 0.010, 0.064, 8]} />
                  <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.3} />
                </mesh>
              </group>
            );
          })}
        </group>

        {/* ── 2. INLINE ADCP INSTRUMENT LOAD CAGE & PROPER CLAMPING FRAME (Centered at Y = -1.15m) ── */}
        <group
          position={[0, -1.15, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('adcp', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('upper_chain');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* ADCP Cage generous invisible hitbox */}
          <mesh
            position={[0, 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('adcp', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('upper_chain');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <cylinderGeometry args={[0.26, 0.26, 1.15, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* ── Top Apex Assembly: Interlocking Bow Shackle, Swivel Bearing & Forged Apex Boss ── */}
          {/* Top Bow Shackle interlocking through bottom link of Upper Chain */}
          <mesh position={[0, 0.53, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[0.052, 0.016, 10, 20]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>
          {/* Top Swivel Eye Ring */}
          <mesh position={[0, 0.46, 0]} rotation={[0, 0, 0]} castShadow>
            <torusGeometry args={[0.042, 0.013, 8, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>
          {/* Top Marine Swivel Bearing Housing */}
          <mesh position={[0, 0.405, 0]} castShadow>
            <cylinderGeometry args={[0.040, 0.040, 0.070, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.25} />
          </mesh>
          {/* Forged Apex Tension Boss where top bridle struts converge */}
          <mesh position={[0, 0.355, 0]} castShadow>
            <cylinderGeometry args={[0.046, 0.046, 0.035, 16]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.95} roughness={0.18} />
          </mesh>

          {/* ── 4 Top Tension Bridle Struts converging from 4 top corners to top apex (Y = 0.35m) ── */}
          <ConnectingBar from={[0.12, 0.22, 0.12]} to={[0, 0.35, 0]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, 0.22, 0.12]} to={[0, 0.35, 0]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, 0.22, -0.12]} to={[0, 0.35, 0]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[0.12, 0.22, -0.12]} to={[0, 0.35, 0]} radius={0.012} color="#e2e8f0" />

          {/* ── Rigid Structural Cage Body (Width: 0.24m, Height: 0.44m, from Y = -0.22m to +0.22m) ── */}
          {/* Top Horizontal Perimeter Frame Bars at Y = +0.22m */}
          <ConnectingBar from={[0.12, 0.22, 0.12]} to={[-0.12, 0.22, 0.12]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, 0.22, 0.12]} to={[-0.12, 0.22, -0.12]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, 0.22, -0.12]} to={[0.12, 0.22, -0.12]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[0.12, 0.22, -0.12]} to={[0.12, 0.22, 0.12]} radius={0.012} color="#e2e8f0" />

          {/* Middle Horizontal Protective Perimeter Guard Bars at Y = 0.0m */}
          <ConnectingBar from={[0.12, 0.0, 0.12]} to={[-0.12, 0.0, 0.12]} radius={0.011} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, 0.0, 0.12]} to={[-0.12, 0.0, -0.12]} radius={0.011} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, 0.0, -0.12]} to={[0.12, 0.0, -0.12]} radius={0.011} color="#e2e8f0" />
          <ConnectingBar from={[0.12, 0.0, -0.12]} to={[0.12, 0.0, 0.12]} radius={0.011} color="#e2e8f0" />

          {/* Bottom Horizontal Perimeter Frame Bars at Y = -0.22m */}
          <ConnectingBar from={[0.12, -0.22, 0.12]} to={[-0.12, -0.22, 0.12]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, -0.22, 0.12]} to={[-0.12, -0.22, -0.12]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, -0.22, -0.12]} to={[0.12, -0.22, -0.12]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[0.12, -0.22, -0.12]} to={[0.12, -0.22, 0.12]} radius={0.012} color="#e2e8f0" />

          {/* 4 Heavy Vertical Corner Tubular Posts connecting from Y = -0.22m to +0.22m */}
          <ConnectingBar from={[0.12, -0.22, 0.12]} to={[0.12, 0.22, 0.12]} radius={0.013} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, -0.22, 0.12]} to={[-0.12, 0.22, 0.12]} radius={0.013} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, -0.22, -0.12]} to={[-0.12, 0.22, -0.12]} radius={0.013} color="#e2e8f0" />
          <ConnectingBar from={[0.12, -0.22, -0.12]} to={[0.12, 0.22, -0.12]} radius={0.013} color="#e2e8f0" />

          {/* ── 4 Bottom Tension Bridle Struts converging from 4 bottom corners to bottom apex (Y = -0.35m) ── */}
          <ConnectingBar from={[0.12, -0.22, 0.12]} to={[0, -0.35, 0]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, -0.22, 0.12]} to={[0, -0.35, 0]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[-0.12, -0.22, -0.12]} to={[0, -0.35, 0]} radius={0.012} color="#e2e8f0" />
          <ConnectingBar from={[0.12, -0.22, -0.12]} to={[0, -0.35, 0]} radius={0.012} color="#e2e8f0" />

          {/* ── Bottom Apex Assembly: Forged Boss, Swivel Bearing, Bow Shackle & Cable Socket ── */}
          {/* Forged Apex Tension Boss where bottom bridle struts converge */}
          <mesh position={[0, -0.355, 0]} castShadow>
            <cylinderGeometry args={[0.046, 0.046, 0.035, 16]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.95} roughness={0.18} />
          </mesh>
          {/* Bottom Marine Swivel Bearing Housing */}
          <mesh position={[0, -0.405, 0]} castShadow>
            <cylinderGeometry args={[0.040, 0.040, 0.070, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.25} />
          </mesh>
          {/* Bottom Swivel Eye Ring */}
          <mesh position={[0, -0.46, 0]} castShadow>
            <torusGeometry args={[0.042, 0.013, 8, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>
          {/* Bottom High-Strength Galvanized Bow Shackle */}
          <mesh position={[0, -0.52, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[0.052, 0.016, 10, 20]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>
          {/* Cable Termination Spelter Socket / Thimble Fitting connecting Inductive Cable */}
          <mesh position={[0, -0.58, 0]} castShadow>
            <cylinderGeometry args={[0.038, 0.024, 0.08, 16]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.92} roughness={0.2} />
          </mesh>

          {/* ── 3. INTERNAL ADCP SENSOR INSTRUMENT CANISTER (Centered inside load cage) ── */}
          <group position={[0, 0.01, 0]}>
            {/* Primary Anodized Titanium / Aluminum Pressure Housing */}
            <mesh castShadow>
              <cylinderGeometry args={[0.088, 0.088, 0.26, 24]} />
              <meshStandardMaterial color="#1e293b" metalness={0.88} roughness={0.22} />
            </mesh>
            {/* Top End Cap Machined Silver Retention Flange */}
            <mesh position={[0, 0.135, 0]}>
              <cylinderGeometry args={[0.092, 0.088, 0.015, 24]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
            </mesh>
            {/* Middle Identification Placard Band */}
            <mesh position={[0, 0.01, 0]}>
              <cylinderGeometry args={[0.089, 0.089, 0.045, 24]} />
              <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Lower Machined Seal Flange */}
            <mesh position={[0, -0.115, 0]}>
              <cylinderGeometry args={[0.092, 0.088, 0.015, 24]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
            </mesh>

            {/* Downward 4-Beam Janus Acoustic Transducer Head Assembly */}
            <mesh position={[0, -0.145, 0]} castShadow>
              <cylinderGeometry args={[0.094, 0.082, 0.050, 20]} />
              <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.4} metalness={0.7} roughness={0.25} />
            </mesh>
            {/* 4 Convex Transducer Ceramic Face Disks (at 20° Janus angle, 90° azimuth) */}
            {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, i) => (
              <mesh
                key={`transducer-face-${i}`}
                position={[Math.sin(ang) * 0.052, -0.170, Math.cos(ang) * 0.052]}
                rotation={[0.35 * Math.cos(ang), 0, -0.35 * Math.sin(ang)]}
              >
                <cylinderGeometry args={[0.024, 0.024, 0.008, 12]} />
                <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.6} />
              </mesh>
            ))}
            {/* Central Acoustic Transducer Status Telemetry LED */}
            <mesh position={[0, -0.175, 0]}>
              <sphereGeometry args={[0.008, 8, 8]} />
              <meshBasicMaterial color="#22d3ee" />
            </mesh>
          </group>

          {/* ══════════════════════════════════════════════════════════════════
              4. DUAL HEAVY SPLIT-COLLAR INSTRUMENT CLAMPING SYSTEM
              Securely clamping the ADCP instrument to the 4 vertical cage posts
              ══════════════════════════════════════════════════════════════════ */}
          {[0.08, -0.05].map((yClamp, clampIdx) => (
            <group key={`adcp-clamp-${clampIdx}`} position={[0, yClamp, 0]}>
              {/* Heavy Galvanized Split-Collar Clamping Ring Band */}
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <torusGeometry args={[0.094, 0.012, 10, 28]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
              </mesh>
              {/* Neoprene Vibration-Isolation Inner Protective Rubber Gasket */}
              <mesh>
                <cylinderGeometry args={[0.090, 0.090, 0.028, 24, 1, true]} />
                <meshStandardMaterial color="#090d16" roughness={0.85} />
              </mesh>

              {/* Clamping Split Ear Lugs with Clamping Bolts on Left & Right */}
              {[-0.100, 0.100].map((xLug, lIdx) => (
                <group key={`clamp-ear-${lIdx}`} position={[xLug, 0, 0]}>
                  {/* Forged clamping ear flange block */}
                  <mesh castShadow>
                    <boxGeometry args={[0.024, 0.030, 0.036]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
                  </mesh>
                  {/* High-Tensile Stainless Clamping Tension Bolt & Lock Nut */}
                  <mesh rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.006, 0.006, 0.042, 8]} />
                    <meshStandardMaterial color="#e2e8f0" metalness={0.95} roughness={0.15} />
                  </mesh>
                </group>
              ))}

              {/* 4 Heavy Structural Radial Mounting Gusset Struts welding Clamp to 4 Cage Corner Posts */}
              <ConnectingBar from={[0.068, 0, 0.068]} to={[0.12, 0, 0.12]} radius={0.009} color="#cbd5e1" />
              <ConnectingBar from={[-0.068, 0, 0.068]} to={[-0.12, 0, 0.12]} radius={0.009} color="#cbd5e1" />
              <ConnectingBar from={[-0.068, 0, -0.068]} to={[-0.12, 0, -0.12]} radius={0.009} color="#cbd5e1" />
              <ConnectingBar from={[0.068, 0, -0.068]} to={[0.12, 0, -0.12]} radius={0.009} color="#cbd5e1" />
            </group>
          ))}
        </group>

        {/* ── 3. 500m ARMORED INDUCTIVE WIRE ROPE CABLE (From Y = -1.74m to Y = -4.65m) ── */}
        <mesh
          position={[0, -3.195, 0]}
          castShadow
          receiveShadow
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('inductive_cable', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('inductive_cable');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <cylinderGeometry args={[isMatActive('inductive_cable') || isSeg0Active ? 0.034 : 0.024, isMatActive('inductive_cable') || isSeg0Active ? 0.034 : 0.024, 2.91, 16]} />
          <meshStandardMaterial
            color={isMatActive('inductive_cable') ? '#38bdf8' : isSeg0Active ? '#38bdf8' : isSeg0Hovered ? '#67e8f9' : '#94a3b8'}
            metalness={0.88}
            roughness={0.22}
            emissive={isMatActive('inductive_cable') ? '#22d3ee' : isSeg0Active ? '#22d3ee' : '#1e3a5f'}
            emissiveIntensity={isMatActive('inductive_cable') ? 0.8 : isSeg0Active ? 0.6 : 0.18}
          />
        </mesh>

        {/* Inductive Cable generous invisible hitbox */}
        <mesh
          position={[0, -3.195, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('inductive_cable', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('inductive_cable');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <cylinderGeometry args={[0.22, 0.22, 2.95, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* ── 9 CLAMPED CT SENSORS ALONG 500m INDUCTIVE CABLE ── */}
        {[-1.95, -2.25, -2.55, -2.85, -3.15, -3.45, -3.75, -4.05, -4.35].map((sensorY, idx) => (
          <group
            key={`ct-sensor-${idx}`}
            position={[0.052, sensorY, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('ct_sensor', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('inductive_cable');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            {/* White Titanium MicroCAT Pressure Housing */}
            <mesh castShadow>
              <cylinderGeometry args={[0.032, 0.032, 0.22, 12]} />
              <meshStandardMaterial color="#f8fafc" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Black Conductivity Cell Guard Tube */}
            <mesh position={[0, -0.13, 0]}>
              <cylinderGeometry args={[0.020, 0.020, 0.06, 8]} />
              <meshStandardMaterial color="#090d16" roughness={0.8} />
            </mesh>
            {/* Clamped Cable Mounting Collar Bracket */}
            <mesh position={[-0.045, 0.02, 0]}>
              <boxGeometry args={[0.045, 0.06, 0.045]} />
              <meshStandardMaterial color="#64748b" metalness={0.9} roughness={0.2} />
            </mesh>
            {/* Inductive Telemetry Status LED (Bright Cyan Indicator) */}
            <mesh position={[0.032, 0.06, 0]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshBasicMaterial color="#22d3ee" />
            </mesh>
          </group>
        ))}

        {/* ── 4. CTD SENSOR (At Base of Inductive Cable, Centered at Y = -4.75m) ── */}
        <group
          position={[0.055, -4.75, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('ctd_sensor', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('inductive_cable');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Sea-Bird SBE 37-IM CTD Primary Titanium Housing */}
          <mesh castShadow>
            <cylinderGeometry args={[0.042, 0.042, 0.32, 14]} />
            <meshStandardMaterial color="#f1f5f9" metalness={0.85} roughness={0.2} />
          </mesh>
          {/* Lower Conductivity & Temperature Flow Cell */}
          <mesh position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.026, 0.026, 0.08, 10]} />
            <meshStandardMaterial color="#0f172a" roughness={0.7} />
          </mesh>
          {/* Dual Stainless Steel Cable Mounting Clamp Straps */}
          <mesh position={[-0.055, 0.08, 0]}>
            <boxGeometry args={[0.05, 0.04, 0.05]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
          </mesh>
          <mesh position={[-0.055, -0.08, 0]}>
            <boxGeometry args={[0.05, 0.04, 0.05]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
          </mesh>
          {/* Status Telemetry Indicator LED */}
          <mesh position={[0.044, 0.10, 0]}>
            <sphereGeometry args={[0.014, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        </group>

        {/* Cable Termination Hardware Link (Spelter Socket & Dual Bow Shackles to Nylon Rope) */}
        <group position={[0, -5.02, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.12, 12]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
          </mesh>
          <mesh position={[0, -0.08, 0]} castShadow>
            <torusGeometry args={[0.058, 0.018, 8, 16]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.2} />
          </mesh>
        </group>

        {/* Segment 1 Glowing Indicator at Midpoint */}
        {isSeg0Active && (
          <group position={[0, -2.8, 0]}>
            <mesh>
              <sphereGeometry args={[0.32, 16, 16]} />
              <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.6} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.36, 0.44, 28]} />
              <meshBasicMaterial color="#22d3ee" side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          SEGMENT 2 GROUP (Components 5-7):
          - Compliant Nylon Rope S-Loop U-Bend
          - Trawl Float in Net (Buoyancy Cluster Pulling UP at Apex)
          - Deep Polypropylene Rope
          ══════════════════════════════════════════════════════════════════ */}
      <group>
        {/* ── 5. COMPLIANT NYLON ROPE S-LOOP (Dynamic U-Bend Flexing with Waves) ── */}
        <mesh
          ref={nylonRopeMeshRef}
          castShadow
          receiveShadow
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('nylon_rope', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('nylon_rope');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <tubeGeometry args={[initialNylonCurve, 32, isMatActive('nylon_rope') || isSeg1Active ? 0.052 : 0.038, 8, false]} />
          <meshStandardMaterial
            color={isMatActive('nylon_rope') ? '#38bdf8' : isSeg1Active ? '#38bdf8' : isSeg1Hovered ? '#67e8f9' : '#0ea5e9'}
            roughness={0.45}
            metalness={0.20}
            emissive={isMatActive('nylon_rope') ? '#22d3ee' : isSeg1Active ? '#06b6d4' : '#0369a1'}
            emissiveIntensity={isMatActive('nylon_rope') ? 0.8 : isSeg1Active ? 0.6 : 0.22}
          />
        </mesh>

        {/* Generous invisible hitbox tube for compliant nylon rope (26cm hit radius!) */}
        <mesh
          ref={nylonHitboxMeshRef}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('nylon_rope', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('nylon_rope');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <tubeGeometry args={[initialNylonCurve, 32, 0.26, 6, false]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* ── 6. TRAWL FLOAT IN NET (SUBSURFACE BUOYANCY CLUSTER PULLING UPWARD AT APEX) ── */}
        <group
          ref={trawlFloatRef}
          position={[initialKeelPos.x + floatOffset.x, -6.30, initialKeelPos.z + floatOffset.z]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('trawl_float', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('trawl_float');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Trawl Float generous invisible hitbox capsule */}
          <mesh
            position={[0, 0.815, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('trawl_float', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('trawl_float');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <capsuleGeometry args={[0.30, 1.35, 8, 16]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* ── A. Bottom Junction & Bridle Attachment (At Y = 0 to 0.14) ── */}
          {/* Three-way forged junction plate connecting Nylon S-Loop, Polypropylene Rope and Trawl Float Tether */}
          <mesh position={[0, 0.015, 0]} castShadow>
            <cylinderGeometry args={[0.044, 0.044, 0.030, 16]} />
            <meshStandardMaterial
              color={isSeg1Active ? '#38bdf8' : '#cbd5e1'}
              metalness={0.95}
              roughness={0.18}
              emissive={isSeg1Active ? '#0284c7' : '#000000'}
              emissiveIntensity={isSeg1Active ? 0.4 : 0}
            />
          </mesh>
          {/* Heavy Galvanized Marine Bow Shackle */}
          <mesh position={[0, 0.045, 0]} castShadow>
            <torusGeometry args={[0.046, 0.014, 8, 16]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.2} />
          </mesh>
          {/* High-Tensile Stainless Steel Vertical Bridle Line */}
          <mesh position={[0, 0.085, 0]} castShadow>
            <cylinderGeometry args={[0.010, 0.010, 0.065, 12]} />
            <meshStandardMaterial color="#64748b" metalness={0.90} roughness={0.25} />
          </mesh>
          {/* Lower Gather Collar / Thimble Eye */}
          <mesh position={[0, 0.125, 0]} castShadow>
            <cylinderGeometry args={[0.038, 0.038, 0.030, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>
          <mesh position={[0, 0.115, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[0.032, 0.010, 8, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>

          {/* ── B. Continuous Sleek Capsule Buoyancy Package (Y = 0.14 to 1.49, Center = 0.815) ── */}
          {/* 1. Translucent Protective Rose/Pink Polymer Sleeve */}
          <mesh position={[0, 0.815, 0]} castShadow>
            <capsuleGeometry args={[0.134, 1.08, 16, 32]} />
            <meshStandardMaterial
              color={isSeg1Active ? '#fda4af' : '#fb7185'}
              roughness={0.22}
              metalness={0.08}
              transparent
              opacity={0.62}
              emissive="#be185d"
              emissiveIntensity={isSeg1Active ? 0.45 : 0.28}
            />
          </mesh>

          {/* 2. Form-Fitting Diamond Netting Sleeve wrapping around the Capsule */}
          <mesh position={[0, 0.815, 0]}>
            <capsuleGeometry args={[0.137, 1.08, 16, 32]} />
            <meshStandardMaterial
              map={netTexture}
              color="#ffffff"
              transparent
              opacity={0.92}
              alphaTest={0.04}
              roughness={0.55}
            />
          </mesh>

          {/* 3. 4x Vertical Structural Netting Rib Ropes along Cardinal Axes */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, i) => (
            <mesh
              key={`trawl-rib-${i}`}
              position={[Math.sin(ang) * 0.137, 0.815, Math.cos(ang) * 0.137]}
            >
              <cylinderGeometry args={[0.005, 0.005, 1.10, 8]} />
              <meshStandardMaterial color="#831843" roughness={0.7} />
            </mesh>
          ))}

          {/* 4. Internal Stainless Steel Center Rigging Spine Wire */}
          <mesh position={[0, 0.815, 0]}>
            <cylinderGeometry args={[0.005, 0.005, 1.25, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.25} />
          </mesh>

          {/* ── C. Stack of 6 Spherical Deep-Sea Trawl Floats inside the Capsule ── */}
          {[0.275, 0.491, 0.707, 0.923, 1.139, 1.355].map((yCenter, sIdx) => (
            <group key={`trawl-sphere-${sIdx}`} position={[0, yCenter, 0]}>
              {/* Molded High-Impact Polymer Spherical Body */}
              <mesh castShadow>
                <sphereGeometry args={[0.118, 28, 20]} />
                <meshStandardMaterial
                  color="#f43f5e"
                  roughness={0.28}
                  metalness={0.12}
                  emissive="#e11d48"
                  emissiveIntensity={isSeg1Active ? 0.38 : 0.22}
                />
              </mesh>
              {/* Equatorial Mold Seam Rib */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.119, 0.005, 6, 28]} />
                <meshStandardMaterial color="#be123c" roughness={0.35} />
              </mesh>
              {/* Central Through-Hole Core Boss */}
              <mesh>
                <cylinderGeometry args={[0.018, 0.018, 0.23, 12]} />
                <meshStandardMaterial color="#9f1239" roughness={0.4} />
              </mesh>
            </group>
          ))}

          {/* ── D. 5x Waist Cinch Bands & Lateral White Eyelet Grommets (Authentic Schematic Markers) ── */}
          {[0.383, 0.599, 0.815, 1.031, 1.247].map((yWaist, wIdx) => (
            <group key={`trawl-cinch-${wIdx}`} position={[0, yWaist, 0]}>
              {/* Circumferential Cinch Cord Ring */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.136, 0.006, 8, 32]} />
                <meshStandardMaterial color="#9d174d" roughness={0.6} />
              </mesh>

              {/* Lateral White Eyelet Grommets (Visible in schematic profile) */}
              {/* Left Eyelet (-X) */}
              <mesh position={[-0.143, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <torusGeometry args={[0.020, 0.005, 8, 16]} />
                <meshStandardMaterial
                  color="#f8fafc"
                  metalness={0.75}
                  roughness={0.2}
                  emissive="#f8fafc"
                  emissiveIntensity={0.25}
                />
              </mesh>
              {/* Right Eyelet (+X) */}
              <mesh position={[0.143, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <torusGeometry args={[0.020, 0.005, 8, 16]} />
                <meshStandardMaterial
                  color="#f8fafc"
                  metalness={0.75}
                  roughness={0.2}
                  emissive="#f8fafc"
                  emissiveIntensity={0.25}
                />
              </mesh>

              {/* Front Eyelet (+Z) */}
              <mesh position={[0, 0, 0.143]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <torusGeometry args={[0.020, 0.005, 8, 16]} />
                <meshStandardMaterial
                  color="#f8fafc"
                  metalness={0.75}
                  roughness={0.2}
                  emissive="#f8fafc"
                  emissiveIntensity={0.25}
                />
              </mesh>
              {/* Back Eyelet (-Z) */}
              <mesh position={[0, 0, -0.143]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <torusGeometry args={[0.020, 0.005, 8, 16]} />
                <meshStandardMaterial
                  color="#f8fafc"
                  metalness={0.75}
                  roughness={0.2}
                  emissive="#f8fafc"
                  emissiveIntensity={0.25}
                />
              </mesh>

              {/* Lacing Tie Knots Securing Eyelets to Cinch Band */}
              {[-0.136, 0.136].map((xPos, kIdx) => (
                <mesh key={`cinch-knot-x-${kIdx}`} position={[xPos, 0, 0]}>
                  <sphereGeometry args={[0.008, 8, 8]} />
                  <meshStandardMaterial color="#f1f5f9" roughness={0.4} />
                </mesh>
              ))}
              {[-0.136, 0.136].map((zPos, kIdx) => (
                <mesh key={`cinch-knot-z-${kIdx}`} position={[0, 0, zPos]}>
                  <sphereGeometry args={[0.008, 8, 8]} />
                  <meshStandardMaterial color="#f1f5f9" roughness={0.4} />
                </mesh>
              ))}
            </group>
          ))}

          {/* ── E. Top Crown Hardware (At Y = 1.49 to 1.58) ── */}
          {/* Top Gathered Crown Collar */}
          <mesh position={[0, 1.50, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.035, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
          </mesh>
          {/* Top Galvanized Marine Lifting Bow Shackle */}
          <mesh position={[0, 1.54, 0]} castShadow>
            <torusGeometry args={[0.046, 0.014, 8, 16]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.2} />
          </mesh>
        </group>

        {/* ── 7. DEEP POLYPROPYLENE ROPE (From Float Base Down to Glass Spheres) ── */}
        <mesh
          ref={polyRopeMeshRef}
          castShadow
          receiveShadow
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('polypropylene_rope', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('polypropylene_rope');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <tubeGeometry args={[initialPolyCurve, 32, isMatActive('polypropylene_rope') || isSeg1Active ? 0.050 : 0.036, 8, false]} />
          <meshStandardMaterial
            color={isMatActive('polypropylene_rope') ? '#38bdf8' : isSeg1Active ? '#38bdf8' : isSeg1Hovered ? '#67e8f9' : '#0284c7'}
            roughness={0.45}
            metalness={0.20}
            emissive={isMatActive('polypropylene_rope') ? '#22d3ee' : isSeg1Active ? '#0891b2' : '#025380'}
            emissiveIntensity={isMatActive('polypropylene_rope') ? 0.8 : isSeg1Active ? 0.6 : 0.22}
          />
        </mesh>

        {/* Generous invisible hitbox tube for polypropylene rope (26cm hit radius!) */}
        <mesh
          ref={polyHitboxMeshRef}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('polypropylene_rope', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('polypropylene_rope');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <tubeGeometry args={[initialPolyCurve, 32, 0.26, 6, false]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* Segment 2 Glowing Indicator at Midpoint */}
        {isSeg1Active && masterCurve && (
          <group position={masterCurve.getPointAt(0.42).toArray()}>
            <mesh>
              <sphereGeometry args={[0.32, 16, 16]} />
              <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.6} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.36, 0.44, 28]} />
              <meshBasicMaterial color="#22d3ee" side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}
      </group>

      {/* ══════════════════════════════════════════════════════════════════
          SEGMENT 3 GROUP (Components 8-11):
          - Vertical cluster of 3 yellow glass spheres in hardhats
          - Dual acoustic release transponder in purple housing
          - Heavy ground chain
          - 2,000 kg Segmented dead weight bottom weight
          ══════════════════════════════════════════════════════════════════ */}
      <group>
        {/* ── SEABED TACKLE ASSEMBLY (Components 8-10 + Anchor Bow Shackle) ── */}
        {/* Pivots cleanly at the anchor pin [0, -17.115, 0] atop the bottom weight clump sinker */}
        <group ref={seabedTackleRef} position={[0, -17.115, 0]}>
        {/* Anchor Bow Shackle (Pivoting at the clamping pin atop bottom weight) */}
        <group position={[0, 0.070, 0]}>
          <mesh castShadow>
            <torusGeometry args={[0.065, 0.018, 10, 20]} />
            <meshStandardMaterial
              color={isSeg2Active ? '#38bdf8' : '#cbd5e1'}
              metalness={0.95}
              roughness={0.18}
              emissive={isSeg2Active ? '#38bdf8' : '#000000'}
              emissiveIntensity={isSeg2Active ? 0.3 : 0}
            />
          </mesh>
        </group>

        {/* ── 10. HEAVY STUD-LINK GROUND CHAIN (Non-Clipping, Physically Linked local Y = 0.147 to 0.455m) ── */}
        <group
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('ground_chain', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('ground_chain');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Ground Chain generous invisible hitbox */}
          <mesh
            position={[0, 0.295, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('ground_chain', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('ground_chain');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <cylinderGeometry args={[0.22, 0.22, 0.45, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            // Exactly 8 links spanning from drop link at local 0.455m down to anchor bow shackle crown at 0.135m
            const y = 0.455 - i * 0.044;
            const isTurned = i % 2 === 1;
            return (
              <group key={`ground-chain-link-${i}`} position={[0, y, 0]}>
                {/* Stud-Link Chain Torus Body */}
                <mesh rotation={[0, isTurned ? Math.PI / 2 : 0, 0]} castShadow>
                  <torusGeometry args={[0.042, 0.014, 8, 16]} />
                  <meshStandardMaterial
                    color={isMatActive('ground_chain') ? '#38bdf8' : isSeg2Active ? '#38bdf8' : isSeg2Hovered ? '#67e8f9' : '#64748b'}
                    metalness={0.92}
                    roughness={0.25}
                    emissive={isMatActive('ground_chain') ? '#22d3ee' : isSeg2Active ? '#475569' : '#000000'}
                    emissiveIntensity={isMatActive('ground_chain') ? 0.7 : isSeg2Active ? 0.4 : 0}
                  />
                </mesh>
                {/* Central Cross Stud Bar */}
                <mesh rotation={[Math.PI / 2, isTurned ? 0 : Math.PI / 2, 0]}>
                  <cylinderGeometry args={[0.009, 0.009, 0.056, 8]} />
                  <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.3} />
                </mesh>
              </group>
            );
          })}
        </group>

        {/* ── 9. INLINE DUAL ACOUSTIC RELEASE TRANSPONDER (Centered at local Y = 0.965m) ── */}
        <group
          position={[0, 0.965, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('acoustic_release', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('acoustic_release');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Acoustic Release generous invisible hitbox */}
          <mesh
            position={[0, 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('acoustic_release', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('acoustic_release');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <cylinderGeometry args={[0.25, 0.25, 1.15, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* Top Shackle Connection Ring to Glass Spheres */}
          <mesh position={[0, 0.48, 0]}>
            <torusGeometry args={[0.055, 0.016, 8, 16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.95} />
          </mesh>
          {/* Top Acoustic Communication Transducer Head */}
          <mesh position={[0, 0.40, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.075, 0.12, 16]} />
            <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.35} metalness={0.7} roughness={0.25} />
          </mesh>

          {/* Acoustic Release High-Pressure Cylindrical Canister Body in Deep Purple */}
          <mesh castShadow>
            <cylinderGeometry args={[0.085, 0.085, 0.72, 20]} />
            <meshStandardMaterial
              color="#7c3aed"
              metalness={0.55}
              roughness={0.25}
              emissive="#6d28d9"
              emissiveIntensity={isSeg2Active ? 0.45 : 0.22}
            />
          </mesh>

          {/* Dual Split-Collar Heavy Mounting Clamps with Bolted Ear Flanges */}
          {[-0.20, 0.20].map((yOff, i) => (
            <group key={`release-clamp-${i}`} position={[0, yOff, 0]}>
              {/* Clamping Collar Band around Canister */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.089, 0.010, 8, 28]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.92} roughness={0.25} />
              </mesh>
              {/* Left and Right Clamping Ear Lugs with Clamping Bolts */}
              {[-0.098, 0.098].map((xLug, lIdx) => (
                <group key={`rel-lug-${lIdx}`} position={[xLug, 0, 0]}>
                  <mesh castShadow>
                    <boxGeometry args={[0.018, 0.024, 0.028]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
                  </mesh>
                  <mesh rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.005, 0.005, 0.034, 8]} />
                    <meshStandardMaterial color="#e2e8f0" metalness={0.95} roughness={0.15} />
                  </mesh>
                </group>
              ))}
            </group>
          ))}

          {/* Sacrificial Zinc Anode Collars */}
          {[-0.30, 0.30].map((yOff, i) => (
            <mesh key={`anode-${i}`} position={[0, yOff, 0]}>
              <cylinderGeometry args={[0.092, 0.092, 0.035, 16]} />
              <meshStandardMaterial color="#64748b" metalness={0.80} roughness={0.4} />
            </mesh>
          ))}

          {/* Bottom Release Mechanism Housing & Hinged Drop Hook */}
          <group position={[0, -0.42, 0]}>
            {/* Lower Transducer Housing Boss */}
            <mesh position={[0, 0.02, 0]} castShadow>
              <cylinderGeometry args={[0.065, 0.055, 0.06, 16]} />
              <meshStandardMaterial color="#334155" metalness={0.90} roughness={0.25} />
            </mesh>
            {/* Forged Release Jaw Block */}
            <mesh position={[0, -0.035, 0]} castShadow>
              <boxGeometry args={[0.075, 0.060, 0.065]} />
              <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.2} />
            </mesh>
            {/* Hinged Titanium Drop Hook */}
            <mesh position={[0, -0.075, 0]} rotation={[0, 0, 0]} castShadow>
              <torusGeometry args={[0.048, 0.014, 10, 20, Math.PI * 1.35]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.15} />
            </mesh>
            {/* Forged Drop Link Ring (Connecting to top link of ground chain at local Y = 0.42m) */}
            <mesh position={[0, -0.125, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
              <torusGeometry args={[0.042, 0.013, 8, 16]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
            </mesh>
          </group>
        </group>

        {/* ── 8. EXACT VERTICAL STACK OF 3 YELLOW GLASS SPHERES (Local Y = 1.715 to 2.515m) ── */}
        <group
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('glass_spheres', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('glass_spheres');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Glass Spheres generous invisible hitbox */}
          <mesh
            position={[0, 2.115, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('glass_spheres', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('glass_spheres');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <cylinderGeometry args={[0.35, 0.35, 1.35, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {[1.715, 2.115, 2.515].map((sphereY, idx) => (
            <group key={`glass-sphere-${idx}`} position={[0, sphereY, 0]}>
              {/* Yellow Spherical Glass Float in Protective Hardhat Casing */}
              <mesh castShadow>
                <sphereGeometry args={[0.20, 24, 24]} />
                <meshStandardMaterial
                  color="#facc15"
                  roughness={0.30}
                  metalness={0.22}
                  emissive={isMatActive('glass_spheres') ? '#eab308' : '#ca8a04'}
                  emissiveIntensity={isMatActive('glass_spheres') ? 0.85 : isSeg2Active ? 0.45 : 0.28}
                />
              </mesh>
              {/* Equatorial Ribbed Protective Hardhat Rim */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.205, 0.024, 8, 24]} />
                <meshStandardMaterial color="#eab308" roughness={0.38} />
              </mesh>
            </group>
          ))}
        </group>

        {/* Chain section running through glass spheres */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const y = 2.665 - i * 0.14;
          const isTurned = i % 2 === 1;
          return (
            <group key={`glass-chain-link-${i}`} position={[0, y, 0]}>
              <mesh rotation={[0, isTurned ? Math.PI / 2 : 0, 0]} castShadow>
                <torusGeometry args={[0.045, 0.015, 8, 16]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.2} />
              </mesh>
            </group>
          );
        })}
      </group>

        {/* ── 11. COMPONENT 11: SEGMENTED CLUMP DEAD WEIGHT & HEAVY ANCHOR CLAMP BRACKET (At Y = -18.0m) ── */}
        <group
          position={[0, -18.0, 0]}
          onClick={(e) => {
            e.stopPropagation();
            onInspectPart?.('bottom_weight', [e.point.x, e.point.y, e.point.z]);
            onSelectMaterial?.('bottom_weight');
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          {/* Bottom Weight generous invisible hitbox */}
          <mesh
            position={[0, 0.38, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onInspectPart?.('bottom_weight', [e.point.x, e.point.y, e.point.z]);
              onSelectMaterial?.('bottom_weight');
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <cylinderGeometry args={[0.90, 0.90, 0.85, 16]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* 6 Heavy Segmented Stacked Circular Plates of Cast Iron Ballast in Weathered Rust Finish */}
          {[0.06, 0.18, 0.30, 0.42, 0.54, 0.66].map((py, pidx) => (
            <mesh key={`sinker-plate-${pidx}`} position={[0, py, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.75, 0.75, 0.110, 36]} />
              <meshStandardMaterial
                color={isMatActive('bottom_weight') ? '#38bdf8' : isSeg2Active ? '#a16207' : '#9a3412'}
                metalness={0.72}
                roughness={0.52}
                emissive={isMatActive('bottom_weight') ? '#0284c7' : isSeg2Active ? '#451a03' : '#291206'}
                emissiveIntensity={isMatActive('bottom_weight') ? 0.65 : isSeg2Active ? 0.35 : 0.15}
              />
            </mesh>
          ))}

          {/* Top Heavy Steel Retention Flange Plate */}
          <mesh position={[0, 0.735, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.775, 0.775, 0.040, 36]} />
            <meshStandardMaterial color="#1e293b" metalness={0.90} roughness={0.3} />
          </mesh>

          {/* 3 Heavy Circumferential Clamping Steel Bands with Forged Clamping Ears & Tension Bolts */}
          {[0.18, 0.42, 0.60].map((by, bidx) => (
            <group key={`sinker-band-group-${bidx}`} position={[0, by, 0]}>
              {/* Steel Circumferential Band */}
              <mesh castShadow>
                <cylinderGeometry args={[0.768, 0.768, 0.045, 36]} />
                <meshStandardMaterial color="#0f172a" metalness={0.92} roughness={0.25} />
              </mesh>
              {/* Opposing Clamping Ear Flanges with Heavy Clamping Bolts (Left & Right) */}
              {[-0.772, 0.772].map((xClamp, cIdx) => (
                <group key={`band-clamp-${cIdx}`} position={[xClamp, 0, 0]}>
                  {/* Heavy Forged Clamping Flange Block */}
                  <mesh castShadow>
                    <boxGeometry args={[0.036, 0.052, 0.055]} />
                    <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.2} />
                  </mesh>
                  {/* High-Tensile Clamping Tension Bolt & Hex Nut */}
                  <mesh rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.010, 0.010, 0.065, 8]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
                  </mesh>
                </group>
              ))}
            </group>
          ))}

          {/* 4 Vertical High-Tensile Clamping Tie-Rods with Heavy Clamping Lock Nuts */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((ang, tIdx) => {
            const rx = Math.sin(ang) * 0.68;
            const rz = Math.cos(ang) * 0.68;
            return (
              <group key={`tie-rod-${tIdx}`} position={[rx, 0, rz]}>
                {/* Vertical Steel Tie-Rod */}
                <mesh position={[0, 0.37, 0]} castShadow>
                  <cylinderGeometry args={[0.014, 0.014, 0.74, 8]} />
                  <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.25} />
                </mesh>
                {/* Top Heavy Clamping Washer */}
                <mesh position={[0, 0.758, 0]}>
                  <cylinderGeometry args={[0.034, 0.034, 0.008, 16]} />
                  <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
                </mesh>
                {/* Top Heavy Hex Clamping Lock Nut */}
                <mesh position={[0, 0.774, 0]} castShadow>
                  <cylinderGeometry args={[0.024, 0.024, 0.024, 6]} />
                  <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
                </mesh>
              </group>
            );
          })}

          {/* 4 Heavy Crane Handling Pad Eyes with Welded Triangular Reinforcement Gusset Plates */}
          {[Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].map((ang, idx) => {
            const px = Math.sin(ang) * 0.56;
            const pz = Math.cos(ang) * 0.56;
            return (
              <group key={`corner-pad-eye-${idx}`} position={[px, 0.755, pz]} rotation={[0, -ang, 0]}>
                {/* Welded Base Plate */}
                <mesh position={[0, 0.006, 0]}>
                  <boxGeometry args={[0.10, 0.012, 0.08]} />
                  <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.3} />
                </mesh>
                {/* Triangular Gusset Support Stiffeners */}
                <mesh position={[0, 0.04, -0.028]}>
                  <boxGeometry args={[0.014, 0.06, 0.024]} />
                  <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.25} />
                </mesh>
                {/* Forged Pad Eye Ring */}
                <mesh position={[0, 0.055, 0]} castShadow>
                  <torusGeometry args={[0.045, 0.015, 8, 16]} />
                  <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.2} />
                </mesh>
              </group>
            );
          })}

          {/* ══════════════════════════════════════════════════════════════════
              CENTRAL HEAVY ANCHOR CLAMPING BRACKET & BOW SHACKLE ASSEMBLY
              (Positioned atop the clump weight from Y = 0.755m to 1.02m)
              ══════════════════════════════════════════════════════════════════ */}
          <group position={[0, 0.755, 0]}>
            {/* 1. Heavy Forged Base Clamping Mounting Plate */}
            <mesh position={[0, 0.015, 0]} castShadow>
              <boxGeometry args={[0.34, 0.030, 0.30]} />
              <meshStandardMaterial color="#1e293b" metalness={0.92} roughness={0.25} />
            </mesh>

            {/* 4 Corner Heavy Clamping Mounting Bolts */}
            {[-0.13, 0.13].map((bx, bxi) =>
              [-0.11, 0.11].map((bz, bzi) => (
                <group key={`anchor-bolt-${bxi}-${bzi}`} position={[bx, 0.035, bz]}>
                  <mesh castShadow>
                    <cylinderGeometry args={[0.014, 0.014, 0.018, 6]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
                  </mesh>
                </group>
              ))
            )}

            {/* 2. Twin Heavy Vertical Forged Clamping Cheek Plates (Jaws) */}
            {[-0.048, 0.048].map((xCheek, cIdx) => (
              <group key={`clamp-cheek-${cIdx}`} position={[xCheek, 0.105, 0]}>
                {/* Cheek Jaw Plate */}
                <mesh castShadow>
                  <boxGeometry args={[0.026, 0.155, 0.180]} />
                  <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.2} />
                </mesh>
                {/* Triangular Outer Reinforcement Gusset Stiffener */}
                <mesh position={[cIdx === 0 ? -0.032 : 0.032, -0.025, 0]} rotation={[0, 0, cIdx === 0 ? 0.35 : -0.35]}>
                  <boxGeometry args={[0.016, 0.095, 0.140]} />
                  <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.3} />
                </mesh>
                {/* Machined Pin Eye Boss Ring */}
                <mesh position={[0, 0.025, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.040, 0.040, 0.030, 16]} />
                  <meshStandardMaterial color="#475569" metalness={0.95} roughness={0.18} />
                </mesh>
              </group>
            ))}

            {/* 3. High-Tensile Forged Clamping Pin passing through Cheeks at Y = 0.13m */}
            <group position={[0, 0.130, 0]}>
              {/* Clamping Pin Shaft */}
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.022, 0.022, 0.170, 16]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
              </mesh>
              {/* Left Oversized Forged Hex Bolt Head */}
              <mesh position={[-0.092, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.034, 0.034, 0.022, 6]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
              </mesh>
              {/* Right Heavy Slotted Safety Lock Nut & Split Cotter Pin */}
              <mesh position={[0.092, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.032, 0.032, 0.022, 6]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.15} />
              </mesh>
              <mesh position={[0.106, 0, 0]}>
                <cylinderGeometry args={[0.005, 0.005, 0.065, 8]} />
                <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.1} />
              </mesh>
            </group>

          </group>
        </group>

        {/* Segment 3 Glowing Indicator at Midpoint */}
        {isSeg2Active && masterCurve && (
          <group position={masterCurve.getPointAt(0.92).toArray()}>
            <mesh>
              <sphereGeometry args={[0.32, 16, 16]} />
              <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.6} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.36, 0.44, 28]} />
              <meshBasicMaterial color="#22d3ee" side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            3D REALTIME TENSION TELEMETRY BADGES & DYNAMIC PULL FORCE VECTORS
            ══════════════════════════════════════════════════════════════════ */}
        {showTensionBadges && (
          <>
            {/* 1. Fairlead Tension Pull Force Vector Arrow */}
            <group ref={fairleadVectorRef}>
              <mesh position={[0, -0.38, 0]}>
                <cylinderGeometry args={[0.012, 0.012, 0.70, 8]} />
                <meshBasicMaterial
                  color={
                    buoyState.fairleadTension_kN > 60 ? '#ef4444' :
                    buoyState.fairleadTension_kN > 35 ? '#f59e0b' :
                    '#22d3ee'
                  }
                  transparent
                  opacity={0.85}
                />
              </mesh>
              <mesh position={[0, -0.78, 0]} rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.042, 0.14, 12]} />
                <meshBasicMaterial
                  color={
                    buoyState.fairleadTension_kN > 60 ? '#ef4444' :
                    buoyState.fairleadTension_kN > 35 ? '#f59e0b' :
                    '#22d3ee'
                  }
                />
              </mesh>
            </group>

            {/* Floating Fairlead Tension Badge */}
            <group ref={fairleadTensionRef}>
              <Html center distanceFactor={14} zIndexRange={[500, 0]}>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    if (liveMotionRef?.current) {
                      const k = liveMotionRef.current.keelPosition;
                      onInspectPart?.('upper_chain', [k.x, k.y, k.z]);
                    }
                    onSelectMaterial?.('upper_chain');
                  }}
                  style={{
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    background: 'rgba(2, 8, 23, 0.90)',
                    border: `1px solid ${
                      buoyState.fairleadTension_kN > 60 ? '#ef4444' :
                      buoyState.fairleadTension_kN > 35 ? '#f59e0b' :
                      'rgba(34, 211, 238, 0.6)'
                    }`,
                    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.85), 0 0 12px rgba(34, 211, 238, 0.25)',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1.0)')}
                  title="Click to inspect Fairlead Upper Chain tension & load"
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background:
                        buoyState.fairleadTension_kN > 60 ? '#ef4444' :
                        buoyState.fairleadTension_kN > 35 ? '#f59e0b' :
                        '#22d3ee',
                      boxShadow: `0 0 8px ${
                        buoyState.fairleadTension_kN > 60 ? '#ef4444' :
                        buoyState.fairleadTension_kN > 35 ? '#f59e0b' :
                        '#22d3ee'
                      }`,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '7px', color: '#94a3b8', lineHeight: 1 }}>
                      FAIRLEAD TENSION
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                      {buoyState.fairleadTension_kN}{' '}
                      <span style={{ fontSize: '7.5px', color: '#38bdf8' }}>kN</span>
                    </div>
                  </div>
                </div>
              </Html>
            </group>

            {/* 2. Floating Mid-span S-Loop Tension Badge */}
            <group ref={midspanTensionRef}>
              <Html center distanceFactor={14} zIndexRange={[500, 0]}>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    if (trawlFloatRef.current) {
                      const p = trawlFloatRef.current.position;
                      onInspectPart?.('nylon_rope', [p.x, p.y, p.z]);
                    }
                    onSelectMaterial?.('nylon_rope');
                  }}
                  style={{
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    background: 'rgba(2, 8, 23, 0.90)',
                    border: '1px solid rgba(56, 189, 248, 0.55)',
                    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.85), 0 0 12px rgba(56, 189, 248, 0.25)',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1.0)')}
                  title="Click to inspect Compliant Nylon S-Loop tension & load"
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#38bdf8',
                      boxShadow: '0 0 8px #38bdf8',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '7px', color: '#94a3b8', lineHeight: 1 }}>
                      S-LOOP TENSION
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                      {Math.round((buoyState.fairleadTension_kN * 0.76 + buoyState.anchorTension_kN * 0.24) * 10) / 10}{' '}
                      <span style={{ fontSize: '7.5px', color: '#38bdf8' }}>kN</span>
                    </div>
                  </div>
                </div>
              </Html>
            </group>

            {/* 3. Seabed Anchor Uplift Force Vector Arrow */}
            <group ref={anchorVectorRef}>
              <mesh position={[0, 0.35, 0]}>
                <cylinderGeometry args={[0.012, 0.012, 0.65, 8]} />
                <meshBasicMaterial
                  color={
                    buoyState.anchorTension_kN > 40 ? '#ef4444' :
                    buoyState.anchorTension_kN > 22 ? '#f59e0b' :
                    '#34d399'
                  }
                  transparent
                  opacity={0.85}
                />
              </mesh>
              <mesh position={[0, 0.72, 0]}>
                <coneGeometry args={[0.042, 0.14, 12]} />
                <meshBasicMaterial
                  color={
                    buoyState.anchorTension_kN > 40 ? '#ef4444' :
                    buoyState.anchorTension_kN > 22 ? '#f59e0b' :
                    '#34d399'
                  }
                />
              </mesh>
            </group>

            {/* Floating Seabed Anchor Tension Badge */}
            <group ref={anchorTensionRef}>
              <Html center distanceFactor={14} zIndexRange={[500, 0]}>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectPart?.('ground_chain', [0, -17.115, 0]);
                    onSelectMaterial?.('ground_chain');
                  }}
                  style={{
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    background: 'rgba(2, 8, 23, 0.90)',
                    border: '1px solid rgba(52, 211, 153, 0.55)',
                    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.85), 0 0 12px rgba(52, 211, 153, 0.25)',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1.0)')}
                  title="Click to inspect Seabed Ground Chain & Sinker holding tension"
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background:
                        buoyState.anchorTension_kN > 40 ? '#ef4444' :
                        buoyState.anchorTension_kN > 22 ? '#f59e0b' :
                        '#34d399',
                      boxShadow: `0 0 8px ${
                        buoyState.anchorTension_kN > 40 ? '#ef4444' :
                        buoyState.anchorTension_kN > 22 ? '#f59e0b' :
                        '#34d399'
                      }`,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '7px', color: '#94a3b8', lineHeight: 1 }}>
                      ANCHOR HOLDING PULL
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                      {buoyState.anchorTension_kN}{' '}
                      <span style={{ fontSize: '7.5px', color: '#34d399' }}>kN</span>
                    </div>
                  </div>
                </div>
              </Html>
            </group>
          </>
        )}
      </group>
    </group>
  );
}
