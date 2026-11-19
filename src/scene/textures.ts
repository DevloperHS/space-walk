import * as THREE from 'three';
import { createRng, evaluateCraterHeight, fbm3D, generateSphereCraters, ridged3D } from './noise';

/**
 * High-Resolution NASA-calibrated procedural PBR CanvasTexture library.
 * - Power-of-two 1024x512 planetary maps, 2048x16 Saturn ring strip, 512x512 tiled rock maps
 * - True 3x3 Sobel Tangent-Space Normal Maps generated from floating-point heightfields
 *   (dramatically sharper than 8-bit bumpMap screen-space derivatives)
 * - Full hardware anisotropic filtering + trilinear mipmapping for razor-sharp oblique detail
 * - Every albedo map uses SRGBColorSpace; data maps (normal, roughness) stay linear
 */

export interface PlanetTextureSet {
  map: THREE.CanvasTexture;
  normalMap?: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
  cloudsMap?: THREE.CanvasTexture;
  nightMap?: THREE.CanvasTexture;
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  maxAnisotropy: number,
  wrapS: THREE.Wrapping = THREE.RepeatWrapping,
  wrapT: THREE.Wrapping = THREE.ClampToEdgeWrapping,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a continuous Float32Array heightfield into a crisp OpenGL Tangent-Space Normal Map
 * using a 3x3 Sobel filter with seamless horizontal (and optional vertical) wrapping.
 */
function heightFieldToNormalMap(
  heights: Float32Array,
  w: number,
  h: number,
  strength: number,
  maxAniso: number,
  wrapVertical = false,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = wrapVertical
      ? ((y % h) + h) % h
      : y < 0
        ? 0
        : y >= h
          ? h - 1
          : y;
    return heights[wy * w + wx];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;

      let nx = -dX;
      let ny = dY; // OpenGL tangent-space Y-up convention for Three.js
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      d[idx] = clamp255((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = clamp255((nz * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return finalizeTexture(
    c,
    false,
    maxAniso,
    THREE.RepeatWrapping,
    wrapVertical ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
  );
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Equirectangular helper converting pixel (x, y) to unit sphere direction (nx, ny, nz)
 * so 3D noise wraps seamlessly with zero UV seam across longitudes.
 */
function equirectDir(u: number, v: number): [number, number, number] {
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  const sinT = Math.sin(theta);
  return [sinT * Math.cos(phi), Math.cos(theta), sinT * Math.sin(phi)];
}

export function createNeptuneTextures(maxAniso: number): PlanetTextureSet {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);
      const warp = fbm3D(nx * 2.6 + 3.1, ny * 6.0, nz * 2.6, 4);
      const lat = ny + (warp - 0.5) * 0.12;
      const band1 = Math.sin(lat * 20.0) * 0.5 + 0.5;
      const band2 = Math.cos(lat * 44.0 + warp * 2.2) * 0.5 + 0.5;
      const fine = fbm3D(nx * 10.5, ny * 22.0, nz * 10.5, 3);

      // Deep Voyager-2 cobalt-azure methane bands with crisp zonal contrast
      const bandMix = band1 * 0.72 + band2 * 0.28;
      let r = mix(24, 58, bandMix) + (fine - 0.5) * 18;
      let g = mix(58, 122, bandMix) + (fine - 0.5) * 24;
      let b = mix(148, 228, bandMix) + (fine - 0.5) * 28;

      // Great Dark Spot anticyclone with bright companion methane scooter clouds
      const spotDx = u - 0.36;
      const spotDy = (v - 0.62) * 1.85;
      const spotDist = Math.sqrt(spotDx * spotDx * 15 + spotDy * spotDy * 36);
      if (spotDist < 1.15) {
        const s = 1 - smoothstep(0.0, 1.0, spotDist);
        r = mix(r, 15, s * 0.76);
        g = mix(g, 34, s * 0.76);
        b = mix(b, 108, s * 0.58);
        // Bright crisp companion methane cirrus rim along southern edge of Dark Spot
        const companion = Math.exp(-Math.pow((spotDist - 0.88) / 0.14, 2)) * smoothstep(0.0, 0.06, spotDy);
        r = mix(r, 196, companion * 0.65);
        g = mix(g, 226, companion * 0.7);
        b = mix(b, 250, companion * 0.75);
      }

      // High-altitude crisp white-cyan methane cirrus streaks
      const cirrus = smoothstep(0.66, 0.82, fbm3D(nx * 6.5 + 10, ny * 26.0, nz * 6.5, 3));
      r = mix(r, 188, cirrus * 0.52);
      g = mix(g, 222, cirrus * 0.58);
      b = mix(b, 248, cirrus * 0.62);

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(r);
      d[idx + 1] = clamp255(g);
      d[idx + 2] = clamp255(b);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finalizeTexture(c, true, maxAniso) };
}

export function createUranusTextures(maxAniso: number): PlanetTextureSet {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);
      const haze = fbm3D(nx * 2.8, ny * 10.5, nz * 2.8, 3);
      const fine = fbm3D(nx * 8.0, ny * 24.0, nz * 8.0, 2);
      const polarHood = smoothstep(0.42, 0.92, Math.abs(ny));
      const band = Math.sin(ny * 14.0 + haze * 1.4) * 0.5 + 0.5;
      const collar = Math.exp(-Math.pow((Math.abs(ny) - 0.64) / 0.06, 2)) * 0.25;

      const t = band * 0.52 + polarHood * 0.44 + collar + (fine - 0.5) * 0.08;
      const r = mix(122, 184, t);
      const g = mix(190, 228, t);
      const b = mix(204, 236, t);

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(r);
      d[idx + 1] = clamp255(g);
      d[idx + 2] = clamp255(b);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finalizeTexture(c, true, maxAniso) };
}

export function createSaturnTextures(maxAniso: number): PlanetTextureSet & { ringMap: THREE.CanvasTexture } {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);
      const turb = fbm3D(nx * 4.0, ny * 16.0, nz * 4.0, 4);
      const micro = fbm3D(nx * 11.0 + turb, ny * 34.0, nz * 11.0, 2);
      const lat = ny + (turb - 0.5) * 0.038;

      // Crisp Cassini cream/ochre/amber zonal bands + olive-slate polar hexagon cap
      const b1 = Math.sin(lat * 32.0) * 0.5 + 0.5;
      const b2 = Math.cos(lat * 13.0 + 0.7) * 0.5 + 0.5;
      const b3 = Math.sin(lat * 68.0) * 0.5 + 0.5;
      const pole = smoothstep(0.74, 0.96, Math.abs(ny));

      const bandVal = b1 * 0.48 + b2 * 0.36 + b3 * 0.16;
      let r = mix(178, 236, bandVal) + (micro - 0.5) * 14;
      let g = mix(154, 212, bandVal) + (micro - 0.5) * 12;
      let b = mix(112, 166, bandVal) + (micro - 0.5) * 10;

      r = mix(r, 114, pole * 0.58);
      g = mix(g, 124, pole * 0.5);
      b = mix(b, 128, pole * 0.34);

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(r);
      d[idx + 1] = clamp255(g);
      d[idx + 2] = clamp255(b);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Ultra-sharp 2048x16 radial Saturn Ring strip (C, B, Cassini Division, A, Encke & Keeler Gaps, F)
  const rw = 2048;
  const rh = 16;
  const rc = document.createElement('canvas');
  rc.width = rw;
  rc.height = rh;
  const rctx = rc.getContext('2d')!;
  const rimg = rctx.createImageData(rw, rh);
  const rd = rimg.data;
  const rng = createRng(91823);

  const radialAlbedos = new Float32Array(rw);
  const radialWarmth = new Float32Array(rw);
  const radialAlphas = new Float32Array(rw);
  for (let x = 0; x < rw; x++) {
    const t = x / (rw - 1); // 0 = inner C ring edge, 1 = outer F ring
    const micro =
      Math.sin(t * 240) * 0.12 +
      Math.sin(t * 680 + 1.3) * 0.09 +
      Math.sin(t * 1480 + 2.7) * 0.06 +
      (rng() - 0.5) * 0.05;

    let alpha = 0;
    let tone = 0.72;
    let warm = 0.5;

    if (t > 0.035 && t < 0.23) {
      // C Ring: translucent smoky dusty ice with crisp Maxwell Gap
      const maxwell = 1 - Math.exp(-Math.pow((t - 0.175) / 0.004, 2));
      alpha = (mix(0.08, 0.3, (t - 0.035) / 0.195) + micro * 0.12) * maxwell;
      tone = 0.54 + micro * 0.1;
      warm = 0.35;
    } else if (t >= 0.23 && t < 0.62) {
      // B Ring: dense brilliant water-ice ringlets with fine radial banding
      const bProfile = smoothstep(0.23, 0.27, t) * (1 - smoothstep(0.59, 0.62, t) * 0.18);
      alpha = (0.8 + micro * 0.26) * bProfile;
      tone = 0.9 + micro * 0.16;
      warm = 0.62 + Math.sin(t * 95) * 0.18;
    } else if (t >= 0.62 && t < 0.684) {
      // Cassini Division: razor-sharp dark gap with thin Huygens ringlet
      const huygens = Math.exp(-Math.pow((t - 0.632) / 0.0025, 2)) * 0.42;
      alpha = 0.025 + huygens;
      tone = 0.55 + huygens * 0.4;
      warm = 0.4;
    } else if (t >= 0.684 && t < 0.935) {
      // A Ring with crisp Encke Gap (~0.868) & Keeler Gap (~0.922)
      const encke = 1 - Math.exp(-Math.pow((t - 0.868) / 0.0055, 2));
      const keeler = 1 - Math.exp(-Math.pow((t - 0.922) / 0.0022, 2));
      alpha = (0.58 + micro * 0.24) * encke * keeler;
      tone = 0.8 + micro * 0.14;
      warm = 0.52;
    } else if (t >= 0.958 && t < 0.972) {
      // Narrow braided F Ring
      const fCore = Math.exp(-Math.pow((t - 0.965) / 0.0035, 2));
      alpha = 0.42 * fCore;
      tone = 0.9;
      warm = 0.6;
    }

    radialAlbedos[x] = Math.max(0.22, Math.min(1.0, tone));
    radialWarmth[x] = warm;
    radialAlphas[x] = Math.max(0, Math.min(0.96, alpha));
  }

  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const tone = radialAlbedos[x];
      const warm = radialWarmth[x];
      const alpha = radialAlphas[x];
      const idx = (y * rw + x) * 4;
      rd[idx] = clamp255(mix(214, 236, warm) * tone);
      rd[idx + 1] = clamp255(mix(204, 218, warm) * tone);
      rd[idx + 2] = clamp255(mix(192, 182, warm) * tone);
      rd[idx + 3] = clamp255(alpha * 255);
    }
  }
  rctx.putImageData(rimg, 0, 0);

  return {
    map: finalizeTexture(c, true, maxAniso),
    ringMap: finalizeTexture(rc, true, maxAniso, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping),
  };
}

