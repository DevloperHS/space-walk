import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogOut,
  Pause,
  Play,
  RectangleHorizontal,
  RectangleVertical,
  RotateCcw,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { HapticsEngine } from './audio/HapticsEngine';
import { SpaceAudioEngine } from './audio/SpaceAudioEngine';
import { SolarVoyageEngine, VoyageHudSnapshot } from './scene/SolarVoyageEngine';

interface TouchRippleState {
  side: 'left' | 'right';
  yPct: number;
  burstKey: number;
  holding: boolean;
}

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent)
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SolarVoyageEngine | null>(null);
  const audioRef = useRef<SpaceAudioEngine | null>(null);
  const hapticsRef = useRef<HapticsEngine | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const burstCounterRef = useRef(0);
  const introTimerRef = useRef<number | null>(null);

  const [hasStarted, setHasStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(() => detectTouchDevice());
  const [isPortraitViewport, setIsPortraitViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false,
  );
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 900,
  );
  const [landscapeMode, setLandscapeMode] = useState(false);

  const [hud, setHud] = useState<VoyageHudSnapshot>({
    sectorName: 'Neptune',
    sectorSubtitle: 'Kuiper Approach',
    distanceAu: '30.07 AU',
    velocityKmS: 44,
    visible: true,
    health: 1,
    isRecharging: false,
    rechargeProgress: 0,
    rechargeRemainingSec: 0,
  });

  // Pure visual dual-side concentric ripples triggered right after Play on touch/mobile devices only
  const [introRipplesVisible, setIntroRipplesVisible] = useState(false);
  const [touchRipple, setTouchRipple] = useState<TouchRippleState | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [hapticsSupported, setHapticsSupported] = useState(true);
  const [contextLost, setContextLost] = useState(false);

  // CSS-rotated 90deg landscape stage fallback when user enables Landscape Mode on a portrait viewport
  const isCssRotatedLandscape = landscapeMode && isPortraitViewport;
  const showLandscapeToggle = isTouchDevice || isPortraitViewport || landscapeMode;
  const isCompactLandscape = isCssRotatedLandscape || (!isPortraitViewport && viewportHeight <= 480);

  // Mount Three.js scene once in an isolated ref container
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const audio = new SpaceAudioEngine();
    const haptics = new HapticsEngine();
    audioRef.current = audio;
    hapticsRef.current = haptics;
    setHapticsSupported(haptics.isSupported());

    const engine = new SolarVoyageEngine(container, audio, haptics, {
      onHudUpdate: (snapshot) => setHud(snapshot),
      onContextLost: (lost) => setContextLost(lost),
    });
    engineRef.current = engine;

    return () => {
      if (introTimerRef.current !== null) {
        window.clearTimeout(introTimerRef.current);
      }
      engine.dispose();
      audio.dispose();
      engineRef.current = null;
      audioRef.current = null;
      hapticsRef.current = null;
    };
  }, []);

  // Track viewport orientation & touch capability across all screen sizes and rotations
  useEffect(() => {
    const syncOrientation = () => {
      setIsPortraitViewport(window.innerHeight > window.innerWidth);
      setViewportHeight(window.innerHeight);
      setIsTouchDevice(detectTouchDevice());
    };
    window.addEventListener('resize', syncOrientation, { passive: true });
    window.addEventListener('orientationchange', syncOrientation, { passive: true });
    return () => {
      window.removeEventListener('resize', syncOrientation);
      window.removeEventListener('orientationchange', syncOrientation);
    };
  }, []);

  // Sync WebGL viewport immediately whenever Landscape Mode CSS rotation toggles
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      engineRef.current?.syncViewport();
    });
    return () => cancelAnimationFrame(raf);
  }, [isCssRotatedLandscape]);

  const toggleLandscapeMode = useCallback(() => {
    setLandscapeMode((prev) => {
      const next = !prev;
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (type: string) => Promise<void>;
        unlock?: () => void;
      };
      if (next) {
        try {
          const el = document.documentElement;
          const fsPromise = el.requestFullscreen?.();
          if (fsPromise && typeof fsPromise.then === 'function') {
            fsPromise
              .then(() => orientation?.lock?.('landscape').catch(() => undefined))
              .catch(() => orientation?.lock?.('landscape').catch(() => undefined));
          } else {
            orientation?.lock?.('landscape')?.catch(() => undefined);
          }
        } catch {
          // Graceful CSS 90-degree rotated landscape stage handles browsers/iframes without lock support
        }
      } else {
        try {
          orientation?.unlock?.();
        } catch {
          // ignore
        }
        try {
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => undefined);
          }
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  const ensureAudioUnlocked = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.isMuted()) return;
    if (audio.unlock()) {
      setAudioUnlocked(true);
    }
  }, []);

  const triggerIntroRipples = useCallback(() => {
    // PC stays 100% pure cinema with zero on-screen steering hints; mobile/touch gets pure visual edge ripples
    if (!isTouchDevice) return;
    setIntroRipplesVisible(true);
    if (introTimerRef.current !== null) {
      window.clearTimeout(introTimerRef.current);
    }
    introTimerRef.current = window.setTimeout(() => {
      setIntroRipplesVisible(false);
    }, 5400);
  }, [isTouchDevice]);

  const handlePlay = useCallback(() => {
    ensureAudioUnlocked();
    hapticsRef.current?.steeringEngage();
    engineRef.current?.startVoyage();
    setIsPaused(false);
    setHasStarted(true);
    triggerIntroRipples();
  }, [ensureAudioUnlocked, triggerIntroRipples]);

  const handleOpenPause = useCallback(() => {
    if (!hasStarted || isPaused) return;
    activePointerIdRef.current = null;
    lastPointerPosRef.current = null;
    setTouchRipple(null);
    engineRef.current?.setPaused(true);
    setIsPaused(true);
  }, [hasStarted, isPaused]);

  const handleResume = useCallback(() => {
    if (!isPaused) return;
    ensureAudioUnlocked();
    engineRef.current?.setPaused(false);
    setIsPaused(false);
  }, [ensureAudioUnlocked, isPaused]);

  const handleRestart = useCallback(() => {
    ensureAudioUnlocked();
    hapticsRef.current?.steeringEngage();
    activePointerIdRef.current = null;
    lastPointerPosRef.current = null;
    setTouchRipple(null);
    engineRef.current?.restartVoyage();
    setIsPaused(false);
    setHasStarted(true);
    triggerIntroRipples();
  }, [ensureAudioUnlocked, triggerIntroRipples]);

  const handleQuit = useCallback(() => {
    activePointerIdRef.current = null;
    lastPointerPosRef.current = null;
    setTouchRipple(null);
    setIntroRipplesVisible(false);
    if (introTimerRef.current !== null) {
      window.clearTimeout(introTimerRef.current);
      introTimerRef.current = null;
    }
    engineRef.current?.quitToHome();
    setIsPaused(false);
    setHasStarted(false);
  }, []);

  const engageSteer = useCallback(
    (side: 'left' | 'right', yPct: number) => {
      if (!hasStarted || isPaused || hud.isRecharging) return;
      setIntroRipplesVisible(false);
      ensureAudioUnlocked();
      engineRef.current?.setSteerInput(side === 'left' ? -1 : 1);
      burstCounterRef.current += 1;
      setTouchRipple({
        side,
        yPct: Math.max(18, Math.min(82, yPct)),
        burstKey: burstCounterRef.current,
        holding: true,
      });
    },
    [ensureAudioUnlocked, hasStarted, isPaused, hud.isRecharging],
  );

  const releaseSteer = useCallback(() => {
    engineRef.current?.setSteerInput(0);
    setTouchRipple((prev) => (prev ? { ...prev, holding: false } : null));
  }, []);

  // Clear active touch ripple immediately if travel halts for 1-minute recharge
  useEffect(() => {
    if (hud.isRecharging) {
      activePointerIdRef.current = null;
      lastPointerPosRef.current = null;
      setTouchRipple(null);
    }
  }, [hud.isRecharging]);

  // PC keyboard support: Escape toggles pause; WASD + Arrow keys steer 4-way in flight or look 360° at rest
  // (Zero on-screen instructions or edge ripples on PC)
  useEffect(() => {
    if (!hasStarted) return;
    const held = new Set<string>();

    const normalizeKey = (e: KeyboardEvent): string | null => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          return 'up';
        case 'KeyS':
        case 'ArrowDown':
          return 'down';
        case 'KeyA':
        case 'ArrowLeft':
          return 'left';
        case 'KeyD':
        case 'ArrowRight':
          return 'right';
        default:
          break;
      }
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') return 'up';
      if (k === 's' || e.key === 'ArrowDown') return 'down';
      if (k === 'a' || e.key === 'ArrowLeft') return 'left';
      if (k === 'd' || e.key === 'ArrowRight') return 'right';
      return null;
    };

    const syncKeysToEngine = () => {
      const horiz: -1 | 0 | 1 =
        held.has('left') === held.has('right') ? 0 : held.has('left') ? -1 : 1;
      const vert: -1 | 0 | 1 =
        held.has('up') === held.has('down') ? 0 : held.has('up') ? 1 : -1;

      if (hud.isRecharging) {
        engineRef.current?.setFlightInput(0, 0);
        engineRef.current?.setFreeLookKeyVelocity(horiz, vert);
      } else {
        engineRef.current?.setFreeLookKeyVelocity(0, 0);
        engineRef.current?.setFlightInput(horiz, vert);
      }
    };

    const clearAllKeys = () => {
      held.clear();
      engineRef.current?.setFlightInput(0, 0);
      engineRef.current?.setFreeLookKeyVelocity(0, 0);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isPaused) {
          handleResume();
        } else {
          clearAllKeys();
          handleOpenPause();
        }
        return;
      }
      if (isPaused) return;

      const action = normalizeKey(e);
      if (!action) return;
      e.preventDefault();
      ensureAudioUnlocked();
      if (!held.has(action)) {
        held.add(action);
        syncKeysToEngine();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const action = normalizeKey(e);
      if (!action) return;
      if (held.delete(action)) {
        syncKeysToEngine();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearAllKeys);
    return () => {
      clearAllKeys();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearAllKeys);
    };
  }, [hasStarted, isPaused, hud.isRecharging, handleOpenPause, handleResume, ensureAudioUnlocked]);

  // Maps viewport pointer coordinates cleanly into stage-local space (handling 90° CSS landscape rotation)
  const getLocalPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isCssRotatedLandscape) {
        const w = Math.max(1, window.innerHeight);
        const h = Math.max(1, window.innerWidth);
        return {
          x: e.clientY,
          y: window.innerWidth - e.clientX,
          w,
          h,
        };
      }
      const rect = e.currentTarget.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        w: Math.max(1, rect.width),
        h: Math.max(1, rect.height),
      };
    },
    [isCssRotatedLandscape],
  );

  // Screen-edge touch/pointer steering in flight OR 360° free-look drag when at rest recharging
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasStarted || isPaused) return;
      if ((e.target as HTMLElement).closest('button')) return;

      const local = getLocalPointer(e);

      if (hud.isRecharging) {
        activePointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        ensureAudioUnlocked();
        lastPointerPosRef.current = { x: local.x, y: local.y };
        return;
      }

      // On desktop PC mouse clicks outside rest mode, let WASD own flight cleanly while still unlocking audio
      if (e.pointerType === 'mouse' && !isTouchDevice) {
        ensureAudioUnlocked();
        return;
      }

      activePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);

      const xRatio = local.x / local.w;
      const yPct = (local.y / local.h) * 100;

      if (xRatio < 0.44) {
        engageSteer('left', yPct);
      } else if (xRatio > 0.56) {
        engageSteer('right', yPct);
      } else {
        setIntroRipplesVisible(false);
        ensureAudioUnlocked();
      }
    },
    [engageSteer, ensureAudioUnlocked, getLocalPointer, hasStarted, isPaused, isTouchDevice, hud.isRecharging],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasStarted || isPaused || activePointerIdRef.current !== e.pointerId) return;

      const local = getLocalPointer(e);

      if (hud.isRecharging) {
        const prev = lastPointerPosRef.current;
        if (prev) {
          engineRef.current?.addFreeLookDelta(local.x - prev.x, local.y - prev.y);
        }
        lastPointerPosRef.current = { x: local.x, y: local.y };
        return;
      }

      const xRatio = local.x / local.w;
      const yPct = Math.max(18, Math.min(82, (local.y / local.h) * 100));

      if (xRatio < 0.44) {
        engineRef.current?.setSteerInput(-1);
        setTouchRipple((prev) =>
          prev && prev.side === 'left' && prev.holding
            ? { ...prev, yPct }
            : { side: 'left', yPct, burstKey: ++burstCounterRef.current, holding: true },
        );
      } else if (xRatio > 0.56) {
        engineRef.current?.setSteerInput(1);
        setTouchRipple((prev) =>
          prev && prev.side === 'right' && prev.holding
            ? { ...prev, yPct }
            : { side: 'right', yPct, burstKey: ++burstCounterRef.current, holding: true },
        );
      } else {
        engineRef.current?.setSteerInput(0);
        setTouchRipple((prev) => (prev ? { ...prev, holding: false } : null));
      }
    },
    [getLocalPointer, hasStarted, isPaused, hud.isRecharging],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      activePointerIdRef.current = null;
      lastPointerPosRef.current = null;
      if (!hud.isRecharging) {
        releaseSteer();
      }
    },
    [releaseSteer, hud.isRecharging],
  );

  const toggleAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUnlocked && !audioMuted) {
      if (audio.unlock()) {
        setAudioUnlocked(true);
      }
      return;
    }
    const nextMuted = !audioMuted;
    setAudioMuted(nextMuted);
    audio.setMuted(nextMuted);
    if (!nextMuted) setAudioUnlocked(true);
  }, [audioMuted, audioUnlocked]);

  const toggleHaptics = useCallback(() => {
    const next = !hapticsOn;
    setHapticsOn(next);
    hapticsRef.current?.setEnabled(next);
    if (next) {
      hapticsRef.current?.steeringEngage();
    }
  }, [hapticsOn]);

  return (
    <main
      className={`${
        isCssRotatedLandscape
          ? 'fixed top-1/2 left-1/2 w-[100dvh] h-[100vw] -translate-x-1/2 -translate-y-1/2 rotate-90'
          : 'relative w-screen h-dvh'
      } overflow-hidden bg-[#000003] touch-none select-none ${
        hasStarted && !isPaused && hud.isRecharging ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Isolated Full-Bleed Three.js WebGL Stage */}
      <div
        ref={mountRef}
        className="absolute inset-0 w-full h-full"
        aria-label="First-person asteroid voyage through the Solar System"
      />

      {/* Minimalist Pure-Cinema Welcome Screen Over Live 3D Stage (Zero backdrop-filter) */}
      {!hasStarted && (
        <section
          aria-label="Welcome to Perihelion"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center"
          style={{
            background:
              'radial-gradient(circle at 50% 46%, rgba(0, 0, 5, 0.36) 0%, rgba(0, 0, 4, 0.78) 100%)',
          }}
        >
          <div className="max-w-md flex flex-col items-center">
            <h1
              className={`${
                isCompactLandscape ? 'text-3xl' : 'text-4xl sm:text-5xl'
              } font-light tracking-[0.08em] text-slate-100 [text-wrap:balance]`}
            >
              Perihelion
            </h1>
            <p
              className={`${
                isCompactLandscape ? 'mt-2 text-xs' : 'mt-3 text-sm sm:text-base'
              } font-normal tracking-[0.02em] text-slate-300/90 max-w-sm`}
            >
              First-person orbital voyage through the Solar System
            </p>
            <button
              type="button"
              onClick={handlePlay}
              className={`${
                isCompactLandscape ? 'mt-5 min-h-[44px]' : 'mt-8 min-h-[48px]'
              } px-8 py-3 inline-flex items-center justify-center gap-2.5 rounded-full bg-slate-100 text-[#05070c] text-sm font-medium tracking-[0.03em] whitespace-nowrap shrink-0 transition-transform duration-150 hover:bg-white active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-100 cursor-pointer`}
            >
              <Play className="h-4 w-4 fill-current" strokeWidth={2} />
              <span>Play</span>
            </button>
          </div>

          {showLandscapeToggle && (
            <button
              type="button"
              onClick={toggleLandscapeMode}
              aria-label={landscapeMode ? 'Exit landscape mode' : 'Switch to landscape mode'}
              title={landscapeMode ? 'Exit Landscape' : 'Landscape Mode'}
              className={`absolute bottom-[max(1.25rem,var(--safe-bottom))] right-[max(1.25rem,var(--safe-right))] min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-slate-200 cursor-pointer ${
                landscapeMode
                  ? 'bg-[rgba(10,13,18,0.82)] border-white/28 text-slate-100 hover:border-white/44'
                  : 'bg-[rgba(10,13,18,0.68)] border-white/16 text-slate-200 hover:border-white/35'
              }`}
            >
              {landscapeMode ? (
                <RectangleVertical className="h-[18px] w-[18px]" strokeWidth={1.7} />
              ) : (
                <RectangleHorizontal className="h-[18px] w-[18px]" strokeWidth={1.7} />
              )}
            </button>
          )}
        </section>
      )}

      {/* Pure Visual Dual-Side Concentric Arrival Ripples (Mobile/Touch Only, Zero Text) */}
      {hasStarted && isTouchDevice && introRipplesVisible && (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
          {/* Left Edge Ripple */}
          <div className="absolute left-6 sm:left-10 top-1/2">
            <span className="absolute left-0 top-0 h-20 w-20 rounded-full border border-slate-100/45 animate-edge-ripple-intro" />
            <span className="absolute left-0 top-0 h-20 w-20 rounded-full border border-slate-200/30 animate-edge-ripple-intro-delay" />
          </div>
          {/* Right Edge Ripple */}
          <div className="absolute right-6 sm:right-10 top-1/2">
            <span className="absolute left-0 top-0 h-20 w-20 rounded-full border border-slate-100/45 animate-edge-ripple-intro" />
            <span className="absolute left-0 top-0 h-20 w-20 rounded-full border border-slate-200/30 animate-edge-ripple-intro-delay" />
          </div>
        </div>
      )}

      {/* Active Side-Edge Touch Steering Ripple & Edge Luminance Feedback (Zero Text) */}
      {hasStarted && touchRipple && (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
          <div
            key={touchRipple.burstKey}
            className="absolute"
            style={{
              left: touchRipple.side === 'left' ? '26px' : 'calc(100% - 26px)',
              top: `${touchRipple.yPct}%`,
            }}
          >
            <span className="absolute left-0 top-0 h-24 w-24 rounded-full border border-slate-100/65 animate-edge-ripple-touch" />
            <span className="absolute left-0 top-0 h-24 w-24 rounded-full border border-slate-200/40 animate-edge-ripple-touch-delay" />
            {touchRipple.holding && (
              <span className="absolute left-0 top-0 h-14 w-14 rounded-full border border-slate-100/45 animate-edge-hold-breathe" />
            )}
          </div>

          {touchRipple.holding && (
            <div
              className={`absolute top-0 bottom-0 w-10 transition-opacity duration-200 ${
                touchRipple.side === 'left'
                  ? 'left-0 bg-gradient-to-r from-white/14 to-transparent'
                  : 'right-0 bg-gradient-to-l from-white/14 to-transparent'
              }`}
            />
          )}
        </div>
      )}

      {/* Top-Left Pause Menu Trigger + Whisper-Quiet Astronomical Sector Caption */}
      {hasStarted && (
        <div className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] sm:top-[max(1.5rem,var(--safe-top))] sm:left-[max(1.75rem,var(--safe-left))] [@media(max-height:460px)]:top-[max(0.75rem,var(--safe-top))] [@media(max-height:460px)]:left-[max(1rem,var(--safe-left))] z-20 flex items-center gap-3 sm:gap-3.5">
          <button
            type="button"
            onClick={handleOpenPause}
            aria-label="Pause simulation"
            title="Pause"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border bg-[rgba(10,13,18,0.78)] border-white/18 text-slate-100 hover:border-white/38 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-slate-200 cursor-pointer shrink-0"
          >
            <Pause className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>

          <header
            className={`pointer-events-none transition-opacity duration-700 ${
              hud.visible ? 'opacity-90' : 'opacity-45'
            }`}
          >
            <h1 className="text-sm sm:text-lg [@media(max-height:460px)]:text-sm font-medium tracking-[0.02em] text-slate-100 leading-tight">
              {hud.sectorName}
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] sm:text-xs text-slate-400 font-mono-telemetry">
              <span>{hud.distanceAu}</span>
              <span aria-hidden="true">·</span>
              <span>{hud.velocityKmS} km/s</span>
            </div>
          </header>
        </div>
      )}

      {/* Minimalist Pause Menu Overlay (Resume / Restart / Quit, Zero backdrop-filter) */}
      {hasStarted && isPaused && (
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Pause Menu"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center"
          style={{
            background:
              'radial-gradient(circle at 50% 46%, rgba(0, 0, 5, 0.56) 0%, rgba(0, 0, 4, 0.86) 100%)',
          }}
        >
          <div className="w-full max-w-[260px] flex flex-col items-center">
            <h2
              className={`${
                isCompactLandscape ? 'text-2xl' : 'text-3xl sm:text-4xl'
              } font-light tracking-[0.08em] text-slate-100`}
            >
              Paused
            </h2>

            <div
              className={`${
                isCompactLandscape ? 'mt-4 gap-2' : 'mt-8 gap-3'
              } w-full flex flex-col`}
            >
              <button
                type="button"
                onClick={handleResume}
                className={`w-full ${
                  isCompactLandscape ? 'min-h-[44px] py-2.5' : 'min-h-[48px] py-3'
                } px-7 inline-flex items-center justify-center gap-2.5 rounded-full bg-slate-100 text-[#05070c] text-sm font-medium tracking-[0.03em] whitespace-nowrap transition-transform duration-150 hover:bg-white active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-100 cursor-pointer`}
              >
                <Play className="h-4 w-4 fill-current" strokeWidth={2} />
                <span>Resume</span>
              </button>

              <button
                type="button"
                onClick={handleRestart}
                className={`w-full ${
                  isCompactLandscape ? 'min-h-[44px] py-2.5' : 'min-h-[48px] py-3'
                } px-7 inline-flex items-center justify-center gap-2.5 rounded-full border border-white/22 bg-[rgba(10,13,18,0.82)] text-slate-100 text-sm font-medium tracking-[0.03em] whitespace-nowrap transition-colors duration-150 hover:border-white/42 hover:bg-[rgba(18,22,30,0.9)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-200 cursor-pointer`}
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
                <span>Restart</span>
              </button>

              <button
                type="button"
                onClick={handleQuit}
                className={`w-full ${
                  isCompactLandscape ? 'min-h-[44px] py-2.5' : 'min-h-[48px] py-3'
                } px-7 inline-flex items-center justify-center gap-2.5 rounded-full border border-white/14 bg-[rgba(10,13,18,0.68)] text-slate-300 text-sm font-medium tracking-[0.03em] whitespace-nowrap transition-colors duration-150 hover:border-white/32 hover:text-slate-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-200 cursor-pointer`}
              >
                <LogOut className="h-4 w-4" strokeWidth={1.8} />
                <span>Quit</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Horizontal Transparent-Background Health Bar (Top-Right): White depleting bar -> 1-min pulsing green backward refill */}
      {hasStarted && (
        <div
          className="pointer-events-none absolute top-[max(1.25rem,var(--safe-top))] right-[max(1rem,var(--safe-right))] sm:top-[max(1.75rem,var(--safe-top))] sm:right-[max(1.75rem,var(--safe-right))] [@media(max-height:460px)]:top-[max(1rem,var(--safe-top))] z-20 flex flex-col items-end"
          role="progressbar"
          aria-label={hud.isRecharging ? 'Recharging asteroid integrity' : 'Asteroid integrity'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((hud.isRecharging ? hud.rechargeProgress : hud.health) * 100)}
        >
          <div className="w-24 sm:w-40 md:w-44 h-2 bg-transparent border border-white/25 overflow-hidden rounded-[2px]">
            {hud.isRecharging ? (
              <div
                className="h-full w-full bg-emerald-400 origin-right animate-health-recharge-pulse transition-transform duration-200 ease-linear"
                style={{ transform: `scaleX(${hud.rechargeProgress})` }}
              />
            ) : (
              <div
                className="h-full w-full bg-white origin-left transition-transform duration-200 ease-out"
                style={{ transform: `scaleX(${hud.health})` }}
              />
            )}
          </div>
          {hud.isRecharging && (
            <span className="mt-1.5 text-[11px] font-mono-telemetry text-emerald-400/85 leading-none">
              {`${Math.floor(Math.max(0, hud.rechargeRemainingSec) / 60)}:${String(
                Math.max(0, hud.rechargeRemainingSec) % 60,
              ).padStart(2, '0')}`}
            </span>
          )}
        </div>
      )}

      {/* Discreet Low-Profile Sensory & Landscape Controls (Bottom-Right, Solid Matte Surface, Zero backdrop-filter) */}
      {hasStarted && (
        <div className="absolute bottom-[max(1rem,var(--safe-bottom))] right-[max(1rem,var(--safe-right))] sm:bottom-[max(1.5rem,var(--safe-bottom))] sm:right-[max(1.75rem,var(--safe-right))] [@media(max-height:460px)]:bottom-[max(0.75rem,var(--safe-bottom))] z-20 flex items-center gap-2 sm:gap-2.5">
          {showLandscapeToggle && (
            <button
              type="button"
              onClick={toggleLandscapeMode}
              aria-label={landscapeMode ? 'Exit landscape mode' : 'Switch to landscape mode'}
              title={landscapeMode ? 'Exit Landscape' : 'Landscape Mode'}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-slate-200 cursor-pointer ${
                landscapeMode
                  ? 'bg-[rgba(10,13,18,0.82)] border-white/28 text-slate-100 hover:border-white/44'
                  : 'bg-[rgba(10,13,18,0.72)] border-white/16 text-slate-200 hover:border-white/35'
              }`}
            >
              {landscapeMode ? (
                <RectangleVertical className="h-[18px] w-[18px]" strokeWidth={1.7} />
              ) : (
                <RectangleHorizontal className="h-[18px] w-[18px]" strokeWidth={1.7} />
              )}
            </button>
          )}

          {hapticsSupported && isTouchDevice && (
            <button
              type="button"
              onClick={toggleHaptics}
              aria-label={hapticsOn ? 'Disable haptic feedback' : 'Enable haptic feedback'}
              title={hapticsOn ? 'Haptics On' : 'Haptics Off'}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-slate-200 cursor-pointer ${
                hapticsOn
                  ? 'bg-[rgba(10,13,18,0.78)] border-white/18 text-slate-100 hover:border-white/35'
                  : 'bg-[rgba(10,13,18,0.58)] border-white/10 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Smartphone className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
          )}

          <button
            type="button"
            onClick={toggleAudio}
            aria-label={audioMuted || !audioUnlocked ? 'Enable spatial audio' : 'Mute spatial audio'}
            title={audioMuted || !audioUnlocked ? 'Enable Sound' : 'Mute Sound'}
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-slate-200 cursor-pointer ${
              !audioMuted && audioUnlocked
                ? 'bg-[rgba(10,13,18,0.78)] border-white/24 text-slate-100 hover:border-white/40'
                : 'bg-[rgba(10,13,18,0.68)] border-white/12 text-slate-300 hover:border-white/30'
            }`}
          >
            {audioMuted || !audioUnlocked ? (
              <VolumeX className="h-[18px] w-[18px]" strokeWidth={1.7} />
            ) : (
              <Volume2 className="h-[18px] w-[18px]" strokeWidth={1.7} />
            )}
          </button>
        </div>
      )}

      {/* Graceful WebGL Context Loss Fallback */}
      {contextLost && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#000003]/92 px-6 text-center">
          <div className="max-w-sm">
            <p className="text-base font-medium text-slate-100">Graphics context paused</p>
            <p className="mt-1.5 text-sm text-slate-400">
              Restoring the 3D Solar System viewport automatically.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
