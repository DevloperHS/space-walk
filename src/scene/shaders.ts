import * as THREE from 'three';

/**
 * Custom GLSL shaders adhering to StarKnightt/world-taste consistency & optical sharpness:
 * - GPU-side infinite-resolution analytical 3D micro-detail (enhanceMaterialWithMicroDetail)
 *   with fwidth() distance anti-aliasing for razor-sharp planets, moons & asteroids at any zoom
 * - True solar vector illumination on atmospheric scattering limbs & Saturn's ring shadow
 * - Physically calibrated irradiance ceilings so bloom stays optical, never blown-out
 * - Chromatic Fresnel refraction for crystalline ice shards & asteroid ice veins
 * - Unified single-pass mobile-optimized CinematicPostShader with:
 *   (1) Strict peripheral-only velocity motion blur (keeping center & planets 100% crisp)
 *   (2) Integrated 5-tap AMD FidelityFX Contrast-Adaptive Sharpening (CAS)
 *   (3) Volumetric screen-space radial solar god-rays
 *   (4) Subtle perihelion refraction shimmer & refined 35mm optical grain
 */

export interface MicroDetailOptions {
  scale: number;
  albedoContrast: number;
  normalStrength: number;
  zonalStretch?: number; // > 1 stretches detail horizontally into planetary jet-stream bands
}

/**
 * Injects infinite-resolution analytical 3D value-noise micro-detail & per-pixel normal
 * perturbation directly into a Three.js PBR MeshStandardMaterial / MeshPhysicalMaterial.
 * Uses exact analytical derivatives (zero 2x2 screen-space quad blockiness) and automatic
 * fwidth() attenuation so distant objects stay smooth and close-up surfaces stay razor-sharp.
 */