export function createJupiterTextures(maxAniso: number): PlanetTextureSet {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  // Authentic Juno palette stops (crisp cream zones, rust/sienna belts, blue-grey festoons)
  const palette: [number, number, number][] = [
    [228, 216, 194],
    [184, 128, 86],
    [236, 226, 208],
    [144, 92, 64],
    [216, 186, 148],
    [116, 82, 66],
    [232, 222, 202],
    [172, 114, 76],
    [206, 190, 166],
    [138, 96, 72],
  ];

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);

      // Multi-scale domain-warped turbulent shear between counter-flowing jet streams
      const eddy1 = fbm3D(nx * 4.5, ny * 12.0, nz * 4.5, 4);
      const eddy2 = fbm3D(nx * 11.0 + eddy1 * 1.6, ny * 24.0, nz * 11.0, 3);
      const filament = ridged3D(nx * 16.0 - eddy2 * 1.2, ny * 38.0, nz * 16.0, 2);
      const lat = ny + (eddy1 - 0.5) * 0.13 + (eddy2 - 0.5) * 0.048;

      const bandPos = ((lat * 0.5 + 0.5) * (palette.length - 1) + 10) % (palette.length - 1);
      const bi = Math.floor(bandPos);
      const bf = smoothstep(0.08, 0.92, bandPos - bi);
      const cA = palette[bi % palette.length];
      const cB = palette[(bi + 1) % palette.length];

      let r = mix(cA[0], cB[0], bf) + (eddy2 - 0.5) * 28 + (filament - 0.5) * 18;
      let g = mix(cA[1], cB[1], bf) + (eddy2 - 0.5) * 24 + (filament - 0.5) * 15;
      let b = mix(cA[2], cB[2], bf) + (eddy2 - 0.5) * 18 + (filament - 0.5) * 12;

      // White ammonia anticyclonic ovals along South Temperate Belt
      const ovalDist = Math.hypot((((u - 0.58 + 1.5) % 1) - 0.5) / 0.026, (v - 0.72) / 0.017);
      if (ovalDist < 1.1) {
        const om = 1 - smoothstep(0.45, 1.05, ovalDist);
        r = mix(r, 236, om * 0.78);
        g = mix(g, 230, om * 0.78);
        b = mix(b, 218, om * 0.75);
      }

      // Polar Juno slate-blue cyclones
      const polar = smoothstep(0.75, 0.96, Math.abs(ny));
      r = mix(r, 94, polar * 0.68);
      g = mix(g, 102, polar * 0.58);
      b = mix(b, 118, polar * 0.46);

      // Great Red Spot anticyclone with crisp internal spiral collar
      const grsU = ((u - 0.28 + 1.5) % 1) - 0.5;
      const grsV = v - 0.62;
      const rx = grsU / 0.072;
      const ry = grsV / 0.042;
      const r2 = rx * rx + ry * ry;
      if (r2 < 1.32) {
        const dist = Math.sqrt(r2);
        const angle = Math.atan2(ry, rx) + (1.3 - dist) * 4.4;
        const swirl = Math.sin(angle * 3.0 + dist * 12.0) * 0.5 + 0.5;
        const mask = 1 - smoothstep(0.42, 1.08, dist);
        const rimCollar = Math.exp(-Math.pow((dist - 1.02) / 0.12, 2));
        r = mix(r, mix(178, 228, swirl), mask * 0.94);
        g = mix(g, mix(68, 122, swirl), mask * 0.92);
        b = mix(b, mix(46, 82, swirl), mask * 0.9);
        r = mix(r, 232, rimCollar * 0.32);
        g = mix(g, 220, rimCollar * 0.32);
        b = mix(b, 200, rimCollar * 0.32);
      }

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(r);
      d[idx + 1] = clamp255(g);
      d[idx + 2] = clamp255(b);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finalizeTexture(c, true, maxAniso) };
}

