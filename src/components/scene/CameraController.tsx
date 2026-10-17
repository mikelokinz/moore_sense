import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CameraStage } from '../../types/ocean';
import { easeInOutCubic, latLonToXYZ } from '../../utils/oceanCalc';
import { CinematicCameraControllerLogic } from '../../camera/CinematicCameraController';

// Camera position presets focused on India, Bay of Bengal, and Indian Ocean
// Centered directly on India & OMNI buoys network (15°N, 78°E) zoomed in close (radius 3.85)
export const INDIA_FOCUS_POS = new THREE.Vector3(0.77, 1.00, -3.64);
const INDIA_POS = INDIA_FOCUS_POS;

const CAMERA_PRESETS: Record<CameraStage, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  intro:       { pos: INDIA_POS.clone(), target: new THREE.Vector3(0, 0, 0) },
  space:       { pos: INDIA_POS.clone(), target: new THREE.Vector3(0, 0, 0) },
  earth:       { pos: INDIA_POS.clone(), target: new THREE.Vector3(0, 0, 0) },
  indianOcean: { pos: INDIA_POS.clone(), target: new THREE.Vector3(0, 0, 0) },
  bayOfBengal: { pos: INDIA_POS.clone(), target: new THREE.Vector3(0, 0, 0) },
  exploration: { pos: INDIA_POS.clone(), target: new THREE.Vector3(0, 0, 0) },
};

interface CameraControllerProps {
  stage: CameraStage;
  hasStarted?: boolean;
  onStageComplete?: (stage: CameraStage) => void;
  targetStation?: { latitude: number; longitude: number } | null;
  isExploring: boolean;
  handDelta?: React.MutableRefObject<{ dx: number; dy: number }>;
  handZoom?: React.MutableRefObject<number>;
  isFist?: React.MutableRefObject<boolean>;
  cinematicController?: CinematicCameraControllerLogic | null;
  currentTargetRef?: React.MutableRefObject<THREE.Vector3>;
  orbitControlsRef?: React.RefObject<any>; // using any to avoid importing OrbitControlsImpl type if not needed
  recenterKey?: number;
  onAutoRotateChange?: (autoRotate: boolean) => void;
}

