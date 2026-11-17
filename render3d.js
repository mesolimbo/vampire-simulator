// The 3D renderer (Design/SPEC-3D.md). It builds the town once per map from the simulation's generated layout, then
// each frame copies positions and states out of the simulation. It never changes the simulation.
//
// World: 1 unit is 1 metre, 1 simulation pixel is 3/32 m, and the map's centre is the origin. +X is east and +Z is
// south (the simulation's +y), so homes face +Z. Height is visual only.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const S = 3 / 32;   // metres per simulation pixel
const RH = RIVER_HALF * S, RDH = ROAD_HALF * S, BRH = BRIDGE_HALF * S, GROUND = 170;
const MODELS = 'assets/models/', TEX = 'assets/textures/';
const toW = (px, py) => ({ x: (px - WORLD_W / 2) * S, z: (py - WORLD_H / 2) * S });
const sstep = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
const clamp01 = (k) => Math.min(1, Math.max(0, k));

// ---------- renderer, camera, lights ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
const MAX_SCALE = Math.min(devicePixelRatio, 1.5);
let renderScale = Math.min(MAX_SCALE, 1);   // start modest; adaptResolution raises it when frames have headroom
renderer.setPixelRatio(renderScale);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.id = 'view3d';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// The camera follows the simulation's camera subject. Dragging with the left button turns it round the subject and
// tilts it, the wheel zooms, and a double click puts it back. The simulation reads the turn (viewYaw), so the WASD
// keys keep matching the screen.
const CAM = { yaw: 0, pitch: 29 * Math.PI / 180, dist: 48 };
const CAM_HOME = { ...CAM }, PITCH_MIN = 12 * Math.PI / 180, PITCH_MAX = 80 * Math.PI / 180, DIST_MIN = 22, DIST_MAX = 100;
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.5, 900);
const camTarget = new THREE.Vector3();
function placeCamera() {
  const flat = CAM.dist * Math.cos(CAM.pitch);
  camera.position.set(camTarget.x + flat * Math.sin(CAM.yaw), camTarget.y + CAM.dist * Math.sin(CAM.pitch), camTarget.z + flat * Math.cos(CAM.yaw));
}
const aimAt = () => { placeCamera(); camera.lookAt(camTarget); };
// The subject sits a little below the middle of the screen, leaving more room above for the sky.
const FRAME_SHIFT = 0.1;
const frameCamera = () => camera.setViewOffset(innerWidth, innerHeight, 0, -FRAME_SHIFT * innerHeight, innerWidth, innerHeight);
frameCamera();
{
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    CAM.yaw -= (e.clientX - drag.x) * 0.006;
    CAM.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, CAM.pitch + (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
  });
  const release = () => { drag = null; el.style.cursor = ''; };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('wheel', (e) => { e.preventDefault(); CAM.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, CAM.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  el.addEventListener('dblclick', () => Object.assign(CAM, CAM_HOME));
}

const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a34, 1.0);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 400 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(hemi, sun, sun.target);
const sunDir = new THREE.Vector3(-70, 120, 60);   // from the subject toward the light; set by the time of day
function aimShadows() {
  sun.target.position.copy(camTarget);
  sun.position.copy(camTarget).add(sunDir);
}

// ---------- night sky ----------
// A transparent half dome of twinkling stars around the point the camera looks at, in its own scene, drawn after the
// tilt-shift blur and depth-tested against the town (see the preview, scene3d.html).
const skyScene = new THREE.Scene();
const starUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uPixel: { value: 1 } };
const stars = (() => {
  const N = 2400, R = 600, pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), tint = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const LOW = Math.sin(-25 * Math.PI / 180), BAND = Math.sin(20 * Math.PI / 180);
    const y = i < N * 0.8 ? LOW + Math.random() * (BAND - LOW) : BAND + Math.random() * (1 - BAND);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * R, y * R, Math.sin(a) * r * R], i * 3);
    const bright = Math.pow(Math.random(), 3);
    seed.set([1.2 + 1.6 * bright, 1.3 + 3.2 * bright, 0.6 + Math.random() * 2.6, Math.random() * Math.PI * 2], i * 4);
    const warm = Math.random();
    tint.set(warm < 0.15 ? [1, 0.85, 0.7] : warm > 0.8 ? [0.75, 0.85, 1] : [1, 1, 1], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 seed; attribute vec3 tint;
      uniform float uTime, uPixel;
      varying vec3 vColor;
      void main() {
        float f = uTime * (3.0 + seed.z * 2.0) + seed.w;
        float tw = 1.0 + 0.05 * sin(f) + 0.03 * sin(f * 2.71 + seed.w * 3.0);
        vColor = tint * seed.y * tw;
        gl_PointSize = seed.x * uPixel;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uNight;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d); a *= a;
        gl_FragColor = vec4(vColor * a * uNight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  skyScene.add(p);
  return p;
})();

// ---------- shared helpers ----------

const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const clips = {};   // animation clips by model name
const loadGLB = (name) => new Promise((ok, fail) => gltfLoader.load(MODELS + name + '.glb', (g) => { clips[name] = g.animations; ok(g.scene); }, undefined, fail));
// Textures that replace a glTF material's map must not be flipped.
const mapTex = (path, srgb = true) => { const t = texLoader.load(TEX + path); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
const tileTex = (path, repeat, srgb = true) => { const t = texLoader.load(TEX + path); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
function shadows(obj, cast = true, receive = true) { obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } }); return obj; }
function ownMaterials(obj) { obj.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); }); return obj; }
function eachMaterial(obj, fn) { obj.traverse((o) => { if (o.isMesh) fn(o.material); }); }
// Wrap a model so that it stands on y = 0, is centred in x and z, and has the given size in metres.
function fit(model, size) {
  const box = new THREE.Box3().setFromObject(model), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const g = new THREE.Group();
  model.position.set(-c.x, -box.min.y, -c.z);
  g.add(model);
  if (size.width && size.length) { const sx = size.width / s.x, sz = size.length / s.z; g.scale.set(sx, (sx + sz) / 2, sz); }
  else { const k = size.height ? size.height / s.y : size.width / s.x; g.scale.setScalar(k); }
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}
const hash2 = (ix, iz) => { let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const vnoise = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz); return (hash2(ix, iz) * (1 - u) + hash2(ix + 1, iz) * u) * (1 - w) + (hash2(ix, iz + 1) * (1 - u) + hash2(ix + 1, iz + 1) * u) * w; };

// Per-map values the shaders read: the river line (a point on it, then the cosine and sine of its angle, see riverFrame)
// and the two road lines (a point, then the direction).
const riverU = { value: new THREE.Vector4(0, 0, 1, 0) };
const roadLines = { value: [new THREE.Vector4(), new THREE.Vector4()] };
const waterUniforms = { uTime: { value: 0 }, uHalf: { value: RH }, uSky: { value: new THREE.Color() }, uRiver: riverU,
  uDeep: { value: new THREE.Color(0.012, 0.05, 0.07) }, uShallow: { value: new THREE.Color(0.05, 0.12, 0.1) } };
// GLSL: the river's local frame. x runs across the river (0 on its centre line), y along it.
const RIVER_GLSL = `
uniform vec4 uRiver;
vec2 riverLocal(vec2 p) { vec2 d = p - uRiver.xy; return vec2(d.x * uRiver.z - d.y * uRiver.w, d.x * uRiver.w + d.y * uRiver.z); }`;

// ---------- assets, loaded once ----------

