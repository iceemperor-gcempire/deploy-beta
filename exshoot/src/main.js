import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ============================================================
// EXSHOOT — Three.js 익스트랙션 슈터
// 레이드 진입 → 루팅 → 스캐브 교전 → 탈출 지점 도달 → 스태시 누적
// ============================================================

// ---------- 상수 ----------
const WORLD_HALF = 88;            // 맵 절반 크기
const RAID_SECONDS = 12 * 60;     // 레이드 제한 시간
const EXTRACT_HOLD = 8;           // 탈출 유지 시간(초)
const EXTRACT_RADIUS = 5;

const PLAYER = {
  radius: 0.38,
  height: 1.7,
  eye: 1.62,
  walkSpeed: 5.0,
  sprintMult: 1.65,
  accel: 40,
  jumpVel: 5.7,
  gravity: 14.5,
  maxHp: 100,
};

// 무기 테이블 — GUN 은 현재 장착 무기를 가리킴 (equipWeapon 으로 교체)
const WEAPONS = {
  rifle: {
    key: 'rifle', name: 'AK 소총', model: 'rifle', price: 0, viewLen: 0.62,
    fireInterval: 0.11, magSize: 30, reserveMax: 90, reloadTime: 2.2,
    damageBody: 34, damageHead: 95, range: 200,
    spreadHip: 0.022, spreadAds: 0.005, spreadMove: 0.02,
    pellets: 1, auto: true, adsFov: 55, recoil: 0.35, kick: 0.006, sfxRate: 1, sfxVol: 0.45,
  },
  revolver: {
    key: 'revolver', name: '리볼버', model: 'revolver', price: 12000, viewLen: 0.34,
    fireInterval: 0.5, magSize: 6, reserveMax: 24, reloadTime: 2.8,
    damageBody: 60, damageHead: 170, range: 120,
    spreadHip: 0.03, spreadAds: 0.006, spreadMove: 0.025,
    pellets: 1, auto: false, adsFov: 60, recoil: 0.7, kick: 0.012, sfxRate: 1.15, sfxVol: 0.5,
  },
  smg2: {
    key: 'smg2', name: 'SMG', model: 'smg2', price: 18000, viewLen: 0.5,
    fireInterval: 0.07, magSize: 35, reserveMax: 105, reloadTime: 1.9,
    damageBody: 22, damageHead: 55, range: 120,
    spreadHip: 0.03, spreadAds: 0.012, spreadMove: 0.018,
    pellets: 1, auto: true, adsFov: 62, recoil: 0.22, kick: 0.004, sfxRate: 1.3, sfxVol: 0.38,
  },
  shotgun: {
    key: 'shotgun', name: '펌프 샷건', model: 'shotgun', price: 34000, viewLen: 0.60,
    fireInterval: 0.85, magSize: 6, reserveMax: 30, reloadTime: 2.6,
    damageBody: 13, damageHead: 24, range: 46,
    spreadHip: 0.055, spreadAds: 0.038, spreadMove: 0.02,
    pellets: 8, auto: false, adsFov: 62, recoil: 0.9, kick: 0.02, sfxRate: 0.7, sfxVol: 0.55,
  },
  bullpup: {
    key: 'bullpup', name: '불펍 소총', model: 'bullpup', price: 55000, viewLen: 0.62,
    fireInterval: 0.09, magSize: 36, reserveMax: 108, reloadTime: 2.0,
    damageBody: 38, damageHead: 105, range: 220,
    spreadHip: 0.02, spreadAds: 0.004, spreadMove: 0.018,
    pellets: 1, auto: true, adsFov: 52, recoil: 0.32, kick: 0.005, sfxRate: 1.08, sfxVol: 0.45,
  },
  sniper: {
    key: 'sniper', name: '볼트액션 저격총', model: 'sniper', price: 90000, viewLen: 0.78,
    fireInterval: 1.5, magSize: 5, reserveMax: 20, reloadTime: 2.9,
    damageBody: 110, damageHead: 260, range: 400,
    spreadHip: 0.05, spreadAds: 0.0012, spreadMove: 0.035,
    pellets: 1, auto: false, adsFov: 18, recoil: 1.1, kick: 0.016, sfxRate: 0.82, sfxVol: 0.55,
  },
};
let GUN = WEAPONS.rifle;

// 무기 부착물 — 구매(전역 소유) 후 무기별 장착, 사망 시 손실 (#98)
const ATTACHMENTS = {
  scope: {
    key: 'scope', name: '스코프', model: 'attScope', price: 15000,
    desc: '조준 배율 강화 (배율 +80%)',
    compat: ['rifle', 'smg2', 'bullpup', 'revolver'],
  },
  silencer: {
    key: 'silencer', name: '소음기', model: 'attSilencer', price: 20000,
    desc: '총성 은폐 — 사격 시 적 감지 60m → 16m',
    compat: ['rifle', 'revolver', 'smg2', 'shotgun', 'bullpup', 'sniper'],
  },
  grip: {
    key: 'grip', name: '수직 그립', model: 'attGrip', price: 10000,
    desc: '반동 40% 감소 · 이동 탄퍼짐 50% 감소',
    compat: ['rifle', 'smg2', 'shotgun', 'bullpup', 'sniper'],
  },
};
let currentAtt = []; // 현재 장착 무기의 부착물 (equipWeapon 에서 갱신)

// 부착물 메시를 총 모델(m)의 자식으로 정확히 부착 — 부모의 회전(π/2)·스케일·중심이동을
// worldToLocal 로 역변환. size/bb 는 정규화 직후 총의 월드 치수/바운즈.
function attachToGun(m, size, bb, attKey) {
  const att = ATTACHMENTS[attKey];
  const am = instantiate(att.model);
  const alen = attKey === 'silencer' ? 0.14 : (attKey === 'scope' ? 0.13 : 0.07); // 스코프 0.09→0.13 (#104 리얼 총기 비율)
  const asz = normalizeModel(am, alen, 0); // 회전 없이 정규화 (부모가 이미 +X→-Z 회전)
  brightenMaterials(am, 3.2);
  am.traverse((o) => { o.frustumCulled = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  let P;
  if (attKey === 'silencer') P = new THREE.Vector3(0, size.y * 0.25, -size.z / 2 - alen / 2 + 0.01);
  else if (attKey === 'scope') P = new THREE.Vector3(0, bb.max.y + asz.y / 2 - 0.004, -size.z * 0.12);
  else P = new THREE.Vector3(0, size.y * 0.25 - 0.032, -size.z * 0.3); // grip: 총열(총구 높이) 바로 아래
  m.updateMatrixWorld(true);
  am.position.copy(m.worldToLocal(P));
  am.scale.multiplyScalar(1 / m.scale.x);
  m.add(am);
  return { am, topExtra: asz.y - 0.004 };
}
function attLoadout(weaponKey) {
  const st = loadStash();
  return ((st.attachments || {})[weaponKey] || []).filter((a) => ATTACHMENTS[a] && ATTACHMENTS[a].compat.includes(weaponKey));
}

const ITEM_TABLE = [
  { name: '볼트',            value: 1500,  w: 18 },
  { name: '붕대',            value: 3000,  w: 16, heal: 25 },
  { name: '군용 MRE',        value: 8000,  w: 12 },
  { name: '구급킷',          value: 14000, w: 7,  heal: 60 },
  { name: '손목시계',        value: 15000, w: 10 },
  { name: '위스키',          value: 22000, w: 8 },
  { name: '금목걸이',        value: 28000, w: 6 },
  { name: '그래픽카드',      value: 95000, w: 2 },
  { name: '5.56 탄약 30발',  value: 0,     w: 14, ammo: 30 },
];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const dom = {
  hud: $('hud'), menu: $('menu-screen'), death: $('death-screen'), extract: $('extract-screen'),
  hpFill: $('hp-fill'), stamFill: $('stam-fill'),
  ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), gunState: $('gun-state'),
  raidTimer: $('raid-timer'), compass: $('compass'),
  lootValue: $('loot-value-num'), kills: $('kills'),
  prompt: $('prompt'), extractProgress: $('extract-progress'),
  extractFill: $('extract-fill'), extractLabel: $('extract-label'),
  damageVignette: $('damage-vignette'), lowhpVignette: $('lowhp-vignette'),
  hitmarker: $('hitmarker'), killfeed: $('killfeed'),
  inventory: $('inventory'), invList: $('inv-list'), invTotal: $('inv-total-val'),
  menuStash: $('menu-stash'), btnStart: $('btn-start'),
  deathCause: $('death-cause'), deathLoot: $('death-loot'),
  extractStats: $('extract-stats'), extractLoot: $('extract-loot'),
  scopeOverlay: $('scope-overlay'),
};

// ---------- 모바일 감지 ----------
const IS_MOBILE = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (IS_MOBILE) document.body.classList.add('mobile');

// ---------- 렌더러 / 씬 ----------
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.5 : 2)); // 모바일 성능 캡
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xaeb6bd, 45, 210);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';

// ---------- 하늘 (그라데이션 + 태양 글로우 + 드리프트 구름) ----------
const SUN_DIR = new THREE.Vector3(-60, 55, -30).normalize();
const skyUniforms = {
  uSunDir: { value: SUN_DIR },
  uTime: { value: 0 },
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: skyUniforms,
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vDir;
    uniform vec3 uSunDir;
    uniform float uTime;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { return 0.65 * noise(p) + 0.35 * noise(p * 2.3 + 7.3); }
    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.05, 1.0);
      // 상공 짙은 청회색 → 수평선 밝은 헤이즈
      vec3 top = vec3(0.30, 0.41, 0.56);
      vec3 mid = vec3(0.60, 0.69, 0.78);
      vec3 hor = vec3(0.84, 0.85, 0.83);
      vec3 col = mix(mid, top, smoothstep(0.08, 0.6, h));
      col = mix(hor, col, smoothstep(0.0, 0.12, h));
      // 태양 디스크 + 웜톤 할로
      float s = max(dot(d, uSunDir), 0.0);
      col += vec3(1.0, 0.85, 0.60) * pow(s, 600.0) * 3.0;
      col += vec3(1.0, 0.75, 0.45) * pow(s, 24.0) * 0.35;
      col += vec3(0.90, 0.65, 0.40) * pow(s, 4.0) * 0.12;
      // 구름: 방향을 평면 투영해 fbm, 수평선 근처 감쇠, 천천히 드리프트
      if (d.y > 0.02) {
        vec2 uv = d.xz / (d.y + 0.18) * 0.9 + vec2(uTime * 0.004, uTime * 0.0016);
        float c = fbm(uv);
        float cov = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.2, d.y);
        vec3 cloudCol = vec3(0.97, 0.96, 0.94) * (0.8 + 0.2 * s);
        col = mix(col, cloudCol, cov * 0.55);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(360, 24, 12), skyMat);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

// 하늘 기반 환경맵(IBL) — 금속/표면에 은은한 반사·주변광
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), skyMat);
  envScene.add(envSky);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.22;
  pmrem.dispose();
}

const hemi = new THREE.HemisphereLight(0xb8cbdc, 0x54483a, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffdca6, 2.8);
sun.position.set(-60, 55, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_MOBILE ? 2048 : 4096, IS_MOBILE ? 2048 : 4096);
sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0005;
sun.shadow.radius = 3; // PCFSoft 소프트닝
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
// 역광 필 — 음영면이 새까맣게 죽지 않게 반대편에서 차가운 약광 (그림자 없음)
const fill = new THREE.DirectionalLight(0x9fb6cc, 0.32);
fill.position.set(55, 28, 40);
scene.add(fill);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ============================================================
// 에셋 (Kenney / Quaternius CC0 — CREDITS.md 참조)
// ============================================================
const ASSETS = {};   // key → gltf
const GROUND_TEX = {}; // ground/gravel 컬러맵 (없으면 절차 생성 폴백)
const BUILD_TEX = {};  // 건축 PBR 텍스처 (#107, ambientCG CC0) — key: { col, nrm }
const CHAR_CLIPS = {}; // key(girl*) → { idle, run, death, hitChest, hitHead }
// VRoid CC0 샘플 (OpenGameArt) → convert_vrm_girl.py 변환. 개체마다 랜덤 선택
const GIRL_KEYS = ['girlA', 'girlB', 'girlC', 'girlD'];
let assetsReady = false;

const GLB_MANIFEST = {
  girlA: 'assets/girls/girlA.glb',
  girlB: 'assets/girls/girlB.glb',
  girlC: 'assets/girls/girlC.glb',
  girlD: 'assets/girls/girlD.glb',
  rifle: 'assets/rifle.glb',
  smg: 'assets/smg.glb',
  shotgun: 'assets/shotgun.glb',
  sniper: 'assets/sniper.glb',
  smg2: 'assets/smg2.glb',
  bullpup: 'assets/bullpup.glb',
  revolver: 'assets/revolver.glb',
  attScope: 'assets/att_scope.glb',
  attSilencer: 'assets/att_silencer.glb',
  attGrip: 'assets/att_grip.glb',
  propDumpster: 'assets/env/city/prop_dumpster.glb',
  propAcunit: 'assets/env/city/prop_acunit.glb',
  propWatertower: 'assets/env/city/prop_watertower.glb',
  propBench: 'assets/env/city/prop_bench.glb',
  buildingA: 'assets/env/industrial/building-a.glb',
  buildingE: 'assets/env/industrial/building-e.glb',
  buildingH: 'assets/env/industrial/building-h.glb',
  buildingM: 'assets/env/industrial/building-m.glb',
  buildingQ: 'assets/env/industrial/building-q.glb',
  tank: 'assets/env/industrial/detail-tank.glb',
  chimney: 'assets/env/industrial/chimney-large.glb',
  box: 'assets/env/survival/box.glb',
  barrel: 'assets/env/survival/barrel.glb',
  crate: 'assets/env/blaster/crate-medium.glb',
  crateWide: 'assets/env/blaster/crate-wide.glb',
  treePineA: 'assets/env/nature/tree_pineDefaultA.glb',
  treePineB: 'assets/env/nature/tree_pineDefaultB.glb',
  treeOak: 'assets/env/nature/tree_default.glb',
  rock: 'assets/env/nature/rock_largeA.glb',
  buildingB: 'assets/env/industrial/building-b.glb',
  buildingF: 'assets/env/industrial/building-f.glb',
  buildingG: 'assets/env/industrial/building-g.glb',
  buildingN: 'assets/env/industrial/building-n.glb',
  chimneyMed: 'assets/env/industrial/chimney-medium.glb',
  chimneySmall: 'assets/env/industrial/chimney-small.glb',
  fence: 'assets/env/survival/fence.glb',
  fenceFort: 'assets/env/survival/fence-fortified.glb',
  fenceDoor: 'assets/env/survival/fence-doorway.glb',
  tent: 'assets/env/survival/tent.glb',
  campfire: 'assets/env/survival/campfire-pit.glb',
  metalPanel: 'assets/env/survival/metal-panel.glb',
  boxLarge: 'assets/env/survival/box-large.glb',
  grassPatch: 'assets/env/survival/patch-grass-large.glb',
  grassTuft: 'assets/env/survival/grass-large.glb',
  carVan: 'assets/env/cars/van.glb',
  carTruck: 'assets/env/cars/truck-flat.glb',
  carSedan: 'assets/env/cars/sedan.glb',
  carSuv: 'assets/env/cars/suv.glb',
  carDelivery: 'assets/env/cars/delivery-flat.glb',
  carTire: 'assets/env/cars/debris-tire.glb',
};

// ── 로딩 진행 바 ──
// path → { loaded, total, done } (total 은 Content-Length 없으면 0)
const loadProgress = {};
function updateLoadUI() {
  const entries = Object.values(loadProgress);
  if (!entries.length) return;
  // 파일별 진행률 평균 (바이트 미상 파일은 완료 여부로만 계산)
  let sum = 0;
  for (const p of entries) sum += p.done ? 1 : (p.total > 0 ? Math.min(1, p.loaded / p.total) : 0);
  const pct = Math.round((sum / entries.length) * 100);
  const fill = document.getElementById('load-fill');
  const label = document.getElementById('load-label');
  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = `에셋 로딩 중... ${pct}%`;
}
function hideLoadUI() {
  const el = document.getElementById('load-progress');
  if (el) el.style.display = 'none';
}

async function loadAssets() {
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  // WLAN 등에서 큰 GLB 다운로드가 간헐 실패할 수 있어 재시도 (백오프)
  const RETRIES = 3;
  const withRetry = (fn, path) => new Promise((res, rej) => {
    loadProgress[path] = { loaded: 0, total: 0, done: false };
    const attempt = (left) => fn(
      path,
      (result) => { loadProgress[path].done = true; updateLoadUI(); res(result); },
      (ev) => {
        if (ev && ev.lengthComputable !== false && ev.total) {
          loadProgress[path].loaded = ev.loaded;
          loadProgress[path].total = ev.total;
        }
        updateLoadUI();
      },
      (err) => {
        if (left > 1) {
          console.warn(`로드 재시도 (${RETRIES - left + 2}/${RETRIES}):`, path);
          loadProgress[path].loaded = 0;
          setTimeout(() => attempt(left - 1), 700);
        } else rej(err);
      },
    );
    attempt(RETRIES);
  });
  const loadGlb = (path) => withRetry((p, ok, prog, fail) => loader.load(p, ok, prog, fail), path);
  const loadTex = (path) => withRetry((p, ok, prog, fail) => texLoader.load(p, ok, prog, fail), path);

  const jobs = Object.entries(GLB_MANIFEST).map(async ([key, path]) => {
    const gltf = await loadGlb(path);
    const isGirl = GIRL_KEYS.includes(key);
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && !isGirl) {
          // 일부 에셋이 alphaMode:MASK + alpha 0 으로 나와 전부 투명해짐 → 불투명 강제
          // (VRoid 캐릭터는 알파를 실제로 사용하므로 제외)
          o.material.alphaTest = 0; o.material.transparent = false; o.material.opacity = 1;
        }
        if (o.material && isGirl && o.material.transparent) {
          // 반투명(BLEND) 파츠는 컷아웃으로 — 헤어/속눈썹 소팅 아티팩트 방지
          o.material.transparent = false;
          o.material.alphaTest = 0.35;
          o.material.depthWrite = true;
        }
      }
    });
    ASSETS[key] = gltf;
  });
  // 지면 PBR 컬러맵 (ambientCG CC0) — 실패해도 절차 생성 텍스처로 폴백
  jobs.push(...[['ground', 'assets/textures/ground.jpg'], ['gravel', 'assets/textures/gravel.jpg']].map(async ([key, path]) => {
    try {
      const t = await loadTex(path);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      GROUND_TEX[key] = t;
    } catch { /* 폴백 */ }
  }));
  // 건축 PBR 텍스처 (#107) — 실패 시 해당 재질만 단색 폴백
  for (const key of ['brick', 'plaster', 'rooftile', 'corrugated', 'woodfloor', 'concrete']) {
    jobs.push((async () => {
      try {
        const [col, nrm] = await Promise.all([
          loadTex(`assets/textures/${key}_col.jpg`),
          loadTex(`assets/textures/${key}_nrm.jpg`),
        ]);
        for (const t of [col, nrm]) {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        }
        col.colorSpace = THREE.SRGBColorSpace; // 노멀맵은 linear 유지
        BUILD_TEX[key] = { col, nrm };
      } catch { /* 폴백 */ }
    })());
  }
  await Promise.all(jobs);

  // UAL 리타게팅 클립은 클린 루프라 트리밍 불필요
  for (const key of GIRL_KEYS) {
    const clips = ASSETS[key].animations;
    const idle = clips.find((c) => /^idle/i.test(c.name) && c.duration > 0.5) || null;
    const run = clips.find((c) => /^run/i.test(c.name) && c.duration > 0.3) || null;
    const death = clips.find((c) => /^death/i.test(c.name)) || null;
    const hitChest = clips.find((c) => /^hitchest/i.test(c.name)) || null;
    const hitHead = clips.find((c) => /^hithead/i.test(c.name)) || null;
    const shoot = clips.find((c) => /^shoot/i.test(c.name)) || null;
    const reload = clips.find((c) => /^reload/i.test(c.name)) || null;
    const crouchIdle = clips.find((c) => /^crouchidle/i.test(c.name)) || null;
    const roll = clips.find((c) => /^roll/i.test(c.name)) || null;
    const aimUpRaw = clips.find((c) => /^aimup/i.test(c.name)) || null;
    const aimDownRaw = clips.find((c) => /^aimdown/i.test(c.name)) || null;
    const aimNeutral = clips.find((c) => /^aimneutral/i.test(c.name)) || null;
    const walkC = clips.find((c) => /^walk/i.test(c.name)) || null;
    const limp = clips.find((c) => /^limp/i.test(c.name)) || null;
    const alert = clips.find((c) => /^alert/i.test(c.name)) || null;
    // 리타게팅 export 시 180°(w≈0) 부근 회전의 쿼터니언 부호(±q)가 프레임 간
    // 뒤집힐 수 있음 → 보간 시 관절이 꺾임. 부호 연속성 복구.
    for (const c of [idle, run, death, hitChest, hitHead, shoot, reload,
      crouchIdle, roll, aimUpRaw, aimDownRaw, aimNeutral, walkC, limp, alert]) fixQuatContinuity(c);
    // 고저차 조준: Aim_Up/Down 을 Neutral 기준 additive 로 변환 —
    // 어떤 기본 모션 위에도 가중치로 얹을 수 있음.
    // 주의: glTF 는 상수 트랙(scale 1 등)의 accessor 를 클립 간 공유하므로
    // 반드시 clone() 후 변형할 것 — 제자리 변형하면 Idle 등 다른 클립까지 오염됨
    let aimUp = null, aimDown = null;
    if (aimNeutral) {
      if (aimUpRaw) aimUp = THREE.AnimationUtils.makeClipAdditive(aimUpRaw.clone(), 0, aimNeutral);
      if (aimDownRaw) aimDown = THREE.AnimationUtils.makeClipAdditive(aimDownRaw.clone(), 0, aimNeutral);
    }
    CHAR_CLIPS[key] = { idle, run, death, hitChest, hitHead, shoot, reload, crouchIdle, roll, aimUp, aimDown, walk: walkC, limp, alert };
  }

  buildViewmodel();
  assetsReady = true;
  hideLoadUI();
  dom.btnStart.disabled = false;
  dom.btnStart.textContent = '레이드 시작';
}

