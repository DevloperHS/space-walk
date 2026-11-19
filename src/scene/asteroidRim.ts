import * as THREE from 'three';
import { createRng, evaluateCraterHeight, fbm3D, generateSphereCraters, ridged3D } from './noise';
import { createRefractiveIceMaterial, enhanceMaterialWithMicroDetail } from './shaders';
import { createAsteroidRockTextures } from './textures';

/**
 * Composite 9-part procedural foreground asteroid rim (THREE.Group) positioned
 * across the lower first-person viewport. Obeys world-taste PBR consistency:
 * - High-tessellation jagged geometry + 512x512 tiled Sobel normal maps + GPU micro-detail
 * - Matte carbonaceous basalt hull (roughness ~0.90)
 * - Angular silicate crag ridges (roughness ~0.82)
 * - Exposed specular iron-nickel ore veins (metalness 0.92, roughness 0.24)
 * - Crystalline water-ice pockets using custom chromatic Fresnel refraction
 * - Loose surface regolith boulders & perihelion heat-reactive fissures
 * - Sublimation vapor wisps streaming backward off sunlit ridges
 */

export interface AsteroidRimRig {
  group: THREE.Group;
  update: (
    dt: number,
    time: number,
    sunWorldPos: THREE.Vector3,
    solarHeat: number,
    velocityNorm: number,
  ) => void;
  dispose: () => void;
}