const A = {};   // models and textures shared by every map
async function loadAssets() {
  const names = ['house', 'house_door', 'crypt', 'crypt_door', 'church', 'tombstone_a', 'tombstone_b', 'tombstone_c', 'tree_a', 'tree_b', 'bush', 'bridge_span', 'bridge_abutment', 'bridge_pier', 'road_straight', 'river_straight', 'characters/player', 'characters/convert', 'characters/hunter', 'characters/converted_hunter'];
  await Promise.all(names.map(async (n) => { A[n] = await loadGLB(n); }));
  // The generated materials are marked fully metallic, which renders near black without reflections. Nothing here is metal.
  Object.values(A).forEach((m) => eachMaterial(m, (mat) => { mat.metalness = 0; mat.metalnessMap = null; if (mat.name === 'riverbed') mat.normalScale.set(2.2, 2.2); if (!mat.transparent) mat.roughness = Math.max(mat.roughness, 0.85); }));

  // Water: drifting ripples bend its normals, it picks up the sky, and it is clearer near the banks than in the middle.
  eachMaterial(A.river_straight, (m) => {
    if (m.name !== 'water') return;
    m.roughness = 0.22;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, waterUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWaterPos;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWaterPos;
uniform float uTime, uHalf;
uniform vec3 uSky, uDeep, uShallow;${RIVER_GLSL}
vec2 wGrad(vec2 i) {
  i = mod(i, 256.0);
  vec3 p3 = fract(vec3(i.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  float a = fract((p3.x + p3.y) * p3.z) * 6.2832;
  return vec2(cos(a), sin(a));
}
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(wGrad(i), f), b = dot(wGrad(i + vec2(1, 0)), f - vec2(1, 0));
  float c = dot(wGrad(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(wGrad(i + vec2(1, 1)), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Ripple height in the river's own frame, so the ripples drift downstream whatever the river's angle.
float wHeight(vec2 p) {
  float t = uTime;
  p += 0.6 * vec2(wNoise(p * 0.15 + vec2(0.0, t * 0.05)), wNoise(p * 0.15 + vec2(5.2, t * 0.05)));
  const mat2 R1 = mat2(0.87, 0.5, -0.5, 0.87), R2 = mat2(0.34, 0.94, -0.94, 0.34), R3 = mat2(-0.42, 0.91, -0.91, -0.42);
  return 0.55 * wNoise(R1 * (p * vec2(0.5, 0.35) + vec2(0.0, t * 0.22)))
       + 0.30 * wNoise(R2 * (p * vec2(1.2, 0.9) + vec2(t * 0.05, t * 0.45)))
       + 0.15 * wNoise(R3 * (p * vec2(2.7, 2.3) + vec2(-t * 0.08, t * 0.8)));
}`).replace('#include <color_fragment>', `#include <color_fragment>
vec2 wLocal = riverLocal(vWaterPos.xz);
float wDeep = 1.0 - smoothstep(0.3, 1.0, clamp(abs(wLocal.x) / uHalf, 0.0, 1.0));
diffuseColor.rgb = mix(uShallow, uDeep, wDeep);
diffuseColor.a = mix(0.25, 0.75, wDeep);`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec2 p = riverLocal(vWaterPos.xz); float e = 0.05;
  float hx = (wHeight(p + vec2(e, 0.0)) - wHeight(p - vec2(e, 0.0))) / (2.0 * e);
  float hz = (wHeight(p + vec2(0.0, e)) - wHeight(p - vec2(0.0, e))) / (2.0 * e);
  // back from the river frame to world x and z
  vec2 g = vec2(hx * uRiver.z + hz * uRiver.w, -hx * uRiver.w + hz * uRiver.z);
  normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x * 0.45, 1.0, -g.y * 0.45)), 0.0)).xyz); }`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uSky * (0.02 + 0.3 * fres); }`);
    };
  });

  // Road: texture and normals sampled in world space with the repeat hidden; the second road steps aside where the two
  // overlap; edges fade into the shoulders (see scene3d.html).
  eachMaterial(A.road_straight, (m) => {
    m.transparent = true; m.depthWrite = false; m.side = THREE.FrontSide;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRoads = roadLines;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vRoadPos;
varying vec3 vRoadN;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vRoadPos = (modelMatrix * vec4(position, 1.0)).xyz;
vRoadN = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRoadPos;
varying vec3 vRoadN;
uniform vec4 uRoads[2];
float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rHash(i), rHash(i + vec2(1, 0)), f.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), f.x), f.y); }
vec2 rUv, rDx, rDy; float rI, rF;
void rCells() {
  rUv = vRoadPos.xz / 3.2; rDx = dFdx(rUv); rDy = dFdy(rUv);
  float l = rNoise(vRoadPos.xz * 0.42 + 13.0) * 8.0; rI = floor(l); rF = smoothstep(0.2, 0.8, fract(l));
}
float rLineDist(vec4 r) { return abs((vRoadPos.x - r.x) * r.w - (vRoadPos.z - r.y) * r.z); }`).replace('#include <map_fragment>', `
rCells();
#ifdef USE_MAP
{ vec3 a = textureGrad(map, rUv + sin(vec2(3.0, 7.0) * rI), rDx, rDy).rgb;
  vec3 b = textureGrad(map, rUv + sin(vec2(3.0, 7.0) * (rI + 1.0)), rDx, rDy).rgb;
  vec3 c = mix(a, b, rF);
  vec2 uv2 = vec2(-rUv.y, rUv.x) * 0.77;
  float l2 = rNoise(vRoadPos.xz * 0.33 + 41.0) * 8.0, i2 = floor(l2), f2 = smoothstep(0.2, 0.8, fract(l2));
  vec3 d = mix(textureGrad(map, uv2 + sin(vec2(5.0, 2.0) * i2), rDy * 0.77, rDx * 0.77).rgb, textureGrad(map, uv2 + sin(vec2(5.0, 2.0) * (i2 + 1.0)), rDy * 0.77, rDx * 0.77).rgb, f2);
  c = mix(c, d, 0.3 + 0.4 * rNoise(vRoadPos.xz * 0.19 + 7.0));
  c *= 0.84 + 0.3 * rNoise(vRoadPos.xz * 0.07) + 0.1 * rNoise(vRoadPos.xz * 0.6 + 3.0);
  diffuseColor.rgb *= c; }
#endif
#if defined(ROAD_INDEX) && ROAD_INDEX == 1
diffuseColor.a *= smoothstep(2.3, 3.2, rLineDist(uRoads[0]));
#endif
float rD = min(rLineDist(uRoads[0]), rLineDist(uRoads[1]));
diffuseColor.a *= 1.0 - smoothstep(2.0 + 0.7 * rNoise(vRoadPos.xz * 0.8) + 0.4 * rNoise(vRoadPos.xz * 3.1), 3.25, rD);`).replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP
{ vec3 na = textureGrad(normalMap, rUv + sin(vec2(3.0, 7.0) * rI), rDx, rDy).xyz;
  vec3 nb = textureGrad(normalMap, rUv + sin(vec2(3.0, 7.0) * (rI + 1.0)), rDx, rDy).xyz;
  vec3 tn = mix(na, nb, rF) * 2.0 - 1.0; tn.xy *= 0.35;
  vec3 nW = normalize(vRoadN), tW = normalize(vec3(1.0, 0.0, 0.0) - nW * nW.x), bW = cross(nW, tW);
  normal = normalize((viewMatrix * vec4(normalize(tW * tn.x + bW * tn.y + nW * tn.z), 0.0)).xyz); }
#endif`);
    };
  });
  const roadMat = (() => { let m; eachMaterial(A.road_straight, (x) => { m = x; }); return m; })();
  A.roadMats = [0, 1].map((i) => { const m = roadMat.clone(); m.onBeforeCompile = roadMat.onBeforeCompile; m.defines = { ...(m.defines || {}), ROAD_INDEX: i }; return m; });

  // Ground textures.
  A.grassMap = tileTex('ground/grass_basecolor.jpg', 1); A.grassNormal = tileTex('ground/grass_normal.jpg', 1, false);
  A.yardMap = tileTex('ground/graveyard_basecolor.jpg', 1); A.roadMap = tileTex('ground/road_basecolor.jpg', 1);

  // Homes: one model; its colour is a blend of a clean and a decayed texture by a decay value, and its windows glow
  // through a mask. Texture sets with lit windows painted in go with each light.
  A.houseTex = {
    clean: mapTex('house/house_clean.png'), yellow: mapTex('house/house_clean_yellow.png'), red: mapTex('house/house_clean_red.png'),
    decayed: mapTex('house/house_decayed.png'), decayedOrange: mapTex('house/house_decayed_orange.png'), decayedRed: mapTex('house/house_decayed_red.png'),
  };
  A.houseMask = mapTex('house/house_window_mask.png', false);
  A.churchMask = mapTex('church/church_window_mask.png', false);
  A.cryptTex = { orange: mapTex('crypt/crypt_orange.png'), red: mapTex('crypt/crypt_red.png') };
  eachMaterial(A.crypt, (m) => { A.cryptBase = m.map; });

  // Tombstones, trees and the bridge kit, sized once.
  A.stones = [fit(A.tombstone_a, { height: 1.6 }), fit(A.tombstone_b, { height: 1.9 }), fit(A.tombstone_c, { height: 1.5 })];
  A.plants = [[fit(A.tree_a, { height: 6.5 }), 3.2], [fit(A.tree_b, { height: 8 }), 2.6], [fit(A.bush, { height: 1.4 }), 1.2]];
  A.span = fit(A.bridge_span, { width: BRH * 2, length: 3 });
  A.abut = fit(A.bridge_abutment, { width: BRH * 2, length: 3 });
  A.pier = fit(A.bridge_pier, { width: 7 });
  A.abut.updateMatrixWorld(true);
  const lo = [0, 0], cnt = [0, 0], v = new THREE.Vector3();
  A.abut.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 7) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const k = v.z > 0 ? 1 : 0; lo[k] += v.y; cnt[k]++; } });
  A.abutLowIsPlusZ = lo[1] / cnt[1] < lo[0] / cnt[0];
}