export function createMarsTextures(maxAniso: number): PlanetTextureSet {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const heights = new Float32Array(w * h);
  const craters = generateSphereCraters(96, 4049, 0.018, 0.16);

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);

      const macro = fbm3D(nx * 2.4 + 1.4, ny * 2.4, nz * 2.4, 4);
      const ridge = ridged3D(nx * 6.5 + 7.2, ny * 6.5, nz * 6.5, 4);
      const grit = fbm3D(nx * 19.0, ny * 19.0, nz * 19.0, 2);
      const crater = evaluateCraterHeight(nx, ny, nz, craters);

      // Valles Marineris equatorial tectonic canyon scar with sharp terraced rim
      const canyonLat = Math.abs(ny + 0.14 + Math.sin(u * Math.PI * 4) * 0.028 + (ridge - 0.5) * 0.014);
      const canyonLon = Math.abs(((u - 0.52 + 1.5) % 1) - 0.5);
      const canyon =
        (1 - smoothstep(0.008, 0.036, canyonLat)) * (1 - smoothstep(0.055, 0.135, canyonLon));

      // Iron-oxide ochre dust highlands vs dark basaltic Syrtis Major maria
      const basalt = smoothstep(0.35, 0.62, macro);
      let r = mix(96, 202, basalt) + (ridge - 0.5) * 34 + (grit - 0.5) * 20 - canyon * 58;
      let g = mix(56, 112, basalt) + (ridge - 0.5) * 22 + (grit - 0.5) * 14 - canyon * 40;
      let b = mix(42, 70, basalt) + (ridge - 0.5) * 14 + (grit - 0.5) * 10 - canyon * 24;

      // Polar CO2/water ice caps with crisp spiral troughs
      const polarCap = smoothstep(0.86, 0.93, Math.abs(ny) + (ridge - 0.5) * 0.05);
      r = mix(r, 236, polarCap);
      g = mix(g, 232, polarCap);
      b = mix(b, 228, polarCap);

      const elev = 0.5 + (ridge - 0.5) * 0.45 + (grit - 0.5) * 0.14 + crater * 0.46 - canyon * 0.55;
      heights[y * w + x] = elev;

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(r + crater * 28);
      d[idx + 1] = clamp255(g + crater * 18);
      d[idx + 2] = clamp255(b + crater * 12);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  return {
    map: finalizeTexture(c, true, maxAniso),
    normalMap: heightFieldToNormalMap(heights, w, h, 2.8, maxAniso, false),
  };
}