function instantiate(key) {
  return ASSETS[key].scene.clone(true);
}

function fixQuatContinuity(clip) {
  if (!clip) return;
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.quaternion')) continue;
    const v = t.values;
    for (let i = 4; i < v.length; i += 4) {
      const dot = v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1];
      if (dot < 0) { v[i] *= -1; v[i + 1] *= -1; v[i + 2] *= -1; v[i + 3] *= -1; }
    }
  }
}


// ── 지형 하이트필드 (#50) ──
// 결정적 value noise 구릉 + 구조물/야적장/탈출구 플래튼 존 + 맵 가장자리 평탄화.
// 배치·물리·렌더가 전부 terrainH 하나를 공유한다.
function vhash(ix, iz) {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return (vhash(ix, iz) * (1 - ux) + vhash(ix + 1, iz) * ux) * (1 - uz)
       + (vhash(ix, iz + 1) * (1 - ux) + vhash(ix + 1, iz + 1) * ux) * uz;
}
// 평탄 유지 구역: r = 원형 반경, hw/hd = 사각 반폭
const FLATTENS = [
  { x: 16, z: -6, hw: 26, hd: 21 },   // 컨테이너 야적장
  { x: 32, z: 34, hw: 19, hd: 16 },   // buildingA 앞마당
  { x: -30, z: -20, hw: 22, hd: 17 }, // 중앙 창고
  { x: -58, z: 4, hw: 9, hd: 8 },     // 리얼 주택 A (#107)
  { x: -47, z: 16, hw: 9, hd: 8 },    // 리얼 주택 B
  ...[
    [30, 32, 12], [44, -32, 10], [-48, 42, 9], [8, 55, 11], [-62, -56, 11],
    [58, 62, 9], [-44, -28, 7], [-10, -66, 10], [66, -12, 9], [-34, 64, 10],
    [-70, 34, 9], [-6, -60, 7],           // 건물/굴뚝
    [-60, 62, 7], [66, -62, 7],           // 야영지
    [76, -76, 7], [-76, 76, 7], [76, 76, 7], [-76, -76, 7], // 탈출구
    [24, -58, 7],   // 감시탑
    [56, 44, 8],    // 2층 게스트하우스
  ].map(([x, z, r]) => ({ x, z, r })),
];
const FLAT_BLEND = 9;
function terrainH(x, z) {
  let base = vnoise(x * 0.021, z * 0.021) * 4.0 + vnoise(x * 0.055 + 31, z * 0.055 + 17) * 0.9;
  let h = Math.max(0, base - 1.15); // 저지대는 0, 구릉 최대 ~3.4m
  // 플래튼 존
  let k = 1;
  for (const f of FLATTENS) {
    let d;
    if (f.r !== undefined) {
      d = Math.hypot(x - f.x, z - f.z) - f.r;
    } else {
      const dx = Math.max(Math.abs(x - f.x) - f.hw, 0);
      const dz = Math.max(Math.abs(z - f.z) - f.hd, 0);
      d = Math.hypot(dx, dz);
    }
    if (d <= 0) return 0;
    k = Math.min(k, Math.min(1, d / FLAT_BLEND));
  }
  // 외곽 벽 근처 평탄화
  const edge = Math.min(1, Math.max(0, (WORLD_HALF - 3 - Math.max(Math.abs(x), Math.abs(z))) / 12));
  k = Math.min(k, edge);
  k = k * k * (3 - 2 * k);
  return h * k;
}

// ── 충돌체: yaw 정렬 OBB { cx, cz, c, s, hx, hz, minY, maxY } ──
// AABB 대신 배치 회전(rotY)에 정렬된 박스를 쓰고, 키 큰 모델은 지상부
// (FOOT_CUTOFF 미만) 정점만으로 수평 범위를 잡아 지붕 처마 등 상부 돌출이
// 투명벽을 만들지 않게 한다. (#41)
const FOOT_CUTOFF = 2.2;
function axisCollider(x0, x1, y0, y1, z0, z1) {
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, c: 1, s: 0, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, minY: y0, maxY: y1 };
}
function colliderFromModel(m, x, z, rotY, groundY = 0) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;       // 전체
  let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;   // 지상부
  m.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      o.localToWorld(v);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      const dx = v.x - x, dz = v.z - z;
      const lx = c * dx - s * dz, lz = s * dx + c * dz; // 월드→yaw 로컬
      x0 = Math.min(x0, lx); x1 = Math.max(x1, lx);
      z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
      if (v.y < groundY + FOOT_CUTOFF) {
        fx0 = Math.min(fx0, lx); fx1 = Math.max(fx1, lx);
        fz0 = Math.min(fz0, lz); fz1 = Math.max(fz1, lz);
      }
    }
  });
  // 키 큰 모델(건물 등)은 지상부 풋프린트로 수평 범위 산출
  const useFoot = (maxY - minY) > 3 && fx0 < Infinity;
  const bx0 = useFoot ? fx0 : x0, bx1 = useFoot ? fx1 : x1;
  const bz0 = useFoot ? fz0 : z0, bz1 = useFoot ? fz1 : z1;
  const lcx = (bx0 + bx1) / 2, lcz = (bz0 + bz1) / 2;
  return {
    cx: x + c * lcx + s * lcz, cz: z - s * lcx + c * lcz,
    c, s, hx: (bx1 - bx0) / 2, hz: (bz1 - bz0) / 2, minY, maxY,
  };
}

// GLB 모델 배치: height 로 정규화 → 바닥 정렬 → 충돌/차폐 등록
function placeModel(key, x, z, { rotY = 0, height = null, width = null, collide = true, block = true } = {}) {
  const m = instantiate(key);
  if (height) {
    const bb0 = new THREE.Box3().setFromObject(m);
    m.scale.setScalar(height / Math.max(0.001, bb0.max.y - bb0.min.y));
  } else if (width) {
    // 납작한 모델(풀/타이어 등)은 세로가 아닌 수평 최장축 기준
    const bb0 = new THREE.Box3().setFromObject(m);
    const w = Math.max(bb0.max.x - bb0.min.x, bb0.max.z - bb0.min.z);
    m.scale.setScalar(width / Math.max(0.001, w));
  }
  m.rotation.y = rotY;
  m.position.set(x, 0, z);
  scene.add(m);
  m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(m);
  const gy = terrainH(x, z);
  m.position.y = gy - bb.min.y; // 지형 높이에 바닥 정렬
  m.updateMatrixWorld(true);
  if (collide) colliders.push(colliderFromModel(m, x, z, rotY, gy));
  if (block) m.traverse((o) => { if (o.isMesh) obstacleMeshes.push(o); });
  return m;
}

// 나무: 시야/총알은 잎까지 차단, 이동 충돌은 줄기만
function placeTree(key, x, z, height) {
  const m = placeModel(key, x, z, { height, collide: false, block: true, rotY: Math.random() * Math.PI * 2 });
  const gy = terrainH(x, z);
  colliders.push(axisCollider(x - 0.35, x + 0.35, gy, gy + 3, z - 0.35, z + 0.35));
  return m;
}

// ---------- 전역 상태 ----------
const state = {
  phase: 'menu',          // menu | raid | dead | extracted
  paused: false,
  raidTime: RAID_SECONDS,
  kills: 0,
  pointerLocked: false,
};

const player = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  grounded: false,
  hp: PLAYER.maxHp,
  stamina: 100,
  sprinting: false,
  aiming: false,
  healCooldown: 0,
  armorDur: 0,   // 방탄복 내구도 (0 = 미착용/파손)
  helmet: false, // 헬멧 (헤드샷 1회 방어)
};

const gun = {
  mag: GUN.magSize,
  reserve: 90,
  cooldown: 0,
  reloading: 0,
  triggerDown: false,
  recoil: 0,
  swayX: 0, swayY: 0,   // 시선 이동에 따른 뷰모델 끌림
  sprintBlend: 0,       // 0=조준 자세, 1=스프린트 내림 자세
  semiLatch: false,     // 단발 무기 클릭당 1발
  foundWeapons: [],     // 레이드 중 습득 무기들 (탈출 시 소유 확정)
};

let inventory = [];       // {name, value, heal?}
let carry = [];           // 이번 레이드 휴대 무기 키 목록 (1/2/3 키 순)
const weaponAmmo = {};    // 무기별 탄약 상태 { key: { mag, reserve } }
let colliders = [];       // yaw 정렬 OBB { cx, cz, c, s, hx, hz, minY, maxY }
let obstacleMeshes = [];  // LOS/총알 차단용
let enemies = [];
let interactables = [];   // {pos, mesh, items, opened, label}
let extractions = [];     // {pos, mesh, ring}
let tracers = [];         // {line, life}
let flashes = [];         // {light, sprite?, life}
let corpses = [];

const keys = {};

// ---------- 스태시 (영구 저장) ----------
function loadStash() {
  try { return JSON.parse(localStorage.getItem('exshoot_stash')) || {}; }
  catch { return {}; }
}
function saveStash(s) { localStorage.setItem('exshoot_stash', JSON.stringify(s)); }
function updateMenuStash() {
  const s = loadStash();
  const r = s.roubles || 0, raids = s.raids || 0, ext = s.extracts || 0;
  dom.menuStash.textContent =
    `스태시 ₽ ${r.toLocaleString('ko-KR')} · 레이드 ${raids}회 · 생존 ${ext}회 · 누적 사살 ${s.kills || 0}`;
  renderShop();
}