export function enhanceMaterialWithMicroDetail(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  options: MicroDetailOptions,
): void {
  const { scale, albedoContrast, normalStrength, zonalStretch = 1.0 } = options;
  // All four parameters are uniforms (not GLSL defines), so sharing one cache key eliminates
  // ~12 redundant full PBR shader compilations on startup without changing a single rendered pixel.
  material.customProgramCacheKey = () => 'microdetail_v1';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailScale = { value: scale };
    shader.uniforms.uAlbedoContrast = { value: albedoContrast };
    shader.uniforms.uNormalStrength = { value: normalStrength };
    shader.uniforms.uZonalStretch = { value: zonalStretch };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vDetailPos;
        varying vec3 vObjToViewX;
        varying vec3 vObjToViewY;
        varying vec3 vObjToViewZ;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vDetailPos = position;
        #ifdef USE_INSTANCING
          mat3 detailObjMat = mat3(modelViewMatrix) * mat3(instanceMatrix);
        #else
          mat3 detailObjMat = mat3(modelViewMatrix);
        #endif
        vObjToViewX = detailObjMat[0] / max(length(detailObjMat[0]), 1e-5);
        vObjToViewY = detailObjMat[1] / max(length(detailObjMat[1]), 1e-5);
        vObjToViewZ = detailObjMat[2] / max(length(detailObjMat[2]), 1e-5);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
        #include <common>
        uniform float uDetailScale;
        uniform float uAlbedoContrast;
        uniform float uNormalStrength;
        uniform float uZonalStretch;

        varying vec3 vDetailPos;
        varying vec3 vObjToViewX;
        varying vec3 vObjToViewY;
        varying vec3 vObjToViewZ;

        float detailHash3(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        // Exact analytical 3D value noise returning vec4(value, d/dx, d/dy, d/dz)
        vec4 detailNoise3D(vec3 x) {
          vec3 i = floor(x);
          vec3 w = fract(x);
          vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
          vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);

          float a = detailHash3(i + vec3(0.0, 0.0, 0.0));
          float b = detailHash3(i + vec3(1.0, 0.0, 0.0));
          float c = detailHash3(i + vec3(0.0, 1.0, 0.0));
          float d = detailHash3(i + vec3(1.0, 1.0, 0.0));
          float e = detailHash3(i + vec3(0.0, 0.0, 1.0));
          float f = detailHash3(i + vec3(1.0, 0.0, 1.0));
          float g = detailHash3(i + vec3(0.0, 1.0, 1.0));
          float h = detailHash3(i + vec3(1.0, 1.0, 1.0));

          float k0 = a;
          float k1 = b - a;
          float k2 = c - a;
          float k3 = e - a;
          float k4 = a - b - c + d;
          float k5 = a - c - e + g;
          float k6 = a - b - e + f;
          float k7 = -a + b + c - d + e - f - g + h;

          float val = k0 + k1*u.x + k2*u.y + k3*u.z + k4*u.x*u.y + k5*u.y*u.z + k6*u.z*u.x + k7*u.x*u.y*u.z;
          vec3 grad = du * vec3(
            k1 + k4*u.y + k6*u.z + k7*u.y*u.z,
            k2 + k5*u.z + k4*u.x + k7*u.z*u.x,
            k3 + k6*u.x + k5*u.y + k7*u.x*u.y
          );
          return vec4(val, grad);
        }
        `,
      )
      .replace(
        '#include <map_fragment>',
        `
        #include <map_fragment>
        vec3 detailCoord = vDetailPos * vec3(uDetailScale, uDetailScale * uZonalStretch, uDetailScale);
        float detailFw = length(fwidth(detailCoord));
        float detailFade = 1.0 - smoothstep(0.45, 2.2, detailFw);
        vec4 dN1 = vec4(0.5, 0.0, 0.0, 0.0);
        vec4 dN2 = vec4(0.5, 0.0, 0.0, 0.0);
        if (detailFade > 0.01) {
          dN1 = detailNoise3D(detailCoord);
          float detailFade2 = 1.0 - smoothstep(0.35, 1.5, detailFw * 2.15);
          if (detailFade2 > 0.01) {
            dN2 = detailNoise3D(detailCoord * 2.15 + vec3(13.7, -9.2, 5.4));
          }
          float microVal = (dN1.x * 0.64 + dN2.x * 0.36 - 0.5) * 2.0;
          diffuseColor.rgb *= 1.0 + microVal * uAlbedoContrast * detailFade;
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        #include <normal_fragment_maps>
        if (uNormalStrength > 0.001 && detailFade > 0.01) {
          vec3 gradObj = (dN1.yzw * 0.65 + dN2.yzw * 0.35) * vec3(1.0, uZonalStretch, 1.0);
          vec3 gradView =
            vObjToViewX * gradObj.x +
            vObjToViewY * gradObj.y +
            vObjToViewZ * gradObj.z;
          gradView -= normal * dot(gradView, normal);
          normal = normalize(normal - gradView * uNormalStrength * detailFade);
        }
        `,
      );
  };
}

export function createAtmosphereMaterial(
  colorHex: number,
  sunPosition: THREE.Vector3,
  intensity = 1.15,
  power = 3.6,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uSunPosition: { value: sunPosition.clone() },
      uIntensity: { value: intensity },
      uPower: { value: power },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uSunPosition;
      uniform float uIntensity;
      uniform float uPower;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        vec3 L = normalize(uSunPosition - vWorldPosition);

        // Tight physical Rayleigh grazing limb glow (crisp NASA horizon line, never hazy bubble)
        float ndotv = abs(dot(N, V));
        float rim = pow(clamp(1.0 - ndotv, 0.0, 1.0), uPower);

        // True solar terminator modulation: sunlit crescent glows, night side fades to dark void
        float sunLit = smoothstep(-0.24, 0.52, dot(N, L));
        // Subtle Mie forward-scattering halo when looking almost toward the Sun across the limb
        float forwardScatter = pow(max(0.0, dot(-V, L)), 6.0) * 0.42;

        float alpha = rim * (sunLit * 0.90 + forwardScatter + 0.02) * uIntensity;
        vec3 col = uColor * (1.0 + forwardScatter * 0.5);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.88));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

export function createSaturnRingMaterial(
  ringMap: THREE.Texture,
  planetCenter: THREE.Vector3,
  planetRadius: number,
  sunPosition: THREE.Vector3,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRingMap: { value: ringMap },
      uPlanetCenter: { value: planetCenter.clone() },
      uPlanetRadius: { value: planetRadius },
      uSunPosition: { value: sunPosition.clone() },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform sampler2D uRingMap;
      uniform vec3 uPlanetCenter;
      uniform float uPlanetRadius;
      uniform vec3 uSunPosition;

      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        vec4 tex = texture2D(uRingMap, vUv);
        if (tex.a < 0.015) discard;

        // GPU-side fine concentric Cassini ringlets with fwidth anti-aliasing (zero shimmer at distance)
        float radialFw = fwidth(vUv.x);
        float ringletFade = 1.0 - smoothstep(0.0008, 0.0045, radialFw);
        float microRinglet =
          sin(vUv.x * 1850.0) * 0.5 +
          sin(vUv.x * 3920.0 + 1.1) * 0.35 +
          sin(vUv.x * 7400.0 + 2.4) * 0.15;
        float ringMod = 1.0 + microRinglet * 0.11 * ringletFade;

        // Analytic ray-sphere intersection: cast Saturn's crisp shadow across its own rings
        vec3 ro = vWorldPosition - uPlanetCenter;
        vec3 rd = normalize(uSunPosition - vWorldPosition);
        float b = dot(ro, rd);
        float c = dot(ro, ro) - uPlanetRadius * uPlanetRadius;
        float disc = b * b - c;

        float shadow = 1.0;
        if (b < 0.0 && disc > 0.0) {
          // Crisp penumbra edge across Saturn's atmosphere
          float penumbra = sqrt(disc) / uPlanetRadius;
          shadow = smoothstep(0.055, 0.0, penumbra) * 0.88 + 0.05;
        }

        // Ice-particle phase scattering (brighter near opposition & forward-scattering glint)
        vec3 V = normalize(cameraPosition - vWorldPosition);
        float phase = 0.78 + 0.34 * pow(max(0.0, dot(-V, rd)), 3.0) + 0.16 * max(0.0, dot(V, rd));

        vec3 color = tex.rgb * ringMod * phase * shadow;
        gl_FragColor = vec4(color, clamp(tex.a * (0.94 + ringMod * 0.06), 0.0, 0.98));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createEarthNightLightsMaterial(
  nightMap: THREE.Texture,
  sunPosition: THREE.Vector3,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNightMap: { value: nightMap },
      uSunPosition: { value: sunPosition.clone() },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform sampler2D uNightMap;
      uniform vec3 uSunPosition;

      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunPosition - vWorldPosition);
        // Visible strictly across the dark night hemisphere past the twilight terminator
        float nightMask = smoothstep(0.06, -0.20, dot(N, L));
        vec3 lights = texture2D(uNightMap, vUv).rgb * nightMask * 1.22;
        float lum = dot(lights, vec3(0.3, 0.6, 0.1));
        if (lum < 0.02) discard;
        gl_FragColor = vec4(lights, clamp(lum * 1.65, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Custom GLSL refractive ice-crystal & chromatic dispersion shader used on
 * crystalline foreground asteroid veins and Saturn's close-up ring ice boulders.
 */
export function createRefractiveIceMaterial(
  sunPosition: THREE.Vector3,
  isInstanced = false,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunPosition: { value: sunPosition.clone() },
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(0x9bc8e8) },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPos;

      void main() {
        vLocalPos = position;
        #ifdef USE_INSTANCING
          mat4 worldMat = modelMatrix * instanceMatrix;
        #else
          mat4 worldMat = modelMatrix;
        #endif
        vec4 wp = worldMat * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        vWorldNormal = normalize(mat3(worldMat) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunPosition;
      uniform float uTime;
      uniform vec3 uBaseColor;

      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPos;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        vec3 L = normalize(uSunPosition - vWorldPosition);

        float ndotl = max(dot(N, L), 0.0);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.8);

        // Spectral RGB chromatic dispersion via distinct refraction angles (etaR, etaG, etaB)
        vec3 refR = refract(-V, N, 0.74);
        vec3 refG = refract(-V, N, 0.755);
        vec3 refB = refract(-V, N, 0.77);

        float dispR = pow(max(0.0, dot(refR, -L)), 5.0);
        float dispG = pow(max(0.0, dot(refG, -L)), 5.0);
        float dispB = pow(max(0.0, dot(refB, -L)), 5.0);
        vec3 dispersion = vec3(dispR * 1.15, dispG * 1.05, dispB * 1.32);

        // Crisp crystalline facet specular glint
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 86.0);
        float microFacet = sin(vLocalPos.x * 34.0 + vLocalPos.y * 27.0 + uTime * 0.4) * 0.5 + 0.5;

        // Subsurface translucent scatter through ice volume
        float backScatter = pow(max(0.0, dot(V, -L + N * 0.45)), 3.2) * 0.55;

        vec3 body = uBaseColor * (0.14 + ndotl * 0.65 + backScatter);
        vec3 rim = vec3(0.76, 0.91, 1.0) * fresnel * (0.45 + ndotl * 0.6);
        vec3 sparkle = vec3(1.0, 0.98, 0.94) * spec * (0.85 + microFacet * 0.48);

        vec3 col = body + rim + dispersion * 0.65 + sparkle;
        // World-taste luminance cap so ice sparkles crisply without blowing out bloom
        col = min(col, vec3(2.2));

        gl_FragColor = vec4(col, 0.90);
      }
    `,
    transparent: true,
    depthWrite: true,
    defines: isInstanced ? { USE_INSTANCING: '' } : undefined,
  });
}