export function createEarthTextures(maxAniso: number): PlanetTextureSet {
  const w = 1024;
  const h = 512;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = w;
  albedoCanvas.height = h;
  const actx = albedoCanvas.getContext('2d')!;
  const aimg = actx.createImageData(w, h);
  const ad = aimg.data;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const rctx = roughCanvas.getContext('2d')!;
  const rimg = rctx.createImageData(w, h);
  const rd = rimg.data;

  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = w;
  cloudCanvas.height = h;
  const cctx = cloudCanvas.getContext('2d')!;
  const cimg = cctx.createImageData(w, h);
  const cd = cimg.data;

  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = w;
  nightCanvas.height = h;
  const nctx = nightCanvas.getContext('2d')!;
  const nimg = nctx.createImageData(w, h);
  const nd = nimg.data;

  const heights = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);

      const cont = fbm3D(nx * 2.15 + 4.3, ny * 2.15 - 1.2, nz * 2.15 + 2.7, 5);
      const coastDetail = fbm3D(nx * 11.5, ny * 11.5, nz * 11.5, 3);
      const mount = ridged3D(nx * 8.0 + 1.1, ny * 8.0, nz * 8.0, 4);
      const absLat = Math.abs(ny);

      const contWithDetail = cont + (coastDetail - 0.5) * 0.048;
      const seaLevel = 0.51;
      const isLand = contWithDetail > seaLevel;
      const polarIce = smoothstep(0.80, 0.90, absLat + (coastDetail - 0.5) * 0.08);

      let r = 0;
      let g = 0;
      let b = 0;
      let rough = 0.85;
      let city = 0;
      let elevVal = 0.0;

      if (!isLand) {
        // Deep pelagic ocean + crisp turquoise continental shelf
        const shelf = smoothstep(seaLevel - 0.055, seaLevel, contWithDetail);
        r = mix(9, 24, shelf);
        g = mix(26, 72, shelf);
        b = mix(64, 114, shelf);
        rough = 0.21; // Crisp NASA solar ocean glint
        elevVal = 0.0;
      } else {
        const elev = (contWithDetail - seaLevel) / (1 - seaLevel);
        const aridity = smoothstep(0.14, 0.42, 1 - Math.abs(absLat - 0.36) * 2.5) * coastDetail;
        // Crisp temperate forest -> savanna -> desert ochre -> alpine mountain ridges
        let lr = mix(34, 166, aridity) + (coastDetail - 0.5) * 18;
        let lg = mix(74, 138, aridity) + (coastDetail - 0.5) * 16;
        let lb = mix(38, 92, aridity) + (coastDetail - 0.5) * 12;

        const high = smoothstep(0.22, 0.52, elev + mount * 0.32);
        const snowPeak = smoothstep(0.56, 0.78, elev + mount * 0.36);
        lr = mix(lr, 138, high * 0.62);
        lg = mix(lg, 130, high * 0.58);
        lb = mix(lb, 120, high * 0.52);

        lr = mix(lr, 224, snowPeak * 0.72);
        lg = mix(lg, 228, snowPeak * 0.72);
        lb = mix(lb, 232, snowPeak * 0.74);

        r = lr;
        g = lg;
        b = lb;
        rough = 0.87;
        elevVal = 0.08 + elev * 0.45 + mount * 0.48 * smoothstep(0.02, 0.16, elev);

        // Crisp nocturnal city web clusters near temperate coasts
        if (absLat < 0.72 && elev < 0.16) {
          const urban = fbm3D(nx * 28.0 + 3.0, ny * 28.0, nz * 28.0, 3);
          const core = ridged3D(nx * 42.0 - 1.5, ny * 42.0, nz * 42.0, 2);
          city = smoothstep(0.64, 0.82, urban * 0.72 + core * 0.28) * (1 - polarIce);
        }
      }

      if (polarIce > 0.01) {
        r = mix(r, 234, polarIce);
        g = mix(g, 240, polarIce);
        b = mix(b, 246, polarIce);
        rough = mix(rough, 0.64, polarIce);
      }

      heights[y * w + x] = elevVal;

      // Crisp multi-scale cyclonic weather clouds & frontal bands
      const swirl = fbm3D(nx * 3.6 - 2.0, ny * 4.8, nz * 3.6 + 5.1, 4);
      const cloudMacro = fbm3D(nx * 5.4 + swirl * 1.25, ny * 7.2, nz * 5.4 - swirl * 1.15, 4);
      const cloudWisp = fbm3D(nx * 16.0 + swirl * 2.0, ny * 18.0, nz * 16.0, 2);
      const cloudAlpha = smoothstep(0.49, 0.76, cloudMacro * 0.78 + cloudWisp * 0.22);

      const idx = (y * w + x) * 4;
      ad[idx] = clamp255(r);
      ad[idx + 1] = clamp255(g);
      ad[idx + 2] = clamp255(b);
      ad[idx + 3] = 255;

      const rByte = clamp255(rough * 255);
      rd[idx] = rByte;
      rd[idx + 1] = rByte;
      rd[idx + 2] = rByte;
      rd[idx + 3] = 255;

      cd[idx] = 246;
      cd[idx + 1] = 249;
      cd[idx + 2] = 254;
      cd[idx + 3] = clamp255(cloudAlpha * 238);

      nd[idx] = clamp255(city * 255);
      nd[idx + 1] = clamp255(city * 194);
      nd[idx + 2] = clamp255(city * 102);
      nd[idx + 3] = 255;
    }
  }

  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);

  return {
    map: finalizeTexture(albedoCanvas, true, maxAniso),
    normalMap: heightFieldToNormalMap(heights, w, h, 2.2, maxAniso, false),
    roughnessMap: finalizeTexture(roughCanvas, false, maxAniso),
    cloudsMap: finalizeTexture(cloudCanvas, true, maxAniso),
    nightMap: finalizeTexture(nightCanvas, true, maxAniso),
  };
}

