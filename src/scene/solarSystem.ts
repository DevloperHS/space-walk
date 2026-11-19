import * as THREE from 'three';
import { createRng, evaluateCraterHeight, fbm3D, generateSphereCraters, ridged3D } from './noise';
import {
  createAtmosphereMaterial,
  createEarthNightLightsMaterial,
  createRefractiveIceMaterial,
  createSaturnRingMaterial,
  createSolarCoronaMaterial,
  createSunPhotosphereMaterial,
  enhanceMaterialWithMicroDetail,
} from './shaders';
import {
  AsteroidSurfaceStyle,
  createCrateredBodyTextures,
  createDiverseAsteroidTextures,
  createEarthTextures,
  createJupiterTextures,
  createMarsTextures,
  createNeptuneTextures,
  createSaturnTextures,
  createSoftRadialGlowTexture,
  createUranusTextures,
  createVenusTextures,
} from './textures';

/**
 * Cohesive World-Taste Solar System Builder:
 * - Grand looping CatmullRomCurve3 trajectory diving from Neptune inward to Solar Perihelion
 * - Crisp 6,500-star color-temperature-accurate starfield + restrained NASA Milky Way band
 * - All 8 planets + Earth's Moon + Sun placed for sweeping dramatic parallax flybys
 * - 8 distinct procedurally sculpted InstancedMesh asteroid classes with bespoke world-taste
 *   PBR surface textures & morphologies (C-type diamond-top rubble, 67P contact-binary,
 *   S-type grooved silicate, M-type cleaved nickel-iron, V-type crater-basin basalt,
 *   veined tectonic slab, prismatic Saturnian ice shard, and frosted Kuiper comet nucleus)
 *   with live spatial records so steering sideways tangibly dodges tumbling rocks!
 */

export interface SectorInfo {
  id: string;
  name: string;
  subtitle: string;
  distanceAu: string;
  splineT: number;
  windowRadius: number;
  position: THREE.Vector3;
  gravityRadius: number;
  gravityStrength: number;
  bounceTint: THREE.Color;
  harmonicIndex: number;
}

export interface DebrisBody {
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeY: number;
  homeZ: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  homeRadius: number;
  isIce: boolean;
  meshIndex: number;
  instanceId: number;
  rx: number;
  ry: number;
  rz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  sx: number;
  sy: number;
  sz: number;
  homeSx: number;
  homeSy: number;
  homeSz: number;
  collided: boolean;
  lastNearMissTime: number;
  lastCollisionTime: number;
}

export interface SolarSystemWorld {
  root: THREE.Group;
  spline: THREE.CatmullRomCurve3;
  sunPosition: THREE.Vector3;
  sectors: SectorInfo[];
  debris: DebrisBody[];
  dustStreaks: THREE.InstancedMesh;
  fractureAsteroid: (
    rock: DebrisBody,
    impactPoint: THREE.Vector3,
    impactNormal: THREE.Vector3,
    cameraForward: THREE.Vector3,
    velocityNorm: number,
  ) => void;
  update: (
    dt: number,
    time: number,
    cameraPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
    velocityNorm: number,
  ) => void;
  reset: () => void;
  dispose: () => void;
}

type AsteroidShapeKind =
  | 'diamondTop'
  | 'contactBinary'
  | 'curvedPotato'
  | 'cleavedMetallic'
  | 'crateredBasin'
  | 'tectonicSlab'
  | 'crystalShard'
  | 'pittedComet';

function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Generates 8 unmistakably distinct world-taste procedural asteroid silhouettes
 * grounded in real NASA/ESA spacecraft flyby morphologies (Bennu, 67P/Arrokoth,
 * Eros, 16 Psyche, 4 Vesta, Oumuamua slabs, Saturnian crystal ice, Kuiper comets).
 */