/**
 * High-detail animated solar photosphere granulation shader with controlled HDR ceiling
 * (prevents white-out frames during perihelion slingshot while keeping convection cells razor-sharp).
 */
export function createSunPhotosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vLocalPos;
      varying vec3 vWorldPosition;

      void main() {
        vLocalPos = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vLocalPos;
      varying vec3 vWorldPosition;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise3(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise3(p);
          p = p * 2.12 + vec3(0.13, -0.09, 0.17);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 p = vLocalPos * 8.5;
        float t = uTime * 0.16;
        float n1 = fbm(p + vec3(t, -t * 0.6, t * 0.4));
        float n2 = fbm(p * 2.4 - vec3(n1 * 1.5) + vec3(-t * 0.5, t * 0.8, 0.0));
        float gran = clamp(n1 * 0.52 + n2 * 0.48, 0.0, 1.0);

        // Solar limb darkening (true astrophysical Eddington approximation)
        vec3 V = normalize(cameraPosition - vWorldPosition);
        float mu = max(dot(normalize(vNormal), V), 0.0);
        float limb = pow(mu, 0.48);

        vec3 sunspotCol = vec3(0.68, 0.22, 0.03);
        vec3 midPlasma = vec3(1.18, 0.62, 0.18);
        vec3 hotCore = vec3(1.68, 1.50, 1.20);

        vec3 col = mix(sunspotCol, midPlasma, smoothstep(0.24, 0.60, gran));
        col = mix(col, hotCore, smoothstep(0.58, 0.90, gran));
        col *= (0.45 + 0.65 * limb);

        // Crisp chromospheric crimson-gold limb edge
        float edgeGlow = pow(1.0 - mu, 3.4);
        col += vec3(1.12, 0.44, 0.08) * edgeGlow * 0.56;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/**
 * Volumetric solar corona shell with animated plasma filaments (additive blending).
 */
export function createSolarCoronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vLocalPos;
      varying vec3 vWorldPosition;

      void main() {
        vLocalPos = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vLocalPos;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        float rim = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 2.8);

        float streamer =
          0.60 +
          0.24 * sin(vLocalPos.x * 11.0 + uTime * 0.55) * cos(vLocalPos.y * 10.0 - uTime * 0.42) +
          0.16 * sin(vLocalPos.z * 17.0 + uTime * 0.8);

        vec3 col = mix(vec3(1.0, 0.48, 0.12), vec3(1.25, 0.92, 0.62), rim);
        float alpha = rim * streamer * 0.54;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.70));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
}