export function createVenusTextures(maxAniso: number): PlanetTextureSet {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);
      // Akatsuki-style super-rotating V-shaped sulfuric cloud chevrons & fine streaks
      const chevron = ny * 7.5 + Math.abs(ny) * Math.sin(u * Math.PI * 2) * 1.45;
      const cloud = fbm3D(nx * 3.4, chevron * 0.48, nz * 3.4, 4);
      const streak = fbm3D(nx * 9.5 + cloud * 1.3, ny * 15.0, nz * 9.5, 3);
      const fine = ridged3D(nx * 15.0 + streak, ny * 26.0, nz * 15.0, 2);

      const t = cloud * 0.56 + streak * 0.3 + fine * 0.14;
      const r = mix(190, 244, t);
      const g = mix(160, 218, t);
      const b = mix(100, 154, t);

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(r);
      d[idx + 1] = clamp255(g);
      d[idx + 2] = clamp255(b);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finalizeTexture(c, true, maxAniso) };
}

export function createCrateredBodyTextures(
  maxAniso: number,
  seed: number,
  baseDark: [number, number, number],
  baseLight: [number, number, number],
  craterCount = 110,
): PlanetTextureSet {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const heights = new Float32Array(w * h);
  const craters = generateSphereCraters(craterCount, seed, 0.016, 0.17);

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const [nx, ny, nz] = equirectDir(u, v);

      const mare = fbm3D(nx * 2.8 + seed * 0.01, ny * 2.8, nz * 2.8, 4);
      const ridge = ridged3D(nx * 7.5 + seed * 0.02, ny * 7.5, nz * 7.5, 3);
      const grain = fbm3D(nx * 19.0, ny * 19.0, nz * 19.0, 2);
      const crater = evaluateCraterHeight(nx, ny, nz, craters);

      const tone =
        smoothstep(0.28, 0.72, mare) * 0.62 +
        ridge * 0.16 +
        grain * 0.22 +
        crater * 0.42;
      const t = Math.max(0, Math.min(1, tone));

      const idx = (y * w + x) * 4;
      d[idx] = clamp255(mix(baseDark[0], baseLight[0], t));
      d[idx + 1] = clamp255(mix(baseDark[1], baseLight[1], t));
      d[idx + 2] = clamp255(mix(baseDark[2], baseLight[2], t));
      d[idx + 3] = 255;

      heights[y * w + x] = 0.5 + crater * 0.58 + (ridge - 0.5) * 0.24 + (grain - 0.5) * 0.18;
    }
  }

  ctx.putImageData(img, 0, 0);

  return {
    map: finalizeTexture(c, true, maxAniso),
    normalMap: heightFieldToNormalMap(heights, w, h, 3.2, maxAniso, false),
  };
}

/**
 * High-resolution 512x512 tileable procedural asteroid regolith / fractured basalt PBR set
 * with crisp Sobel Tangent-Space Normal Map shared by the foreground rim and debris rocks.
 */
export function createAsteroidRockTextures(
  maxAniso: number,
  seed: number,
  tint: [number, number, number],
  repeat = 1,
): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const rc = document.createElement('canvas');
  rc.width = size;
  rc.height = size;
  const rctx = rc.getContext('2d')!;
  const rimg = rctx.createImageData(size, size);
  const rd = rimg.data;

  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const ty = (y / size) * Math.PI * 2;
    const cosTy = Math.cos(ty);
    const sinTy = Math.sin(ty);
    for (let x = 0; x < size; x++) {
      const tx = (x / size) * Math.PI * 2;
      // Torus-mapped coordinates for 100% seamless tileability
      const sx = Math.cos(tx) * 1.65 + seed * 0.17;
      const sy = Math.sin(tx) * 1.65 + cosTy * 1.65;
      const sz = sinTy * 1.65 - seed * 0.11;

      const strata = ridged3D(sx * 1.9, sy * 1.9, sz * 1.9, 4);
      const cracks = ridged3D(sx * 4.4 + 3.1, sy * 4.4 - 1.7, sz * 4.4, 3);
      const grit = fbm3D(sx * 9.5, sy * 9.5, sz * 9.5, 3);
      const pit = smoothstep(0.18, 0.34, fbm3D(sx * 3.4 + 5.2, sy * 3.4, sz * 3.4, 3));

      // Crisp fractured cleavage facets & micro-pitted regolith
      const height = strata * 0.52 + cracks * 0.24 + grit * 0.24 - (1 - pit) * 0.22;
      heights[y * size + x] = height;

      const shade =
        (0.38 + strata * 0.42 + cracks * 0.16 + (grit - 0.5) * 0.26) * (0.64 + pit * 0.36);
      const idx = (y * size + x) * 4;
      d[idx] = clamp255(tint[0] * shade);
      d[idx + 1] = clamp255(tint[1] * shade);
      d[idx + 2] = clamp255(tint[2] * shade);
      d[idx + 3] = 255;

      // Vary roughness across mineral facets & dusty regolith hollows (0.62 - 0.96)
      const roughVal = clamp255(mix(160, 248, 1 - strata * 0.58 - cracks * 0.15 + (grit - 0.5) * 0.2));
      rd[idx] = roughVal;
      rd[idx + 1] = roughVal;
      rd[idx + 2] = roughVal;
      rd[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  const map = finalizeTexture(c, true, maxAniso, THREE.RepeatWrapping, THREE.RepeatWrapping);
  const normalMap = heightFieldToNormalMap(heights, size, size, 3.8, maxAniso, true);
  const roughnessMap = finalizeTexture(rc, false, maxAniso, THREE.RepeatWrapping, THREE.RepeatWrapping);

  if (repeat !== 1) {
    map.repeat.set(repeat, repeat);
    normalMap.repeat.set(repeat, repeat);
    roughnessMap.repeat.set(repeat, repeat);
  }

  return { map, normalMap, roughnessMap };
}

export type AsteroidSurfaceStyle =
  | 'carbonaceous'
  | 'stratifiedDust'
  | 'stonySilicate'
  | 'metallicNickelIron'
  | 'oxidizedBasalt'
  | 'veinedSlate'
  | 'frostedComet';

export interface AsteroidPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  metalnessMap?: THREE.CanvasTexture;
}