function buildDiverseAsteroidGeometry(
  shape: AsteroidShapeKind,
  seed: number,
  detail = 3,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const rng = createRng(seed * 7919 + 131);

  // Pre-generate deterministic spherical craters for cratered morphologies
  const craters =
    shape === 'diamondTop'
      ? generateSphereCraters(12, seed + 11, 0.14, 0.34)
      : shape === 'contactBinary'
        ? generateSphereCraters(9, seed + 23, 0.12, 0.28)
        : shape === 'curvedPotato'
          ? generateSphereCraters(14, seed + 37, 0.12, 0.32)
          : shape === 'crateredBasin'
            ? generateSphereCraters(11, seed + 53, 0.12, 0.28)
            : shape === 'pittedComet'
              ? generateSphereCraters(18, seed + 71, 0.11, 0.27)
              : shape === 'cleavedMetallic'
                ? generateSphereCraters(6, seed + 89, 0.10, 0.22)
                : [];

  // Dominant giant Rheasilvia-style impact basin for V-type cratered boulder
  const giantBasinDir = new THREE.Vector3(0.35, -0.78, 0.52).normalize();

  // Planar cleavage normals for sharp faceted M-type metal & prismatic crystal ice
  const planes: { nx: number; ny: number; nz: number; d: number }[] = [];
  if (shape === 'cleavedMetallic' || shape === 'crystalShard') {
    const planeCount = shape === 'cleavedMetallic' ? 10 : 8;
    for (let p = 0; p < planeCount; p++) {
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      planes.push({
        nx: s * Math.cos(phi),
        ny: u,
        nz: s * Math.sin(phi),
        d: shape === 'cleavedMetallic' ? 0.66 + rng() * 0.26 : 0.60 + rng() * 0.28,
      });
    }
  }

  let maxDist = 0.001;
  const outCoords = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const ox = v.x * 2.1 + seed * 0.43;
    const oy = v.y * 2.1 - seed * 0.29;
    const oz = v.z * 2.1 + seed * 0.61;

    const ridge = ridged3D(ox, oy, oz, 3);
    const fine = ridged3D(ox * 2.5 + 3.1, oy * 2.5 - 1.7, oz * 2.5, 2);
    const low = fbm3D(ox * 0.85, oy * 0.85, oz * 0.85, 3);
    const crater = craters.length > 0 ? evaluateCraterHeight(v.x, v.y, v.z, craters) : 0;

    let x = v.x;
    let y = v.y;
    let z = v.z;

    if (shape === 'diamondTop') {
      // Bennu / Ryugu spinning-top diamond with prominent equatorial ridge & angular boulders
      const eqBulge = 1.0 + 0.28 * Math.exp(-Math.pow(v.y / 0.34, 2)) - 0.14 * v.y * v.y;
      const boulder = Math.pow(ridge, 1.35) * 0.24 + (low - 0.5) * 0.18 + fine * 0.08;
      const r = eqBulge * (0.86 + boulder) + crater * 0.22;
      x *= r * 1.04;
      y *= r * 0.94;
      z *= r * 1.02;
    } else if (shape === 'contactBinary') {
      // 67P / Arrokoth / Itokawa pinched bilobed contact binary with asymmetric lobes
      const neckPinch = 1.0 - 0.48 * Math.exp(-Math.pow((v.x + 0.07) / 0.25, 2));
      const lobeAsym = v.x < -0.07 ? 0.80 : 1.04;
      const lobeYShift = v.x < -0.07 ? 0.16 * Math.min(1, Math.abs(v.x + 0.07) * 2.1) : -0.04;
      const lobeZShift = v.x < -0.07 ? -0.09 * Math.min(1, Math.abs(v.x + 0.07) * 2.1) : 0.03;
      const strataStep = Math.sin(v.y * 9.0 + low * 3.0) * 0.045;
      const r = 0.86 + (ridge - 0.5) * 0.22 + (low - 0.5) * 0.18 + fine * 0.07 + strataStep + crater * 0.16;
      x = v.x * 1.46 * (0.92 + (ridge - 0.5) * 0.16);
      y = v.y * r * neckPinch * lobeAsym * 0.86 + lobeYShift;
      z = v.z * r * neckPinch * lobeAsym * 0.84 + lobeZShift;
    } else if (shape === 'curvedPotato') {
      // 433 Eros curved triaxial silicate potato with concave flank saddle & tectonic grooves
      const saddleDot = Math.max(0, -v.y * 0.72 + v.z * 0.69);
      const saddleDent = Math.pow(saddleDot, 2.4) * 0.28 * Math.exp(-v.x * v.x * 2.4);
      const groove = Math.sin((v.x * 4.5 + v.z * 3.2) + low * 1.6) * 0.035;
      const r = 0.92 + (low - 0.5) * 0.24 + (ridge - 0.5) * 0.18 + fine * 0.07 + groove + crater * 0.24 - saddleDent;
      x = v.x * 1.38 * r;
      y = v.y * 0.78 * r + 0.24 * (v.x * v.x - 0.36);
      z = v.z * 0.84 * r - 0.12 * v.x * v.y;
    } else if (shape === 'cleavedMetallic') {
      // 16 Psyche angular sheared polyhedral iron-nickel ore chunk with planar cleavage cuts
      let rClip = 1.24;
      for (let p = 0; p < planes.length; p++) {
        const pl = planes[p];
        const denom = v.x * pl.nx + v.y * pl.ny + v.z * pl.nz;
        if (denom > 0.12) {
          rClip = smoothMin(rClip, pl.d / denom, 0.11);
        }
      }
      const r = rClip * (0.94 + (ridge - 0.5) * 0.16 + fine * 0.06) + crater * 0.14;
      x = v.x * r * 1.12;
      y = v.y * r * 0.88;
      z = v.z * r * 0.96;
    } else if (shape === 'crateredBasin') {
      // 4 Vesta angular crust boulder dominated by one giant deep terraced impact basin
      const bDot = v.x * giantBasinDir.x + v.y * giantBasinDir.y + v.z * giantBasinDir.z;
      const bAng = Math.acos(Math.min(1, Math.max(-1, bDot)));
      const bq = bAng / 0.78;
      let giantBasin = 0;
      if (bq < 1.35) {
        if (bq < 1.0) {
          giantBasin = (bq * bq - 1.0) * 0.42 + Math.exp(-Math.pow((bq - 0.95) / 0.12, 2)) * 0.20;
        } else {
          giantBasin = Math.exp(-Math.pow((bq - 0.95) / 0.16, 2)) * 0.18;
        }
      }
      const shelf = (Math.floor(ridge * 4.0) / 4.0) * 0.14 + ridge * 0.14;
      const r = 0.94 + shelf + (low - 0.5) * 0.22 + fine * 0.07 + giantBasin + crater * 0.20;
      x = v.x * r * 1.12;
      y = v.y * r * 0.92;
      z = v.z * r * 1.04;
    } else if (shape === 'tectonicSlab') {
      // Oumuamua / cleaved interstellar tectonic slate shard with stepped ledges & broken notch
      const stepped = (Math.floor(ridge * 5.0) / 5.0) * 0.22 + ridge * 0.14;
      const notch = Math.exp(-Math.pow((v.x - 0.32) / 0.26, 2) - Math.pow((v.z - 0.72) / 0.34, 2)) * 0.34;
      const taper = 1.0 - 0.22 * Math.max(0, v.x);
      const r = 0.92 + stepped + (low - 0.5) * 0.18 + fine * 0.08 - notch;
      x = v.x * 1.52 * r;
      y = v.y * 0.42 * r * (0.85 + ridge * 0.38);
      z = v.z * 0.94 * r * taper;
    } else if (shape === 'crystalShard') {
      // Saturnian prismatic faceted ice monolith with sharp crystal faces & spire taper
      let rClip = 1.28;
      for (let p = 0; p < planes.length; p++) {
        const pl = planes[p];
        const denom = v.x * pl.nx + v.y * pl.ny + v.z * pl.nz;
        if (denom > 0.10) {
          rClip = smoothMin(rClip, pl.d / denom, 0.07);
        }
      }
      const spire = 1.0 - 0.32 * Math.max(0, v.x);
      const r = rClip * (0.94 + (ridge - 0.5) * 0.14 + fine * 0.06);
      x = v.x * r * 1.32;
      y = v.y * r * 0.78 * spire;
      z = v.z * r * 0.82 * spire;
    } else {
      // 'pittedComet': Deeply porous sublimation-vent Kuiper comet nucleus with overhanging ridges
      const sharpRidge = Math.pow(ridge, 1.45) * 0.34;
      const r = 0.88 + sharpRidge + (low - 0.5) * 0.26 + fine * 0.09 + crater * 0.34;
      x = v.x * r * 1.18;
      y = v.y * r * 0.88;
      z = v.z * r * 0.98;
    }

    outCoords[i * 3] = x;
    outCoords[i * 3 + 1] = y;
    outCoords[i * 3 + 2] = z;
    const dLen = Math.sqrt(x * x + y * y + z * z);
    if (dLen > maxDist) maxDist = dLen;
  }

  // Normalize silhouette gently to ~1.12 bounding radius so collision math stays exact across all 8 shapes
  const normScale = 1.12 / maxDist;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      outCoords[i * 3] * normScale,
      outCoords[i * 3 + 1] * normScale,
      outCoords[i * 3 + 2] * normScale,
    );
  }

  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function buildFractureShardGeometry(
  kind: 'rockSlab' | 'metallicSplinter' | 'iceCrystal',
  seed: number,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const ox = v.x * 2.4 + seed;
    const oy = v.y * 2.4 - seed * 0.7;
    const oz = v.z * 2.4 + seed * 1.3;
    const n = ridged3D(ox, oy, oz, 3);
    const fine = ridged3D(ox * 2.8 + 2.1, oy * 2.8, oz * 2.8, 2);

    if (kind === 'metallicSplinter') {
      // Razor-edged angular cleaved ore flake
      const r = 0.68 + Math.pow(n, 1.4) * 0.62 + fine * 0.14;
      pos.setXYZ(i, v.x * r * 1.38, v.y * r * 0.40, v.z * r * 0.78);
    } else if (kind === 'iceCrystal') {
      // Pointed crystalline prism shard
      const taper = 1.0 - 0.35 * Math.max(0, v.x);
      const r = 0.64 + n * 0.54 + fine * 0.14;
      pos.setXYZ(i, v.x * r * 1.45, v.y * r * 0.52 * taper, v.z * r * 0.62 * taper);
    } else {
      // Jagged cleaved basalt/silicate rock slab
      const r = 0.70 + (n * 0.78 + fine * 0.22) * 0.92;
      pos.setXYZ(i, v.x * r * 1.18, v.y * r * 0.56, v.z * r * 0.88);
    }
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createSolarSystemWorld(
  maxAniso: number,
  isMobile: boolean,
): SolarSystemWorld {
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  // The Sun sits at the gravitational anchor (0, 0, 0)
  const sunPosition = new THREE.Vector3(0, 0, 0);

  // Grand sweeping closed 3D orbital dive from outer Solar System inward to blazing Solar Perihelion
  // and graceful parabolic return arc out past the ecliptic plane for seamless looping.
  const controlPoints = [
    new THREE.Vector3(-42, 26, 2120),   // 0.00 Outer Kuiper approach
    new THREE.Vector3(-18, 12, 1860),   // 0.07 Neptune graze (planet to right)
    new THREE.Vector3(24, -4, 1560),    // 0.16 Uranus pass (planet to left)
    new THREE.Vector3(-16, 18, 1240),   // 0.26 Saturn ring-plane plunge
    new THREE.Vector3(-48, -6, 930),    // 0.37 Jupiter gravity assist curve
    new THREE.Vector3(-10, 4, 650),     // 0.48 Main Asteroid Belt dense weave
    new THREE.Vector3(26, -5, 430),     // 0.59 Mars red horizon flyby
    new THREE.Vector3(-12, 6, 265),     // 0.70 Earth & Moon terminator sweep
    new THREE.Vector3(18, -3, 150),     // 0.79 Venus sulfuric cloud pass
    new THREE.Vector3(-8, 2, 82),       // 0.85 Mercury seared crust graze
    new THREE.Vector3(36, 9, 14),       // 0.90 Solar Perihelion slingshot!
    new THREE.Vector3(64, 34, -85),     // 0.94 Blazing coronal exit
    new THREE.Vector3(140, 120, 620),   // 0.97 High ecliptic slingshot arc back outward
    new THREE.Vector3(45, 95, 1680),    // 0.99 Re-entry arc into outer dark space
  ];
  const spline = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.45);

  // -------------------------------------------------------------------------
  // 1. Crisp Photorealistic NASA Starfield + Restrained Milky Way Dust Band
  // -------------------------------------------------------------------------
  const starCount = isMobile ? 4800 : 7200;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);
  const rng = createRng(20261118);

  // Blackbody stellar chromaticity (O/B blue-white, A/F crisp white, G warm-white, K/M subtle amber)
  const spectralRGB: [number, number, number][] = [
    [0.72, 0.84, 1.0],
    [0.86, 0.92, 1.0],
    [0.98, 0.98, 1.0],
    [1.0, 0.96, 0.88],
    [1.0, 0.86, 0.68],
    [1.0, 0.74, 0.56],
  ];

  for (let i = 0; i < starCount; i++) {
    // 32% concentrated gently along the inclined galactic plane (Milky Way)
    const inBand = i < starCount * 0.32;
    let x: number;
    let y: number;
    let z: number;

    if (inBand) {
      const lon = rng() * Math.PI * 2;
      const lat = (rng() + rng() + rng() - 1.5) * 0.24;
      const cosL = Math.cos(lat);
      x = cosL * Math.cos(lon);
      y = Math.sin(lat);
      z = cosL * Math.sin(lon);
      // Tilt galactic plane 38° relative to ecliptic
      const tilt = 0.66;
      const ty = y * Math.cos(tilt) - z * Math.sin(tilt);
      const tz = y * Math.sin(tilt) + z * Math.cos(tilt);
      y = ty;
      z = tz;
    } else {
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      x = s * Math.cos(phi);
      y = u;
      z = s * Math.sin(phi);
    }

    const dist = 3600 + rng() * 800;
    starPos[i * 3] = x * dist;
    starPos[i * 3 + 1] = y * dist;
    starPos[i * 3 + 2] = z * dist;

    // Power-law astronomical magnitude distribution (many faint pinpoints, few brilliant stars)
    const mag = Math.pow(rng(), 4.2);
    const brightness = inBand ? 0.28 + mag * 0.68 : 0.34 + mag * 0.82;
    const spec = spectralRGB[Math.floor(Math.pow(rng(), 1.35) * spectralRGB.length)];
    starColors[i * 3] = spec[0] * brightness;
    starColors[i * 3 + 1] = spec[1] * brightness;
    starColors[i * 3 + 2] = spec[2] * brightness;

    starSizes[i] = 1.0 + mag * 3.4;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
  geometries.push(starGeo);

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float aSize;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float uPixelRatio;

      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * uPixelRatio, 1.0, 4.2);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        // Razor-sharp optical PSF pinpoint (Hubble/NASA exposure)
        float core = exp(-d * d * 7.8);
        gl_FragColor = vec4(vColor * (0.72 + core * 0.85), core);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials.push(starMat);

  const starfield = new THREE.Points(starGeo, starMat);
  starfield.frustumCulled = false;
  root.add(starfield);

  // -------------------------------------------------------------------------
  // 2. The Sun (Animated Convective Photosphere + Volumetric Corona + Glow)
  // -------------------------------------------------------------------------
  const sunGroup = new THREE.Group();
  sunGroup.position.copy(sunPosition);

  const sunGeo = new THREE.SphereGeometry(24, 64, 48);
  const sunMat = createSunPhotosphereMaterial();
  geometries.push(sunGeo);
  materials.push(sunMat);
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunGroup.add(sunMesh);

  const coronaGeo = new THREE.SphereGeometry(28.5, 48, 36);
  const coronaMat = createSolarCoronaMaterial();
  geometries.push(coronaGeo);
  materials.push(coronaMat);
  const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
  sunGroup.add(coronaMesh);

  const glowTex = createSoftRadialGlowTexture(256);
  textures.push(glowTex);
  const sunSpriteMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: new THREE.Color(0xffdfa8),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials.push(sunSpriteMat);
  const sunSprite = new THREE.Sprite(sunSpriteMat);
  sunSprite.scale.set(135, 135, 1);
  sunGroup.add(sunSprite);

  root.add(sunGroup);

  // -------------------------------------------------------------------------
  // 3. Planets Placed Strategically Along the Sweeping Orbital Spline
  // -------------------------------------------------------------------------
  const rotatingBodies: { mesh: THREE.Object3D; speed: number }[] = [];
  const sectors: SectorInfo[] = [];

  const sphereSegs = isMobile ? 48 : 80;
  const sharedUnitSphere = new THREE.SphereGeometry(1, sphereSegs, Math.round(sphereSegs * 0.75));
  geometries.push(sharedUnitSphere);

  interface PlanetSpec {
    id: string;
    name: string;
    subtitle: string;
    distanceAu: string;
    splineT: number;
    windowRadius: number;
    lateralOffset: number;
    verticalOffset: number;
    radius: number;
    oblateness?: number;
    axialTiltDeg: number;
    rotationSpeed: number;
    roughness: number;
    atmoColor?: number;
    atmoIntensity?: number;
    atmoPower?: number;
    bounceTint: number;
    harmonicIndex: number;
    textures: ReturnType<typeof createNeptuneTextures>;
    saturnRingMap?: THREE.CanvasTexture;
    uranusRing?: boolean;
    hasMoon?: boolean;
  }

  const saturnTex = createSaturnTextures(maxAniso);
  const earthTex = createEarthTextures(maxAniso);
  const moonTex = createCrateredBodyTextures(maxAniso, 8821, [74, 73, 71], [178, 176, 171], 74);

  const planetSpecs: PlanetSpec[] = [
    {
      id: 'neptune',
      name: 'Neptune',
      subtitle: 'Kuiper Approach',
      distanceAu: '30.07 AU',
      splineT: 0.068,
      windowRadius: 0.055,
      lateralOffset: 42,
      verticalOffset: -4,
      radius: 17,
      axialTiltDeg: 28.3,
      rotationSpeed: 0.045,
      roughness: 0.88,
      atmoColor: 0x3b82f6,
      atmoIntensity: 1.05,
      atmoPower: 3.1,
      bounceTint: 0x264b8c,
      harmonicIndex: 0,
      textures: createNeptuneTextures(maxAniso),
    },
    {
      id: 'uranus',
      name: 'Uranus',
      subtitle: 'Ice Giant Transit',
      distanceAu: '19.19 AU',
      splineT: 0.162,
      windowRadius: 0.05,
      lateralOffset: -44,
      verticalOffset: 6,
      radius: 16.5,
      axialTiltDeg: 97.8,
      rotationSpeed: 0.04,
      roughness: 0.9,
      atmoColor: 0x7dd3e8,
      atmoIntensity: 0.95,
      atmoPower: 3.3,
      bounceTint: 0x3e7482,
      harmonicIndex: 1,
      textures: createUranusTextures(maxAniso),
      uranusRing: true,
    },
    {
      id: 'saturn',
      name: 'Saturn',
      subtitle: 'Ring Plane Grazing',
      distanceAu: '9.54 AU',
      splineT: 0.264,
      windowRadius: 0.062,
      lateralOffset: 68,
      verticalOffset: -8,
      radius: 26,
      oblateness: 0.91,
      axialTiltDeg: 26.7,
      rotationSpeed: 0.055,
      roughness: 0.88,
      atmoColor: 0xe8d0a4,
      atmoIntensity: 0.78,
      atmoPower: 3.6,
      bounceTint: 0x7d6b4c,
      harmonicIndex: 2,
      textures: saturnTex,
      saturnRingMap: saturnTex.ringMap,
    },
    {
      id: 'jupiter',
      name: 'Jupiter',
      subtitle: 'Jovian Gravity Assist',
      distanceAu: '5.20 AU',
      splineT: 0.372,
      windowRadius: 0.065,
      lateralOffset: -74,
      verticalOffset: 5,
      radius: 34,
      oblateness: 0.935,
      axialTiltDeg: 3.1,
      rotationSpeed: 0.072,
      roughness: 0.86,
      atmoColor: 0xdcb488,
      atmoIntensity: 0.72,
      atmoPower: 3.8,
      bounceTint: 0x805e44,
      harmonicIndex: 3,
      textures: createJupiterTextures(maxAniso),
    },
    {
      id: 'mars',
      name: 'Mars',
      subtitle: 'Inner System Entry',
      distanceAu: '1.52 AU',
      splineT: 0.588,
      windowRadius: 0.052,
      lateralOffset: -30,
      verticalOffset: 3,
      radius: 11.5,
      axialTiltDeg: 25.2,
      rotationSpeed: 0.036,
      roughness: 0.92,
      atmoColor: 0xd9845b,
      atmoIntensity: 0.82,
      atmoPower: 3.8,
      bounceTint: 0x7c4632,
      harmonicIndex: 5,
      textures: createMarsTextures(maxAniso),
    },
    {
      id: 'earth',
      name: 'Earth & Moon',
      subtitle: 'Terminator Crossing',
      distanceAu: '1.00 AU',
      splineT: 0.696,
      windowRadius: 0.056,
      lateralOffset: 34,
      verticalOffset: -3,
      radius: 13.5,
      axialTiltDeg: 23.4,
      rotationSpeed: 0.04,
      roughness: 0.85,
      atmoColor: 0x5aa8ff,
      atmoIntensity: 1.32,
      atmoPower: 3.0,
      bounceTint: 0x355c8e,
      harmonicIndex: 6,
      textures: earthTex,
      hasMoon: true,
    },
    {
      id: 'venus',
      name: 'Venus',
      subtitle: 'Sulfuric Veil Flyby',
      distanceAu: '0.72 AU',
      splineT: 0.788,
      windowRadius: 0.044,
      lateralOffset: -28,
      verticalOffset: 2.5,
      radius: 12.2,
      axialTiltDeg: 177.3,
      rotationSpeed: -0.018,
      roughness: 0.84,
      atmoColor: 0xf4cf84,
      atmoIntensity: 1.08,
      atmoPower: 3.1,
      bounceTint: 0x8d7244,
      harmonicIndex: 7,
      textures: createVenusTextures(maxAniso),
    },
    {
      id: 'mercury',
      name: 'Mercury',
      subtitle: 'Innermost Perimeter',
      distanceAu: '0.39 AU',
      splineT: 0.848,
      windowRadius: 0.038,
      lateralOffset: 22,
      verticalOffset: -2,
      radius: 7.4,
      axialTiltDeg: 0.03,
      rotationSpeed: 0.016,
      roughness: 0.94,
      bounceTint: 0x5a5652,
      harmonicIndex: 8,
      textures: createCrateredBodyTextures(maxAniso, 3107, [62, 58, 55], [156, 148, 140], 84),
    },
  ];

  // Add Main Asteroid Belt & Solar Perihelion as dedicated cinematic sectors too
  const beltPos = spline.getPointAt(0.482);
  sectors.push({
    id: 'belt',
    name: 'Main Asteroid Belt',
    subtitle: 'Dense Debris Corridor',
    distanceAu: '2.74 AU',
    splineT: 0.482,
    windowRadius: 0.056,
    position: beltPos.clone(),
    gravityRadius: 90,
    gravityStrength: 0.25,
    bounceTint: new THREE.Color(0x4b4642),
    harmonicIndex: 4,
  });

  sectors.push({
    id: 'sun',
    name: 'Sun · Perihelion',
    subtitle: 'Coronal Slingshot',
    distanceAu: '0.09 AU',
    splineT: 0.908,
    windowRadius: 0.058,
    position: sunPosition.clone(),
    gravityRadius: 115,
    gravityStrength: 1.0,
    bounceTint: new THREE.Color(0xc87a34),
    harmonicIndex: 9,
  });

  const upVec = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();

  for (const spec of planetSpecs) {
    const anchor = spline.getPointAt(spec.splineT);
    spline.getTangentAt(spec.splineT, tangent).normalize();
    right.crossVectors(tangent, upVec).normalize();

    const planetPos = anchor
      .clone()
      .addScaledVector(right, spec.lateralOffset)
      .add(new THREE.Vector3(0, spec.verticalOffset, 0));

    const pGroup = new THREE.Group();
    pGroup.position.copy(planetPos);

    // Axial tilt carrier
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(spec.axialTiltDeg);
    pGroup.add(tiltGroup);

    // Track textures for disposal
    textures.push(spec.textures.map);
    if (spec.textures.normalMap) textures.push(spec.textures.normalMap);
    if (spec.textures.roughnessMap) textures.push(spec.textures.roughnessMap);
    if (spec.textures.cloudsMap) textures.push(spec.textures.cloudsMap);
    if (spec.textures.nightMap) textures.push(spec.textures.nightMap);

    const pMat = new THREE.MeshStandardMaterial({
      map: spec.textures.map,
      normalMap: spec.textures.normalMap,
      normalScale: spec.textures.normalMap
        ? new THREE.Vector2(spec.id === 'earth' ? 0.95 : 1.35, spec.id === 'earth' ? 0.95 : 1.35)
        : undefined,
      roughnessMap: spec.textures.roughnessMap,
      roughness: spec.textures.roughnessMap ? 1.0 : spec.roughness,
      metalness: spec.id === 'earth' ? 0.06 : 0.02,
    });

    // Attach GPU infinite-resolution procedural micro-detail tuned to each planet class
    if (spec.id === 'mars' || spec.id === 'mercury') {
      enhanceMaterialWithMicroDetail(pMat, {
        scale: 44.0,
        albedoContrast: 0.14,
        normalStrength: 0.22,
      });
    } else if (spec.id === 'earth') {
      enhanceMaterialWithMicroDetail(pMat, {
        scale: 38.0,
        albedoContrast: 0.10,
        normalStrength: 0.12,
      });
    } else {
      // Gas & ice giants + Venus: horizontal zonal jet-stream filament micro-detail
      enhanceMaterialWithMicroDetail(pMat, {
        scale: 28.0,
        albedoContrast: 0.075,
        normalStrength: 0.0,
        zonalStretch: 3.4,
      });
    }

    materials.push(pMat);

    const bodyMesh = new THREE.Mesh(sharedUnitSphere, pMat);
    bodyMesh.scale.set(spec.radius, spec.radius * (spec.oblateness ?? 1.0), spec.radius);
    tiltGroup.add(bodyMesh);
    rotatingBodies.push({ mesh: bodyMesh, speed: spec.rotationSpeed });

    // Earth drifting volumetric clouds + dark-side nocturnal city lights + orbiting Moon
    if (spec.id === 'earth' && spec.textures.cloudsMap && spec.textures.nightMap) {
      const cloudMat = new THREE.MeshStandardMaterial({
        map: spec.textures.cloudsMap,
        transparent: true,
        opacity: 0.92,
        roughness: 0.94,
        metalness: 0.0,
        depthWrite: false,
      });
      enhanceMaterialWithMicroDetail(cloudMat, {
        scale: 34.0,
        albedoContrast: 0.09,
        normalStrength: 0.0,
      });
      materials.push(cloudMat);
      const cloudMesh = new THREE.Mesh(sharedUnitSphere, cloudMat);
      cloudMesh.scale.setScalar(spec.radius * 1.012);
      tiltGroup.add(cloudMesh);
      rotatingBodies.push({ mesh: cloudMesh, speed: spec.rotationSpeed * 1.32 });

      const nightMat = createEarthNightLightsMaterial(spec.textures.nightMap, sunPosition);
      materials.push(nightMat);
      const nightMesh = new THREE.Mesh(sharedUnitSphere, nightMat);
      nightMesh.scale.setScalar(spec.radius * 1.004);
      tiltGroup.add(nightMesh);
      rotatingBodies.push({ mesh: nightMesh, speed: spec.rotationSpeed });

      if (spec.hasMoon) {
        textures.push(moonTex.map);
        if (moonTex.normalMap) textures.push(moonTex.normalMap);
        const moonMat = new THREE.MeshStandardMaterial({
          map: moonTex.map,
          normalMap: moonTex.normalMap,
          normalScale: new THREE.Vector2(1.4, 1.4),
          roughness: 0.94,
          metalness: 0.02,
        });
        enhanceMaterialWithMicroDetail(moonMat, {
          scale: 42.0,
          albedoContrast: 0.14,
          normalStrength: 0.24,
        });
        materials.push(moonMat);
        const moonMesh = new THREE.Mesh(sharedUnitSphere, moonMat);
        moonMesh.scale.setScalar(3.6);
        moonMesh.position.set(-22, 6.5, 16);
        pGroup.add(moonMesh);
        rotatingBodies.push({ mesh: moonMesh, speed: 0.015 });
      }
    }

    // Crisp thin physical Atmospheric Rayleigh/Mie sunlit scattering rim shell
    if (spec.atmoColor) {
      const atmoMat = createAtmosphereMaterial(
        spec.atmoColor,
        sunPosition,
        (spec.atmoIntensity ?? 1.0) * 0.92,
        (spec.atmoPower ?? 3.3) + 0.45,
      );
      materials.push(atmoMat);
      const atmoMesh = new THREE.Mesh(sharedUnitSphere, atmoMat);
      atmoMesh.scale.set(
        spec.radius * 1.028,
        spec.radius * (spec.oblateness ?? 1.0) * 1.028,
        spec.radius * 1.028,
      );
      tiltGroup.add(atmoMesh);
    }

    // Saturn custom shadow-receiving multi-band translucent ice rings
    if (spec.saturnRingMap) {
      textures.push(spec.saturnRingMap);
      const innerR = spec.radius * 1.26;
      const outerR = spec.radius * 2.46;
      const ringGeo = new THREE.RingGeometry(innerR, outerR, 192, 4);

      // Remap radial UVs cleanly from 0 (inner edge) to 1 (outer edge)
      const rPos = ringGeo.attributes.position;
      const rUv = ringGeo.attributes.uv;
      for (let i = 0; i < rPos.count; i++) {
        const vx = rPos.getX(i);
        const vy = rPos.getY(i);
        const rad = Math.sqrt(vx * vx + vy * vy);
        const u = (rad - innerR) / (outerR - innerR);
        rUv.setXY(i, u, 0.5);
      }
      geometries.push(ringGeo);

      const ringMat = createSaturnRingMaterial(
        spec.saturnRingMap,
        planetPos,
        spec.radius * 0.97,
        sunPosition,
      );
      materials.push(ringMat);

      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      tiltGroup.add(ringMesh);
    }

    // Subtle thin dark icy ring for tilted Uranus
    if (spec.uranusRing) {
      const uRingGeo = new THREE.RingGeometry(spec.radius * 1.48, spec.radius * 1.88, 72, 1);
      geometries.push(uRingGeo);
      const uRingMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x9ac6d4),
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      materials.push(uRingMat);
      const uRing = new THREE.Mesh(uRingGeo, uRingMat);
      uRing.rotation.x = Math.PI / 2;
      tiltGroup.add(uRing);
    }

    root.add(pGroup);

    sectors.push({
      id: spec.id,
      name: spec.name,
      subtitle: spec.subtitle,
      distanceAu: spec.distanceAu,
      splineT: spec.splineT,
      windowRadius: spec.windowRadius,
      position: planetPos,
      gravityRadius: spec.radius * 3.8,
      gravityStrength: Math.min(1.0, spec.radius / 30),
      bounceTint: new THREE.Color(spec.bounceTint),
      harmonicIndex: spec.harmonicIndex,
    });
  }

  // Sort sectors along the spline chronologically
  sectors.sort((a, b) => a.splineT - b.splineT);

  // -------------------------------------------------------------------------
  // 4. Eight Distinct Procedural World-Taste Asteroid Classes (Anti-Monotony)
  //    Each class combines an unmistakable sculpted silhouette morphology,
  //    bespoke 512x512 seamless PBR surface textures, GPU micro-detail, and
  //    astronomically authentic Solar System regional clustering.
  // -------------------------------------------------------------------------
  interface AsteroidArchetypeSpec {
    id: string;
    shape: AsteroidShapeKind;
    geoSeed: number;
    surfaceStyle: AsteroidSurfaceStyle | 'refractiveIce';
    texSeed: number;
    texRepeat: number;
    mobileCount: number;
    desktopCount: number;
    isIce: boolean;
    region: 'beltHeavy' | 'outerKuiper' | 'saturnIce' | 'innerScorched' | 'everywhere';
    shardKind: 'rockSlab' | 'metallicSplinter' | 'iceCrystal';
    dustColorHex: number;
    scaleJitter: [number, number, number];
    spinFactor: number;
    tintRange: { r: [number, number]; g: [number, number]; b: [number, number] };
    materialCfg: {
      normalScale: number;
      roughness: number;
      metalness: number;
      clearcoat?: number;
      detailScale: number;
      albedoContrast: number;
      normalStrength: number;
    };
  }

  const archetypeSpecs: AsteroidArchetypeSpec[] = [
    {
      // 0. C-Type Carbonaceous Diamond-Top Rubble Pile (Bennu / Ryugu)
      id: 'carbonaceousDiamond',
      shape: 'diamondTop',
      geoSeed: 11,
      surfaceStyle: 'carbonaceous',
      texSeed: 412,
      texRepeat: 2,
      mobileCount: 64,
      desktopCount: 92,
      isIce: false,
      region: 'beltHeavy',
      shardKind: 'rockSlab',
      dustColorHex: 0x8e8984,
      scaleJitter: [0.22, 0.20, 0.22],
      spinFactor: 0.95,
      tintRange: { r: [0.76, 1.12], g: [0.75, 1.10], b: [0.74, 1.08] },
      materialCfg: {
        normalScale: 1.42,
        roughness: 0.96,
        metalness: 0.05,
        detailScale: 13.0,
        albedoContrast: 0.16,
        normalStrength: 0.24,
      },
    },
    {
      // 1. Contact-Binary Bilobed Comet/Asteroid (67P / Arrokoth / Itokawa)
      id: 'contactBinary',
      shape: 'contactBinary',
      geoSeed: 23,
      surfaceStyle: 'stratifiedDust',
      texSeed: 527,
      texRepeat: 2,
      mobileCount: 46,
      desktopCount: 66,
      isIce: false,
      region: 'outerKuiper',
      shardKind: 'rockSlab',
      dustColorHex: 0xc8b6a2,
      scaleJitter: [0.16, 0.16, 0.16],
      spinFactor: 0.68,
      tintRange: { r: [0.80, 1.14], g: [0.76, 1.10], b: [0.72, 1.06] },
      materialCfg: {
        normalScale: 1.32,
        roughness: 0.92,
        metalness: 0.06,
        detailScale: 12.0,
        albedoContrast: 0.14,
        normalStrength: 0.22,
      },
    },
    {
      // 2. S-Type Curved Grooved Stony Silicate (433 Eros / Gaspra)
      id: 'stonySilicate',
      shape: 'curvedPotato',
      geoSeed: 37,
      surfaceStyle: 'stonySilicate',
      texSeed: 641,
      texRepeat: 2,
      mobileCount: 58,
      desktopCount: 84,
      isIce: false,
      region: 'beltHeavy',
      shardKind: 'rockSlab',
      dustColorHex: 0xd4c3ad,
      scaleJitter: [0.22, 0.20, 0.22],
      spinFactor: 0.85,
      tintRange: { r: [0.82, 1.16], g: [0.80, 1.12], b: [0.76, 1.06] },
      materialCfg: {
        normalScale: 1.35,
        roughness: 0.88,
        metalness: 0.12,
        detailScale: 13.5,
        albedoContrast: 0.15,
        normalStrength: 0.22,
      },
    },
    {
      // 3. M-Type Cleaved Iron-Nickel Metallic Core Fragment (16 Psyche)
      id: 'metallicCore',
      shape: 'cleavedMetallic',
      geoSeed: 51,
      surfaceStyle: 'metallicNickelIron',
      texSeed: 733,
      texRepeat: 2,
      mobileCount: 44,
      desktopCount: 64,
      isIce: false,
      region: 'beltHeavy',
      shardKind: 'metallicSplinter',
      dustColorHex: 0xc2c8d2,
      scaleJitter: [0.26, 0.24, 0.26],
      spinFactor: 0.92,
      tintRange: { r: [0.84, 1.14], g: [0.84, 1.14], b: [0.86, 1.16] },
      materialCfg: {
        normalScale: 1.15,
        roughness: 1.0,
        metalness: 0.92,
        clearcoat: 0.22,
        detailScale: 18.0,
        albedoContrast: 0.10,
        normalStrength: 0.16,
      },
    },
    {
      // 4. V-Type Giant-Cratered Oxidized Iron-Basalt Crust (4 Vesta / Inner Belt)
      id: 'oxidizedBasalt',
      shape: 'crateredBasin',
      geoSeed: 67,
      surfaceStyle: 'oxidizedBasalt',
      texSeed: 829,
      texRepeat: 2,
      mobileCount: 48,
      desktopCount: 70,
      isIce: false,
      region: 'innerScorched',
      shardKind: 'rockSlab',
      dustColorHex: 0xc88e74,
      scaleJitter: [0.22, 0.20, 0.22],
      spinFactor: 0.80,
      tintRange: { r: [0.84, 1.18], g: [0.76, 1.08], b: [0.72, 1.04] },
      materialCfg: {
        normalScale: 1.40,
        roughness: 0.90,
        metalness: 0.14,
        detailScale: 14.0,
        albedoContrast: 0.15,
        normalStrength: 0.23,
      },
    },
    {
      // 5. Quartz-Veined Tectonic Cleaved Slate Slab (Oumuamua / Interstellar Shard)
      id: 'veinedSlateSlab',
      shape: 'tectonicSlab',
      geoSeed: 83,
      surfaceStyle: 'veinedSlate',
      texSeed: 911,
      texRepeat: 2,
      mobileCount: 42,
      desktopCount: 60,
      isIce: false,
      region: 'everywhere',
      shardKind: 'metallicSplinter',
      dustColorHex: 0xb2b6be,
      scaleJitter: [0.20, 0.18, 0.20],
      spinFactor: 0.72,
      tintRange: { r: [0.80, 1.12], g: [0.82, 1.14], b: [0.84, 1.16] },
      materialCfg: {
        normalScale: 1.45,
        roughness: 1.0,
        metalness: 0.72,
        detailScale: 15.0,
        albedoContrast: 0.14,
        normalStrength: 0.21,
      },
    },
    {
      // 6. Saturnian Prismatic Crystalline Water-Ice Monolith (Refractive Fresnel Dispersion)
      id: 'crystalIceShard',
      shape: 'crystalShard',
      geoSeed: 97,
      surfaceStyle: 'refractiveIce',
      texSeed: 0,
      texRepeat: 1,
      mobileCount: 64,
      desktopCount: 94,
      isIce: true,
      region: 'saturnIce',
      shardKind: 'iceCrystal',
      dustColorHex: 0xd2ecff,
      scaleJitter: [0.24, 0.22, 0.24],
      spinFactor: 0.88,
      tintRange: { r: [1, 1], g: [1, 1], b: [1, 1] },
      materialCfg: {
        normalScale: 1.0,
        roughness: 0.2,
        metalness: 0.0,
        detailScale: 12.0,
        albedoContrast: 0.0,
        normalStrength: 0.0,
      },
    },
    {
      // 7. Frosted Cryo-Volcanic Kuiper Comet Nucleus (Dark Carbon Crust + Glinting Ice Frost)
      id: 'frostedCometNucleus',
      shape: 'pittedComet',
      geoSeed: 113,
      surfaceStyle: 'frostedComet',
      texSeed: 1049,
      texRepeat: 2,
      mobileCount: 48,
      desktopCount: 68,
      isIce: true,
      region: 'outerKuiper',
      shardKind: 'rockSlab',
      dustColorHex: 0xc4d9ea,
      scaleJitter: [0.22, 0.20, 0.22],
      spinFactor: 0.76,
      tintRange: { r: [0.82, 1.12], g: [0.84, 1.14], b: [0.88, 1.18] },
      materialCfg: {
        normalScale: 1.38,
        roughness: 1.0,
        metalness: 0.08,
        detailScale: 14.5,
        albedoContrast: 0.15,
        normalStrength: 0.22,
      },
    },
  ];

  const rockDetail = isMobile ? 2 : 3;
  const iceDebrisMat = createRefractiveIceMaterial(sunPosition, true);
  materials.push(iceDebrisMat);

  const instancedGroups: THREE.InstancedMesh[] = [];
  const archetypeMaterials: THREE.Material[] = [];
  const archetypeDustColors: number[] = [];
  const debris: DebrisBody[] = [];

  const dummy = new THREE.Object3D();
  const colorTmp = new THREE.Color();
  const pTmp = new THREE.Vector3();
  const tTmp = new THREE.Vector3();
  const rTmp = new THREE.Vector3();
  const uTmp = new THREE.Vector3();

  function pickRegionalSplineT(region: AsteroidArchetypeSpec['region']): number {
    const roll = rng();
    if (region === 'saturnIce') {
      if (roll < 0.64) return 0.222 + rng() * 0.088; // Saturn ring-plane ice cascade
      if (roll < 0.88) return 0.015 + rng() * 0.17; // Kuiper / Neptune-Uranus icy debris
      return 0.42 + rng() * 0.40;
    }
    if (region === 'outerKuiper') {
      if (roll < 0.46) return 0.012 + rng() * 0.185; // Outer Neptune / Uranus Kuiper belt
      if (roll < 0.74) return 0.22 + rng() * 0.095; // Saturnian outer ring shepherd rocks
      return 0.415 + rng() * 0.16; // Main Asteroid Belt
    }
    if (region === 'innerScorched') {
      if (roll < 0.46) return 0.56 + rng() * 0.30; // Mars -> Earth -> Venus -> Mercury inner dive
      if (roll < 0.84) return 0.415 + rng() * 0.155; // Main Asteroid Belt
      return 0.08 + rng() * 0.32;
    }
    if (region === 'everywhere') {
      if (roll < 0.38) return 0.415 + rng() * 0.16;
      return 0.025 + rng() * 0.84;
    }
    // 'beltHeavy'
    if (roll < 0.58) return 0.415 + rng() * 0.158; // Main Asteroid Belt dense corridor
    if (roll < 0.84) return 0.03 + rng() * 0.84;
    return 0.58 + rng() * 0.29;
  }

  for (let mIdx = 0; mIdx < archetypeSpecs.length; mIdx++) {
    const spec = archetypeSpecs[mIdx];
    const geo = buildDiverseAsteroidGeometry(spec.shape, spec.geoSeed, rockDetail);
    geometries.push(geo);

    let mat: THREE.Material;
    if (spec.surfaceStyle === 'refractiveIce') {
      mat = iceDebrisMat;
    } else {
      const texSet = createDiverseAsteroidTextures(
        maxAniso,
        spec.surfaceStyle,
        spec.texSeed,
        spec.texRepeat,
      );
      textures.push(texSet.map, texSet.normalMap, texSet.roughnessMap);
      if (texSet.metalnessMap) textures.push(texSet.metalnessMap);

      const pbrMat =
        spec.materialCfg.clearcoat !== undefined
          ? new THREE.MeshPhysicalMaterial({
              map: texSet.map,
              normalMap: texSet.normalMap,
              normalScale: new THREE.Vector2(
                spec.materialCfg.normalScale,
                spec.materialCfg.normalScale,
              ),
              roughnessMap: texSet.roughnessMap,
              roughness: spec.materialCfg.roughness,
              metalnessMap: texSet.metalnessMap,
              metalness: spec.materialCfg.metalness,
              clearcoat: spec.materialCfg.clearcoat,
              clearcoatRoughness: 0.32,
            })
          : new THREE.MeshStandardMaterial({
              map: texSet.map,
              normalMap: texSet.normalMap,
              normalScale: new THREE.Vector2(
                spec.materialCfg.normalScale,
                spec.materialCfg.normalScale,
              ),
              roughnessMap: texSet.roughnessMap,
              roughness: spec.materialCfg.roughness,
              metalnessMap: texSet.metalnessMap,
              metalness: spec.materialCfg.metalness,
            });

      enhanceMaterialWithMicroDetail(pbrMat, {
        scale: spec.materialCfg.detailScale,
        albedoContrast: spec.materialCfg.albedoContrast,
        normalStrength: spec.materialCfg.normalStrength,
      });

      materials.push(pbrMat);
      mat = pbrMat;
    }

    archetypeMaterials.push(mat);
    archetypeDustColors.push(spec.dustColorHex);

    const count = isMobile ? spec.mobileCount : spec.desktopCount;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;

    const useInstanceColor = spec.surfaceStyle !== 'refractiveIce';
    const [jx, jy, jz] = spec.scaleJitter;

    for (let i = 0; i < count; i++) {
      const splineT = pickRegionalSplineT(spec.region);
      spline.getPointAt(splineT, pTmp);
      spline.getTangentAt(splineT, tTmp).normalize();
      rTmp.crossVectors(tTmp, upVec).normalize();
      uTmp.crossVectors(rTmp, tTmp).normalize();

      // Place ~24% directly along the autopilot flight lane (causing real collisions if not dodged),
      // ~24% in the adjacent dodgeable corridor, and ~52% in the outer parallax field.
      const laneRoll = rng();
      const inCenterLane = laneRoll < 0.24;
      const inCorridor = laneRoll < 0.48;
      const latSpread = inCenterLane
        ? (rng() - 0.5) * 8.2
        : inCorridor
          ? (rng() - 0.5) * 26
          : (rng() < 0.5 ? -1 : 1) * (13 + rng() * 44);
      const vertSpread = inCenterLane
        ? (rng() - 0.5) * 4.2
        : inCorridor
          ? (rng() - 0.5) * 9.5
          : (rng() - 0.5) * 32;

      pTmp.addScaledVector(rTmp, latSpread).addScaledVector(uTmp, vertSpread);

      const baseScale = inCorridor
        ? 0.64 + Math.pow(rng(), 1.65) * 1.95
        : 0.85 + Math.pow(rng(), 1.55) * 3.95;
      const sx = baseScale * (1.0 + (rng() * 2 - 1) * jx);
      const sy = baseScale * (1.0 + (rng() * 2 - 1) * jy);
      const sz = baseScale * (1.0 + (rng() * 2 - 1) * jz);
      const radius = Math.max(sx, sy, sz) * 0.92;

      const rx = rng() * Math.PI * 2;
      const ry = rng() * Math.PI * 2;
      const rz = rng() * Math.PI * 2;

      dummy.position.copy(pTmp);
      dummy.rotation.set(rx, ry, rz);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      if (useInstanceColor) {
        const cr = spec.tintRange.r[0] + rng() * (spec.tintRange.r[1] - spec.tintRange.r[0]);
        const cg = spec.tintRange.g[0] + rng() * (spec.tintRange.g[1] - spec.tintRange.g[0]);
        const cb = spec.tintRange.b[0] + rng() * (spec.tintRange.b[1] - spec.tintRange.b[0]);
        colorTmp.setRGB(cr, cg, cb);
        mesh.setColorAt(i, colorTmp);
      }

      debris.push({
        x: pTmp.x,
        y: pTmp.y,
        z: pTmp.z,
        homeX: pTmp.x,
        homeY: pTmp.y,
        homeZ: pTmp.z,
        vx: 0,
        vy: 0,
        vz: 0,
        radius,
        homeRadius: radius,
        isIce: spec.isIce,
        meshIndex: mIdx,
        instanceId: i,
        rx,
        ry,
        rz,
        spinX: (rng() - 0.5) * 0.9 * spec.spinFactor,
        spinY: (rng() - 0.5) * 0.9 * spec.spinFactor,
        spinZ: (rng() - 0.5) * 0.6 * spec.spinFactor,
        sx,
        sy,
        sz,
        homeSx: sx,
        homeSy: sy,
        homeSz: sz,
        collided: false,
        lastNearMissTime: -10,
        lastCollisionTime: -10,
      });
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    instancedGroups.push(mesh);
  }

  // -------------------------------------------------------------------------
  // 4b. Pre-Allocated Fracture Chunk Pools & Impact Dust Burst (Zero Runtime GC)
  //     Matched 1-to-1 to all 8 world-taste asteroid materials & 3 cleavage shard shapes!
  // -------------------------------------------------------------------------
  const shardGeoMap = {
    rockSlab: buildFractureShardGeometry('rockSlab', 73),
    metallicSplinter: buildFractureShardGeometry('metallicSplinter', 109),
    iceCrystal: buildFractureShardGeometry('iceCrystal', 149),
  };
  geometries.push(
    shardGeoMap.rockSlab,
    shardGeoMap.metallicSplinter,
    shardGeoMap.iceCrystal,
  );

  interface FractureChunk {
    active: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    rx: number;
    ry: number;
    rz: number;
    spinX: number;
    spinY: number;
    spinZ: number;
    sx: number;
    sy: number;
    sz: number;
    age: number;
    maxAge: number;
  }

  interface ShardPool {
    mesh: THREE.InstancedMesh;
    chunks: FractureChunk[];
    cursor: number;
  }

  const shardPools: ShardPool[] = [];
  const shardCapPerClass = isMobile ? 22 : 32;

  for (let mIdx = 0; mIdx < archetypeSpecs.length; mIdx++) {
    const spec = archetypeSpecs[mIdx];
    const sMesh = new THREE.InstancedMesh(
      shardGeoMap[spec.shardKind],
      archetypeMaterials[mIdx],
      shardCapPerClass,
    );
    sMesh.frustumCulled = false;

    const chunks: FractureChunk[] = [];
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();

    const useInstanceColor = spec.surfaceStyle !== 'refractiveIce';
    for (let i = 0; i < shardCapPerClass; i++) {
      sMesh.setMatrixAt(i, dummy.matrix);
      if (useInstanceColor) {
        const cr = spec.tintRange.r[0] + rng() * (spec.tintRange.r[1] - spec.tintRange.r[0]);
        const cg = spec.tintRange.g[0] + rng() * (spec.tintRange.g[1] - spec.tintRange.g[0]);
        const cb = spec.tintRange.b[0] + rng() * (spec.tintRange.b[1] - spec.tintRange.b[0]);
        colorTmp.setRGB(cr, cg, cb);
        sMesh.setColorAt(i, colorTmp);
      }
      chunks.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        sx: 0,
        sy: 0,
        sz: 0,
        age: 0,
        maxAge: 4.0,
      });
    }
    sMesh.instanceMatrix.needsUpdate = true;
    if (sMesh.instanceColor) sMesh.instanceColor.needsUpdate = true;
    root.add(sMesh);
    shardPools.push({ mesh: sMesh, chunks, cursor: 0 });
  }

  // Impact pulverization dust flecks spawned right at the cleaved rock face
  const impactDustCap = isMobile ? 72 : 108;
  const impactDustGeo = new THREE.BufferGeometry();
  const impactDustPos = new Float32Array(impactDustCap * 3);
  const impactDustVel = new Float32Array(impactDustCap * 3);
  const impactDustAge = new Float32Array(impactDustCap);
  const impactDustMax = new Float32Array(impactDustCap);
  for (let i = 0; i < impactDustCap; i++) {
    impactDustPos[i * 3] = 0;
    impactDustPos[i * 3 + 1] = -99999;
    impactDustPos[i * 3 + 2] = 0;
    impactDustAge[i] = 10;
    impactDustMax[i] = 1.0;
  }
  impactDustGeo.setAttribute('position', new THREE.BufferAttribute(impactDustPos, 3));
  geometries.push(impactDustGeo);

  const impactDustMat = new THREE.PointsMaterial({
    color: new THREE.Color(0xd8d2c8),
    size: 0.24,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    sizeAttenuation: true,
  });
  materials.push(impactDustMat);
  const impactDustPoints = new THREE.Points(impactDustGeo, impactDustMat);
  impactDustPoints.frustumCulled = false;
  root.add(impactDustPoints);
  let impactDustCursor = 0;

  const _t1 = new THREE.Vector3();
  const _t2 = new THREE.Vector3();

  function fractureAsteroid(
    rock: DebrisBody,
    impactPoint: THREE.Vector3,
    impactNormal: THREE.Vector3,
    cameraForward: THREE.Vector3,
    velocityNorm: number,
  ) {
    // 1. Cleave/chip the struck portion of the collided asteroid asymmetrically
    //    and deflect the remaining bulk away along the opposite impact vector!
    const chipRatio = 0.28 + rng() * 0.14;
    const absNx = Math.abs(impactNormal.x);
    const absNy = Math.abs(impactNormal.y);
    const absNz = Math.abs(impactNormal.z);

    // Shrink preferentially along the axis facing the collision contact face
    rock.sx *= 1 - chipRatio * (0.45 + absNx * 0.7);
    rock.sy *= 1 - chipRatio * (0.45 + absNy * 0.7);
    rock.sz *= 1 - chipRatio * (0.45 + absNz * 0.7);
    rock.radius = Math.max(0.28, Math.max(rock.sx, rock.sy, rock.sz) * 0.88);

    // Shift center slightly away from the sheared-off contact face
    const shift = rock.homeRadius * chipRatio * 0.62;
    rock.x -= impactNormal.x * shift;
    rock.y -= impactNormal.y * shift;
    rock.z -= impactNormal.z * shift;

    // Impart physical deflection impulse & violent tumbling spin to the remaining body
    const knockSpeed = 12.0 + velocityNorm * 16.0;
    rock.vx += -impactNormal.x * knockSpeed + cameraForward.x * (5.5 + velocityNorm * 7.0);
    rock.vy += -impactNormal.y * knockSpeed + cameraForward.y * (5.5 + velocityNorm * 7.0);
    rock.vz += -impactNormal.z * knockSpeed + cameraForward.z * (5.5 + velocityNorm * 7.0);
    rock.spinX += (rng() - 0.5) * 7.5;
    rock.spinY += (rng() - 0.5) * 7.5;
    rock.spinZ += (rng() - 0.5) * 6.5;
    rock.collided = true;

    // Build orthonormal tangent basis across the cleaved contact face
    if (Math.abs(impactNormal.y) < 0.9) {
      _t1.set(-impactNormal.z, 0, impactNormal.x).normalize();
    } else {
      _t1.set(1, 0, 0);
    }
    _t2.crossVectors(impactNormal, _t1).normalize();

    // 2. Spawn 11-14 jagged fracture chunks right at the collided contact portion!
    const pool = shardPools[rock.meshIndex];
    const spawnCount = isMobile ? 10 : 14;
    const baseChunkScale = Math.max(0.18, Math.min(0.68, rock.homeRadius * 0.34));

    for (let i = 0; i < spawnCount; i++) {
      const ch = pool.chunks[pool.cursor];
      pool.cursor = (pool.cursor + 1) % pool.chunks.length;

      const angle = (i / spawnCount) * Math.PI * 2 + rng() * 0.5;
      const radialOffset = rock.homeRadius * (0.14 + rng() * 0.42);
      const uOff = Math.cos(angle) * radialOffset;
      const vOff = Math.sin(angle) * radialOffset;

      ch.active = true;
      ch.age = 0;
      ch.maxAge = 3.2 + rng() * 2.2;

      // Positioned directly on the cleaved contact face of the collided asteroid
      ch.x = impactPoint.x + _t1.x * uOff + _t2.x * vOff;
      ch.y = impactPoint.y + _t1.y * uOff + _t2.y * vOff;
      ch.z = impactPoint.z + _t1.z * uOff + _t2.z * vOff;

      // Radial spray outward along the sheared contact cone + forward glancing velocity
      const outSpeed = 6.5 + rng() * 14.5 + velocityNorm * 10.0;
      const tangential = 4.5 + rng() * 10.0;
      const forwardBoost = 8.0 + velocityNorm * 16.0 + rng() * 8.0;

      ch.vx =
        impactNormal.x * outSpeed * 0.55 +
        _t1.x * Math.cos(angle) * tangential +
        _t2.x * Math.sin(angle) * tangential +
        cameraForward.x * forwardBoost;
      ch.vy =
        impactNormal.y * outSpeed * 0.55 +
        _t1.y * Math.cos(angle) * tangential +
        _t2.y * Math.sin(angle) * tangential +
        cameraForward.y * forwardBoost;
      ch.vz =
        impactNormal.z * outSpeed * 0.55 +
        _t1.z * Math.cos(angle) * tangential +
        _t2.z * Math.sin(angle) * tangential +
        cameraForward.z * forwardBoost;

      // Mix of 2-3 larger cleaved slabs + smaller jagged rock/ice splinters
      const sizeMul = i < 3 ? 0.85 + rng() * 0.5 : 0.28 + rng() * 0.52;
      ch.sx = baseChunkScale * sizeMul * (0.75 + rng() * 0.6);
      ch.sy = baseChunkScale * sizeMul * (0.65 + rng() * 0.55);
      ch.sz = baseChunkScale * sizeMul * (0.75 + rng() * 0.6);

      ch.rx = rng() * Math.PI * 2;
      ch.ry = rng() * Math.PI * 2;
      ch.rz = rng() * Math.PI * 2;
      ch.spinX = (rng() - 0.5) * 14.0;
      ch.spinY = (rng() - 0.5) * 14.0;
      ch.spinZ = (rng() - 0.5) * 12.0;
    }

    // 3. Emit pulverized regolith / metallic / crystalline ice dust flecks matching the struck archetype
    const dustBurst = isMobile ? 16 : 24;
    impactDustMat.color.setHex(archetypeDustColors[rock.meshIndex] ?? (rock.isIce ? 0xd2ecff : 0xcfc4b6));
    for (let i = 0; i < dustBurst; i++) {
      const idx = impactDustCursor;
      impactDustCursor = (impactDustCursor + 1) % impactDustCap;

      const ang = rng() * Math.PI * 2;
      const spread = 2.5 + rng() * 9.5;
      impactDustPos[idx * 3] = impactPoint.x + (rng() - 0.5) * 0.9;
      impactDustPos[idx * 3 + 1] = impactPoint.y + (rng() - 0.5) * 0.9;
      impactDustPos[idx * 3 + 2] = impactPoint.z + (rng() - 0.5) * 0.9;

      impactDustVel[idx * 3] =
        _t1.x * Math.cos(ang) * spread +
        _t2.x * Math.sin(ang) * spread +
        cameraForward.x * (7 + velocityNorm * 14);
      impactDustVel[idx * 3 + 1] =
        _t1.y * Math.cos(ang) * spread +
        _t2.y * Math.sin(ang) * spread +
        cameraForward.y * (7 + velocityNorm * 14);
      impactDustVel[idx * 3 + 2] =
        _t1.z * Math.cos(ang) * spread +
        _t2.z * Math.sin(ang) * spread +
        cameraForward.z * (7 + velocityNorm * 14);

      impactDustAge[idx] = 0;
      impactDustMax[idx] = 0.75 + rng() * 0.85;
    }
  }

  // -------------------------------------------------------------------------
  // 5. High-Speed Interplanetary Micro-Dust Streaks (Amplifies Kinetic Velocity)
  // -------------------------------------------------------------------------
  const dustCount = isMobile ? 110 : 170;
  const dustGeo = new THREE.BoxGeometry(0.025, 0.025, 1.8);
  geometries.push(dustGeo);
  const dustMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xcbd5e1),
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(dustMat);
  const dustStreaks = new THREE.InstancedMesh(dustGeo, dustMat, dustCount);
  dustStreaks.frustumCulled = false;

  const dustOffsets = new Float32Array(dustCount * 4); // lx, ly, lz, speedMul
  for (let i = 0; i < dustCount; i++) {
    // Ring distribution around view frustum (avoiding exact center so horizon stays clear)
    const ang = rng() * Math.PI * 2;
    const rad = 2.6 + rng() * 14.0;
    dustOffsets[i * 4] = Math.cos(ang) * rad;
    dustOffsets[i * 4 + 1] = Math.sin(ang) * rad * 0.68;
    dustOffsets[i * 4 + 2] = rng() * 64.0;
    dustOffsets[i * 4 + 3] = 0.7 + rng() * 0.9;
  }
  root.add(dustStreaks);

  // Pre-allocated scratch helpers (zero GC inside tick)
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _lookAt = new THREE.Vector3();
  const _dummy = new THREE.Object3D();
  const groupDirty = new Uint8Array(instancedGroups.length);

  function update(
    dt: number,
    time: number,
    cameraPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
    velocityNorm: number,
  ) {
    sunMat.uniforms.uTime.value = time;
    coronaMat.uniforms.uTime.value = time;
    iceDebrisMat.uniforms.uTime.value = time;

    // Spin planets along their tilted axes
    for (let i = 0; i < rotatingBodies.length; i++) {
      rotatingBodies[i].mesh.rotation.y += rotatingBodies[i].speed * dt;
    }

    // Tumble nearby debris rocks & integrate deflected/sheared collided bodies
    groupDirty.fill(0);
    const activeRadiusSq = 180 * 180;
    const resetRadiusSq = 380 * 380;

    for (let i = 0; i < debris.length; i++) {
      const b = debris[i];
      const dx = b.x - cameraPos.x;
      const dy = b.y - cameraPos.y;
      const dz = b.z - cameraPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Reset collided asteroids cleanly once far behind so the looping voyage stays fresh
      if (b.collided && distSq > resetRadiusSq) {
        b.x = b.homeX;
        b.y = b.homeY;
        b.z = b.homeZ;
        b.vx = 0;
        b.vy = 0;
        b.vz = 0;
        b.sx = b.homeSx;
        b.sy = b.homeSy;
        b.sz = b.homeSz;
        b.radius = b.homeRadius;
        b.collided = false;
        _dummy.position.set(b.x, b.y, b.z);
        _dummy.rotation.set(b.rx, b.ry, b.rz);
        _dummy.scale.set(b.sx, b.sy, b.sz);
        _dummy.updateMatrix();
        instancedGroups[b.meshIndex].setMatrixAt(b.instanceId, _dummy.matrix);
        groupDirty[b.meshIndex] = 1;
        continue;
      }

      if (distSq > activeRadiusSq) continue;

      if (b.collided) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        // Mild damping so deflected rock drifts organically out of view
        const drag = Math.exp(-0.22 * dt);
        b.vx *= drag;
        b.vy *= drag;
        b.vz *= drag;
      }

      b.rx += b.spinX * dt;
      b.ry += b.spinY * dt;
      b.rz += b.spinZ * dt;

      _dummy.position.set(b.x, b.y, b.z);
      _dummy.rotation.set(b.rx, b.ry, b.rz);
      _dummy.scale.set(b.sx, b.sy, b.sz);
      _dummy.updateMatrix();

      instancedGroups[b.meshIndex].setMatrixAt(b.instanceId, _dummy.matrix);
      groupDirty[b.meshIndex] = 1;
    }

    for (let gIdx = 0; gIdx < instancedGroups.length; gIdx++) {
      if (groupDirty[gIdx]) {
        instancedGroups[gIdx].instanceMatrix.needsUpdate = true;
      }
    }

    // Integrate shattered fracture chunks flying off collided asteroids
    for (let mIdx = 0; mIdx < shardPools.length; mIdx++) {
      const pool = shardPools[mIdx];
      let poolDirty = false;
      for (let i = 0; i < pool.chunks.length; i++) {
        const ch = pool.chunks[i];
        if (!ch.active) continue;
        ch.age += dt;
        if (ch.age >= ch.maxAge) {
          ch.active = false;
          _dummy.position.set(0, 0, 0);
          _dummy.scale.set(0, 0, 0);
          _dummy.updateMatrix();
          pool.mesh.setMatrixAt(i, _dummy.matrix);
          poolDirty = true;
          continue;
        }

        ch.x += ch.vx * dt;
        ch.y += ch.vy * dt;
        ch.z += ch.vz * dt;
        ch.rx += ch.spinX * dt;
        ch.ry += ch.spinY * dt;
        ch.rz += ch.spinZ * dt;

        // Smooth scale fade over final 25% of lifetime
        const lifeNorm = ch.age / ch.maxAge;
        const fade = lifeNorm > 0.75 ? Math.max(0, 1 - (lifeNorm - 0.75) / 0.25) : 1.0;

        _dummy.position.set(ch.x, ch.y, ch.z);
        _dummy.rotation.set(ch.rx, ch.ry, ch.rz);
        _dummy.scale.set(ch.sx * fade, ch.sy * fade, ch.sz * fade);
        _dummy.updateMatrix();
        pool.mesh.setMatrixAt(i, _dummy.matrix);
        poolDirty = true;
      }
      if (poolDirty) {
        pool.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Integrate impact pulverization dust flecks
    let dustDirty = false;
    for (let i = 0; i < impactDustCap; i++) {
      if (impactDustAge[i] >= impactDustMax[i]) continue;
      impactDustAge[i] += dt;
      if (impactDustAge[i] >= impactDustMax[i]) {
        impactDustPos[i * 3 + 1] = -99999;
      } else {
        impactDustPos[i * 3] += impactDustVel[i * 3] * dt;
        impactDustPos[i * 3 + 1] += impactDustVel[i * 3 + 1] * dt;
        impactDustPos[i * 3 + 2] += impactDustVel[i * 3 + 2] * dt;
      }
      dustDirty = true;
    }
    if (dustDirty) {
      (impactDustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // Stream interplanetary dust streaks past the moving camera frustum
    _right.crossVectors(cameraForward, upVec).normalize();
    if (_right.lengthSq() < 0.001) _right.set(1, 0, 0);
    _up.crossVectors(_right, cameraForward).normalize();

    const streakSpeed = 3.5 + velocityNorm * 92;
    const streakLen = 0.25 + velocityNorm * 2.25;
    dustMat.opacity = Math.min(0.42, velocityNorm * 0.44);

    for (let i = 0; i < dustCount; i++) {
      let lz = dustOffsets[i * 4 + 2] - dt * streakSpeed * dustOffsets[i * 4 + 3];
      if (lz < -4) lz += 68;
      dustOffsets[i * 4 + 2] = lz;

      const lx = dustOffsets[i * 4];
      const ly = dustOffsets[i * 4 + 1];
      _pos
        .copy(cameraPos)
        .addScaledVector(cameraForward, lz)
        .addScaledVector(_right, lx)
        .addScaledVector(_up, ly);

      _lookAt.copy(_pos).add(cameraForward);
      _dummy.position.copy(_pos);
      _dummy.lookAt(_lookAt);
      _dummy.scale.set(1, 1, streakLen);
      _dummy.updateMatrix();
      dustStreaks.setMatrixAt(i, _dummy.matrix);
    }
    dustStreaks.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    // Restore every debris asteroid back to its pristine initial home state
    for (let i = 0; i < debris.length; i++) {
      const b = debris[i];
      b.x = b.homeX;
      b.y = b.homeY;
      b.z = b.homeZ;
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      b.sx = b.homeSx;
      b.sy = b.homeSy;
      b.sz = b.homeSz;
      b.radius = b.homeRadius;
      b.collided = false;
      b.lastNearMissTime = -10;
      b.lastCollisionTime = -10;
      _dummy.position.set(b.x, b.y, b.z);
      _dummy.rotation.set(b.rx, b.ry, b.rz);
      _dummy.scale.set(b.sx, b.sy, b.sz);
      _dummy.updateMatrix();
      instancedGroups[b.meshIndex].setMatrixAt(b.instanceId, _dummy.matrix);
    }
    for (let gIdx = 0; gIdx < instancedGroups.length; gIdx++) {
      instancedGroups[gIdx].instanceMatrix.needsUpdate = true;
    }

    // Clear all active fracture chunks
    _dummy.position.set(0, 0, 0);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    for (let mIdx = 0; mIdx < shardPools.length; mIdx++) {
      const pool = shardPools[mIdx];
      pool.cursor = 0;
      for (let i = 0; i < pool.chunks.length; i++) {
        pool.chunks[i].active = false;
        pool.chunks[i].age = 0;
        pool.mesh.setMatrixAt(i, _dummy.matrix);
      }
      pool.mesh.instanceMatrix.needsUpdate = true;
    }

    // Clear all impact dust flecks
    for (let i = 0; i < impactDustCap; i++) {
      impactDustPos[i * 3] = 0;
      impactDustPos[i * 3 + 1] = -99999;
      impactDustPos[i * 3 + 2] = 0;
      impactDustAge[i] = 10;
    }
    (impactDustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  function dispose() {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }

  return {
    root,
    spline,
    sunPosition,
    sectors,
    debris,
    dustStreaks,
    fractureAsteroid,
    update,
    reset,
    dispose,
  };
}