/**
 * Unified single-pass mobile-optimized Cinematic Post-Processing Shader:
 * 1. Contrast-Adaptive Sharpening (AMD FidelityFX CAS 5-tap) for razor-sharp photographic clarity
 * 2. Strict peripheral-edge velocity motion blur (center & mid-frame stay 100% crisp, zero planet smear!)
 * 3. Volumetric screen-space radial solar light shafts (god-rays) from projected uSunUv
 * 4. Subtle perihelion plasma / gravitational refraction heat shimmer & refined 35mm optical grain
 */
export const CinematicPostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVisibility: { value: 0.0 },
    uMotionBlur: { value: 0.0 },
    uSteerSkew: { value: 0.0 },
    uHeatRefract: { value: 0.0 },
    uTime: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform vec2 uSunUv;
    uniform float uSunVisibility;
    uniform float uMotionBlur;
    uniform float uSteerSkew;
    uniform float uHeatRefract;
    uniform float uTime;

    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Lightweight 5-tap Contrast-Adaptive Sharpening (CAS) that snaps fine planetary & rock detail
    // into crisp photographic focus while suppressing ringing halos on high-contrast stars/Sun.
    vec3 sampleCAS(vec2 uv) {
      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      vec3 e = texture2D(tDiffuse, uv).rgb;
      vec3 b = texture2D(tDiffuse, uv + vec2(0.0, -texel.y)).rgb;
      vec3 d = texture2D(tDiffuse, uv + vec2(-texel.x, 0.0)).rgb;
      vec3 f = texture2D(tDiffuse, uv + vec2(texel.x, 0.0)).rgb;
      vec3 h = texture2D(tDiffuse, uv + vec2(0.0, texel.y)).rgb;

      // Adaptive weight attenuates sharpening on bright HDR edges to avoid star halos
      vec3 mn = min(e, min(min(b, h), min(d, f)));
      vec3 mx = max(e, max(max(b, h), max(d, f)));
      vec3 amp = clamp(min(mn, max(vec3(0.0), 1.45 - mx)) / max(mx, vec3(0.0001)), 0.0, 1.0);
      vec3 w = -sqrt(amp) * 0.145; // Negative lobe weight for crisp unsharp reconstruction

      vec3 sharp = (e + w * (b + d + f + h)) / (1.0 + 4.0 * w);
      return max(vec3(0.0), sharp);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = vec2(0.5 + uSteerSkew * 0.05, 0.50);
      vec2 fromCenter = uv - center;
      float radialDist = length(fromCenter);

      // 1. Subtle refractive heat/plasma shimmer strictly near extreme solar perihelion edges
      if (uHeatRefract > 0.02) {
        float waveX = sin(uv.y * 42.0 + uTime * 5.2) * cos(uv.x * 24.0 - uTime * 3.4);
        float waveY = cos(uv.x * 38.0 + uTime * 4.6) * sin(uv.y * 28.0 + uTime * 2.9);
        float edgeMask = smoothstep(0.36, 0.84, radialDist);
        uv += vec2(waveX, waveY) * 0.0014 * uHeatRefract * edgeMask;
      }

      // 2. Crisp CAS-sharpened primary sample (keeps all planets, rings, stars & foreground rocks sharp)
      vec3 sharpCol = sampleCAS(uv);

      // 3. Strictly peripheral-bezel velocity motion blur (zero smear in inner 84% of frame!)
      float edgeBlurMask = smoothstep(0.44, 0.94, radialDist);
      float blurAmt = uMotionBlur * edgeBlurMask;
      vec3 baseCol = sharpCol;

      if (blurAmt > 0.008) {
        vec2 blurDir = normalize(fromCenter + vec2(1e-5)) * blurAmt * 0.011;
        blurDir.x += uSteerSkew * 0.003 * edgeBlurMask;

        vec3 accum = sharpCol * 0.42;
        accum += texture2D(tDiffuse, clamp(uv - blurDir * 0.35, 0.001, 0.999)).rgb * 0.24;
        accum += texture2D(tDiffuse, clamp(uv - blurDir * 0.75, 0.001, 0.999)).rgb * 0.16;
        accum += texture2D(tDiffuse, clamp(uv - blurDir * 1.20, 0.001, 0.999)).rgb * 0.11;
        accum += texture2D(tDiffuse, clamp(uv - blurDir * 1.70, 0.001, 0.999)).rgb * 0.07;

        // Ultra-subtle optical lens dispersion only at outermost frame corners
        float ca = (0.0005 + blurAmt * 0.0008) * smoothstep(0.58, 0.98, radialDist);
        if (ca > 0.00005) {
          float rChan = texture2D(tDiffuse, clamp(uv + fromCenter * ca, 0.001, 0.999)).r;
          float bChan = texture2D(tDiffuse, clamp(uv - fromCenter * ca, 0.001, 0.999)).b;
          baseCol = vec3(mix(accum.r, rChan, 0.32), accum.g, mix(accum.b, bChan, 0.32));
        } else {
          baseCol = accum;
        }
      }

      // 4. Screen-space volumetric radial solar scattering (god-rays occluded by planets & rock rim)
      if (uSunVisibility > 0.01) {
        vec2 delta = (uv - uSunUv) * (0.68 / 14.0);
        vec2 sampleUv = uv;
        float decay = 1.0;
        vec3 rays = vec3(0.0);

        for (int i = 0; i < 14; i++) {
          sampleUv -= delta;
          vec3 s = texture2D(tDiffuse, clamp(sampleUv, 0.001, 0.999)).rgb;
          // Threshold strictly to bright HDR solar photosphere & corona so planets never smear
          float bright = smoothstep(0.88, 1.55, dot(s, vec3(0.35, 0.45, 0.20)));
          rays += s * bright * decay;
          decay *= 0.89;
        }
        rays /= 14.0;
        float sunDistFade = exp(-length(uv - uSunUv) * 1.65);
        vec3 warmScatter = vec3(1.05, 0.88, 0.68);
        baseCol += rays * warmScatter * uSunVisibility * (0.34 + sunDistFade * 0.46);
      }

      // 5. Calibrated optical lens vignette & whisper-fine 35mm sensor grain
      float vig = smoothstep(1.24, 0.38, radialDist);
      baseCol *= mix(0.82, 1.0, vig);

      float grain = (rand(uv * uResolution + fract(uTime * 13.7)) - 0.5) * 0.007;
      baseCol = max(vec3(0.0), baseCol + grain);

      gl_FragColor = vec4(baseCol, 1.0);
    }
  `,
};