// The ground material: grass with the repeat hidden, damp earth at the river, trampled earth on the road shoulders,
// and (turf 1) the graveyard's mulch bed.
function groundMaterial(turf = 0) {
  const mat = new THREE.MeshStandardMaterial({ map: A.grassMap, normalMap: A.grassNormal, roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTurfAll = { value: turf };
    sh.uniforms.uYardMap = { value: A.yardMap }; sh.uniforms.uRoads = roadLines; sh.uniforms.uRoadMap = { value: A.roadMap }; sh.uniforms.uRiver = riverU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWPos;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform sampler2D uYardMap;
uniform float uTurfAll;
uniform vec4 uRoads[2];
uniform sampler2D uRoadMap;${RIVER_GLSL}
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }`).replace('#include <map_fragment>', `
vec2 gDx = dFdx(vMapUv), gDy = dFdy(vMapUv);
float gL = gNoise(vWPos.xz * 0.45) * 8.0, gI = floor(gL), gF = fract(gL);
vec3 gA = textureGrad(map, vMapUv + sin(vec2(3.0, 7.0) * gI), gDx, gDy).rgb;
vec3 gB = textureGrad(map, vMapUv + sin(vec2(3.0, 7.0) * (gI + 1.0)), gDx, gDy).rgb;
vec3 gC = mix(gA, gB, smoothstep(0.2, 0.8, gF - 0.1 * ((gA.r + gA.g + gA.b) - (gB.r + gB.g + gB.b))));
gC *= 0.74 + 0.36 * gNoise(vWPos.xz * 0.028) + 0.16 * gNoise(vWPos.xz * 0.11 + 5.0);
gC = mix(gC, gC * vec3(1.16, 1.04, 0.72), 0.55 * smoothstep(0.45, 0.9, gNoise(vWPos.xz * 0.055 + 3.0)));
float gBank = abs(riverLocal(vWPos.xz).x);
float gMud = 1.0 - smoothstep(${(RH + 0.15).toFixed(2)}, ${(RH + 1.5).toFixed(2)} + 1.2 * gNoise(vWPos.xz * 0.7), gBank);
gC = mix(gC, vec3(0.19, 0.14, 0.085) * (0.75 + 0.5 * gNoise(vWPos.xz * 3.0)), 0.9 * gMud);
float gRd = min(abs((vWPos.x - uRoads[0].x) * uRoads[0].w - (vWPos.z - uRoads[0].y) * uRoads[0].z), abs((vWPos.x - uRoads[1].x) * uRoads[1].w - (vWPos.z - uRoads[1].y) * uRoads[1].z));
float gSh = (1.0 - smoothstep(2.6, 4.9 + 1.5 * gNoise(vWPos.xz * 0.8) + 0.7 * gNoise(vWPos.xz * 3.1), gRd)) * smoothstep(8.5, 12.0, gBank);
vec2 gWx = dFdx(vWPos.xz), gWy = dFdy(vWPos.xz);
if (gSh > 0.002) gC = mix(gC, textureGrad(uRoadMap, vWPos.xz / 3.0, gWx / 3.0, gWy / 3.0).rgb * (0.62 + 0.3 * gNoise(vWPos.xz * 1.7)), gSh);
float gYm = uTurfAll;
if (gYm > 0.002) {
vec2 yUv = vWPos.xz / 3.2, yDx = gWx / 3.2, yDy = gWy / 3.2;
float yL = gNoise(vWPos.xz * 0.38 + 21.0) * 8.0, yI = floor(yL), yF = fract(yL);
vec3 yA = textureGrad(uYardMap, yUv + sin(vec2(3.0, 7.0) * yI), yDx, yDy).rgb;
vec3 yB = textureGrad(uYardMap, yUv + sin(vec2(3.0, 7.0) * (yI + 1.0)), yDx, yDy).rgb;
vec3 gTurf = mix(yA, yB, smoothstep(0.2, 0.8, yF));
float yL2 = gNoise(vWPos.xz * 0.31 + 47.0) * 8.0, yI2 = floor(yL2), yF2 = fract(yL2);
vec2 yUv2 = vec2(-yUv.y, yUv.x) * 0.73;
vec3 yC = mix(textureGrad(uYardMap, yUv2 + sin(vec2(5.0, 2.0) * yI2), yDy * 0.73, yDx * 0.73).rgb, textureGrad(uYardMap, yUv2 + sin(vec2(5.0, 2.0) * (yI2 + 1.0)), yDy * 0.73, yDx * 0.73).rgb, smoothstep(0.2, 0.8, yF2));
gTurf = mix(gTurf, yC, 0.3 + 0.4 * gNoise(vWPos.xz * 0.21 + 3.0));
gTurf *= 0.86 + 0.22 * gNoise(vWPos.xz * 0.6 + 9.0);
gTurf = dot(gTurf, vec3(0.3, 0.59, 0.11)) * vec3(1.6, 0.85, 0.42) * 0.78;
vec3 yN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
gTurf *= 1.0 - 0.45 * smoothstep(0.12, 0.45, 1.0 - abs(yN.y));
gC = mix(gC, gTurf * (0.85 + 0.3 * gNoise(vWPos.xz * 0.09)), gYm);
}
diffuseColor.rgb *= gC;`);
  };
  return mat;
}

// ---------- the town, built once per map ----------

let W = null;   // the current map's scene and lookups
const LIGHT3D = { [LIGHT.player]: 0xff2a1e, [LIGHT.vampire]: 0xff7a1a, [LIGHT.home]: 0xffc24a, [LIGHT.worship]: 0x9fc4e8 };
const HOUSE_SCALE = 7, CRYPT_SCALE = 7, CHAR_SCALE = 1.3, MULCH = 0.25, HILL = 2, YARD_RISE = 1.3, MOUND = 1.25, CROWN = 0.45;

function buildWorld() {
  if (W) { scene.remove(W.root); W.root.traverse((o) => { if (o.isMesh && o.userData.own) { o.geometry.dispose(); } }); }
  const root = new THREE.Group();
  const own = (mesh) => { mesh.userData.own = true; return mesh; };   // geometry made here, freed with the map
  scene.add(root);

  // River frame: local x runs across the river (0 on its centre line), local z along it. Its origin is the point on the
  // river nearest the map's centre.
  const rc = toW(river.x, river.y), rdx = river.dx, rdz = river.dy, along0 = -(rc.x * rdx + rc.z * rdz);
  const cx = rc.x + rdx * along0, cz = rc.z + rdz * along0, theta = Math.atan2(rdx, rdz), cos = Math.cos(theta), sin = Math.sin(theta);
  const toRiver = (x, z) => ({ lx: (x - cx) * cos - (z - cz) * sin, lz: (x - cx) * sin + (z - cz) * cos });
  const fromRiver = (lx, lz) => ({ x: cx + lx * cos + lz * sin, z: cz - lx * sin + lz * cos });
  const riverDist = (x, z) => Math.abs((x - cx) * cos - (z - cz) * sin);
  riverU.value.set(cx, cz, cos, sin);
  const riverFrame = new THREE.Group(); riverFrame.position.set(cx, 0, cz); riverFrame.rotation.y = theta; root.add(riverFrame);

  // Roads: each passes through its bridge's centre, which is on the river.
  const rl = roads.map((r, i) => { const b = toW(bridges[i].x, bridges[i].y); return { x: b.x, z: b.z, dx: r.dx, dz: r.dy, half: bridges[i].half * S }; });
  rl.forEach((r, i) => roadLines.value[i].set(r.x, r.z, r.dx, r.dz));
  const lineDist = (r, x, z) => Math.abs((x - r.x) * r.dz - (z - r.z) * r.dx);
  const roadDist = (x, z) => Math.min(...rl.map((r) => lineDist(r, x, z)));

  // Buildings and the graveyard, from the simulation's layout.
  const centre = (s) => toW(s.x + HOUSE_W / 2, s.y + HOUSE_H / 2);
  const homes = houses.filter((h) => !h.isHQ).map((h) => ({ h, ...centre(h) }));
  const hq = church(), churchAt = centre(hq), cryptAt = centre(crypt);
  const stonesAt = tombs.map((t) => toW(t.x, t.y - 6));
  const yx = [cryptAt.x - 6, cryptAt.x + 6, ...stonesAt.map((s) => s.x - 2.5), ...stonesAt.map((s) => s.x + 2.5)];
  const yz = [cryptAt.z - 5, cryptAt.z + 6, ...stonesAt.map((s) => s.z - 2.5), ...stonesAt.map((s) => s.z + 2.5)];
  const yard = { x: (Math.min(...yx) + Math.max(...yx)) / 2, z: (Math.min(...yz) + Math.max(...yz)) / 2, w: Math.max(...yx) - Math.min(...yx) + 4, d: Math.max(...yz) - Math.min(...yz) + 4 };
  const NX = Math.random() * 100, NZ = Math.random() * 100;   // shifts the terrain noise, so the hills differ each map

  // ---- terrain height ----
  const valley = (x, z) => sstep(RH + 0.6, RH + 18, riverDist(x, z));
  const edge = (x, z) => 1 - sstep(135, 168, Math.hypot(x, z));   // the land flattens at the border, to meet the flat skirt
  const swell = (x, z) => ((vnoise(x / 58 + NX, z / 58 + NZ) - 0.5) * 5.2 + (vnoise(x / 24 + 9 + NX, z / 24 + 4 + NZ) - 0.5) * 1.8 + 0.5) * valley(x, z) * edge(x, z);
  const bumps = (x, z) => (vnoise(x / 9 + 2 + NX, z / 9 + 7 + NZ) - 0.5) * 0.45 * valley(x, z) * edge(x, z);
  const rises = (x, z) => HILL * (1 - sstep(6, 20.5, Math.hypot(x - churchAt.x, z - churchAt.z))) + YARD_RISE * (1 - sstep(15, 34, Math.hypot(x - yard.x, z - yard.z)));
  const base = (x, z) => swell(x, z) + bumps(x, z) + rises(x, z);
  const nearBridge = (x, z) => sstep(RH + 5, RH + 22, riverDist(x, z));
  function roadTop(x, z) {
    let sw = 0, top = 0;
    for (const r of rl) {
      const t = (x - r.x) * r.dx + (z - r.z) * r.dz, px = r.x + r.dx * t, pz = r.z + r.dz * t, d = Math.hypot(x - px, z - pz);
      const w = 1 / (d * d + 0.5) ** 2;
      sw += w; top += w * (swell(px, pz) + rises(px, pz) + MOUND * nearBridge(px, pz) * edge(px, pz));
    }
    return top / sw;
  }
  const junction = (() => {
    const [p, q] = rl, den = p.dx * q.dz - p.dz * q.dx;
    if (Math.abs(den) < 1e-6) return null;
    const s = ((q.x - p.x) * q.dz - (q.z - p.z) * q.dx) / den;
    return { x: p.x + p.dx * s, z: p.z + p.dz * s };
  })();
  const crown = (x, z) => {
    const d = roadDist(x, z) / RDH;
    if (d >= 1) return 0;
    const atJunction = junction ? sstep(RDH * 1.5, RDH * 4, Math.hypot(x - junction.x, z - junction.z)) : 1;
    return CROWN * (1 - d * d) * nearBridge(x, z) * edge(x, z) * atJunction;
  };
  const pads = [...homes.map(({ x, z }) => ({ x, z: z + 1, r: 6.5, b: 6 })), { x: churchAt.x, z: churchAt.z, r: 7, b: 6 }, { x: yard.x, z: yard.z, r: Math.max(yard.w, yard.d) / 2 + 2, b: 9 }];
  pads.forEach((p) => { p.h = base(p.x, p.z); });
  function heightAt(x, z) {
    const bank = riverDist(x, z);
    if (bank < RH + 0.6) return -0.45 * (1 - sstep(RH - 1.0, RH + 0.6, bank)) + 0.16 * (vnoise(x * 0.8, z * 0.8) - 0.5) * (1 - sstep(RH + 0.2, RH + 0.6, bank));
    let h = base(x, z);
    for (const p of pads) { const w = 1 - sstep(p.r, p.r + p.b, Math.hypot(x - p.x, z - p.z)); if (w > 0) h += (p.h - h) * w; }
    const rw = 1 - sstep(RDH + 0.3, RDH + 6.5, roadDist(x, z));
    if (rw > 0) h += (roadTop(x, z) + crown(x, z) - 0.08 * edge(x, z) * sstep(RH + 0.6, RH + 3, bank) - h) * rw;
    return h;
  }

  // ---- ground: each bank's strip, built in the river's frame with vertices packed closer near the water ----
  const TILE = 2.6;
  const grassMat = groundMaterial();
  for (const side of [-1, 1]) {
    const x0 = RH - 1.0, w = GROUND - x0;
    const geo = new THREE.PlaneGeometry(w, GROUND * 2, Math.round(w / 1.6), Math.round(GROUND * 2 / 1.5));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / w + 0.5, lx = side * (x0 + w * (0.3 * u + 0.7 * u * u)), lz = pos.getZ(i), p = fromRiver(lx, lz);
      pos.setXYZ(i, lx, heightAt(p.x, p.z), lz); uv.setXY(i, p.x / TILE, p.z / TILE);
    }
    if (side < 0) geo.index.array.reverse();
    geo.computeVertexNormals();
    const m = own(new THREE.Mesh(geo, grassMat)); m.receiveShadow = true; riverFrame.add(m);
  }
  // Flat skirts and a stretched river beyond the modelled ground, so no view shows the edge of the map.
  const FAR = 900;
  const skirt = (x0, x1, z0, z1) => {
    const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, -0.03, (z0 + z1) / 2);
    const gp = g.attributes.position, gu = g.attributes.uv;
    for (let i = 0; i < gp.count; i++) { const p = fromRiver(gp.getX(i), gp.getZ(i)); gu.setXY(i, p.x / TILE, p.z / TILE); }
    riverFrame.add(own(new THREE.Mesh(g, grassMat)));
  };
  for (const side of [-1, 1]) {
    const inner = side * (RH + 0.6), far = side * FAR, lap = GROUND - 1.5;
    skirt(inner, far, -FAR, -lap); skirt(inner, far, lap, FAR); skirt(side * lap, far, -lap, lap);
    const r = A.river_straight.clone(); r.scale.z *= (FAR - GROUND) / 6; r.position.set(0, 0, side * (GROUND + FAR) / 2); riverFrame.add(r);
  }
  for (let z = -GROUND + 3; z < GROUND; z += 6) { const r = A.river_straight.clone(); r.position.set(0, 0, z); shadows(r, false, true); riverFrame.add(r); }

  // ---- graveyard bed: mulchy turf 25 cm proud of the grass, with a short sloped lip ----
  const mulchMask = (x, z) => {
    const dx = Math.abs(x - yard.x) - yard.w / 2 + 5, dz = Math.abs(z - yard.z) - yard.d / 2 + 5;
    const s = Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - 5 + 2.2 * (vnoise(x * 0.5, z * 0.5) - 0.5);
    return 1 - sstep(-0.35, 0.35, s);
  };
  const mulchTop = (x, z) => heightAt(x, z) + MULCH * mulchMask(x, z);
  {
    const Wd = yard.w + 8, D = yard.d + 8, STEP = 0.35;
    const geo = new THREE.PlaneGeometry(Wd, D, Math.round(Wd / STEP), Math.round(D / STEP));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + yard.x, z = pos.getZ(i) + yard.z, m = mulchMask(x, z);
      pos.setXYZ(i, x, heightAt(x, z) + (MULCH + 0.035 * (vnoise(x * 2.3, z * 2.3) - 0.5)) * m - 0.2 * (1 - m), z); uv.setXY(i, x / TILE, z / TILE);
    }
    geo.computeVertexNormals();
    const bed = own(new THREE.Mesh(geo, groundMaterial(1))); bed.receiveShadow = true; bed.castShadow = true; root.add(bed);
  }

  // ---- roads and bridges ----
  const v = new THREE.Vector3();
  const deckY = -0.25, abutY = deckY - 0.06 * A.abut.children[0].scale.y;
  rl.forEach((road, ri) => {
    const yaw = Math.atan2(road.dx, road.dz);
    const half = road.half, spans = Math.ceil((2 * half - 6) / 3), total = spans * 3 + 6;
    const at = (s, y = 0) => new THREE.Vector3(road.x + road.dx * s, y, road.z + road.dz * s);
    const ends = [Infinity, -Infinity];
    for (let s = -GROUND * 1.4; s < GROUND * 1.4; s += 3) {
      const mid = s + 1.5;
      if (Math.abs(mid) < total / 2 - 3) continue;   // the deck takes over here
      const p = at(mid, ri * 0.012);
      if (Math.hypot(p.x, p.z) > GROUND - 4) continue;
      ends[0] = Math.min(ends[0], s); ends[1] = Math.max(ends[1], s + 3);
      const r = A.road_straight.clone(); r.traverse((o) => { if (o.isMesh) o.material = A.roadMats[ri]; }); r.position.copy(p); r.rotation.y = yaw; r.updateMatrixWorld(true);
      r.traverse((o) => {   // lift every vertex onto the embankment, so the module follows the land
        if (!o.isMesh) return;
        const src = o.geometry.toNonIndexed(), sp = src.attributes.position, keep = [];
        const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), fn = new THREE.Vector3();
        for (let i = 0; i < sp.count; i += 3) {
          pa.fromBufferAttribute(sp, i).applyMatrix4(o.matrixWorld); pb.fromBufferAttribute(sp, i + 1).applyMatrix4(o.matrixWorld); pc.fromBufferAttribute(sp, i + 2).applyMatrix4(o.matrixWorld);
          if (fn.subVectors(pb, pa).cross(pc.sub(pa)).normalize().y > 0.5) keep.push(i, i + 1, i + 2);
        }
        o.geometry = new THREE.BufferGeometry(); own(o);
        for (const name of Object.keys(src.attributes)) {
          const att = src.attributes[name], arr = new att.array.constructor(keep.length * att.itemSize);
          keep.forEach((k, n) => { for (let c = 0; c < att.itemSize; c++) arr[n * att.itemSize + c] = att.array[k * att.itemSize + c]; });
          let cur = arr; const w = att.itemSize;
          for (let pass = 0; pass < 2; pass++) {   // split every triangle into 16, so the surface follows the land
            const out = new cur.constructor(cur.length * 4), tri = w * 3;
            for (let t = 0; t < cur.length; t += tri) {
              const P = (i) => Array.from(cur.subarray(t + i * w, t + i * w + w)), midp = (u, q) => u.map((x, c) => (x + q[c]) / 2);
              const a = P(0), b = P(1), c = P(2), ab = midp(a, b), bc = midp(b, c), ca = midp(c, a);
              out.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca].flat(), t * 4);
            }
            cur = out;
          }
          o.geometry.setAttribute(name, new THREE.BufferAttribute(cur, w, att.normalized));
        }
        src.dispose();
        const g = o.geometry.attributes.position, inv = o.matrixWorld.clone().invert();
        const surf = (x, z) => roadTop(x, z) + crown(x, z), nrm = o.geometry.attributes.normal || new THREE.BufferAttribute(new Float32Array(g.count * 3), 3);
        const toLocal = new THREE.Matrix3().getNormalMatrix(inv), nv = new THREE.Vector3(), E = 0.05;
        for (let i = 0; i < g.count; i++) {
          v.fromBufferAttribute(g, i).applyMatrix4(o.matrixWorld);
          nv.set(-(surf(v.x + E, v.z) - surf(v.x - E, v.z)) / (2 * E), 1, -(surf(v.x, v.z + E) - surf(v.x, v.z - E)) / (2 * E)).normalize().applyMatrix3(toLocal).normalize();
          nrm.setXYZ(i, nv.x, nv.y, nv.z);
          v.y += surf(v.x, v.z); v.applyMatrix4(inv); g.setXYZ(i, v.x, v.y, v.z);
        }
        o.geometry.setAttribute('normal', nrm); o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox();
      });
      shadows(r, false, true); r.traverse((o) => { o.renderOrder = 1; }); root.add(r);
    }
    for (const [from, dir] of [[ends[0], -1], [ends[1], 1]]) {   // one stretched module carries the road on into the fog
      const r = A.road_straight.clone(); r.traverse((o) => { if (o.isMesh) o.material = A.roadMats[ri]; o.renderOrder = 1; }); r.position.copy(at(from + dir * 200, ri * 0.012)); r.rotation.y = yaw; r.scale.z *= 400 / 3;
      root.add(r);
    }
    for (let i = 0; i < spans; i++) {
      const b = A.span.clone(); b.position.copy(at(-total / 2 + 3 + i * 3 + 1.5, deckY)); b.rotation.y = yaw; shadows(b); root.add(b);
      const j = at(-total / 2 + 3 + i * 3, 0), overWater = riverDist(j.x, j.z) < RH - 1.5;
      if (i > 0 && i % 2 === 0 && overWater || (spans <= 4 && i === Math.floor(spans / 2))) {
        const p = A.pier.clone(); const box = new THREE.Box3().setFromObject(p);
        p.position.copy(at(-total / 2 + 3 + i * 3, deckY - (box.max.y - box.min.y) + 0.1)); p.rotation.y = yaw; shadows(p); root.add(p);
      }
    }
    for (const end of [-1, 1]) {
      const b = A.abut.clone(); b.position.copy(at(end * (total / 2 - 1.5), abutY));
      b.rotation.y = yaw + ((end > 0) === A.abutLowIsPlusZ ? 0 : Math.PI); shadows(b); root.add(b);
    }
  });

  // ---- homes ----
  const houseViews = new Map();
  for (const { h, x, z } of homes) {
    const unit = new THREE.Group();
    const model = ownMaterials(A.house.clone());
    const uni = { uMapA: { value: A.houseTex.clean }, uMapB: { value: A.houseTex.decayed }, uDecay: { value: 0 } };
    eachMaterial(model, (m) => {
      m.map = A.houseTex.clean; m.emissiveMap = A.houseMask; m.emissive = new THREE.Color(0); m.emissiveIntensity = 1;
      // The colour is the clean texture set blended into the decayed one by the decay value.
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uni);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uMapA, uMapB; uniform float uDecay;`).replace('#include <map_fragment>', `
#ifdef USE_MAP
vec4 sampledDiffuseColor = mix(texture2D(uMapA, vMapUv), texture2D(uMapB, vMapUv), uDecay);
diffuseColor *= sampledDiffuseColor;
#endif`);
      };
      m.needsUpdate = true;
    });
    unit.add(model);
    const hinge = new THREE.Group(); hinge.position.set(-0.1, -0.25, 0.352);
    const d = A.house_door.clone(); d.scale.setScalar(0.33); d.position.set(0.1, 0, 0);
    hinge.add(d); unit.add(hinge);
    // The model's front stands about 2.5 m south of its centre; set 1 m south of the simulation's building, its door
    // sits just behind the simulation's door tile.
    unit.scale.setScalar(HOUSE_SCALE); unit.position.set(x, heightAt(x, z + 1) + 0.45 * HOUSE_SCALE, z + 1);
    shadows(unit); root.add(unit);
    const mats = []; eachMaterial(model, (m) => mats.push(m));
    houseViews.set(h, { unit, hinge, uni, mats, decay: 0, glow: new THREE.Color(0) });
  }

  // ---- house of worship on its hill ----
  const churchUni = { uCross: { value: new THREE.Color(0) }, uCrossStone: { value: new THREE.Color(1, 1, 1) }, uChurchWin: { value: new THREE.Color(0) }, uChurchMask: { value: A.churchMask } };
  const churchModel = A.church.clone();
  churchModel.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  eachMaterial(churchModel, (m) => {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, churchUni);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vModelPos;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vModelPos = position;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vModelPos;
uniform vec3 uCross;
uniform vec3 uCrossStone;
uniform vec3 uChurchWin;
uniform sampler2D uChurchMask;`).replace('#include <color_fragment>', `#include <color_fragment>
float crossMask = 0.0;
#ifdef USE_MAP
{ vec3 cs = sampledDiffuseColor.rgb; float csMax = max(cs.r, max(cs.g, cs.b)), csMin = min(cs.r, min(cs.g, cs.b));
  float pale = smoothstep(0.62, 0.8, csMin / max(csMax, 0.001)) * smoothstep(0.18, 0.32, csMax);
  crossMask = max(pale, smoothstep(0.35, 0.37, vModelPos.y)) * smoothstep(0.27, 0.3, vModelPos.y) * step(abs(vModelPos.x), 0.1) * step(0.18, vModelPos.z) * step(vModelPos.z, 0.37); }
#endif
diffuseColor.rgb *= mix(vec3(1.0), uCrossStone, crossMask);`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uCross * crossMask;
#ifdef USE_MAP
totalEmissiveRadiance += uChurchWin * texture2D(uChurchMask, vMapUv).r;
#endif`);
    };
  });
  const churchUnit = fit(churchModel, { width: 9.5 });
  churchUnit.position.set(churchAt.x, heightAt(churchAt.x, churchAt.z + 0.5) - 0.22, churchAt.z + 0.5); shadows(churchUnit); root.add(churchUnit);
  const halo = document.createElement('canvas'); halo.width = halo.height = 128;
  { const g = halo.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const crossHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(halo), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  crossHalo.position.set(0, 0.42, 0.262); churchModel.add(crossHalo);
  const crossLamp = new THREE.PointLight(0xffffff, 0, 30, 1.8); crossLamp.position.set(0, 0.42, 0.33); churchModel.add(crossLamp);

  // ---- crypt, with its door and the glow behind the door's grille ----
  const cryptUnit = new THREE.Group();
  const cryptModel = ownMaterials(A.crypt.clone()); cryptUnit.add(cryptModel);
  const cd = A.crypt_door.clone(); cd.scale.set(0.38, 0.38, 0.152); cd.position.set(0, -0.278, 0.267); cryptUnit.add(cd);
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
  grille.position.set(0, 0.205, 0.0); grille.visible = false; cd.add(grille);
  const cryptZ = cryptAt.z + 1.5;
  cryptUnit.scale.setScalar(CRYPT_SCALE); cryptUnit.position.set(cryptAt.x, mulchTop(cryptAt.x, cryptZ) + 0.498 * CRYPT_SCALE - 0.08, cryptZ); shadows(cryptUnit); root.add(cryptUnit);
  grille.castShadow = false;
  const cryptLamp = new THREE.PointLight(0xff7a1a, 0, 9, 2); cryptLamp.position.set(cryptAt.x, heightAt(cryptAt.x, cryptZ) + 2.2, cryptZ + 0.36 * CRYPT_SCALE + 1.2); root.add(cryptLamp);

  // ---- tombstones where the generator put them ----
  stonesAt.forEach((p, i) => {
    const k = Math.floor(hash2(i, 7) * 3), s = A.stones[k].clone();
    s.position.set(p.x, mulchTop(p.x, p.z) - 0.03, p.z); s.rotation.y = (hash2(i, 3) - 0.5) * 0.5; s.scale.multiplyScalar(0.9 + hash2(i, 5) * 0.25);
    shadows(s); root.add(s);
  });

  // ---- trees and bushes: in the outskirts, and the odd bush in town away from every walkway ----
  const taken = [...homes.map(({ x, z }) => [x, z + 1, 9]), [churchAt.x, churchAt.z, 21], [yard.x, yard.z, Math.max(yard.w, yard.d) / 2 + 4]];
  const free = (x, z, r) => riverDist(x, z) > RH + 2 + r && roadDist(x, z) > RDH + 1.5 + r && taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > tr + r);
  let placed = 0;
  for (let i = 0; i < 3000 && placed < 220; i++) {
    const x = (Math.random() * 2 - 1) * (GROUND - 6), z = (Math.random() * 2 - 1) * (GROUND - 6);
    const inTown = Math.abs(x) < WORLD_W * S / 2 + 3 && Math.abs(z) < WORLD_H * S / 2 + 3;
    const k = inTown ? 2 : Math.random() < 0.38 ? 0 : Math.random() < 0.6 ? 1 : 2;
    if (inTown && Math.random() > 0.03) continue;
    if (!free(x, z, A.plants[k][1])) continue;
    const p = A.plants[k][0].clone(); p.position.set(x, heightAt(x, z) - 0.06, z); p.rotation.y = Math.random() * Math.PI * 2; p.scale.multiplyScalar(0.8 + Math.random() * 0.45); shadows(p); root.add(p);
    taken.push([x, z, A.plants[k][1]]); placed++;
  }

  // Where a walker's feet go: on a bridge deck, on a road, on the graveyard bed, or on the ground.
  const onBridge = (x, z) => riverDist(x, z) < RH + 3 && roadDist(x, z) < BRH - 0.9;
  const groundY = (x, z) => onBridge(x, z) ? Math.max(heightAt(x, z), 0.42 * sstep(RH + 3, RH, riverDist(x, z)) + 0.02) : roadDist(x, z) < RDH ? roadTop(x, z) + crown(x, z) + 0.04 : mulchTop(x, z);

  for (const c of characters.values()) c.group.removeFromParent();
  characters.clear();
  W = { map: mapVersion, root, houseViews, groundY, churchUni, crossHalo, crossLamp, cryptModel, grille, cryptLamp, cryptKind: '', churchDecay: 0 };
  snapCamera();
}