// ---------- 장비 상점 (메뉴) ----------
const WEAPON_DESC = {
  rifle: '자동 · 표준 탄퍼짐 · 기본 지급',
  revolver: '단발 고데미지 · 6발 · 입문 업그레이드',
  smg2: '고연사 · 저데미지 · 근중거리',
  shotgun: '8펠릿 · 근거리 고화력 · 단발',
  bullpup: '자동 · 고성능 만능형',
  sniper: '고데미지 · 강줌 · 볼트액션',
};
function renderShop() {
  const el = document.getElementById('shop');
  if (!el) return;
  const s = loadStash();
  const roubles = s.roubles || 0;
  const owned = s.weapons || ['rifle'];
  const equipped = (s.equipped && owned.includes(s.equipped)) ? s.equipped : 'rifle';
  let html = '<h3>장비 — 사망 시 구매 장비를 잃습니다</h3>';
  for (const w of Object.values(WEAPONS)) {
    const own = owned.includes(w.key);
    let right;
    if (own && equipped === w.key) right = '<span class="equipped">장착 중</span>';
    else if (own) right = `<button data-equip="${w.key}">장착</button>`;
    else right = `<button data-buy="${w.key}" ${roubles < w.price ? 'disabled' : ''}>구매 ₽${w.price.toLocaleString('ko-KR')}</button>`;
    html += `<div class="shop-row"><div><div class="w-name">${w.name}</div><div class="w-desc">${WEAPON_DESC[w.key]}</div></div>${right}</div>`;
  }
  const dur = Math.round(s.armorDur || 0);
  const armorRight = dur >= ARMOR_MAX
    ? '<span class="equipped">착용 중</span>'
    : `<button data-armor="1" ${roubles < 45000 ? 'disabled' : ''}>${dur > 0 ? '교체' : '구매'} ₽45,000</button>`;
  html += `<div class="shop-row"><div><div class="w-name">방탄복${dur > 0 ? ` (내구도 ${dur}/${ARMOR_MAX})` : ''}</div><div class="w-desc">몸 피격 데미지 45% 경감 · 내구도 소모</div></div>${armorRight}</div>`;
  const helmetRight = s.helmet
    ? '<span class="equipped">착용 중</span>'
    : `<button data-helmet="1" ${roubles < 28000 ? 'disabled' : ''}>구매 ₽28,000</button>`;
  html += `<div class="shop-row"><div><div class="w-name">헬멧</div><div class="w-desc">헤드샷 1회 완전 방어 후 파손</div></div>${helmetRight}</div>`;
  const meds = s.medkits || 0;
  html += `<div class="shop-row"><div><div class="w-name">구급킷 지참 (${meds}/2)</div><div class="w-desc">+60 HP · 다음 레이드 반입, 사망 시 손실</div></div>` +
    `<button data-med="1" ${roubles < 14000 || meds >= 2 ? 'disabled' : ''}>구매 ₽14,000</button></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    const w = WEAPONS[b.dataset.buy];
    if ((st.roubles || 0) < w.price) return;
    st.roubles -= w.price;
    st.weapons = [...new Set([...(st.weapons || ['rifle']), w.key])];
    st.equipped = w.key;
    saveStash(st);
    sfx.pickup();
    updateMenuStash();
  }));
  el.querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    st.equipped = b.dataset.equip;
    saveStash(st);
    sfx.reload2();
    updateMenuStash();
  }));
  el.querySelectorAll('[data-armor]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    if ((st.roubles || 0) < 45000) return;
    st.roubles -= 45000;
    st.armorDur = ARMOR_MAX;
    saveStash(st);
    sfx.pickup();
    updateMenuStash();
  }));
  el.querySelectorAll('[data-helmet]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    if ((st.roubles || 0) < 28000 || st.helmet) return;
    st.roubles -= 28000;
    st.helmet = true;
    saveStash(st);
    sfx.pickup();
    updateMenuStash();
  }));
  el.querySelectorAll('[data-med]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    if ((st.roubles || 0) < 14000 || (st.medkits || 0) >= 2) return;
    st.roubles -= 14000;
    st.medkits = (st.medkits || 0) + 1;
    saveStash(st);
    sfx.pickup();
    updateMenuStash();
  }));
}

// ---------- 장비 커스텀 화면 ----------
let equipRenderer = null, equipScene = null, equipCam = null, equipModel = null, equipRAF = 0;
let equipSel = 'rifle';

function equipStatText(w, atts) {
  const scope = atts.includes('scope'), grip = atts.includes('grip'), sil = atts.includes('silencer');
  const fov = Math.round(w.adsFov * (scope ? 0.55 : 1));
  const rec = (w.recoil * (grip ? 0.6 : 1)).toFixed(2);
  return `<b>${w.name}</b> — 데미지 ${w.damageBody}/${w.damageHead} · 연사 ${(1 / w.fireInterval).toFixed(1)}발/s · 탄창 ${w.magSize}<br>` +
    `조준 FOV ${fov}${scope ? ' <span class="mod">(스코프)</span>' : ''} · 반동 ${rec}${grip ? ' <span class="mod">(그립)</span>' : ''} · ` +
    `사격 시 감지 ${sil ? '<span class="mod">16m (소음기)</span>' : '60m'}`;
}

function equipBuildPreview() {
  if (!equipScene) return;
  if (equipModel) { equipScene.remove(equipModel); equipModel = null; }
  const w = WEAPONS[equipSel];
  if (!ASSETS[w.model]) return;
  const g = new THREE.Group();
  const m = instantiate(w.model);
  const size = normalizeModel(m, 0.62, Math.PI / 2);
  brightenMaterials(m, 3.2);
  const bb = new THREE.Box3().setFromObject(m);
  const atts = attLoadout(equipSel);
  for (const ak of atts) attachToGun(m, size, bb, ak);
  g.add(m);
  equipModel = g;
  equipScene.add(g);
}

function equipRender() {
  if (!equipRenderer) return;
  equipModel && (equipModel.rotation.y += 0.011);
  equipRenderer.render(equipScene, equipCam);
  equipRAF = requestAnimationFrame(equipRender);
}

function renderEquipUI() {
  const st = loadStash();
  const owned = st.weapons || ['rifle'];
  if (!owned.includes(equipSel)) equipSel = 'rifle';
  const wl = $('equip-weapons');
  wl.innerHTML = '';
  for (const w of Object.values(WEAPONS)) {
    if (!owned.includes(w.key)) continue;
    const b = document.createElement('button');
    b.textContent = w.name;
    if (w.key === equipSel) b.classList.add('sel');
    b.addEventListener('click', () => { equipSel = w.key; renderEquipUI(); });
    wl.appendChild(b);
  }
  const atts = attLoadout(equipSel);
  $('equip-stats').innerHTML = equipStatText(WEAPONS[equipSel], atts);
  const ar = $('equip-atts');
  ar.innerHTML = '';
  const ownedAtt = st.attOwned || [];
  for (const att of Object.values(ATTACHMENTS)) {
    const row = document.createElement('div');
    row.className = 'att-row';
    const compat = att.compat.includes(equipSel);
    let right;
    if (!compat) right = '<span class="incompat">이 무기와 호환 안 됨</span>';
    else if (!ownedAtt.includes(att.key)) {
      right = `<button data-buyatt="${att.key}" ${(st.roubles || 0) < att.price ? 'disabled' : ''}>구매 ₽${att.price.toLocaleString('ko-KR')}</button>`;
    } else {
      const on = atts.includes(att.key);
      right = `<button data-togatt="${att.key}" class="${on ? 'on' : ''}">${on ? '장착 중 — 해제' : '장착'}</button>`;
    }
    row.innerHTML = `<div class="a-name">${att.name}</div><div class="a-desc">${att.desc}</div>${right}`;
    ar.appendChild(row);
  }
  ar.querySelectorAll('[data-buyatt]').forEach((b) => b.addEventListener('click', () => {
    const st2 = loadStash();
    const att = ATTACHMENTS[b.dataset.buyatt];
    if ((st2.roubles || 0) < att.price) return;
    st2.roubles -= att.price;
    st2.attOwned = [...new Set([...(st2.attOwned || []), att.key])];
    st2.attachments = st2.attachments || {};
    st2.attachments[equipSel] = [...new Set([...(st2.attachments[equipSel] || []), att.key])];
    saveStash(st2);
    sfx.pickup();
    updateMenuStash();
    renderEquipUI();
    equipBuildPreview();
  }));
  ar.querySelectorAll('[data-togatt]').forEach((b) => b.addEventListener('click', () => {
    const st2 = loadStash();
    st2.attachments = st2.attachments || {};
    const cur = st2.attachments[equipSel] || [];
    const k = b.dataset.togatt;
    st2.attachments[equipSel] = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    saveStash(st2);
    sfx.reload2();
    renderEquipUI();
    equipBuildPreview();
  }));
  equipBuildPreview();
}

function openEquipScreen() {
  $('equip-screen').style.display = 'flex'; // 먼저 표시 (display:none 상태선 canvas 크기 0)
  const c = $('equip-canvas');
  if (!equipRenderer) {
    equipRenderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    equipRenderer.setSize(c.clientWidth, c.clientHeight, false);
    equipRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    equipRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    equipScene = new THREE.Scene();
    equipScene.add(new THREE.HemisphereLight(0xcfdcec, 0x54483a, 1.4));
    const d = new THREE.DirectionalLight(0xffe0b0, 2.2);
    d.position.set(1, 2, 1.5);
    equipScene.add(d);
    // 리얼 PBR 총기(#101)는 환경맵 없이는 금속면이 검게 나옴 — 하늘 IBL 별도 생성 (renderer 별 GL 컨텍스트라 공유 불가)
    {
      const pm = new THREE.PMREMGenerator(equipRenderer);
      const es = new THREE.Scene();
      es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), skyMat));
      equipScene.environment = pm.fromScene(es, 0.04).texture;
      equipScene.environmentIntensity = 0.55;
      pm.dispose();
    }
    equipCam = new THREE.PerspectiveCamera(34, c.clientWidth / c.clientHeight, 0.01, 10);
    equipCam.position.set(0, 0.12, 0.85);
    equipCam.lookAt(0, 0, 0);
  }
  renderEquipUI();
  cancelAnimationFrame(equipRAF);
  equipRender();
}

// ============================================================
// 오디오 — 프리 에셋 샘플 (Kenney CC0 / OpenGameArt) + 절차 생성 폴백
// ============================================================
let AC = null;
let sfxBus = null;   // 모든 SFX 가 지나는 버스 (드라이 + 리버브 센드)
let wetGain = null;  // 실내 리버브 센드 (indoorK 로 제어)
function makeImpulse(ctx) {
  // 절차 생성 IR: 0.7s 지수 감쇠 스테레오 노이즈 (작은 실내 느낌)
  const len = Math.floor(ctx.sampleRate * 0.7);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / len * 6.5);
  }
  return buf;
}
function audio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    sfxBus = AC.createGain();
    sfxBus.connect(AC.destination);
    const conv = AC.createConvolver();
    conv.buffer = makeImpulse(AC);
    wetGain = AC.createGain();
    wetGain.gain.value = 0;
    sfxBus.connect(wetGain);
    wetGain.connect(conv);
    conv.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

// 사운드 이름 → 샘플 파일 목록 (여러 개면 재생 시 랜덤 선택)
const SFX_FILES = {
  shoot: ['sks_0.wav', 'sks_1.wav'], // sks_2 는 원본이 속사 구간이라 단발 추출 불가 → 제외
  enemyShoot: ['cz_0.wav', 'cz_1.wav'],
  stepConcrete: [0, 1, 2, 3, 4].map((i) => `footstep_concrete_00${i}.ogg`),
  stepGrass: [0, 1, 2, 3, 4].map((i) => `footstep_grass_00${i}.ogg`),
  hitmarker: ['impactGeneric_light_000.ogg', 'impactGeneric_light_001.ogg', 'impactGeneric_light_002.ogg'],
  playerHit: ['impactPunch_heavy_000.ogg', 'impactPunch_heavy_001.ogg', 'impactPunch_heavy_002.ogg'],
  bodyFall: ['impactSoft_heavy_000.ogg', 'impactSoft_heavy_001.ogg', 'impactSoft_heavy_002.ogg'],
  land: ['impactSoft_medium_000.ogg'],
  magOut: ['beltHandle1.ogg'],
  magIn: ['metalLatch.ogg'],
  click: ['metalClick.ogg'],
  loot: ['handleSmallLeather.ogg', 'handleSmallLeather2.ogg'],
  coins: ['handleCoins.ogg'],
  heal: ['cloth2.ogg', 'cloth3.ogg'],
  tick: ['tick_001.ogg'],
  confirm: ['confirmation_001.ogg'],
  deathBoom: ['lowFrequency_explosion_000.ogg'],
};
const AB = {}; // name -> AudioBuffer[]
async function loadAudio() {
  const ctx = audio();
  await Promise.all(Object.entries(SFX_FILES).map(async ([name, files]) => {
    const bufs = await Promise.all(files.map(async (f) => {
      try {
        const res = await fetch(`assets/audio/${f}`);
        if (!res.ok) return null;
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch { return null; } // 디코드 실패(브라우저 미지원 등) → 절차 생성 폴백
    }));
    const ok = bufs.filter(Boolean);
    if (ok.length) AB[name] = ok;
  }));
}

// 샘플 재생. 버퍼가 없으면 false 반환 → 호출측 절차 생성 폴백
function playBuf(name, { vol = 1, rate = 1, jitter = 0.06, lp = 0, delay = 0 } = {}) {
  const list = AB[name];
  if (!list || !list.length) return false;
  const ctx = audio();
  const src = ctx.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = rate * (1 - jitter + Math.random() * jitter * 2);
  let node = src;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp;
    node.connect(f); node = f;
  }
  const g = ctx.createGain();
  g.gain.value = vol;
  node.connect(g).connect(sfxBus);
  src.start(ctx.currentTime + delay);
  return true;
}

// 야외 바람 앰비언스 (절차 생성 루프 — 레이드 중에만)
let ambient = null;
function ambientStart() {
  const ctx = audio();
  if (ambient) return;
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 0.4;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 130;
  lfo.connect(lfoGain).connect(f.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 2.5);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(); lfo.start();
  ambient = { src, lfo, g };
}
function ambientStop() {
  if (!ambient) return;
  const ctx = audio();
  const { src, lfo, g } = ambient;
  ambient = null;
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
  setTimeout(() => { try { src.stop(); lfo.stop(); } catch {} }, 1400);
}
// 실내 구역 (사무동 / 게스트하우스 1층 / 중앙 창고) — 리버브·바람 덕킹용
const INDOOR_RECTS = [
  { x: -14, z: -32, hw: 6, hd: 4.5 },
  { x: -58, z: 4, hw: 4.3, hd: 3.3 },  // 리얼 주택 A (#107)
  { x: -47, z: 16, hw: 4.3, hd: 3.3 }, // 리얼 주택 B
  { x: 56, z: 44, hw: 5, hd: 4 },
  { x: -28, z: -18, hw: 13, hd: 7.5 },
];
let indoorK = 0;
function updateAcoustics(dt) {
  const p = player.pos;
  const inside = INDOOR_RECTS.some((r) => Math.abs(p.x - r.x) < r.hw && Math.abs(p.z - r.z) < r.hd && p.y < 3) ? 1 : 0;
  indoorK += (inside - indoorK) * Math.min(1, dt * 4);
  if (wetGain) wetGain.gain.value = indoorK * 0.42;
  if (ambient) ambient.g.gain.value = 0.045 * (1 - indoorK * 0.65);
}


function noiseBurst({ dur = 0.15, freq = 900, q = 0.7, gain = 0.5, type = 'lowpass', decay = 30 }) {
  const ctx = audio();
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / len * decay);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(sfxBus);
  src.start();
}
function tone({ freq = 600, dur = 0.1, gain = 0.15, type = 'sine', slide = 0 }) {
  const ctx = audio();
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(sfxBus);
  o.start(); o.stop(ctx.currentTime + dur);
}
const sfx = {
  shoot() {
    const sil = currentAtt.includes('silencer');
    if (!playBuf('shoot', { vol: GUN.sfxVol * (sil ? 0.32 : 1), rate: GUN.sfxRate * (sil ? 1.06 : 1), lp: sil ? 1600 : 0, jitter: 0.04 })) {
      noiseBurst({ dur: 0.14, freq: 1400, gain: 0.35, decay: 22 });
      tone({ freq: 160, dur: 0.07, gain: 0.25, type: 'square', slide: -120 });
    }
  },
  enemyShoot(dist) {
    const v = Math.max(0.03, 0.5 - dist * 0.0075);
    // 거리 감쇠 + 저역 통과: 멀수록 먹먹하게
    if (!playBuf('enemyShoot', { vol: v, lp: Math.max(500, 4500 - dist * 45) })) {
      noiseBurst({ dur: 0.18, freq: Math.max(300, 1100 - dist * 8), gain: v, decay: 18 });
    }
  },
  footstep(sprinting, onStructure) {
    playBuf(onStructure ? 'stepConcrete' : 'stepGrass', { vol: sprinting ? 0.34 : 0.19, jitter: 0.1 });
  },
  land() { playBuf('land', { vol: 0.35 }); },
  hitmarker() {
    if (!playBuf('hitmarker', { vol: 0.28, rate: 1.35 })) tone({ freq: 1500, dur: 0.05, gain: 0.12, type: 'triangle' });
  },
  playerHit() {
    if (!playBuf('playerHit', { vol: 0.55 })) {
      noiseBurst({ dur: 0.12, freq: 350, gain: 0.4, decay: 14 });
      tone({ freq: 90, dur: 0.15, gain: 0.3, type: 'sine', slide: -40 });
    }
  },
  reload1() {
    if (!playBuf('magOut', { vol: 0.5 })) tone({ freq: 420, dur: 0.06, gain: 0.15, type: 'square' });
  },
  reload2() {
    if (!playBuf('magIn', { vol: 0.55 })) tone({ freq: 620, dur: 0.06, gain: 0.15, type: 'square' });
  },
  pickup() {
    if (playBuf('loot', { vol: 0.5 })) playBuf('coins', { vol: 0.3, delay: 0.18 });
    else tone({ freq: 750, dur: 0.08, gain: 0.14, type: 'triangle', slide: 300 });
  },
  heal() {
    if (!playBuf('heal', { vol: 0.55 })) tone({ freq: 500, dur: 0.25, gain: 0.12, type: 'sine', slide: 250 });
  },
  extractTick() {
    if (!playBuf('tick', { vol: 0.35 })) tone({ freq: 950, dur: 0.09, gain: 0.1, type: 'sine' });
  },
  extractDone() {
    if (!playBuf('confirm', { vol: 0.5 })) tone({ freq: 700, dur: 0.4, gain: 0.16, type: 'sine', slide: 500 });
  },
  enemyDeath() {
    if (!playBuf('bodyFall', { vol: 0.45, rate: 0.85 })) noiseBurst({ dur: 0.25, freq: 250, gain: 0.3, decay: 10 });
  },
  dryFire() {
    if (!playBuf('click', { vol: 0.3, rate: 1.3 })) tone({ freq: 900, dur: 0.04, gain: 0.1, type: 'square' });
  },
  death() {
    playBuf('deathBoom', { vol: 0.6, rate: 0.8 });
    tone({ freq: 220, dur: 1.2, gain: 0.2, type: 'sawtooth', slide: -180 });
  },
};

// ============================================================
// 맵 생성
// ============================================================
const MAT = {
  concrete: new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.95 }),
  concreteDark: new THREE.MeshStandardMaterial({ color: 0x5f5c52, roughness: 0.95 }),
  brick: new THREE.MeshStandardMaterial({ color: 0x7d5a45, roughness: 0.9 }),
  metalRed: new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.6, metalness: 0.3 }),
  metalBlue: new THREE.MeshStandardMaterial({ color: 0x3b566e, roughness: 0.6, metalness: 0.3 }),
  metalGreen: new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 0.6, metalness: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6e5a3e, roughness: 0.9 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x4a3d2a, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x3d4147, roughness: 0.85 }),
  sandbag: new THREE.MeshStandardMaterial({ color: 0x8a7f5f, roughness: 1.0 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x37505f, roughness: 0.55, metalness: 0.4 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x54422e, roughness: 1.0 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x405732, roughness: 1.0 }),
  lootCrate: new THREE.MeshStandardMaterial({ color: 0x5d6b3c, roughness: 0.8 }),
  lootOpened: new THREE.MeshStandardMaterial({ color: 0x33362b, roughness: 0.95 }),
  corpse: new THREE.MeshStandardMaterial({ color: 0x4d4a45, roughness: 1.0 }),
};

// ── 건축 PBR 재질 (#107): BoxGeometry UV 를 월드 미터로 재기록 + repeat=1/타일크기 ──
// [colorTint, roughness, 타일 크기 m, 폴백 MAT]
const TEXMAT_DEF = {
  brick: [0xb8a898, 0.92, 2.4, 'brick'],
  plaster: [0xcfc8ba, 0.95, 2.8, 'concrete'],
  rooftile: [0xcabcb0, 0.85, 1.9, 'roof'],
  corrugated: [0xa8a8a8, 0.6, 1.8, 'metalBlue'],
  woodfloor: [0xb8a488, 0.85, 2.2, 'wood'],
  concrete: [0xb0aca0, 0.95, 2.6, 'concrete'],
};
const TEXMAT = {};
function buildTexMats() {
  for (const [key, [tint, rough, tile, fb]] of Object.entries(TEXMAT_DEF)) {
    if (!BUILD_TEX[key]) { TEXMAT[key] = MAT[fb]; continue; }
    const col = BUILD_TEX[key].col.clone();
    const nrm = BUILD_TEX[key].nrm.clone();
    col.needsUpdate = nrm.needsUpdate = true;
    col.repeat.set(1 / tile, 1 / tile);
    nrm.repeat.set(1 / tile, 1 / tile);
    const m = new THREE.MeshStandardMaterial({ map: col, normalMap: nrm, color: tint, roughness: rough });
    m.userData.worldUV = true;
    TEXMAT[key] = m;
  }
}
function matOf(mat) { return typeof mat === 'string' ? (TEXMAT[mat] || MAT.concrete) : mat; }

// BoxGeometry UV 를 면별 월드 치수(미터)로 — 모든 면 균일 텍셀 밀도
function uvWorldBox(geo, w, h, d, cx = 0, cy = 0, cz = 0) {
  // 면별 [u치수, v치수, u월드오프셋, v월드오프셋] — 분할 벽 세그먼트 간 패턴 연속
  const dims = [
    [d, h, cz - d / 2, cy - h / 2], // +x
    [d, h, cz - d / 2, cy - h / 2], // -x
    [w, d, cx - w / 2, cz - d / 2], // +y
    [w, d, cx - w / 2, cz - d / 2], // -y
    [w, h, cx - w / 2, cy - h / 2], // +z
    [w, h, cx - w / 2, cy - h / 2], // -z
  ];
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [du, dv, ou, ov] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * du + ou, uv.getY(i) * dv + ov);
    }
  }
  uv.needsUpdate = true;
}

function makeGroundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#4d5240'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(60,66,48,0.5)' : v < 0.8 ? 'rgba(90,88,62,0.4)' : 'rgba(72,64,50,0.5)';
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 정적 장애물 박스 하나 추가 (mesh + collider + LOS 차단)
// mat 에 문자열 키('brick' 등)를 주면 월드 UV PBR 재질 (#107)
function addBox(cx, cy, cz, w, h, d, mat, { collide = true, block = true, shadow = true } = {}) {
  mat = matOf(mat);
  const geo = new THREE.BoxGeometry(w, h, d);
  if (mat.userData && mat.userData.worldUV) uvWorldBox(geo, w, h, d, cx, cy, cz);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, cy, cz);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  scene.add(mesh);
  if (collide) colliders.push(axisCollider(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2));
  if (block) obstacleMeshes.push(mesh);
  return mesh;
}

// 문 뚫린 벽 (axis: 'x'면 x방향으로 긴 벽)
function addWallWithDoor(cx, cz, len, h, axis, mat, doorAt = 0, doorW = 2.4) {
  const t = 0.35;
  const half = len / 2;
  const a = -half, b = doorAt - doorW / 2, c2 = doorAt + doorW / 2, e = half;
  const segs = [[a, b], [c2, e]];
  for (const [s0, s1] of segs) {
    const sl = s1 - s0; if (sl < 0.1) continue;
    const mid = (s0 + s1) / 2;
    if (axis === 'x') addBox(cx + mid, h / 2, cz, sl, h, t, mat);
    else addBox(cx, h / 2, cz + mid, t, h, sl, mat);
  }
  // 문 위 상단
  if (axis === 'x') addBox(cx + doorAt, h - 0.35, cz, doorW, 0.7, t, mat);
  else addBox(cx, h - 0.35, cz + doorAt, t, 0.7, doorW, mat);
}

function addWall(cx, cz, len, h, axis, mat) {
  const t = 0.35;
  if (axis === 'x') addBox(cx, h / 2, cz, len, h, t, mat);
  else addBox(cx, h / 2, cz, t, h, len, mat);
}

// 건물: 4벽 + 지붕, 앞/뒤 문
// 창문 뚫린 벽: openings = [{at, w}] (벽 중심 기준 오프셋) — 창턱 1.0m/상인방 2.0m
function addWindowWall(cx, cz, len, h, axis, mat, openings, baseY = 0) {
  const t = 0.35;
  const sillH = 1.0, lintelY = 2.0;
  const half = len / 2;
  // 창턱(아래) / 상인방(위) 전체 길이
  if (axis === 'x') {
    addBox(cx, baseY + sillH / 2, cz, len, sillH, t, mat);
    addBox(cx, baseY + lintelY + (h - lintelY) / 2, cz, len, h - lintelY, t, mat);
  } else {
    addBox(cx, baseY + sillH / 2, cz, t, sillH, len, mat);
    addBox(cx, baseY + lintelY + (h - lintelY) / 2, cz, t, h - lintelY, len, mat);
  }
  // 개구부 사이 중간 기둥 세그먼트
  const edges = [-half, ...openings.flatMap((o) => [o.at - o.w / 2, o.at + o.w / 2]), half];
  for (let i = 0; i < edges.length; i += 2) {
    const s0 = edges[i], s1 = edges[i + 1];
    const sl = s1 - s0;
    if (sl < 0.1) continue;
    const mid = (s0 + s1) / 2;
    if (axis === 'x') addBox(cx + mid, baseY + sillH + (lintelY - sillH) / 2, cz, sl, lintelY - sillH, t, mat);
    else addBox(cx, baseY + sillH + (lintelY - sillH) / 2, cz + mid, t, lintelY - sillH, sl, mat);
  }
}

function addBuilding(cx, cz, w, d, h, mat) {
  addWallWithDoor(cx, cz + d / 2, w, h, 'x', mat, (Math.random() - 0.5) * (w - 4));
  addWallWithDoor(cx, cz - d / 2, w, h, 'x', mat, (Math.random() - 0.5) * (w - 4));
  addWall(cx - w / 2, cz, d, h, 'z', mat);
  addWall(cx + w / 2, cz, d, h, 'z', mat);
  addBox(cx, h + 0.15, cz, w + 0.6, 0.3, d + 0.6, MAT.roof);
}

function addContainer(cx, cz, rot90, mat) {
  const w = rot90 ? 2.5 : 6.5, d = rot90 ? 6.5 : 2.5;
  addBox(cx, terrainH(cx, cz) + 1.3, cz, w, 2.6, d, mat);
}

// ── 리얼 주택 (#107): 절차 생성 골조 + ambientCG PBR 재질 ──
// 남쪽 현관문 + 동쪽 뒷문, 북·서 창문 (사격 가능), 박공지붕 + 굴뚝, 실내 1룸
function addHouse(hx, hz, { wall = 'brick' } = {}) {
  const W = 9.2, D = 7.2, H = 2.9, t = 0.35;
  const a = (26 * Math.PI) / 180;       // 지붕 경사
  const halfD = D / 2 + 0.5;            // 처마 내밈 포함
  const rise = Math.tan(a) * (D / 2);

  // 기초 플린스 (실내 바닥 높이 0.4 — 문지방 스텝업)
  addBox(hx, 0.15, hz, W + 0.5, 0.5, D + 0.5, 'concrete');
  addBox(hx, 0.37, hz, W - 0.6, 0.06, D - 0.6, 'woodfloor', { collide: false, block: false, shadow: false });

  // 벽: 남 현관 / 동 뒷문 / 북 창2 / 서 창1
  addWallWithDoor(hx, hz + D / 2, W, H, 'x', wall, 1.6, 1.2);
  addWallWithDoor(hx + W / 2, hz, D, H, 'z', wall, -1.6, 1.1);
  const winN = [{ at: -2.4, w: 1.5 }, { at: 1.8, w: 1.5 }];
  const winW = [{ at: 0.4, w: 1.5 }];
  addWindowWall(hx, hz - D / 2, W, H, 'x', wall, winN);
  addWindowWall(hx - W / 2, hz, D, H, 'z', wall, winW);

  // 창턱/상인방 트림 (목재) — 디테일업
  for (const o of winN) {
    addBox(hx + o.at, 0.97, hz - D / 2, o.w + 0.34, 0.1, t + 0.16, MAT.woodDark, { collide: false, block: false });
    addBox(hx + o.at, 2.03, hz - D / 2, o.w + 0.34, 0.1, t + 0.16, MAT.woodDark, { collide: false, block: false });
  }
  for (const o of winW) {
    addBox(hx - W / 2, 0.97, hz + o.at, t + 0.16, 0.1, o.w + 0.34, MAT.woodDark, { collide: false, block: false });
    addBox(hx - W / 2, 2.03, hz + o.at, t + 0.16, 0.1, o.w + 0.34, MAT.woodDark, { collide: false, block: false });
  }

  // 현관/뒷문 계단 + 문틀
  addBox(hx + 1.6, 0.12, hz + D / 2 + 0.55, 1.7, 0.24, 0.8, 'concrete');
  addBox(hx + W / 2 + 0.55, 0.12, hz - 1.6, 0.8, 0.24, 1.6, 'concrete');
  addBox(hx + 1.6, 2.42, hz + D / 2, 1.5, 0.12, t + 0.14, MAT.woodDark, { collide: false, block: false });

  // 박공지붕 (기와) — 도달 불가라 충돌 없음, 시야/총알은 차단
  const slabW = halfD / Math.cos(a);
  for (const s of [1, -1]) {
    const geo = new THREE.BoxGeometry(W + 0.9, 0.12, slabW);
    uvWorldBox(geo, W + 0.9, 0.12, slabW);
    const mesh = new THREE.Mesh(geo, matOf('rooftile'));
    mesh.position.set(hx, H + rise / 2 + 0.02, hz + (s * halfD) / 2);
    mesh.rotation.x = s * a;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    obstacleMeshes.push(mesh);
  }
  addBox(hx, H + rise + 0.05, hz, W + 0.9, 0.12, 0.3, MAT.roof, { collide: false });

  // 박공 삼각벽 (동/서)
  for (const s of [1, -1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-D / 2, 0); shape.lineTo(D / 2, 0); shape.lineTo(0, rise);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, matOf(wall));
    mesh.rotation.y = Math.PI / 2; // shape u축 → 월드 z, 압출 → 월드 +x
    mesh.position.set(hx + (s * W) / 2 - t / 2, H, hz);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    obstacleMeshes.push(mesh);
  }

  // 천장 (실내에서 지붕 안 보이게) + 굴뚝
  addBox(hx, H + 0.05, hz, W - 0.3, 0.1, D - 0.3, 'plaster', { collide: false });
  const chH = rise + 1.4;
  addBox(hx - W * 0.28, H - 0.3 + chH / 2, hz - D * 0.14, 0.75, chH, 0.75, 'brick', { collide: false });

  // 실내 가구 (탁자) — 루팅 상자는 LOOT_SPOTS 에서 스폰
  addBox(hx - 2.2, 1.11, hz - 1.2, 1.4, 0.08, 0.8, MAT.wood);
  addBox(hx - 2.75, 0.75, hz - 1.2, 0.08, 0.66, 0.7, MAT.woodDark, { block: false });
  addBox(hx - 1.65, 0.75, hz - 1.2, 0.08, 0.66, 0.7, MAT.woodDark, { block: false });
}

function buildStaticMap() {
  buildTexMats(); // 건축 PBR 재질 (#107) — 텍스처 로드 후 1회
  // 지면 (ambientCG Ground048 — 없으면 절차 생성)
  let groundMat;
  if (GROUND_TEX.ground) {
    const t = GROUND_TEX.ground;
    t.repeat.set(26, 26);
    groundMat = new THREE.MeshStandardMaterial({ map: t, color: 0xc4cba8, roughness: 1.0 });
  } else {
    groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1.0 });
  }
  // 하이트필드 변위 지면 — 6x6 타일 (프러스텀/레이캐스트 바운딩 컬링용)
  {
    const full = WORLD_HALF * 2 + 24;
    const TILES = 6, tw = full / TILES;
    for (let ti = 0; ti < TILES; ti++) {
      for (let tj = 0; tj < TILES; tj++) {
        const cx = -full / 2 + tw * (ti + 0.5), cz = -full / 2 + tw * (tj + 0.5);
        const geo = new THREE.PlaneGeometry(tw, tw, 14, 14);
        geo.rotateX(-Math.PI / 2);
        const p = geo.attributes.position;
        const n = geo.attributes.normal;
        for (let i = 0; i < p.count; i++) {
          const wx = cx + p.getX(i), wz = cz + p.getZ(i);
          p.setY(i, terrainH(wx, wz));
          // 해석적 노멀 (중앙 차분) — 타일 경계 이음새 방지
          const e = 0.8;
          const nx = terrainH(wx - e, wz) - terrainH(wx + e, wz);
          const nz = terrainH(wx, wz - e) - terrainH(wx, wz + e);
          const inv = 1 / Math.hypot(nx, 2 * e, nz);
          n.setXYZ(i, nx * inv, 2 * e * inv, nz * inv);
        }
        const tile = new THREE.Mesh(geo, groundMat);
        tile.position.set(cx, 0, cz);
        tile.receiveShadow = true;
        tile.userData.terrainTile = true; // LOS 는 해석적 검사로 대체 (메시 제외)
        scene.add(tile);
        obstacleMeshes.push(tile); // 총알 착탄용
      }
    }
  }

  // 산업지대 자갈 마당 (ambientCG Gravel023)
  if (GROUND_TEX.gravel) {
    const addYard = (x, z, w, d, rot) => {
      const t = GROUND_TEX.gravel.clone();
      t.needsUpdate = true;
      t.repeat.set(w / 7, d / 7);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ map: t, color: 0xb8b4a6, roughness: 1.0, polygonOffset: true, polygonOffsetFactor: -1 }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rot;
      m.position.set(x, 0.02, z);
      m.receiveShadow = true;
      scene.add(m);
    };
    addYard(16, -6, 48, 38, 0.06);      // 컨테이너 야적장
    addYard(32, 34, 34, 28, -0.04);     // buildingA 앞마당
    addYard(-30, -20, 40, 30, 0.03);    // 중앙 창고 주변
  }

  // 외곽 콘크리트 벽
  const W = WORLD_HALF;
  addBox(0, 2.5, -W, W * 2 + 2, 5, 1, 'concrete');
  addBox(0, 2.5, W, W * 2 + 2, 5, 1, 'concrete');
  addBox(-W, 2.5, 0, 1, 5, W * 2 + 2, 'concrete');
  addBox(W, 2.5, 0, 1, 5, W * 2 + 2, 'concrete');

  // 중앙 창고 (진입 가능 — 절차 생성 유지)
  addBuilding(-28, -18, 26, 15, 5.5, 'corrugated');

  // 리얼 주택 단지 (#107): 벽돌/플라스터 2동 + 시티 소품 (3DModelsCC0)
  addHouse(-58, 4, { wall: 'brick' });
  addHouse(-47, 16, { wall: 'plaster' });
  placeModel('propDumpster', -63.8, 8.5, { height: 1.3, rotY: Math.PI / 2 });
  placeModel('propAcunit', -55.2, -0.1, { height: 0.75, rotY: Math.PI });
  placeModel('propAcunit', -50.2, 12.2, { height: 0.75, rotY: -Math.PI / 2 });
  placeModel('propBench', -44.2, 20.4, { height: 0.85, rotY: Math.PI });
  placeModel('propBench', -11.5, -26.5, { height: 0.85, rotY: Math.PI }); // 사무동 앞 (벽에서 이격)
  placeModel('propDumpster', -6.6, -35.8, { height: 1.3, rotY: 0.2 });    // 사무동 옆
  { // 중앙 창고 옥상 급수탑 — 지붕 위 수동 배치 (도달 불가, 실루엣용)
    const wt = placeModel('propWatertower', -24, -16, { height: 4.6, collide: false });
    wt.position.y += 5.8;
    wt.updateMatrixWorld(true);
  }

  // 사무동 (진입 가능 2룸: 사무실 + 창고방) — 창문으로 사격 가능
  {
    const ox = -14, oz = -32, W2 = 12, D2 = 9, H2 = 3.0;
    // 북쪽: 정문 / 동쪽: 측면 출입구
    addWallWithDoor(ox, oz + D2 / 2, W2, H2, 'x', 'brick', -3);
    addWallWithDoor(ox + W2 / 2, oz, D2, H2, 'z', 'brick', 1.5);
    // 남쪽: 창 2개 / 서쪽: 창 1개
    addWindowWall(ox, oz - D2 / 2, W2, H2, 'x', 'brick', [{ at: -3, w: 1.8 }, { at: 2.5, w: 1.8 }]);
    addWindowWall(ox - W2 / 2, oz, D2, H2, 'z', 'brick', [{ at: 0.5, w: 1.8 }]);
    // 내부 칸막이 (문 있는 벽) — 서쪽 사무실 / 동쪽 창고방
    addWallWithDoor(ox - 3 + W2 / 2 - 2, oz, D2, H2, 'z', MAT.woodDark, -2);
    // 평지붕 + 바닥 슬래브
    addBox(ox, H2 + 0.15, oz, W2 + 0.6, 0.3, D2 + 0.6, MAT.roof);
    addBox(ox, 0.045, oz, W2, 0.03, D2, MAT.concreteDark, { collide: false, block: false, shadow: false });
    // 실내 소품 + 조명
    placeModel('crateWide', ox + 4.2, oz - 2.6, { height: 1.0, rotY: 0.3 });
    placeModel('box', ox + 4.4, oz + 1.4, { height: 0.9, rotY: 1.2 });
    placeModel('barrel', ox - 4.6, oz - 3.2, { height: 1.0, rotY: 2.1 });
    for (const [lx, lz] of [[ox - 3, oz], [ox + 4, oz]]) {
      const lamp = new THREE.PointLight(0xffd9a0, 22, 10, 2);
      lamp.position.set(lx, H2 - 0.35, lz);
      scene.add(lamp);
    }
  }

  // 산업 건물 랜드마크 (Kenney city-kit-industrial)
  placeModel('buildingA', 30, 32, { height: 7.5, rotY: Math.PI });
  placeModel('buildingE', 44, -32, { height: 8, rotY: Math.PI / 2 });
  placeModel('buildingH', -48, 42, { height: 6 });
  placeModel('buildingM', 8, 55, { height: 6.5, rotY: Math.PI });
  placeModel('buildingQ', -62, -56, { height: 6, rotY: Math.PI / 2 });
  placeModel('tank', 58, 62, { height: 7 });
  placeModel('chimney', -44, -28, { height: 14 });

  // 컨테이너 야적장
  addContainer(12, -8, false, MAT.metalRed);
  addContainer(12, -14, false, MAT.metalBlue);
  addContainer(20, -11, true, MAT.metalGreen);
  addContainer(-8, 22, true, MAT.metalRed);
  addContainer(-14, 28, false, MAT.metalBlue);
  addContainer(55, 10, true, MAT.metalRed);
  addContainer(60, 16, true, MAT.metalBlue);
  addContainer(-60, -30, false, MAT.metalGreen);
  addContainer(-55, -38, false, MAT.metalRed);
  addContainer(35, 60, false, MAT.metalBlue);

  // 모래주머니 / 낮은 엄폐물
  const sb = [[0, 10], [-20, 5], [25, 15], [-35, -45], [50, -10], [-10, -35], [15, 38], [-55, 15], [40, 45], [-30, 60]];
  for (const [x, z] of sb) addBox(x, terrainH(x, z) + 0.55, z, 3.2, 1.1, 0.9, MAT.sandbag);

  // 드럼통 (Kenney survival-kit)
  const drums = [[5, -25], [7, -25.8], [-42, 10], [30, -50], [-25, 35], [62, -45], [18, 20], [-65, 55]];
  for (const [x, z] of drums) placeModel('barrel', x, z, { height: 1.1, rotY: Math.random() * Math.PI * 2 });

  // 나무 (Kenney nature-kit)
  const trees = [[-70, -60], [-75, 20], [70, 60], [65, -60], [-20, 70], [50, 70], [-70, 70], [75, -20], [-40, -70], [20, -68], [-5, -55], [68, 30]];
  const treeKinds = ['treePineA', 'treePineB', 'treeOak'];
  for (const [x, z] of trees) {
    const kind = treeKinds[Math.floor(Math.random() * treeKinds.length)];
    placeTree(kind, x, z, kind === 'treeOak' ? 5.5 + Math.random() * 1.5 : 7.5 + Math.random() * 2.5);
  }

  // 바위
  const rocks = [[-15, 62], [55, -68], [-72, -15], [35, 12]];
  for (const [x, z] of rocks) placeModel('rock', x, z, { height: 1.4 + Math.random(), rotY: Math.random() * Math.PI * 2 });

  // 나무상자 엄폐물 (Kenney survival-kit / blaster-kit)
  const boxes = [[3, -30], [-18, -10], [22, 5], [48, 30], [-52, -12], [10, 48], [-38, 22], [58, -25]];
  for (const [x, z] of boxes) {
    if (Math.random() < 0.5) placeModel('box', x, z, { height: 1.0, rotY: Math.random() * Math.PI * 2 });
    else placeModel('crateWide', x, z, { height: 1.0, rotY: Math.floor(Math.random() * 4) * Math.PI / 2 });
  }

  // 추가 산업 건물 (city-kit-industrial 미사용분)
  placeModel('buildingB', -10, -66, { height: 7 });
  placeModel('buildingF', 66, -12, { height: 8.5, rotY: -Math.PI / 2 });
  placeModel('buildingG', -34, 64, { height: 9, rotY: Math.PI });
  placeModel('buildingN', -70, 34, { height: 9, rotY: Math.PI / 2 });
  placeModel('chimneyMed', -6, -60, { height: 10 });

  // 폐차 (Kenney car-kit — 어둡게 칠해 방치된 느낌)
  const wrecks = [
    ['carVan', 2, 26, 0.5], ['carTruck', 38, -14, 2.2], ['carSedan', -22, -30, -0.7],
    ['carSuv', 26, 44, 1.3], ['carDelivery', -46, 52, 2.8], ['carSedan', 50, 4, -2.4],
  ];
  for (const [key, x, z, rotY] of wrecks) {
    const m = placeModel(key, x, z, { height: key === 'carTruck' || key === 'carDelivery' ? 2.4 : 1.6, rotY });
    m.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.62);
        o.material.roughness = 0.92;
      }
    });
  }
  const tires = [[4.6, 24.2], [36, -11.5], [-20, -27.5], [27.8, 46.4], [14, -3]];
  for (const [x, z] of tires) placeModel('carTire', x, z, { height: 0.62, rotY: Math.random() * Math.PI * 2, collide: false });

  // 펜스 라인 (survival-kit) — 야적장/창고 경계
  const fenceRow = (x0, z0, dx, dz, n, rotY, kind = 'fenceFort') => {
    for (let i = 0; i < n; i++) {
      const k = (kind === 'mix' && i % 3 === 2) ? 'fence' : (kind === 'mix' ? 'fenceFort' : kind);
      placeModel(k, x0 + dx * i, z0 + dz * i, { height: 1.5, rotY });
    }
  };
  fenceRow(6, -24, 3.0, 0, 8, 0, 'mix');          // 야적장 남쪽
  fenceRow(30.5, -21, 0, 3.0, 5, Math.PI / 2);    // 야적장 동쪽
  fenceRow(-46, -6, 3.0, 0, 6, 0, 'mix');         // 중앙 창고 북쪽
  fenceRow(-14, 34, 0, 3.0, 5, Math.PI / 2, 'fence'); // 컨테이너 서쪽

  // 야영지 (survival-kit) — 숲 가장자리
  placeModel('tent', -60, 62, { height: 1.9, rotY: 2.4 });
  placeModel('campfire', -57, 58.5, { height: 0.5, collide: false });
  placeModel('tent', 66, -62, { height: 1.9, rotY: -0.8 });
  placeModel('boxLarge', -57.5, 61, { height: 0.9, rotY: 0.5 });

  // 직선 계단: (sx,sz)에서 (dx,dz) 방향, 단높이 stepH·단깊이 stepD·폭 w
  const addStairs = (sx, sz, dx, dz, steps, stepH, stepD, w, mat, baseY = 0) => {
    for (let i = 0; i < steps; i++) {
      const cx = sx + dx * stepD * (i + 0.5), cz = sz + dz * stepD * (i + 0.5);
      const h = baseY + stepH * (i + 1);
      const bw = dx !== 0 ? stepD : w, bd = dx !== 0 ? w : stepD;
      addBox(cx, h / 2, cz, bw, h, bd, mat, { shadow: false });
    }
  };

  // ── 감시탑 (24, -58): 5m 플랫폼 + 난간 + 지붕, 스위치백 계단 ──
  {
    const tx = 24, tz = -58, PH = 5.0; // 플랫폼 바닥 높이
    for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
      addBox(tx + px, PH / 2, tz + pz, 0.28, PH, 0.28, MAT.wood);
    }
    addBox(tx, PH + 0.1, tz, 3.9, 0.2, 3.9, MAT.wood); // 플랫폼
    // 난간 (남쪽 계단 진입부만 개방)
    addBox(tx, PH + 0.65, tz - 1.95, 3.9, 0.9, 0.12, MAT.woodDark);
    addBox(tx - 1.95, PH + 0.65, tz, 0.12, 0.9, 3.9, MAT.woodDark);
    addBox(tx + 1.95, PH + 0.65, tz, 0.12, 0.9, 3.9, MAT.woodDark);
    addBox(tx - 1.2, PH + 0.65, tz + 1.95, 1.5, 0.9, 0.12, MAT.woodDark);
    // 지붕
    for (const [px, pz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      addBox(tx + px, PH + 1.5, tz + pz, 0.14, 2.6, 0.14, MAT.woodDark, { block: false });
    }
    addBox(tx, PH + 2.9, tz, 4.4, 0.18, 4.4, MAT.roof);
    // 스위치백 계단: 동쪽으로 올라가 중간참 → 서쪽으로 플랫폼 진입
    addStairs(tx + 2.2, tz + 4.2, 1, 0, 5, 0.5, 0.62, 1.3, MAT.wood);          // 0→2.5
    addBox(tx + 6.1, 2.5 - 0.1, tz + 3.55, 1.6, 0.2, 2.6, MAT.wood);               // 중간참
    addBox(tx + 6.1, 1.25, tz + 3.55, 0.24, 2.5, 0.24, MAT.wood);              // 참 기둥
    addStairs(tx + 5.3, tz + 2.9, -1, 0, 5, 0.5, 0.62, 1.3, MAT.wood, 2.5);    // 2.5→5.0
    addBox(tx + 0.6, PH - 0.1, tz + 2.6, 3.2, 0.2, 1.3, MAT.wood);                 // 진입 브리지
  }

  // ── 2층 게스트하우스 (56, 44): 실내 계단 + 2층 창문 사격 포지션 ──
  {
    const gx = 56, gz = 44, W3 = 10, D3 = 8, F1 = 3.0, F2 = 5.8;
    // 1층: 정문(남) + 창(동), 서/북 벽
    addWallWithDoor(gx, gz - D3 / 2, W3, F1, 'x', MAT.concrete, 2);
    addWindowWall(gx + W3 / 2, gz, D3, F1, 'z', MAT.concrete, [{ at: -1, w: 1.8 }]);
    addBox(gx - W3 / 2, F1 / 2, gz, 0.35, F1, D3, MAT.concrete);
    addBox(gx, F1 / 2, gz + D3 / 2, W3, F1, 0.35, MAT.concrete);
    // 2층 바닥 (계단 개구부 2.0×3.8 서쪽) — 두 장으로 분할
    addBox(gx + 1.2, F1 + 0.1, gz, 7.6, 0.2, D3, MAT.woodDark);
    addBox(gx - 3.8, F1 + 0.1, gz - 2.0, 2.4, 0.2, D3 - 4.0, MAT.woodDark);
    // 2층 벽: 사방 창문 (저격 포지션) — baseY 로 1층 위에 얹음
    addWindowWall(gx, gz - D3 / 2, W3, F2 - F1, 'x', MAT.brick, [{ at: -2, w: 1.8 }, { at: 2.5, w: 1.8 }], F1);
    addWindowWall(gx, gz + D3 / 2, W3, F2 - F1, 'x', MAT.brick, [{ at: 0, w: 2.0 }], F1);
    addWindowWall(gx - W3 / 2, gz, D3, F2 - F1, 'z', MAT.brick, [{ at: 0, w: 1.8 }], F1);
    addWindowWall(gx + W3 / 2, gz, D3, F2 - F1, 'z', MAT.brick, [{ at: -1, w: 1.8 }], F1);
    // 지붕
    addBox(gx, F2 + 0.15, gz, W3 + 0.6, 0.3, D3 + 0.6, MAT.roof);
    // 실내 계단 (서쪽 벽면을 따라 북→남, 6단 × 0.5)
    addStairs(gx - 3.8, gz + 3.8, 0, -1, 6, 0.5, 0.6, 1.8, MAT.concreteDark);
    // 1층 소품
    placeModel('box', gx + 2.5, gz + 1.5, { height: 0.9, rotY: 0.7 });
    const lampG = new THREE.PointLight(0xffd9a0, 22, 10, 2);
    lampG.position.set(gx, F1 - 0.35, gz);
    scene.add(lampG);
  }

  // 건물 주변 디테일 — 소품 스캐터 (드럼통/상자, 지형·충돌 자동)
  const PROPS = ['barrel', 'box', 'crateWide'];
  const scatterProps = (x, z, r, n) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * (r + Math.random() * 2);
      const pz = z + Math.sin(a) * (r + Math.random() * 2);
      if (!isPointOpen(px, pz, 0.8)) continue;
      placeModel(PROPS[Math.floor(Math.random() * PROPS.length)], px, pz,
        { height: 0.9 + Math.random() * 0.3, rotY: Math.random() * Math.PI * 2 });
    }
  };
  scatterProps(30, 32, 9, 4);    // buildingA
  scatterProps(44, -32, 8, 3);   // buildingE
  scatterProps(8, 55, 7, 3);     // buildingM
  scatterProps(-62, -56, 8, 3);  // buildingQ
  scatterProps(-10, -66, 8, 3);  // buildingB
  scatterProps(-34, 64, 8, 3);   // buildingG
  scatterProps(-70, 34, 7, 2);   // buildingN
  // 공장 옆 연료 탱크 / 소형 배기 굴뚝
  placeModel('tank', 49, -27, { height: 2.6, rotY: 0.4 });
  placeModel('tank', -16, -63, { height: 2.4, rotY: 1.9 });
  placeModel('tank', -66, -50, { height: 2.8, rotY: 2.6 });
  placeModel('chimneySmall', 47.5, -36, { height: 3.2 });
  placeModel('chimneySmall', -6.5, -69, { height: 3.0 });
  placeModel('chimneySmall', 62, -8, { height: 3.4 });

  // 고철 패널 엄폐물
  const panels = [[18, -18, 0.3], [-26, 12, 1.8], [44, 22, -0.5], [-8, -44, 2.1]];
  for (const [x, z, r] of panels) placeModel('metalPanel', x, z, { height: 1.7, rotY: r });

  // 풀 스캐터 (시야/이동 차단 없음) — 납작 모델이라 width 기준 정규화
  for (let i = 0; i < 46; i++) {
    const x = (Math.random() * 2 - 1) * (WORLD_HALF - 8);
    const z = (Math.random() * 2 - 1) * (WORLD_HALF - 8);
    if (!isPointOpen(x, z, 1.5)) continue;
    const g = placeModel(Math.random() < 0.8 ? 'grassTuft' : 'grassPatch', x, z,
      { width: 1.0 + Math.random() * 0.9, rotY: Math.random() * Math.PI * 2, collide: false, block: false });
    g.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color.setRGB(0.58, 0.62, 0.4); // 채도 낮춰 지면 톤과 조화
      }
    });
  }

  // LOS 차폐물 목록 (지형 타일 제외 — 지형은 terrainBlocks 해석 검사)
  losMeshes = obstacleMeshes.filter((o) => !o.userData.terrainTile);
}

// ============================================================
// 루팅
// ============================================================
function rollItem() {
  const total = ITEM_TABLE.reduce((s, i) => s + i.w, 0);
  let r = Math.random() * total;
  for (const it of ITEM_TABLE) { r -= it.w; if (r <= 0) return it; }
  return ITEM_TABLE[0];
}
function rollItems(min, max) {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  return Array.from({ length: n }, rollItem);
}

const LOOT_SPOTS = [
  [-28, -18], [-34, -14], [-22, -21],       // 창고 내부
  [30, 32], [44, -32], [-48, 42], [8, 55],  // 주택 내부
  [16, -11], [-11, 25], [57, 13], [-57, -34], // 컨테이너 사이
  [0, 0], [-65, 60], [65, -55], [70, 68], [-70, -68], [40, 8],
  [-17.5, -33.5], [-10.5, -30],  // 사무동 실내
  [-59, 2.5, 0.4], [-46, 14.5, 0.4], // 리얼 주택 실내 (#107)
  [24, -58],                     // 감시탑 아래
  [58, 45.5, 3.2],               // 게스트하우스 2층
];

function spawnLoot() {
  for (const [x, z, yAbs] of LOOT_SPOTS) {
    if (Math.random() < 0.2) continue; // 매 레이드 배치가 조금씩 다름
    // 보급 상자 모델 (통과 가능 — 루팅 동선 방해 방지)
    const mesh = placeModel('crate', x, z, {
      height: 0.8, rotY: Math.random() * Math.PI, collide: false, block: false,
    });
    // 고도 스폰 (2층 등): yAbs 가 있으면 그 바닥 높이로 올림
    const gy = yAbs !== undefined ? yAbs : terrainH(x, z);
    if (yAbs !== undefined) mesh.position.y += yAbs - terrainH(x, z);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x9fdc6a }));
    lamp.position.set(x, gy + 0.78, z);
    scene.add(lamp);
    interactables.push({
      pos: new THREE.Vector3(x, gy + 0.5, z), mesh, lamp,
      items: rollItems(2, 4), opened: false, label: '보급 상자',
      raidObject: true,
    });
    mesh.userData.raidObject = true;
  }
}

// ============================================================
// 적 (스캐브)
// ============================================================
const ENEMY = {
  count: 12,
  hp: 100,
  walkSpeed: 1.4,
  runSpeed: 4.3,
  sightRange: 48,
  fovCos: Math.cos(THREE.MathUtils.degToRad(75)),
  hearRange: 7,
  fireRange: 42,
  burstShots: 3,
  shotInterval: 0.13,
  magSize: 9, // 3점사 × 3회 후 재장전
  damageMin: 7, damageMax: 14,
};

const HITBOX_MAT = new THREE.MeshBasicMaterial();
const CHAR_HEIGHT = 1.75;

function makeEnemyMesh() {
  const g = new THREE.Group();

  // 캐릭터 (VRoid CC0 애니메 걸 — 개체마다 랜덤 모델, Kenney 애니메이션 리타게팅)
  const key = GIRL_KEYS[Math.floor(Math.random() * GIRL_KEYS.length)];
  const model = SkeletonUtils.clone(ASSETS[key].scene);
  const bb = new THREE.Box3().setFromObject(model);
  const s = CHAR_HEIGHT / Math.max(0.001, bb.max.y - bb.min.y);
  model.scale.setScalar(s);
  model.position.y = -bb.min.y * s;
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.frustumCulled = false; // 스킨드 메시 컬링 오판 방지
    }
  });
  g.add(model);

  const clips = CHAR_CLIPS[key];
  const mixer = new THREE.AnimationMixer(model);
  mixer.timeScale = 0.95 + Math.random() * 0.1; // 개체 간 락스텝 방지
  const actIdle = clips.idle ? mixer.clipAction(clips.idle) : null;
  const actRun = clips.run ? mixer.clipAction(clips.run) : null;
  const actWalk = clips.walk ? mixer.clipAction(clips.walk) : null;
  const actLimp = clips.limp ? mixer.clipAction(clips.limp) : null;
  // 원샷 액션 (사망/피격) — 마지막 프레임 유지, 피격은 finished 시 복귀
  const mkOnce = (clip) => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    return a;
  };
  const actDeath = mkOnce(clips.death);
  const actHitChest = mkOnce(clips.hitChest);
  const actHitHead = mkOnce(clips.hitHead);
  const actShoot = mkOnce(clips.shoot);
  const actReload = mkOnce(clips.reload);
  const actRoll = mkOnce(clips.roll);
  const actAlert = mkOnce(clips.alert);
  const actCrouch = clips.crouchIdle ? mixer.clipAction(clips.crouchIdle) : null;
  // additive 조준 포즈 — 항상 재생, 가중치로만 제어
  const mkAim = (clip) => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    return a;
  };
  const actAimUp = mkAim(clips.aimUp);
  const actAimDown = mkAim(clips.aimDown);
  if (actIdle) {
    actIdle.play();
    actIdle.time = Math.random() * clips.idle.duration;
  }

  // 무기 (Quaternius SMG) — 오른손 본에 부착 (팔 스윙에 따라 움직임)
  const gunHolder = new THREE.Group();
  const gunMesh = instantiate('smg');
  normalizeModel(gunMesh, 0.55, -Math.PI / 2); // +X 총구 → +Z (적 전방)
  brightenMaterials(gunMesh, 3.2);
  gunHolder.add(gunMesh);
  const hand = model.getObjectByName('RightHand');
  if (hand) {
    gunHolder.scale.setScalar(1 / s); // 모델 스케일 상쇄 (월드 크기 유지)
    gunHolder.position.set(0, 0.05, 0.02);
    // UAL 권총 파지 idle 기준 손 본 월드 회전의 역 — 총구 +Z(전방) 정렬 (해석 계산값)
    gunHolder.rotation.set(-0.1612, 1.3828, -1.4543);
    hand.add(gunHolder);
  } else {
    gunHolder.position.set(0.22, 1.18, 0.3);
    g.add(gunHolder);
  }

  // 히트박스 (비표시, 레이캐스트 전용) — 6.5등신 애니메 체형 기준
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 8), HITBOX_MAT);
  body.position.y = 0.85; body.visible = false;
  // 머리 중심 z3.50/신장 3.83 → 게임 y ~1.60 (히트 반경은 약간 후하게)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), HITBOX_MAT);
  head.position.y = 1.60; head.visible = false;
  g.add(body, head);

  const flash = new THREE.PointLight(0xffc070, 0, 10, 2);
  flash.position.set(0.24, 1.3, 0.9);
  g.add(flash);
  // 상체 본 — 피격 flinch / 전투 조준 자세용 (mixer 갱신 후 오프셋 적용)
  const spine = model.getObjectByName('Spine') || null;
  return {
    group: g, body, head, flash, model, mixer, actIdle, actRun,
    actDeath, actHitChest, actHitHead, actShoot, actReload,
    actRoll, actCrouch, actAimUp, actAimDown, actWalk, actLimp, actAlert,
    running: false, crouched: false, baseAct: actIdle, spine,
    flinch: 0, aimBlend: 0, oneShot: null, deathDone: false,
  };
}

function randomOpenPoint(margin = 6) {
  for (let tries = 0; tries < 60; tries++) {
    const x = (Math.random() * 2 - 1) * (WORLD_HALF - margin);
    const z = (Math.random() * 2 - 1) * (WORLD_HALF - margin);
    if (isPointOpen(x, z, 0.8)) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 0);
}
function isPointOpen(x, z, r) {
  for (const b of colliders) {
    if (b.maxY < 0.3 || b.minY >= 1.5) continue;
    const dx = x - b.cx, dz = z - b.cz;
    const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;
    if (Math.abs(lx) < b.hx + r && Math.abs(lz) < b.hz + r) return false;
  }
  return true;
}

function spawnEnemies(avoidPos) {
  for (let i = 0; i < ENEMY.count; i++) {
    let p;
    do { p = randomOpenPoint(); } while (p.distanceTo(avoidPos) < 32);
    const m = makeEnemyMesh();
    m.group.position.copy(p);
    scene.add(m.group);
    const e = {
      ...m,
      pos: m.group.position,
      hp: ENEMY.hp,
      state: 'patrol',
      waypoint: randomOpenPoint(),
      idleTimer: 0,
      detectTimer: Math.random() * 0.15,
      lastKnown: new THREE.Vector3(),
      lostTimer: 0,
      fireTimer: 1 + Math.random(),
      burstLeft: 0,
      mag: ENEMY.magSize,
      reloadT: 0,
      stance: 'stand',
      rollT: 0,
      rollDir: null,
      stuckTimer: 0,
      lastPos: p.clone(),
      dead: false,
    };
    m.body.userData = { enemy: e, part: 'body' };
    m.head.userData = { enemy: e, part: 'head' };
    // 원샷 종료 훅 — spread 복사 후의 최종 enemy 객체(e)에 바인딩해야 함
    // (makeEnemyMesh 안에서 붙이면 복사 전 객체에 플래그를 써서 유실됨)
    m.mixer.addEventListener('finished', (ev) => {
      if (ev.action === e.actDeath) { e.deathDone = true; return; }
      if (ev.action === e.oneShot) {
        e.oneShot = null;
        if (e.dead) return;
        // 원샷(피격/사격/재장전/구르기) 종료 → 기본 모션 복귀
        const base = e.baseAct || (e.running ? e.actRun : e.actIdle);
        ev.action.fadeOut(0.12);
        if (base) base.reset().fadeIn(0.12).play();
      }
    });
    enemies.push(e);
  }
  spawnBoss(avoidPos);
}

// 레이드당 1명의 보스 — 대형·적색 틴트, HP 300, 5점사, 고가치 드롭 (#57)
function spawnBoss(avoidPos) {
  let p;
  do { p = randomOpenPoint(); } while (p.distanceTo(avoidPos) < 40);
  const m = makeEnemyMesh();
  m.model.scale.multiplyScalar(1.07);
  m.model.traverse((o) => {
    if ((o.isMesh || o.isSkinnedMesh) && o.material) {
      o.material = o.material.clone(); // 재질 공유 해제 후 틴트
      o.material.color.multiply(new THREE.Color(0.4, 0.16, 0.18)); // 어두운 적갈색
    }
  });
  m.group.position.copy(p);
  scene.add(m.group);
  const e = {
    ...m,
    pos: m.group.position,
    hp: 300,
    maxHp: 300,
    state: 'patrol',
    waypoint: randomOpenPoint(),
    idleTimer: 0,
    detectTimer: Math.random() * 0.15,
    lastKnown: new THREE.Vector3(),
    lostTimer: 0,
    fireTimer: 1 + Math.random(),
    burstLeft: 0,
    mag: 15,
    reloadT: 0,
    stance: 'stand',
    rollT: 0,
    rollDir: null,
    dead: false,
    boss: true,
  };
  m.body.userData = { enemy: e, part: 'body' };
  m.head.userData = { enemy: e, part: 'head' };
  m.mixer.addEventListener('finished', (ev) => {
    if (ev.action === e.actDeath) { e.deathDone = true; return; }
    if (ev.action === e.oneShot) {
      e.oneShot = null;
      if (e.dead) return;
      const base = e.baseAct || (e.running ? e.actRun : e.actIdle);
      ev.action.fadeOut(0.12);
      if (base) base.reset().fadeIn(0.12).play();
    }
  });
  enemies.push(e);
}

function enemyForward(e) {
  return new THREE.Vector3(Math.sin(e.group.rotation.y), 0, Math.cos(e.group.rotation.y));
}

const _ray = new THREE.Raycaster();
// 지형 능선이 시선을 가리는지 — 고밀도 지면 메시 레이캐스트 대신 해석 샘플링
function terrainBlocks(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(dist / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const y = from.y + (to.y - from.y) * t;
    if (terrainH(from.x + dx * t, from.z + dz * t) > y) return true;
  }
  return false;
}
let losMeshes = []; // 지형 타일 제외 차폐물 (buildStaticMap 후 구성)
function hasLineOfSight(from, to) {
  if (terrainBlocks(from, to)) return false;
  const dir = to.clone().sub(from);
  const dist = dir.length();
  dir.normalize();
  _ray.set(from, dir);
  _ray.far = dist - 0.3;
  return _ray.intersectObjects(losMeshes, false).length === 0;
}

function playerEyePos() {
  return new THREE.Vector3(player.pos.x, player.pos.y + PLAYER.eye, player.pos.z);
}

function updateEnemy(e, dt) {
  if (e.dead) {
    if (e.actDeath) {
      // 사망 모션 재생 중에만 mixer 갱신 (finished 후 clamp 로 마지막 포즈 유지)
      if (!e.deathDone) e.mixer.update(dt);
    } else if (e.dying !== undefined && e.dying < 1) {
      // 폴백: 쓰러지는 연출 — 방향 랜덤 (뒤/좌/우) + 요 드리프트 + 살짝 튕김
      e.dying = Math.min(1, e.dying + dt * 2.6);
      const k = 1 - Math.pow(1 - e.dying, 2.2);
      const settle = 1 + Math.sin(Math.min(1, e.dying) * Math.PI) * 0.06; // 바닥 직전 미세 오버슛
      if (e.fallAxis === 'left') e.group.rotation.z = Math.PI / 2 * k * settle;
      else if (e.fallAxis === 'right') e.group.rotation.z = -Math.PI / 2 * k * settle;
      else e.group.rotation.x = -Math.PI / 2 * k * settle;
      e.group.rotation.y += (e.fallYaw || 0) * dt * 2.6;
      e.group.position.y = 0.32 * k;
    }
    return;
  }
  const eyeH = e.crouched ? 1.05 : 1.6;
  const eyePos = new THREE.Vector3(e.pos.x, e.pos.y + eyeH, e.pos.z);
  const toPlayer = player.pos.clone().sub(e.pos); toPlayer.y = 0;
  const dist = toPlayer.length();

  // --- 탐지 (0.15초 주기) ---
  e.detectTimer -= dt;
  if (e.detectTimer <= 0 && state.phase === 'raid') {
    e.detectTimer = 0.15;
    let seen = false;
    if (dist < ENEMY.sightRange) {
      const dirN = toPlayer.clone().normalize();
      const inFov = enemyForward(e).dot(dirN) > ENEMY.fovCos || dist < ENEMY.hearRange;
      if (inFov && hasLineOfSight(eyePos, playerEyePos())) seen = true;
    }
    if (seen) {
      e.lastKnown.copy(player.pos);
      e.lostTimer = 0;
      if (e.state !== 'combat') {
        e.state = 'combat';
        // 교전 스탠스: 일부는 앉아쏴 (피탄 면적 감소 + 명중률 보너스)
        e.stance = e.actCrouch && Math.random() < 0.4 ? 'crouch' : 'stand';
        playEnemyOneShot(e, e.actAlert, 0.08); // 놀라 총 드는 텔레그래프 (서 있을 때만 성공)
      }
    } else if (e.state === 'combat') {
      e.lostTimer += 0.15;
      if (e.lostTimer > 3.5) { e.state = 'chase'; }
    }
  }

  // --- 상태별 행동 ---
  let moveDir = null, speed = 0;
  if (e.state === 'patrol') {
    const d = e.waypoint.clone().sub(e.pos); d.y = 0;
    if (d.length() < 1.6) {
      e.idleTimer -= dt;
      if (e.idleTimer <= 0) { e.waypoint = randomOpenPoint(); e.idleTimer = 1 + Math.random() * 3; }
    } else { moveDir = d.normalize(); speed = ENEMY.walkSpeed; }
  } else if (e.state === 'chase') {
    const d = e.lastKnown.clone().sub(e.pos); d.y = 0;
    if (d.length() < 2) { e.state = 'patrol'; e.waypoint = randomOpenPoint(); }
    else { moveDir = d.normalize(); speed = ENEMY.runSpeed; }
  } else if (e.state === 'combat' && e.rollT > 0) {
    // 회피 구르기 중: 구르는 방향으로 이동/회전, 사격 중지
    e.rollT -= dt;
    moveDir = e.rollDir;
    speed = 3.4;
    const rollYaw = Math.atan2(e.rollDir.x, e.rollDir.z);
    let dyr = rollYaw - e.group.rotation.y;
    while (dyr > Math.PI) dyr -= Math.PI * 2;
    while (dyr < -Math.PI) dyr += Math.PI * 2;
    e.group.rotation.y += THREE.MathUtils.clamp(dyr, -dt * 14, dt * 14);
  } else if (e.state === 'combat') {
    // 플레이어를 향해 회전
    const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
    let dy = targetYaw - e.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    e.group.rotation.y += THREE.MathUtils.clamp(dy, -dt * 6, dt * 6);

    // 거리 유지 (히스테리시스 — 경계에서 이동/정지 토글 방지)
    if (e.combatMove === 'approach') {
      if (dist < ENEMY.fireRange * 0.6) e.combatMove = null;
    } else if (e.combatMove === 'retreat') {
      if (dist > 9) e.combatMove = null;
    } else {
      if (dist > ENEMY.fireRange * 0.85) e.combatMove = 'approach';
      else if (dist < 5) e.combatMove = 'retreat';
    }
    if (e.combatMove === 'approach') { moveDir = toPlayer.clone().normalize(); speed = ENEMY.runSpeed; }
    else if (e.combatMove === 'retreat') { moveDir = toPlayer.clone().normalize().negate(); speed = ENEMY.walkSpeed; }

    // --- 사격 / 재장전 ---
    if (e.reloadT > 0) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) e.mag = e.boss ? 15 : ENEMY.magSize;
    } else {
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        if (e.burstLeft > 0) {
          e.burstLeft--;
          e.mag--;
          e.fireTimer = ENEMY.shotInterval;
          enemyShoot(e, dist);
          playEnemyOneShot(e, e.actShoot); // 사격 반동 (서 있을 때만)
          if (e.mag <= 0) {
            // 탄창 소진 → 재장전 (모션 시간만큼 사격 불가)
            e.burstLeft = 0;
            e.reloadT = e.actReload ? e.actReload.getClip().duration : 1.7;
            playEnemyOneShot(e, e.actReload, 0.1);
          }
        } else if (dist < ENEMY.fireRange && hasLineOfSight(eyePos, playerEyePos())) {
          e.burstLeft = e.boss ? 5 : ENEMY.burstShots;
          e.fireTimer = 0.9 + Math.random() * 0.9;
        } else {
          e.fireTimer = 0.4;
        }
      }
    }
  }

  // --- 이동 + 충돌 ---
  if (moveDir) {
    if (e.state !== 'combat') {
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      let dy = targetYaw - e.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.group.rotation.y += THREE.MathUtils.clamp(dy, -dt * 5, dt * 5);
    }
    if (e.actLimp && e.hp < (e.maxHp || ENEMY.hp) * 0.35 && e.rollT <= 0) speed = Math.min(speed, 0.62);
    const preX = e.pos.x, preZ = e.pos.z;
    e.pos.x += moveDir.x * speed * dt;
    e.pos.z += moveDir.z * speed * dt;
    resolveHorizontal(e.pos, 0.4, 0.1, 1.7);
    const movedDist = Math.hypot(e.pos.x - preX, e.pos.z - preZ); // 실제 변위

    // 근거리 적 발소리 (거리 감쇠) — 벽에 막히면 안 남
    if (dist < 26) {
      e.stepAcc = (e.stepAcc || 0) + movedDist;
      if (e.stepAcc >= 2.6) {
        e.stepAcc = 0;
        playBuf('stepGrass', { vol: Math.max(0.02, 0.24 - dist * 0.009), jitter: 0.12, lp: 2200 });
      }
    }

    // 끼임 감지 → 웨이포인트 재설정
    e.stuckTimer += dt;
    if (e.stuckTimer > 1.5) {
      if (e.pos.distanceTo(e.lastPos) < 0.6) {
        e.waypoint = randomOpenPoint();
        if (e.state === 'chase') e.state = 'patrol';
      }
      e.lastPos.copy(e.pos);
      e.stuckTimer = 0;
    }
  }

  // 맵 경계 + 지형 높이 추종
  e.pos.x = THREE.MathUtils.clamp(e.pos.x, -WORLD_HALF + 2, WORLD_HALF - 2);
  e.pos.z = THREE.MathUtils.clamp(e.pos.z, -WORLD_HALF + 2, WORLD_HALF - 2);
  e.pos.y = terrainH(e.pos.x, e.pos.z);

  // --- 애니메이션 (전환 디바운스: 매 프레임 reset 반복 → 바인드포즈 고정 방지) ---
  if (e.actIdle && e.actRun && !e.oneShot) {
    const wantRun = !!moveDir;
    const wounded = e.actLimp && e.hp < (e.maxHp || ENEMY.hp) * 0.35 && e.rollT <= 0;
    const wantWalk = wantRun && e.actWalk && speed <= ENEMY.walkSpeed + 0.01; // 순찰·후퇴 보행
    const wantCrouch = !wantRun && e.state === 'combat' && e.stance === 'crouch' && !!e.actCrouch;
    const desired = wantRun
      ? (wounded ? e.actLimp : (wantWalk ? e.actWalk : e.actRun))
      : (wantCrouch ? e.actCrouch : e.actIdle);
    if (desired !== e.baseAct) {
      e.animSwitchT = (e.animSwitchT || 0) + dt;
      if (e.animSwitchT > 0.12) {
        e.animSwitchT = 0;
        e.baseAct.fadeOut(0.15);
        desired.reset().fadeIn(0.15).play();
        if (desired === e.actRun || desired === e.actWalk) {
          desired.time = Math.random() * desired.getClip().duration; // 위상 분산
        }
        e.baseAct = desired;
        e.running = wantRun;
        e.crouched = wantCrouch;
        // 앉아쏴 히트박스 (레이캐스트 전용 메시 위치/스케일 보정)
        e.body.position.y = wantCrouch ? 0.60 : 0.85;
        e.body.scale.y = wantCrouch ? 0.68 : 1;
        e.head.position.y = wantCrouch ? 1.05 : 1.60;
      }
    } else {
      e.animSwitchT = 0;
    }
    if (e.running) {
      if (e.baseAct === e.actLimp) e.actLimp.timeScale = Math.max(0.6, speed / 0.41); // ARDY 원속 0.41m/s
      else if (e.baseAct === e.actWalk) e.actWalk.timeScale = Math.max(0.5, speed / 1.0); // ARDY 원속 1.0m/s
      else e.actRun.timeScale = Math.max(0.5, speed / 3.4);
    }
  }
  // --- 고저차 조준 (additive Aim_Up/Down 가중치, mixer 갱신 전에 설정) ---
  const wantAim = e.state === 'combat' ? 1 : 0;
  e.aimBlend += (wantAim - e.aimBlend) * Math.min(1, dt * 5);
  const dyAim = player.pos.y - e.pos.y;
  const aimPitch = THREE.MathUtils.clamp(Math.atan2(dyAim, Math.max(1, dist)), -0.6, 0.6);
  if (e.actAimUp && e.actAimDown) {
    // 구르기/피격/재장전 중과 앉은 상태에선 끔 (포즈 충돌)
    const k = e.aimBlend * (e.oneShot && e.oneShot !== e.actShoot ? 0 : 1) * (e.crouched ? 0 : 1);
    e.actAimUp.setEffectiveWeight(Math.max(0, aimPitch / 0.6) * k);
    e.actAimDown.setEffectiveWeight(Math.max(0, -aimPitch / 0.6) * k);
  }
  // three.js PropertyMixer 는 블렌드 결과가 전 프레임과 같으면 본 쓰기를 생략한다.
  // Spine 트랙이 상수인 클립(UAL Idle)에서는 아래 오프셋 가산이 무한 누적되므로,
  // 갱신 전에 클립 순수 포즈로 복원해 두고 갱신 직후의 포즈를 다시 저장한다. (#31)
  if (e.spine && e.spinePose) e.spine.quaternion.copy(e.spinePose);
  e.mixer.update(dt);

  // --- 상체 오프셋 (mixer 가 본 로컬을 덮어쓰므로 갱신 직후 가산) ---
  if (e.spine) {
    if (!e.spinePose) e.spinePose = e.spine.quaternion.clone();
    else e.spinePose.copy(e.spine.quaternion);
    // additive 조준 포즈가 없는 경우의 폴백: 절차적 상체 기울임
    if (!e.actAimUp && e.aimBlend > 0.01) {
      e.spine.rotation.x += (-aimPitch * 0.7 + 0.1) * e.aimBlend;
    }
    // 피격 flinch — 순간 젖혀졌다 복귀
    if (e.flinch > 0) {
      e.flinch = Math.max(0, e.flinch - dt * 4.5);
      const f = Math.sin(e.flinch * Math.PI) * (e.flinch > 0.5 ? 1 : e.flinch * 2);
      e.spine.rotation.x -= f * 0.28;
      e.spine.rotation.z += f * 0.1 * (e.flinchSide || 1);
    }
  }
}

function enemyShoot(e, dist) {
  e.flash.intensity = 50;
  sfx.enemyShoot(dist);

  // 트레이서: 총구 → 플레이어 근처
  const muzzleH = e.crouched ? 0.85 : 1.3;
  const muzzle = new THREE.Vector3(0.28, muzzleH, 0.95).applyEuler(new THREE.Euler(0, e.group.rotation.y, 0)).add(e.pos);
  const targetPos = playerEyePos();

  // 명중 판정 (거리/이동 기반 확률, 앉아쏴는 안정 보너스)
  const moving = player.vel.lengthSq() > 4;
  let acc = 0.62 - dist * 0.011 - (moving ? 0.14 : 0) - (player.sprinting ? 0.08 : 0) + (e.crouched ? 0.06 : 0) + (e.boss ? 0.1 : 0);
  acc = THREE.MathUtils.clamp(acc, 0.06, 0.8);
  const hit = Math.random() < acc && hasLineOfSight(new THREE.Vector3(e.pos.x, e.pos.y + (e.crouched ? 1.05 : 1.6), e.pos.z), targetPos);

  const endPoint = targetPos.clone();
  if (!hit) {
    endPoint.x += (Math.random() - 0.5) * 3;
    endPoint.y += (Math.random() - 0.3) * 2;
    endPoint.z += (Math.random() - 0.5) * 3;
  }
  spawnTracer(muzzle, endPoint, 0xffaa66);

  if (hit && state.phase === 'raid') {
    const dmg = (ENEMY.damageMin + Math.random() * (ENEMY.damageMax - ENEMY.damageMin)) * (e.boss ? 1.5 : 1);
    damagePlayer(dmg, Math.random() < 0.15); // 15% 헤드샷 (헬멧으로 방어 가능)
  }
}

const ARMOR_MAX = 80;
function damagePlayer(dmg, headshot = false) {
  if (headshot) {
    if (player.helmet) {
      player.helmet = false;
      addFeed('헬멧이 헤드샷을 막았습니다 (파손)');
      sfx.hitmarker();
      return;
    }
    dmg *= 1.8;
  } else if (player.armorDur > 0) {
    player.armorDur = Math.max(0, player.armorDur - dmg);
    dmg *= 0.55; // 45% 경감
    if (player.armorDur <= 0) addFeed('방탄복 파손');
  }
  player.hp -= dmg;
  sfx.playerHit();
  dom.damageVignette.style.opacity = '1';
  setTimeout(() => { dom.damageVignette.style.opacity = '0'; }, 120);
  if (player.hp <= 0) {
    player.hp = 0;
    endRaid('death', '스캐브에게 사살당했습니다.');
  }
}

// 원샷 모션(피격/사격/재장전/구르기) 재생 — 서서 정지 상태일 때만
// (이동 중엔 발 미끄러짐, 앉은 상태엔 서서 하는 모션이 튐)
function playEnemyOneShot(e, act, fade = 0.06) {
  if (!act || e.running || e.crouched || e.dead) return false;
  // 진행 중인 다른 원샷은 페이드아웃 (그 액션의 finished 는 oneShot 불일치로 무시됨)
  for (const a of [e.actHitChest, e.actHitHead, e.actShoot, e.actReload, e.actRoll, e.actAlert]) {
    if (a && a !== act && a.isRunning()) a.fadeOut(fade);
  }
  if (e.baseAct && !e.oneShot) e.baseAct.fadeOut(fade);
  e.oneShot = act;
  act.reset().fadeIn(fade).play();
  return true;
}

// 피격 반응: 서서 교전 중이면 가끔 측면 회피 구르기, 아니면 부위별 Hit 원샷,
// 이동/앉은 상태면 절차 flinch
function enemyHitReact(e, headshot) {
  if (e.state === 'combat' && e.rollT <= 0 && Math.random() < 0.3 &&
      playEnemyOneShot(e, e.actRoll, 0.08)) {
    const toP = player.pos.clone().sub(e.pos); toP.y = 0; toP.normalize();
    const side = Math.random() < 0.5 ? 1 : -1;
    e.rollDir = new THREE.Vector3(-toP.z * side, 0, toP.x * side); // 측면 방향
    e.rollT = e.actRoll.getClip().duration * 0.9; // 마무리 프레임은 정지 동작
    return;
  }
  if (!playEnemyOneShot(e, headshot ? e.actHitHead : e.actHitChest)) {
    e.flinch = 1;
    e.flinchSide = Math.random() < 0.5 ? -1 : 1;
  }
}

function killEnemy(e) {
  e.dead = true;
  if (e.actDeath) {
    // UAL Death01 모션캡처 재생 (Hips 이동 포함 — 바닥까지 모션이 표현)
    for (const a of [e.actIdle, e.actRun, e.actWalk, e.actLimp, e.actCrouch, e.actHitChest, e.actHitHead,
      e.actShoot, e.actReload, e.actRoll, e.actAlert]) {
      if (a && a.isRunning()) a.fadeOut(0.1);
    }
    if (e.actAimUp) e.actAimUp.setEffectiveWeight(0);
    if (e.actAimDown) e.actAimDown.setEffectiveWeight(0);
    e.actDeath.reset().fadeIn(0.1).play();
  } else {
    // 폴백: 절차적 쓰러짐 (방향 랜덤 + 요 드리프트)
    e.dying = 0;
    const side = Math.random();
    e.fallAxis = side < 0.6 ? 'back' : (side < 0.8 ? 'left' : 'right');
    e.fallYaw = (Math.random() - 0.5) * 0.9;
    e.mixer.timeScale = 0; // 현재 포즈에서 정지
  }
  state.kills++;
  sfx.enemyDeath();
  addFeed(e.boss ? '보스 사살! 시체에서 전리품을 회수하세요' : '스캐브 사살');
  if (e.boss) sfx.death(); // 저역 붐으로 강조
  e.flash.intensity = 0;
  e.body.userData = {}; e.head.userData = {};
  corpses.push(e.group);
  // 시체 루팅
  interactables.push({
    pos: e.pos.clone().setY(e.pos.y + 0.4), mesh: e.body, lamp: null,
    items: e.boss
      ? [{ name: '보스 전리품', value: 120000 }, ...rollItems(2, 3),
         ...(Math.random() < 0.3 ? [{ name: '방탄복(회수)', value: 45000 }] : [])]
      : rollItems(1, 3),
    opened: false, label: e.boss ? '보스 시체' : '스캐브 시체',
    raidObject: true,
  });
}

function alertEnemiesAround(pos, range) {
  for (const e of enemies) {
    if (e.dead || e.state === 'combat') continue;
    if (e.pos.distanceTo(pos) < range) {
      e.lastKnown.copy(pos);
      e.state = 'chase';
    }
  }
}

// ============================================================
// 탈출 지점
// ============================================================
const EXTRACT_CANDIDATES = [
  { name: '북동 게이트', pos: new THREE.Vector3(76, 0, -76) },
  { name: '남서 통로', pos: new THREE.Vector3(-76, 0, 76) },
  { name: '남동 담장', pos: new THREE.Vector3(76, 0, 76) },
  { name: '북서 수풀', pos: new THREE.Vector3(-76, 0, -76) },
];

function setupExtractions(spawnPos) {
  // 스폰에서 먼 순서로 2곳 활성화
  const sorted = [...EXTRACT_CANDIDATES].sort(
    (a, b) => b.pos.distanceTo(spawnPos) - a.pos.distanceTo(spawnPos));
  for (const cand of sorted.slice(0, 2)) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x51ff7a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(cand.pos.x, 20, cand.pos.z);
    scene.add(beam);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(EXTRACT_RADIUS - 0.4, EXTRACT_RADIUS, 40),
      new THREE.MeshBasicMaterial({ color: 0x51ff7a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cand.pos.x, 0.05, cand.pos.z);
    scene.add(ring);
    const light = new THREE.PointLight(0x51ff7a, 30, 18, 2);
    light.position.set(cand.pos.x, 3, cand.pos.z);
    scene.add(light);
    extractions.push({ name: cand.name, pos: cand.pos.clone(), beam, ring, light, progress: 0 });
  }
}

let extractTickAcc = 0;
function updateExtraction(dt) {
  let inZone = null;
  for (const ex of extractions) {
    const d = Math.hypot(player.pos.x - ex.pos.x, player.pos.z - ex.pos.z);
    if (d < EXTRACT_RADIUS) { inZone = ex; break; }
  }
  if (inZone) {
    inZone.progress += dt;
    extractTickAcc += dt;
    if (extractTickAcc > 1) { extractTickAcc = 0; sfx.extractTick(); }
    dom.extractProgress.style.display = 'block';
    dom.extractLabel.textContent = `${inZone.name} — 탈출 진행 중`;
    dom.extractFill.style.width = `${Math.min(100, inZone.progress / EXTRACT_HOLD * 100)}%`;
    if (inZone.progress >= EXTRACT_HOLD) {
      sfx.extractDone();
      endRaid('extract');
      return;
    }
  } else {
    dom.extractProgress.style.display = 'none';
    for (const ex of extractions) ex.progress = 0;
  }
  // 비컨 펄스
  const t = performance.now() * 0.002;
  for (const ex of extractions) {
    ex.beam.material.opacity = 0.25 + Math.sin(t * 2) * 0.1;
  }
}

// ============================================================
// 플레이어 이동/충돌
// ============================================================
function resolveHorizontal(pos, radius, yBottom, yTop) {
  for (const b of colliders) {
    if (pos.y + yTop < b.minY || pos.y + yBottom > b.maxY) continue;
    // yaw 로컬 프레임에서 AABB 해소 후 월드로 복귀
    const dx = pos.x - b.cx, dz = pos.z - b.cz;
    const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;
    const ex = b.hx + radius, ez = b.hz + radius;
    if (lx <= -ex || lx >= ex || lz <= -ez || lz >= ez) continue;
    // 스텝업: 낮은 단차(계단)는 밀어내지 않고 올라섬
    const rise = b.maxY - pos.y;
    if (rise > 0 && rise <= 0.55) { pos.y = b.maxY; continue; }
    const dxL = lx + ex, dxR = ex - lx;
    const dzL = lz + ez, dzR = ez - lz;
    const m = Math.min(dxL, dxR, dzL, dzR);
    let nx = lx, nz = lz;
    if (m === dxL) nx = -ex;
    else if (m === dxR) nx = ex;
    else if (m === dzL) nz = -ez;
    else nz = ez;
    pos.x = b.cx + b.c * nx + b.s * nz;
    pos.z = b.cz - b.s * nx + b.c * nz;
  }
}

function updatePlayer(dt) {
  const prevPX = player.pos.x, prevPZ = player.pos.z; // 실제 변위 계측용
  // --- 방향 입력 (키보드 + 터치 조이스틱) ---
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const wish = new THREE.Vector3();
  if (keys['KeyW']) wish.add(fwd);
  if (keys['KeyS']) wish.sub(fwd);
  if (keys['KeyD']) wish.add(right);
  if (keys['KeyA']) wish.sub(right);
  if (touch.moveX || touch.moveY) {
    wish.addScaledVector(fwd, -touch.moveY);
    wish.addScaledVector(right, touch.moveX);
  }
  const hasInput = wish.lengthSq() > 0.001;
  if (hasInput) wish.normalize();

  // --- 지구력 / 달리기 ---
  const wantSprint = ((keys['ShiftLeft'] && keys['KeyW']) || touch.sprint) && hasInput && !player.aiming;
  if (wantSprint && player.stamina > 1) {
    player.sprinting = true;
    player.stamina = Math.max(0, player.stamina - 17 * dt);
    if (player.stamina <= 0) player.sprinting = false;
  } else {
    player.sprinting = false;
    player.stamina = Math.min(100, player.stamina + 13 * dt);
  }
  const speed = PLAYER.walkSpeed * (player.sprinting ? PLAYER.sprintMult : 1) * (player.aiming ? 0.55 : 1);

  // --- 수평 가속 ---
  const targetVx = wish.x * speed, targetVz = wish.z * speed;
  const a = player.grounded ? PLAYER.accel : PLAYER.accel * 0.25;
  player.vel.x += THREE.MathUtils.clamp(targetVx - player.vel.x, -a * dt, a * dt);
  player.vel.z += THREE.MathUtils.clamp(targetVz - player.vel.z, -a * dt, a * dt);

  // --- 중력 / 점프 ---
  player.vel.y -= PLAYER.gravity * dt;
  if ((keys['Space'] || touch.jump) && player.grounded && player.stamina > 10) {
    player.vel.y = PLAYER.jumpVel;
    player.stamina -= 8;
    player.grounded = false;
  }
  touch.jump = false; // 1회성 소비

  // --- 적용 + 충돌 ---
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;

  // 수직: 박스 위 착지 판정
  const prevY = player.pos.y;
  const wasGrounded = player.grounded;
  const fallVel = player.vel.y;
  player.pos.y += player.vel.y * dt;
  player.grounded = false;
  {
    const gh = terrainH(player.pos.x, player.pos.z);
    if (player.pos.y <= gh) { player.pos.y = gh; player.vel.y = 0; player.grounded = true; }
  }

  for (const b of colliders) {
    const r = PLAYER.radius;
    const dx = player.pos.x - b.cx, dz = player.pos.z - b.cz;
    const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;
    if (Math.abs(lx) < b.hx + r && Math.abs(lz) < b.hz + r) {
      // 위에서 떨어져 착지
      if (player.vel.y <= 0 && prevY >= b.maxY - 0.01 && player.pos.y < b.maxY && b.maxY < prevY + 0.6) {
        player.pos.y = b.maxY; player.vel.y = 0; player.grounded = true;
      }
      // 아래에서 머리 충돌
      else if (player.vel.y > 0 && player.pos.y + PLAYER.height > b.minY && prevY + PLAYER.height <= b.minY) {
        player.pos.y = b.minY - PLAYER.height; player.vel.y = 0;
      }
    }
  }
  resolveHorizontal(player.pos, PLAYER.radius, 0.25, PLAYER.height);
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -WORLD_HALF + 1.2, WORLD_HALF - 1.2);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -WORLD_HALF + 1.2, WORLD_HALF - 1.2);

  // 지형 추종: 수평 이동 후 최종 위치의 지형 높이로 오르막 밀어올림 /
  // 완만한 내리막 스냅 (경사에서 grounded 플리커·발소리 끊김 방지)
  {
    const gh = terrainH(player.pos.x, player.pos.z);
    if (player.pos.y < gh) {
      player.pos.y = gh;
      if (player.vel.y < 0) player.vel.y = 0;
      player.grounded = true;
    } else if (!player.grounded && wasGrounded && player.vel.y <= 0 && player.pos.y - gh < 0.35) {
      player.pos.y = gh; player.vel.y = 0; player.grounded = true;
    }
  }

  // 착지음
  if (!wasGrounded && player.grounded && fallVel < -4) sfx.land();

  // --- 카메라 ---
  camera.position.set(player.pos.x, player.pos.y + PLAYER.eye, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // 이동 헤드밥 + 발소리 — 의도 속도(vel)가 아닌 실제 변위 기준
  // (벽에 막혀 제자리인데 발소리/밥이 계속 나던 문제)
  const hSpeed = Math.hypot(player.pos.x - prevPX, player.pos.z - prevPZ) / Math.max(dt, 1e-4);
  if (player.grounded && hSpeed > 0.5) {
    bobPhase += dt * hSpeed * 1.7;
    camera.position.y += Math.sin(bobPhase) * 0.028 * (player.sprinting ? 1.4 : 1);
    stepAcc += hSpeed * dt;
    const stepLen = player.sprinting ? 3.1 : 2.3;
    if (stepAcc >= stepLen) {
      stepAcc = 0;
      sfx.footstep(player.sprinting, player.pos.y > terrainH(player.pos.x, player.pos.z) + 0.05);
    }
  } else if (!player.grounded) {
    stepAcc = 0.6; // 착지 직후 첫 걸음이 빨리 나오게
  }

  // ADS FOV
  const targetFov = player.aiming ? GUN.adsFov * (currentAtt.includes('scope') ? 0.55 : 1) : (player.sprinting ? 81 : 75);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  player.healCooldown = Math.max(0, player.healCooldown - dt);
}
let bobPhase = 0;
let stepAcc = 0;

// ============================================================
// 총기 (뷰모델 + 사격)
// ============================================================
const gunGroup = new THREE.Group();
const muzzleLocal = new THREE.Vector3(0, 0, -0.6); // buildViewmodel 에서 실측으로 갱신

// Quaternius 총기 재질이 지나치게 어두워 (linear ~0.03) 밝기 보정
function brightenMaterials(model, factor) {
  const seen = new Set();
  model.traverse((o) => {
    if (o.isMesh && o.material && !seen.has(o.material)) {
      o.material = o.material.clone();
      if (o.material.metalnessMap) {
        // 리얼 PBR 총기(#101): 색 곱은 과노출 — 환경 반사만 보강 (scene.environmentIntensity 0.22 보상)
        o.material.envMapIntensity = 1.0;
      } else {
        o.material.color.multiplyScalar(factor);
      }
      seen.add(o.material);
    }
  });
}

// GLB 원점이 메시 중심이 아닌 경우가 있어 최장축 기준 스케일 후 중심을 원점으로 재정렬
function normalizeModel(model, targetLen, rotY) {
  const bb0 = new THREE.Box3().setFromObject(model);
  const sz = bb0.getSize(new THREE.Vector3());
  model.scale.setScalar(targetLen / Math.max(0.001, sz.x, sz.y, sz.z));
  model.rotation.y = rotY;
  model.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(model);
  const c = bb.getCenter(new THREE.Vector3());
  model.position.sub(c);
  return bb.getSize(new THREE.Vector3());
}

// 뷰모델 (Quaternius 총기) — 무기별로 1회 구성, equipWeapon 으로 전환
const VIEWMODELS = {}; // key → { model, muzzle, adsPos }
function buildViewmodel() {
  for (const w of Object.values(WEAPONS)) {
    const m = instantiate(w.model);
    const size = normalizeModel(m, w.viewLen, Math.PI / 2); // +X 총구 → -Z (카메라 전방)
    brightenMaterials(m, 3.2);
    m.traverse((o) => { o.frustumCulled = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    m.visible = false;
    gunGroup.add(m);
    // ADS 정렬: 총 상단 능선(가늠선)이 카메라 y=0(탄도)에 오도록 실측 (#36 방식)
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    // 부착물 메시 (기본 숨김 — equipWeapon 에서 로드아웃대로 표시)
    const atts = {};
    let scopeExtra = 0;
    for (const att of Object.values(ATTACHMENTS)) {
      if (!att.compat.includes(w.key)) continue;
      const { am, topExtra } = attachToGun(m, size, bb, att.key);
      if (att.key === 'scope') scopeExtra = topExtra;
      am.visible = false;
      atts[att.key] = am;
    }
    VIEWMODELS[w.key] = {
      model: m,
      muzzle: new THREE.Vector3(0, size.y * 0.25, -size.z / 2),
      adsPos: new THREE.Vector3(0, -bb.max.y, -0.66),
      atts, scopeExtra,
    };
  }
  equipWeapon(GUN.key, false);
}

function equipWeapon(key, announce = true) {
  const w = WEAPONS[key];
  if (!w || !VIEWMODELS[key]) return;
  for (const vm of Object.values(VIEWMODELS)) vm.model.visible = false;
  const vm = VIEWMODELS[key];
  vm.model.visible = true;
  muzzleLocal.copy(vm.muzzle);
  GUN_ADS.copy(vm.adsPos);
  // 부착물 표시 + 스코프 장착 시 가늠선(스코프 상단) 정렬 보정
  currentAtt = attLoadout(key);
  for (const [ak, am] of Object.entries(vm.atts || {})) am.visible = currentAtt.includes(ak);
  if (currentAtt.includes('scope')) GUN_ADS.y -= vm.scopeExtra || 0;
  // 무기별 탄약 상태 저장/복원 (레이드 중 교체 시 유지)
  if (GUN && GUN.key !== key && weaponAmmo[GUN.key]) {
    weaponAmmo[GUN.key] = { mag: gun.mag, reserve: gun.reserve };
  }
  GUN = w;
  const ammo = weaponAmmo[key];
  gun.mag = ammo ? ammo.mag : w.magSize;
  gun.reserve = ammo ? ammo.reserve : w.reserveMax;
  gun.reloading = 0;
  gun.cooldown = 0;
  if (announce) { addFeed(`${w.name} 장착`); sfx.reload2(); }
}

// 무기 순환 교체 (모바일 버튼)
function cycleWeapon() {
  if (carry.length < 2) return;
  const i = carry.indexOf(GUN.key);
  equipWeapon(carry[(i + 1) % carry.length]);
}

// 1/2/3 키 무기 교체
function switchWeapon(slot) {
  const key = carry[slot];
  if (!key || key === GUN.key) return;
  equipWeapon(key);
}
camera.add(gunGroup);
scene.add(camera);
const muzzleFlashLight = new THREE.PointLight(0xffc070, 0, 8, 2);
camera.add(muzzleFlashLight);
muzzleFlashLight.position.set(0.22, -0.18, -0.9);

const GUN_HIP = new THREE.Vector3(0.27, -0.24, -0.58);
let scopeHold = 0;   // 스코프 ADS 유지 시간 (#104)
let scopeShown = false;
// ADS 위치는 무기별로 equipWeapon 에서 실측 갱신 (#36 정렬 방식)
const GUN_ADS = new THREE.Vector3(0, -0.126, -0.66);

function updateGun(dt) {
  gun.cooldown = Math.max(0, gun.cooldown - dt);

  // 재장전
  if (gun.reloading > 0) {
    gun.reloading -= dt;
    dom.gunState.textContent = '재장전 중...';
    if (gun.reloading <= 0) {
      const need = GUN.magSize - gun.mag;
      const take = Math.min(need, gun.reserve);
      gun.mag += take; gun.reserve -= take;
      sfx.reload2();
      dom.gunState.textContent = '';
    }
  }

  // 자동 사격
  if (gun.triggerDown && (GUN.auto || !gun.semiLatch) && state.phase === 'raid' && gun.reloading <= 0 && gun.cooldown <= 0) {
    if (gun.mag > 0) fireShot();
    else { sfx.dryFire(); gun.cooldown = 0.25; startReload(); }
  }

  // 뷰모델 위치 보간 (ADS/힙)
  const target = player.aiming ? GUN_ADS : GUN_HIP;
  gunGroup.position.lerp(target, Math.min(1, dt * 14));

  // 스코프 조준 화면 (#104): 스코프 장착 무기·저격총은 조준이 자리잡으면
  // 뷰모델이 시야를 가리므로 숨기고 오버레이(원형 마스크+레티클)로 전환
  const scopeCapable = currentAtt.includes('scope') || GUN.key === 'sniper';
  scopeHold = player.aiming && scopeCapable && state.phase === 'raid' ? scopeHold + dt : 0;
  const scopedNow = scopeHold > 0.12;
  if (scopedNow !== scopeShown) {
    scopeShown = scopedNow;
    dom.scopeOverlay.style.display = scopedNow ? 'block' : 'none';
    gunGroup.visible = !scopedNow;
  }

  // 스프린트 자세 (총구 내림) 블렌드
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  const wantSprintPose = player.sprinting && !player.aiming && hSpeed > 3 ? 1 : 0;
  gun.sprintBlend += (wantSprintPose - gun.sprintBlend) * Math.min(1, dt * 8);
  const sp = gun.sprintBlend;
  gunGroup.position.x += sp * 0.06;
  gunGroup.position.y += sp * -0.05;
  gunGroup.position.z += sp * 0.10;

  // 재장전 모션: 내려가며 굴렀다가 (탄창 교체) 올라옴
  let rlRotZ = 0, rlRotX = 0;
  if (gun.reloading > 0) {
    const p = 1 - gun.reloading / GUN.reloadTime; // 0→1
    const dip = Math.sin(Math.PI * Math.min(1, p * 1.12)); // 위상 살짝 앞당겨 마지막에 원위치
    gunGroup.position.y -= dip * 0.16;
    gunGroup.position.x += dip * 0.05;
    rlRotZ = -dip * 0.55;
    rlRotX = dip * 0.25 + (p > 0.45 && p < 0.6 ? Math.sin((p - 0.45) / 0.15 * Math.PI) * 0.07 : 0); // 탄창 삽입 툭
  }

  // 스웨이 감쇠
  gun.swayX += -gun.swayX * Math.min(1, dt * 9);
  gun.swayY += -gun.swayY * Math.min(1, dt * 9);
  const swayScale = player.aiming ? 0.35 : 1;
  gunGroup.position.x += gun.swayX * 0.6 * swayScale;
  gunGroup.position.y += gun.swayY * 0.5 * swayScale;

  // 반동 회복 + 밥 + 회전 합성
  gun.recoil = Math.max(0, gun.recoil - dt * 3);
  gunGroup.position.z += gun.recoil * 0.06;
  gunGroup.rotation.set(
    gun.recoil * 0.10 + rlRotX + sp * 0.35 + gun.swayY * 1.4 * swayScale,
    gun.swayX * 1.6 * swayScale + sp * 0.25,
    rlRotZ + sp * -0.12,
  );
  if (player.grounded && hSpeed > 0.5 && !player.aiming) {
    gunGroup.position.y += Math.sin(bobPhase * 0.98) * (0.006 + sp * 0.006);
    gunGroup.position.x += Math.cos(bobPhase * 0.49) * 0.004;
  }

  muzzleFlashLight.intensity *= Math.pow(0.001, dt * 6);
  if (muzzleFlashLight.intensity < 0.5) muzzleFlashLight.intensity = 0;
}

function startReload() {
  if (gun.reloading > 0 || gun.mag >= GUN.magSize || gun.reserve <= 0) return;
  gun.reloading = GUN.reloadTime;
  sfx.reload1();
}

const _shootRay = new THREE.Raycaster();
function fireShot() {
  gun.mag--;
  gun.cooldown = GUN.fireInterval;
  const gripK = currentAtt.includes('grip') ? 0.6 : 1;
  gun.recoil = Math.min(1.6, gun.recoil + GUN.recoil * gripK);
  gun.semiLatch = true; // 단발 무기는 클릭당 1발
  player.pitch += GUN.kick * gripK + Math.random() * 0.004;
  player.yaw += (Math.random() - 0.5) * 0.004;
  sfx.shoot();
  muzzleFlashLight.intensity = currentAtt.includes('silencer') ? 10 : 40;
  alertEnemiesAround(player.pos, currentAtt.includes('silencer') ? 16 : 60);

  // 탄퍼짐
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  let spread = player.aiming ? GUN.spreadAds : GUN.spreadHip;
  spread += Math.min(1, hSpeed / 8) * GUN.spreadMove * (currentAtt.includes('grip') ? 0.5 : 1);

  const baseDir = new THREE.Vector3();
  camera.getWorldDirection(baseDir);
  const origin = playerEyePos();
  const muzzle = gunGroup.localToWorld(muzzleLocal.clone());
  const targets = [...obstacleMeshes];
  for (const e of enemies) if (!e.dead) targets.push(e.body, e.head);

  let anyHit = false;
  for (let p = 0; p < GUN.pellets; p++) {
    const dir = baseDir.clone();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    _shootRay.set(origin, dir);
    _shootRay.far = GUN.range;
    const hits = _shootRay.intersectObjects(targets, false);
    let endPoint = origin.clone().add(dir.clone().multiplyScalar(GUN.range));
    if (hits.length > 0) {
      const h = hits[0];
      endPoint = h.point;
      const ud = h.object.userData;
      if (ud && ud.enemy && !ud.enemy.dead) {
        const dmg = ud.part === 'head' ? GUN.damageHead : GUN.damageBody;
        ud.enemy.hp -= dmg;
        if (ud.enemy.hp > 0) enemyHitReact(ud.enemy, ud.part === 'head');
        // 피격당한 적은 즉시 교전 상태
        ud.enemy.lastKnown.copy(player.pos);
        if (ud.enemy.hp <= 0) killEnemy(ud.enemy);
        else ud.enemy.state = 'combat';
        anyHit = true;
      }
    }
    spawnTracer(muzzle, endPoint, 0xffe0a0);
  }
  if (anyHit) {
    showHitmarker();
    sfx.hitmarker();
  }
}

function showHitmarker() {
  dom.hitmarker.style.opacity = '1';
  setTimeout(() => { dom.hitmarker.style.opacity = '0'; }, 80);
}

// ============================================================
// 트레이서 / 이펙트
// ============================================================
function spawnTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, life: 0.07 });
}

function updateEffects(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose(); t.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (const e of enemies) {
    if (e.flash.intensity > 0) e.flash.intensity *= Math.pow(0.001, dt * 5);
  }
}

// ============================================================
// 상호작용 / 인벤토리
// ============================================================
function nearestInteractable() {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  let best = null, bestD = 2.9;
  for (const it of interactables) {
    if (it.opened) continue;
    const d = it.pos.distanceTo(player.pos);
    if (d > bestD) continue;
    const dir = it.pos.clone().sub(playerEyePos()).normalize();
    if (fwd.dot(dir) < 0.25 && d > 1.2) continue;
    best = it; bestD = d;
  }
  return best;
}

function lootInteractable(it) {
  it.opened = true;
  if (it.mesh) it.mesh.traverse((o) => { if (o.isMesh) o.material = MAT.lootOpened; });
  if (it.lamp) it.lamp.visible = false;
  sfx.pickup();
  if (it.label === '보급 상자' && Math.random() < 0.1) {
    const st = loadStash();
    const owned = st.weapons || ['rifle'];
    const cand = Object.keys(WEAPONS).filter((k) => !owned.includes(k) && !carry.includes(k));
    if (cand.length) {
      const k = cand[Math.floor(Math.random() * cand.length)];
      carry.push(k);
      weaponAmmo[k] = { mag: WEAPONS[k].magSize, reserve: WEAPONS[k].reserveMax };
      gun.foundWeapons = [...(gun.foundWeapons || []), k]; // 탈출해야 소유 확정
      equipWeapon(k);
      addFeed(`${WEAPONS[k].name} 발견!`);
    }
  }
  for (const item of it.items) {
    if (item.ammo) {
      gun.reserve += item.ammo;
      addFeed(`+${item.ammo} 탄약`);
    } else {
      inventory.push({ name: item.name, value: item.value, heal: item.heal });
      addFeed(`${item.name} 획득 (₽${item.value.toLocaleString('ko-KR')})`);
    }
  }
  refreshInventoryUI();
}

function useHeal() {
  if (player.healCooldown > 0 || player.hp >= PLAYER.maxHp) return;
  // 붕대 우선, 없으면 구급킷
  let idx = inventory.findIndex(i => i.heal && i.heal <= 30);
  if (idx === -1) idx = inventory.findIndex(i => i.heal);
  if (idx === -1) { addFeed('치료 아이템 없음'); return; }
  const item = inventory.splice(idx, 1)[0];
  player.hp = Math.min(PLAYER.maxHp, player.hp + item.heal);
  player.healCooldown = 1.2;
  sfx.heal();
  addFeed(`${item.name} 사용 (+${item.heal} HP)`);
  refreshInventoryUI();
}

function inventoryValue() {
  return inventory.reduce((s, i) => s + i.value, 0);
}

function refreshInventoryUI() {
  dom.lootValue.textContent = inventoryValue().toLocaleString('ko-KR');
  const groups = {};
  for (const i of inventory) {
    groups[i.name] = groups[i.name] || { n: 0, v: 0 };
    groups[i.name].n++; groups[i.name].v += i.value;
  }
  dom.invList.innerHTML = Object.entries(groups).map(([name, g]) =>
    `<div class="item"><span>${name}${g.n > 1 ? ` ×${g.n}` : ''}</span><span class="val">₽ ${g.v.toLocaleString('ko-KR')}</span></div>`
  ).join('') || '<div style="opacity:0.5">비어 있음</div>';
  dom.invTotal.textContent = `₽ ${inventoryValue().toLocaleString('ko-KR')}`;
}

function addFeed(text) {
  const div = document.createElement('div');
  div.textContent = text;
  dom.killfeed.prepend(div);
  setTimeout(() => div.remove(), 5000);
  while (dom.killfeed.children.length > 6) dom.killfeed.lastChild.remove();
}

// ============================================================
// 나침반
// ============================================================
const compassMarks = [];
function setupCompass() {
  dom.compass.innerHTML = '';
  compassMarks.length = 0;
  const cardinals = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  for (const [label, bearing] of cardinals) {
    const el = document.createElement('div');
    el.className = 'compass-mark';
    el.textContent = label;
    dom.compass.appendChild(el);
    compassMarks.push({ el, bearing, fixed: true });
  }
  for (const ex of extractions) {
    const el = document.createElement('div');
    el.className = 'compass-mark compass-extract';
    dom.compass.appendChild(el);
    compassMarks.push({ el, ex });
  }
}

function updateCompass() {
  const heading = -THREE.MathUtils.radToDeg(player.yaw);
  for (const m of compassMarks) {
    let bearing = m.bearing;
    let text = null;
    if (m.ex) {
      const dx = m.ex.pos.x - player.pos.x, dz = m.ex.pos.z - player.pos.z;
      bearing = THREE.MathUtils.radToDeg(Math.atan2(dx, -dz));
      text = `◈<br>${Math.round(Math.hypot(dx, dz))}m`;
    }
    let rel = ((bearing - heading) % 360 + 360) % 360;
    if (rel > 180) rel -= 360;
    if (Math.abs(rel) < 58) {
      m.el.style.display = 'block';
      m.el.style.left = `${190 + rel / 58 * 185}px`;
      if (text !== null && m.el.innerHTML !== text) m.el.innerHTML = text;
    } else {
      m.el.style.display = 'none';
    }
  }
}

// ============================================================
// 레이드 라이프사이클
// ============================================================
const SPAWN_POINTS = [
  new THREE.Vector3(0, 0, 82), new THREE.Vector3(0, 0, -82),
  new THREE.Vector3(82, 0, 0), new THREE.Vector3(-82, 0, 0),
];

let staticBuilt = false;

function clearRaidObjects() {
  for (const e of enemies) scene.remove(e.group);
  enemies = [];
  for (const it of interactables) {
    if (it.mesh && it.mesh.userData.raidObject) scene.remove(it.mesh);
    if (it.lamp) scene.remove(it.lamp);
  }
  interactables = [];
  for (const ex of extractions) { scene.remove(ex.beam); scene.remove(ex.ring); scene.remove(ex.light); }
  extractions = [];
  for (const t of tracers) scene.remove(t.line);
  tracers = [];
  for (const c of corpses) scene.remove(c);
  corpses = [];
}

function startRaid() {
  if (!assetsReady) return;
  if (!staticBuilt) { buildStaticMap(); staticBuilt = true; }
  clearRaidObjects();

  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  player.pos.copy(spawn);
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(spawn.x, spawn.z); // 맵 중앙(0,0)을 바라보게
  player.pitch = 0;
  player.hp = PLAYER.maxHp;
  player.stamina = 100;

  const stash0 = loadStash();
  const owned0 = (stash0.weapons || ['rifle']).filter((k) => WEAPONS[k]);
  carry = ['rifle', ...owned0.filter((k) => k !== 'rifle')]; // 1번 슬롯은 항상 소총
  for (const k of Object.keys(weaponAmmo)) delete weaponAmmo[k];
  for (const k of carry) weaponAmmo[k] = { mag: WEAPONS[k].magSize, reserve: WEAPONS[k].reserveMax };
  const eq = stash0.equipped && carry.includes(stash0.equipped) ? stash0.equipped : 'rifle';
  equipWeapon(eq, false); // mag/reserve/reload 리셋 포함
  gun.triggerDown = false;
  gun.semiLatch = false;
  gun.foundWeapons = [];
  player.armorDur = Math.min(ARMOR_MAX, stash0.armorDur || 0);
  player.helmet = !!stash0.helmet;
  player.aiming = false;
  if (IS_MOBILE) $('tb-ads').classList.remove('active');

  inventory = [];
  // 상점에서 지참 구매한 구급킷 반입 (소모)
  const meds = stash0.medkits || 0;
  if (meds > 0) {
    for (let i = 0; i < meds; i++) inventory.push({ name: '구급킷', value: 14000, heal: 60 });
    stash0.medkits = 0;
    saveStash(stash0);
    addFeed(`구급킷 ${meds}개 지참`);
  }
  state.kills = 0;
  state.raidTime = RAID_SECONDS;
  state.phase = 'raid';
  state.paused = false;

  spawnLoot();
  spawnEnemies(spawn);
  setupExtractions(spawn);
  setupCompass();
  refreshInventoryUI();

  dom.killfeed.innerHTML = '';
  dom.menu.style.display = 'none';
  dom.death.style.display = 'none';
  dom.extract.style.display = 'none';
  dom.hud.style.display = 'block';
  dom.inventory.style.display = 'none';

  lockPointer();
  ambientStart();
  const activeNames = extractions.map(e => e.name).join(', ');
  addFeed(`활성 탈출구: ${activeNames}`);
}

function summaryHTML() {
  const groups = {};
  for (const i of inventory) {
    groups[i.name] = groups[i.name] || { n: 0, v: 0 };
    groups[i.name].n++; groups[i.name].v += i.value;
  }
  const rows = Object.entries(groups).map(([name, g]) =>
    `${name}${g.n > 1 ? ` ×${g.n}` : ''} — <span class="val">₽ ${g.v.toLocaleString('ko-KR')}</span>`);
  return rows.join('<br>') || '(획득한 전리품 없음)';
}

function endRaid(result, cause) {
  if (state.phase !== 'raid') return;
  state.phase = result === 'extract' ? 'extracted' : 'dead';
  ambientStop();
  document.exitPointerLock?.(); // iOS Safari 는 Pointer Lock API 자체가 없음
  dom.hud.style.display = 'none';
  gun.triggerDown = false;

  const stash = loadStash();
  stash.raids = (stash.raids || 0) + 1;
  stash.kills = (stash.kills || 0) + state.kills;

  if (result === 'extract') {
    const value = inventoryValue();
    stash.extracts = (stash.extracts || 0) + 1;
    stash.roubles = (stash.roubles || 0) + value;
    // 레이드 중 습득한 무기 소유 확정 + 장착 유지
    const owned = new Set(stash.weapons || ['rifle']);
    for (const k of (gun.foundWeapons || [])) owned.add(k);
    stash.weapons = [...owned];
    stash.equipped = GUN.key;
    stash.armorDur = player.armorDur;
    stash.helmet = player.helmet;
    saveStash(stash);
    const used = RAID_SECONDS - state.raidTime;
    dom.extractStats.innerHTML =
      `레이드 시간 ${fmtTime(used)} · 사살 ${state.kills} · 획득 가치 <b style="color:#d9c86a">₽ ${value.toLocaleString('ko-KR')}</b>`;
    dom.extractLoot.innerHTML = summaryHTML();
    dom.extract.style.display = 'flex';
  } else {
    // 사망: 구매/습득 무기 전부 손실 — 기본 소총으로 복귀
    stash.weapons = ['rifle'];
    stash.equipped = 'rifle';
    stash.armorDur = 0;
    stash.helmet = false;
    stash.attOwned = [];
    stash.attachments = {};
    saveStash(stash);
    sfx.death();
    dom.deathCause.textContent = cause || '사망했습니다.';
    dom.deathLoot.innerHTML =
      `<div style="color:#d94f3d; margin-bottom:8px">상실한 전리품 (₽ ${inventoryValue().toLocaleString('ko-KR')})</div>` + summaryHTML();
    dom.death.style.display = 'flex';
  }
  updateMenuStash();
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ============================================================
// 입력
// ============================================================
function lockPointer() {
  if (IS_MOBILE) return; // 모바일은 터치 시선 — 포인터락 불필요
  try {
    // unadjustedMovement: OS 마우스 가속 배제 (raw input) — 빠른 플릭 시 튐 방지
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) {
      p.catch(() => {
        try {
          const q = canvas.requestPointerLock(); // 미지원 브라우저 폴백
          if (q && q.catch) q.catch(() => {});
        } catch { /* ignore */ }
      });
    }
  } catch {
    try {
      const q = canvas.requestPointerLock(); // 옵션 인자 미지원 폴백
      if (q && q.catch) q.catch(() => {});
    } catch { /* 자동화 환경 등에서 실패해도 게임은 진행 */ }
  }
}

// ---------- 터치 입력 (모바일) ----------
const touch = { moveX: 0, moveY: 0, sprint: false, jump: false };
if (IS_MOBILE) {
  const joyEl = $('joystick');
  const knobEl = $('joystick-knob');
  const JOY_R = 46; // 노브 최대 변위(px)

  // 가상 조이스틱 — 끝까지 밀면 스프린트
  let joyId = null;
  const joyUpdate = (t) => {
    const r = joyEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, JOY_R);
    if (len > 0) { dx = dx / len * clamped; dy = dy / len * clamped; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.moveX = dx / JOY_R;
    touch.moveY = dy / JOY_R;
    touch.sprint = clamped > JOY_R * 0.92 && touch.moveY < -0.35;
  };
  const joyReset = () => {
    joyId = null;
    touch.moveX = 0; touch.moveY = 0; touch.sprint = false;
    knobEl.style.transform = 'translate(0px, 0px)';
  };
  joyEl.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joyId === null) { joyId = e.changedTouches[0].identifier; joyUpdate(e.changedTouches[0]); }
  }, { passive: false });
  joyEl.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === joyId) joyUpdate(t);
  }, { passive: false });
  for (const ev of ['touchend', 'touchcancel']) {
    joyEl.addEventListener(ev, (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) joyReset();
    });
  }

  // 시선 드래그 — 버튼/조이스틱 밖(캔버스로 떨어지는 터치) 전부
  const looks = new Map(); // id → {x, y}
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    audio(); // 첫 제스처에서 AudioContext resume
    for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY });
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (state.phase !== 'raid' || state.paused) return;
    const sens = 0.0042 * (player.aiming ? 0.6 : 1);
    for (const t of e.changedTouches) {
      const prev = looks.get(t.identifier);
      if (!prev) continue;
      const dx = t.clientX - prev.x, dy = t.clientY - prev.y;
      looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      player.yaw -= dx * sens;
      player.pitch -= dy * sens;
      player.pitch = THREE.MathUtils.clamp(player.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
      gun.swayX = THREE.MathUtils.clamp(gun.swayX + dx * 0.0003, -0.05, 0.05);
      gun.swayY = THREE.MathUtils.clamp(gun.swayY + dy * 0.0003, -0.04, 0.04);
    }
  }, { passive: false });
  for (const ev of ['touchend', 'touchcancel']) {
    canvas.addEventListener(ev, (e) => {
      for (const t of e.changedTouches) looks.delete(t.identifier);
    });
  }

  // 버튼
  const onHold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); audio(); down(); }, { passive: false });
    for (const ev of ['touchend', 'touchcancel']) el.addEventListener(ev, (e) => { e.preventDefault(); if (up) up(); }, { passive: false });
  };
  const inRaid = () => state.phase === 'raid' && !state.paused;
  onHold('tb-fire', () => { if (inRaid()) gun.triggerDown = true; }, () => { gun.triggerDown = false; gun.semiLatch = false; });
  onHold('tb-ads', () => {
    if (!inRaid()) return;
    player.aiming = !player.aiming; // 토글식
    $('tb-ads').classList.toggle('active', player.aiming);
  });
  onHold('tb-jump', () => { if (inRaid()) touch.jump = true; });
  onHold('tb-reload', () => { if (inRaid()) startReload(); });
  onHold('tb-weapon', () => { if (inRaid()) cycleWeapon(); });
  onHold('tb-heal', () => { if (inRaid()) useHeal(); });
  onHold('tb-inv', () => {
    if (state.phase !== 'raid') return;
    dom.inventory.style.display = dom.inventory.style.display === 'block' ? 'none' : 'block';
  });
  onHold('tb-interact', () => {
    if (!inRaid()) return;
    const it = nearestInteractable();
    if (it) lootInteractable(it);
  });
}

canvas.addEventListener('click', () => {
  if (state.phase === 'raid' && !state.paused && !state.pointerLocked) lockPointer();
});

// keyup 유실 대비 입력 전체 해제 (사파리: 포커스 이탈/Cmd 조합 시 keyup 미발생 → 키 고착)
function clearInputs() {
  for (const k of Object.keys(keys)) keys[k] = false;
  gun.triggerDown = false;
  gun.semiLatch = false;
  player.aiming = false;
}
window.addEventListener('blur', clearInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInputs(); });

document.addEventListener('pointerlockchange', () => {
  state.pointerLocked = document.pointerLockElement === canvas;
  if (!state.pointerLocked && state.phase === 'raid') {
    // Esc → 일시정지 메뉴 (락 해제 동안의 keyup 유실 대비 입력 초기화)
    clearInputs();
    state.paused = true;
    dom.btnStart.textContent = '레이드 계속';
    dom.menu.style.display = 'flex';
  }
});

document.getElementById('btn-equip').addEventListener('click', () => {
  audio();
  if (!assetsReady) return;
  openEquipScreen();
});
document.getElementById('equip-close').addEventListener('click', () => {
  $('equip-screen').style.display = 'none';
  cancelAnimationFrame(equipRAF);
  updateMenuStash();
});

dom.btnStart.addEventListener('click', () => {
  audio();
  if (state.paused && state.phase === 'raid') {
    state.paused = false;
    dom.menu.style.display = 'none';
    lockPointer();
  } else {
    dom.btnStart.textContent = '레이드 시작';
    startRaid();
  }
});

for (const btn of document.querySelectorAll('.btn-menu')) {
  btn.addEventListener('click', () => {
    state.phase = 'menu';
    state.paused = false;
    dom.death.style.display = 'none';
    dom.extract.style.display = 'none';
    dom.btnStart.textContent = '레이드 시작';
    dom.menu.style.display = 'flex';
    updateMenuStash();
  });
}

document.addEventListener('mousemove', (e) => {
  if (!state.pointerLocked || state.phase !== 'raid') return;
  // 포인터락 글리치 스파이크(락 전환·고속 이동 시 비정상 대형 델타) 무시
  if (Math.abs(e.movementX) > 500 || Math.abs(e.movementY) > 500) return;
  const sens = 0.0021 * (player.aiming ? 0.6 : 1);
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  // 뷰모델 스웨이 입력 (시선 반대쪽으로 살짝 끌림)
  gun.swayX = THREE.MathUtils.clamp(gun.swayX + e.movementX * 0.00016, -0.05, 0.05);
  gun.swayY = THREE.MathUtils.clamp(gun.swayY + e.movementY * 0.00016, -0.04, 0.04);
});

document.addEventListener('mousedown', (e) => {
  if (!state.pointerLocked || state.phase !== 'raid') return;
  if (e.button === 0) gun.triggerDown = true;
  if (e.button === 2) player.aiming = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { gun.triggerDown = false; gun.semiLatch = false; }
  if (e.button === 2) player.aiming = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  // Cmd 조합은 브라우저 단축키 — 게임 키로 잡으면 keyup 유실로 고착됨 (사파리)
  if (e.metaKey) { clearInputs(); return; }
  keys[e.code] = true;
  if (e.code === 'Tab') {
    e.preventDefault();
    if (state.phase === 'raid') {
      dom.inventory.style.display = dom.inventory.style.display === 'block' ? 'none' : 'block';
    }
  }
  if (state.phase !== 'raid' || state.paused) return;
  if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= 6) switchWeapon(n - 1);
  }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyQ') useHeal();
  if (e.code === 'KeyE') {
    const it = nearestInteractable();
    if (it) lootInteractable(it);
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  // 사파리: Meta 홀드 중 눌린 키들의 keyup 이 오지 않음 → Meta 릴리즈 시 일괄 해제
  if (e.key === 'Meta') clearInputs();
});

// ============================================================
// HUD 갱신
// ============================================================
function updateHUD() {
  // ADS 중엔 가늠자(또는 스코프 오버레이 레티클)로 조준 — 크로스헤어 숨김
  document.getElementById('crosshair').style.display = player.aiming ? 'none' : 'block';
  dom.hpFill.style.width = `${player.hp}%`;
  dom.stamFill.style.width = `${player.stamina}%`;
  const hasArmor = player.armorDur > 0 || player.helmet;
  $('armor-label').style.display = hasArmor ? 'block' : 'none';
  $('armor-bar').style.display = player.armorDur > 0 ? 'block' : 'none';
  if (hasArmor) {
    $('armor-label').textContent = player.helmet ? (player.armorDur > 0 ? '방탄 · 헬멧' : '헬멧') : '방탄';
    $('armor-fill').style.width = `${player.armorDur / ARMOR_MAX * 100}%`;
  }
  dom.ammoMag.textContent = gun.mag;
  dom.ammoReserve.textContent = gun.reserve;
  const wn = $('weapon-name');
  const slot = carry.indexOf(GUN.key);
  const wnText = `${slot >= 0 ? `[${slot + 1}] ` : ''}${GUN.name}`;
  if (wn.textContent !== wnText) wn.textContent = wnText;
  if (IS_MOBILE) {
    const tb = $('tb-weapon');
    const show = carry.length >= 2 ? 'flex' : 'none';
    if (tb.style.display !== show) tb.style.display = show;
  }
  dom.raidTimer.textContent = fmtTime(state.raidTime);
  dom.raidTimer.style.color = state.raidTime < 60 ? '#d94f3d' : '#e8eee6';
  dom.kills.textContent = `사살 ${state.kills}`;
  dom.lowhpVignette.style.opacity = player.hp < 40 ? `${(1 - player.hp / 40) * 0.85}` : '0';

  const it = nearestInteractable();
  if (it && state.phase === 'raid') {
    dom.prompt.style.display = 'block';
    dom.prompt.innerHTML = `<b>[E]</b> ${it.label} 열기`;
    if (IS_MOBILE) {
      const b = $('tb-interact');
      b.style.display = 'flex';
      b.textContent = `${it.label} 열기`;
    }
  } else {
    dom.prompt.style.display = 'none';
    if (IS_MOBILE) $('tb-interact').style.display = 'none';
  }
  updateCompass();
}

// ============================================================
// 메인 루프
// ============================================================
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (state.phase === 'raid' && !state.paused) {
    state.raidTime -= dt;
    if (state.raidTime <= 0) {
      state.raidTime = 0;
      endRaid('death', '시간 초과 — 실종(MIA) 처리되었습니다.');
    }
    updatePlayer(dt);
    updateGun(dt);
    for (const e of enemies) updateEnemy(e, dt);
    updateExtraction(dt);
    updateAcoustics(dt);
    updateHUD();
  }
  updateEffects(dt);
  // 하늘: 카메라 추종(구면 클리핑 방지) + 구름 드리프트
  skyMesh.position.copy(camera.position);
  skyUniforms.uTime.value = now / 1000;
  renderer.render(scene, camera);
}

// QA/디버그 훅 (콘솔에서 위치 이동 등)
window.__ex = {
  player, state, camera, sfx, playBuf, gun,
  get enemies() { return enemies; },
  get audio() { return AB; },
  get colliders() { return colliders; },
  get interactables() { return interactables; },
  terrainH,
  equipWeapon,
  lootInteractable,
  WEAPONS,
  kill(i) { const e = enemies[i]; if (e && !e.dead) killEnemy(e); },
  hurt(n, hs = false) { damagePlayer(n, hs); },
};

updateMenuStash();
refreshInventoryUI();
dom.btnStart.disabled = true;
dom.btnStart.textContent = '에셋 로딩 중...';
loadAssets().catch((err) => {
  console.error('asset load failed:', err);
  dom.btnStart.textContent = '에셋 로딩 실패 — 새로고침 해 주세요';
  const label = document.getElementById('load-label');
  const fill = document.getElementById('load-fill');
  if (label) label.textContent = '로딩 실패 (네트워크 확인 후 새로고침)';
  if (fill) fill.style.background = '#b83232';
});
loadAudio().catch((err) => console.warn('audio load failed (절차 생성 폴백 사용):', err));
loop();