interface TileCrater {
  u: number;
  v: number;
  r: number;
  depth: number;
  fresh: number;
}

function generateTileCraters(count: number, seed: number, minR: number, maxR: number): TileCrater[] {
  const rng = createRng(seed);
  const list: TileCrater[] = [];
  for (let i = 0; i < count; i++) {
    list.push({
      u: rng(),
      v: rng(),
      r: minR + Math.pow(rng(), 1.9) * (maxR - minR),
      depth: 0.45 + rng() * 0.55,
      fresh: rng(),
    });
  }
  return list;
}

function evaluateTileCraters(u: number, v: number, craters: TileCrater[]): [number, number] {
  let h = 0;
  let ejecta = 0;
  for (let i = 0; i < craters.length; i++) {
    const c = craters[i];
    let du = Math.abs(u - c.u);
    if (du > 0.5) du = 1.0 - du;
    if (du > c.r * 1.55) continue;
    let dv = Math.abs(v - c.v);
    if (dv > 0.5) dv = 1.0 - dv;
    if (dv > c.r * 1.55) continue;

    const dist = Math.sqrt(du * du + dv * dv);
    const q = dist / c.r;
    if (q < 1.48) {
      if (q < 1.0) {
        const bowl = (q * q - 1.0) * 0.65;
        const rim = Math.exp(-Math.pow((q - 0.96) / 0.13, 2)) * 0.36;
        h += (bowl + rim) * c.depth;
        if (c.fresh > 0.55) {
          ejecta += (1.0 - q * 0.7) * 0.22 * c.fresh;
        }
      } else {
        const rim = Math.exp(-Math.pow((q - 0.96) / 0.16, 2)) * 0.34;
        h += rim * c.depth;
        if (c.fresh > 0.55) {
          ejecta += (1.0 - (q - 1.0) / 0.48) * 0.28 * c.fresh;
        }
      }
    }
  }
  return [h, Math.min(1.0, ejecta)];
}

/**
 * World-taste diverse procedural 512x512 seamless PBR surface texture library for
 * Solar System asteroids: carbonaceous chondrite, stratified comet dust, S-type
 * cratered silicate, M-type Widmanstatten iron-nickel ore (with metalnessMap),
 * V-type oxidized basalt, quartz-veined tectonic slate, and frosted cryo-nucleus.
 */