// ---------- characters ----------

const characters = new Map();   // simulation actor (or the player) -> its figure in the scene
const contactMat = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
})();
const contactGeo = new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
const modelFor = (e) => (e === player ? 'characters/player' : e.kind === 'vamp' ? 'characters/convert' : e.main ? 'characters/hunter' : 'characters/converted_hunter');

// A rigged figure with an Idle and a Walk clip. Walk covers walk_stride metres per loop at the model's own scale, so
// it plays at (ground speed) / (stride * CHAR_SCALE) loops a second and the feet keep pace with the ground.
function makeCharacter(name) {
  const model = SkeletonUtils.clone(A[name]);
  let stride = 3;
  model.traverse((o) => {
    if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
    if (o.userData.walk_stride) stride = o.userData.walk_stride;
  });
  const mixer = new THREE.AnimationMixer(model);
  const clip = (n) => clips[name].find((a) => a.name === n);
  const idle = mixer.clipAction(clip('Idle')), walk = mixer.clipAction(clip('Walk'));
  idle.play();
  mixer.setTime(Math.random() * 4);
  const group = new THREE.Group(); model.scale.setScalar(CHAR_SCALE); group.add(model);
  group.add(new THREE.Mesh(contactGeo, contactMat));
  return { group, mixer, idle, walk, stride, moving: false, speed: 0, px: null, pz: null, ox: 0, oy: 0, yaw: 0 };
}
function setMoving(c, m) {
  if (m === c.moving) return;
  c.moving = m;
  const from = m ? c.idle : c.walk, to = m ? c.walk : c.idle;
  to.reset().setEffectiveWeight(1).play();
  from.crossFadeTo(to, 0.2, false);
}