function buildDisplacedRockGeometry(
  radius: number,
  detail: number,
  seed: number,
  scaleVec: [number, number, number],
  jaggedness = 0.34,
  craterCount = 10,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const craters = generateSphereCraters(craterCount, seed, 0.14, 0.38);
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    const ox = dir.x * 2.2 + seed * 0.37;
    const oy = dir.y * 2.2 - seed * 0.19;
    const oz = dir.z * 2.2 + seed * 0.53;

    const ridge = ridged3D(ox, oy, oz, 4);
    const fineRidge = ridged3D(ox * 2.6 + 4.1, oy * 2.6, oz * 2.6 - 2.3, 3);
    const low = fbm3D(ox * 0.72, oy * 0.72, oz * 0.72, 3);
    const crater = evaluateCraterHeight(dir.x, dir.y, dir.z, craters);

    // Sharp terraced fractures + crisp fine angular cleavage + depressed craters
    const disp =
      1.0 +
      (ridge - 0.5) * jaggedness * 1.35 +
      (fineRidge - 0.5) * jaggedness * 0.42 +
      (low - 0.5) * jaggedness * 0.95 +
      crater * 0.2;
    pos.setXYZ(
      i,
      dir.x * radius * disp * scaleVec[0],
      dir.y * radius * disp * scaleVec[1],
      dir.z * radius * disp * scaleVec[2],
    );
  }

  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createAsteroidRim(
  sunPosition: THREE.Vector3,
  maxAniso: number,
  isSoftwareGl: boolean,
): AsteroidRimRig {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  // High-resolution 512x512 tiled PBR rock textures with Sobel tangent-space normal maps
  const basaltTex = createAsteroidRockTextures(maxAniso, 101, [94, 90, 86], 3);
  const silicateTex = createAsteroidRockTextures(maxAniso, 209, [136, 124, 110], 3);
  textures.push(
    basaltTex.map,
    basaltTex.normalMap,
    basaltTex.roughnessMap,
    silicateTex.map,
    silicateTex.normalMap,
    silicateTex.roughnessMap,
  );

  const basaltMat = new THREE.MeshStandardMaterial({
    map: basaltTex.map,
    normalMap: basaltTex.normalMap,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughnessMap: basaltTex.roughnessMap,
    roughness: 0.92,
    metalness: 0.06,
  });
  enhanceMaterialWithMicroDetail(basaltMat, {
    scale: 18.0,
    albedoContrast: 0.16,
    normalStrength: 0.24,
  });

  const silicateMat = new THREE.MeshStandardMaterial({
    map: silicateTex.map,
    normalMap: silicateTex.normalMap,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: silicateTex.roughnessMap,
    roughness: 0.82,
    metalness: 0.12,
  });
  enhanceMaterialWithMicroDetail(silicateMat, {
    scale: 20.0,
    albedoContrast: 0.15,
    normalStrength: 0.22,
  });

  // High-contrast exposed nickel-iron meteoritic ore veins (roughness delta > 0.65 vs basalt!)
  const ironNickelMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x8a9099),
    roughness: 0.24,
    metalness: 0.92,
    clearcoat: 0.28,
    normalMap: basaltTex.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
  });
  enhanceMaterialWithMicroDetail(ironNickelMat, {
    scale: 28.0,
    albedoContrast: 0.08,
    normalStrength: 0.14,
  });

  // Crystalline water-ice pockets using our custom GLSL Fresnel chromatic refraction shader
  const iceShaderMat = createRefractiveIceMaterial(sunPosition, false);

  // Subtle thermal fissure glow awakened strictly near Solar Perihelion
  const fissureMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff5a18),
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  materials.push(basaltMat, silicateMat, ironNickelMat, iceShaderMat, fissureMat);

  // Part 1: Primary sprawling jagged asteroid prow hull (high-tessellation lower foreground shelf)
  const prowGeo = buildDisplacedRockGeometry(1.55, 4, 17, [2.15, 0.56, 1.35], 0.42, 18);
  geometries.push(prowGeo);
  const prowMesh = new THREE.Mesh(prowGeo, basaltMat);
  prowMesh.position.set(0.0, -1.68, -2.55);
  prowMesh.rotation.set(0.18, 0.06, -0.04);
  prowMesh.castShadow = !isSoftwareGl;
  prowMesh.receiveShadow = !isSoftwareGl;
  group.add(prowMesh);

  // Part 2: Left jagged horizon crag (catches dramatic sunlit rim light)
  const leftCragGeo = buildDisplacedRockGeometry(0.76, 4, 33, [1.35, 0.78, 1.15], 0.48, 10);
  geometries.push(leftCragGeo);
  const leftCrag = new THREE.Mesh(leftCragGeo, basaltMat);
  leftCrag.position.set(-1.68, -1.24, -2.62);
  leftCrag.rotation.set(0.28, 0.46, -0.24);
  leftCrag.castShadow = !isSoftwareGl;
  leftCrag.receiveShadow = !isSoftwareGl;
  group.add(leftCrag);

  // Part 3: Right fractured ridge buttress (asymmetric framing balances left crag)
  const rightCragGeo = buildDisplacedRockGeometry(0.84, 4, 59, [1.42, 0.72, 1.18], 0.46, 11);
  geometries.push(rightCragGeo);
  const rightCrag = new THREE.Mesh(rightCragGeo, silicateMat);
  rightCrag.position.set(1.74, -1.30, -2.72);
  rightCrag.rotation.set(0.16, -0.52, 0.22);
  rightCrag.castShadow = !isSoftwareGl;
  rightCrag.receiveShadow = !isSoftwareGl;
  group.add(rightCrag);

  // Part 4: Mid-right low saddle spire (creates natural uneven asteroid skyline)
  const midSpireGeo = buildDisplacedRockGeometry(0.46, 3, 87, [1.18, 0.68, 0.92], 0.52, 7);
  geometries.push(midSpireGeo);
  const midSpire = new THREE.Mesh(midSpireGeo, silicateMat);
  midSpire.position.set(0.68, -1.26, -2.28);
  midSpire.rotation.set(0.32, -0.25, 0.14);
  midSpire.castShadow = !isSoftwareGl;
  midSpire.receiveShadow = !isSoftwareGl;
  group.add(midSpire);

  // Part 5 & 6: Exposed iron-nickel metallic meteoritic veins embedded in fractured ridges
  const vein1Geo = buildDisplacedRockGeometry(0.24, 3, 114, [1.75, 0.45, 0.82], 0.44, 4);
  const vein2Geo = buildDisplacedRockGeometry(0.21, 3, 149, [1.45, 0.52, 0.76], 0.48, 3);
  geometries.push(vein1Geo, vein2Geo);

  const vein1 = new THREE.Mesh(vein1Geo, ironNickelMat);
  vein1.position.set(-0.88, -1.16, -2.24);
  vein1.rotation.set(0.14, 0.35, -0.22);
  group.add(vein1);

  const vein2 = new THREE.Mesh(vein2Geo, ironNickelMat);
  vein2.position.set(1.12, -1.18, -2.42);
  vein2.rotation.set(-0.18, -0.44, 0.19);
  group.add(vein2);

  // Part 7 & 8: Crystalline water-ice refraction veins tucked in shadowed rock pockets
  const ice1Geo = buildDisplacedRockGeometry(0.19, 3, 203, [1.28, 0.62, 0.78], 0.54, 2);
  const ice2Geo = buildDisplacedRockGeometry(0.16, 3, 241, [1.15, 0.74, 0.85], 0.58, 2);
  geometries.push(ice1Geo, ice2Geo);

  const ice1 = new THREE.Mesh(ice1Geo, iceShaderMat);
  ice1.position.set(-0.26, -1.21, -2.14);
  ice1.rotation.set(0.22, 0.4, 0.15);
  group.add(ice1);

  const ice2 = new THREE.Mesh(ice2Geo, iceShaderMat);
  ice2.position.set(0.84, -1.08, -2.16);
  ice2.rotation.set(-0.1, -0.6, 0.32);
  group.add(ice2);

  // Part 9: Loose surface regolith cobbles + thermal perihelion fissure veins
  const rng = createRng(7712);
  const cobbleGeo = buildDisplacedRockGeometry(0.11, 2, 311, [1.25, 0.78, 1.0], 0.42, 3);
  geometries.push(cobbleGeo);
  const cobbleCoords: [number, number, number, number][] = [
    [-1.22, -1.08, -2.08, 0.95],
    [-0.58, -1.22, -1.96, 0.72],
    [0.14, -1.26, -1.92, 0.68],
    [0.44, -1.14, -2.02, 0.84],
    [1.36, -1.08, -2.26, 0.92],
  ];
  for (let i = 0; i < cobbleCoords.length; i++) {
    const [cx, cy, cz, cs] = cobbleCoords[i];
    const m = new THREE.Mesh(cobbleGeo, i % 2 === 0 ? basaltMat : silicateMat);
    m.position.set(cx, cy, cz);
    m.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    m.scale.setScalar(cs);
    group.add(m);
  }

  // Subtle thermal fissure glows embedded in prow crevices (only awaken near the Sun)
  const fissureCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.05, -1.14, -2.12),
    new THREE.Vector3(-0.42, -1.20, -2.04),
    new THREE.Vector3(0.22, -1.22, -2.06),
    new THREE.Vector3(0.76, -1.13, -2.14),
  ]);
  const fissureGeo = new THREE.TubeGeometry(fissureCurve, 28, 0.016, 6, false);
  geometries.push(fissureGeo);
  const fissureMesh = new THREE.Mesh(fissureGeo, fissureMat);
  group.add(fissureMesh);

  // Sublimation ice/dust vapor particles venting backward off the sunlit asteroid crags
  const vaporCount = 90;
  const vaporGeo = new THREE.BufferGeometry();
  const vaporPositions = new Float32Array(vaporCount * 3);
  const vaporSeeds = new Float32Array(vaporCount * 4); // originX, originY, speed, phase
  for (let i = 0; i < vaporCount; i++) {
    const ox = (rng() - 0.5) * 3.4;
    const oy = -1.34 + rng() * 0.36;
    const phase = rng();
    const speed = 0.65 + rng() * 0.95;
    vaporSeeds[i * 4] = ox;
    vaporSeeds[i * 4 + 1] = oy;
    vaporSeeds[i * 4 + 2] = speed;
    vaporSeeds[i * 4 + 3] = phase;

    vaporPositions[i * 3] = ox;
    vaporPositions[i * 3 + 1] = oy;
    vaporPositions[i * 3 + 2] = -2.2 + phase * 3.2;
  }
  vaporGeo.setAttribute('position', new THREE.BufferAttribute(vaporPositions, 3));
  geometries.push(vaporGeo);

  const vaporMat = new THREE.PointsMaterial({
    color: new THREE.Color(0xc8dcf0),
    size: 0.034,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  materials.push(vaporMat);

  const vaporPoints = new THREE.Points(vaporGeo, vaporMat);
  vaporPoints.frustumCulled = false;
  group.add(vaporPoints);

  function update(
    dt: number,
    time: number,
    sunWorldPos: THREE.Vector3,
    solarHeat: number,
    velocityNorm: number,
  ) {
    iceShaderMat.uniforms.uSunPosition.value.copy(sunWorldPos);
    iceShaderMat.uniforms.uTime.value = time;

    // Awaken subtle glowing basalt fissures strictly near Solar Perihelion
    fissureMat.opacity = Math.max(0, solarHeat * solarHeat * 0.58);

    // Animate sublimation ice/dust particles drifting past camera rim
    const posAttr = vaporGeo.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const driftSpeed = 1.6 + velocityNorm * 3.2 + solarHeat * 2.4;

    vaporMat.opacity = 0.12 + solarHeat * 0.26 + velocityNorm * 0.09;
    vaporMat.color.setRGB(
      0.78 + solarHeat * 0.22,
      0.86 - solarHeat * 0.14,
      0.96 - solarHeat * 0.42,
    );

    for (let i = 0; i < vaporCount; i++) {
      let phase = vaporSeeds[i * 4 + 3] + dt * driftSpeed * vaporSeeds[i * 4 + 2] * 0.35;
      if (phase > 1) phase -= 1;
      vaporSeeds[i * 4 + 3] = phase;

      const ox = vaporSeeds[i * 4];
      const oy = vaporSeeds[i * 4 + 1];
      arr[i * 3] = ox + Math.sin(time * 1.4 + i) * 0.08 * phase;
      arr[i * 3 + 1] = oy + phase * 0.42;
      arr[i * 3 + 2] = -2.35 + phase * 3.1;
    }
    posAttr.needsUpdate = true;
  }

  function dispose() {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }

  return { group, update, dispose };
}
