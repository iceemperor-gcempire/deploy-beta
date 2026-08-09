import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// 배포 캐시버스팅 토큰: 이 모듈이 로드된 URL 의 ?v=<SHA> (index.html 이 배포 시 심음).
// 에셋 fetch 에 전파해 배포 후 CDN/브라우저 캐시로 옛 파일이 도는 문제 방지 (#125)
const ASSET_VER = new URL(import.meta.url).search || '';

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

// 3인칭(TPS) 카메라 (#116)
const CAM = {
  dist: 3.4,        // 기본 궤도 거리
  distAim: 1.85,    // 조준 시 당김
  pivotH: 1.5,      // 피벗(어깨) 높이
  shoulder: 0.5,    // 우측 오프셋 (오버숄더)
  shoulderAim: 0.42,
  minDist: 0.55,    // 벽 충돌 시 최소 거리
  pitchMin: -1.15,  // 아래로
  pitchMax: 0.95,   // 위로
};
const WORLD_UP = new THREE.Vector3(0, 1, 0);
let viewMode = 'tps'; // 'tps' | 'fps' — V 키로 전환 (#145)
try { viewMode = localStorage.getItem('exshoot_view') === 'fps' ? 'fps' : 'tps'; } catch {}

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
    key: 'sniper', name: '볼트액션 저격총', model: 'sniper', price: 90000, viewLen: 0.78, tpsScale: 1.2,
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

// 총기 부품 외형 반영 (#190) — 기본 총 모델이 이미 총열·탄창·개머리판 등을 가지므로 교체형 부품은
// 스탯 전용. 총구 장착물(소염기)만은 기본 총에 없는 add-on 이라 간이 메시로 표시.
// 총 로컬 프레임: 총구 -Z, 위 +Y. size=정규화 치수. 총구 위치는 뷰모델 muzzle(= size.y*0.25, -size.z/2)과 일치.
const PART_MAT = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.5, metalness: 0.6 });
function muzzleDeviceMesh(size) {
  const r = Math.min(size.x, size.y) * 0.42, len = Math.max(0.04, size.z * 0.09);
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), PART_MAT);
  body.rotation.x = Math.PI / 2;
  grp.add(body);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, len * 0.24, 14), PART_MAT); // 앞쪽 브레이크 링
  ring.rotation.x = Math.PI / 2; ring.position.z = -len * 0.42;
  grp.add(ring);
  grp.position.set(0, size.y * 0.25, -size.z / 2 - len / 2);
  grp.traverse((o) => { o.frustumCulled = false; if (o.isMesh) o.castShadow = false; });
  return grp;
}

const ITEM_TABLE = [
  { name: '볼트',            value: 1500,  w: 18 },
  { name: '붕대',            value: 3000,  w: 16, heal: 25, type: 'consumable' },
  { name: '군용 MRE',        value: 8000,  w: 12 },
  { name: '구급킷',          value: 14000, w: 7,  heal: 60, type: 'consumable' },
  { name: '손목시계',        value: 15000, w: 10 },
  { name: '위스키',          value: 22000, w: 8 },
  { name: '금목걸이',        value: 28000, w: 6 },
  { name: '그래픽카드',      value: 95000, w: 2 },
  { name: '5.56 탄약 30발',  value: 0,     w: 14, ammo: 30 },
];

// 총기 부품 (#186) — 지금은 루팅·구매로 획득해 인벤토리에 쌓이는 아이템. 슬롯 장착(커스텀)은 차후.
// type:'part' 로 태깅해 탈출 시 stash.parts 로 분류 반입(귀중품과 구분).
const SLOT_LABEL = { barrel: '총열', muzzle: '총구', handguard: '핸드가드', stock: '개머리판', magazine: '탄창', trigger: '방아쇠', bolt: '노리쇠' };
const SLOT_ORDER = ['barrel', 'muzzle', 'handguard', 'stock', 'magazine', 'trigger', 'bolt'];
// mods: 무기 스탯에 곱(mul)·합(add) 적용. desc 는 UI 표기.
const PART_TABLE = [
  { name: '강선 총열',     value: 12000, w: 5, type: 'part', slot: 'barrel',    desc: '명중률·사거리 향상', mods: { spreadHip: { mul: 0.85 }, spreadAds: { mul: 0.8 }, range: { mul: 1.12 } } },
  { name: '소염기',        value: 7000,  w: 6, type: 'part', slot: 'muzzle',    desc: '반동 감소',          mods: { recoil: { mul: 0.82 } } },
  { name: '경량 핸드가드', value: 8000,  w: 6, type: 'part', slot: 'handguard', desc: '이동 중 탄퍼짐 감소', mods: { spreadMove: { mul: 0.75 } } },
  { name: '전술 개머리판', value: 9000,  w: 6, type: 'part', slot: 'stock',     desc: '반동·총열 튐 감소',  mods: { recoil: { mul: 0.85 }, kick: { mul: 0.85 } } },
  { name: '확장 탄창',     value: 6000,  w: 7, type: 'part', slot: 'magazine',  desc: '탄창 +10',           mods: { magSize: { add: 10 } } },
  { name: '경기용 방아쇠', value: 15000, w: 3, type: 'part', slot: 'trigger',   desc: '연사 속도 향상',     mods: { fireInterval: { mul: 0.9 } } },
  { name: '강화 노리쇠',   value: 11000, w: 4, type: 'part', slot: 'bolt',      desc: '재장전 속도 향상',   mods: { reloadTime: { mul: 0.85 } } },
];
const PART_BY_NAME = Object.fromEntries(PART_TABLE.map((p) => [p.name, p]));
// 무기별 지원 슬롯 (부품 slot 이 여기 포함되면 장착 가능)
const WEAPON_SLOTS = {
  rifle:    ['barrel', 'muzzle', 'handguard', 'stock', 'magazine', 'trigger', 'bolt'],
  bullpup:  ['barrel', 'muzzle', 'handguard', 'magazine', 'trigger', 'bolt'],
  smg2:     ['barrel', 'muzzle', 'handguard', 'stock', 'magazine', 'trigger'],
  sniper:   ['barrel', 'muzzle', 'stock', 'magazine', 'trigger', 'bolt'],
  shotgun:  ['barrel', 'muzzle', 'stock', 'trigger'],
  revolver: ['barrel', 'muzzle', 'trigger'],
};
function weaponSlots(key) { return WEAPON_SLOTS[key] || ['barrel', 'muzzle', 'magazine', 'trigger']; }
function installedParts(key) { return (loadStash().weaponParts || {})[key] || {}; } // {slot: partName}
// 부품 장착이 반영된 유효 무기 스탯(복사본) — GUN 은 이 값을 씀(원본 WEAPONS 오염 방지)
function effectiveWeapon(key) {
  const w = { ...WEAPONS[key] };
  const inst = installedParts(key);
  for (const slot of Object.keys(inst)) {
    const p = PART_BY_NAME[inst[slot]];
    if (!p || !p.mods) continue;
    for (const [stat, m] of Object.entries(p.mods)) {
      if (m.mul != null) w[stat] = (w[stat] || 0) * m.mul;
      if (m.add != null) w[stat] = (w[stat] || 0) + m.add;
    }
  }
  if (w.magSize) w.magSize = Math.round(w.magSize);
  return w;
}
// 열쇠 (#195) — 잠긴 금고를 여는 아이템. 반입해야 해당 금고 개방. 루팅(희귀)·상점 획득.
const KEY_TABLE = [
  { name: '창고 열쇠',     keyId: 'warehouse', value: 25000, w: 1.2, price: 40000, type: 'key' },
  { name: '사무실 금고 키', keyId: 'office',    value: 35000, w: 0.8, price: 55000, type: 'key' },
];
const KEY_BY_ID = Object.fromEntries(KEY_TABLE.map((k) => [k.keyId, k]));
const LOOT_POOL = [...ITEM_TABLE, ...PART_TABLE, ...KEY_TABLE]; // 루팅 롤 대상(일반+부품+열쇠)
const CONSUMABLE_SHOP = ITEM_TABLE.filter((i) => i.type === 'consumable'); // 소모품 상점 목록(붕대·구급킷)

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const dom = {
  hud: $('hud'), menu: $('menu-screen'), death: $('death-screen'), extract: $('extract-screen'),
  hpFill: $('hp-fill'), stamFill: $('stam-fill'),
  ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), gunState: $('gun-state'),
  raidTimer: $('raid-timer'), compass: $('compass'), minimap: $('minimap'),
  lootValue: $('loot-value-num'), kills: $('kills'),
  prompt: $('prompt'), extractProgress: $('extract-progress'),
  extractFill: $('extract-fill'), extractLabel: $('extract-label'),
  damageVignette: $('damage-vignette'), lowhpVignette: $('lowhp-vignette'),
  hitmarker: $('hitmarker'), killfeed: $('killfeed'),
  inventory: $('inventory'), invList: $('inv-list'), invTotal: $('inv-total-val'),
  menuStash: $('menu-stash'), btnStart: $('btn-start'),
  deathCause: $('death-cause'), deathLoot: $('death-loot'),
  extractStats: $('extract-stats'), extractLoot: $('extract-loot'),
  scopeOverlay: $('scope-overlay'), healHint: $('heal-hint'),
};

// ---------- 모바일 감지 ----------
const IS_MOBILE = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (IS_MOBILE) document.body.classList.add('mobile');

// ---------- 렌더러 / 씬 ----------
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
// 렌더 해상도 (#132/#136): 기본 픽셀비 × renderScale. 메뉴에서 고정 레벨(High/Med/Low)로만 변경
// — 실행 중 자동 변경은 화면 깜박임을 유발해 제거함.
const BASE_PR = Math.min(devicePixelRatio, IS_MOBILE ? 1.5 : 2);
let renderScale = 1.0;
let composer = null; // 포스트프로세싱 (#139) — setupPostFX 에서 생성
function applyRenderScale() {
  const pr = BASE_PR * renderScale;
  renderer.setPixelRatio(pr);
  if (composer) { composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
}
applyRenderScale();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

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
      // 태양 디스크 + 웜톤 할로 — 디스크는 또렷하게, 넓은 글로우는 억제해 과다 번짐 방지 (#179)
      float s = max(dot(d, uSunDir), 0.0);
      col += vec3(1.0, 0.86, 0.62) * pow(s, 1400.0) * 2.4;
      col += vec3(1.0, 0.78, 0.48) * pow(s, 90.0) * 0.28;
      col += vec3(0.92, 0.70, 0.46) * pow(s, 12.0) * 0.06;
      // 구름: 방향을 평면 투영해 fbm, 수평선 근처 감쇠, 천천히 드리프트
      if (d.y > 0.02) {
        vec2 uv = d.xz / (d.y + 0.18) * 0.9 + vec2(uTime * 0.004, uTime * 0.0016);
        float c = fbm(uv);
        float cov = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.2, d.y);
        vec3 cloudCol = vec3(0.97, 0.96, 0.94) * (0.8 + 0.2 * s);
        col = mix(col, cloudCol, cov * 0.55);
      }
      gl_FragColor = vec4(col, 1.0);
      // 톤매핑/색공간은 포스트프로세싱 OutputPass 가 일괄 처리 (#139) — 여기서 이중 적용 금지
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
const sun = new THREE.DirectionalLight(0xffe0b0, 2.35);
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
  if (composer) composer.setSize(innerWidth, innerHeight);
});