export function CameraController({
  stage,
  hasStarted = true,
  onStageComplete,
  targetStation,
  isExploring,
  handDelta,
  handZoom,
  isFist,
  cinematicController,
  currentTargetRef: externalTargetRef,
  orbitControlsRef,
  recenterKey,
  onAutoRotateChange,
}: CameraControllerProps) {
  const { camera, gl } = useThree();
  const progress = useRef(1); // Set to 1 initially to prevent any unwanted idle zoom/lerp
  const lastStage = useRef<CameraStage>(stage);
  const fromPos = useRef(INDIA_POS.clone());
  const fromTarget = useRef(new THREE.Vector3(0, 0, 0));
  const currentTarget = useRef(new THREE.Vector3(0, 0, 0));
  const orbitTarget = useRef(new THREE.Vector3(0, 0, 0));

  // Ensure camera far plane is 50000 so Sun and Moon are never clipped
  useEffect(() => {
    if (camera && 'far' in camera && camera.far < 50000) {
      (camera as THREE.PerspectiveCamera).far = 50000;
      camera.updateProjectionMatrix();
    }
  }, [camera]);

  // Sync external target ref if provided
  useEffect(() => {
    if (externalTargetRef) {
      externalTargetRef.current = currentTarget.current;
    }
  }, [externalTargetRef]);

  // Capture transition start on stage change
  useEffect(() => {
    if (stage !== lastStage.current) {
      fromPos.current.copy(camera.position);
      fromTarget.current.copy(orbitTarget.current);
      progress.current = 0;
      lastStage.current = stage;
    }
  }, [stage, camera]);

  // Snappy start rotation state (~0.9s brisk orbital spin into India view on initial load)
  const isSnappyRotating = useRef(false);
  const snappyProgress = useRef(0);
  const hasTriggeredSnappy = useRef(false);
  const loadingAngle = useRef(0);
  const startSphRef = useRef(new THREE.Spherical());
  const startOffsetRef = useRef(0);

  // Position camera at initial orbital hold point before user enters
  useEffect(() => {
    if (!hasStarted && !hasTriggeredSnappy.current) {
      const targetSph = new THREE.Spherical().setFromVector3(INDIA_POS);
      const startRadius = 6.2;
      const startTheta = targetSph.theta - 1.25;
      const startPhi = targetSph.phi + 0.10;
      const curSph = new THREE.Spherical(startRadius, startPhi, startTheta);
      camera.position.setFromSpherical(curSph);
      camera.lookAt(0, 0, 0);
    }
  }, [hasStarted, camera]);

  // Once hasStarted becomes true (after pressing the launch button), trigger snappy start rotation
  useEffect(() => {
    if (hasStarted && !hasTriggeredSnappy.current) {
      hasTriggeredSnappy.current = true;
      isSnappyRotating.current = true;
      snappyProgress.current = 0;
      startSphRef.current.setFromVector3(camera.position);
      const persCamera = camera as THREE.PerspectiveCamera;
      startOffsetRef.current = persCamera.view?.offsetX ?? (window.innerWidth * 0.24);
    }
  }, [hasStarted, camera]);

  // ══ Auto-Rotation, Earth Hover & 5-Second Hold State ══
  const isEarthHovered = useRef(false);
  const unhoverTimestamp = useRef<number>(0);
  const isUserDragging = useRef(false);
  const lastDragEndTime = useRef(0);
  const hasPointerMoved = useRef(false);
  const isPointerOnCanvas = useRef(true);
  const lastPointerClientCoords = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const earthSphere = useMemo(() => new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2.05), []);
  const hitVec = useMemo(() => new THREE.Vector3(), []);
  const lastAutoRotateState = useRef(false);

  // Listen to OrbitControls start/end events so manual dragging is never fought by auto-rotate or hover-recenter
  useEffect(() => {
    const controls = orbitControlsRef?.current;
    if (!controls) return;

    const onStart = () => {
      isUserDragging.current = true;
    };
    const onEnd = () => {
      isUserDragging.current = false;
      lastDragEndTime.current = performance.now();
    };

    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [orbitControlsRef]);

  // Track pointer coordinates and handle leaving browser window
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      hasPointerMoved.current = true;
      isPointerOnCanvas.current = true;
      lastPointerClientCoords.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseLeaveDoc = (e: MouseEvent) => {
      if (!e.relatedTarget && !(e as any).toElement) {
        isPointerOnCanvas.current = false;
      }
    };
    const onMouseEnterDoc = () => {
      isPointerOnCanvas.current = true;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeaveDoc);
    document.addEventListener('mouseenter', onMouseEnterDoc);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseleave', onMouseLeaveDoc);
      document.removeEventListener('mouseenter', onMouseEnterDoc);
    };
  }, []);

  // ══ Unified Great-Circle Flight Engine (Smooth Quaternion Slerp + Altitude Elevation Arc) ══
  const isFlightActive = useRef(false);
  const flightProgress = useRef(1.0);
  const flightFromPos = useRef(new THREE.Vector3());
  const flightToPos = useRef(new THREE.Vector3());
  const flightFromTarget = useRef(new THREE.Vector3());
  const flightToTarget = useRef(new THREE.Vector3());
  const flightArcHeight = useRef(0);
  const flightQuat = useRef(new THREE.Quaternion());
  const flightFromDir = useRef(new THREE.Vector3());
  const flightFromRadius = useRef(1);
  const flightToRadius = useRef(1);
  const flightIsCloseUp = useRef(false);
  const lastTargetKey = useRef<string>('none');
  const isInitialMount = useRef<boolean>(true);
  const lastRecenterKey = useRef<number | undefined>(recenterKey);

  const triggerFlyTo = useCallback(
    (destinationPos: THREE.Vector3, destinationTarget: THREE.Vector3, isCloseUp: boolean) => {
      // 1. Deduplication guard: If already actively flying to this exact destination, ignore duplicate call
      if (
        isFlightActive.current &&
        flightToPos.current.distanceToSquared(destinationPos) < 0.0001 &&
        flightToTarget.current.distanceToSquared(destinationTarget) < 0.0001
      ) {
        return;
      }

      // 2. If camera is already resting at this destination, no action needed
      if (
        !isFlightActive.current &&
        camera.position.distanceToSquared(destinationPos) < 0.0001 &&
        currentTarget.current.distanceToSquared(destinationTarget) < 0.0001
      ) {
        return;
      }

      // 3. Cancel initial startup spin if running
      isSnappyRotating.current = false;

      // 4. Temporarily disable OrbitControls so it cannot fight camera position
      if (orbitControlsRef?.current) {
        orbitControlsRef.current.enabled = false;
      }

      // 5. Setup flight parameters
      isFlightActive.current = true;
      flightProgress.current = 0;
      flightIsCloseUp.current = isCloseUp;

      flightFromPos.current.copy(camera.position);
      flightFromTarget.current.copy(currentTarget.current);
      flightToPos.current.copy(destinationPos);
      flightToTarget.current.copy(destinationTarget);

      const fromDir = flightFromPos.current.clone().normalize();
      const toDir = flightToPos.current.clone().normalize();
      flightFromDir.current.copy(fromDir);
      flightFromRadius.current = flightFromPos.current.length();
      flightToRadius.current = flightToPos.current.length();

      // Guard against near-antipodal vector numerical instability
      if (fromDir.dot(toDir) < -0.9999) {
        fromDir.add(new THREE.Vector3(0.001, 0, 0.001)).normalize();
      }
      flightQuat.current.setFromUnitVectors(fromDir, toDir);

      const dot = THREE.MathUtils.clamp(fromDir.dot(toDir), -1, 1);
      const angle = Math.acos(dot);

      if (isCloseUp) {
        // Zooming in to buoy: gentle rise to clear the horizon
        flightArcHeight.current = Math.min(0.35, angle * 0.22);
      } else {
        // Zooming out / recentering to India: gentle breathing arc
        flightArcHeight.current = Math.min(0.25, angle * 0.12);
      }
    },
    [camera, orbitControlsRef]
  );

  // Unique coordinate key for stable change detection across re-renders
  const targetKey = targetStation
    ? `${targetStation.latitude.toFixed(4)},${targetStation.longitude.toFixed(4)}`
    : 'none';

  useEffect(() => {
    // Avoid triggering on mount before user interacts
    if (isInitialMount.current) {
      isInitialMount.current = false;
      lastTargetKey.current = targetKey;
      return;
    }

    if (targetKey !== lastTargetKey.current) {
      lastTargetKey.current = targetKey;

      if (targetStation) {
        // Target: Buoy position right on the ocean surface (Earth radius 2.0, ocean at 2.02)
        const [tx, ty, tz] = latLonToXYZ(targetStation.latitude, targetStation.longitude, 2.02);
        const buoyTarget = new THREE.Vector3(tx, ty, tz);

        // Camera focus position: Zoomed close at radius 2.76 (~0.74 altitude above sea level)
        // Offset southward (-2.8°) and eastward (+1.8°) for a rich 3D cinematic perspective
        const camLat = targetStation.latitude - 2.8;
        const camLon = targetStation.longitude + 1.8;
        const [cx, cy, cz] = latLonToXYZ(camLat, camLon, 2.76);
        const camPos = new THREE.Vector3(cx, cy, cz);

        triggerFlyTo(camPos, buoyTarget, true);
      } else {
        // Deselection: Smoothly glide back to India overview (radius 3.85) looking at (0, 0, 0)
        triggerFlyTo(INDIA_FOCUS_POS, new THREE.Vector3(0, 0, 0), false);
      }
    }
  }, [targetKey, targetStation, triggerFlyTo]);

  // Recenter Animation Trigger: seamlessly glides back to India overview (radius 3.85) looking at (0, 0, 0)
  useEffect(() => {
    if (recenterKey !== undefined && recenterKey !== lastRecenterKey.current) {
      lastRecenterKey.current = recenterKey;
      lastTargetKey.current = 'none';

      // Start 5-second hold at India before rotation resumes
      unhoverTimestamp.current = performance.now();
      triggerFlyTo(INDIA_FOCUS_POS, new THREE.Vector3(0, 0, 0), false);
    }
  }, [recenterKey, triggerFlyTo]);

  const getDesiredPos = useCallback((): THREE.Vector3 => {
    return CAMERA_PRESETS[stage].pos;
  }, [stage]);

  const getDesiredTarget = useCallback((): THREE.Vector3 => {
    return CAMERA_PRESETS[stage].target;
  }, [stage]);

  useFrame((state, delta) => {
    const persCamera = camera as THREE.PerspectiveCamera;

    // 0. Loading Screen Mode (Before User Enters)
    if (!hasStarted && !isSnappyRotating.current) {
      // Offset camera horizontally so the Earth sits majestically on the left side of the screen
      const sideOffset = state.size.width * 0.24;
      if (persCamera.setViewOffset) {
        persCamera.setViewOffset(state.size.width, state.size.height, sideOffset, 0, state.size.width, state.size.height);
      }

      // Gentle, serene ambient planetary rotation while loading
      loadingAngle.current += delta * 0.08;
      const targetSph = new THREE.Spherical().setFromVector3(INDIA_POS);
      const curRadius = 6.2; // Perfectly framed full-globe view
      const curPhi = targetSph.phi + 0.10;
      const curTheta = (targetSph.theta - 1.25) + loadingAngle.current;

      camera.position.setFromSpherical(new THREE.Spherical(curRadius, curPhi, curTheta));
      camera.lookAt(0, 0, 0);

      if (orbitControlsRef?.current) {
        if (orbitControlsRef.current.enabled) orbitControlsRef.current.enabled = false;
        if (orbitControlsRef.current.autoRotate) orbitControlsRef.current.autoRotate = false;
      }
      return;
    }

    // A. Smooth & Snappy Launch: Transition Globe from Side to Center, and swoop into India
    if (isSnappyRotating.current) {
      snappyProgress.current = Math.min(1.0, snappyProgress.current + delta * 1.15);
      // Buttery smooth cubic-quartic ease-out curve (brisk start, cushioned deceleration)
      const t = 1 - Math.pow(1 - snappyProgress.current, 3.5);

      const targetSph = new THREE.Spherical().setFromVector3(INDIA_POS);
      const startRadius = startSphRef.current.radius || 6.2;
      const startPhi = startSphRef.current.phi || (targetSph.phi + 0.10);
      const startTheta = startSphRef.current.theta;

      // Shortest angular path towards target theta
      let dTheta = targetSph.theta - startTheta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const curTheta = startTheta + dTheta * t;

      const curRadius = THREE.MathUtils.lerp(startRadius, targetSph.radius, t);
      const curPhi = THREE.MathUtils.lerp(startPhi, targetSph.phi, t);
      const curSph = new THREE.Spherical(curRadius, curPhi, curTheta);

      camera.position.setFromSpherical(curSph);
      camera.lookAt(0, 0, 0);
      currentTarget.current.set(0, 0, 0);
      orbitTarget.current.set(0, 0, 0);

      // Smooth horizontal offset glide from side to center
      const curOffset = THREE.MathUtils.lerp(startOffsetRef.current, 0, t);
      if (curOffset > 1.0 && persCamera.setViewOffset) {
        persCamera.setViewOffset(state.size.width, state.size.height, curOffset, 0, state.size.width, state.size.height);
      } else if (persCamera.clearViewOffset) {
        persCamera.clearViewOffset();
      }

      if (orbitControlsRef?.current) {
        orbitControlsRef.current.target.set(0, 0, 0);
        orbitControlsRef.current.autoRotate = false;
        orbitControlsRef.current.update();
      }

      if (externalTargetRef) {
        externalTargetRef.current.set(0, 0, 0);
      }

      if (snappyProgress.current >= 1.0) {
        if (persCamera.clearViewOffset) {
          persCamera.clearViewOffset();
        }
        isSnappyRotating.current = false;
        camera.position.copy(INDIA_POS);
        camera.lookAt(0, 0, 0);
        fromPos.current.copy(INDIA_POS);
        fromTarget.current.set(0, 0, 0);
        progress.current = 1; // Locked at 1 so no idle transitions ever trigger!
        // Start 5-second initial hold at India before rotation resumes
        unhoverTimestamp.current = performance.now();
        if (orbitControlsRef?.current) {
          orbitControlsRef.current.target.set(0, 0, 0);
          orbitControlsRef.current.minDistance = 2.8;
          orbitControlsRef.current.maxDistance = 14.0;
          orbitControlsRef.current.enabled = true;
          orbitControlsRef.current.autoRotate = false;
          orbitControlsRef.current.update();
        }
        onStageComplete?.('exploration');
      }
      return;
    }

    // B. Unified Great-Circle Flight Engine: Buoy Focus, Deselection & Recenter India
    if (isFlightActive.current) {
      // Keep OrbitControls disabled during active flight
      if (orbitControlsRef?.current) {
        if (orbitControlsRef.current.enabled) orbitControlsRef.current.enabled = false;
        if (orbitControlsRef.current.autoRotate) orbitControlsRef.current.autoRotate = false;
      }

      flightProgress.current = Math.min(1.0, flightProgress.current + delta * 0.90);
      const t = easeInOutCubic(flightProgress.current);

      // Direction along unit sphere using quaternion slerp
      const curQuat = new THREE.Quaternion().identity().slerp(flightQuat.current, t);
      const curDir = flightFromDir.current.clone().applyQuaternion(curQuat);

      // Radius with aerospace arc elevation
      const baseRadius = THREE.MathUtils.lerp(flightFromRadius.current, flightToRadius.current, t);
      const arc = Math.sin(Math.PI * t) * flightArcHeight.current;
      const curRadius = baseRadius + arc;

      camera.position.copy(curDir.multiplyScalar(curRadius));

      // Interpolate lookAt target
      const curTarget = new THREE.Vector3().lerpVectors(
        flightFromTarget.current,
        flightToTarget.current,
        t
      );
      camera.lookAt(curTarget);

      currentTarget.current.copy(curTarget);
      orbitTarget.current.copy(curTarget);

      if (orbitControlsRef?.current) {
        orbitControlsRef.current.target.copy(curTarget);
      }

      if (externalTargetRef) {
        externalTargetRef.current.copy(curTarget);
      }

      // On arrival at destination (buoy close-up or India overview)
      if (flightProgress.current >= 1.0) {
        isFlightActive.current = false;
        camera.position.copy(flightToPos.current);
        camera.lookAt(flightToTarget.current);
        currentTarget.current.copy(flightToTarget.current);
        orbitTarget.current.copy(flightToTarget.current);
        fromPos.current.copy(flightToPos.current);
        fromTarget.current.copy(flightToTarget.current);

        if (orbitControlsRef?.current) {
          orbitControlsRef.current.target.copy(flightToTarget.current);
          if (flightIsCloseUp.current) {
            orbitControlsRef.current.minDistance = 0.35;
            orbitControlsRef.current.maxDistance = 3.5;
          } else {
            orbitControlsRef.current.minDistance = 2.8;
            orbitControlsRef.current.maxDistance = 14.0;
          }
          orbitControlsRef.current.enabled = true;
          orbitControlsRef.current.autoRotate = false;
          orbitControlsRef.current.update();
        }
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // C. Mathematical Earth Hover & Recentering Engine
    // ══════════════════════════════════════════════════════════════════════════════
    let isPointingAtEarth = false;

    if (
      hasPointerMoved.current &&
      isPointerOnCanvas.current &&
      stage === 'exploration' &&
      !targetStation &&
      !cinematicController?.isActive
    ) {
      state.raycaster.setFromCamera(state.pointer, state.camera);
      // Precise mathematical ray-sphere intersection test against Earth (radius 2.05)
      isPointingAtEarth = state.raycaster.ray.intersectSphere(earthSphere, hitVec) !== null;

      // Ensure cursor is not over an interactive DOM overlay (button, modal, or HUD popover)
      if (isPointingAtEarth && lastPointerClientCoords.current.x > 0) {
        const topEl = document.elementFromPoint(
          lastPointerClientCoords.current.x,
          lastPointerClientCoords.current.y
        );
        if (topEl && topEl !== gl.domElement && topEl.tagName !== 'CANVAS') {
          const isInteractiveDom = topEl.closest(
            'button, a, input, [data-interactive], [role="dialog"], [role="button"], [data-buoy-trigger], [data-menu-trigger]'
          );
          if (isInteractiveDom) {
            isPointingAtEarth = false;
          }
        }
      }
    }

    // 1. Rising edge: User begins hovering over Earth
    if (!isEarthHovered.current && isPointingAtEarth) {
      isEarthHovered.current = true;
      unhoverTimestamp.current = 0; // Cancel unhover timer

      // Recenter to India if not actively dragging
      if (!isUserDragging.current) {
        triggerFlyTo(INDIA_FOCUS_POS, new THREE.Vector3(0, 0, 0), false);
      }
    }
    // 2. Falling edge: User unhovers Earth
    else if (isEarthHovered.current && !isPointingAtEarth) {
      isEarthHovered.current = false;
      // Start 5-second hold before rotation resumes
      unhoverTimestamp.current = performance.now();
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // D. Auto-Rotation Orchestration (Smooth, Slow & Glitch-Free)
    // ══════════════════════════════════════════════════════════════════════════════
    const now = performance.now();
    const elapsedSinceUnhover = unhoverTimestamp.current > 0 ? now - unhoverTimestamp.current : 0;
    const isUnhoverHolding = unhoverTimestamp.current > 0 && elapsedSinceUnhover < 5000;

    const elapsedSinceDrag = lastDragEndTime.current > 0 ? now - lastDragEndTime.current : 0;
    const isDragHolding = lastDragEndTime.current > 0 && elapsedSinceDrag < 5000;

    const shouldAutoRotate =
      stage === 'exploration' &&
      !targetStation &&
      !isFlightActive.current &&
      !isSnappyRotating.current &&
      !isEarthHovered.current &&
      !isUnhoverHolding &&
      !isUserDragging.current &&
      !isDragHolding &&
      !cinematicController?.isActive;

    if (orbitControlsRef?.current) {
      orbitControlsRef.current.autoRotate = shouldAutoRotate;
      orbitControlsRef.current.autoRotateSpeed = 0.35;
    }

    if (shouldAutoRotate !== lastAutoRotateState.current) {
      lastAutoRotateState.current = shouldAutoRotate;
      onAutoRotateChange?.(shouldAutoRotate);
    }

    // If cinematic transition is active, let it drive the camera
    if (cinematicController?.isActive) {
      cinematicController.update(camera, currentTarget.current, performance.now());
      camera.lookAt(currentTarget.current);
      orbitTarget.current.copy(currentTarget.current);
      if (externalTargetRef) {
        externalTargetRef.current.copy(currentTarget.current);
      }
      return;
    }

    let didUpdateCamera = false;

    // 1. Stage transition lerp
    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + delta * 0.45);
      const t = easeInOutCubic(progress.current);
      camera.position.lerpVectors(fromPos.current, getDesiredPos(), t);
      currentTarget.current.lerpVectors(fromTarget.current, getDesiredTarget(), t);

      if (progress.current >= 1 && onStageComplete) {
        onStageComplete(stage);
      }
      didUpdateCamera = true;
    } else if (stage === 'exploration') {
      // 2. Hand Gesture control in exploration mode
      const hDelta = handDelta?.current;
      const hZoom = handZoom?.current ?? 1.0;

      if (hDelta && (hDelta.dx !== 0 || hDelta.dy !== 0 || Math.abs(hZoom - 1.0) > 0.001)) {
        lastDragEndTime.current = performance.now();
        // Spherical rotation around current target
        const offset = new THREE.Vector3().subVectors(camera.position, currentTarget.current);
        const spherical = new THREE.Spherical().setFromVector3(offset);

        // Apply hand rotation with smoothing
        spherical.theta -= hDelta.dx * 0.04;
        spherical.phi = THREE.MathUtils.clamp(
          spherical.phi - hDelta.dy * 0.04,
          0.1,
          Math.PI - 0.1
        );

        // Apply hand pinch zoom
        if (Math.abs(hZoom - 1.0) > 0.001) {
          spherical.radius = THREE.MathUtils.clamp(
            spherical.radius * hZoom,
            2.8,
            12.0
          );
        }

        offset.setFromSpherical(spherical);
        camera.position.copy(currentTarget.current).add(offset);
        didUpdateCamera = true;
      }
    }

    if (didUpdateCamera) {
      camera.lookAt(currentTarget.current);
      if (orbitControlsRef?.current) {
        orbitControlsRef.current.target.copy(currentTarget.current);
        orbitControlsRef.current.update();
      }
    } else {
      // If we are not forcing the camera, let OrbitControls drive!
      // We just sync our internal target to what OrbitControls is looking at
      if (orbitControlsRef?.current && stage === 'exploration') {
        currentTarget.current.copy(orbitControlsRef.current.target);
      }
    }

    orbitTarget.current.copy(currentTarget.current);
    if (externalTargetRef) {
      externalTargetRef.current.copy(currentTarget.current);
    }
  });

  return null;
}