const standingAtDoor = (e) => e.atDoor || e.state === 'knock' || e.state === 'inspect' || e.state === 'purge';
function syncCharacters(dt) {
  const seen = new Set();
  const people = mode === 'title' ? [] : [player, ...actors];
  for (const e of people) {
    const hidden = e === player ? player.state === 'inside' : !e.alive || e.inside;
    if (hidden) continue;
    seen.add(e);
    let c = characters.get(e);
    if (!c) { c = makeCharacter(modelFor(e)); characters.set(e, c); W.root.add(c.group); }
    // Walkers keep to the right of their route, so two going opposite ways pass side by side. Offsets in simulation
    // pixels, eased, as in the 2D view. Anyone at a door stands on the door tile, just in front of the model's door.
    let tx = 0, ty = 0;
    if (e !== player) {
      const h = heading(e);
      if (h && !standingAtDoor(e)) { tx = -h.y * 9; ty = h.x * 9; }
    }
    c.ox += (tx - c.ox) * 0.2; c.oy += (ty - c.oy) * 0.2;
    const p = toW(e.x + c.ox, e.y + c.oy), y = W.groundY(p.x, p.z);
    if (c.px === null) { c.px = p.x; c.pz = p.z; }
    const dx = p.x - c.px, dz = p.z - c.pz, moved = Math.hypot(dx, dz);
    c.speed += ((dt > 0 ? moved / dt : 0) - c.speed) * 0.25;
    c.px = p.x; c.pz = p.z;
    const moving = c.speed > 0.4 && !paused;
    setMoving(c, moving);
    if (moving) c.walk.timeScale = c.speed / (c.stride * CHAR_SCALE);
    // Face the way of travel; at a door, face the door.
    const want = e !== player && standingAtDoor(e) ? Math.PI : moved > 0.002 ? Math.atan2(dx, dz) : c.yaw;
    let d = want - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    c.yaw += d * Math.min(1, dt * 14);
    c.group.rotation.y = c.yaw;
    c.group.position.set(p.x, y, p.z);
    c.mixer.update(paused ? 0 : dt);
  }
  for (const [e, c] of characters) if (!seen.has(e)) { c.group.removeFromParent(); characters.delete(e); }
}

