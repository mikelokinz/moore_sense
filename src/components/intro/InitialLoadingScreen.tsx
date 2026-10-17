import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { ArrowRight, Globe } from 'lucide-react';

interface InitialLoadingScreenProps {
  onEnter: () => void;
  onDismissed?: () => void;
}

const PRELOAD_TEXTURES = [
  '/textures/earth_day.jpg',
  '/textures/earth_night.png',
  '/textures/earth_specular.jpg',
  '/textures/earth_normal.jpg',
  '/textures/earth_clouds.png',
  '/textures/moon_map.jpg',
  '/textures/waternormals.jpg',
];

const LOADING_STEPS = [
  { threshold: 18, text: 'Initializing hydrodynamic ocean physics engine...' },
  { threshold: 40, text: 'Preloading planetary bathymetry and high-res satellite textures...' },
  { threshold: 65, text: 'Connecting INCOIS real-time ocean telemetry data stream...' },
  { threshold: 85, text: 'Compiling Gerstner wave simulation and mooring catenary shaders...' },
  { threshold: 96, text: 'Calibrating astronomical ephemeris and celestial illumination...' },
  { threshold: 100, text: 'Mooring integrity grid operational. Ready to explore.' },
];

export const InitialLoadingScreen: React.FC<InitialLoadingScreenProps> = ({ onEnter, onDismissed }) => {
  const [progress, setProgress] = useState(0);
  const [currentStepText, setCurrentStepText] = useState(LOADING_STEPS[0].text);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // Preload textures in the background while the loading screen is active
  useEffect(() => {
    const textureLoader = new THREE.TextureLoader();
    let loadedCount = 0;
    const totalCount = PRELOAD_TEXTURES.length;

    PRELOAD_TEXTURES.forEach((url) => {
      textureLoader.load(
        url,
        () => {
          loadedCount++;
        },
        undefined,
        () => {
          loadedCount++; // Fallback on missing texture
        }
      );
    });

    const startTime = performance.now();
    const duration = 2800; // ms presentation time for silky smooth pacing

    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const timeProgress = Math.min(100, Math.round((elapsed / duration) * 100));
      const assetProgress = Math.round((loadedCount / totalCount) * 100);

      const current = Math.min(100, Math.max(timeProgress, Math.min(timeProgress, assetProgress)));
      setProgress(current);

      const matchedStep =
        LOADING_STEPS.find((s) => current <= s.threshold) || LOADING_STEPS[LOADING_STEPS.length - 1];
      setCurrentStepText(matchedStep.text);

      if (current >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setIsLoaded(true);
        }, 250);
      }
    }, 40);

    return () => clearInterval(interval);
  }, []);

  const handleLaunch = () => {
    if (isExiting) return;
    setIsExiting(true);
    // 1. Instantly trigger snappy globe sweep (0 delay!)
    onEnter();
    // 2. Dismiss loading screen after smooth dissolve
    setTimeout(() => {
      onDismissed?.();
    }, 600);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'transparent',
        color: '#ffffff',
        overflow: 'hidden',
        fontFamily: "'Space Grotesk', system-ui, -apple-system, sans-serif",
        opacity: isExiting ? 0 : 1,
        pointerEvents: isExiting ? 'none' : 'auto',
        transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >

      {/* ── 2. Cinematic Horizon & Edge Vignette ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 2,
          background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(2, 6, 23, 0.58) 100%)',
        }}
      />

      {/* ── 3. Atmospheric Progressive Frosted Glass Underlay (No Lines, Silky Gradient Blend) ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 'clamp(580px, 52vw, 800px)',
          pointerEvents: 'none',
          zIndex: 3,
          backdropFilter: 'blur(36px) saturate(160%)',
          WebkitBackdropFilter: 'blur(36px) saturate(160%)',
          maskImage: 'linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.05) 40px, rgba(0, 0, 0, 0.35) 120px, rgba(0, 0, 0, 0.75) 220px, black 320px)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.05) 40px, rgba(0, 0, 0, 0.35) 120px, rgba(0, 0, 0, 0.75) 220px, black 320px)',
          background: 'linear-gradient(to right, transparent 0%, rgba(2, 8, 24, 0.12) 30%, rgba(2, 9, 28, 0.38) 70%, rgba(1, 6, 20, 0.58) 100%)',
        }}
      />

      {/* ── 4. LIQUID GLASS LOADING PANEL (Words moved further to the right, crystal-clear visibility) ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 'clamp(520px, 48vw, 720px)',
          zIndex: 10,
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(14, 165, 233, 0.04) 30%, rgba(2, 10, 28, 0.42) 70%, rgba(1, 6, 20, 0.62) 100%)',
          backdropFilter: 'blur(40px) saturate(190%) contrast(105%)',
          WebkitBackdropFilter: 'blur(40px) saturate(190%) contrast(105%)',
          maskImage: 'linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.04) 30px, rgba(0, 0, 0, 0.25) 90px, rgba(0, 0, 0, 0.7) 170px, black 260px)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.04) 30px, rgba(0, 0, 0, 0.25) 90px, rgba(0, 0, 0, 0.7) 170px, black 260px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-end',
          padding: 'clamp(32px, 5vh, 48px) clamp(44px, 5vw, 76px) clamp(32px, 5vh, 48px) clamp(160px, 16vw, 260px)',
          boxSizing: 'border-box',
          overflowY: 'auto',
          transform: isExiting ? 'translateX(100%)' : 'translateX(0)',
          transition: 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ width: '100%', maxWidth: '420px' }}>
          {/* ── 1. APPLICATION NAME (Moved further right, crystal-clear high contrast) ── */}
          <div style={{ marginBottom: '38px' }}>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(38px, 4vw, 52px)',
                fontWeight: 900,
                letterSpacing: '0.18em',
                lineHeight: 1,
                background: 'linear-gradient(135deg, #ffffff 40%, #bae6fd 75%, #38bdf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 2px 14px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 24px rgba(14, 165, 233, 0.5))',
              }}
            >
              MOORSENSE
            </h1>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'monospace',
                letterSpacing: '0.22em',
                color: '#f8fafc',
                marginTop: '10px',
                textShadow: '0 1px 8px rgba(0, 0, 0, 0.95), 0 0 16px rgba(2, 6, 23, 0.9)',
              }}
            >
              AUTONOMOUS OCEAN MOORING INTEGRITY GRID
            </div>
          </div>

          {/* ── 2. LOADER BAR (Ultra-crisp & high contrast) ── */}
          <div style={{ width: '100%', marginBottom: '14px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  letterSpacing: '0.16em',
                  color: '#7dd3fc',
                  textShadow: '0 1px 8px rgba(0, 0, 0, 0.95)',
                }}
              >
                INITIALIZING
              </span>
              <span
                style={{
                  fontSize: '15px',
                  fontFamily: 'monospace',
                  fontWeight: 900,
                  color: '#38bdf8',
                  textShadow: '0 0 16px rgba(56, 189, 248, 0.95), 0 1px 8px rgba(0, 0, 0, 0.95)',
                }}
              >
                {progress}%
              </span>
            </div>

            {/* Liquid Glass Progress Bar Track */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '7px',
                borderRadius: '5px',
                background: 'rgba(2, 8, 24, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                borderTop: '1px solid rgba(255, 255, 255, 0.55)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.7), inset 0 1px 2px rgba(0, 0, 0, 0.8)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #0284c7 0%, #38bdf8 65%, #67e8f9 100%)',
                  boxShadow: '0 0 18px rgba(56, 189, 248, 1), 0 0 6px #38bdf8',
                  borderRadius: '5px',
                  transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>
          </div>

          {/* ── 3. ACTUAL LOADING SENTENCE (High-contrast white, one line at a time, smooth animation) ── */}
          <div
            style={{
              minHeight: '28px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span
              key={currentStepText}
              style={{
                fontSize: '13.5px',
                fontFamily: 'monospace',
                fontWeight: 600,
                color: '#ffffff',
                letterSpacing: '0.04em',
                lineHeight: 1.5,
                textShadow: '0 1px 8px rgba(0, 0, 0, 0.98), 0 0 16px rgba(2, 6, 23, 0.95)',
                animation: 'fadeSentence 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {currentStepText}
            </span>
          </div>

          {/* ── 4. SMOOTH BUTTON POP-UP (Smooth and snappy entrance into globe) ── */}
          <div
            style={{
              marginTop: '36px',
              opacity: isLoaded ? 1 : 0,
              transform: isLoaded ? 'translateY(0)' : 'translateY(12px)',
              pointerEvents: isLoaded ? 'auto' : 'none',
              transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <button
              onClick={handleLaunch}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.45) 0%, rgba(2, 132, 199, 0.35) 45%, rgba(3, 105, 161, 0.52) 100%)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: '1px solid rgba(56, 189, 248, 0.75)',
                borderTop: '1px solid rgba(255, 255, 255, 0.9)',
                borderRadius: '12px',
                padding: '16px 28px',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 800,
                fontFamily: 'monospace',
                letterSpacing: '0.16em',
                cursor: 'pointer',
                boxShadow: '0 12px 35px rgba(14, 165, 233, 0.45), 0 0 24px rgba(56, 189, 248, 0.35), inset 0 1.5px 2px rgba(255, 255, 255, 0.7)',
                transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                e.currentTarget.style.boxShadow =
                  '0 16px 42px rgba(56, 189, 248, 0.65), 0 0 35px rgba(56, 189, 248, 0.55), inset 0 2px 3px rgba(255, 255, 255, 0.9)';
                e.currentTarget.style.borderColor = '#38bdf8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow =
                  '0 12px 35px rgba(14, 165, 233, 0.45), 0 0 24px rgba(56, 189, 248, 0.35), inset 0 1.5px 2px rgba(255, 255, 255, 0.7)';
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.75)';
              }}
            >
              <Globe size={18} color="#7dd3fc" />
              <span>ENTER MOORSENSE GLOBE</span>
              <ArrowRight size={18} color="#7dd3fc" />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeSentence {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