export function createDiverseAsteroidTextures(
  maxAniso: number,
  style: AsteroidSurfaceStyle,
  seed: number,
  repeat = 2,
): AsteroidPbrTextureSet {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const rc = document.createElement('canvas');
  rc.width = size;
  rc.height = size;
  const rctx = rc.getContext('2d')!;
  const rimg = rctx.createImageData(size, size);
  const rd = rimg.data;

  const needsMetalMap = style === 'metallicNickelIron' || style === 'veinedSlate';
  let mc: HTMLCanvasElement | null = null;
  let mctx: CanvasRenderingContext2D | null = null;
  let mimg: ImageData | null = null;
  let md: Uint8ClampedArray | null = null;
  if (needsMetalMap) {
    mc = document.createElement('canvas');
    mc.width = size;
    mc.height = size;
    mctx = mc.getContext('2d')!;
    mimg = mctx.createImageData(size, size);
    md = mimg.data;
  }

  const heights = new Float32Array(size * size);
  const tileCraters =
    style === 'carbonaceous'
      ? generateTileCraters(26, seed + 17, 0.024, 0.095)
      : style === 'stonySilicate'
        ? generateTileCraters(28, seed + 31, 0.022, 0.115)
        : style === 'oxidizedBasalt'
          ? generateTileCraters(18, seed + 53, 0.028, 0.12)
          : style === 'frostedComet'
            ? generateTileCraters(22, seed + 79, 0.026, 0.105)
            : style === 'stratifiedDust'
              ? generateTileCraters(14, seed + 41, 0.025, 0.09)
              : generateTileCraters(10, seed + 97, 0.02, 0.075);

  const normalStrength =
    style === 'veinedSlate'
      ? 4.4
      : style === 'carbonaceous' || style === 'oxidizedBasalt'
        ? 4.2
        : style === 'metallicNickelIron'
          ? 3.4
          : 3.9;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const ty = v * Math.PI * 2;
    const cosTy = Math.cos(ty);
    const sinTy = Math.sin(ty);
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const tx = u * Math.PI * 2;
      // Seamless 4D->3D torus projection for zero-seam tiling
      const sx = Math.cos(tx) * 1.65 + seed * 0.19;
      const sy = Math.sin(tx) * 1.65 + cosTy * 1.65;
      const sz = sinTy * 1.65 - seed * 0.13;

      const strata = ridged3D(sx * 1.85, sy * 1.85, sz * 1.85, 3);
      const cracks = ridged3D(sx * 4.3 + 2.7, sy * 4.3 - 1.9, sz * 4.3, 3);
      const grit = fbm3D(sx * 9.2, sy * 9.2, sz * 9.2, 2);
      const macro = fbm3D(sx * 1.15 - 3.4, sy * 1.15 + 2.1, sz * 1.15, 3);
      const [craterH, ejecta] = evaluateTileCraters(u, v, tileCraters);

      let r = 100;
      let g = 100;
      let b = 100;
      let height = 0.5;
      let rough = 0.88;
      let metal = 0.1;

      if (style === 'carbonaceous') {
        // C-Type Bennu / Ryugu dark soot chondrite with bright micro-chondrule flecks & crisp craters
        const pit = smoothstep(0.16, 0.36, fbm3D(sx * 3.8 + 4.2, sy * 3.8, sz * 3.8, 2));
        const chondrule = smoothstep(0.76, 0.90, grit);
        height = strata * 0.44 + cracks * 0.24 + grit * 0.16 + craterH * 0.52 - (1 - pit) * 0.18;
        const baseShade = (0.34 + strata * 0.38 + cracks * 0.14 + (grit - 0.5) * 0.22) * (0.68 + pit * 0.32);
        const cLift = Math.max(0, craterH) * 0.28 + ejecta * 0.22 + chondrule * 0.38;
        r = mix(52, 118, Math.min(1, baseShade + cLift));
        g = mix(50, 113, Math.min(1, baseShade + cLift));
        b = mix(49, 108, Math.min(1, baseShade + cLift));
        rough = mix(0.84, 0.98, 1.0 - chondrule * 0.35 - strata * 0.25);
      } else if (style === 'stratifiedDust') {
        // Contact-binary 67P / Itokawa layered dusty taupe-ochre regolith strata
        const warp = macro * 2.6 + strata * 0.8;
        const layerWave = Math.sin(ty * 3.0 + warp * 3.1) * 0.5 + 0.5;
        const ledge = smoothstep(0.35, 0.72, layerWave);
        const dustPool = smoothstep(0.42, 0.75, macro);
        height = ledge * 0.34 + strata * 0.30 + cracks * 0.16 + grit * 0.14 + craterH * 0.44;
        const tone = 0.38 + ledge * 0.32 + strata * 0.18 + (grit - 0.5) * 0.16 + craterH * 0.22;
        r = mix(74, 166, Math.max(0, Math.min(1, tone))) + dustPool * 12;
        g = mix(64, 146, Math.max(0, Math.min(1, tone))) + dustPool * 8;
        b = mix(54, 124, Math.max(0, Math.min(1, tone))) + dustPool * 4;
        rough = mix(0.76, 0.96, dustPool * 0.55 + (1 - ledge) * 0.45);
      } else if (style === 'stonySilicate') {
        // S-Type Eros / Gaspra warm buff-tan grooved silicate with fresh crater ejecta rays
        const groove = Math.sin(tx * 2.0 + ty * 1.0 + macro * 2.2) * 0.5 + 0.5;
        const grooveCut = smoothstep(0.18, 0.42, groove);
        height = strata * 0.36 + cracks * 0.20 + grit * 0.18 + craterH * 0.58 - (1 - grooveCut) * 0.16;
        const tone = 0.40 + strata * 0.34 + (grit - 0.5) * 0.20 + craterH * 0.26;
        const clamped = Math.max(0, Math.min(1, tone));
        r = mix(84, 178, clamped) + ejecta * 34;
        g = mix(76, 160, clamped) + ejecta * 30;
        b = mix(66, 138, clamped) + ejecta * 24;
        rough = mix(0.68, 0.93, 1.0 - strata * 0.4 - ejecta * 0.22);
      } else if (style === 'metallicNickelIron') {
        // M-Type 16 Psyche sheared gunmetal iron-nickel alloy with Widmanstatten crystal lamellae
        const lamellaA = Math.abs(Math.sin((sx * 6.4 + sy * 4.1) + macro * 1.6));
        const lamellaB = Math.abs(Math.sin((sy * 5.8 - sz * 5.2) + strata * 1.4));
        const widman = Math.min(lamellaA, lamellaB);
        const facet = smoothstep(0.28, 0.76, strata * 0.65 + widman * 0.35);
        const oxide = smoothstep(0.54, 0.84, 1.0 - cracks * 0.7 - strata * 0.3 + (macro - 0.5) * 0.5);
        height = facet * 0.46 + cracks * 0.26 + grit * 0.12 + craterH * 0.38;

        // Exposed bright steel-nickel cleavage planes vs oxidized dark bronze crevices
        const steelR = mix(118, 214, facet) + (grit - 0.5) * 18;
        const steelG = mix(123, 220, facet) + (grit - 0.5) * 18;
        const steelB = mix(132, 230, facet) + (grit - 0.5) * 16;
        r = mix(steelR, 82, oxide * 0.78);
        g = mix(steelG, 66, oxide * 0.80);
        b = mix(steelB, 56, oxide * 0.82);

        rough = mix(0.22, 0.82, oxide * 0.74 + (1.0 - facet) * 0.32 + (grit - 0.5) * 0.12);
        metal = mix(0.95, 0.24, oxide * 0.82);
      } else if (style === 'oxidizedBasalt') {
        // V-Type iron-oxide rust/terracotta volcanic crust with dark pyroxene veins & craters
        const flow = fbm3D(sx * 2.6 + 6.1, sy * 2.6 - 2.4, sz * 2.6, 3);
        const rustPatch = smoothstep(0.34, 0.68, macro * 0.65 + flow * 0.35);
        const darkVein = 1.0 - smoothstep(0.68, 0.88, cracks);
        height = strata * 0.42 + cracks * 0.26 + grit * 0.16 + craterH * 0.54;
        const baseR = mix(66, 174, rustPatch);
        const baseG = mix(54, 102, rustPatch);
        const baseB = mix(50, 74, rustPatch);
        const mod = (0.64 + strata * 0.36 + (grit - 0.5) * 0.20 + craterH * 0.25) * (0.62 + darkVein * 0.38);
        r = baseR * mod + ejecta * 28;
        g = baseG * mod + ejecta * 20;
        b = baseB * mod + ejecta * 14;
        rough = mix(0.72, 0.95, rustPatch * 0.55 + (1 - strata) * 0.4);
      } else if (style === 'veinedSlate') {
        // Tectonic dark obsidian-slate fractured by razor-sharp pale quartz/mineral veins
        const veinRaw = ridged3D(sx * 3.1 + 4.7, sy * 3.1 - 3.2, sz * 3.1 + 1.5, 3);
        const vein = smoothstep(0.74, 0.92, veinRaw);
        const microVein = smoothstep(0.80, 0.94, cracks) * 0.55;
        const veinMask = Math.min(1.0, vein + microVein);
        const stepPlane = Math.floor(strata * 5.0) / 5.0 * 0.45 + strata * 0.55;
        height = stepPlane * 0.48 + cracks * 0.22 + grit * 0.14 - veinMask * 0.16 + craterH * 0.32;

        const slateShade = 0.52 + stepPlane * 0.48 + (grit - 0.5) * 0.18;
        const sr = 66 * slateShade;
        const sg = 71 * slateShade;
        const sb = 80 * slateShade;
        // Pale warm-quartz / sulfur-tinted mineral veins
        r = mix(sr, 206, veinMask * 0.85);
        g = mix(sg, 198, veinMask * 0.85);
        b = mix(sb, 182, veinMask * 0.82);

        rough = mix(0.88, 0.34, veinMask * 0.82 + (stepPlane - 0.4) * 0.25);
        metal = mix(0.14, 0.52, veinMask * 0.78);
      } else {
        // 'frostedComet': Deep carbon-slate Kuiper crust with crisp exposed water-ice frost deposits
        const hollow = smoothstep(0.46, 0.78, 1.0 - strata * 0.55 - macro * 0.45);
        const craterFrost = smoothstep(-0.08, -0.34, craterH);
        const frostMask = smoothstep(0.38, 0.68, hollow * 0.68 + craterFrost * 0.55 + (cracks - 0.5) * 0.35);
        height = strata * 0.46 + cracks * 0.22 + grit * 0.16 + craterH * 0.56 - frostMask * 0.08;

        const darkShade = 0.55 + strata * 0.45 + (grit - 0.5) * 0.20;
        const dr = 56 * darkShade;
        const dg = 60 * darkShade;
        const db = 68 * darkShade;

        const frostSparkle = 0.90 + grit * 0.20;
        r = mix(dr, 196 * frostSparkle, frostMask * 0.90);
        g = mix(dg, 218 * frostSparkle, frostMask * 0.90);
        b = mix(db, 238 * frostSparkle, frostMask * 0.92);

        rough = mix(0.95, 0.26, frostMask * 0.92);
      }

      heights[y * size + x] = height;

      const idx = (y * size + x) * 4;
      d[idx] = clamp255(r);
      d[idx + 1] = clamp255(g);
      d[idx + 2] = clamp255(b);
      d[idx + 3] = 255;

      const roughByte = clamp255(Math.max(0.14, Math.min(0.99, rough)) * 255);
      rd[idx] = roughByte;
      rd[idx + 1] = roughByte;
      rd[idx + 2] = roughByte;
      rd[idx + 3] = 255;

      if (md) {
        const metalByte = clamp255(Math.max(0.0, Math.min(1.0, metal)) * 255);
        md[idx] = metalByte;
        md[idx + 1] = metalByte;
        md[idx + 2] = metalByte;
        md[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  const map = finalizeTexture(c, true, maxAniso, THREE.RepeatWrapping, THREE.RepeatWrapping);
  const normalMap = heightFieldToNormalMap(heights, size, size, normalStrength, maxAniso, true);
  const roughnessMap = finalizeTexture(rc, false, maxAniso, THREE.RepeatWrapping, THREE.RepeatWrapping);
  let metalnessMap: THREE.CanvasTexture | undefined;

  if (mc && mctx && mimg) {
    mctx.putImageData(mimg, 0, 0);
    metalnessMap = finalizeTexture(mc, false, maxAniso, THREE.RepeatWrapping, THREE.RepeatWrapping);
  }

  if (repeat !== 1) {
    map.repeat.set(repeat, repeat);
    normalMap.repeat.set(repeat, repeat);
    roughnessMap.repeat.set(repeat, repeat);
    if (metalnessMap) metalnessMap.repeat.set(repeat, repeat);
  }

  return { map, normalMap, roughnessMap, metalnessMap };
}

export function createSoftRadialGlowTexture(size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 250, 240, 1.0)');
  grad.addColorStop(0.18, 'rgba(255, 232, 195, 0.72)');
  grad.addColorStop(0.45, 'rgba(255, 195, 130, 0.22)');
  grad.addColorStop(0.78, 'rgba(255, 150, 90, 0.04)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
