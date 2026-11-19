import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HapticsEngine } from '../audio/HapticsEngine';
import { SpaceAudioEngine } from '../audio/SpaceAudioEngine';
import { AsteroidRimRig, createAsteroidRim } from './asteroidRim';
import { CinematicPostShader } from './shaders';
import { createSolarSystemWorld, SectorInfo, SolarSystemWorld } from './solarSystem';

export interface VoyageHudSnapshot {
  sectorName: string;
  sectorSubtitle: string;
  distanceAu: string;
  velocityKmS: number;
  visible: boolean;
  health: number;
  isRecharging: boolean;
  rechargeProgress: number;
  rechargeRemainingSec: number;
}

export interface VoyageEngineCallbacks {
  onHudUpdate: (snapshot: VoyageHudSnapshot) => void;
  onContextLost: (lost: boolean) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class SolarVoyageEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: VoyageEngineCallbacks;
  private readonly audio: SpaceAudioEngine;
  private readonly haptics: HapticsEngine;

  private readonly isSoftwareGl: boolean;
  private readonly isMobile: boolean;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private cinematicPass: ShaderPass | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;

  private sunKeyLight!: THREE.DirectionalLight;
  private hemiFillLight!: THREE.HemisphereLight;
  private bouncePointLight!: THREE.PointLight;
  private cameraRig!: THREE.Group;

  private world!: SolarSystemWorld;
  private asteroidRim!: AsteroidRimRig;

  // Continuous simulation state (zero React re-renders)
  private frameId = 0;
  private disposed = false;
  private contextLost = false;
  private lastNow = 0;
  private elapsedTime = 0;

  // Start just approaching Neptune so the very first frame is immediately cinematic
  private readonly initialProgress = 0.032;
  private started = false;
  private paused = false;
  private launchRamp = 0;
  private progress = 0.032;
  private steerInput = 0; // -1 (left) | 0 | +1 (right)
  private smoothedSteer = 0;
  private lateralOffset = 0;
  private lateralVelocity = 0;
  private verticalInput = 0; // -1 (down/S) | 0 | +1 (up/W)
  private smoothedVertical = 0;
  private verticalOffset = 0;
  private verticalVelocity = 0;
  private bankAngle = 0;
  private pitchAngle = 0;
  private cameraShake = 0;
  private nearMissFlash = 0;

  // Asteroid hull integrity & 1-minute recharge stasis state
  private health = 1.0;
  private isRecharging = false;
  private rechargeElapsed = 0;
  private readonly rechargeDuration = 60.0;
  private rechargePulseAccum = 0;
  private hudDirty = false;

  // 360-degree free-look camera state active while at rest (recharging HP)
  private freeLookYaw = 0;
  private freeLookPitch = 0;
  private freeLookTargetYaw = 0;
  private freeLookTargetPitch = 0;
  private freeLookKeyYaw = 0;
  private freeLookKeyPitch = 0;

  // Responsive multi-screen framing & adaptive PC/mobile DPR state
  private currentDpr = 1;
  private slowFrameAccum = 0;
  private responsiveBaseFov = 53;
  private rimBaseY = 0;
  private rimScaleX = 1;
  private rimScaleY = 1;
  private resizeObserver: ResizeObserver | null = null;

  // HUD throttle state
  private lastHudPushAt = 0;
  private lastSectorId = '';

  // Pre-allocated scratch math helpers (zero GC inside animation loop)
  private readonly _splinePos = new THREE.Vector3();
  private readonly _lookPos = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();
  private readonly _worldUp = new THREE.Vector3(0, 1, 0);
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _camPos = new THREE.Vector3();
  private readonly _camForward = new THREE.Vector3();
  private readonly _viewForward = new THREE.Vector3();
  private readonly _freeLookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _toSun = new THREE.Vector3();
  private readonly _sunNdc = new THREE.Vector3();
  private readonly _lookMatrix = new THREE.Matrix4();
  private readonly _targetQuat = new THREE.Quaternion();
  private readonly _rollQuat = new THREE.Quaternion();
  private readonly _pitchQuat = new THREE.Quaternion();
  private readonly _xAxis = new THREE.Vector3(1, 0, 0);
  private readonly _zAxis = new THREE.Vector3(0, 0, 1);
  private readonly _toDebris = new THREE.Vector3();
  private readonly _prowPos = new THREE.Vector3();
  private readonly _impactNormal = new THREE.Vector3();
  private readonly _impactPoint = new THREE.Vector3();
  private readonly _targetBounceColor = new THREE.Color(0x2b3e5e);

  constructor(
    container: HTMLElement,
    audio: SpaceAudioEngine,
    haptics: HapticsEngine,
    callbacks: VoyageEngineCallbacks,
  ) {
    this.container = container;
    this.audio = audio;
    this.haptics = haptics;
    this.callbacks = callbacks;

    this.isSoftwareGl = detectSoftwareWebGL();
    this.isMobile =
      typeof window !== 'undefined' &&
      (/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 900));