// 포스트프로세싱 파이프라인 (#139) — RenderPass → GTAO(AO) → Bloom → OutputPass(톤매핑/sRGB)
// scene 은 이 시점에 아직 비어 있어도 무방(패스는 참조만 보유). 조명/환경 설정 후 호출.
let gtaoPass = null, bloomPass = null;
function setupPostFX() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: IS_MOBILE ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(BASE_PR * renderScale);
  composer.addPass(new RenderPass(scene, camera));
  if (!IS_MOBILE) {
    try {
      gtaoPass = new GTAOPass(scene, camera, size.x, size.y);
      gtaoPass.output = GTAOPass.OUTPUT.Default;
      gtaoPass.blendIntensity = 0.9;
      try { gtaoPass.updateGtaoMaterial({ radius: 0.5, scale: 1.1, samples: 16 }); } catch {}
      composer.addPass(gtaoPass);
    } catch (e) { console.warn('GTAO 생략:', e && e.message); }
  }
  // 블룸: 아주 밝은 부분만 은은하게 (너무 세던 값 하향, #148)
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.9); // strength, radius, threshold
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass()); // 톤매핑/sRGB (항상 유지 — 효과 OFF 여도 색 일관)
  // 컬러 그레이딩 + 비네트 (톤매핑 후, 시네마틱 톤) — 한 패스, 저비용 (#148)
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uContrast: { value: 1.07 }, uSat: { value: 1.12 }, uVig: { value: 1.0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uContrast, uSat, uVig; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        c.rgb = (c.rgb - 0.5) * uContrast + 0.5;                 // 대비
        float l = dot(c.rgb, vec3(0.299,0.587,0.114));
        c.rgb = mix(vec3(l), c.rgb, uSat);                       // 채도
        vec2 p = (vUv - 0.5) * uVig;                             // 비네트
        c.rgb *= mix(0.68, 1.0, smoothstep(0.85, 0.28, length(p)));
        gl_FragColor = c;
      }`,
  }));
}
setupPostFX();

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
  // Quaternius Ultimate Stylized Nature (CC0) — Blender 로 변형별 개별 GLB 분리 (#165, split_nature.py)
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

// Quaternius 개별 나무·바위 등록 (split_nature.py 산출) + 숲 나무 구성 (#165)
const NATURE_SPLIT_DIR = 'assets/env/nature/quaternius/split/';
const TREE_KEYS = { pine: [], maple: [], birch: [], normal: [], dead: [], rock: [] };
for (const [t, file] of [['pine', 'pinetree'], ['maple', 'mapletree'], ['birch', 'birchtree'], ['normal', 'normaltree'], ['dead', 'deadtree'], ['rock', 'rock']]) {
  for (let i = 1; i <= 5; i++) { const k = `q_${t}${i}`; GLB_MANIFEST[k] = `${NATURE_SPLIT_DIR}${file}_${i}.glb`; TREE_KEYS[t].push(k); }
}
// 지면 클러터(수풀·풀·꽃) — 숲 디테일용 (#177). 비충돌 통과 오브젝트.
const CLUTTER_KEYS = { bush: [], grass: [], flower: [] };
for (const [cat, files] of Object.entries({
  bush: ['bush', 'bush_flowers', 'plant_1'],
  grass: ['grass_small', 'grass_large_extruded'],
  flower: ['flower_1', 'flower_1_clump', 'flower_2', 'flower_2_clump', 'flower_3_clump', 'flower_4_clump', 'flower_5_clump'],
})) {
  for (const f of files) { const k = `q_${f}`; GLB_MANIFEST[k] = `${NATURE_SPLIT_DIR}${f}.glb`; CLUTTER_KEYS[cat].push(k); }
}

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
  // 캐시버스팅 (#125): Cloudflare 가 .js/.jpg 를 4h 캐시해 배포 후 옛 파일이 도는 문제 방지.
  // main.js 는 index.html 의 ?v=<SHA> 로, 텍스처(.jpg)는 아래에서 버스팅.
  // .glb 는 origin/CDN 모두 max-age=0(ETag 재검증)이라 이미 최신 → 버스팅 불필요(30MB 재다운로드 회피).
  const loadGlb = (path) => withRetry((p, ok, prog, fail) => loader.load(p, ok, prog, fail), path);
  const loadTex = (path) => withRetry((p, ok, prog, fail) => texLoader.load(p, ok, prog, fail), path + ASSET_VER);

  const jobs = Object.entries(GLB_MANIFEST).map(async ([key, path]) => {
    const gltf = await loadGlb(path);
    const isGirl = GIRL_KEYS.includes(key);
    const isNature = key.startsWith('q_'); // Quaternius 나무·수풀·바위
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && !isGirl) {
          if (isNature) {
            // 자연물은 무광 — 불필요한 플라스틱 광택·환경반사 제거 (#178)
            o.material.roughness = 1.0;
            o.material.metalness = 0.0;
            if ('envMapIntensity' in o.material) o.material.envMapIntensity = 0.2;
          }
          const mn = (o.material.name || '').toLowerCase();
          if (/leaf|leaves|foliage|bush|plant|grass|flower|petal/.test(mn)) {
            // 잎/수풀: 텍스처 알파로 잎 실루엣만 남기는 컷아웃 (BLEND 카드가 사각 종이로 보이는 문제) #165
            o.material.transparent = false;
            o.material.alphaTest = 0.4;
            o.material.depthWrite = true;
            o.material.side = THREE.DoubleSide;
          } else {
            // 일부 에셋이 alphaMode:MASK + alpha 0 으로 나와 전부 투명해짐 → 불투명 강제
            // (VRoid 캐릭터는 알파를 실제로 사용하므로 제외)
            o.material.alphaTest = 0; o.material.transparent = false; o.material.opacity = 1;
          }
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
  // 물리 엔진 (Rapier WASM) — 실패해도 게임은 폴백(물리 비활성)으로 동작 (#119)
  jobs.push((async () => {
    try {
      const R = await import('@dimforge/rapier3d-compat');
      await R.init();
      RAPIER = R;
      physReady = true;
    } catch (e) { console.warn('Rapier init 실패 — 물리 비활성:', e && e.message); }
  })());
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
    const aimPose = clips.find((c) => /^aim$/i.test(c.name)) || null; // ARDY 소총 견착 조준 (#122)
    const idleGun = clips.find((c) => /^idlegun$/i.test(c.name)) || null; // ARDY 총 내린 편한 대기 (#128)
    const readyGun = clips.find((c) => /^readygun$/i.test(c.name)) || null; // ARDY 총 든 준비 자세 (#131)
    const walkC = clips.find((c) => /^walk/i.test(c.name)) || null;
    const limp = clips.find((c) => /^limp/i.test(c.name)) || null;
    const alert = clips.find((c) => /^alert/i.test(c.name)) || null;
    // 리타게팅 export 시 180°(w≈0) 부근 회전의 쿼터니언 부호(±q)가 프레임 간
    // 뒤집힐 수 있음 → 보간 시 관절이 꺾임. 부호 연속성 복구.
    for (const c of [idle, run, death, hitChest, hitHead, shoot, reload,
      crouchIdle, roll, aimUpRaw, aimDownRaw, aimNeutral, walkC, limp, alert, aimPose, idleGun, readyGun]) fixQuatContinuity(c);
    // 고저차 조준: Aim_Up/Down 을 Neutral 기준 additive 로 변환 —
    // 어떤 기본 모션 위에도 가중치로 얹을 수 있음.
    // 주의: glTF 는 상수 트랙(scale 1 등)의 accessor 를 클립 간 공유하므로
    // 반드시 clone() 후 변형할 것 — 제자리 변형하면 Idle 등 다른 클립까지 오염됨
    let aimUp = null, aimDown = null;
    if (aimNeutral) {
      if (aimUpRaw) aimUp = THREE.AnimationUtils.makeClipAdditive(aimUpRaw.clone(), 0, aimNeutral);
      if (aimDownRaw) aimDown = THREE.AnimationUtils.makeClipAdditive(aimDownRaw.clone(), 0, aimNeutral);
    }
    CHAR_CLIPS[key] = { idle, run, death, hitChest, hitHead, shoot, reload, crouchIdle, roll, aimUp, aimDown, walk: walkC, limp, alert, aim: aimPose, aimNeutral, idleGun, readyGun };
  }

  buildViewmodel();
  buildPlayerChar();
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
let FLATTENS = [
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
// 나무: 시야/총알은 잎까지 차단(mesh), 이동 충돌·엄폐는 줄기 콜라이더만.
// trunkR 를 주면 굵은 줄기(엄폐목)로 — 총알·시야를 서서 막을 수 있게 콜라이더 상단도 높인다.
function placeTree(key, x, z, height, trunkR = 0.35) {
  const m = placeModel(key, x, z, { height, collide: false, block: true, rotY: Math.random() * Math.PI * 2 });
  const gy = terrainH(x, z);
  const top = gy + Math.min(4, Math.max(3, height * 0.35)); // 줄기 콜라이더 높이(서서 엄폐)
  colliders.push(axisCollider(x - trunkR, x + trunkR, gy, top, z - trunkR, z + trunkR));
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
  recoilPitch: 0, recoilYaw: 0, // 반동 시점 오프셋 (사격 시 위로 튀고 회복) (#207)
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
  bloom: 0,             // 연사 누적 탄퍼짐 (사격 시 증가·정지 시 회복) → 크로스헤어에 반영 (#207)
  spread: 0,            // 이번 프레임 유효 탄퍼짐 (탄도·크로스헤어 공통 소스)
  swayX: 0, swayY: 0,   // 시선 이동에 따른 뷰모델 끌림
  sprintBlend: 0,       // 0=조준 자세, 1=스프린트 내림 자세
  semiLatch: false,     // 단발 무기 클릭당 1발
  foundWeapons: [],     // 레이드 중 습득 무기들 (탈출 시 소유 확정)
};

let inventory = [];       // {name, value, heal?}
let carry = [];           // 이번 레이드 휴대 무기 키 목록 (1/2/3 키 순)
let broughtKeys = new Set(); // 이번 레이드에 반입한 열쇠 keyId (#195)
const weaponAmmo = {};    // 무기별 탄약 상태 { key: { mag, reserve } }
let colliders = [];       // yaw 정렬 OBB { cx, cz, c, s, hx, hz, minY, maxY }
let obstacleMeshes = [];  // LOS/총알 차단용
let enemies = [];
let interactables = [];   // {pos, mesh, items, opened, label}
let extractions = [];     // {pos, mesh, ring}
let pendingExtractFee = 0; // 유료 탈출 시 차감할 ₽ (#194)
let airdropBeacon = null;  // 에어드랍 비컨 (#197)
let tracers = [];         // {line, life}
// 물리 (Rapier) — #119 Phase 2
let RAPIER = null, physWorld = null, physReady = false;
const physProps = [];     // { body, holder, mesh, halfH, explosive, exploded, mCol }
const propMeshes = [];    // 총알 레이 타겟 (physProp 참조 userData)
const ragdolls = [];      // { e, body, offset }
let pendingExplosions = [];// { pos, opts } — 연쇄 폭발 프레임 분산
let explosionsFX = [];    // { light, sphere, life, max }
let flashes = [];         // {light, sprite?, life}
let corpses = [];

const keys = {};

// ---------- 스태시 (영구 저장) ----------
function loadStash() {
  let s;
  try { s = JSON.parse(localStorage.getItem('exshoot_stash')) || {}; }
  catch { return {}; }
  // 마이그레이션 (#193): loadoutC 배열(구, 종류 전량) → 개수맵 {name:count}
  if (Array.isArray(s.loadoutC)) {
    const m = {};
    for (const c of (s.consumables || [])) if (s.loadoutC.includes(c.name)) m[c.name] = (m[c.name] || 0) + 1;
    s.loadoutC = m;
  }
  return s;
}
function saveStash(s) { localStorage.setItem('exshoot_stash', JSON.stringify(s)); }
function updateMenuStash() {
  const s = loadStash();
  const r = s.roubles || 0, raids = s.raids || 0, ext = s.extracts || 0;
  dom.menuStash.textContent =
    `스태시 ₽ ${r.toLocaleString('ko-KR')} · 레이드 ${raids}회 · 생존 ${ext}회 · 누적 사살 ${s.kills || 0}`;
  const ss = document.getElementById('shop-stash');
  if (ss) ss.textContent = dom.menuStash.textContent;
  renderShop();
}

// ---------- 인벤토리 (메뉴, 영구 스태시 · 카테고리별 목록) (#185) ----------
// 아이템 종류: 총 / 총기 악세서리 / 총기 부품(미구현·분류만) / 귀중품(수동 매각).
// 차후 총기 부품 세분화 → 총기 커스텀의 기반이 될 목록.
function invCatHTML(title, count, rows, emptyMsg) {
  const body = rows.length ? rows.join('') : `<div class="cat-empty">${emptyMsg || '비어 있음'}</div>`;
  return `<div class="inv-cat"><h3><span>${title}</span><span class="cat-n">${count}</span></h3>${body}</div>`;
}
function invRowHTML(name, tag, valText, btn) {
  return `<div class="inv-row"><span class="i-name">${name}</span>${tag ? `<span class="i-tag">${tag}</span>` : ''}`
    + `${valText ? `<span class="i-val">₽ ${valText}</span>` : '<span class="i-val"></span>'}${btn || ''}</div>`;
}
function groupValuables(vals) {
  const g = {};
  for (const v of vals) { g[v.name] = g[v.name] || { n: 0, v: 0 }; g[v.name].n++; g[v.name].v += (v.value || 0); }
  return g;
}
function toggleLoadout(listKey, id) {
  const st = loadStash();
  const cur = new Set(st[listKey] || []);
  cur.has(id) ? cur.delete(id) : cur.add(id);
  st[listKey] = [...cur];
  saveStash(st);
  sfx.reload2();
  renderInventoryScreen();
}
// 소모품 개수 단위 이동 (#193): loadoutC[name] += delta (0..보유수)
function moveCons(name, delta) {
  const st = loadStash();
  const owned = (st.consumables || []).filter((c) => c.name === name).length;
  const lc = st.loadoutC || {};
  const next = Math.max(0, Math.min(owned, (lc[name] || 0) + delta));
  if (next <= 0) delete lc[name]; else lc[name] = next;
  st.loadoutC = lc;
  saveStash(st);
  sfx.reload2();
  renderInventoryScreen();
}
// 방어구/헬멧 반입 토글 (#193)
function toggleLoadoutFlag(key) {
  const st = loadStash();
  st[key] = st[key] === false ? true : false;
  saveStash(st);
  sfx.reload2();
  renderInventoryScreen();
}
// 스태시 ↔ 반입 인벤토리 2패널 (#192/#193): 총·방어구는 통째 이동, 소모품은 개수 단위, 부품·악세서리·귀중품은 스태시 전용.
function renderInventoryScreen() {
  const st = loadStash();
  // 로드아웃 미설정 시 기본값(소지 전량 반입)으로 실체화 → 이후 명시적 이동
  let dirty = false;
  if (st.loadoutW === undefined) { st.loadoutW = (st.weapons || ['rifle']).filter((k) => WEAPONS[k]); dirty = true; }
  if (st.loadoutC === undefined || Array.isArray(st.loadoutC)) {
    const m = {}; for (const c of (st.consumables || [])) m[c.name] = (m[c.name] || 0) + 1; st.loadoutC = m; dirty = true; // 개수맵(전량)
  }
  if (st.loadoutKeys === undefined) { st.loadoutKeys = [...new Set((st.keys || []).map((k) => k.keyId))]; dirty = true; }
  if (dirty) saveStash(st);
  document.getElementById('inv-screen-stash').textContent = `스태시 ₽ ${(st.roubles || 0).toLocaleString('ko-KR')}`;

  const equipped = st.equipped || 'rifle';
  const lw = st.loadoutW || [], lc = st.loadoutC || {};
  const guns = (st.weapons || ['rifle']).filter((k) => WEAPONS[k]);
  const cg = {}; for (const c of (st.consumables || [])) { cg[c.name] = cg[c.name] || { n: 0, heal: c.heal }; cg[c.name].n++; }
  const parts = st.parts || []; const pg = {}; for (const p of parts) { pg[p.name] = pg[p.name] || { n: 0, slot: p.slot }; pg[p.name].n++; }
  const accs = (st.attOwned || []).filter((k) => ATTACHMENTS[k]);
  const keys = st.keys || []; const lk = st.loadoutKeys || [];
  const vals = st.valuables || []; const vgz = groupValuables(vals);
  const gunTag = (k) => k === equipped ? '장착 중' : '';
  const moveBtn = (label, attr) => `<button class="ld-btn" ${attr}>${label}</button>`;
  const healTag = (h) => h ? `+${h} HP` : '';
  // 방어구/헬멧 보유·반입 여부
  const hasArmor = (st.armorDur || 0) > 0, hasHelmet = !!st.helmet;
  const brArmor = st.loadoutArmor !== false, brHelmet = st.loadoutHelmet !== false;

  // 스태시 패널(좌)
  const sGuns = guns.filter((k) => !lw.includes(k));
  const sConsRows = [];
  for (const [n, x] of Object.entries(cg)) { const rem = x.n - (lc[n] || 0); if (rem > 0) sConsRows.push(invRowHTML(`${n} ×${rem}`, healTag(x.heal), '', moveBtn('반입 →', `data-consp="${encodeURIComponent(n)}"`))); }
  const sArmorRows = [];
  if (hasArmor && !brArmor) sArmorRows.push(invRowHTML(`방탄복 (내구도 ${Math.round(st.armorDur)}/${ARMOR_MAX})`, '', '', moveBtn('반입 →', 'data-armld="1"')));
  if (hasHelmet && !brHelmet) sArmorRows.push(invRowHTML('헬멧', '', '', moveBtn('반입 →', 'data-helld="1"')));
  const sKeys = keys.filter((k) => !lk.includes(k.keyId));
  document.getElementById('inv-stash').innerHTML = [
    invCatHTML('총', sGuns.length, sGuns.map((k) => invRowHTML(WEAPONS[k].name, gunTag(k), '', moveBtn('반입 →', `data-bringw="${k}"`))), '모두 반입됨'),
    invCatHTML('방어구', (hasArmor && !brArmor ? 1 : 0) + (hasHelmet && !brHelmet ? 1 : 0), sArmorRows, '모두 반입됨'),
    invCatHTML('열쇠', sKeys.length, sKeys.map((k) => invRowHTML(k.name, '', '', moveBtn('반입 →', `data-bringkey="${k.keyId}"`))), keys.length ? '모두 반입됨' : '보유 열쇠 없음'),
    invCatHTML('소모품', sConsRows.length, sConsRows, '모두 반입됨'),
    invCatHTML('총기 부품', parts.length, Object.entries(pg).map(([n, x]) => invRowHTML(`${n}${x.n > 1 ? ` ×${x.n}` : ''}`, SLOT_LABEL[x.slot] || '부품', '')), '보유 부품 없음'),
    invCatHTML('총기 악세서리', accs.length, accs.map((k) => invRowHTML(ATTACHMENTS[k].name, '', '')), '보유 악세서리 없음'),
    invCatHTML('귀중품', vals.length, Object.entries(vgz).map(([n, x]) => invRowHTML(`${n}${x.n > 1 ? ` ×${x.n}` : ''}`, '', x.v.toLocaleString('ko-KR'), `<button data-sell="${encodeURIComponent(n)}">매각</button>`)), '귀중품 없음'),
  ].join('');

  // 반입 패널(우)
  const lGuns = guns.filter((k) => lw.includes(k));
  const lConsRows = [];
  for (const [n, x] of Object.entries(cg)) { const p = Math.min(lc[n] || 0, x.n); if (p > 0) lConsRows.push(invRowHTML(`${n} ×${p}`, healTag(x.heal), '', moveBtn('← 보관', `data-conss="${encodeURIComponent(n)}"`))); }
  const lArmorRows = [];
  if (hasArmor && brArmor) lArmorRows.push(invRowHTML(`방탄복 (내구도 ${Math.round(st.armorDur)}/${ARMOR_MAX})`, '', '', moveBtn('← 보관', 'data-armld="0"')));
  if (hasHelmet && brHelmet) lArmorRows.push(invRowHTML('헬멧', '', '', moveBtn('← 보관', 'data-helld="0"')));
  const lKeys = keys.filter((k) => lk.includes(k.keyId));
  document.getElementById('inv-load').innerHTML = [
    invCatHTML('총', lGuns.length, lGuns.map((k) => invRowHTML(WEAPONS[k].name, gunTag(k), '', moveBtn('← 보관', `data-bringw="${k}"`))), '반입할 총을 스태시에서 →'),
    invCatHTML('방어구', lArmorRows.length, lArmorRows, ''),
    invCatHTML('열쇠', lKeys.length, lKeys.map((k) => invRowHTML(k.name, '', '', moveBtn('← 보관', `data-bringkey="${k.keyId}"`))), ''),
    invCatHTML('소모품', lConsRows.length, lConsRows, '반입할 소모품을 스태시에서 →'),
  ].join('');

  const body = document.getElementById('inv-body');
  body.querySelectorAll('[data-bringw]').forEach((b) => b.addEventListener('click', () => toggleLoadout('loadoutW', b.dataset.bringw)));
  body.querySelectorAll('[data-consp]').forEach((b) => b.addEventListener('click', () => moveCons(decodeURIComponent(b.dataset.consp), +1)));
  body.querySelectorAll('[data-conss]').forEach((b) => b.addEventListener('click', () => moveCons(decodeURIComponent(b.dataset.conss), -1)));
  body.querySelectorAll('[data-armld]').forEach((b) => b.addEventListener('click', () => toggleLoadoutFlag('loadoutArmor')));
  body.querySelectorAll('[data-helld]').forEach((b) => b.addEventListener('click', () => toggleLoadoutFlag('loadoutHelmet')));
  body.querySelectorAll('[data-bringkey]').forEach((b) => b.addEventListener('click', () => toggleLoadout('loadoutKeys', b.dataset.bringkey)));
  body.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => sellValuable(decodeURIComponent(b.dataset.sell))));
  document.getElementById('inv-sell-all').disabled = vals.length === 0;
}
function sellValuable(name) {
  const st = loadStash();
  const keep = [], sold = [];
  for (const v of (st.valuables || [])) (v.name === name ? sold : keep).push(v);
  if (!sold.length) return;
  st.valuables = keep;
  st.roubles = (st.roubles || 0) + sold.reduce((s, v) => s + (v.value || 0), 0);
  saveStash(st);
  sfx.pickup();
  renderInventoryScreen();
  updateMenuStash();
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
  // 소모품 (#187) — 구매 시 인벤토리(소모품)에 쌓이고 다음 레이드에 반입. 사망 시 손실.
  const consN = (s.consumables || []).length;
  html += `<h3 style="margin-top:14px">소모품 <span style="color:#6f8f6f;font-weight:normal">(보유 ${consN})</span></h3>`;
  for (const c of CONSUMABLE_SHOP) {
    html += `<div class="shop-row"><div><div class="w-name">${c.name}</div><div class="w-desc">+${c.heal} HP · 레이드 반입</div></div>`
      + `<button data-buycons="${encodeURIComponent(c.name)}" ${roubles < c.value ? 'disabled' : ''}>구매 ₽${c.value.toLocaleString('ko-KR')}</button></div>`;
  }
  // 총기 부품 (#186) — 구매 시 인벤토리(총기 부품)에 쌓임. 차후 총기 커스텀에 사용.
  html += '<h3 style="margin-top:14px">총기 부품</h3>';
  for (const p of PART_TABLE) {
    html += `<div class="shop-row"><div><div class="w-name">${p.name}</div><div class="w-desc">${SLOT_LABEL[p.slot] || '부품'} 부품</div></div>`
      + `<button data-buypart="${encodeURIComponent(p.name)}" ${roubles < p.value ? 'disabled' : ''}>구매 ₽${p.value.toLocaleString('ko-KR')}</button></div>`;
  }
  // 열쇠 (#195) — 잠긴 금고 개방용. 이미 보유 시 비활성.
  const ownedKeyIds = new Set((s.keys || []).map((k) => k.keyId));
  html += '<h3 style="margin-top:14px">열쇠</h3>';
  for (const k of KEY_TABLE) {
    const owned = ownedKeyIds.has(k.keyId);
    html += `<div class="shop-row"><div><div class="w-name">${k.name}</div><div class="w-desc">잠긴 금고 개방 · 반입 필요</div></div>`
      + (owned ? '<span class="equipped">보유 중</span>' : `<button data-buykey="${k.keyId}" ${roubles < k.price ? 'disabled' : ''}>구매 ₽${k.price.toLocaleString('ko-KR')}</button>`) + '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-buykey]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    const k = KEY_BY_ID[b.dataset.buykey];
    if (!k || (st.roubles || 0) < k.price || (st.keys || []).some((x) => x.keyId === k.keyId)) return;
    st.roubles -= k.price;
    st.keys = [...(st.keys || []), { name: k.name, keyId: k.keyId, value: k.value }];
    saveStash(st);
    sfx.pickup();
    renderShop();
    updateMenuStash();
  }));
  el.querySelectorAll('[data-buypart]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    const p = PART_TABLE.find((x) => x.name === decodeURIComponent(b.dataset.buypart));
    if (!p || (st.roubles || 0) < p.value) return;
    st.roubles -= p.value;
    st.parts = [...(st.parts || []), { name: p.name, value: p.value, slot: p.slot }];
    saveStash(st);
    sfx.pickup();
    updateMenuStash();
  }));
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
  el.querySelectorAll('[data-buycons]').forEach((b) => b.addEventListener('click', () => {
    const st = loadStash();
    const c = CONSUMABLE_SHOP.find((x) => x.name === decodeURIComponent(b.dataset.buycons));
    if (!c || (st.roubles || 0) < c.value) return;
    st.roubles -= c.value;
    st.consumables = [...(st.consumables || []), { name: c.name, value: c.value, heal: c.heal }];
    saveStash(st);
    sfx.pickup();
    renderShop();       // 보유 수 갱신
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
  if (installedParts(equipSel).muzzle) g.add(muzzleDeviceMesh(size)); // 총구 장착물 표시 (#190)
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

// 슬롯에 부품 장착/교체/해제 — 인벤토리(stash.parts) ↔ 무기 슬롯(stash.weaponParts) 간 이동 (#188)
function setWeaponPart(weaponKey, slot, partName) {
  const st = loadStash();
  st.weaponParts = st.weaponParts || {};
  st.weaponParts[weaponKey] = st.weaponParts[weaponKey] || {};
  const inst = st.weaponParts[weaponKey];
  const cur = inst[slot];
  if (cur === partName) return;
  if (cur) { // 기존 부품 → 인벤토리 반환
    const cp = PART_BY_NAME[cur];
    if (cp) st.parts = [...(st.parts || []), { name: cp.name, value: cp.value, slot: cp.slot }];
    delete inst[slot];
  }
  if (partName) { // 새 부품 → 인벤토리에서 1개 차감 후 장착
    const idx = (st.parts || []).findIndex((p) => p.name === partName);
    if (idx === -1) { saveStash(st); renderEquipUI(); return; }
    st.parts.splice(idx, 1);
    inst[slot] = partName;
  }
  saveStash(st);
  sfx.reload2();
  updateMenuStash();
  renderEquipUI();
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
  $('equip-stats').innerHTML = equipStatText(effectiveWeapon(equipSel), atts);
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
  // ── 부품 슬롯 (#188): 인벤토리 부품을 슬롯에 장착/해제 (장착 시 인벤토리에서 슬롯으로 이동) ──
  const inst = installedParts(equipSel);
  const looseBySlot = {};
  for (const p of (st.parts || [])) { (looseBySlot[p.slot] = looseBySlot[p.slot] || {}); looseBySlot[p.slot][p.name] = (looseBySlot[p.slot][p.name] || 0) + 1; }
  const shead = document.createElement('div');
  shead.className = 'slot-head';
  shead.textContent = '부품 슬롯';
  ar.appendChild(shead);
  for (const slot of weaponSlots(equipSel)) {
    const cur = inst[slot];
    const avail = looseBySlot[slot] || {};
    const names = new Set([...(cur ? [cur] : []), ...Object.keys(avail)]);
    let opts = '<option value="">— 비어 있음 —</option>';
    for (const name of names) {
      const label = name === cur ? `${name} (장착됨)` : `${name} (보유 ${avail[name] || 0})`;
      opts += `<option value="${encodeURIComponent(name)}"${name === cur ? ' selected' : ''}>${label}</option>`;
    }
    const p = cur && PART_BY_NAME[cur];
    const row = document.createElement('div');
    row.className = 'slot-row';
    row.innerHTML = `<div class="slot-info"><span class="slot-label">${SLOT_LABEL[slot]}</span>`
      + `${p ? `<span class="slot-desc">${p.desc}</span>` : ''}</div>`
      + `<select class="slot-sel" data-slot="${slot}">${opts}</select>`;
    ar.appendChild(row);
  }
  ar.querySelectorAll('.slot-sel').forEach((sel) => sel.addEventListener('change', () =>
    setWeaponPart(equipSel, sel.dataset.slot, sel.value ? decodeURIComponent(sel.value) : '')));
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
  glass: new THREE.MeshStandardMaterial({ color: 0x88aab4, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.5, envMapIntensity: 1.2 }),
  schoolBase: new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 0.95 }), // 학교 1층 base 밴드(살짝 짙은 톤)
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

function buildIndustrialMap() {
  buildTexMats(); // 건축 PBR 재질 (#107) — 텍스처 로드 후 1회
  scene.fog = new THREE.Fog(0xaeb6bd, 45, 210); // 기본 안개 복원(맵 전환 시 숲 안개 잔존 방지)
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

  // 나무 (Quaternius 스타일라이즈드 — 산업지대는 침엽/일반/고사목/자작 위주로 황량하게) #165
  const trees = [[-70, -60], [-75, 20], [70, 60], [65, -60], [-20, 70], [50, 70], [-70, 70], [75, -20], [-40, -70], [20, -68], [-5, -55], [68, 30]];
  const treeKinds = [...TREE_KEYS.pine, ...TREE_KEYS.pine, ...TREE_KEYS.normal, ...TREE_KEYS.dead, ...TREE_KEYS.dead, ...TREE_KEYS.birch];
  for (const [x, z] of trees) {
    const kind = treeKinds[Math.floor(Math.random() * treeKinds.length)];
    placeTree(kind, x, z, 6 + Math.random() * 3.5);
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
  const total = LOOT_POOL.reduce((s, i) => s + i.w, 0);
  let r = Math.random() * total;
  for (const it of LOOT_POOL) { r -= it.w; if (r <= 0) return it; }
  return LOOT_POOL[0];
}
function rollItems(min, max) {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  return Array.from({ length: n }, rollItem);
}
// 리스크/보상 구배 (#194): 핫존(맵 중심 근처)일수록 루팅 밀도·가치↑, 가장자리는 희박·저가치.
let HOT_CENTER = new THREE.Vector2(0, 0); // 고가치 핫존 중심(맵별 갱신)
function lootTier(x, z) {
  const d = Math.hypot(x - HOT_CENTER.x, z - HOT_CENTER.y);
  if (d < 32) return { key: 'high', min: 3, max: 5, bias: 2.4, skip: 0.06, color: 0xffcf5a }; // 핫존 — 금빛 램프
  if (d < 62) return { key: 'mid',  min: 2, max: 4, bias: 0.9, skip: 0.18, color: 0x9fdc6a };
  return { key: 'low', min: 1, max: 3, bias: 0.0, skip: 0.32, color: 0x8fb0b8 };            // 가장자리
}
function rollItemBiased(bias) {
  const wt = (it) => it.w * (1 + bias * Math.min(1, (it.value || 0) / 40000)); // 고가치일수록 가중↑
  const total = LOOT_POOL.reduce((s, it) => s + wt(it), 0);
  let r = Math.random() * total;
  for (const it of LOOT_POOL) { r -= wt(it); if (r <= 0) return it; }
  return LOOT_POOL[0];
}
function rollItemsTier(tier) {
  const n = tier.min + Math.floor(Math.random() * (tier.max - tier.min + 1));
  return Array.from({ length: n }, () => rollItemBiased(tier.bias));
}

let LOOT_SPOTS = [
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
    const tier = lootTier(x, z);                 // 핫존 구배 (#194)
    if (Math.random() < tier.skip) continue;     // 매 레이드 배치가 조금씩 다름
    // 보급 상자 모델 (통과 가능 — 루팅 동선 방해 방지)
    const mesh = placeModel('crate', x, z, {
      height: 0.8, rotY: Math.random() * Math.PI, collide: false, block: false,
    });
    // 고도 스폰 (2층 등): yAbs 가 있으면 그 바닥 높이로 올림
    const gy = yAbs !== undefined ? yAbs : terrainH(x, z);
    if (yAbs !== undefined) mesh.position.y += yAbs - terrainH(x, z);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(tier.key === 'high' ? 0.08 : 0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: tier.color }));   // 램프 색으로 등급 표시
    lamp.position.set(x, gy + 0.78, z);
    scene.add(lamp);
    interactables.push({
      pos: new THREE.Vector3(x, gy + 0.5, z), mesh, lamp,
      items: rollItemsTier(tier), opened: false, label: '보급 상자',
      raidObject: true,
    });
    mesh.userData.raidObject = true;
  }
  // 잠긴 금고 (#195): 핫존 근처에 배치, 대응 열쇠 반입해야 개방 — 고가치 루팅.
  const richTier = { key: 'high', min: 5, max: 7, bias: 3.2, skip: 0, color: 0xff8a4a };
  for (const L of [{ dx: -9, dz: -5, keyId: 'warehouse' }, { dx: 11, dz: 6, keyId: 'office' }]) {
    const x = THREE.MathUtils.clamp(HOT_CENTER.x + L.dx, -WORLD_HALF + 4, WORLD_HALF - 4);
    const z = THREE.MathUtils.clamp(HOT_CENTER.y + L.dz, -WORLD_HALF + 4, WORLD_HALF - 4);
    const gy = terrainH(x, z);
    const mesh = placeModel('crate', x, z, { height: 0.9, rotY: Math.random() * Math.PI, collide: false, block: false });
    mesh.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(0x5a4030); o.material.emissive && o.material.emissive.setHex(0x2a1808); } });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4a }));
    lamp.position.set(x, gy + 0.9, z); scene.add(lamp);
    interactables.push({
      pos: new THREE.Vector3(x, gy + 0.5, z), mesh, lamp,
      items: rollItemsTier(richTier), opened: false, label: '잠긴 금고',
      locked: true, lockKey: L.keyId, raidObject: true,
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

function spawnEnemyAt(p, waypoint) {
  const m = makeEnemyMesh();
  m.group.position.copy(p);
  scene.add(m.group);
  const e = {
    ...m, pos: m.group.position, hp: ENEMY.hp, state: 'patrol',
    waypoint: waypoint || randomOpenPoint(),
    idleTimer: 0, detectTimer: Math.random() * 0.15, lastKnown: new THREE.Vector3(),
    lostTimer: 0, fireTimer: 1 + Math.random(), burstLeft: 0, mag: ENEMY.magSize,
    reloadT: 0, stance: 'stand', rollT: 0, rollDir: null, stuckTimer: 0, lastPos: p.clone(), dead: false,
  };
  m.body.userData = { enemy: e, part: 'body' };
  m.head.userData = { enemy: e, part: 'head' };
  // 원샷 종료 훅 — spread 복사 후의 최종 enemy 객체(e)에 바인딩 (makeEnemyMesh 내부에서 하면 유실)
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
  return e;
}
function spawnEnemies(avoidPos) {
  for (let i = 0; i < ENEMY.count; i++) {
    let p;
    do { p = randomOpenPoint(); } while (p.distanceTo(avoidPos) < 42); // 스폰 안전 반경 (#110)
    let wp;
    do { wp = randomOpenPoint(); } while (wp.distanceTo(avoidPos) < 35); // 첫 웨이포인트도 스폰 근처 금지 (#110)
    spawnEnemyAt(p, wp);
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
let EXTRACT_CANDIDATES = [
  { name: '북동 게이트', pos: new THREE.Vector3(76, 0, -76) },
  { name: '남서 통로', pos: new THREE.Vector3(-76, 0, 76) },
  { name: '남동 담장', pos: new THREE.Vector3(76, 0, 76) },
  { name: '북서 수풀', pos: new THREE.Vector3(-76, 0, -76) },
];

function makeExtractBeacon(pos, color) {
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 40, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.set(pos.x, 20, pos.z); scene.add(beam);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(EXTRACT_RADIUS - 0.4, EXTRACT_RADIUS, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.05, pos.z); scene.add(ring);
  const light = new THREE.PointLight(color, 30, 18, 2);
  light.position.set(pos.x, 3, pos.z); scene.add(light);
  return { beam, ring, light };
}
function setupExtractions(spawnPos) {
  // 무료 탈출: 스폰에서 먼 가장자리 2곳 (안전하지만 멀다)
  const sorted = [...EXTRACT_CANDIDATES].sort(
    (a, b) => b.pos.distanceTo(spawnPos) - a.pos.distanceTo(spawnPos));
  for (const cand of sorted.slice(0, 2)) {
    extractions.push({ name: cand.name, pos: cand.pos.clone(), ...makeExtractBeacon(cand.pos, 0x51ff7a), progress: 0, hold: EXTRACT_HOLD });
  }
  // 유료 빠른 탈출 (#194): 핫존 근처 — 고위험 위치지만 유지시간 짧음. ₽ 지불 필요.
  const ang = Math.random() * Math.PI * 2;
  const fp = new THREE.Vector3(
    THREE.MathUtils.clamp(HOT_CENTER.x + Math.cos(ang) * 42, -WORLD_HALF + 6, WORLD_HALF - 6), 0,
    THREE.MathUtils.clamp(HOT_CENTER.y + Math.sin(ang) * 42, -WORLD_HALF + 6, WORLD_HALF - 6));
  fp.y = terrainH(fp.x, fp.z);
  extractions.push({ name: '유료 탈출', pos: fp, ...makeExtractBeacon(fp, 0xffcf5a), progress: 0, hold: EXTRACT_HOLD * 0.55, fee: 15000 });
}

// 동적 이벤트 — 에어드랍(보급 투하) (#197)
function triggerAirdrop() {
  state.airdropDone = true;
  let p; do { p = randomOpenPoint(); } while (Math.max(Math.abs(p.x), Math.abs(p.z)) > WORLD_HALF - 20);
  const gy = terrainH(p.x, p.z);
  const mesh = placeModel('crate', p.x, p.z, { height: 1.0, rotY: Math.random() * Math.PI, collide: false, block: false });
  mesh.position.y += 34; // 상공에서 낙하 시작
  mesh.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); if (o.material.emissive) o.material.emissive.setHex(0x0a2635); } });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x5ac8ff }));
  lamp.position.set(p.x, gy + 0.9, p.z); scene.add(lamp);
  interactables.push({
    pos: new THREE.Vector3(p.x, gy + 0.5, p.z), mesh, lamp,
    items: rollItemsTier({ key: 'high', min: 6, max: 8, bias: 3.4 }), opened: false, label: '보급 투하',
    airdrop: true, landing: true, groundY: gy, raidObject: true,
  });
  mesh.userData.raidObject = true;
  airdropBeacon = makeExtractBeacon(p, 0x5ac8ff); // 파란 비컨(먼 거리에서도 보임)
  for (let i = 0; i < 2; i++) { // 경비 스캐브
    const gp = new THREE.Vector3(p.x + (Math.random() * 2 - 1) * 8, 0, p.z + (Math.random() * 2 - 1) * 8);
    gp.y = terrainH(gp.x, gp.z); spawnEnemyAt(gp, p.clone());
  }
  addFeed('📦 보급 투하 — 지도(파란 점) 확인!');
  if (sfx.extractDone) sfx.extractDone();
}
function updateEvents(dt) {
  if (!state.airdropDone && state.raidTime <= (state.airdropAt || 0)) triggerAirdrop();
  for (const it of interactables) { // 낙하 애니메이션
    if (!it.landing) continue;
    it.mesh.position.y -= 22 * dt;
    if (it.mesh.position.y <= it.groundY + 0.4) { it.mesh.position.y = it.groundY + 0.4; it.landing = false; if (sfx.pickup) sfx.pickup(); }
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
    dom.extractProgress.style.display = 'block';
    // 유료 탈출: 보유 ₽ 부족하면 진행 불가 (#194)
    if (inZone.fee) {
      const money = loadStash().roubles || 0;
      if (money < inZone.fee) {
        inZone.progress = 0;
        dom.extractLabel.textContent = `${inZone.name} — ₽${inZone.fee.toLocaleString('ko-KR')} 필요 (보유 ₽${money.toLocaleString('ko-KR')})`;
        dom.extractFill.style.width = '0%';
        return;
      }
    }
    const hold = inZone.hold || EXTRACT_HOLD;
    inZone.progress += dt;
    extractTickAcc += dt;
    if (extractTickAcc > 1) { extractTickAcc = 0; sfx.extractTick(); }
    dom.extractLabel.textContent = inZone.fee
      ? `${inZone.name} (₽${inZone.fee.toLocaleString('ko-KR')}) — 탈출 진행 중`
      : `${inZone.name} — 탈출 진행 중`;
    dom.extractFill.style.width = `${Math.min(100, inZone.progress / hold * 100)}%`;
    if (inZone.progress >= hold) {
      pendingExtractFee = inZone.fee || 0;
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
  // 사격 중엔 질주 불가 — 발사 버튼을 누르면 질주가 풀리고 총을 들어올림(raiseT 지연) (#180)
  const wantSprint = ((keys['ShiftLeft'] && keys['KeyW']) || touch.sprint) && hasInput && !player.aiming && !gun.triggerDown;
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

  // 실제 변위 기준 수평 속도 (벽에 막히면 0)
  const hSpeed = Math.hypot(player.pos.x - prevPX, player.pos.z - prevPZ) / Math.max(dt, 1e-4);

  // --- 캐릭터 + 카메라 (3인칭/1인칭 전환, #145) ---
  updatePlayerChar(dt, hSpeed, wish.x, wish.z);
  if (viewMode === 'fps') updateFPSCamera();
  else updateTPSCamera(dt);

  // 발소리 (3인칭이므로 헤드밥 제거)
  if (player.grounded && hSpeed > 0.5) {
    bobPhase += dt * hSpeed * 1.7;
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

// ============================================================
// 플레이어 캐릭터 (3인칭 미소녀) — #116
// ============================================================
let pc = null;               // 플레이어 캐릭터 객체
const PC_KEY = 'girlA';      // 주인공 모델 고정
function buildPlayerChar() {
  const model = SkeletonUtils.clone(ASSETS[PC_KEY].scene);
  const bb = new THREE.Box3().setFromObject(model);
  const s = CHAR_HEIGHT / Math.max(0.001, bb.max.y - bb.min.y);
  model.scale.setScalar(s);
  model.position.y = -bb.min.y * s;
  model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const g = new THREE.Group();
  g.add(model);
  g.visible = false;
  scene.add(g);

  const clips = CHAR_CLIPS[PC_KEY];
  const mixer = new THREE.AnimationMixer(model);
  const mkOnce = (clip) => { if (!clip) return null; const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; return a; };
  // 상·하체 2레이어 (#180/#201): 하체=로코모션(**Hips+다리**, 골반 움직임 포함 → 걷기 자연스러움),
  //  상체=Spine 위(몸통+팔, 무기자세). 표준 TPS(UE Layered Blend Per Bone) 방식 — 스파인 기준 분리.
  //  상체 포즈는 **정면 기준(readyGun)** 만 사용 → 비틀린 aim 클립을 절대 override 하면 팔이 틀어져서(splay) 안 씀.
  //  항상 2레이어(전신 견착 모드 없음) → 조준/사격 중 이동해도 다리 로코모션, 전환 T자 깜박임 없음.
  const isLowerBone = (b) => /Skirt/i.test(b) || /^(Hips|Left(UpLeg|Leg|Foot|Toes)|Right(UpLeg|Leg|Foot|Toes)|J_Sec_[LR]_(Upper|Lower)Leg|J_Bip_[LR]_ToeBase_end)/.test(b);
  const splitClip = (clip, keepLower) => {
    if (!clip) return null;
    const tr = clip.tracks.filter((t) => isLowerBone(t.name.split('.')[0]) === keepLower);
    return tr.length ? new THREE.AnimationClip(clip.name + (keepLower ? '_lo' : '_up'), clip.duration, tr) : null;
  };
  const splitAct = (clip, keepLower) => { const c = splitClip(clip, keepLower); return c ? mixer.clipAction(c) : null; };
  const idleSrc = clips.idleGun || clips.idle;
  const actIdleLower = splitAct(idleSrc, true);   // Hips+다리
  const actWalkLower = splitAct(clips.walk, true) || splitAct(clips.run, true) || actIdleLower;
  const actRunLower  = splitAct(clips.run, true) || actWalkLower;
  const upperReady = splitAct(clips.readyGun, false) || splitAct(idleSrc, false);  // 지향 대기(몸통+팔, 정면)
  const upperRun   = splitAct(clips.run, false) || upperReady;                     // 질주 팔
  // 어깨 견착 additive 상체 오프셋 (#202): 견착(aim) 상체를 aimNeutral 기준 델타로 만들어
  // readyGun 위에 additive 로 얹음 — 비틀린 hips 베이스가 상쇄돼 splay 없이 견착 자세가 나옴.
  let upperAimAdd = null;
  {
    const aimU = splitClip(clips.aim, false);
    const ref = clips.aimNeutral || idleSrc;
    if (aimU && ref) {
      const add = THREE.AnimationUtils.makeClipAdditive(aimU.clone(), 0, ref);
      upperAimAdd = mixer.clipAction(add);
      upperAimAdd.play(); upperAimAdd.setEffectiveWeight(0);
    }
  }
  // 견착 이동 (#206): aim 클립을 다리/비다리로 쪼갬. 상체+골반(bladed=견착)은 유지하고 다리만
  //  정지=aim 스탠스 / 이동=걷기 로 크로스페이드 → splay 없이 견착 유지하며 다리 이동.
  const isLegBone = (b) => /^(Left(UpLeg|Leg|Foot|Toes)|Right(UpLeg|Leg|Foot|Toes)|J_Sec_[LR]_(Upper|Lower)Leg|J_Bip_[LR]_ToeBase_end)/.test(b);
  const splitByLeg = (clip, keepLeg) => { if (!clip) return null; const tr = clip.tracks.filter((t) => isLegBone(t.name.split('.')[0]) === keepLeg); return tr.length ? mixer.clipAction(new THREE.AnimationClip(clip.name + (keepLeg ? '_lg' : '_bd'), clip.duration, tr)) : null; };
  const aimBody = splitByLeg(clips.aim, false);   // 상체+골반(견착)
  const aimLegs = splitByLeg(clips.aim, true);    // 견착 다리 스탠스(정지)
  const walkLegsAim = splitByLeg(clips.walk, true) || splitByLeg(clips.run, true); // 이동 다리
  const actReload = (() => { const a = splitAct(clips.reload, false); if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } return a; })() || mkOnce(clips.reload);
  const actAim = clips.aim ? mixer.clipAction(clips.aim) : null; // 캘리브레이션용 전체 견착 클립
  const actDeath = mkOnce(clips.death);
  const mkAim = (clip) => { if (!clip) return null; const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); return a; };
  const actAimUp = mkAim(clips.aimUp);
  const actAimDown = mkAim(clips.aimDown);

  // 총을 양손(오른손=그립, 왼손=총열) 사이에 배치 — 매 프레임 두 손 위치로 정렬 (#131)
  const handR = model.getObjectByName('RightHand');
  const handL = model.getObjectByName('LeftHand');
  const lArm = model.getObjectByName('LeftArm');       // 왼팔 IK 체인 (#204)
  const lFore = model.getObjectByName('LeftForeArm');
  const gunPivot = new THREE.Group();
  if (handR) { handR.add(gunPivot); gunPivot.scale.setScalar(1 / s); } // 오른손 본에 리지드 부착 (#150)
  else scene.add(gunPivot);

  const spine = model.getObjectByName('Spine') || null;
  pc = {
    group: g, model, mixer, handR, handL, lArm, lFore, gunPivot, spine, spinePose: null,
    ikBlend: 0, leftGrip: new THREE.Vector3(),
    actIdleLower, actWalkLower, actRunLower, upperReady, upperRun, upperAimAdd,
    aimBody, aimLegs, walkLegsAim,
    actReload, actAim, actDeath, actAimUp, actAimDown,
    lowerAct: null, upperAct: null, upperShot: null, lowerSwT: 0, upperSwT: 0,
    aimBlend: 0, fireHold: 0, gunAim: 0, aimWorld: null, faceYaw: 0, curGun: null,
    gunKick: 0, activeT: 99,
  };
  mixer.addEventListener('finished', (ev) => {
    if (pc && ev.action === pc.upperShot) { // 재장전 종료 → 상체 레이어 재선정(하체는 그대로 유지)
      pc.upperShot.fadeOut(0.18);
      pc.upperShot = null; pc.upperAct = null;
    }
  });
  // 총 로컬 회전 캘리브레이션: Aim 포즈에서 (오른손→왼손)=총열축 기준 1회 산출 (#150)
  pc.gunLocalQuat = calibrateGunLocal(model, mixer, actAim, handR, handL);
  // 왼손 그립 포즈 캡처(손목+손가락 로컬 회전) — IK 로 손 위치만 옮기고 이 포즈로 총을 쥐게 함 (#204)
  pc.lGrip = captureLeftGrip(mixer, clips.readyGun || clips.idleGun || clips.idle, handL);
  // 초기 자세: 하체 idle(다리) + 상체 지향 대기 + additive 피치 준비(가중치 0)
  if (pc.actIdleLower) { pc.actIdleLower.reset().play(); pc.lowerAct = pc.actIdleLower; }
  if (pc.upperReady) { pc.upperReady.reset().play(); pc.upperAct = pc.upperReady; }
  if (pc.actAimUp) { pc.actAimUp.reset().play(); pc.actAimUp.setEffectiveWeight(0); }
  if (pc.actAimDown) { pc.actAimDown.reset().play(); pc.actAimDown.setEffectiveWeight(0); }
  // additive 액션은 captureLeftGrip 의 stopAllAction 으로 멈췄으므로 재시작 (가중치 0) (#205)
  if (pc.upperAimAdd) { pc.upperAimAdd.reset().play(); pc.upperAimAdd.setEffectiveWeight(0); }
  setPlayerGun(GUN.key);
}

// Aim 포즈를 임시 100% 적용해 총(오른손 부착)의 손-로컬 회전을 결정적으로 산출 (#150)
function calibrateGunLocal(model, mixer, actAim, handR, handL) {
  const q = new THREE.Quaternion();
  if (!actAim || !handR || !handL) return q;
  mixer.stopAllAction();
  actAim.reset().play(); actAim.setEffectiveWeight(1); actAim.time = 0.6;
  mixer.update(0);
  model.updateWorldMatrix(true, true);
  const rh = handR.getWorldPosition(new THREE.Vector3());
  const lh = handL.getWorldPosition(new THREE.Vector3());
  const bz = lh.sub(rh); if (bz.lengthSq() < 1e-6) bz.set(0, 0, 1); bz.normalize(); // 총열축
  const bx = new THREE.Vector3().crossVectors(WORLD_UP, bz); if (bx.lengthSq() < 1e-5) bx.set(1, 0, 0); bx.normalize();
  const by = new THREE.Vector3().crossVectors(bz, bx).normalize();
  const qt = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz));
  const qh = handR.getWorldQuaternion(new THREE.Quaternion());
  q.copy(qh.invert().multiply(qt)); // 손 로컬 프레임 기준 (총 배럴 = gunPivot +Z)
  actAim.stop(); mixer.stopAllAction(); // 원상 복구(초기 레이어는 호출부에서 시작)
  mixer.update(0);
  return q;
}

// 장착 무기 모델을 gunPivot 에 반영 (equipWeapon 연동). gunPivot 은 매 프레임 두 손으로 정렬.
function setPlayerGun(key) {
  if (!pc) return;
  if (pc.curGun) { pc.gunPivot.remove(pc.curGun); pc.curGun = null; }
  const w = WEAPONS[key]; if (!w) return;
  const m = instantiate(w.model);
  // TPS 총 길이는 무기별 viewLen 에 비례 (라이플 0.62→0.82 유지, 리볼버 등은 그에 맞춰 축소). #150
  // 기존 모든 무기 0.82 고정은 리볼버가 라이플 크기가 되는 문제가 있었음.
  const tpsLen = (w.viewLen || 0.62) * (0.82 / 0.62) * (w.tpsScale || 1); // tpsScale: 무기별 TPS 크기 미세보정
  const size = normalizeModel(m, tpsLen, -Math.PI / 2); // 실측 비율(총구 +Z), 중심이 원점
  // 그립을 gunPivot 원점(=오른손)에 맞춤: 그립은 중심보다 뒤(-Z)라 +Z 로 이동
  m.position.z += size.z * 0.28;
  m.position.y += 0.02; // 손바닥 위에 얹히도록 살짝
  pc.gunLen = size.z;
  // 왼손 IK 목표: gunPivot(그립) 로컬에서 총열덮개 지점 (+Z=총열 방향), 무기별 미세보정 (#204)
  pc.leftGrip.set(0.03, 0.045, size.z * (w.tpsLeftGrip || 0.37));
  brightenMaterials(m, 3.2);
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  pc.gunPivot.add(m);
  pc.curGun = m;
}

// 총은 오른손 본에 리지드 부착(#150). 위치(그립)는 mocap 손을 상속하고,
// 방향은 비조준=mocap 손 방향 / 조준=실제 사격선(카메라 전방)으로 정렬 → 총열↔명중선 일치.
const _ghCamDir = new THREE.Vector3(), _ghBx = new THREE.Vector3(), _ghBy = new THREE.Vector3(),
  _ghM4 = new THREE.Matrix4(), _ghQt = new THREE.Quaternion(), _ghQh = new THREE.Quaternion(), _ghAimLocal = new THREE.Quaternion(),
  _ghAimPt = new THREE.Vector3(), _ghPivot = new THREE.Vector3();
// 총열 정렬용 조준 수렴점 타겟 (장애물+소품+적) — fireShot 과 동일 집합이라 탄=총열 수렴 일치
function gunConvTargets() {
  const t = [...obstacleMeshes, ...propMeshes];
  for (const e of enemies) if (!e.dead) { if (e.body) t.push(e.body); if (e.head) t.push(e.head); }
  return t;
}
function updateGunHold() {
  if (!pc || !pc.gunPivot || !pc.gunLocalQuat) return;
  pc.gunPivot.quaternion.copy(pc.gunLocalQuat); // 기본: mocap 손 방향 (캘리브레이션 로컬 회전)
  // 지향사격·조준·사격 중엔 배럴(+Z)을 "조준 수렴점"(실제 탄착점)으로 정렬 → 총열선과 트레이서 일치 (#150/#180)
  const ab = THREE.MathUtils.clamp(Math.max(pc.gunAim || 0, pc.fireHold || 0, pc.aimBlend || 0), 0, 1);
  if (ab > 0.01 && pc.handR) {
    camera.getWorldDirection(_ghCamDir).normalize();
    _aimRay.set(camera.position, _ghCamDir); _aimRay.far = GUN.range;
    const chits = _aimRay.intersectObjects(gunConvTargets(), false);
    const cdist = chits.length ? Math.max(chits[0].distance, 2) : GUN.range;
    _ghAimPt.copy(camera.position).addScaledVector(_ghCamDir, cdist);
    (pc.aimWorld || (pc.aimWorld = new THREE.Vector3())).copy(_ghAimPt); // fireShot 재사용 → 탄·총열 동일 수렴
    pc.gunPivot.getWorldPosition(_ghPivot);             // 그립(≈총 회전 피벗) 위치
    const bz = _ghAimPt.clone().sub(_ghPivot); if (bz.lengthSq() < 1e-6) bz.copy(_ghCamDir); bz.normalize(); // 그립→수렴점 = 총열축
    _ghBx.crossVectors(WORLD_UP, bz); if (_ghBx.lengthSq() < 1e-5) _ghBx.set(1, 0, 0); _ghBx.normalize();
    _ghBy.crossVectors(bz, _ghBx).normalize();
    _ghM4.makeBasis(_ghBx, _ghBy, bz);
    _ghQt.setFromRotationMatrix(_ghM4);                 // 목표 월드 회전 (배럴=수렴점 방향)
    pc.handR.getWorldQuaternion(_ghQh);
    _ghAimLocal.copy(_ghQh.invert().multiply(_ghQt));   // 손 로컬 프레임 기준
    pc.gunPivot.quaternion.slerp(_ghAimLocal, ab);      // mocap→조준 블렌드
  } else { pc.aimWorld = null; }
  if (pc.gunKick > 0.001) pc.gunPivot.rotateX(-pc.gunKick); // 반동 젖힘
}

// readyGun 포즈에서 왼손목+손가락 로컬 회전을 1회 캡처 → 어떤 자세에서도 총 쥔 손 유지 (#204)
function captureLeftGrip(mixer, clip, handL) {
  if (!clip || !handL) return null;
  mixer.stopAllAction();
  const a = mixer.clipAction(clip); a.reset().setEffectiveWeight(1).play(); a.time = 0;
  mixer.update(0);
  const hand = handL.quaternion.clone();
  const fingers = [];
  handL.traverse((o) => { if (o !== handL && /J_Bip_L_/.test(o.name)) fingers.push({ bone: o, q: o.quaternion.clone() }); });
  a.stop(); mixer.stopAllAction();
  return { hand, fingers };
}

// 왼손을 총열덮개로 끌어오는 2본 IK (CCD) — 총이 오른손에 고정돼 왼손이 클립대로 놀아
// 탄창/총을 뚫는 문제 해결 (#204). 재장전 중엔 끔(왼손이 탄창으로 가야 함).
const _ikTgt = new THREE.Vector3(), _ikJp = new THREE.Vector3(), _ikEp = new THREE.Vector3();
const _ikToE = new THREE.Vector3(), _ikToT = new THREE.Vector3();
const _ikBwq = new THREE.Quaternion(), _ikPwq = new THREE.Quaternion(), _ikDq = new THREE.Quaternion();
const _ikU0 = new THREE.Quaternion(), _ikL0 = new THREE.Quaternion();
const _ikGrip = new THREE.Vector3(), _ikBarrel = new THREE.Vector3(), _ikSh = new THREE.Vector3();
const _ikD = new THREE.Vector3(), _ikA = new THREE.Vector3(), _ikB = new THREE.Vector3(), _ikC = new THREE.Vector3();
// 왼손목을 총열 기준 그립 프레임으로 정렬 → 지향/견착(총 방향 달라도) 모두 일관 그립. 정지 그립 실측 (#206)
const GRIP_WRIST_OFFSET = new THREE.Quaternion(-0.8738, -0.1719, 0.4526, -0.0461);
const _handWQ = new THREE.Quaternion(), _pwq2 = new THREE.Quaternion(), _handLQ = new THREE.Quaternion();
const _gx = new THREE.Vector3(), _gy = new THREE.Vector3(), _gripM = new THREE.Matrix4(), _gripFQ = new THREE.Quaternion();
function rotateBoneToward(bone, jointPos, target) {
  bone.getWorldPosition(_ikJp);
  pc.handL.getWorldPosition(_ikEp);
  _ikToE.subVectors(_ikEp, _ikJp); _ikToT.subVectors(target, _ikJp);
  if (_ikToE.lengthSq() < 1e-8 || _ikToT.lengthSq() < 1e-8) return;
  _ikToE.normalize(); _ikToT.normalize();
  _ikDq.setFromUnitVectors(_ikToE, _ikToT);             // 월드 회전: 현재 end방향 → 목표방향
  bone.getWorldQuaternion(_ikBwq); _ikBwq.premultiply(_ikDq);
  bone.parent.getWorldQuaternion(_ikPwq);
  bone.quaternion.copy(_ikPwq.invert().multiply(_ikBwq));
  bone.updateWorldMatrix(false, true);                  // 자식(팔뚝·손) 월드 갱신
}
function updateLeftHandIK(dt) {
  if (!pc || !pc.lArm || !pc.lFore || !pc.handL || !pc.gunPivot || !pc.curGun) return;
  const wantIK = pc.upperShot ? 0 : 1;                  // 재장전 중엔 끔
  pc.ikBlend = (pc.ikBlend || 0) + (wantIK - (pc.ikBlend || 0)) * Math.min(1, dt * 10);
  if (pc.ikBlend < 0.01) return;
  pc.gunPivot.updateWorldMatrix(true, false);
  pc.lArm.updateWorldMatrix(true, true);               // 어깨~손 체인 월드 갱신
  if (!pc.armReach) {                                   // 왼팔 리치 1회 캐시(본 길이 고정)
    pc.lArm.getWorldPosition(_ikA); pc.lFore.getWorldPosition(_ikB); pc.handL.getWorldPosition(_ikC);
    pc.armReach = _ikA.distanceTo(_ikB) + _ikB.distanceTo(_ikC);
  }
  // 총열 라인에서 왼팔이 닿는 가장 앞 지점으로 목표 클램프 — 리치 밖(팔 짧아 총 멀리)이면
  // 그립쪽으로 당겨 손이 허공이 아니라 총에 닿게 (#204b). 견착(총 몸쪽)이면 총열덮개까지 닿음.
  const M = pc.gunPivot.matrixWorld;
  _ikGrip.set(0, pc.leftGrip.y, 0).applyMatrix4(M);    // 그립 지점(총열 라인 원점)
  _ikBarrel.set(0, pc.leftGrip.y, 1).applyMatrix4(M).sub(_ikGrip).normalize(); // 총열 +Z 월드방향
  pc.lArm.getWorldPosition(_ikSh);
  _ikD.subVectors(_ikGrip, _ikSh);
  const R = pc.armReach * 0.98;
  const Bc = 2 * _ikD.dot(_ikBarrel), Cc = _ikD.lengthSq() - R * R, disc = Bc * Bc - 4 * Cc;
  let t = pc.leftGrip.z;
  if (disc >= 0) { const tr = (-Bc + Math.sqrt(disc)) / 2; if (tr < t) t = Math.max(0, tr); } else t = 0;
  _ikTgt.copy(_ikGrip).addScaledVector(_ikBarrel, t); // 도달 가능한 총 위 지점
  _ikU0.copy(pc.lArm.quaternion); _ikL0.copy(pc.lFore.quaternion); // 애니 원본 (블렌드용)
  for (let i = 0; i < 3; i++) {                         // CCD: 팔뚝 → 어깨
    rotateBoneToward(pc.lFore, null, _ikTgt);
    rotateBoneToward(pc.lArm, null, _ikTgt);
  }
  // 애니 원본 ↔ IK 결과 블렌드 (재장전 전환 시 팝 방지)
  if (pc.ikBlend < 0.999) {
    const ikU = pc.lArm.quaternion.clone(), ikL = pc.lFore.quaternion.clone();
    pc.lArm.quaternion.copy(_ikU0).slerp(ikU, pc.ikBlend);
    pc.lFore.quaternion.copy(_ikL0).slerp(ikL, pc.ikBlend);
    pc.lArm.updateWorldMatrix(false, true);
  }
  // 손목=총열 그립 프레임·offset(총 방향 무관 일관 그립) + 손가락=캡처. ikBlend 블렌드(재장전 시 클립 복귀)
  if (pc.lGrip) {
    _gx.crossVectors(WORLD_UP, _ikBarrel); if (_gx.lengthSq() < 1e-5) _gx.set(1, 0, 0); _gx.normalize();
    _gy.crossVectors(_ikBarrel, _gx).normalize();
    _gripM.makeBasis(_gx, _gy, _ikBarrel);
    _gripFQ.setFromRotationMatrix(_gripM);
    _handWQ.copy(_gripFQ).multiply(GRIP_WRIST_OFFSET);        // 목표 손목 월드회전
    pc.handL.parent.getWorldQuaternion(_pwq2);
    _handLQ.copy(_pwq2.invert().multiply(_handWQ));           // 로컬로 변환
    pc.handL.quaternion.slerp(_handLQ, pc.ikBlend);
    for (const f of pc.lGrip.fingers) f.bone.quaternion.slerp(f.q, pc.ikBlend);
  }
}

// 재장전: 상체 레이어만 재장전 클립으로 교체 (하체는 현재 로코모션 유지) (#180)
//  → 서서 재장전 = 다리 정지, 달리며 재장전 = 다리 계속 달림.
function playPcReload(fade = 0.12) {
  if (!pc || !pc.actReload) return;
  if (pc.upperAct) { pc.upperAct.fadeOut(fade); pc.upperAct = null; } // 상체만 재장전으로 교체(하체 로코모션 유지)
  if (!pc.lowerAct && pc.actIdleLower) { pc.actIdleLower.reset().fadeIn(fade).play(); pc.lowerAct = pc.actIdleLower; }
  pc.upperShot = pc.actReload;
  pc.actReload.reset().fadeIn(fade).play();
}

// 캐릭터 총구 위치 (트레이서/화염 원점) — gunPivot 그립에서 총열(+Z) 방향으로 (월드 변환)
const _muzWp = new THREE.Vector3(), _muzWq = new THREE.Quaternion();
function pcMuzzle() {
  if (pc && pc.curGun && pc.gunPivot) {
    pc.gunPivot.updateWorldMatrix(true, false);
    pc.gunPivot.getWorldPosition(_muzWp);
    pc.gunPivot.getWorldQuaternion(_muzWq);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_muzWq);
    return _muzWp.clone().addScaledVector(fwd, pc.gunLen || 0.7);
  }
  const fy = pc ? pc.faceYaw : player.yaw;
  return new THREE.Vector3(0.22, 1.32, 0.55).applyEuler(new THREE.Euler(0, fy, 0)).add(player.pos);
}

// 3인칭 캐릭터 갱신 — 위치/회전/애니메이션
function updatePlayerChar(dt, hSpeed, moveDirX, moveDirZ) {
  if (!pc) return;
  pc.group.visible = state.phase === 'raid' && !scopeShown && viewMode === 'tps'; // FPS 는 캐릭터 숨김 (#145)
  if (pc.gunPivot) pc.gunPivot.visible = pc.group.visible;
  pc.group.position.set(player.pos.x, player.pos.y, player.pos.z);

  pc.fireFaceT = Math.max(0, (pc.fireFaceT || 0) - dt);
  const camFace = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw));
  const moving = hSpeed > 0.6 && (moveDirX || moveDirZ);
  const jog = hSpeed > 3.2;
  const sprintingNow = player.sprinting && moving;
  const combat = player.aiming || pc.fireFaceT > 0;   // 조준 또는 사격 직후 = 사격 자세
  pc.activeT += dt;
  if (moving || combat) pc.activeT = 0;

  // 향하는 방향 (#200): 평상시=이동 방향 / 조준·사격 시=즉시 카메라 정면(빠른 회전) / 질주=이동 방향
  let targetFace;
  if (combat) targetFace = camFace;
  else if (moving) targetFace = Math.atan2(moveDirX, moveDirZ);
  else targetFace = pc.faceYaw;
  let dy = targetFace - pc.faceYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const turn = combat ? dt * 30 : dt * 11;            // 사격 시 즉시 몸 정렬
  pc.faceYaw += THREE.MathUtils.clamp(dy, -turn, turn);
  pc.group.rotation.y = pc.faceYaw;

  // ── 견착 모드 (#203/#206): 조준 시 aim 상체(견착) + 다리는 정지=aim스탠스/이동=걷기 크로스페이드.
  //    질주는 조준 중 불가(wantSprint 게이팅)라 조준하면 걷기까지만. aimBody 없으면 전신 actAim 폴백. ──
  const wantFull = player.aiming && !sprintingNow && !pc.upperShot && !!pc.actAim;
  const useSplit = !!pc.aimBody;                       // aim 클립 분리 가능하면 다리 이동 지원
  if (wantFull && !pc.aimFull) {
    pc.aimFull = true;
    for (const a of [pc.lowerAct, pc.upperAct, pc.upperAimAdd, pc.actAimUp, pc.actAimDown]) if (a) a.fadeOut(0.16);
    pc.lowerAct = null; pc.upperAct = null;
    if (useSplit) {
      pc.aimBody.reset().fadeIn(0.16).play();
      pc.aimLegs.reset().fadeIn(0.16).play();
      if (pc.walkLegsAim) { pc.walkLegsAim.reset().play(); pc.walkLegsAim.setEffectiveWeight(0); }
    } else pc.actAim.reset().fadeIn(0.16).play();
  } else if (!wantFull && pc.aimFull) {
    pc.aimFull = false;
    for (const a of [pc.actAim, pc.aimBody, pc.aimLegs, pc.walkLegsAim]) if (a) a.fadeOut(0.16);
  }
  if (pc.aimFull) {
    if (pc.upperAimAdd) pc.upperAimAdd.setEffectiveWeight(0);
    if (pc.actAimUp) pc.actAimUp.setEffectiveWeight(0);
    if (pc.actAimDown) pc.actAimDown.setEffectiveWeight(0);
    if (useSplit) {
      pc.aimBody.setEffectiveWeight(1);
      const mv = moving ? 1 : 0;                        // 다리: 정지=견착 스탠스 / 이동=걷기
      pc.aimLegs.setEffectiveWeight(1 - mv);
      if (pc.walkLegsAim) { pc.walkLegsAim.setEffectiveWeight(mv); if (moving) pc.walkLegsAim.timeScale = THREE.MathUtils.clamp(hSpeed / 1.0, 0.7, 1.8); }
    } else pc.actAim.setEffectiveWeight(1);
    pc.aimBlend += (1 - pc.aimBlend) * Math.min(1, dt * 6);
    pc.gunAim = (pc.gunAim || 0) + (1 - (pc.gunAim || 0)) * Math.min(1, dt * 14);
    const wf = pc.fireFaceT > 0 ? 1 : 0;
    pc.fireHold = (pc.fireHold || 0) + (wf - (pc.fireHold || 0)) * Math.min(1, dt * (wf ? 14 : 6));
    if (pc.spine && pc.spinePose) pc.spine.quaternion.copy(pc.spinePose);
    pc.mixer.update(dt);
    if (pc.spine) { if (!pc.spinePose) pc.spinePose = pc.spine.quaternion.clone(); else pc.spinePose.copy(pc.spine.quaternion); }
    pc.gunKick = Math.max(0, (pc.gunKick || 0) - dt * 3.2);
    updateGunHold();
    updateLeftHandIK(dt);
    return;
  }

  // ── 하체 레이어: 로코모션 (조준/사격/재장전 중에도 항상 다리 구동 → 조준 이동 시 다리 이동) ──
  const lowerDesired = !moving ? pc.actIdleLower : (jog ? pc.actRunLower : pc.actWalkLower);
  pc.lowerSwT = (lowerDesired === pc.lowerAct) ? 0 : pc.lowerSwT + dt;
  if (lowerDesired && lowerDesired !== pc.lowerAct && pc.lowerSwT > 0.1) {
    pc.lowerSwT = 0; if (pc.lowerAct) pc.lowerAct.fadeOut(0.15);
    lowerDesired.reset().fadeIn(0.15).play(); pc.lowerAct = lowerDesired;
  }
  if (moving && pc.lowerAct === pc.actWalkLower) pc.actWalkLower.timeScale = THREE.MathUtils.clamp(hSpeed / 1.0, 0.7, 1.7);
  else if (moving && pc.lowerAct === pc.actRunLower) pc.actRunLower.timeScale = THREE.MathUtils.clamp(hSpeed / 3.4, 0.9, 2.1);

  // ── 상체 레이어: 질주=팔 / 그 외=지향 대기(정면). 사격 구분은 몸 정렬+총열정렬+반동+피치로. 재장전 중엔 건너뜀 ──
  if (!pc.upperShot) {
    const upperDesired = sprintingNow ? pc.upperRun : pc.upperReady;
    if (upperDesired && upperDesired !== pc.upperAct) {
      if (pc.upperAct) pc.upperAct.fadeOut(0.16);
      upperDesired.reset().fadeIn(0.16).play();
      pc.upperAct = upperDesired;
    }
  }

  // 총열 정렬용 블렌드: 조준/사격 시 1(총열=조준점 정렬), 그 외 0(총은 몸 방향)
  const wantAim = player.aiming ? 1 : 0;
  pc.aimBlend += (wantAim - pc.aimBlend) * Math.min(1, dt * 6);
  const wantFire = pc.fireFaceT > 0 ? 1 : 0;
  pc.fireHold = (pc.fireHold || 0) + (wantFire - (pc.fireHold || 0)) * Math.min(1, dt * (wantFire ? 14 : 6));
  const wantGunAim = combat ? 1 : 0;
  pc.gunAim = (pc.gunAim || 0) + (wantGunAim - (pc.gunAim || 0)) * Math.min(1, dt * 14);
  // 어깨 견착 additive: 사격/조준(gunAim) 시 상체를 견착 자세로 (질주·재장전 제외) (#202)
  if (pc.upperAimAdd) {
    const shoulder = 0.85 * pc.gunAim * (pc.upperShot || sprintingNow ? 0 : 1);
    pc.upperAimAdd.setEffectiveWeight(shoulder);
  }
  // 상하 조준 additive (약하게) — 지향사격/조준 시에만
  const aimPitch = THREE.MathUtils.clamp(player.pitch, -0.6, 0.6);
  if (pc.actAimUp && pc.actAimDown) {
    const k = 0.35 * pc.gunAim * (pc.upperShot ? 0 : 1);
    pc.actAimUp.setEffectiveWeight(Math.max(0, aimPitch / 0.6) * k);
    pc.actAimDown.setEffectiveWeight(Math.max(0, -aimPitch / 0.6) * k);
  }
  // PropertyMixer 상수트랙 누적 방지 (#31 과 동일 패턴)
  if (pc.spine && pc.spinePose) pc.spine.quaternion.copy(pc.spinePose);
  pc.mixer.update(dt);
  if (pc.spine) { if (!pc.spinePose) pc.spinePose = pc.spine.quaternion.clone(); else pc.spinePose.copy(pc.spine.quaternion); }

  // 사격 반동 킥 감쇠 + 총을 두 손에 정렬 (반동은 updateGunHold 에서 적용) (#122/#131)
  pc.gunKick = Math.max(0, (pc.gunKick || 0) - dt * 3.2);
  updateGunHold();
  updateLeftHandIK(dt);
}

// 3인칭 오버숄더 카메라 — 궤도 + 벽 충돌 당김 (#116)
const _camRay = new THREE.Raycaster();
let camAimBlend = 0;
// 1인칭 카메라 — 눈 위치에서 yaw/pitch (#145)
function updateFPSCamera() {
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.5, 1.5);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, 0); // 반동 오프셋 (#207)
  camera.position.set(player.pos.x, player.pos.y + PLAYER.eye, player.pos.z);
}

function updateTPSCamera(dt) {
  player.pitch = THREE.MathUtils.clamp(player.pitch, CAM.pitchMin, CAM.pitchMax);
  camAimBlend += ((player.aiming ? 1 : 0) - camAimBlend) * Math.min(1, dt * 10);
  const dist = THREE.MathUtils.lerp(CAM.dist, CAM.distAim, camAimBlend);
  const shoulder = THREE.MathUtils.lerp(CAM.shoulder, CAM.shoulderAim, camAimBlend);

  // 카메라 방향은 FPS 와 동일(yaw/pitch) → 화면중앙=시선 유지. 반동 오프셋 포함 (#207)
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, 0);
  const camFwd = new THREE.Vector3();
  camera.getWorldDirection(camFwd);
  const camRight = new THREE.Vector3().crossVectors(camFwd, WORLD_UP).normalize();

  const pivot = new THREE.Vector3(player.pos.x, player.pos.y + CAM.pivotH, player.pos.z)
    .addScaledVector(camRight, shoulder);
  const back = camFwd.clone().negate();
  _camRay.set(pivot, back);
  _camRay.far = dist + 0.3;
  const hit = _camRay.intersectObjects(obstacleMeshes, false)[0];
  const d = hit ? Math.max(CAM.minDist, hit.distance - 0.25) : dist;
  camera.position.copy(pivot).addScaledVector(back, d);
  // 지면 관통 방지
  const camGround = terrainH(camera.position.x, camera.position.z) + 0.3;
  if (camera.position.y < camGround) camera.position.y = camGround;
}

// 뷰모델 (Quaternius 총기) — 무기별로 1회 구성, equipWeapon 으로 전환
const VIEWMODELS = {}; // key → { model, muzzle, adsPos, size }
let fpsMuzzleDevice = null; // 장착된 총구 부품의 FPS 메시 (#190)
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
      atts, scopeExtra, size: size.clone(),
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
  // 총구 장착물(부품) FPS 반영 (#190) — 이전 것 제거 후 장착 시 재생성
  if (fpsMuzzleDevice) { gunGroup.remove(fpsMuzzleDevice); fpsMuzzleDevice = null; }
  if (installedParts(key).muzzle && vm.size) { fpsMuzzleDevice = muzzleDeviceMesh(vm.size); gunGroup.add(fpsMuzzleDevice); }
  // 무기별 탄약 상태 저장/복원 (레이드 중 교체 시 유지)
  if (GUN && GUN.key !== key && weaponAmmo[GUN.key]) {
    weaponAmmo[GUN.key] = { mag: gun.mag, reserve: gun.reserve };
  }
  GUN = effectiveWeapon(key); // 부품 장착 반영 스탯 (#188)
  setPlayerGun(key); // 3인칭 손 무기 반영 (#116)
  const ammo = weaponAmmo[key];
  gun.mag = ammo ? ammo.mag : GUN.magSize;
  gun.reserve = ammo ? ammo.reserve : GUN.reserveMax;
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
gunGroup.visible = false; // 3인칭 전환 — FPS 뷰모델 숨김 (#116)
scene.add(camera);
const muzzleFlashLight = new THREE.PointLight(0xffc070, 0, 8, 2);
scene.add(muzzleFlashLight); // 3인칭: 캐릭터 총구 위치로 매 발사 이동

const GUN_HIP = new THREE.Vector3(0.27, -0.24, -0.58);
let scopeHold = 0;   // 스코프 ADS 유지 시간 (#104)
let scopeShown = false;
// ADS 위치는 무기별로 equipWeapon 에서 실측 갱신 (#36 정렬 방식)
const GUN_ADS = new THREE.Vector3(0, -0.126, -0.66);

function updateGun(dt) {
  gun.cooldown = Math.max(0, gun.cooldown - dt);

  // 유효 탄퍼짐 (탄도·크로스헤어 공통 소스) + 반동/블룸 회복 (#207)
  {
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const base = player.aiming ? GUN.spreadAds : GUN.spreadHip;
    const moveS = Math.min(1, hSpeed / 8) * GUN.spreadMove * (currentAtt.includes('grip') ? 0.5 : 1);
    gun.spread = base + moveS + gun.bloom * 0.02;
    gun.bloom = Math.max(0, gun.bloom - dt * 2.4); // 연사 멈추면 탄퍼짐 회복
    // 반동 시점 회복: 사격 중엔 느리게(누적/상승), 정지 시 빠르게 원위치
    const firing = gun.triggerDown && gun.mag > 0 && gun.reloading <= 0 && gun.raiseT <= 0;
    const rr = firing ? 5 : 11;
    player.recoilPitch -= player.recoilPitch * Math.min(1, dt * rr);
    player.recoilYaw -= player.recoilYaw * Math.min(1, dt * rr);
  }

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

  // 질주→사격 들어올리기 지연: 질주 중엔 계속 리셋, 질주 해제 후 raiseT 가 소진돼야 사격 (#180)
  gun.raiseT = player.sprinting ? 0.22 : Math.max(0, (gun.raiseT || 0) - dt);

  // 자동 사격
  if (gun.triggerDown && (GUN.auto || !gun.semiLatch) && state.phase === 'raid' && gun.reloading <= 0 && gun.cooldown <= 0 && gun.raiseT <= 0) {
    if (gun.mag > 0) fireShot();
    else { sfx.dryFire(); gun.cooldown = 0.25; startReload(); }
  }

  // 스코프 조준 화면 (#104): 스코프 무기·저격총 ADS 시 오버레이(줌 조준) 표시
  // — 3인칭에서는 캐릭터를 숨겨 시야 확보 (updatePlayerChar 가 scopeShown 반영)
  const scopeCapable = currentAtt.includes('scope') || GUN.key === 'sniper';
  scopeHold = player.aiming && scopeCapable && state.phase === 'raid' ? scopeHold + dt : 0;
  const scopedNow = scopeHold > 0.12;
  if (scopedNow !== scopeShown) {
    scopeShown = scopedNow;
    dom.scopeOverlay.style.display = scopedNow ? 'block' : 'none';
  }

  // 반동 회복
  gun.recoil = Math.max(0, gun.recoil - dt * 3);

  // FPS 뷰모델 (#145): 1인칭일 때만 표시·위치. 3인칭은 캐릭터가 총을 듦.
  if (viewMode === 'fps') {
    gunGroup.visible = !scopeShown && state.phase === 'raid';
    const target = player.aiming ? GUN_ADS : GUN_HIP;
    gunGroup.position.lerp(target, Math.min(1, dt * 14));
    gunGroup.position.z += gun.recoil * 0.05;
    gunGroup.rotation.set(gun.recoil * 0.08, 0, 0);
  } else {
    gunGroup.visible = false;
  }

  muzzleFlashLight.intensity *= Math.pow(0.001, dt * 6);
  if (muzzleFlashLight.intensity < 0.5) muzzleFlashLight.intensity = 0;
}

function toggleViewMode() {
  viewMode = viewMode === 'tps' ? 'fps' : 'tps';
  try { localStorage.setItem('exshoot_view', viewMode); } catch {}
  addFeed(viewMode === 'fps' ? '1인칭 시점' : '3인칭 시점');
}

function startReload() {
  if (gun.reloading > 0 || gun.mag >= GUN.magSize || gun.reserve <= 0) return;
  gun.reloading = GUN.reloadTime;
  sfx.reload1();
  playPcReload(0.1); // 3인칭 재장전 모션 (상체 전용 + 하체 idle)
}

const _shootRay = new THREE.Raycaster();
const _aimRay = new THREE.Raycaster();
function fireShot() {
  gun.mag--;
  gun.cooldown = GUN.fireInterval;
  const gripK = currentAtt.includes('grip') ? 0.6 : 1;
  gun.recoil = Math.min(1.6, gun.recoil + GUN.recoil * gripK);
  gun.semiLatch = true; // 단발 무기는 클릭당 1발
  // 반동 (#207): 시점이 위로 튀고(수직) 좌우로 랜덤(수평). 연사로 bloom 쌓일수록 강해짐.
  //  player.pitch 를 직접 안 건드리고 recoilPitch 오프셋에 누적 → 사격 정지 시 회복(아래 updateGun).
  const rk = 1 + gun.bloom * 0.7;
  player.recoilPitch = Math.min(0.6, player.recoilPitch + GUN.kick * gripK * 3.0 * rk);
  player.recoilYaw += (Math.random() - 0.5) * GUN.recoil * 0.018 * gripK;
  gun.bloom = Math.min(1.5, gun.bloom + (0.13 + GUN.recoil * 0.07) * gripK); // 연사 탄퍼짐 누적
  sfx.shoot();
  if (pc) { pc.gunKick = Math.min(0.5, (pc.gunKick || 0) + 0.2); pc.fireFaceT = 0.4; } // 총 반동 킥 + 사격 중 몸 정렬 (#122)
  muzzleFlashLight.intensity = currentAtt.includes('silencer') ? 10 : 40;
  // 총구: FPS 는 뷰모델 총구, TPS 는 캐릭터 총구 (#145)
  const muzzle = (viewMode === 'fps' && gunGroup.visible) ? gunGroup.localToWorld(muzzleLocal.clone()) : pcMuzzle();
  muzzleFlashLight.position.copy(muzzle);
  alertEnemiesAround(player.pos, currentAtt.includes('silencer') ? 16 : 60);

  const targets = [...obstacleMeshes, ...propMeshes];
  for (const e of enemies) if (!e.dead) targets.push(e.body, e.head);

  // 조준점: TPS 는 총열이 매 프레임 맞춰둔 수렴점(pc.aimWorld)을 그대로 사용 → 트레이서가 총열선과 일치 (#180).
  // 그 외(FPS·초기 프레임)에는 화면중앙 레이로 수렴점 산출.
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  let aimPoint;
  if (viewMode === 'tps' && pc && pc.aimWorld) {
    aimPoint = pc.aimWorld.clone();
  } else {
    _aimRay.set(camera.position, camDir);
    _aimRay.far = GUN.range;
    const aimHits = _aimRay.intersectObjects(targets, false);
    aimPoint = aimHits.length ? aimHits[0].point.clone()
      : camera.position.clone().addScaledVector(camDir, GUN.range);
  }

  // 트레이서 시작점: 총구의 좌우(수평) 오프셋만 제거해 조준선 수직면에 투영 (#184).
  // 총이 오른손(화면 중앙에서 벗어남)에 있어 탄이 옆(좌측)에서 날아오는 것처럼 보이던 문제 →
  // 좌우만 조준선에 맞추고 상하(총구가 눈보다 낮음 = 아래서 위로 상승)는 유지(실총과 유사).
  const _camRight = new THREE.Vector3().crossVectors(camDir, WORLD_UP).normalize();
  const tracerStart = muzzle.clone().addScaledVector(_camRight, -muzzle.clone().sub(camera.position).dot(_camRight));

  // 탄퍼짐: updateGun 에서 매 프레임 계산한 유효 탄퍼짐(기본+이동+bloom) = 크로스헤어와 동일 소스 (#207)
  const spread = gun.spread || (player.aiming ? GUN.spreadAds : GUN.spreadHip);

  let anyHit = false;
  for (let p = 0; p < GUN.pellets; p++) {
    const dir = aimPoint.clone().sub(muzzle).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    _shootRay.set(muzzle, dir);
    _shootRay.far = GUN.range;
    const hits = _shootRay.intersectObjects(targets, false);
    let endPoint = muzzle.clone().add(dir.clone().multiplyScalar(GUN.range));
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
      } else if (ud && ud.physProp && !ud.physProp.exploded) {
        // 물리 배럴 피격 — 폭발통은 폭발, 일반통은 임펄스로 튐 (#119)
        const p = ud.physProp;
        if (p.explosive) {
          p.exploded = true; blackenProp(p); removeMovementCollider(p);
          explodeAt(propWorldPos(p).clone());
        } else {
          const m = p.body.mass();
          p.body.applyImpulse({ x: dir.x * 5 * m, y: 1.5 * m, z: dir.z * 5 * m }, true);
          p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * m, z: (Math.random() - 0.5) * m }, true);
        }
      } else if (h.face) {
        // 환경(벽·바닥·정적 소품) 명중 → 탄흔 데칼 (#208)
        _decalN.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize();
        spawnDecal(h.point, _decalN);
      }
    }
    // 트레이서는 스코프 무기(스코프 부착·저격총)에서만 — 일반 사격은 총구 시작점이 반동·총열정렬로
    // 흔들려 궤적이 지저분해서 제외. 스코프는 정조준 상태라 안정적 (#183)
    if (currentAtt.includes('scope') || GUN.key === 'sniper') spawnTracer(tracerStart, endPoint, 0xffe0a0);
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

// 탄흔 데칼 (#208): 벽·바닥 명중 시 총알구멍. 링버퍼 최대 DECAL_MAX 개(오래된 것부터 재활용)
//  → 유저가 탄 튀는(반동·탄퍼짐) 패턴을 눈으로 인식.
let decals = [];
const DECAL_MAX = 100;
let _decalGeo = null, _decalMat = null;
const _decalUp = new THREE.Vector3(0, 0, 1), _decalN = new THREE.Vector3();
function bulletHoleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  let rad = g.createRadialGradient(32, 32, 2, 32, 32, 30); // 바깥 먼지 링
  rad.addColorStop(0, 'rgba(8,6,5,0.95)');
  rad.addColorStop(0.42, 'rgba(22,18,14,0.7)');
  rad.addColorStop(0.72, 'rgba(70,64,58,0.22)');
  rad.addColorStop(1, 'rgba(90,84,78,0)');
  g.fillStyle = rad; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.95)'; g.beginPath(); g.arc(32, 32, 6.5, 0, Math.PI * 2); g.fill(); // 중앙 구멍
  g.strokeStyle = 'rgba(12,10,8,0.55)'; g.lineWidth = 1.1; // 방사형 균열
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + Math.random(), r = 9 + Math.random() * 16; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}
function spawnDecal(point, normal) {
  if (!_decalGeo) {
    _decalGeo = new THREE.PlaneGeometry(1, 1);
    _decalMat = new THREE.MeshBasicMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  }
  const m = new THREE.Mesh(_decalGeo, _decalMat);
  const s = 0.07 + Math.random() * 0.05;
  m.scale.set(s, s, s);
  m.quaternion.setFromUnitVectors(_decalUp, normal); // 면 법선에 정렬
  m.rotateZ(Math.random() * Math.PI * 2);            // 회전 다양성
  m.position.copy(point).addScaledVector(normal, 0.012); // z-fighting 방지 살짝 띄움
  m.renderOrder = 3; m.frustumCulled = false;
  scene.add(m);
  decals.push(m);
  if (decals.length > DECAL_MAX) scene.remove(decals.shift());
}

// ============================================================
// 물리 (Rapier) — 정적 콜라이더 / 동적 소품 / 폭발 / 래그돌 (#119)
// ============================================================
function quatY(yaw) { return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }; }

// 맵 확정 후 1회 — 지형 하이트필드 + 건물 OBB 를 Rapier 정적 콜라이더로 미러
function buildPhysicsStatics() {
  if (!physReady || physWorld) return;
  physWorld = new RAPIER.World({ x: 0, y: -18, z: 0 });
  physWorld.timestep = 1 / 60;
  const N = 48, span = WORLD_HALF * 2;
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      // Rapier heightfield: 행(i)=z, 열(j)=x 로 매핑됨 (실측으로 확정)
      const x = (j / N - 0.5) * span, z = (i / N - 0.5) * span;
      heights[i + j * (N + 1)] = terrainH(x, z);
    }
  }
  const gb = physWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physWorld.createCollider(RAPIER.ColliderDesc.heightfield(N, N, heights, { x: span, y: 1, z: span }).setFriction(0.9), gb);
  for (const b of colliders) {
    if (b.maxY - b.minY < 0.4) continue;
    const yaw = Math.atan2(b.s, b.c);
    const rb = physWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(b.cx, (b.minY + b.maxY) / 2, b.cz).setRotation(quatY(yaw)));
    physWorld.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, (b.maxY - b.minY) / 2, b.hz), rb);
  }
}

// 레이드마다 동적 물리 배럴 배치 (일부는 폭발통)
let PHYS_BARRELS = [
  [5, -25, true], [7, -25.8, false], [-42, 10, true], [30, -50, false],
  [-25, 35, false], [62, -45, true], [18, 20, false], [-65, 55, false],
  [-6, -35.8, true], [-63.8, 8.5, false], [33, 34, true], [-30, -20, false],
];
function spawnPhysProps() {
  if (!physReady || !physWorld) return;
  for (const [x, z, expl] of PHYS_BARRELS) spawnPhysBarrel(x, z, expl);
}

function spawnPhysBarrel(x, z, explosive) {
  const mesh = instantiate('barrel');
  let bb = new THREE.Box3().setFromObject(mesh);
  const targetH = 1.15;
  mesh.scale.setScalar(targetH / Math.max(0.001, bb.max.y - bb.min.y));
  mesh.updateMatrixWorld(true);
  bb = new THREE.Box3().setFromObject(mesh);
  const ctr = bb.getCenter(new THREE.Vector3());
  mesh.position.sub(ctr); // 지오메트릭 중심을 원점으로 (물리 바디 중심과 일치)
  const halfH = (bb.max.y - bb.min.y) / 2;
  const rad = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2 * 0.92;
  mesh.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false;
      if (explosive) { o.material = o.material.clone(); o.material.color.setHex(0x9a3324); if (o.material.emissive) o.material.emissive.setHex(0x160400); }
    }
  });
  const holder = new THREE.Group();
  holder.add(mesh);
  const gy = terrainH(x, z) + halfH + 0.02;
  holder.position.set(x, gy, z);
  scene.add(holder);

  const body = physWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, gy, z).setLinearDamping(0.35).setAngularDamping(0.55));
  physWorld.createCollider(RAPIER.ColliderDesc.cylinder(halfH, rad)
    .setDensity(explosive ? 1.4 : 2.6).setFriction(0.85).setRestitution(0.18), body);

  const mCol = axisCollider(x - rad, x + rad, terrainH(x, z), terrainH(x, z) + targetH, z - rad, z + rad);
  colliders.push(mCol);
  const prop = { body, holder, mesh, halfH, rad, explosive, exploded: false, mCol };
  holder.userData.physProp = prop;
  mesh.traverse((o) => { if (o.isMesh) { o.userData.physProp = prop; propMeshes.push(o); } });
  physProps.push(prop);
}

function removeMovementCollider(p) {
  if (!p.mCol) return;
  const i = colliders.indexOf(p.mCol); if (i >= 0) colliders.splice(i, 1);
  p.mCol = null;
}
function blackenProp(p) {
  p.mesh.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.25); if (o.material.emissive) o.material.emissive.setHex(0); } });
}

const _v3 = new THREE.Vector3();
function propWorldPos(p) { const t = p.body.translation(); return _v3.set(t.x, t.y, t.z); }

// 폭발: VFX + 범위 데미지(적/플레이어) + 동적 바디 임펄스 + 폭발통 연쇄
function explodeAt(pos, { radius = 6.5, damage = 95, force = 30 } = {}) {
  spawnExplosionFX(pos);
  playBuf('deathBoom', { vol: 0.85, rate: 0.9 + Math.random() * 0.2 });
  alertEnemiesAround(pos, 45);
  for (const p of physProps) {
    const t = p.body.translation();
    const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
    if (d >= radius) continue;
    const k = (1 - d / radius) * force, m = p.body.mass();
    const dir = new THREE.Vector3(t.x - pos.x, (t.y - pos.y) + 0.5, t.z - pos.z);
    if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 1, Math.random() - 0.5);
    dir.normalize();
    p.body.applyImpulse({ x: dir.x * k * m, y: (dir.y * k + 3) * m, z: dir.z * k * m }, true);
    p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * k * m * 0.4, y: (Math.random() - 0.5) * k * m * 0.4, z: (Math.random() - 0.5) * k * m * 0.4 }, true);
    if (p.explosive && !p.exploded && d < radius * 0.85) {
      p.exploded = true; blackenProp(p); removeMovementCollider(p);
      pendingExplosions.push({ pos: new THREE.Vector3(t.x, t.y, t.z), opts: { radius, damage, force } });
    }
  }
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.pos.distanceTo(pos);
    if (d < radius) {
      e.hp -= damage * (1 - d / radius);
      if (e.hp <= 0) { killEnemy(e); launchRagdoll(e, pos, force); }
      else e.state = 'combat';
    }
  }
  const pd = player.pos.distanceTo(pos);
  if (pd < radius && state.phase === 'raid') damagePlayer(damage * (1 - pd / radius) * 0.85);
}

// 폭발로 사살된 적 → 물리 바디로 날려버림 (스티프 래그돌)
function launchRagdoll(e, blastPos, force) {
  if (!physWorld || e.ragdollBody) return;
  e.mixer.timeScale = 0; // 현재 포즈 고정
  const cx = e.pos.x, cy = e.pos.y + 0.95, cz = e.pos.z;
  const body = physWorld.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(cx, cy, cz).setLinearDamping(0.2).setAngularDamping(0.35));
  physWorld.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.32).setDensity(1.0).setFriction(0.7).setRestitution(0.25), body);
  const dir = new THREE.Vector3(e.pos.x - blastPos.x, 0, e.pos.z - blastPos.z);
  if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  dir.normalize();
  const m = body.mass(), k = force * 0.9;
  body.applyImpulse({ x: dir.x * k * m, y: (7 + Math.random() * 3) * m, z: dir.z * k * m }, true);
  body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 3 * m, y: (Math.random() - 0.5) * 2 * m, z: (Math.random() - 0.5) * 3 * m }, true);
  e.ragdollBody = body;
  ragdolls.push({ e, body, offset: new THREE.Vector3(0, -0.95, 0) });
}

// 폭발 VFX 풀 (#132): 조명/구체를 미리 생성해 재사용 — 폭발마다 조명을 add/remove 하면
// three.js 가 씬 전체 셰이더를 재컴파일해 프레임이 끊기던 문제 해결.
const explosionPool = [];
function initExplosionPool() {
  for (let i = 0; i < 3; i++) {
    // 조명·구체 모두 항상 visible=true 로 씬에 상주 — three.js 는 visible 한 조명만 세어
    // 셰이더를 컴파일하므로, 처음부터 켜두어(밝기 0) 첫 폭발에서 조명 개수가 안 바뀌게 함(#136).
    const light = new THREE.PointLight(0xffb04a, 0, 20, 2);
    scene.add(light);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
    sphere.scale.setScalar(0.0001); // 사실상 안 보이지만 렌더돼 재질이 사전 컴파일됨
    sphere.renderOrder = 2;
    scene.add(sphere);
    explosionPool.push({ light, sphere, life: 0, max: 0.5, active: false });
  }
}
function spawnExplosionFX(pos) {
  let fx = explosionPool.find((f) => !f.active) || explosionPool[0];
  if (!fx) return;
  fx.active = true; fx.life = fx.max;
  fx.light.position.copy(pos).setY(pos.y + 0.8);
  fx.light.intensity = 400; // visible 토글 없음 — 밝기만 (재컴파일 방지)
  fx.sphere.position.copy(pos).setY(pos.y + 0.7);
  fx.sphere.scale.setScalar(1);
  fx.sphere.material.opacity = 0.9;
}

// 물리 스텝 + 소품/래그돌 동기화 + 연쇄 폭발 처리
function updatePhysics(dt) {
  if (!physWorld) return;
  const queue = pendingExplosions; pendingExplosions = [];
  for (const q of queue) explodeAt(q.pos, q.opts);
  physWorld.step();
  for (const p of physProps) {
    const t = p.body.translation(), r = p.body.rotation();
    p.holder.position.set(t.x, t.y, t.z);
    p.holder.quaternion.set(r.x, r.y, r.z, r.w);
    // 정지한 배럴은 이동 콜라이더 위치 갱신 불필요(정지 가정) — 성능
  }
  for (const rd of ragdolls) {
    const t = rd.body.translation(), r = rd.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const off = rd.offset.clone().applyQuaternion(q);
    rd.e.group.position.set(t.x + off.x, t.y + off.y, t.z + off.z);
    rd.e.group.quaternion.copy(q);
  }
}

function clearPhysics() {
  for (const p of physProps) { scene.remove(p.holder); removeMovementCollider(p); if (physWorld) physWorld.removeRigidBody(p.body); }
  physProps.length = 0;
  for (const rd of ragdolls) { if (physWorld) physWorld.removeRigidBody(rd.body); }
  ragdolls.length = 0;
  for (const fx of explosionPool) { fx.active = false; fx.light.intensity = 0; fx.sphere.scale.setScalar(0.0001); fx.sphere.material.opacity = 0; }
  propMeshes.length = 0;
  pendingExplosions = [];
}

function updateEffects(dt) {
  // 폭발 VFX 감쇠 (풀 재사용 — add/remove 없음, #132)
  for (const fx of explosionPool) {
    if (!fx.active) continue;
    fx.life -= dt;
    const k = Math.max(0, fx.life / fx.max);
    fx.light.intensity = 400 * k * k;
    fx.sphere.scale.setScalar(1 + (1 - k) * 5);
    fx.sphere.material.opacity = k * 0.9;
    if (fx.life <= 0) { fx.active = false; fx.light.intensity = 0; fx.sphere.scale.setScalar(0.0001); fx.sphere.material.opacity = 0; } // visible 토글 금지 (#136)
  }
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
    if (it.opened || it.landing) continue; // 낙하 중인 보급은 착지 후 개봉 가능 (#197)
    const d = it.pos.distanceTo(player.pos);
    if (d > bestD) continue;
    const dir = it.pos.clone().sub(playerEyePos()).normalize();
    if (fwd.dot(dir) < 0.25 && d > 1.2) continue;
    best = it; bestD = d;
  }
  return best;
}

function lootInteractable(it) {
  // 잠긴 금고: 반입한 열쇠가 있어야 개방 (#195)
  if (it.locked && !broughtKeys.has(it.lockKey)) {
    const kn = KEY_BY_ID[it.lockKey] ? KEY_BY_ID[it.lockKey].name : '열쇠';
    addFeed(`잠김 — ${kn} 필요`);
    sfx.dryFire();
    return;
  }
  it.opened = true;
  if (it.locked) addFeed('금고 개방!');
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
      inventory.push({ name: item.name, value: item.value, heal: item.heal, type: item.type, slot: item.slot, keyId: item.keyId });
      addFeed(item.type === 'part' ? `${item.name} 획득 (총기 부품)`
        : item.type === 'key' ? `${item.name} 획득 (열쇠)`
        : `${item.name} 획득 (₽${item.value.toLocaleString('ko-KR')})`);
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

// 미니맵 (#196) — 북(-z) 위 기준 탑다운. 핫존·상자·잠긴금고·탈출구·플레이어 표시.
const _mmFwd = new THREE.Vector3();
function updateMinimap() {
  const cv = dom.minimap; if (!cv) return;
  const ctx = cv.getContext('2d');
  const S = cv.width, R = WORLD_HALF;
  const cx = (wx) => (wx / R * 0.5 + 0.5) * S;         // world x → canvas x
  const cy = (wz) => (wz / R * 0.5 + 0.5) * S;         // world z → canvas y (+z 아래, -z=북 위)
  ctx.clearRect(0, 0, S, S);
  // 핫존
  const hr = 32 / R * 0.5 * S;
  ctx.fillStyle = 'rgba(255,180,60,0.13)';
  ctx.beginPath(); ctx.arc(cx(HOT_CENTER.x), cy(HOT_CENTER.y), hr, 0, 7); ctx.fill();
  // 미개봉 보급 상자(연한 점) + 잠긴 금고(붉은) + 탈출구
  for (const it of interactables) {
    if (it.opened) continue;
    if (it.airdrop) { ctx.fillStyle = '#5ac8ff'; ctx.beginPath(); ctx.arc(cx(it.pos.x), cy(it.pos.z), 4, 0, 7); ctx.fill(); } // 에어드랍 (#197)
    else if (it.locked) { ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(cx(it.pos.x), cy(it.pos.z), 3, 0, 7); ctx.fill(); }
    else { ctx.fillStyle = 'rgba(150,200,120,0.55)'; ctx.fillRect(cx(it.pos.x) - 1, cy(it.pos.z) - 1, 2, 2); }
  }
  for (const ex of extractions) {
    ctx.fillStyle = ex.fee ? '#ffcf5a' : '#51ff7a';
    ctx.beginPath(); ctx.arc(cx(ex.pos.x), cy(ex.pos.z), 3.4, 0, 7); ctx.fill();
  }
  // 플레이어(시선 방향 화살표)
  camera.getWorldDirection(_mmFwd);
  const px = cx(player.pos.x), py = cy(player.pos.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(_mmFwd.x, -_mmFwd.z));
  ctx.fillStyle = '#eef2ea'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ============================================================
// 레이드 라이프사이클
// ============================================================
let SPAWN_POINTS = [
  new THREE.Vector3(0, 0, 82), new THREE.Vector3(0, 0, -82),
  new THREE.Vector3(82, 0, 0), new THREE.Vector3(-82, 0, 0),
];

// ── 숲 속 고등학교 맵 (#165) ──────────────────────────────
// 오픈월드풍 나무 (Quaternius 개별 GLB) — 침엽(소나무)·활엽(단풍/일반/자작) 혼합 + 고사목 소량
let FOREST_TREES = [...TREE_KEYS.pine, ...TREE_KEYS.pine, ...TREE_KEYS.maple, ...TREE_KEYS.maple, ...TREE_KEYS.normal, ...TREE_KEYS.birch, ...TREE_KEYS.dead];

// 절차적 고등학교 건물(#178 대형화) — 1층 진입 가능(중앙 현관+복도+교실 7칸),
// 2~4층 유리창 파사드 매스, 층 밴드·현관 캐노피·옥상 구조물로 "학교"다운 스케일.
function buildSchoolBuilding(cx, cz) {
  const L = 68, Dp = 15, FH = 3.6, t = 0.35, FLOORS = 4; // 길이(X)/깊이(Z)/층고/층수
  const halfL = L / 2, halfD = Dp / 2;
  const wall = 'plaster';                        // 외벽: 밝은 도색(크림)
  const zF = cz + halfD, zB = cz - halfD;        // 남(정면 +Z)/북(후면)
  const entW = 6.5;                              // 중앙 현관 폭

  // 창 개구부를 일정 간격(bay)으로 생성 — 세그먼트 길이/중심 기준
  const evenWins = (len, spacing, w) => {
    const n = Math.max(0, Math.floor((len - 2.5) / spacing));
    const span = n * spacing, out = [];
    for (let i = 0; i <= n; i++) out.push({ at: -span / 2 + i * spacing, w });
    return out;
  };
  // 유리 + 세로 mullion 을 개구부에 채운다(창이 뚫린 구멍이 아니라 창처럼 보이게)
  const glaze = (wx, wz, axis, openings, baseY) => {
    const gy = baseY + 1.5, gh = 1.0; // addWindowWall 개구부(sill 1.0~lintel 2.0) 대응
    for (const o of openings) {
      if (axis === 'x') {
        addBox(wx + o.at, gy, wz, o.w, gh, 0.06, MAT.glass, { collide: false, block: false, shadow: false });
        addBox(wx + o.at, gy, wz, 0.07, gh, 0.13, MAT.woodDark, { collide: false, block: false, shadow: false });
      } else {
        addBox(wx, gy, wz + o.at, 0.06, gh, o.w, MAT.glass, { collide: false, block: false, shadow: false });
      }
    }
  };
  const bay = 4.4;

  // 기초 플린스 + 실내 바닥
  addBox(cx, 0.3, cz, L + 1.4, 0.8, Dp + 1.4, 'concrete');
  addBox(cx, 0.62, cz, L - 0.4, 0.05, Dp - 0.4, 'woodfloor', { collide: false, block: false, shadow: false });
  // 1층 base 밴드(살짝 짙은 톤 — 학교 특유의 하부 마감)
  addBox(cx, 0.95, zF, L + 0.5, 1.3, 0.12, MAT.schoolBase, { collide: false, block: false });
  addBox(cx, 0.95, zB, L + 0.5, 1.3, 0.12, MAT.schoolBase, { collide: false, block: false });

  const winsSideL = evenWins(halfL - entW / 2, bay, 2.6);
  const centerL = cx - (entW / 2 + (halfL - entW / 2) / 2);
  const centerR = cx + (entW / 2 + (halfL - entW / 2) / 2);
  const winsFull = evenWins(L, bay, 2.6);

  // ── 1층 (진입 가능) ──
  // 정면: 좌우 창벽 + 중앙 현관 개구부
  addWindowWall(centerL, zF, halfL - entW / 2, FH, 'x', wall, winsSideL); glaze(centerL, zF, 'x', winsSideL, 0);
  addWindowWall(centerR, zF, halfL - entW / 2, FH, 'x', wall, winsSideL); glaze(centerR, zF, 'x', winsSideL, 0);
  addBox(cx, FH - 0.35, zF, entW + 0.6, 0.7, t, wall);   // 현관 상인방
  // 현관 캐노피 + 기둥 + 계단
  addBox(cx, FH + 0.05, zF + 1.6, entW + 2.4, 0.3, 3.4, 'concrete', { collide: false }); // 캐노피
  for (const sx of [-1, 1]) addBox(cx + sx * (entW / 2 + 0.6), FH / 2, zF + 3.0, 0.4, FH, 0.4, 'concrete'); // 기둥
  for (let s = 0; s < 3; s++) addBox(cx, 0.1 + s * 0.0, zF + 1.0 + s * 0.6, entW + 1.6 - s * 0.6, 0.2 + s * 0.2, 1.4 - s * 0.4, 'concrete', { block: false }); // 계단
  // 후면: 창 밴드
  addWindowWall(cx, zB, L, FH, 'x', wall, winsFull); glaze(cx, zB, 'x', winsFull, 0);
  // 양 끝벽(동/서): 비상문
  addWallWithDoor(cx - halfL, cz, Dp, FH, 'z', wall, halfD - 2.2, 1.4);
  addWallWithDoor(cx + halfL, cz, Dp, FH, 'z', wall, -(halfD - 2.2), 1.4);

  // 내부: 복도(정면쪽 3.2m) + 교실 7칸 칸막이·교실문
  const corrZ = cz + halfD - 3.2;
  const roomCount = 7, roomW = L / roomCount;
  for (let r = 0; r < roomCount; r++) {
    const rx = cx - halfL + roomW * (r + 0.5);
    addWallWithDoor(rx, corrZ, roomW, FH, 'x', wall, roomW * 0.3, 1.3);
    if (r > 0) addWall(cx - halfL + roomW * r, (cz - halfD + corrZ) / 2, corrZ - (cz - halfD), FH, 'z', wall);
  }
  addBox(cx, FH + 0.12, cz, L + 0.6, 0.24, Dp + 0.6, 'concrete', { collide: false }); // 1층 천장

  // ── 2~4층: 유리창 파사드(진입 불가 매스) + 층 밴드 ──
  for (let f = 1; f < FLOORS; f++) {
    const by = FH * f;
    addWindowWall(cx, zF, L, FH, 'x', wall, winsFull, by); glaze(cx, zF, 'x', winsFull, by);
    addWindowWall(cx, zB, L, FH, 'x', wall, winsFull, by); glaze(cx, zB, 'x', winsFull, by);
    addBox(cx - halfL, by + FH / 2, cz, t, FH, Dp, wall, { collide: false });
    addBox(cx + halfL, by + FH / 2, cz, t, FH, Dp, wall, { collide: false });
    addBox(cx, by + FH + 0.12, cz, L + 0.6, 0.24, Dp + 0.6, 'concrete', { collide: false });
  }
  // 층 구분 밴드(정면·후면 수평선 — 학교다운 수평 분절)
  for (let f = 1; f < FLOORS; f++) {
    addBox(cx, FH * f, zF, L + 0.4, 0.25, 0.18, MAT.schoolBase, { collide: false, block: false });
    addBox(cx, FH * f, zB, L + 0.4, 0.25, 0.18, MAT.schoolBase, { collide: false, block: false });
  }

  // ── 옥상: 파라펫 + 계단탑(penthouse) + 물탱크 ──
  const roofY = FH * FLOORS;
  for (const [ox, oz, w, d] of [[0, halfD, L + 0.6, 0.35], [0, -halfD, L + 0.6, 0.35], [-halfL, 0, 0.35, Dp + 0.6], [halfL, 0, 0.35, Dp + 0.6]]) {
    addBox(cx + ox, roofY + 0.6, cz + oz, w, 1.2, d, 'concrete', { collide: false });
  }
  addBox(cx - halfL + 8, roofY + 1.7, cz, 6, 3.4, 6, wall, { collide: false });        // 계단탑
  addBox(cx + halfL - 10, roofY + 2.3, cz - 1, 3.2, 4.6, 3.2, MAT.metalBlue, { collide: false }); // 물탱크(사각)
}

// 숲 배치: 격자+지터, 건물/운동장 플래튼·경계 회피.
// 일부는 대형 엄폐목(굵은 활엽수 줄기) — 플레이어가 서서 은엄폐로 쓸 수 있게. #172
function scatterForest(cx0, cz0, cx1, cz1) {
  const step = 6.5;
  const coverKinds = [...TREE_KEYS.normal, ...TREE_KEYS.maple]; // 활엽수 = 상대적으로 굵은 줄기
  for (let x = cx0; x <= cx1; x += step) {
    for (let z = cz0; z <= cz1; z += step) {
      const jx = x + (Math.random() - 0.5) * step * 0.8;
      const jz = z + (Math.random() - 0.5) * step * 0.8;
      if (Math.abs(jx) > WORLD_HALF - 4 || Math.abs(jz) > WORLD_HALF - 4) continue;
      if (terrainH(jx, jz) === 0 && insideAnyFlatten(jx, jz)) continue; // 플래튼(운동장/건물) 내부는 비움
      if (Math.random() < 0.28) continue; // 성김
      if (Math.random() < 0.16) {
        // 대형 엄폐목: 큰 키 + 굵은 줄기 콜라이더(서서 뒤에 숨음)
        const kind = coverKinds[Math.floor(Math.random() * coverKinds.length)];
        placeTree(kind, jx, jz, 13 + Math.random() * 4, 0.62); // 13~17m, 줄기반경 0.62m
      } else {
        const kind = FOREST_TREES[Math.floor(Math.random() * FOREST_TREES.length)];
        placeTree(kind, jx, jz, 6.5 + Math.random() * 4.5); // 6.5~11m, 얇은 줄기
      }
    }
  }
}
function insideAnyFlatten(x, z) {
  for (const f of FLATTENS) {
    if (f.r !== undefined) { if (Math.hypot(x - f.x, z - f.z) < f.r + 3) return true; }
    else if (Math.abs(x - f.x) < f.hw + 3 && Math.abs(z - f.z) < f.hd + 3) return true;
  }
  return false;
}

// 지면 클러터 산포(#177) — 수풀·풀·꽃·작은 바위. 비충돌·비차폐(통과 가능 장식)로 숲 바닥을 채운다.
// 건물 안만 비우고 운동장·숲·공터엔 잡초를 깔아 황량함을 줄인다.
function scatterGroundClutter(cx0, cz0, cx1, cz1) {
  const grass = CLUTTER_KEYS.grass, bush = CLUTTER_KEYS.bush, flower = CLUTTER_KEYS.flower, rock = TREE_KEYS.rock;
  const insideBuilding = (x, z) => Math.abs(x) < 35 && Math.abs(z) < 9;
  const step = 6;
  for (let x = cx0; x <= cx1; x += step) {
    for (let z = cz0; z <= cz1; z += step) {
      const jx = x + (Math.random() - 0.5) * step;
      const jz = z + (Math.random() - 0.5) * step;
      if (Math.abs(jx) > WORLD_HALF - 4 || Math.abs(jz) > WORLD_HALF - 4) continue;
      if (insideBuilding(jx, jz)) continue;         // 교사 실내는 비움
      if (Math.random() < 0.5) continue;            // 성김(성능)
      const r = Math.random();
      const opt = { collide: false, block: false, rotY: Math.random() * Math.PI * 2 };
      if (r < 0.5) placeModel(grass[(Math.random() * grass.length) | 0], jx, jz, { ...opt, width: 0.8 + Math.random() * 1.0 });
      else if (r < 0.72) placeModel(bush[(Math.random() * bush.length) | 0], jx, jz, { ...opt, height: 0.7 + Math.random() * 0.7 });
      else if (r < 0.9) placeModel(flower[(Math.random() * flower.length) | 0], jx, jz, { ...opt, height: 0.3 + Math.random() * 0.35 });
      else placeModel(rock[(Math.random() * rock.length) | 0], jx, jz, { ...opt, height: 0.35 + Math.random() * 0.6 });
    }
  }
}

// 하이트필드 변위 지면 타일 (산업/학교 공용) — tint 로 색조
function buildGroundTiles(tint) {
  let groundMat;
  if (GROUND_TEX.ground) { const t = GROUND_TEX.ground.clone(); t.needsUpdate = true; t.repeat.set(26, 26); groundMat = new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 1.0 }); }
  else groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), color: tint, roughness: 1.0 });
  const full = WORLD_HALF * 2 + 24, TILES = 6, tw = full / TILES;
  for (let ti = 0; ti < TILES; ti++) {
    for (let tj = 0; tj < TILES; tj++) {
      const cx = -full / 2 + tw * (ti + 0.5), cz = -full / 2 + tw * (tj + 0.5);
      const geo = new THREE.PlaneGeometry(tw, tw, 14, 14);
      geo.rotateX(-Math.PI / 2);
      const p = geo.attributes.position, n = geo.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const wx = cx + p.getX(i), wz = cz + p.getZ(i);
        p.setY(i, terrainH(wx, wz));
        const e = 0.8;
        const nx = terrainH(wx - e, wz) - terrainH(wx + e, wz);
        const nz = terrainH(wx, wz - e) - terrainH(wx, wz + e);
        const inv = 1 / Math.hypot(nx, 2 * e, nz);
        n.setXYZ(i, nx * inv, 2 * e * inv, nz * inv);
      }
      const tile = new THREE.Mesh(geo, groundMat);
      tile.position.set(cx, 0, cz);
      tile.receiveShadow = true;
      tile.userData.terrainTile = true;
      scene.add(tile);
      obstacleMeshes.push(tile);
    }
  }
}

function buildSchoolMap() {
  buildTexMats();
  scene.fog = new THREE.Fog(0x9fb0a0, 40, 180); // 숲 안개 — 녹회색·조금 더 짙게(깊이감) #177
  buildGroundTiles(0xa9ac82);          // 숲 바닥 (올리브-탄, 붉은기 완화)
  // 외곽 경계벽 (나무로 가림)
  const W = WORLD_HALF;
  addBox(0, 2.5, -W, W * 2 + 2, 5, 1, 'concrete', { shadow: false });
  addBox(0, 2.5, W, W * 2 + 2, 5, 1, 'concrete', { shadow: false });
  addBox(-W, 2.5, 0, 1, 5, W * 2 + 2, 'concrete', { shadow: false });
  addBox(W, 2.5, 0, 1, 5, W * 2 + 2, 'concrete', { shadow: false });

  // 운동장 (흙바닥) + 학교 건물
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(74, 42),
    new THREE.MeshStandardMaterial({ map: GROUND_TEX.ground ? GROUND_TEX.ground.clone() : makeGroundTexture(), color: 0xbaa889, roughness: 1 }));
  yard.rotation.x = -Math.PI / 2; yard.position.set(0, 0.03, 30); yard.receiveShadow = true;
  scene.add(yard);
  buildSchoolBuilding(0, 0);

  // 숲: 맵 전역 산포 + 지면 클러터(수풀·풀·꽃·바위)
  scatterForest(-W + 6, -W + 6, W - 6, W - 6);
  scatterGroundClutter(-W + 6, -W + 6, W - 6, W - 6);

  losMeshes = obstacleMeshes.filter((o) => !o.userData.terrainTile);
}

// 학교 맵 데이터
const SCHOOL_FLATTENS = [
  { x: 0, z: 0, hw: 36, hd: 9 },     // 학교 건물 패드(대형화 L68×Dp15)
  { x: 0, z: 32, hw: 38, hd: 22 },   // 운동장
  ...[[0, 80, 8], [74, -46, 8], [-74, -46, 8], [64, 66, 8], [-64, 66, 8], [80, 80, 7], [-80, 80, 7], [80, -80, 7], [-80, -80, 7]].map(([x, z, r]) => ({ x, z, r })),
];
const MAP_SCHOOL = {
  key: 'school', name: '숲속 고등학교', desc: '숲으로 둘러싸인 폐교 — 실내 교전',
  build: buildSchoolMap,
  flattens: SCHOOL_FLATTENS,
  lootSpots: [
    [-28, -4], [-19, -4], [-9, -4], [0, -4], [9, -4], [19, -4], [28, -4], // 교실 7칸
    [-24, 5], [-8, 5], [8, 5], [24, 5],                 // 복도
    [0, 14], [-16, 26], [18, 26], [0, 40],              // 운동장/현관앞
    [-70, -42], [70, -42], [60, 62], [-60, 62],         // 외곽 숲
  ],
  extract: [
    { name: '정문 (남)', pos: new THREE.Vector3(0, 0, 82) },
    { name: '북동 임도', pos: new THREE.Vector3(78, 0, -78) },
    { name: '북서 임도', pos: new THREE.Vector3(-78, 0, -78) },
    { name: '남동 숲길', pos: new THREE.Vector3(78, 0, 78) },
  ],
  spawns: [
    new THREE.Vector3(0, 0, 80), new THREE.Vector3(74, 0, -44),
    new THREE.Vector3(-74, 0, -44), new THREE.Vector3(64, 0, 64), new THREE.Vector3(-64, 0, 64),
  ],
  barrels: [
    [-18, -4, true], [18, -4, false], [0, 14, true], [-40, 40, false],
    [40, -40, true], [-50, -30, false], [50, 50, false], [8, 38, true],
  ],
};

// ── 도심 맵 (#198) ────────────────────────────────────────
// 창문 + 1층 진입 실내 (#199). 1층=창문 셸(정면 문)+바닥/천장, 상층=솔리드+창 facade.
function urbanWins(len) {
  const sp = 3.2, n = Math.max(1, Math.floor((len - 2.6) / sp)), span = n * sp, o = [];
  for (let i = 0; i <= n; i++) o.push({ at: -span / 2 + i * sp, w: 1.4 });
  return o;
}
function urbanBuilding(cx, cz, w, d, floors, mat) {
  const FH = 3.3;
  // 1층: 진입 셸 — 정면(+Z) 문, 나머지 3면 창문 벽
  addWallWithDoor(cx, cz + d / 2, w, FH, 'x', mat, 0, 2.8);
  addWindowWall(cx, cz - d / 2, w, FH, 'x', mat, urbanWins(w), 0);
  addWindowWall(cx - w / 2, cz, d, FH, 'z', mat, urbanWins(d), 0);
  addWindowWall(cx + w / 2, cz, d, FH, 'z', mat, urbanWins(d), 0);
  addBox(cx, 0.05, cz, w, 0.1, d, 'concrete', { block: false }); // 실내 바닥
  addBox(cx, FH, cz, w, 0.3, d, 'concrete');                      // 천장(=상층 바닥)
  // 상층: 솔리드 매스 + 각 층 창 facade(어두운 창)
  if (floors > 1) {
    const uh = (floors - 1) * FH;
    addBox(cx, FH + uh / 2, cz, w, uh, d, mat);
    for (let f = 1; f < floors; f++) {
      addWindowWall(cx, cz + d / 2 + 0.05, w, FH, 'x', mat, urbanWins(w), f * FH);
      addWindowWall(cx, cz - d / 2 - 0.05, w, FH, 'x', mat, urbanWins(w), f * FH);
    }
  }
  addBox(cx, floors * FH + 0.25, cz, w + 0.5, 0.5, d + 0.5, 'concrete'); // 옥상 파라펫
}
function buildRoom(cx, cz, w, d, mat) {                        // 진입 가능한 작은 상가(문 1개)
  const h = 3;
  addWallWithDoor(cx, cz + d / 2, w, h, 'x', mat, 0, 2.4);
  addWall(cx, cz - d / 2, w, h, 'x', mat);
  addWall(cx - w / 2, cz, d, h, 'z', mat);
  addWall(cx + w / 2, cz, d, h, 'z', mat);
  addBox(cx, h + 0.1, cz, w + 0.3, 0.2, d + 0.3, 'concrete');  // 지붕
}
function buildUrbanMap() {
  buildTexMats();
  scene.fog = new THREE.Fog(0x949aa2, 42, 190);               // 회색 스모그
  buildGroundTiles(0x8f959c);                                 // 아스팔트 회색
  const W = WORLD_HALF;
  addBox(0, 3, -W, W * 2 + 2, 6, 1, 'concrete', { shadow: false });
  addBox(0, 3, W, W * 2 + 2, 6, 1, 'concrete', { shadow: false });
  addBox(-W, 3, 0, 1, 6, W * 2 + 2, 'concrete', { shadow: false });
  addBox(W, 3, 0, 1, 6, W * 2 + 2, 'concrete', { shadow: false });
  // 아파트/오피스 블록 (다양한 높이·재질) — 중앙 광장(±16) 개방, 거리 형성
  for (const [x, z, w, d, f, m] of [
    [-36, -36, 20, 16, 5, 'brick'], [36, -34, 18, 20, 6, 'concrete'], [-38, 38, 22, 18, 4, 'plaster'],
    [40, 36, 16, 16, 7, 'brick'], [-60, 2, 14, 28, 5, 'concrete'], [60, 6, 16, 22, 6, 'plaster'],
    [0, -58, 30, 14, 4, 'brick'], [4, 60, 26, 14, 5, 'concrete'], [-62, -60, 18, 16, 5, 'plaster'], [62, -62, 16, 18, 6, 'brick'],
  ]) urbanBuilding(x, z, w, d, f, m);
  // 중앙 광장: 진입 가능한 상가 2채 + 엄폐
  buildRoom(-13, -7, 9, 8, 'plaster'); buildRoom(13, 9, 9, 8, 'brick');
  for (const [x, z, rot] of [[-16, 18, 0], [18, -16, 1], [0, 27, 0], [-27, -13, 1], [25, 21, 0], [-4, -22, 1]]) addBox(x, 1.3, z, rot ? 2.4 : 5, 2.6, rot ? 5 : 2.4, 'metal'); // 컨테이너 엄폐
  for (const [x, z, ax] of [[-6, 0, 'x'], [8, -4, 'z'], [-2, 11, 'x'], [10, 6, 'z']]) addWall(x, z, 6, 1.1, ax, 'concrete'); // 낮은 방벽
  for (const [x, z] of [[-10, 4], [10, -8], [0, 16], [-20, 20], [22, -6]]) placeModel('barrel', x, z, { collide: true });
  losMeshes = obstacleMeshes.filter((o) => !o.userData.terrainTile);
}
const URBAN_FLATTENS = [
  { x: 0, z: 0, hw: 74, hd: 74 },
  ...[[82, 82, 7], [-82, 82, 7], [82, -82, 7], [-82, -82, 7]].map(([x, z, r]) => ({ x, z, r })),
];
const MAP_URBAN = {
  key: 'urban', name: '도심 폐허', desc: '무너진 도심 — 아파트 블록·거리 시가전',
  build: buildUrbanMap,
  flattens: URBAN_FLATTENS,
  lootSpots: [
    [-13, -7], [13, 9], [0, 0], [-16, 18], [18, -16], [-27, -13], [25, 21], // 광장·상가·엄폐
    [-36, -36], [36, -34], [-38, 38], [40, 36], [0, -58], [4, 60],           // 건물 1층 실내
    [-36, -24], [36, -22], [-38, 26], [40, 24], [0, -46], [4, 48],           // 블록 주변 거리
    [-60, 2], [60, 6], [-62, -60], [62, -62], [-46, 46], [46, 48],           // 외곽 거리·건물
  ],
  extract: [
    { name: '북 대로', pos: new THREE.Vector3(0, 0, -80) },
    { name: '남 지하도', pos: new THREE.Vector3(0, 0, 80) },
    { name: '동 고가', pos: new THREE.Vector3(80, 0, 0) },
    { name: '서 철교', pos: new THREE.Vector3(-80, 0, 0) },
  ],
  spawns: [
    new THREE.Vector3(0, 0, -78), new THREE.Vector3(0, 0, 78),
    new THREE.Vector3(78, 0, 0), new THREE.Vector3(-78, 0, 0), new THREE.Vector3(70, 0, -70),
  ],
  barrels: [
    [-16, -16, true], [16, 16, false], [0, 24, true], [-40, 0, false],
    [40, 0, true], [-24, 24, false], [24, -24, false], [0, -30, true],
  ],
};

// ── 맵 레지스트리 (#165) ──────────────────────────────────
// 산업지대 데이터 스냅샷 (지금 FLATTENS/LOOT_SPOTS 등은 산업지대 값 — applyMap 이 active 를 교체)
const MAP_INDUSTRIAL = {
  key: 'industrial', name: '산업지대', desc: '컨테이너 야적장·창고·주택 단지',
  build: buildIndustrialMap,
  flattens: FLATTENS, lootSpots: LOOT_SPOTS, extract: EXTRACT_CANDIDATES,
  spawns: SPAWN_POINTS, barrels: PHYS_BARRELS,
};
const MAPS = { industrial: MAP_INDUSTRIAL, school: MAP_SCHOOL, urban: MAP_URBAN };
let currentMapKey = 'industrial';
let builtMapKey = null;
let staticObjects = []; // 현재 정적 맵이 scene 에 추가한 최상위 오브젝트 (맵 전환 시 제거)

function tearDownStatic() {
  for (const o of staticObjects) { scene.remove(o); o.traverse && o.traverse((c) => c.geometry && c.geometry.dispose && c.geometry.dispose()); }
  staticObjects = [];
  colliders = [];
  obstacleMeshes = [];
  losMeshes = [];
  if (physWorld) { physWorld.free && physWorld.free(); physWorld = null; }
}

// 선택된 맵의 정적 지오메트리·물리를 구성 (필요 시 이전 맵 teardown)
function applyMap(key) {
  if (builtMapKey === key) return;
  const m = MAPS[key] || MAP_INDUSTRIAL;
  if (builtMapKey) tearDownStatic();
  FLATTENS = m.flattens; LOOT_SPOTS = m.lootSpots; EXTRACT_CANDIDATES = m.extract;
  SPAWN_POINTS = m.spawns; PHYS_BARRELS = m.barrels;
  const before = new Set(scene.children);
  m.build();
  for (const c of scene.children) if (!before.has(c)) staticObjects.push(c);
  buildPhysicsStatics();
  builtMapKey = key;
  currentMapKey = key;
}

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
  if (airdropBeacon) { scene.remove(airdropBeacon.beam); scene.remove(airdropBeacon.ring); scene.remove(airdropBeacon.light); airdropBeacon = null; } // (#197)
  for (const t of tracers) scene.remove(t.line);
  tracers = [];
  for (const d of decals) scene.remove(d); // 탄흔 데칼 정리 (#208)
  decals = [];
  for (const c of corpses) scene.remove(c);
  corpses = [];
  clearPhysics(); // 물리 소품/래그돌 정리 (#119)
}

function startRaid(mapKey) {
  if (!assetsReady) return;
  clearRaidObjects();
  applyMap(mapKey || currentMapKey); // 선택 맵 구성 (전환 시 이전 맵 teardown)

  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  player.pos.copy(spawn);
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(spawn.x, spawn.z); // 맵 중앙(0,0)을 바라보게
  player.pitch = 0;
  player.recoilPitch = 0; player.recoilYaw = 0; gun.bloom = 0; gun.recoil = 0; // 반동 상태 초기화 (#207)
  if (pc) { // 3인칭 캐릭터 초기 정렬 (#116)
    pc.faceYaw = Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw));
    pc.group.rotation.y = pc.faceYaw;
    pc.group.visible = true;
    // 레이드 시작 시 애니메이션 레이어 초기화 (하체 idle + 상체 지향) (#180/#182)
    pc.upperShot = null; pc.gunAim = 0; pc.fireHold = 0; pc.aimBlend = 0; pc.aimWorld = null;
    if (pc.actAim) pc.actAim.stop();
    pc.mixer.stopAllAction();
    if (pc.actIdleLower) { pc.actIdleLower.reset().play(); pc.lowerAct = pc.actIdleLower; }
    if (pc.upperReady) { pc.upperReady.reset().play(); pc.upperAct = pc.upperReady; }
    if (pc.actAimUp) { pc.actAimUp.reset().play(); pc.actAimUp.setEffectiveWeight(0); }
    if (pc.actAimDown) { pc.actAimDown.reset().play(); pc.actAimDown.setEffectiveWeight(0); }
  }
  player.hp = PLAYER.maxHp;
  player.stamina = 100;

  const stash0 = loadStash();
  const owned0 = (stash0.weapons || ['rifle']).filter((k) => WEAPONS[k]);
  // 로드아웃 반입 무기 (#189): 선택된 것만 반입(미설정 시 소지 전량), 최소 1정 보장
  let lw = Array.isArray(stash0.loadoutW) ? stash0.loadoutW.filter((k) => owned0.includes(k)) : owned0.slice();
  if (!lw.length) lw = [owned0.includes('rifle') ? 'rifle' : (owned0[0] || 'rifle')];
  carry = lw;
  for (const k of Object.keys(weaponAmmo)) delete weaponAmmo[k];
  for (const k of carry) { const ew = effectiveWeapon(k); weaponAmmo[k] = { mag: ew.magSize, reserve: ew.reserveMax }; }
  const eq = stash0.equipped && carry.includes(stash0.equipped) ? stash0.equipped : carry[0];
  equipWeapon(eq, false); // mag/reserve/reload 리셋 포함
  gun.triggerDown = false;
  gun.semiLatch = false;
  gun.foundWeapons = [];
  // 방어구/헬멧 반입 (#193): 로드아웃 표시된 것만 착용(미설정 시 반입). 미반입은 스태시 안전.
  player.armorDur = (stash0.loadoutArmor !== false) ? Math.min(ARMOR_MAX, stash0.armorDur || 0) : 0;
  player.helmet = (stash0.loadoutHelmet !== false) && !!stash0.helmet;
  player.aiming = false;
  if (IS_MOBILE) $('tb-ads').classList.remove('active');

  inventory = [];
  // 소모품 반입 (#187/#189/#193): 로드아웃 개수만큼 반입(미설정 시 전량). 스태시에서 빠짐 →
  // 생존 시 잔량 반환, 사망 시 손실.
  const cons = stash0.consumables || [];
  const lc = stash0.loadoutC; // {name:count} (undefined = 전량)
  const remainCons = [], broughtCons = [];
  if (lc === undefined) { broughtCons.push(...cons); }
  else {
    const need = { ...lc };
    for (const c of cons) {
      if ((need[c.name] || 0) > 0) { broughtCons.push(c); need[c.name]--; } else remainCons.push(c);
    }
  }
  if (broughtCons.length) {
    for (const c of broughtCons) inventory.push({ name: c.name, value: c.value, heal: c.heal, type: 'consumable' });
    stash0.consumables = remainCons;
    saveStash(stash0);
    addFeed(`소모품 ${broughtCons.length}개 반입`);
  }
  // 열쇠 반입 (#195): 로드아웃 표시된 열쇠만(미설정 시 전량). 사망 시 손실.
  broughtKeys = new Set();
  const ownedKeys = stash0.keys || [];
  const lk = stash0.loadoutKeys; // keyId 배열(undefined = 전량)
  for (const key of ownedKeys) if (lk === undefined || lk.includes(key.keyId)) broughtKeys.add(key.keyId);
  state.kills = 0;
  state.raidTime = RAID_SECONDS;
  state.phase = 'raid';
  state.paused = false;
  pendingExtractFee = 0;
  state.airdropDone = false;
  state.airdropAt = RAID_SECONDS - (90 + Math.random() * 150); // 1.5~4분 경과 시 보급 투하 (#197)

  spawnLoot();
  spawnPhysProps(); // 동적 물리 배럴/폭발통 (#119)
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
  if (pc) { pc.group.visible = false; if (pc.gunPivot) pc.gunPivot.visible = false; } // 3인칭 캐릭터/총 숨김 (#116)

  const stash = loadStash();
  stash.raids = (stash.raids || 0) + 1;
  stash.kills = (stash.kills || 0) + state.kills;

  if (result === 'extract') {
    const value = inventoryValue();
    stash.extracts = (stash.extracts || 0) + 1;
    // 반입 분류 (#185/#186/#187): 부품 → stash.parts, 소모품 → stash.consumables, 그 외 가치품 → stash.valuables
    const bankedParts = inventory.filter((i) => i.type === 'part').map((i) => ({ name: i.name, value: i.value, slot: i.slot }));
    const bankedCons = inventory.filter((i) => i.type === 'consumable').map((i) => ({ name: i.name, value: i.value, heal: i.heal }));
    const banked = inventory.filter((i) => i.type !== 'part' && i.type !== 'consumable' && i.type !== 'key' && (i.value || 0) > 0).map((i) => ({ name: i.name, value: i.value }));
    stash.parts = [...(stash.parts || []), ...bankedParts];
    stash.consumables = [...(stash.consumables || []), ...bankedCons];
    stash.valuables = [...(stash.valuables || []), ...banked];
    // 습득 열쇠 반입 (중복 소유는 무시) (#195)
    stash.keys = stash.keys || [];
    const ownedIds = new Set(stash.keys.map((k) => k.keyId));
    for (const i of inventory) if (i.type === 'key' && !ownedIds.has(i.keyId)) { stash.keys.push({ name: i.name, keyId: i.keyId, value: i.value }); ownedIds.add(i.keyId); }
    // 레이드 중 습득한 무기 소유 확정 + 장착 유지
    const owned = new Set(stash.weapons || ['rifle']);
    for (const k of (gun.foundWeapons || [])) owned.add(k);
    stash.weapons = [...owned];
    stash.equipped = GUN.key;
    // 방어구/헬멧: 반입한 경우만 내구도·상태 갱신(미반입은 스태시 안전분 유지) (#193)
    if (stash.loadoutArmor !== false) stash.armorDur = player.armorDur;
    if (stash.loadoutHelmet !== false) stash.helmet = player.helmet;
    if (pendingExtractFee) stash.roubles = Math.max(0, (stash.roubles || 0) - pendingExtractFee); // 유료 탈출 비용 (#194)
    saveStash(stash);
    const used = RAID_SECONDS - state.raidTime;
    dom.extractStats.innerHTML =
      `레이드 시간 ${fmtTime(used)} · 사살 ${state.kills} · 인벤토리 반입 <b style="color:#d9c86a">₽ ${value.toLocaleString('ko-KR')}</b>`
      + (pendingExtractFee ? ` · 탈출 비용 <b style="color:#d98f6a">-₽ ${pendingExtractFee.toLocaleString('ko-KR')}</b>` : '')
      + ` <span style="color:#93a393">(귀중품은 인벤토리에서 매각)</span>`;
    dom.extractLoot.innerHTML = summaryHTML();
    dom.extract.style.display = 'flex';
  } else {
    // 사망 (#189): 반입(로드아웃)한 무기·장착부품·방어구만 손실, 스태시 나머지는 안전.
    const brought = carry.filter((k) => k !== 'rifle'); // 기본 소총은 항상 유지
    stash.weapons = (stash.weapons || ['rifle']).filter((k) => k === 'rifle' || !brought.includes(k));
    if (!stash.weapons.includes('rifle')) stash.weapons.unshift('rifle');
    stash.equipped = stash.weapons.includes(stash.equipped) ? stash.equipped : 'rifle';
    stash.weaponParts = stash.weaponParts || {};
    stash.attachments = stash.attachments || {};
    for (const k of brought) { delete stash.weaponParts[k]; delete stash.attachments[k]; } // 잃은 무기의 부품·부착 제거
    stash.loadoutW = (stash.loadoutW || []).filter((k) => stash.weapons.includes(k));
    if (stash.loadoutArmor !== false) stash.armorDur = 0;   // 반입한 방어구만 손실 (#193)
    if (stash.loadoutHelmet !== false) stash.helmet = false;
    if (broughtKeys.size) stash.keys = (stash.keys || []).filter((k) => !broughtKeys.has(k.keyId)); // 반입한 열쇠 손실 (#195)
    // attOwned·parts·consumables(미반입분)·valuables·미반입 방어구/열쇠는 스태시 안전 → 유지
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
// 보급소 (#113) — 상점을 별도 화면으로
document.getElementById('btn-shop').addEventListener('click', () => {
  audio();
  if (!assetsReady) return;
  renderShop();
  $('shop-screen').style.display = 'flex';
});
document.getElementById('shop-close').addEventListener('click', () => {
  $('shop-screen').style.display = 'none';
  updateMenuStash();
});
// 인벤토리 (#185)
document.getElementById('btn-inventory').addEventListener('click', () => {
  audio();
  renderInventoryScreen();
  $('inventory-screen').style.display = 'flex';
});
document.getElementById('inv-close').addEventListener('click', () => {
  $('inventory-screen').style.display = 'none';
  updateMenuStash();
});
document.getElementById('inv-sell-all').addEventListener('click', () => {
  const st = loadStash();
  const vals = st.valuables || [];
  if (!vals.length) return;
  st.roubles = (st.roubles || 0) + vals.reduce((s, v) => s + (v.value || 0), 0);
  st.valuables = [];
  saveStash(st);
  sfx.pickup();
  renderInventoryScreen();
  updateMenuStash();
});
document.getElementById('equip-close').addEventListener('click', () => {
  $('equip-screen').style.display = 'none';
  cancelAnimationFrame(equipRAF);
  updateMenuStash();
});

// 라이선스·크레딧 화면 — CREDITS.md 를 런타임에 불러와 렌더 (단일 소스) (#175)
function renderCreditsMd(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmt = (s) => esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = [];
  for (const line of md.split('\n')) {
    if (/^#\s/.test(line)) continue;                       // 최상단 제목 생략(화면 h2 로 대체)
    else if (/^#{2,3}\s/.test(line)) out.push('<h3>' + esc(line.replace(/^#{2,3}\s/, '')) + '</h3>');
    else if (/^-\s/.test(line)) out.push('<div class="li">• ' + fmt(line.replace(/^-\s/, '')) + '</div>');
    else if (line.trim()) out.push('<div class="note">' + fmt(line) + '</div>');
  }
  return out.join('');
}
document.getElementById('btn-license').addEventListener('click', async () => {
  audio();
  const body = document.getElementById('license-body');
  document.getElementById('license-screen').style.display = 'flex';
  if (!body.dataset.loaded) {
    try {
      const md = await fetch('./CREDITS.md' + ASSET_VER).then((r) => r.text());
      body.innerHTML = renderCreditsMd(md);
    } catch (e) { body.textContent = 'CREDITS 를 불러오지 못했습니다.'; }
    body.dataset.loaded = '1';
  }
});
document.getElementById('license-close').addEventListener('click', () => {
  document.getElementById('license-screen').style.display = 'none';
});

dom.btnStart.addEventListener('click', () => {
  audio();
  if (state.paused && state.phase === 'raid') {
    state.paused = false;
    dom.menu.style.display = 'none';
    lockPointer();
  } else {
    dom.btnStart.textContent = '레이드 시작';
    showMapSelect();
  }
});

// 맵 선택 오버레이 (#165) — 레이드 시작 시 맵 고르기
let mapSelectEl = null;
function showMapSelect() {
  if (!mapSelectEl) {
    mapSelectEl = document.createElement('div');
    mapSelectEl.id = 'mapselect';
    mapSelectEl.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:rgba(8,12,10,.82);backdrop-filter:blur(3px)';
    const title = document.createElement('div');
    title.textContent = '레이드 지역 선택';
    title.style.cssText = 'color:#dfe8df;font-size:26px;letter-spacing:3px;font-weight:700';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:20px;flex-wrap:wrap;justify-content:center';
    for (const key of Object.keys(MAPS)) {
      const m = MAPS[key];
      const card = document.createElement('button');
      card.style.cssText = 'width:300px;padding:22px 20px;border-radius:10px;cursor:pointer;text-align:left;color:#e6eede;background:rgba(24,32,24,.85);border:1px solid rgba(255,255,255,.16);transition:all .12s';
      card.onmouseenter = () => { card.style.borderColor = '#8fb06a'; card.style.background = 'rgba(60,80,50,.7)'; };
      card.onmouseleave = () => { card.style.borderColor = 'rgba(255,255,255,.16)'; card.style.background = 'rgba(24,32,24,.85)'; };
      card.innerHTML = `<div style="font-size:20px;font-weight:700;margin-bottom:8px">${m.name}</div><div style="font-size:13px;color:#a8b6a0;line-height:1.5">${m.desc}</div>`;
      card.onclick = () => { mapSelectEl.style.display = 'none'; startRaid(key); };
      row.appendChild(card);
    }
    const cancel = document.createElement('button');
    cancel.textContent = '취소';
    cancel.style.cssText = 'margin-top:6px;padding:8px 22px;border-radius:6px;cursor:pointer;color:#cfd8cf;background:rgba(20,28,20,.8);border:1px solid rgba(255,255,255,.18)';
    cancel.onclick = () => { mapSelectEl.style.display = 'none'; };
    mapSelectEl.append(title, row, cancel);
    document.body.appendChild(mapSelectEl);
  }
  mapSelectEl.style.display = 'flex';
}

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
  if (e.code === 'KeyV') toggleViewMode();
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
  // 동적 크로스헤어 (#207): 스코프 조준 시 숨김. 그 외엔 유효 탄퍼짐(gun.spread)을 간격으로 반영.
  {
    const ch = document.getElementById('crosshair');
    const show = !scopeShown && state.phase === 'raid';
    ch.style.display = show ? 'block' : 'none';
    if (show) ch.style.setProperty('--gap', (3 + (gun.spread || 0) * 620).toFixed(1) + 'px');
  }
  // 저체력 치료 힌트 (#110): useHeal 과 같은 우선순위(붕대 먼저)로 다음 사용 아이템 안내
  {
    const low = player.hp < 45 && player.hp > 0 && state.phase === 'raid';
    const item = low ? (inventory.find((i) => i.heal && i.heal <= 30) || inventory.find((i) => i.heal)) : null;
    const txt = item ? `Q — ${item.name} 사용 (+${item.heal} HP)` : '';
    if (dom.healHint.textContent !== txt) dom.healHint.textContent = txt;
    dom.healHint.style.display = item ? 'block' : 'none';
    const tb = document.getElementById('tb-heal');
    if (tb) tb.classList.toggle('urgent', !!item);
  }
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
    // 잠긴 금고: 열쇠 반입 여부 표시 (#195)
    const locked = it.locked && !broughtKeys.has(it.lockKey);
    const kn = locked && KEY_BY_ID[it.lockKey] ? KEY_BY_ID[it.lockKey].name : '';
    const label = locked ? `${it.label} 🔒 (${kn} 필요)` : `${it.label} 열기`;
    dom.prompt.innerHTML = `<b>[E]</b> ${label}`;
    if (IS_MOBILE) {
      const b = $('tb-interact');
      b.style.display = 'flex';
      b.textContent = label;
    }
  } else {
    dom.prompt.style.display = 'none';
    if (IS_MOBILE) $('tb-interact').style.display = 'none';
  }
  updateCompass();
  updateMinimap();
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
    updatePhysics(dt); // Rapier 스텝 + 소품/래그돌 동기화 (#119)
    updateExtraction(dt);
    updateEvents(dt);
    updateAcoustics(dt);
    updateHUD();
  }
  updateEffects(dt);
  // 하늘: 카메라 추종(구면 클리핑 방지) + 구름 드리프트
  skyMesh.position.copy(camera.position);
  skyUniforms.uTime.value = now / 1000;
  if (composer) composer.render();       // 항상 컴포저 경유 (톤매핑 일관) — 효과 OFF 는 GTAO/블룸 패스만 비활성
  else renderer.render(scene, camera);
}

// 해상도는 고정 설정값(High/Med/Low)으로만 바꿈 — 실행 중 자동 변경은 버퍼 리사이즈로 화면이
// 깜박여서 폐기(#136). 사용자가 메뉴에서 선택, localStorage 저장.
const RES_LEVELS = { high: 1.0, medium: 0.82, low: 0.66 };
function setResolution(level) {
  renderScale = RES_LEVELS[level] || 1.0;
  applyRenderScale();
  try { localStorage.setItem('exshoot_res', level); } catch {}
  document.querySelectorAll('#res-row button[data-res]').forEach((b) => b.classList.toggle('active', b.dataset.res === level));
}
function setPostfx(on) {
  if (gtaoPass) gtaoPass.enabled = !!on;   // 무거운 AO/블룸만 토글, RenderPass+OutputPass 는 유지
  if (bloomPass) bloomPass.enabled = !!on;
  try { localStorage.setItem('exshoot_fx', on ? 'on' : 'off'); } catch {}
  document.querySelectorAll('#res-row button[data-fx]').forEach((b) => b.classList.toggle('active', b.dataset.fx === (on ? 'on' : 'off')));
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
  // 물리 디버그 (#119)
  get physReady() { return physReady; },
  get physProps() { return physProps.map((p) => { const t = p.body.translation(); return { x: t.x, y: t.y, z: t.z, explosive: p.explosive, exploded: p.exploded, sleeping: p.body.isSleeping() }; }); },
  get ragdolls() { return ragdolls.length; },
  get renderScale() { return renderScale; },
  set renderScale(v) { renderScale = THREE.MathUtils.clamp(v, 0.5, 1); applyRenderScale(); },
  set postfx(v) { setPostfx(!!v); },
  explodeAt(x, y, z, opts) { explodeAt(new THREE.Vector3(x, y, z), opts || {}); },
  _dbgFire() {
    const m = pcMuzzle();
    return { muzzle: m.toArray().map((v) => +v.toFixed(2)), gunPivot: pc ? pc.gunPivot.position.toArray().map((v) => +v.toFixed(2)) : null, gunLen: pc && pc.gunLen, handR: !!(pc && pc.handR), handL: !!(pc && pc.handL), curGun: !!(pc && pc.curGun) };
  },
  _startRaid(k) { startRaid(k); },
  get _map() { return { current: currentMapKey, built: builtMapKey, maps: Object.keys(MAPS) }; },
  _dbgAim() {
    if (!pc) return null;
    const cam = new THREE.Vector3(); camera.getWorldDirection(cam);
    const bar = new THREE.Vector3(0, 0, 1).applyQuaternion(pc.gunPivot.getWorldQuaternion(new THREE.Quaternion()));
    return { camDir: cam.toArray().map((v) => +v.toFixed(3)), barrel: bar.toArray().map((v) => +v.toFixed(3)), dot: +cam.dot(bar).toFixed(3), aimBlend: +(pc.aimBlend || 0).toFixed(2), aiming: player.aiming };
  },
};

initExplosionPool(); // 폭발 VFX 풀 미리 생성 (셰이더 재컴파일 방지, #132)
// 해상도 설정 (#136): 저장값 적용 + 버튼 배선
{
  let savedRes = 'high', savedFx = 'on';
  try { savedRes = localStorage.getItem('exshoot_res') || 'high'; savedFx = localStorage.getItem('exshoot_fx') || 'on'; } catch {}
  document.querySelectorAll('#res-row button[data-res]').forEach((b) => b.addEventListener('click', () => { audio(); setResolution(b.dataset.res); }));
  document.querySelectorAll('#res-row button[data-fx]').forEach((b) => b.addEventListener('click', () => { audio(); setPostfx(b.dataset.fx === 'on'); }));
  setResolution(RES_LEVELS[savedRes] ? savedRes : 'high');
  setPostfx(savedFx !== 'off');
}
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
