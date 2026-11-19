import * as THREE from 'three';
import {
  AsteroidSurfaceStyle,
  generateAsteroidRockBuffers,
  generateCrateredBodyBuffers,
  generateDiverseAsteroidBuffers,
  generateEarthBuffers,
  generateJupiterBuffers,
  generateMarsBuffers,
  generateNeptuneBuffers,
  generateSaturnBuffers,
  generateUranusBuffers,
  generateVenusBuffers,
  RawAsteroidBuffers,
  RawPlanetBuffers,
  TextureJob,
} from './textureGenerators';
import { buildDataTexture, ProgressiveTexturePipeline } from './texturePipeline';

export type { AsteroidSurfaceStyle };

/**
 * Progressive High-Resolution NASA-calibrated procedural PBR Texture library.
 * - Instant sub-30ms bootstrap using tiny preview textures (128x64 planets, 64x64 rocks)
 *   so the browser window never freezes on low-end devices.
 * - Seamless off-main-thread Web Worker upgrade to full 1024x512 planetary maps,
 *   2048x16 Saturn ring strip, and 512x512 tiled asteroid PBR sets with 3x3 Sobel normals.
 * - Full hardware anisotropic filtering + trilinear mipmapping + SRGBColorSpace on albedos.
 */

export interface PlanetTextureSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  cloudsMap?: THREE.Texture;
  nightMap?: THREE.Texture;
  ringMap?: THREE.Texture;
}

export interface AsteroidPbrTextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  metalnessMap?: THREE.Texture;
}

export function planetBuffersToTextures(
  bufs: RawPlanetBuffers,
  maxAniso: number,
): PlanetTextureSet {
  return {
    map: buildDataTexture(bufs.map, true, maxAniso),
    normalMap: bufs.normalMap ? buildDataTexture(bufs.normalMap, false, maxAniso) : undefined,
    roughnessMap: bufs.roughnessMap
      ? buildDataTexture(bufs.roughnessMap, false, maxAniso)
      : undefined,
    cloudsMap: bufs.cloudsMap ? buildDataTexture(bufs.cloudsMap, true, maxAniso) : undefined,
    nightMap: bufs.nightMap ? buildDataTexture(bufs.nightMap, true, maxAniso) : undefined,
    ringMap: bufs.ringMap
      ? buildDataTexture(
          bufs.ringMap,
          true,
          maxAniso,
          THREE.ClampToEdgeWrapping,
          THREE.ClampToEdgeWrapping,
        )
      : undefined,
  };
}

export function asteroidBuffersToTextures(
  bufs: RawAsteroidBuffers,
  maxAniso: number,
  repeat = 1,
): AsteroidPbrTextureSet {
  return {
    map: buildDataTexture(
      bufs.map,
      true,
      maxAniso,
      THREE.RepeatWrapping,
      THREE.RepeatWrapping,
      repeat,
    ),
    normalMap: buildDataTexture(
      bufs.normalMap,
      false,
      maxAniso,
      THREE.RepeatWrapping,
      THREE.RepeatWrapping,
      repeat,
    ),
    roughnessMap: buildDataTexture(
      bufs.roughnessMap,
      false,
      maxAniso,
      THREE.RepeatWrapping,
      THREE.RepeatWrapping,
      repeat,
    ),
    metalnessMap: bufs.metalnessMap
      ? buildDataTexture(
          bufs.metalnessMap,
          false,
          maxAniso,
          THREE.RepeatWrapping,
          THREE.RepeatWrapping,
          repeat,
        )
      : undefined,
  };
}

export function createPlanetPreviewTextures(
  job: TextureJob,
  maxAniso: number,
): PlanetTextureSet {
  let bufs: RawPlanetBuffers;
  switch (job.kind) {
    case 'neptune':
      bufs = generateNeptuneBuffers(128, 64);
      break;
    case 'uranus':
      bufs = generateUranusBuffers(128, 64);
      break;
    case 'saturn':
      bufs = generateSaturnBuffers(128, 64, 256, 2);
      break;
    case 'jupiter':
      bufs = generateJupiterBuffers(128, 64);
      break;
    case 'mars':
      bufs = generateMarsBuffers(128, 64);
      break;
    case 'earth':
      bufs = generateEarthBuffers(128, 64);
      break;
    case 'venus':
      bufs = generateVenusBuffers(128, 64);
      break;
    case 'crateredBody':
      bufs = generateCrateredBodyBuffers(
        128,
        64,
        job.seed,
        job.baseDark,
        job.baseLight,
        Math.min(job.craterCount, 40),
      );
      break;
    default:
      bufs = generateNeptuneBuffers(128, 64);
      break;
  }
  return planetBuffersToTextures(bufs, maxAniso);
}

export function createAsteroidRockPreviewTextures(
  maxAniso: number,
  seed: number,
  tint: [number, number, number],
  repeat = 1,
): AsteroidPbrTextureSet {
  return asteroidBuffersToTextures(generateAsteroidRockBuffers(64, seed, tint), maxAniso, repeat);
}

export function createDiverseAsteroidPreviewTextures(
  maxAniso: number,
  style: AsteroidSurfaceStyle,
  seed: number,
  repeat = 2,
): AsteroidPbrTextureSet {
  return asteroidBuffersToTextures(
    generateDiverseAsteroidBuffers(64, style, seed),
    maxAniso,
    repeat,
  );
}

export function enqueuePlanetUpgrade(
  pipeline: ProgressiveTexturePipeline,
  priority: number,
  job: TextureJob,
  maxAniso: number,
  onApply: (full: PlanetTextureSet) => void,
): void {
  pipeline.enqueue(priority, job, (raw) => {
    onApply(planetBuffersToTextures(raw as RawPlanetBuffers, maxAniso));
  });
}

export function enqueueAsteroidUpgrade(
  pipeline: ProgressiveTexturePipeline,
  priority: number,
  job: TextureJob,
  maxAniso: number,
  repeat: number,
  onApply: (full: AsteroidPbrTextureSet) => void,
): void {
  pipeline.enqueue(priority, job, (raw) => {
    onApply(asteroidBuffersToTextures(raw as RawAsteroidBuffers, maxAniso, repeat));
  });
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