    this.initScene();
    this.bindEvents();
    this.lastNow = performance.now();
    this.tick();
  }

  /**
   * Computes optimal pixel ratio for any screen from compact phones to 4K/5K ultrawide PC monitors,
   * preserving crisp native sharpness while capping total shaded pixel count for smooth 60fps.
   */
  private computeTargetDpr(width: number, height: number): number {
    if (this.isSoftwareGl) return 1;
    const rawDpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxPixels = this.isMobile ? 2_200_000 : 8_300_000; // ~1080p mobile / ~4K PC ceiling
    const area = Math.max(1, width * height);
    const budgetDpr = Math.sqrt(maxPixels / area);
    return Math.max(1, Math.min(rawDpr, budgetDpr));
  }

  /**
   * Aspect-ratio-aware cinematic framing across portrait phones, compact mobile landscape,
   * tablets, 16:9 laptops, and 21:9/32:9 ultrawide PC displays.
   */
  private computeResponsiveFraming(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    if (aspect < 1.35) {
      // Narrow tablet / square / portrait phone: smoothly expand vertical FOV so horizontal framing
      // and the full jagged foreground asteroid rim remain wide and uncluttered
      const t = THREE.MathUtils.clamp((1.35 - aspect) / 0.85, 0, 1);
      this.responsiveBaseFov = THREE.MathUtils.lerp(53, 72, t);
      this.rimScaleX = THREE.MathUtils.lerp(1.0, 0.82, t);
      this.rimScaleY = THREE.MathUtils.lerp(1.0, 0.94, t);
      this.rimBaseY = THREE.MathUtils.lerp(0, -0.06, t);
    } else if (aspect > 2.02) {
      // Ultrawide PC & tall-phone landscape (20:9 / 21:9 / 32:9): widen rim shelf to span full width
      const t = THREE.MathUtils.clamp((aspect - 2.02) / 1.15, 0, 1);
      this.responsiveBaseFov = THREE.MathUtils.lerp(53, 47.5, t);
      this.rimScaleX = 1.0 + t * 0.34;
      this.rimScaleY = height < 460 ? 0.90 : 1.0;
      this.rimBaseY = height < 460 ? -0.14 : -0.03 * t;
    } else {
      // Standard 16:9 / 16:10 landscape (desktop & mobile landscape)
      this.responsiveBaseFov = 53;
      this.rimScaleX = 1.0;
      this.rimScaleY = height < 460 ? 0.92 : 1.0;
      this.rimBaseY = height < 460 ? -0.12 : 0;
    }

    if (this.asteroidRim) {
      this.asteroidRim.group.scale.set(this.rimScaleX, this.rimScaleY, 1.0);
    }
  }

  private initScene(): void {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.currentDpr = this.computeTargetDpr(width, height);
    this.computeResponsiveFraming(width, height);
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.container.appendChild(canvas);

    this.scene = new THREE.Scene();
    // True optical deep-space vacuum (zero FogExp2 haze dimming distant planets & stars)
    this.scene.background = new THREE.Color(0x000003);

    // Procedural RoomEnvironment PMREM generated on every device for crisp metallic/ice glints
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.24;
    pmremGenerator.dispose();

    // First-person camera mounted inside inertial cameraRig carrying the jagged asteroid rim
    this.camera = new THREE.PerspectiveCamera(this.responsiveBaseFov, width / height, 0.15, 6500);
    this.camera.rotation.order = 'YXZ';
    this.cameraRig = new THREE.Group();
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    // Single Unified World-Taste Lighting Rig:
    // 1. True Radial Solar PointLight at the Sun's exact origin (0,0,0) with zero-decay calibrated
    //    NASA exposure so every planet, moon, atmosphere limb, Saturn ring shadow, and Earth
    //    night terminator share 100% identical solar geometry across 30 AU to 0.09 AU.
    const solarRadialLight = new THREE.PointLight(0xfff6e8, 2.25, 0, 0);
    solarRadialLight.position.set(0, 0, 0);
    this.scene.add(solarRadialLight);

    // 2. Tight-frustum Solar Shadow Key Light tracking true Sun->Asteroid vector for crisp raking
    //    self-shadows across the jagged foreground asteroid rim.
    this.sunKeyLight = new THREE.DirectionalLight(0xfff4e4, 1.35);
    this.sunKeyLight.castShadow = !this.isSoftwareGl;
    this.sunKeyLight.shadow.mapSize.set(this.isMobile ? 512 : 1024, this.isMobile ? 512 : 1024);
    this.sunKeyLight.shadow.camera.near = 1;
    this.sunKeyLight.shadow.camera.far = 36;
    const d = 5.5;
    this.sunKeyLight.shadow.camera.left = -d;
    this.sunKeyLight.shadow.camera.right = d;
    this.sunKeyLight.shadow.camera.top = d;
    this.sunKeyLight.shadow.camera.bottom = -d;
    this.sunKeyLight.shadow.bias = -0.0005;
    this.sunKeyLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunKeyLight);
    this.scene.add(this.sunKeyLight.target);

    // 3. Subtle cool deep-space starlight HemisphereLight fill (prevents crushed pitch-black crevices)
    this.hemiFillLight = new THREE.HemisphereLight(0x3a4f72, 0x0b0e16, 0.32);
    this.scene.add(this.hemiFillLight);

    // 4. Dynamic subtle planetary albedo bounce light illuminating the shadowed asteroid rim on flybys
    this.bouncePointLight = new THREE.PointLight(0x4b74b8, 0.0, 26, 1.5);
    this.cameraRig.add(this.bouncePointLight);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // Build cohesive Solar System world & composite 9-part foreground asteroid rim
    this.world = createSolarSystemWorld(maxAniso, this.isMobile);
    this.scene.add(this.world.root);

    this.asteroidRim = createAsteroidRim(this.world.sunPosition, maxAniso, this.isSoftwareGl);
    this.asteroidRim.group.scale.set(this.rimScaleX, this.rimScaleY, 1.0);
    this.cameraRig.add(this.asteroidRim.group);

    // Lean hardware-MSAA EffectComposer on real GPUs (skipped cleanly on software WebGL)
    if (!this.isSoftwareGl) {
      const physW = Math.max(1, Math.floor(width * this.currentDpr));
      const physH = Math.max(1, Math.floor(height * this.currentDpr));
      const isWebGL2 = this.renderer.capabilities.isWebGL2;

      // Enable hardware MSAA samples on HalfFloat render target so edges never alias or blur
      const renderTarget = new THREE.WebGLRenderTarget(physW, physH, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        samples: isWebGL2 ? (this.isMobile ? 2 : 4) : 0,
      });
      this.composer = new EffectComposer(this.renderer, renderTarget);
      this.composer.setPixelRatio(this.currentDpr);
      this.composer.setSize(width, height);

      this.composer.addPass(new RenderPass(this.scene, this.camera));

      // Strictly HDR optical bloom (threshold 1.08 keeps sunlit planets & asteroids 100% razor-sharp)
      const bloomScale = this.isMobile ? 0.5 : 0.75;
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          Math.max(1, Math.floor(width * bloomScale)),
          Math.max(1, Math.floor(height * bloomScale)),
        ),
        0.34, // strength
        0.38, // radius
        1.08, // threshold (HDR solar corona & ice sparkles only — zero planetary wash)
      );
      this.composer.addPass(this.bloomPass);

      // Unified single-pass CAS sharpening + peripheral velocity blur + volumetric solar rays
      this.cinematicPass = new ShaderPass(CinematicPostShader);
      this.cinematicPass.uniforms.uResolution.value.set(physW, physH);
      this.composer.addPass(this.cinematicPass);

      // Final ACESFilmic tone mapping + sRGB encoding pass
      this.composer.addPass(new OutputPass());

      // Pre-warm shaders once on hardware GPU to avoid first-frame stutter
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private readonly handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.currentDpr = Math.min(this.currentDpr, this.computeTargetDpr(width, height));
    if (!this.isSoftwareGl && this.slowFrameAccum < 0.5) {
      this.currentDpr = this.computeTargetDpr(width, height);
    }
    this.computeResponsiveFraming(width, height);

    this.camera.aspect = width / height;
    this.camera.fov = this.responsiveBaseFov;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setPixelRatio(this.currentDpr);
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      const bloomScale = this.isMobile ? 0.5 : 0.75;
      this.bloomPass.resolution.set(
        Math.max(1, Math.floor(width * bloomScale)),
        Math.max(1, Math.floor(height * bloomScale)),
      );
    }
    if (this.cinematicPass) {
      this.cinematicPass.uniforms.uResolution.value.set(
        Math.max(1, Math.floor(width * this.currentDpr)),
        Math.max(1, Math.floor(height * this.currentDpr)),
      );
    }
  };

  public syncViewport(): void {
    this.handleResize();
  }

  private readonly handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost(true);
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.callbacks.onContextLost(false);
    this.lastNow = performance.now();
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize, { passive: true });
    window.addEventListener('orientationchange', this.handleResize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored, false);
  }

  public startVoyage(): void {
    this.paused = false;
    this.audio.setPaused(false);
    if (!this.started) {
      this.started = true;
      this.hudDirty = true;
      this.audio.triggerVoyageLaunch();
    }
  }

  public setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.audio.setPaused(paused);
    if (paused) {
      this.steerInput = 0;
      this.verticalInput = 0;
      this.freeLookKeyYaw = 0;
      this.freeLookKeyPitch = 0;
    } else {
      this.lastNow = performance.now();
    }
  }

  private resetSimulationState(started: boolean): void {
    this.started = started;
    this.paused = false;
    this.launchRamp = 0;
    this.progress = this.initialProgress;
    this.steerInput = 0;
    this.smoothedSteer = 0;
    this.lateralOffset = 0;
    this.lateralVelocity = 0;
    this.verticalInput = 0;
    this.smoothedVertical = 0;
    this.verticalOffset = 0;
    this.verticalVelocity = 0;
    this.bankAngle = 0;
    this.pitchAngle = 0;
    this.cameraShake = 0;
    this.nearMissFlash = 0;
    this.health = 1.0;
    this.isRecharging = false;
    this.rechargeElapsed = 0;
    this.rechargePulseAccum = 0;
    this.freeLookYaw = 0;
    this.freeLookPitch = 0;
    this.freeLookTargetYaw = 0;
    this.freeLookTargetPitch = 0;
    this.freeLookKeyYaw = 0;
    this.freeLookKeyPitch = 0;
    this.camera.quaternion.identity();
    this.camera.position.set(0, 0, 0);
    this.camera.fov = this.responsiveBaseFov;
    this.camera.updateProjectionMatrix();
    this.asteroidRim.group.position.set(0, this.rimBaseY, 0);
    this.asteroidRim.group.rotation.set(0, 0, 0);
    this.world.reset();

    // Snap camera rig immediately to initial Neptune approach frame
    this.world.spline.getPointAt(this.progress, this._splinePos);
    const lookT = (this.progress + 0.008) % 1.0;
    this.world.spline.getPointAt(lookT, this._lookPos);
    this._tangent.subVectors(this._lookPos, this._splinePos).normalize();
    this._right.crossVectors(this._tangent, this._worldUp).normalize();
    if (this._right.lengthSq() < 0.001) this._right.set(1, 0, 0);
    this._up.crossVectors(this._right, this._tangent).normalize();
    this.cameraRig.position.copy(this._splinePos);
    this._lookMatrix.lookAt(this._splinePos, this._lookPos, this._up);
    this.cameraRig.quaternion.setFromRotationMatrix(this._lookMatrix);

    this.lastSectorId = '';
    this.hudDirty = true;
    this.lastNow = performance.now();
  }

  public restartVoyage(): void {
    this.resetSimulationState(true);
    this.audio.setPaused(false);
    this.audio.triggerVoyageLaunch();
  }

  public quitToHome(): void {
    this.resetSimulationState(false);
    this.audio.setPaused(true);
  }

  public addFreeLookDelta(dx: number, dy: number): void {
    if (!this.started || this.paused || !this.isRecharging) return;
    const sensitivity = 0.0052;
    this.freeLookTargetYaw -= dx * sensitivity;
    this.freeLookTargetPitch = THREE.MathUtils.clamp(
      this.freeLookTargetPitch - dy * sensitivity,
      -Math.PI * 0.47,
      Math.PI * 0.47,
    );
  }

  public setFreeLookKeyVelocity(yawDir: -1 | 0 | 1, pitchDir: -1 | 0 | 1): void {
    if (!this.started || this.paused || !this.isRecharging) {
      this.freeLookKeyYaw = 0;
      this.freeLookKeyPitch = 0;
      return;
    }
    this.freeLookKeyYaw = yawDir;
    this.freeLookKeyPitch = pitchDir;
  }

  public setSteerInput(dir: -1 | 0 | 1): void {
    if (!this.started || this.paused || this.isRecharging) {
      if (this.steerInput !== 0) {
        this.steerInput = 0;
      }
      return;
    }
    const prev = this.steerInput;
    this.steerInput = dir;
    if (dir !== 0 && prev === 0) {
      this.haptics.steeringEngage();
    } else if (dir === 0 && prev !== 0) {
      this.haptics.steeringRelease();
    }
  }

  public setVerticalInput(dir: -1 | 0 | 1): void {
    if (!this.started || this.paused || this.isRecharging) {
      this.verticalInput = 0;
      return;
    }
    this.verticalInput = dir;
  }

  public setFlightInput(horiz: -1 | 0 | 1, vert: -1 | 0 | 1): void {
    this.setSteerInput(horiz);
    this.setVerticalInput(vert);
  }

  /**
   * Software-WebGL GPU sync pacing per threejs skill (§2.3) so CPU rasterizers never starve the UI thread.
   */
  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private readonly tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.max(0.001, (now - this.lastNow) * 0.001);
    const dt = Math.min(rawDt, 0.065);
    this.lastNow = now;

    if (!this.contextLost) {
      if (!this.paused) {
        this.elapsedTime += dt;
        this.stepSimulation(dt, now);
      }
      if (this.isSoftwareGl || !this.composer) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.composer.render();
      }

      // Universal adaptive DPR guard (keeps both mid-range mobile & integrated PC GPUs smooth)
      if (!this.isSoftwareGl && this.currentDpr > 1.2) {
        if (rawDt > 0.036) {
          this.slowFrameAccum += rawDt;
          if (this.slowFrameAccum > 3.0) {
            this.currentDpr = Math.max(1.2, this.currentDpr - 0.25);
            this.renderer.setPixelRatio(this.currentDpr);
            this.composer?.setPixelRatio(this.currentDpr);
            if (this.cinematicPass) {
              const w = Math.max(1, this.container.clientWidth || window.innerWidth);
              const h = Math.max(1, this.container.clientHeight || window.innerHeight);
              this.cinematicPass.uniforms.uResolution.value.set(
                Math.max(1, Math.floor(w * this.currentDpr)),
                Math.max(1, Math.floor(h * this.currentDpr)),
              );
            }
            this.slowFrameAccum = 0;
          }
        } else {
          this.slowFrameAccum = Math.max(0, this.slowFrameAccum - rawDt * 0.5);
        }
      }
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private stepSimulation(dt: number, nowMs: number): void {
    // Advance 1-minute recharge cycle when hull integrity hits 0
    if (this.isRecharging) {
      this.steerInput = 0;
      this.verticalInput = 0;
      this.rechargeElapsed += dt;
      this.rechargePulseAccum += dt;
      const currentProgress = Math.min(1, this.rechargeElapsed / this.rechargeDuration);

      if (this.rechargePulseAccum >= 1.8) {
        this.rechargePulseAccum -= 1.8;
        this.audio.triggerRechargePulse(currentProgress);
      }

      if (this.rechargeElapsed >= this.rechargeDuration) {
        this.isRecharging = false;
        this.rechargeElapsed = 0;
        this.rechargePulseAccum = 0;
        this.health = 1.0;
        // Shortest-arc unwrap so 360° free-look glides smoothly back to dead-ahead when travel resumes
        const twoPi = Math.PI * 2;
        this.freeLookYaw = ((((this.freeLookYaw + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
        this.freeLookTargetYaw = 0;
        this.freeLookTargetPitch = 0;
        this.freeLookKeyYaw = 0;
        this.freeLookKeyPitch = 0;
        this.hudDirty = true;
        this.audio.triggerRechargeComplete();
        this.haptics.rechargeComplete();
      }
    }

    const travelActive = this.started && !this.isRecharging;
    const rechargeProgress = this.isRecharging
      ? Math.min(1, this.rechargeElapsed / this.rechargeDuration)
      : 0;

    // Smoothly accelerate from welcome-screen hover or brake cleanly to a halt during 1-minute recharge
    this.launchRamp = THREE.MathUtils.damp(
      this.launchRamp,
      travelActive ? 1.0 : 0.0,
      this.isRecharging ? 4.2 : 2.6,
      dt,
    );
    if (!travelActive && this.launchRamp < 0.002) {
      this.launchRamp = 0;
    }

    // 1. Keplerian-inspired orbital speed curve: calm outer cruise -> accelerating through belt -> blistering Perihelion slingshot
    const perihelionBell = Math.exp(-Math.pow((this.progress - 0.905) / 0.075, 2));
    const returnBoost = this.progress > 0.945 ? 1.65 : 0;
    const baseRate = 0.0044; // ~155s full solar system voyage
    const progressRate = baseRate * (1.0 + perihelionBell * 1.45 + returnBoost) * this.launchRamp;
    this.progress = (this.progress + progressRate * dt) % 1.0;

    // Normalized kinetic speed [0..1] for motion blur, FOV, dust streaks, and audio
    const rawVelocityNorm = Math.min(
      1.0,
      0.24 +
        perihelionBell * 0.68 +
        (this.progress > 0.945 ? 0.32 : 0) +
        (Math.abs(this.lateralVelocity) + Math.abs(this.verticalVelocity) * 0.7) * 0.012,
    );
    const velocityNorm = rawVelocityNorm * this.launchRamp;

    // 2. Evaluate spline frame (position, forward tangent, right, up)
    this.world.spline.getPointAt(this.progress, this._splinePos);
    const lookT = (this.progress + 0.008) % 1.0;
    this.world.spline.getPointAt(lookT, this._lookPos);
    this._tangent.subVectors(this._lookPos, this._splinePos).normalize();

    this._right.crossVectors(this._tangent, this._worldUp).normalize();
    if (this._right.lengthSq() < 0.001) this._right.set(1, 0, 0);
    this._up.crossVectors(this._right, this._tangent).normalize();

    // 3. Smooth spring-damped side-edge touch & PC 4-way WASD steering physics
    const steerDamp = 1 - Math.exp(-7.5 * dt);
    this.smoothedSteer += (this.steerInput - this.smoothedSteer) * steerDamp;
    this.smoothedVertical += (this.verticalInput - this.smoothedVertical) * steerDamp;

    if (travelActive && this.steerInput !== 0) {
      this.haptics.steeringHoldTick();
    }

    const maxLateral = 16.5;
    const lateralAccel = travelActive ? this.smoothedSteer * 34.0 : 0;
    // Gentle orbital restoring force pulls asteroid smoothly back toward natural spline when released
    const restoringAccel = !travelActive
      ? 0
      : this.steerInput === 0
        ? -this.lateralOffset * 1.15
        : -this.lateralOffset * 0.22;
    this.lateralVelocity += (lateralAccel + restoringAccel) * dt;
    this.lateralVelocity *= Math.exp((travelActive ? -2.8 : -5.2) * dt);
    this.lateralOffset += this.lateralVelocity * dt;

    if (this.lateralOffset > maxLateral) {
      this.lateralOffset = maxLateral;
      this.lateralVelocity = Math.min(0, this.lateralVelocity);
    } else if (this.lateralOffset < -maxLateral) {
      this.lateralOffset = -maxLateral;
      this.lateralVelocity = Math.max(0, this.lateralVelocity);
    }

    // Smooth vertical pitch/elevation steering for PC W/S (Up/Down) dodging
    const maxVertical = 8.4;
    const verticalAccel = travelActive ? this.smoothedVertical * 24.0 : 0;
    const verticalRestoring = !travelActive
      ? 0
      : this.verticalInput === 0
        ? -this.verticalOffset * 1.25
        : -this.verticalOffset * 0.24;
    this.verticalVelocity += (verticalAccel + verticalRestoring) * dt;
    this.verticalVelocity *= Math.exp((travelActive ? -3.0 : -5.2) * dt);
    this.verticalOffset += this.verticalVelocity * dt;

    if (this.verticalOffset > maxVertical) {
      this.verticalOffset = maxVertical;
      this.verticalVelocity = Math.min(0, this.verticalVelocity);
    } else if (this.verticalOffset < -maxVertical) {
      this.verticalOffset = -maxVertical;
      this.verticalVelocity = Math.max(0, this.verticalVelocity);
    }

    // Natural banking roll & pitch angles + subtle organic asteroid wobble
    const targetBank =
      (-this.smoothedSteer * 0.30 -
        this.lateralVelocity * 0.009 +
        Math.sin(this.elapsedTime * 0.38) * 0.032) *
      this.launchRamp;
    this.bankAngle = THREE.MathUtils.damp(this.bankAngle, targetBank, 5.2, dt);

    const targetPitch =
      (this.smoothedVertical * 0.14 + this.verticalVelocity * 0.006) * this.launchRamp;
    this.pitchAngle = THREE.MathUtils.damp(this.pitchAngle, targetPitch, 5.5, dt);

    // Final world camera rig position with lateral + vertical steering displacement & gentle drift
    const vertBob = Math.sin(this.elapsedTime * 0.55) * 0.42 * this.launchRamp;
    const totalVertical = this.verticalOffset + vertBob;
    this._camPos
      .copy(this._splinePos)
      .addScaledVector(this._right, this.lateralOffset)
      .addScaledVector(this._up, totalVertical);

    this.cameraRig.position.copy(this._camPos);

    // Look slightly ahead along the steered curve so turning & climbing feel kinetic and directed
    this._lookPos
      .addScaledVector(this._right, this.lateralOffset * 0.85 + this.smoothedSteer * 4.2)
      .addScaledVector(this._up, this.verticalOffset * 0.85 + this.smoothedVertical * 2.8 + vertBob * 0.6);
    this._lookMatrix.lookAt(this._camPos, this._lookPos, this._up);
    this._targetQuat.setFromRotationMatrix(this._lookMatrix);
    this._pitchQuat.setFromAxisAngle(this._xAxis, this.pitchAngle);
    this._rollQuat.setFromAxisAngle(this._zAxis, this.bankAngle);
    this._targetQuat.multiply(this._pitchQuat).multiply(this._rollQuat);

    this.cameraRig.quaternion.slerp(this._targetQuat, 1 - Math.exp(-8.5 * dt));
    this._camForward.set(0, 0, -1).applyQuaternion(this.cameraRig.quaternion).normalize();

    // 4. Foreground jagged asteroid rim inertial parallax & micro-vibration
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.8);
    this.nearMissFlash = Math.max(0, this.nearMissFlash - dt * 2.4);

    const shakeMag = this.cameraShake * 0.075;
    this.camera.position.set(
      (Math.sin(this.elapsedTime * 54) * 0.6 + Math.cos(this.elapsedTime * 37) * 0.4) * shakeMag,
      (Math.cos(this.elapsedTime * 49) * 0.6 + Math.sin(this.elapsedTime * 29) * 0.4) * shakeMag,
      0,
    );

    // 360° Free-Look Camera during rest/recharge stasis (glides back to 0° automatically once HP refills)
    if (this.isRecharging) {
      if (this.freeLookKeyYaw !== 0) {
        this.freeLookTargetYaw -= this.freeLookKeyYaw * 1.65 * dt;
      }
      if (this.freeLookKeyPitch !== 0) {
        this.freeLookTargetPitch = THREE.MathUtils.clamp(
          this.freeLookTargetPitch + this.freeLookKeyPitch * 1.25 * dt,
          -Math.PI * 0.47,
          Math.PI * 0.47,
        );
      }
    }
    const lookLambda = this.isRecharging ? 10.0 : 4.6;
    this.freeLookYaw = THREE.MathUtils.damp(this.freeLookYaw, this.freeLookTargetYaw, lookLambda, dt);
    this.freeLookPitch = THREE.MathUtils.damp(this.freeLookPitch, this.freeLookTargetPitch, lookLambda, dt);
    if (!this.isRecharging && Math.abs(this.freeLookYaw) < 0.0004 && Math.abs(this.freeLookPitch) < 0.0004) {
      this.freeLookYaw = 0;
      this.freeLookPitch = 0;
    }
    this._freeLookEuler.set(this.freeLookPitch, this.freeLookYaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._freeLookEuler);

    // Aspect-compensated velocity-coupled cinematic FOV widening
    const targetFov =
      this.responsiveBaseFov +
      velocityNorm * 12 +
      Math.abs(this.smoothedSteer) * 2.4 +
      Math.abs(this.smoothedVertical) * 1.4;
    if (Math.abs(this.camera.fov - targetFov) > 0.02) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.0, dt);
      this.camera.updateProjectionMatrix();
    }

    // Counter-roll, pitch & subtle inertia shift on foreground asteroid prow
    this.asteroidRim.group.position.x = THREE.MathUtils.damp(
      this.asteroidRim.group.position.x,
      -this.smoothedSteer * 0.16,
      5.0,
      dt,
    );
    const targetRimY =
      this.rimBaseY -
      this.smoothedVertical * 0.095 +
      Math.sin(this.elapsedTime * 1.15) * 0.018 +
      (this.cameraShake > 0.01 ? shakeMag * 0.6 : 0);
    this.asteroidRim.group.position.y = THREE.MathUtils.damp(
      this.asteroidRim.group.position.y,
      targetRimY,
      6.5,
      dt,
    );
    this.asteroidRim.group.rotation.z = THREE.MathUtils.damp(
      this.asteroidRim.group.rotation.z,
      this.smoothedSteer * 0.085,
      5.0,
      dt,
    );
    this.asteroidRim.group.rotation.x = THREE.MathUtils.damp(
      this.asteroidRim.group.rotation.x,
      Math.sin(this.elapsedTime * 0.72) * 0.014 - this.smoothedVertical * 0.055,
      5.5,
      dt,
    );

    // 5. True Solar Distance, Heat & Unified Directional Solar Key Light
    const distToSun = this._camPos.distanceTo(this.world.sunPosition);
    const solarHeat = THREE.MathUtils.clamp(1.0 - (distToSun - 42) / 145, 0, 1);

    this._toSun.subVectors(this.world.sunPosition, this._camPos).normalize();
    this.sunKeyLight.position.copy(this._camPos).addScaledVector(this._toSun, 18);
    this.sunKeyLight.target.position.copy(this._camPos).addScaledVector(this._camForward, 2.2);
    this.sunKeyLight.target.updateMatrixWorld();

    // Subtle irradiance climb as we dive closer to the Sun (world-taste capped so no white-out!)
    this.sunKeyLight.intensity = 2.85 + solarHeat * 1.45;
    this.sunKeyLight.color.setRGB(1.0, 0.96 - solarHeat * 0.05, 0.92 - solarHeat * 0.14);

    // 6. Planetary Sector Gravity Wells, Bounce Fill & Active Caption
    let activeSector: SectorInfo | null = null;
    let strongestGravity = 0;
    let harmonicIndex = 0;
    let nearestSectorDist = Infinity;

    for (let i = 0; i < this.world.sectors.length; i++) {
      const s = this.world.sectors[i];
      const dtSpline = Math.min(
        Math.abs(this.progress - s.splineT),
        1 - Math.abs(this.progress - s.splineT),
      );
      if (dtSpline < s.windowRadius) {
        activeSector = s;
      }

      const dPlanet = this._camPos.distanceTo(s.position);
      if (dPlanet < nearestSectorDist) {
        nearestSectorDist = dPlanet;
        harmonicIndex = s.harmonicIndex;
      }
      if (dPlanet < s.gravityRadius) {
        const g = Math.pow(1 - dPlanet / s.gravityRadius, 1.6) * s.gravityStrength;
        if (g > strongestGravity) {
          strongestGravity = g;
          this._targetBounceColor.copy(s.bounceTint);
          // Position subtle bounce fill on side of planet relative to asteroid rim
          this.bouncePointLight.position
            .subVectors(s.position, this._camPos)
            .normalize()
            .multiplyScalar(4.5);
        }
      }
    }

    this.bouncePointLight.color.lerp(this._targetBounceColor, 1 - Math.exp(-3.0 * dt));
    this.bouncePointLight.intensity = THREE.MathUtils.damp(
      this.bouncePointLight.intensity,
      strongestGravity * 2.2,
      3.5,
      dt,
    );

    if (travelActive) {
      if (solarHeat > 0.3) {
        this.haptics.perihelionRumble(solarHeat);
      } else if (strongestGravity > 0.25) {
        this.haptics.gravityWellPulse(strongestGravity);
      }
    }

    // 7. Physical Asteroid Collision (Chunk Break-Off on Impacted Portion) & Near-Miss Grazing
    if (travelActive) {
      // Physical contact center of our jagged foreground asteroid prow
      this._prowPos
        .copy(this._camPos)
        .addScaledVector(this._camForward, 2.2)
        .addScaledVector(this._up, -0.5);

      const debrisList = this.world.debris;
      for (let i = 0; i < debrisList.length; i++) {
        const rock = debrisList[i];
        const dx = rock.x - this._prowPos.x;
        if (Math.abs(dx) > 15) continue;
        const dy = rock.y - this._prowPos.y;
        if (Math.abs(dy) > 15) continue;
        const dz = rock.z - this._prowPos.z;
        if (Math.abs(dz) > 15) continue;

        const distSq = dx * dx + dy * dy + dz * dz;
        const collisionR = rock.radius + 2.45;
        const nearMissR = rock.radius + 6.2;

        if (
          distSq < collisionR * collisionR &&
          this.elapsedTime - rock.lastCollisionTime > 1.8
        ) {
          // Physical collision! Compute exact contact portion on the struck asteroid
          rock.lastCollisionTime = this.elapsedTime;
          rock.lastNearMissTime = this.elapsedTime;

          const dist = Math.max(0.001, Math.sqrt(distSq));
          const impactIntensity = THREE.MathUtils.clamp(1.15 - dist / collisionR, 0.45, 1.0);

          // Normal pointing from struck rock's center toward our asteroid prow contact zone
          this._impactNormal.set(-dx / dist, -dy / dist, -dz / dist);
          this._impactPoint.set(
            rock.x + this._impactNormal.x * rock.radius * 0.72,
            rock.y + this._impactNormal.y * rock.radius * 0.72,
            rock.z + this._impactNormal.z * rock.radius * 0.72,
          );

          // Fracture chunks off the collided portion & deflect the remaining asteroid bulk
          this.world.fractureAsteroid(
            rock,
            this._impactPoint,
            this._impactNormal,
            this._camForward,
            velocityNorm,
          );

          // Stereo pan & physical lateral recoil kick away from the collided asteroid
          this._toDebris.set(dx, dy, dz).normalize();
          const pan = this._toDebris.dot(this._right);
          const recoilSign = pan >= 0 ? -1 : 1;
          this.lateralVelocity += recoilSign * (5.5 + impactIntensity * 6.5);

          this.cameraShake = Math.min(1.0, this.cameraShake + 0.65 + impactIntensity * 0.45);
          this.nearMissFlash = Math.min(1.0, this.nearMissFlash + 0.55 + impactIntensity * 0.45);

          // Deplete health bar on each collision; reaching 0 halts travel for 1-minute recharge
          const damage = 0.18 + impactIntensity * 0.10;
          this.health = Math.max(0, this.health - damage);
          this.hudDirty = true;

          this.haptics.collisionImpact(impactIntensity, rock.isIce);
          this.audio.triggerCollisionImpact(pan, impactIntensity, rock.isIce);

          if (this.health <= 0.001) {
            this.health = 0;
            this.isRecharging = true;
            this.rechargeElapsed = 0;
            this.rechargePulseAccum = 0.9;
            this.steerInput = 0;
            this.verticalInput = 0;
            this.audio.triggerTravelStall();
            this.haptics.stallShutdown();
            break;
          } else {
            this.audio.triggerHullStress(this.health);
          }
        } else if (
          distSq < nearMissR * nearMissR &&
          this.elapsedTime - rock.lastNearMissTime > 3.5
        ) {
          rock.lastNearMissTime = this.elapsedTime;
          const dist = Math.sqrt(distSq);
          const closeness = THREE.MathUtils.clamp(1 - dist / nearMissR, 0.25, 1.0);

          this._toDebris.set(dx, dy, dz).normalize();
          const pan = this._toDebris.dot(this._right);

          this.cameraShake = Math.min(1.0, this.cameraShake + closeness * 0.62);
          this.nearMissFlash = Math.min(1.0, this.nearMissFlash + closeness * 0.52);

          this.haptics.debrisNearMiss(closeness, rock.isIce);
          this.audio.triggerDebrisFlyby(pan, closeness, rock.isIce);
        }
      }
    }

    // 8. Update Asteroid Rim, Solar System Bodies & Post-Processing Uniforms
    this.asteroidRim.update(dt, this.elapsedTime, this.world.sunPosition, solarHeat, velocityNorm);
    this.world.update(dt, this.elapsedTime, this._camPos, this._camForward, velocityNorm);

    if (this.cinematicPass) {
      // Project Sun world position into screen UV [0..1] using live 360° camera look vector
      this.camera.updateMatrixWorld();
      this.camera.getWorldDirection(this._viewForward);
      this._sunNdc.copy(this.world.sunPosition).project(this.camera);
      const facingSun = this._viewForward.dot(this._toSun);
      const inFront = this._sunNdc.z < 1.0 && facingSun > 0.05;
      const sunUvX = this._sunNdc.x * 0.5 + 0.5;
      const sunUvY = this._sunNdc.y * 0.5 + 0.5;

      // Soft screen-edge fade so volumetric shafts sweep naturally as the Sun enters frame
      const edgeFade =
        inFront
          ? THREE.MathUtils.clamp(1.35 - Math.hypot(sunUvX - 0.5, sunUvY - 0.5) * 1.25, 0, 1) *
            THREE.MathUtils.smoothstep(facingSun, 0.05, 0.45)
          : 0;

      const u = this.cinematicPass.uniforms;
      u.uSunUv.value.set(
        THREE.MathUtils.clamp(sunUvX, -0.2, 1.2),
        THREE.MathUtils.clamp(sunUvY, -0.2, 1.2),
      );
      u.uSunVisibility.value = THREE.MathUtils.damp(
        u.uSunVisibility.value,
        edgeFade * (0.58 + solarHeat * 0.62),
        5.0,
        dt,
      );
      u.uMotionBlur.value = THREE.MathUtils.damp(
        u.uMotionBlur.value,
        (0.16 + velocityNorm * 0.85) * this.launchRamp +
          Math.abs(this.smoothedSteer) * 0.25 +
          this.nearMissFlash * 0.35,
        5.5,
        dt,
      );
      u.uSteerSkew.value = THREE.MathUtils.damp(u.uSteerSkew.value, this.smoothedSteer, 6.0, dt);
      u.uHeatRefract.value = THREE.MathUtils.damp(
        u.uHeatRefract.value,
        solarHeat * 0.95 + this.nearMissFlash * 0.48,
        4.5,
        dt,
      );
      u.uTime.value = this.elapsedTime;
    }

    // 9. Feed live telemetry into generative spatial Web Audio synthesizer
    this.audio.updateTelemetry(
      harmonicIndex,
      velocityNorm,
      strongestGravity,
      solarHeat,
      this.smoothedSteer,
      this.isRecharging,
      rechargeProgress,
    );

    // 10. Throttled minimal sector & health HUD update (immediate on collision/recharge transitions)
    const hudInterval = this.isRecharging ? 150 : 240;
    if (
      this.hudDirty ||
      nowMs - this.lastHudPushAt > hudInterval ||
      (activeSector?.id ?? '') !== this.lastSectorId
    ) {
      this.hudDirty = false;
      this.lastHudPushAt = nowMs;
      this.lastSectorId = activeSector?.id ?? '';
      const velocityKmS =
        this.launchRamp > 0.02
          ? Math.round((28 + rawVelocityNorm * 64 + solarHeat * 48) * this.launchRamp)
          : 0;
      this.callbacks.onHudUpdate({
        sectorName: activeSector ? activeSector.name : 'Interplanetary Void',
        sectorSubtitle: activeSector ? activeSector.subtitle : 'Heliocentric Dive',
        distanceAu: activeSector
          ? activeSector.distanceAu
          : `${Math.max(0.12, distToSun / 70).toFixed(2)} AU`,
        velocityKmS,
        visible: activeSector !== null,
        health: this.health,
        isRecharging: this.isRecharging,
        rechargeProgress,
        rechargeRemainingSec: this.isRecharging
          ? Math.ceil(Math.max(0, this.rechargeDuration - this.rechargeElapsed))
          : 0,
      });
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    }

    this.world?.dispose();
    this.asteroidRim?.dispose();
    this.envRT?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();

    if (this.renderer?.domElement && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