// Progress bars (knocking, inspecting, purging, the player's sun exposure) are HTML, so they stay sharp over the blur.
const barLayer = document.getElementById('bars');
const barPool = [];
const projected = new THREE.Vector3();
function syncBars() {
  const list = [];
  if (mode === 'play') {
    for (const e of actors) {
      if (!e.alive || e.inside) continue;
      if (e.state === 'knock') list.push([e, 1 - e.timer / TUNE.npcKnockSeconds, '#e0566a']);
      if (e.state === 'purge') list.push([e, 1 - e.timer / TUNE.purgeSeconds, '#6fb3e8']);
      if (e.state === 'inspect') list.push([e, 1 - e.timer / TUNE.inspectSeconds, '#d8d8d8']);
    }
    if (player.sun > 0 && player.state !== 'inside') list.push([player, player.sun / TUNE.sunGraceSeconds, '#ffb020']);
  }
  list.forEach(([e, frac, color], i) => {
    let el = barPool[i];
    if (!el) { el = document.createElement('div'); el.className = 'bar3d'; el.appendChild(document.createElement('i')); barLayer.appendChild(el); barPool.push(el); }
    const c = characters.get(e);
    if (!c) { el.hidden = true; return; }
    projected.copy(c.group.position); projected.y += 3.4; projected.project(camera);
    el.hidden = projected.z > 1;
    el.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px, ${(-projected.y * 0.5 + 0.5) * innerHeight}px)`;
    el.firstChild.style.width = `${Math.round(100 * clamp01(frac))}%`;
    el.firstChild.style.background = color;
  });
  for (let i = list.length; i < barPool.length; i++) barPool[i].hidden = true;
}

// ---------- buildings: lights, decay and doors ----------

const CROSS = { red: new THREE.Color(1, 0, 0.03), white: new THREE.Color(1, 1, 1), redStone: new THREE.Color(0.5, 0, 0.01), redHalo: new THREE.Color(1, 0, 0.04), redLamp: new THREE.Color(1, 0.02, 0.04), worship: new THREE.Color(0x9fc4e8) };
const tmpColor = new THREE.Color();
let nightK = 0;   // 0 in full daylight, 1 in full night

function syncBuildings(dt) {
  const ease = (rate) => 1 - Math.exp(-dt * rate);
  for (const [h, view] of W.houseViews) {
    const look = buildingLook(h), lightKey = look.light;
    // Decay: 0 for a clean home, 0.4 on the night it is cursed, rising to 1 at nightsToSpawnVampire, and 1 whenever a
    // vampire lives there. It eases over a few seconds, so a curse or a purge reads as a change, not a cut.
    const target = h.state !== 'cursed' ? 0 : h.vampire ? 1 : 0.4 + 0.6 * Math.min(1, h.cursedNights / TUNE.nightsToSpawnVampire);
    view.decay += (target - view.decay) * ease(0.8);
    view.uni.uDecay.value = view.decay;
    const T3 = A.houseTex;
    if (lightKey === LIGHT.home) { view.uni.uMapA.value = T3.yellow; view.uni.uMapB.value = T3.decayed; }
    else if (lightKey === LIGHT.player) { view.uni.uMapA.value = T3.red; view.uni.uMapB.value = T3.decayedRed; }
    else if (lightKey === LIGHT.vampire) { view.uni.uMapA.value = T3.clean; view.uni.uMapB.value = T3.decayedOrange; }
    else { view.uni.uMapA.value = T3.clean; view.uni.uMapB.value = T3.decayed; }
    tmpColor.set(lightKey ? LIGHT3D[lightKey] : 0x000000);
    view.glow.lerp(tmpColor, ease(4));
    for (const m of view.mats) { m.emissive.copy(view.glow); m.emissiveIntensity = 0.9 + 1.0 * nightK; }
    const open = look.shut ? 0 : -1.9;
    view.hinge.rotation.y += (open - view.hinge.rotation.y) * ease(5);
  }

  // The cross: white, with strength following town health, down to a dull grey; bright red for the final swarm.
  const homes = houses.filter((x) => !x.isHQ), health = homes.filter((x) => x.state !== 'cursed').length / homes.length;
  const red = !!rally, live = red ? 1 : Math.pow(health, 1.4), col = red ? CROSS.red : CROSS.white;
  const cu = W.churchUni;
  cu.uCross.value.copy(col).multiplyScalar(red ? 0.3 : 1.5 * live);
  cu.uCrossStone.value.copy(red ? CROSS.redStone : CROSS.white).multiplyScalar(red ? 1 : 0.28 + 0.72 * live);
  W.crossHalo.material.color.copy(red ? CROSS.redHalo : col);
  W.crossHalo.material.opacity = (red ? 0.2 : 0.5) * live; W.crossHalo.scale.setScalar(0.1 + (red ? 0.42 : 0.26) * live);
  W.crossLamp.color.copy(red ? CROSS.redLamp : col); W.crossLamp.intensity = (red ? 1 : 8 * live) * (1.5 + 5 * nightK);
  // House of worship windows: pale blue by day, off at night; a creeping red for the final swarm.
  const winLit = buildingLook(church()).light;
  tmpColor.copy(red ? CROSS.red : CROSS.worship).multiplyScalar(red ? 0.34 : winLit ? 0.55 : 0);
  cu.uChurchWin.value.lerp(tmpColor, ease(3));

  // The crypt: its walls and door grille show who sleeps there.
  const kind = playerIn(crypt) ? 'red' : vampireInside(crypt) ? 'orange' : 'empty';
  if (kind !== W.cryptKind) { W.cryptKind = kind; eachMaterial(W.cryptModel, (m) => { m.map = A.cryptTex[kind] || A.cryptBase; }); }
  W.grille.visible = kind !== 'empty';
  const glow = kind === 'red' ? 0xff2218 : 0xff7a1a;
  if (W.grille.visible) { W.grille.material.color.set(glow).multiplyScalar(1.4 + 0.8 * nightK); W.cryptLamp.color.set(glow); }
  W.cryptLamp.intensity = kind === 'empty' ? 0 : 2.5 + 4.5 * nightK;
}

// ---------- time of day ----------
// One light plays the sun by day and the moon by night. Each rises in the east (+X), climbs toward the south and sets
// in the west. The sun fades out as it sets and the moon fades in as it rises.
const C = (h) => new THREE.Color(h);
const SKY = { day: C(0x9fc4e8), dusk: C(0xe48a5c), night: C(0x1f2d5c) };
const SUNC = { high: C(0xfff3de), low: C(0xff8a3a), moon: C(0xa9bcff) };
const AMB = { day: C(0xcfe3ff), night: C(0x9db0f2), dusk: C(0xffb48a), groundDay: C(0x4a5a34), groundNight: C(0x3d4d74) };
const sky = new THREE.Color();
scene.background = sky; scene.fog = new THREE.Fog(0x000000, 230, 430);
let baseExposure = 1;
function setTimeOfDay(h) {
  const sunAng = (h - 6) / 12 * Math.PI, sunUp = Math.sin(sunAng), moonUp = -sunUp;
  nightK = 1 - sstep(-0.18, 0.16, sunUp);
  starUniforms.uNight.value = sstep(0.4, 0.95, nightK);
  const twilight = Math.max(0, 1 - Math.abs(sunUp) / 0.32);
  const useSun = sunUp > 0, ang = useSun ? sunAng : sunAng - Math.PI, up = Math.max(0.14, useSun ? sunUp : moonUp);
  const flat = Math.sqrt(Math.max(0, 1 - up * up));
  sunDir.set(Math.cos(ang) * flat * 200, up * 200, (0.35 + 0.45 * up) * 120);
  if (useSun) { sun.color.copy(SUNC.low).lerp(SUNC.high, clamp01(sunUp / 0.45)); sun.intensity = (0.9 + 1.8 * sstep(0, 0.3, sunUp)) * sstep(-0.02, 0.22, sunUp); }
  else { sun.color.copy(SUNC.moon); sun.intensity = (1.2 + 1.0 * sstep(0, 0.3, moonUp)) * sstep(0, 0.35, moonUp); }
  sky.copy(SKY.day).lerp(SKY.night, clamp01(nightK)).lerp(SKY.dusk, clamp01(twilight * 0.8));
  waterUniforms.uSky.value.copy(sky);
  scene.fog.color.copy(sky);
  hemi.color.copy(AMB.day).lerp(AMB.night, clamp01(nightK)).lerp(AMB.dusk, clamp01(twilight * 0.6));
  hemi.groundColor.copy(AMB.groundDay).lerp(AMB.groundNight, clamp01(nightK));
  hemi.intensity = 1.0 + 1.1 * nightK + 0.5 * twilight;
  baseExposure = 1.0 + 0.95 * nightK + 0.25 * twilight;
}

// ---------- camera ----------
// It follows the simulation's camera subject: briskly after the player, a slow glide to anyone else (as in 2D).
function subjectWorld() {
  const s = mode === 'title' ? crypt.door : cameraSubject(), p = toW(s.x, s.y);
  return new THREE.Vector3(p.x, W.groundY(p.x, p.z), p.z);
}
function snapCamera() { camTarget.copy(subjectWorld()); aimAt(); }
function followCamera(dt) {
  const s = mode === 'title' ? null : cameraSubject(), goal = subjectWorld(), gap = goal.clone().sub(camTarget), far = gap.length();
  if (far > 1e-4) {
    const frames = Math.min(dt, 0.1) * 60;
    if (s === player) camTarget.addScaledVector(gap, 1 - Math.pow(1 - 0.12, frames));
    else { const stepPx = Math.min(5, Math.max(0.5, far / S * 0.04)) * frames; camTarget.addScaledVector(gap, Math.min(1, stepPx * S / far)); }
  }
  aimAt();
}

// ---------- effects: tilt-shift, saturation and vignette, then the stars ----------

const TiltShift = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uFocus: { value: 0.5 }, uRadius: { value: 0.007 }, uGrade: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uFocus, uRadius, uGrade; varying vec2 vUv;
    void main() {
      float amt = smoothstep(0.13, 0.42, abs(vUv.y - uFocus));
      vec2 stepUv = uDir * uRadius * amt / 10.0;
      vec4 c = texture2D(tDiffuse, vUv); float wSum = 1.0;
      for (int k = 1; k <= 10; k++) {
        float f = float(k), w = exp(-f * f / 40.5);
        c += (texture2D(tDiffuse, vUv + stepUv * f) + texture2D(tDiffuse, vUv - stepUv * f)) * w; wSum += 2.0 * w;
      }
      c /= wSum;
      if (uGrade > 0.5) {
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = max(vec3(0.0), mix(vec3(l), c.rgb, 1.15));
        vec2 v = vUv - 0.5; c.rgb *= 1.0 - 0.32 * smoothstep(0.35, 0.95, length(v * vec2(1.0, 0.85)) * 1.6);
      }
      gl_FragColor = c;
    }`,
};
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const blurH = new ShaderPass(TiltShift), blurV = new ShaderPass(TiltShift);
blurV.uniforms.uGrade.value = 1;
for (const b of [blurH, blurV]) { b.material.depthTest = false; b.material.depthWrite = false; }
const starPass = new RenderPass(skyScene, camera);
starPass.clear = false;
composer.addPass(blurH); composer.addPass(blurV); composer.addPass(starPass); composer.addPass(new OutputPass());
composer.setPixelRatio(renderScale); composer.setSize(innerWidth, innerHeight);
const BRIGHTNESS = 1.75, BLUR = 3;
function drawFrame() {
  renderer.toneMappingExposure = baseExposure * BRIGHTNESS;
  projected.copy(camTarget).project(camera);   // the sharp band follows the camera subject's row on screen
  const focus = Math.min(0.8, Math.max(0.2, projected.y * 0.5 + 0.5));
  blurH.uniforms.uFocus.value = blurV.uniforms.uFocus.value = focus;
  blurH.uniforms.uDir.value.set(innerHeight / innerWidth, 0); blurV.uniforms.uDir.value.set(0, 1);
  blurH.uniforms.uRadius.value = blurV.uniforms.uRadius.value = 0.007 * BLUR;
  renderer.autoClear = false; composer.render(); renderer.autoClear = true;
}
let slowAcc = 0, slowN = 0, calmWindows = 0;
const setScale = (k) => { renderScale = k; renderer.setPixelRatio(k); composer.setPixelRatio(k); composer.setSize(innerWidth, innerHeight); calmWindows = 0; };
// With the resolution setting on automatic, the render scale drops when frames run slow and creeps back up when they
// have headroom.
function adaptResolution(dt) {
  if (quality.resolution !== 'auto' || document.hidden || dt > 0.5) return;
  slowAcc += dt;
  if (++slowN < 40) return;
  const avg = slowAcc / slowN; slowAcc = 0; slowN = 0;
  if (avg > 1 / 48 && renderScale > 0.6) setScale(Math.max(0.6, renderScale * 0.85));
  else if (avg < 1 / 57 && renderScale < MAX_SCALE && ++calmWindows >= 6) setScale(Math.min(MAX_SCALE, renderScale * 1.1));
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; frameCamera(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// The graphics settings (see menu.js): shadow quality, render resolution, the tilt-shift passes and antialiasing.
let quality = { shadows: 'high', resolution: 'auto', blur: true, aa: true };
function configure(s) {
  const was = quality;
  quality = { shadows: s.shadows, resolution: s.resolution, blur: s.blur, aa: s.aa };
  const on = quality.shadows !== 'off', size = quality.shadows === 'low' ? 1024 : 2048;
  if (renderer.shadowMap.enabled !== on) {   // materials compile with or without shadows, so they rebuild
    renderer.shadowMap.enabled = on;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  sun.castShadow = on;
  if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  blurH.enabled = blurV.enabled = quality.blur;
  const samples = quality.aa ? 4 : 0;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
  if (quality.resolution !== 'auto') setScale(MAX_SCALE * +quality.resolution);
  else if (was.resolution !== 'auto') setScale(Math.min(MAX_SCALE, 1));
}
if (typeof settings !== 'undefined') configure(settings);

// ---------- start-up and the per-frame entry point ----------

const timer = new THREE.Clock();
let ready = false;
function frame() {
  const dt = Math.min(timer.getDelta(), 0.1);
  if (!ready) return;
  if (W.map !== mapVersion) buildWorld();
  adaptResolution(dt);
  setTimeOfDay(hourOfDay());
  syncBuildings(dt);
  syncCharacters(dt);
  viewYaw = CAM.yaw;
  followCamera(dt);
  stars.position.set(camTarget.x, 0, camTarget.z);
  starUniforms.uTime.value = waterUniforms.uTime.value = timer.elapsedTime;
  starUniforms.uPixel.value = renderScale;
  const d = camera.position.distanceTo(camTarget); scene.fog.near = d + 70; scene.fog.far = d + 200;
  aimShadows();
  drawFrame();
  syncBars();
}
window.render3d = { frame, configure, get ready() { return ready; }, get world() { return W; } };

const loading = document.getElementById('loading'), loadFill = document.getElementById('loadFill'), loadText = document.getElementById('loadText');
let filesIdle = false;
THREE.DefaultLoadingManager.onProgress = (url, done, total) => { filesIdle = false; loadFill.style.width = Math.round(100 * done / total) + '%'; loadText.textContent = `Loading the town (${done} of ${total} files)`; };
THREE.DefaultLoadingManager.onStart = () => { filesIdle = false; };
THREE.DefaultLoadingManager.onLoad = () => { filesIdle = true; };
loadAssets().then(async () => {
  buildWorld();
  setTimeOfDay(hourOfDay());
  while (!filesIdle) await new Promise((r) => setTimeout(r, 50));
  loadFill.style.width = '100%'; loadText.textContent = 'Preparing the scene';
  await new Promise((r) => setTimeout(r, 30));
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera);
  drawFrame();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  ready = true;
  loading.classList.add('done'); setTimeout(() => loading.remove(), 700);
  document.title = 'ready: ' + document.title;
}).catch((e) => { loadText.textContent = 'Failed to load: ' + (e.message || e); console.error(e); });
