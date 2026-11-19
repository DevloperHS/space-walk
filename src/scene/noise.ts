/**
 * Deterministic procedural noise library shared across all planetary textures,
 * foreground asteroid crag displacement, and belt debris clustering so every
 * asset in the Solar System obeys one consistent geological grammar.
 */

export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(ix: number, iy: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);

  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);

  const nx00 = lerp(n000, n100, fx);
  const nx10 = lerp(n010, n110, fx);
  const nx01 = lerp(n001, n101, fx);
  const nx11 = lerp(n011, n111, fx);

  const nxy0 = lerp(nx00, nx10, fy);
  const nxy1 = lerp(nx01, nx11, fy);

  return lerp(nxy0, nxy1, fz);
}

export function fbm3D(
  x: number,
  y: number,
  z: number,
  octaves = 4,
  lacunarity = 2.05,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3D(x * freq, y * freq, z * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export function ridged3D(
  x: number,
  y: number,
  z: number,
  octaves = 4,
  lacunarity = 2.15,
  gain = 0.52,
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const n = valueNoise3D(x * freq, y * freq, z * freq);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += amp * ridge * ridge;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export interface CraterDef {
  nx: number;
  ny: number;
  nz: number;
  radius: number;
  depth: number;
  cosLimit: number;
}

export function generateSphereCraters(count: number, seed: number, minR = 0.04, maxR = 0.26): CraterDef[] {
  const rng = createRng(seed);
  const craters: CraterDef[] = [];
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const r = minR + Math.pow(rng(), 2.2) * (maxR - minR);
    craters.push({
      nx: s * Math.cos(phi),
      ny: u,
      nz: s * Math.sin(phi),
      radius: r,
      depth: 0.45 + rng() * 0.55,
      cosLimit: Math.cos(Math.min(Math.PI, r * 1.42)),
    });
  }
  return craters;
}

export function evaluateCraterHeight(
  nx: number,
  ny: number,
  nz: number,
  craters: CraterDef[],
): number {
  let h = 0;
  for (let i = 0; i < craters.length; i++) {
    const c = craters[i];
    const dot = nx * c.nx + ny * c.ny + nz * c.nz;
    if (dot < c.cosLimit) continue;
    const dist = Math.acos(Math.min(1, Math.max(-1, dot)));
    const q = dist / c.radius;
    if (q < 1.38) {
      if (q < 1.0) {
        // Sharp bowl depression with terraced inner wall & crisp raised rim shoulder
        const bowl = (q * q - 1.0) * 0.68;
        const rim = Math.exp(-Math.pow((q - 0.98) / 0.12, 2)) * 0.38;
        h += (bowl + rim) * c.depth;
      } else {
        // Ejecta rim falloff
        const rim = Math.exp(-Math.pow((q - 0.98) / 0.15, 2)) * 0.35;
        h += rim * c.depth;
      }
    }
  }
  return h;
}
