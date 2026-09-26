import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
    damageBody: 34, damageHead: 95, range: 200, velocity: 715, kg: 3.6, // 탄속 m/s (#301)
    spreadHip: 0.022, spreadAds: 0.005, spreadMove: 0.02,
    pellets: 1, auto: true, adsFov: 55, recoil: 0.35, kick: 0.006, sfxRate: 1, sfxVol: 0.45,
  },
  revolver: {
    key: 'revolver', name: '리볼버', model: 'revolver', price: 12000, viewLen: 0.34,
    fireInterval: 0.5, magSize: 6, reserveMax: 24, reloadTime: 2.8,
    damageBody: 60, damageHead: 170, range: 120, velocity: 260, kg: 1.1, // 탄속 m/s (#301)
    spreadHip: 0.03, spreadAds: 0.006, spreadMove: 0.025,
    pellets: 1, auto: false, adsFov: 60, recoil: 0.7, kick: 0.012, sfxRate: 1.15, sfxVol: 0.5,
  },
  smg2: {
    key: 'smg2', name: 'SMG', model: 'smg2', price: 18000, viewLen: 0.5,
    fireInterval: 0.07, magSize: 35, reserveMax: 105, reloadTime: 1.9,
    damageBody: 22, damageHead: 55, range: 120, velocity: 400, kg: 2.8, // 탄속 m/s (#301)
    spreadHip: 0.03, spreadAds: 0.012, spreadMove: 0.018,
    pellets: 1, auto: true, adsFov: 62, recoil: 0.22, kick: 0.004, sfxRate: 1.3, sfxVol: 0.38,
  },
  shotgun: {
    key: 'shotgun', name: '펌프 샷건', model: 'shotgun', price: 34000, viewLen: 0.60,
    fireInterval: 0.85, magSize: 6, reserveMax: 30, reloadTime: 2.6,
    damageBody: 13, damageHead: 24, range: 46, velocity: 400, kg: 3.4, // 탄속 m/s (#301)
    spreadHip: 0.055, spreadAds: 0.038, spreadMove: 0.02,
    pellets: 8, auto: false, adsFov: 62, recoil: 0.9, kick: 0.02, sfxRate: 0.7, sfxVol: 0.55,
  },
  bullpup: {
    key: 'bullpup', name: '불펍 소총', model: 'bullpup', price: 55000, viewLen: 0.62,
    fireInterval: 0.09, magSize: 36, reserveMax: 108, reloadTime: 2.0,
    damageBody: 38, damageHead: 105, range: 220, velocity: 900, kg: 3.5, // 탄속 m/s (#301)
    spreadHip: 0.02, spreadAds: 0.004, spreadMove: 0.018,
    pellets: 1, auto: true, adsFov: 52, recoil: 0.32, kick: 0.005, sfxRate: 1.08, sfxVol: 0.45,
  },
  sniper: {
    key: 'sniper', name: '볼트액션 저격총', model: 'sniper', price: 90000, viewLen: 0.78, tpsScale: 1.2,
    fireInterval: 1.5, magSize: 5, reserveMax: 20, reloadTime: 2.9,
    damageBody: 110, damageHead: 260, range: 400, velocity: 830, kg: 4.8, // 탄속 m/s (#301)
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
  { name: '볼트',            value: 1500,  w: 18, kg: 0.2 },
  { name: '붕대',            value: 3000,  w: 16, kg: 0.1, heal: 25, type: 'consumable' },
  { name: '군용 MRE',        value: 8000,  w: 12, kg: 0.6 },
  { name: '구급킷',          value: 14000, w: 7, kg: 0.8,  heal: 60, type: 'consumable' },
  { name: '진통제',          value: 6000,  w: 9, kg: 0.1,  use: 'painkiller', type: 'consumable' }, // 60s 부상 효과 억제 (#307)
  { name: '부목',            value: 5000,  w: 8, kg: 0.3,  use: 'splint', type: 'consumable' },     // 부상 부위(팔/다리) 30% 복구 (#307)
  { name: '손목시계',        value: 15000, w: 10, kg: 0.1 },
  { name: '위스키',          value: 22000, w: 8, kg: 1.2 },
  { name: '금목걸이',        value: 28000, w: 6, kg: 0.1 },
  { name: '그래픽카드',      value: 95000, w: 2, kg: 1.5 },
  { name: '5.56 탄약 30발',  value: 0,     w: 14, kg: 0.4, ammo: 30 },
];

// 총기 부품 (#186) — 지금은 루팅·구매로 획득해 인벤토리에 쌓이는 아이템. 슬롯 장착(커스텀)은 차후.
// type:'part' 로 태깅해 탈출 시 stash.parts 로 분류 반입(귀중품과 구분).
const SLOT_LABEL = { barrel: '총열', muzzle: '총구', handguard: '핸드가드', stock: '개머리판', magazine: '탄창', trigger: '방아쇠', bolt: '노리쇠' };
const SLOT_ORDER = ['barrel', 'muzzle', 'handguard', 'stock', 'magazine', 'trigger', 'bolt'];
// mods: 무기 스탯에 곱(mul)·합(add) 적용. desc 는 UI 표기.
const PART_TABLE = [
  { name: '강선 총열',     value: 12000, w: 5, type: 'part', slot: 'barrel', kg: 1.2,    desc: '명중률·사거리 향상', mods: { spreadHip: { mul: 0.85 }, spreadAds: { mul: 0.8 }, range: { mul: 1.12 } } },
  { name: '소염기',        value: 7000,  w: 6, type: 'part', slot: 'muzzle', kg: 0.3,    desc: '반동 감소',          mods: { recoil: { mul: 0.82 } } },
  { name: '경량 핸드가드', value: 8000,  w: 6, type: 'part', slot: 'handguard', kg: 0.5, desc: '이동 중 탄퍼짐 감소', mods: { spreadMove: { mul: 0.75 } } },
  { name: '전술 개머리판', value: 9000,  w: 6, type: 'part', slot: 'stock', kg: 0.7,     desc: '반동·총열 튐 감소',  mods: { recoil: { mul: 0.85 }, kick: { mul: 0.85 } } },
  { name: '확장 탄창',     value: 6000,  w: 7, type: 'part', slot: 'magazine', kg: 0.4,  desc: '탄창 +10',           mods: { magSize: { add: 10 } } },
  { name: '경기용 방아쇠', value: 15000, w: 3, type: 'part', slot: 'trigger', kg: 0.2,   desc: '연사 속도 향상',     mods: { fireInterval: { mul: 0.9 } } },
  { name: '강화 노리쇠',   value: 11000, w: 4, type: 'part', slot: 'bolt', kg: 0.6,      desc: '재장전 속도 향상',   mods: { reloadTime: { mul: 0.85 } } },
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
  { name: '창고 열쇠',     keyId: 'warehouse', value: 25000, w: 1.2, price: 40000, type: 'key', kg: 0.05 },
  { name: '사무실 금고 키', keyId: 'office',    value: 35000, w: 0.8, price: 55000, type: 'key', kg: 0.05 },
];
const KEY_BY_ID = Object.fromEntries(KEY_TABLE.map((k) => [k.keyId, k]));
const LOOT_POOL = [...ITEM_TABLE, ...PART_TABLE, ...KEY_TABLE]; // 루팅 롤 대상(일반+부품+열쇠)
// ── 무게·휴대 한계 (#310): 반입 무기 + 착용 방어구 + 레이드 인벤토리(kg). ok 이하 정상 / ok~over 이동 ×0.85·질주 지구력 ×1.4 / over 초과 이동 ×0.65·질주 불가 / max 초과 픽업 불가
const CARRY = { ok: 18, over: 28, max: 36 };
const ARMOR_KG = 6.0, HELMET_KG = 1.2;
const ITEM_KG = {}; for (const t of [ITEM_TABLE, PART_TABLE, KEY_TABLE]) for (const i of t) ITEM_KG[i.name] = i.kg != null ? i.kg : 0.5;
function itemKg(i) { return i.kg != null ? i.kg : (ITEM_KG[i.name] != null ? ITEM_KG[i.name] : 0.5); }
function carryWeight() {
  let w = 0;
  for (const k of carry) w += (WEAPONS[k] && WEAPONS[k].kg) || 3;
  if (player.armorDur > 0) w += ARMOR_KG; if (player.helmet) w += HELMET_KG;
  for (const i of inventory) w += itemKg(i);
  return w;
}
function weightTier(w) { return w > CARRY.over ? 2 : w > CARRY.ok ? 1 : 0; }
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
  rangeHud: $('range-hud'), rhShots: $('rh-shots'), rhHits: $('rh-hits'), rhAcc: $('rh-acc'), rhLast: $('rh-last'), rhGroup: $('rh-group'), // 사격 연습장 스코어 (#292)
  rhTitle: $('rh-title'), rhDrill: $('rh-drill'), rhBest: $('rh-best'), recoilTrace: $('recoil-trace'), // 무기별 통계·드릴·반동 궤적 (#295)
  rhHist: $('rh-hist'), rhPat: $('rh-pat'), rhDist: $('rh-dist'), // 최근 기록·반동 패턴·거리계 (#298)
  bodyHud: $('body-hud'), painHint: $('pain-hint'), // 신체 HUD (#304), 부상 처치 힌트 (#307)
  weight: $('weight'), // 무게계 (#310)
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

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 480); // far 480: 원경 능선(262+30m)이 맵 모서리에서도 잘리지 않게 (#322)
camera.rotation.order = 'YXZ';

// ---------- 하늘 (그라데이션 + 태양 글로우 + 드리프트 구름) ----------
const SUN_DIR = new THREE.Vector3(-60, 55, -30).normalize();
const skyUniforms = {
  uSunDir: { value: SUN_DIR },
  uTime: { value: 0 },
  // 맵별 하늘 팔레트 (#319 렌더 개편) — applyLook 이 교체. 기본값 = 기존 청회색 하늘
  uTop: { value: new THREE.Color(0.30, 0.41, 0.56) }, uMid: { value: new THREE.Color(0.60, 0.69, 0.78) }, uHor: { value: new THREE.Color(0.84, 0.85, 0.83) },
  uCloud: { value: 0.55 }, uCloudCol: { value: new THREE.Color(0.97, 0.96, 0.94) },
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
    uniform vec3 uTop, uMid, uHor, uCloudCol;
    uniform float uCloud;
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
      vec3 top = uTop, mid = uMid, hor = uHor;
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
        vec3 cloudCol = uCloudCol * (0.8 + 0.2 * s);
        col = mix(col, cloudCol, cov * uCloud);
      }
      gl_FragColor = vec4(col, 1.0);
      // 톤매핑/색공간은 포스트프로세싱 OutputPass 가 일괄 처리 (#139) — 여기서 이중 적용 금지
    }`,
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(360, 24, 12), skyMat);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

// 하늘 기반 환경맵(IBL) — 금속/표면에 은은한 반사·주변광
// 맵별 하늘이 바뀌면(#319) 다시 구워 반사·주변광 색이 하늘과 맞게 한다
let _envRT = null;
function rebuildEnv(intensity = 0.22) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), skyMat));
  const rt = pmrem.fromScene(envScene, 0.04);
  if (_envRT) _envRT.dispose();
  _envRT = rt; scene.environment = rt.texture; scene.environmentIntensity = intensity;
  pmrem.dispose();
}
rebuildEnv();

const hemi = new THREE.HemisphereLight(0xb8cbdc, 0x54483a, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b0, 2.35);
sun.position.set(-60, 55, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_MOBILE ? 2048 : 4096, IS_MOBILE ? 2048 : 4096);
// 그림자 (#319 렌더 개편): 맵 전체(±110) 대신 플레이어 주변 ±SHADOW_HALF 를 추종 + 광원 공간 텍셀 스냅(이동 시 떨림 방지)
// → 4096 맵 기준 텍셀 5.4cm → 3.2cm. 광원 방향 깊이(far 260)는 그대로라 범위 밖 건물의 그림자도 범위 안으로 드리운다.
const SHADOW_HALF = IS_MOBILE ? 55 : 65;
sun.shadow.camera.left = -SHADOW_HALF; sun.shadow.camera.right = SHADOW_HALF;
sun.shadow.camera.top = SHADOW_HALF; sun.shadow.camera.bottom = -SHADOW_HALF;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
sun.shadow.radius = 3; // PCFSoft 소프트닝
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun); scene.add(sun.target);
// 역광 필 — 음영면이 새까맣게 죽지 않게 반대편에서 차가운 약광 (그림자 없음)
const fill = new THREE.DirectionalLight(0x9fb6cc, 0.32);
fill.position.set(55, 28, 40);
scene.add(fill);
// 맵별 태양 방향 (#277): MAP.sun=[x,y,z] 이면 그 방향, 없으면 기본(북서광). 필은 항상 반대편. 그림자 카메라(±110, far 250)는 방향 무관.
const SUN_DEFAULT = [-60, 55, -30], FILL_DEFAULT = [55, 28, 40];
const SUN_OFF = new THREE.Vector3(...SUN_DEFAULT).normalize().multiplyScalar(130);
function setMapSun(s) {
  if (s) { SUN_OFF.set(s[0], s[1], s[2]); fill.position.set(-s[0] * 0.92, 28, -s[2] * 0.67); }
  else { SUN_OFF.set(...SUN_DEFAULT); fill.position.set(...FILL_DEFAULT); }
  skyUniforms.uSunDir.value.copy(SUN_OFF).normalize(); // 하늘 태양 디스크 = 실제 광원 방향 (#319 — 전엔 기본 방향에 고정돼 맵별 태양과 어긋남)
  SUN_OFF.normalize().multiplyScalar(130);
  updateSunShadow(true);
}
const _shF = new THREE.Vector3(), _shR = new THREE.Vector3(), _shU = new THREE.Vector3(), _shC = new THREE.Vector3();
function updateSunShadow(force = false) {
  const c = (state && state.phase === 'raid') ? player.pos : camera.position;
  _shF.copy(SUN_OFF).normalize().negate();
  _shR.crossVectors(_shF, Math.abs(_shF.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : _up).normalize(); _shU.crossVectors(_shR, _shF);
  const texel = (2 * SHADOW_HALF) / sun.shadow.mapSize.x;
  const a = Math.round(c.dot(_shR) / texel) * texel, b = Math.round(c.dot(_shU) / texel) * texel, d = c.dot(_shF);
  _shC.copy(_shR).multiplyScalar(a).addScaledVector(_shU, b).addScaledVector(_shF, d);
  if (!force && _shC.distanceToSquared(sun.target.position) < 1e-8) return;
  sun.target.position.copy(_shC); sun.position.copy(_shC).add(SUN_OFF);
  sun.target.updateMatrixWorld();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});

// 포스트프로세싱 파이프라인 (#139) — RenderPass → GTAO(AO) → Bloom → OutputPass(톤매핑/sRGB)
// scene 은 이 시점에 아직 비어 있어도 무방(패스는 참조만 보유). 조명/환경 설정 후 호출.
let gtaoPass = null, bloomPass = null, gradePass = null;
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
      // 알파 컷아웃·반투명(카드 나무·벚꽃·체인 펜스·유리·꽃잎)은 AO 법선/깊이 패스에서 제외 (#319): 오버라이드 재질이 alphaTest 를 무시해
      // 카드 사각형 전체가 깊이에 찍혀 수관에 검은 사각 AO 가 생기던 문제. 가시성은 GTAOPass 의 캐시가 복원한다.
      const ov = gtaoPass.overrideVisibility.bind(gtaoPass);
      gtaoPass.overrideVisibility = function () { ov(); this.scene.traverse((o) => { const m = o.material; if (o.isMesh && m && !Array.isArray(m) && (m.alphaTest > 0 || m.transparent)) o.visible = false; }); };
      composer.addPass(gtaoPass);
    } catch (e) { console.warn('GTAO 생략:', e && e.message); }
  }
  // 블룸: 아주 밝은 부분만 은은하게 (너무 세던 값 하향, #148)
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.9); // strength, radius, threshold
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass()); // 톤매핑/sRGB (항상 유지 — 효과 OFF 여도 색 일관)
  // 컬러 그레이딩 + 비네트 (톤매핑 후, 시네마틱 톤) — 한 패스, 저비용 (#148)
  gradePass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uContrast: { value: 1.07 }, uSat: { value: 1.12 }, uVig: { value: 1.0 },
      uShadow: { value: new THREE.Vector3(1, 1, 1) }, uHigh: { value: new THREE.Vector3(1, 1, 1) }, uGrain: { value: 0.0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uContrast, uSat, uVig, uGrain, uTime; uniform vec3 uShadow, uHigh; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l0 = dot(c.rgb, vec3(0.299,0.587,0.114));
        c.rgb *= mix(uShadow, uHigh, smoothstep(0.04, 0.8, l0));  // 스플릿 토닝: 그늘 ↔ 하이라이트 색온도 (#319)
        c.rgb = (c.rgb - 0.5) * uContrast + 0.5;                 // 대비
        float l = dot(c.rgb, vec3(0.299,0.587,0.114));
        c.rgb = mix(vec3(l), c.rgb, uSat);                       // 채도
        vec2 p = (vUv - 0.5) * uVig;                             // 비네트
        c.rgb *= mix(0.72, 1.0, smoothstep(0.85, 0.28, length(p)));
        c.rgb += (hash(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5) * uGrain * (1.0 - l); // 필름 그레인(어두운 곳 위주, 밴딩 완화)
        gl_FragColor = c;
      }`,
  });
  composer.addPass(gradePass);
}
setupPostFX();

// ── 맵별 룩 (#319 렌더 개편): 하늘 팔레트·반구광·태양·필·노출·IBL·그레이딩을 한 벌로. applyMap 이 m.look 으로 적용 ──
const LOOKS = {
  default: { top: [0.30, 0.41, 0.56], mid: [0.60, 0.69, 0.78], hor: [0.84, 0.85, 0.83], cloud: 0.55, cloudCol: [0.97, 0.96, 0.94],
    hemi: [0xb8cbdc, 0x54483a, 0.55], sun: [0xffe0b0, 2.35], fill: [0x9fb6cc, 0.32], exposure: 0.95, env: 0.22, tone: 'aces',
    grade: { contrast: 1.07, sat: 1.1, vig: 1.0, shadow: [0.975, 0.995, 1.035], high: [1.025, 1.0, 0.97], grain: 0.014 } },
  // 봄 오전: 옅은 파랑 하늘 + 분홍빛 도는 수평 헤이즈, 밝은 반구광(벚꽃 그늘이 새까매지지 않게), 따뜻한 하이라이트·푸른 그늘
  spring: { top: [0.34, 0.52, 0.80], mid: [0.64, 0.76, 0.90], hor: [0.92, 0.89, 0.91], cloud: 0.42, cloudCol: [1.0, 0.98, 0.98],
    hemi: [0xd6e4f4, 0x8c7a68, 0.72], sun: [0xfff0d8, 2.55], fill: [0xc8d4ea, 0.38], exposure: 0.95, env: 0.32, tone: 'neutral', // Khronos PBR Neutral: 벚꽃 분홍·하늘 파랑 채도 보존(ACES 는 탁한 헤이즈, AgX 는 회색으로 바램 — 3종 비교)
    grade: { contrast: 1.04, sat: 1.07, vig: 0.85, shadow: [0.965, 0.985, 1.05], high: [1.03, 1.0, 0.975], grain: 0.012 } },
  // 숲(학교): 수평선을 안개(녹회색)에 맞추고 반구광을 올려 수관 그늘 바닥이 새까매지지 않게
  forest: { top: [0.32, 0.44, 0.56], mid: [0.58, 0.66, 0.70], hor: [0.66, 0.72, 0.66], cloud: 0.5, cloudCol: [0.95, 0.96, 0.94],
    hemi: [0xc4d6c8, 0x6a5a44, 0.72], sun: [0xffe6c0, 2.4], fill: [0xa9bfb0, 0.36], exposure: 1.0, env: 0.26, tone: 'aces',
    grade: { contrast: 1.06, sat: 1.08, vig: 1.0, shadow: [0.97, 1.0, 1.02], high: [1.03, 1.0, 0.96], grain: 0.014 } },
  // 도심 폐허: 회색 스모그 하늘(안개색과 이음), 낮은 채도·약간 차가운 그늘
  smog: { top: [0.40, 0.44, 0.50], mid: [0.58, 0.60, 0.63], hor: [0.66, 0.67, 0.68], cloud: 0.62, cloudCol: [0.86, 0.86, 0.86],
    hemi: [0xb5bec8, 0x5a5550, 0.62], sun: [0xffe2c0, 2.2], fill: [0xa0adba, 0.36], exposure: 0.97, env: 0.22, tone: 'aces',
    grade: { contrast: 1.08, sat: 0.94, vig: 1.05, shadow: [0.96, 0.99, 1.04], high: [1.02, 1.0, 0.98], grain: 0.018 } },
};
let currentLook = null;
function applyLook(key) {
  const L = LOOKS[key] || LOOKS.default;
  if (currentLook === L) return;
  currentLook = L;
  skyUniforms.uTop.value.setRGB(...L.top); skyUniforms.uMid.value.setRGB(...L.mid); skyUniforms.uHor.value.setRGB(...L.hor);
  skyUniforms.uCloud.value = L.cloud; skyUniforms.uCloudCol.value.setRGB(...L.cloudCol);
  hemi.color.setHex(L.hemi[0]); hemi.groundColor.setHex(L.hemi[1]); hemi.intensity = L.hemi[2];
  sun.color.setHex(L.sun[0]); sun.intensity = L.sun[1]; fill.color.setHex(L.fill[0]); fill.intensity = L.fill[1];
  renderer.toneMappingExposure = L.exposure;
  renderer.toneMapping = L.tone === 'neutral' ? THREE.NeutralToneMapping : L.tone === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  if (gradePass) { const g = gradePass.uniforms, G = L.grade; g.uContrast.value = G.contrast; g.uSat.value = G.sat; g.uVig.value = G.vig; g.uShadow.value.set(...G.shadow); g.uHigh.value.set(...G.high); g.uGrain.value = G.grain; }
  rebuildEnv(L.env);
}
applyLook('default');

// ============================================================
// 에셋 (Kenney / Quaternius CC0 — CREDITS.md 참조)
// ============================================================
const ASSETS = {};   // key → gltf
const GROUND_TEX = {}; // ground/gravel 컬러맵 (없으면 절차 생성 폴백)
const BUILD_TEX = {};  // 건축 PBR 텍스처 (#107, ambientCG CC0) — key: { col, nrm }
const CANOPY_TEX = {}; // 카드 트리/풀 카드 알파 텍스처 (#280, make_canopy_cards.py 합성) — key: Texture
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
  // (Kenney Nature Kit 나무/바위는 카드 트리·Poly Haven 바위로 대체돼 제거 #289)
  // Poly Haven photoscan 리얼 바위 (CC0) — gltf-transform decimate(simplify 0.35 + 512tex + draco) (#211)
  rockRealA: 'assets/env/nature/rock_real_a.glb', // stone_01 (히어로 대형)
  rockRealB: 'assets/env/nature/rock_real_b.glb', // rock_07 (중형)
  rockRealC: 'assets/env/nature/rock_real_c.glb', // rock_09 (소형 각진)
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
  // (Kenney survival 풀은 풀 카드로 대체돼 제거 #289)
  carVan: 'assets/env/cars/van.glb',
  carTruck: 'assets/env/cars/truck-flat.glb',
  carSedan: 'assets/env/cars/sedan.glb',
  carSuv: 'assets/env/cars/suv.glb',
  carDelivery: 'assets/env/cars/delivery-flat.glb',
  carTire: 'assets/env/cars/debris-tire.glb',
  carCovered: 'assets/env/cars/covered_car.glb', // Poly Haven photoscan 리얼 방치차 (#217)
  // Poly Haven hidden_alley 도심 그리블 (CC0) — weld→simplify→resize512, plain GLB (#265). 다변형 팩은 placeProp keep 으로 1개만.
  acUnit: 'assets/env/urban/ac_unit.glb',           // exterior_aircon_unit (clean|rusted 2변형, 19k→3.3k tris)
  fireEscape: 'assets/env/urban/fire_escape.glb',   // modular_fire_escape (조립 1개, 9.6m)
  rollShutter: 'assets/env/urban/roll_shutter.glb', // rollershutter_window_01 (plain|graffiti 2변형, 2.1×1.85m)
  manhole: 'assets/env/urban/manhole.glb',          // water_manhole_cover (0.7m, 6.3k tris) (#268)
  hydrant: 'assets/env/urban/hydrant.glb',          // fire_hydrant (normal|aged 2변형, 0.8m, 86k→11k tris) (#268)
  roadBarrier: 'assets/env/urban/road_barrier.glb',     // concrete_road_barrier_02 (1.56×0.44×1.11m, 43k→4.8k) (#274)
  trashCan: 'assets/env/urban/trash_can.glb',           // metal_trash_can (clean|rust; 뚜껑/손잡이가 옆에 흩어진 팩 → 본체만 keep)
  utilityBox: 'assets/env/urban/utility_box.glb',       // utility_box_02 (0.92×0.43×1.12m)
  trashbag: 'assets/env/urban/trashbag.glb',            // trashbag (0.53×0.57m)
  tyre: 'assets/env/urban/tyre.glb',                    // old_tyre (Ø0.6, 세워진 형태)
  securityLight: 'assets/env/urban/security_light.glb', // security_light (벽부착, 0.53m)
};

// Quaternius 개별 나무·바위 등록 (split_nature.py 산출) + 숲 나무 구성 (#165)
// Quaternius Stylized Nature 는 전부 제거됨 — 나무는 카드 트리(#280), 클러터·바위는 Poly Haven 리얼 프롭(#283). split_nature.py 는 기록용.
// Poly Haven 숲 프롭 (CC0, decimate). fern/shrub 는 변형 a~d 가 X축으로 나란한 팩 → propGeo keep 으로 1개씩 병합 배치.
GLB_MANIFEST.fern = 'assets/env/forest/fern.glb';        // fern_02 (a 312 / b 952 / c 898 / d 341 tris)
GLB_MANIFEST.shrub = 'assets/env/forest/shrub.glb';      // shrub_03 (a~d ~1k tris)
GLB_MANIFEST.stump = 'assets/env/forest/stump.glb';      // tree_stump_01 (10k, 1.4m)
GLB_MANIFEST.deadLog = 'assets/env/forest/dead_log.glb'; // dead_tree_trunk_02 (6.6k, 4m 길이 — 엄폐)

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
          if (/leaf|leaves|foliage|bush|plant|grass|flower|petal|fern|shrub|ivy/.test(mn)) { // Poly Haven fern_02/shrub_03 도 alphaMode MASK 카드 (#283)
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
  // 카드 트리/풀 카드 텍스처 (#280) — RGBA PNG(알파 컷아웃). 실패 시 canopyMat 단색 폴백
  for (const key of ['canopy_broad_a', 'canopy_broad_b', 'canopy_autumn', 'canopy_pine', 'grass_card', 'ivy_card', 'canopy_sakura', 'canopy_sakura_b', 'sakura_ground', 'sakura_raft', 'petal', 'chainlink', 'flowers_card', 'streak', 'grime']) { // sakura*/petal/chainlink: 벚꽃 동네 (#319) // ivy_card: 폐교 덩굴 (#286)
    jobs.push((async () => {
      try { const t = await loadTex(`assets/textures/${key}.png`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); CANOPY_TEX[key] = t; } catch { /* 폴백 */ }
    })());
  }
  jobs.push(...[['ground', 'assets/textures/ground.jpg'], ['gravel', 'assets/textures/gravel.jpg'], ['rubble', 'assets/textures/rubble.jpg'], ['forest', 'assets/textures/forest.jpg'], ['water_nrm', 'assets/textures/water_nrm.jpg']].map(async ([key, path]) => { // water_nrm: 개천 물결 (#319, 로드 뒤 colorSpace 는 사용처에서 NoColorSpace) // rubble = ambientCG Ground107 도심 공터 (#268), forest = Ground076 숲 바닥 (#280)
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
  for (const key of ['brick', 'plaster', 'rooftile', 'corrugated', 'woodfloor', 'concrete', 'asphalt', 'paving', 'plasterbroken', 'brickdirty', 'barkoak', 'barkfir', 'barkdark', 'kawara', 'siding', 'blockwall', 'hedge']) { // kawara/siding/blockwall/hedge: 벚꽃 동네 (#319) // asphalt/paving: 도심 거리 (#268), plasterbroken/brickdirty: 파사드 변주 (#277), bark*: 카드 트리 껍질 (#280)
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
let TERRAIN_FN = null; // 맵별 지형 훅 (#319 벚꽃 동네: 개천 트렌치·계단·다리) — applyMap 이 설정
function terrainH(x, z) {
  if (TERRAIN_FN) return TERRAIN_FN(x, z);
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
  if (collide) {
    colliders.push(colliderFromModel(m, x, z, rotY, gy));
    notePlacement(key, (bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2, (bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2, gy, gy + (bb.max.y - bb.min.y)); // 겹침 진단 (#215)
  }
  if (block) m.traverse((o) => { if (o.isMesh) obstacleMeshes.push(o); });
  return m;
}

// 프롭 풍화 리컬러 (#216): Kenney 밝은 톤 GLB(탱크·굴뚝 등)를 어둡고 거칠게 → 산업 폐허 톤.
function weatherModel(m, mul = 0.66, rough = 0.92) {
  m.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      if (o.material.color) o.material.color.multiplyScalar(mul);
      o.material.roughness = Math.max(o.material.roughness ?? 0.5, rough);
      if (o.material.metalness !== undefined) o.material.metalness = Math.min(o.material.metalness, 0.3);
    }
  });
  return m;
}

// ── 리얼 카드 트리 (#280 학교 Phase 1): 껍질 PBR 원뿔대 줄기·가지 + 캐노피 카드(활엽 = 교차 카드 클러스터 / 침엽 = 티어 카드 / 고사목 = 가지만).
// 카드 텍스처는 scripts/assets/make_canopy_cards.py 가 ambientCG 잎 아틀라스(CC0)로 합성. 시드 결정론. 청크(44m)·재질별 mergeGeometries →
// 숲 ~490그루가 ~100 draw call. 이동 콜라이더는 줄기만(서서 엄폐, 옛 placeTree 규약), 병합 메시는 obstacleMeshes(탄착/LOS). vertexColors 로 명도 변주.
const CANOPY_MAT = {};
function canopyMat(key) {
  if (!CANOPY_MAT[key]) CANOPY_MAT[key] = foliageNoFlip(new THREE.MeshStandardMaterial({ map: CANOPY_TEX[key] || null, color: CANOPY_TEX[key] ? 0xffffff : 0x4a6a35, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0, vertexColors: true }));
  return CANOPY_MAT[key];
}
const FOREST_CHUNK = 44;
function forestBatch() { // 청크·재질별 지오메트리 누적 → flush 시 병합 메시 1개씩
  const byKey = new Map(), bid = bakeBatchId(), rp = bakeReplay(); // (#325)
  return {
    put(x, z, mkey, mat, geo) { if (rp || !geo) return; const k = `${Math.floor(x / FOREST_CHUNK)},${Math.floor(z / FOREST_CHUNK)}|${mkey}`; if (!byKey.has(k)) byKey.set(k, { mat, geos: [] }); byKey.get(k).geos.push(geo); },
    flush() {
      if (rp) return bakeReplayFlush(bid);
      let n = 0;
      for (const { mat, geos } of byKey.values()) { const g = mergeGeometries(geos, false); for (const q of geos) q.dispose(); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; scene.add(m); obstacleMeshes.push(m); bakeRecord(bid, m, true); n++; }
      byKey.clear(); return n;
    },
  };
}
const _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _dir = new THREE.Vector3();
function barkSeg(p0, p1, r0, r1, radial = 7) { return bakeReplay() ? null : barkSegRaw(p0, p1, r0, r1, radial); } // 배치 전용 — 굽기 재생 중엔 null (#325)
function barkSegRaw(p0, p1, r0, r1, radial = 7) { // 원뿔대 p0→p1 (반지름 r0→r1). 껍질 UV 를 미터(둘레·길이)로 → TEXMAT repeat(1/tile) 와 정합
  _dir.subVectors(p1, p0); const len = _dir.length(); _dir.normalize();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  const uv = g.attributes.uv, circ = Math.PI * (r0 + r1);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * len);
  _q.setFromUnitVectors(_up, _dir); g.applyQuaternion(_q);
  g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  return g;
}
function cardGeo(c, w, h, yaw, tilt, col, flipU) { // 알파 카드 1장 (vertexColors 명도)
  if (bakeReplay()) return null; // (#325)
  const g = new THREE.PlaneGeometry(w, h);
  if (flipU) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
  g.rotateX(tilt); g.rotateY(yaw); g.translate(c.x, c.y, c.z);
  const n = g.attributes.position.count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = col[0]; cols[i * 3 + 1] = col[1]; cols[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
// kind: 'canopy_broad_a' | 'canopy_broad_b' | 'canopy_autumn' | 'pine' | 'dead'. h = 전고(m). trunkR = 줄기 콜라이더 반경(엄폐목은 크게).
function placeCardTree(fb, kind, x, z, h, trunkR = 0.35, seed = 1) {
  const rnd = mulberry32(seed), gy = terrainH(x, z), V = (px, py, pz) => new THREE.Vector3(x + px, gy + py, z + pz);
  const bark = kind === 'pine' ? 'barkfir' : kind === 'dead' ? 'barkdark' : 'barkoak', bm = matOf(bark);
  const put = (g) => fb.put(x, z, bark, bm, g), tone = 0.72 + rnd() * 0.3;
  if (kind === 'pine') {
    const r0 = 0.06 + h * 0.012;
    put(barkSeg(V(0, -0.2, 0), V((rnd() - 0.5) * 0.3, h * 0.96, (rnd() - 0.5) * 0.3), r0, 0.03));
    const T = 5 + Math.floor(rnd() * 3), cm = canopyMat('canopy_pine');
    for (let i = 0; i < T; i++) {
      const f = i / (T - 1), y = h * (0.2 + 0.74 * f), w = (h * 0.34) * (1 - 0.78 * f) + 0.9, yaw0 = rnd() * Math.PI, c = tone * (0.6 + 0.4 * f);
      for (let k = 0; k < 3; k++) fb.put(x, z, 'canopy_pine', cm, cardGeo(V(0, y - w * 0.22, 0), w, w * 0.5, yaw0 + k * Math.PI / 3, 0, [c * 0.95, c, c * 0.9], rnd() < 0.5));
    }
  } else if (kind === 'dead') {
    const r0 = 0.08 + h * 0.014, top = V((rnd() - 0.5) * 0.5, h * 0.78, (rnd() - 0.5) * 0.5);
    put(barkSeg(V(0, -0.2, 0), top, r0, r0 * 0.35));
    const nb = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < nb; i++) {
      const a = rnd() * Math.PI * 2, y0 = h * (0.4 + 0.38 * rnd()), L = h * (0.22 + 0.25 * rnd()), up = 0.35 + rnd() * 0.5;
      const b1 = V(Math.cos(a) * L, y0 + L * up, Math.sin(a) * L);
      put(barkSeg(V(0, y0, 0), b1, r0 * 0.45 * (1 - y0 / h) + 0.03, 0.015, 5));
      if (rnd() < 0.6) { const a2 = a + (rnd() - 0.5) * 1.2, L2 = L * 0.55; put(barkSeg(b1, b1.clone().add(new THREE.Vector3(Math.cos(a2) * L2, L2 * 0.6, Math.sin(a2) * L2)), 0.02, 0.008, 5)); }
    }
  } else { // 활엽: 줄기 0.5h + 클러스터별 가지 + 교차 카드 3 + 상단 덮개 카드
    const cm = canopyMat(kind), r0 = 0.07 + h * 0.014, th = h * 0.5, topP = V((rnd() - 0.5) * 0.4, th, (rnd() - 0.5) * 0.4);
    put(barkSeg(V(0, -0.2, 0), topP, r0, r0 * 0.55));
    const K = 5 + Math.floor(rnd() * 4), cy = th + h * 0.25, rx = h * 0.27, ry = h * 0.2, cs = [];
    for (let i = 0; i < K; i++) { const a = (i / K) * Math.PI * 2 + rnd() * 0.8, rr = rx * (0.4 + 0.6 * rnd()); cs.push([Math.cos(a) * rr, cy + (rnd() - 0.5) * ry * 1.4, Math.sin(a) * rr]); }
    cs.push([0, cy + ry * 0.55, 0], [(rnd() - 0.5) * 2, cy - ry * 0.2, (rnd() - 0.5) * 2]);
    const b0 = new THREE.Vector3(topP.x, gy + th * 0.88, topP.z);
    for (const [ox, oy, oz] of cs) {
      put(barkSeg(b0, V(ox * 0.85, oy - h * 0.06, oz * 0.85), 0.09, 0.03, 5));
      const s = h * (0.36 + 0.14 * rnd()), hf = Math.min(1, Math.max(0, (oy - cy + ry) / (2 * ry))), c = tone * (0.62 + 0.38 * hf), yaw0 = rnd() * Math.PI;
      for (let k = 0; k < 3; k++) { const g = cardGeo(V(ox, oy, oz), s, s, yaw0 + k * Math.PI / 3, (rnd() - 0.5) * 0.7, [c, c * (0.97 + 0.06 * rnd()), c * 0.9], rnd() < 0.5); sphereNormals(g, x, gy + cy, z); fb.put(x, z, kind, cm, g); }
      { const g = cardGeo(V(ox, oy + s * 0.1, oz), s * 0.9, s * 0.9, rnd() * Math.PI, Math.PI / 2 - 0.25, [c * 1.05, c * 1.03, c * 0.92], false); sphereNormals(g, x, gy + cy, z); fb.put(x, z, kind, cm, g); } // 폴리지 노멀 (#319 렌더 개편)
    }
  }
  const top = gy + Math.min(4, Math.max(3, h * 0.35)); // 줄기 콜라이더(서서 엄폐)
  colliders.push(axisCollider(x - trunkR, x + trunkR, gy, top, z - trunkR, z + trunkR));
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
// 배치 겹침 진단 (#215): 건물/프롭 단위 풋프린트(AABB+y범위) 기록 → checkMapOverlaps 로 겹침 탐지.
let placements = [];
let mapOverlaps = [];
function notePlacement(label, cx, cz, hx, hz, y0, y1) { placements.push({ label, cx, cz, hx, hz, y0, y1 }); }
// 배치 겹침 검사: 풋프린트가 x/z 로 상당량 겹치고 y범위도 겹치는 쌍을 보고. 스침·경미 겹침은 무시.
function checkMapOverlaps() {
  const hits = [];
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i], b = placements[j];
      if (a.y1 <= b.y0 + 0.1 || b.y1 <= a.y0 + 0.1) continue;              // y 범위 분리(위아래)면 겹침 아님
      const ox = Math.min(a.cx + a.hx, b.cx + b.hx) - Math.max(a.cx - a.hx, b.cx - b.hx);
      const oz = Math.min(a.cz + a.hz, b.cz + b.hz) - Math.max(a.cz - a.hz, b.cz - b.hz);
      if (ox <= 0.5 || oz <= 0.5) continue;                                // 안 겹침 / 살짝 스침
      const frac = (ox * oz) / Math.min(4 * a.hx * a.hz, 4 * b.hx * b.hz); // 작은 쪽 대비 겹침 비율
      if (frac < 0.22) continue;                                           // 경미한 겹침 무시(엄폐물 인접 등)
      hits.push({ a: a.label, b: b.label, frac: +frac.toFixed(2), ox: +ox.toFixed(1), oz: +oz.toFixed(1), at: [Math.round(a.cx), Math.round(a.cz)] });
    }
  }
  hits.sort((p, q) => q.frac - p.frac);
  mapOverlaps = hits;
  if (hits.length) console.warn(`[map] 배치 겹침 ${hits.length}건 (checkMapOverlaps):`, hits);
  return hits;
}
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
  const cg = {}; for (const c of (st.consumables || [])) { cg[c.name] = cg[c.name] || { n: 0, heal: c.heal, use: c.use }; cg[c.name].n++; }
  const parts = st.parts || []; const pg = {}; for (const p of parts) { pg[p.name] = pg[p.name] || { n: 0, slot: p.slot }; pg[p.name].n++; }
  const accs = (st.attOwned || []).filter((k) => ATTACHMENTS[k]);
  const keys = st.keys || []; const lk = st.loadoutKeys || [];
  const vals = st.valuables || []; const vgz = groupValuables(vals);
  const gunTag = (k) => k === equipped ? '장착 중' : '';
  const moveBtn = (label, attr) => `<button class="ld-btn" ${attr}>${label}</button>`;
  const healTag = (x) => x.heal ? `+${x.heal} HP` : x.use === 'painkiller' ? '진통 60s' : x.use === 'splint' ? '부목' : ''; // (#307)
  // 방어구/헬멧 보유·반입 여부
  const hasArmor = (st.armorDur || 0) > 0, hasHelmet = !!st.helmet;
  const brArmor = st.loadoutArmor !== false, brHelmet = st.loadoutHelmet !== false;

  // 스태시 패널(좌)
  const sGuns = guns.filter((k) => !lw.includes(k));
  const sConsRows = [];
  for (const [n, x] of Object.entries(cg)) { const rem = x.n - (lc[n] || 0); if (rem > 0) sConsRows.push(invRowHTML(`${n} ×${rem}`, healTag(x), '', moveBtn('반입 →', `data-consp="${encodeURIComponent(n)}"`))); }
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
  for (const [n, x] of Object.entries(cg)) { const p = Math.min(lc[n] || 0, x.n); if (p > 0) lConsRows.push(invRowHTML(`${n} ×${p}`, healTag(x), '', moveBtn('← 보관', `data-conss="${encodeURIComponent(n)}"`))); }
  const lArmorRows = [];
  if (hasArmor && brArmor) lArmorRows.push(invRowHTML(`방탄복 (내구도 ${Math.round(st.armorDur)}/${ARMOR_MAX})`, '', '', moveBtn('← 보관', 'data-armld="0"')));
  if (hasHelmet && brHelmet) lArmorRows.push(invRowHTML('헬멧', '', '', moveBtn('← 보관', 'data-helld="0"')));
  const lKeys = keys.filter((k) => lk.includes(k.keyId));
  { // 반입 무게 (#310): 총 + 방어구 + 열쇠 + 소모품(개수)
    let lw = 0; for (const k of lGuns) lw += (WEAPONS[k] && WEAPONS[k].kg) || 3;
    if (hasArmor && brArmor) lw += ARMOR_KG; if (hasHelmet && brHelmet) lw += HELMET_KG;
    lw += lKeys.length * 0.05; for (const [n, x] of Object.entries(cg)) lw += Math.min(lc[n] || 0, x.n) * (ITEM_KG[n] != null ? ITEM_KG[n] : 0.5);
    const el = document.getElementById('inv-load-w'); if (el) { el.textContent = `⚖ ${lw.toFixed(1)} kg${lw > CARRY.over ? ' · 질주 불가' : lw > CARRY.ok ? ' · 과중량' : ''}`; el.style.color = lw > CARRY.over ? '#ff6a55' : lw > CARRY.ok ? '#d9b23c' : '#7f8f7f'; }
  }
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
    html += `<div class="shop-row"><div><div class="w-name">${c.name}</div><div class="w-desc">${c.heal ? `+${c.heal} HP` : c.use === 'painkiller' ? '부상 효과 60초 억제 (X)' : '부상 부위 복구 — 팔/다리 30% (X)'} · 레이드 반입</div></div>`
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
    st.consumables = [...(st.consumables || []), { name: c.name, value: c.value, heal: c.heal, use: c.use }];
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
  steel: new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.5, metalness: 0.55 }), // 사일로/탱크 아연강판
  rust: new THREE.MeshStandardMaterial({ color: 0x6e4a33, roughness: 0.9, metalness: 0.2 }),    // 녹/폐자재
  interior: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 1.0 }),                // 파인 창 뒤 어두운 실내 배킹 (#265)
  soot: new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 1.0 }),                    // 화재 그을음 (#265)
  laneYellow: new THREE.MeshStandardMaterial({ color: 0xc4b26a, roughness: 0.95 }),             // 바랜 중앙선 (#268)
  laneWhite: new THREE.MeshStandardMaterial({ color: 0xd3d1c6, roughness: 0.95 }),              // 바랜 횡단보도/정지선 (#268)
  lampPole: new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.6, metalness: 0.5 }), // 가로등 기둥 (#268)
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
  asphalt: [0x8f8e8a, 0.96, 5.0, 'concreteDark'], // ambientCG Road012B 균열 아스팔트 (#268)
  paving: [0xb4b1a7, 0.95, 2.2, 'concrete'],      // ambientCG Concrete047A 보도/광장 (#268)
  plasterbroken: [0xb9b0a2, 0.95, 2.6, 'concrete'], // ambientCG PaintedPlaster006 벗겨진 페인트 파사드 (#277)
  brickdirty: [0x9a8578, 0.93, 2.4, 'brick'],       // ambientCG Bricks090 때 탄 공장 벽돌 (#277)
  barkoak: [0xbfae96, 1.0, 1.1, 'trunk'],           // ambientCG Bark012 참나무 껍질 — 활엽 줄기 (#280)
  barkfir: [0xb5a28c, 1.0, 1.0, 'trunk'],           // Bark014 전나무 껍질 — 침엽 줄기
  barkdark: [0xa39886, 1.0, 1.0, 'trunk'],          // Bark006 어두운 껍질 — 고사목
  kawara: [0xc4c8ce, 0.72, 2.2, 'roof'],             // ambientCG RoofingTiles013A 흑회색 기와 (#319)
  siding: [0xffffff, 0.82, 1.6, 'concrete'],         // WoodSiding009 크림 사이딩 → 틴트 변주
  blockwall: [0xf4f2ee, 0.95, 1.6, 'concrete'],      // 절차 합성 콘크리트 블록 담 (0.4×0.2m)
  hedge: [0xffffff, 1.0, 1.2, 'leaf'],               // 절차 합성 생울타리
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
  // 마모 톤 변주 (#216 Phase 4b) — 골강판/콘크리트 단조로움 해소. clone 은 map/normalMap 참조 공유(메모리 부담 X).
  const variant = (base, hex, rough) => {
    const src = TEXMAT[base] || MAT.concrete;
    const m = src.clone(); m.color.setHex(hex); if (rough != null) m.roughness = rough;
    m.userData = { worldUV: !!(src.userData && src.userData.worldUV) };
    return m;
  };
  TEXMAT.corrugatedRust = variant('corrugated', 0x8f6f52, 0.8);  // 녹슨 갈색 골강판
  TEXMAT.corrugatedPale = variant('corrugated', 0xc0c3c0, 0.62); // 밝은 아연 골강판
  TEXMAT.corrugatedGrn = variant('corrugated', 0x70806a, 0.7);   // 바랜 청록 골강판
  TEXMAT.concreteStain = variant('concrete', 0x8d887b, 0.97);    // 얼룩진 콘크리트
  TEXMAT.brickCity = variant('brick', 0x9c7e6e, 0.93);           // 도심 적벽돌(짙은 톤) (#265)
  TEXMAT.plasterDirty = variant('plaster', 0xa9a395, 0.97);      // 때 탄 플라스터 (#265)
  // 벚꽃 동네 외벽·지붕 변주 (#319)
  TEXMAT.sidingCream = variant('siding', 0xf4ecdc, 0.8); TEXMAT.sidingGray = variant('siding', 0xbdbcb6, 0.8); TEXMAT.sidingBlue = variant('siding', 0xaec0ce, 0.8);
  TEXMAT.sidingPink = variant('siding', 0xeacdc6, 0.8); TEXMAT.sidingMint = variant('siding', 0xc6d9c8, 0.8); TEXMAT.sidingBrown = variant('siding', 0x9e8672, 0.82);
  TEXMAT.plasterWhite = variant('plaster', 0xf2eee6, 0.92); TEXMAT.plasterBeige = variant('plaster', 0xe0d3ba, 0.93);
  TEXMAT.kawaraBlue = variant('kawara', 0x98a8bf, 0.7); TEXMAT.kawaraBrown = variant('kawara', 0xb39c88, 0.74);
  TEXMAT.asphaltTown = variant('asphalt', 0xc9c6bf, 0.93); TEXMAT.asphaltPatch = variant('asphalt', 0x8a8884, 0.9); TEXMAT.canalStone = variant('concrete', 0x9d998d, 0.97); TEXMAT.barkSakura = variant('barkdark', 0x8a7470, 1.0);
  if (GROUND_TEX.ground) { // 흙 박스 재질(사격장 버름 #292) — 지면 컬러맵을 worldUV 박스에 4m 타일로
    const t = GROUND_TEX.ground.clone(); t.needsUpdate = true; t.repeat.set(1 / 4, 1 / 4);
    TEXMAT.dirt = new THREE.MeshStandardMaterial({ map: t, color: 0xb8a88c, roughness: 1.0 }); TEXMAT.dirt.userData = { worldUV: true };
    const t2 = GROUND_TEX.ground.clone(); t2.needsUpdate = true; t2.repeat.set(1 / 3, 1 / 3); // 정원 흙·공원 마당 (#319)
    TEXMAT.gardenSoil = new THREE.MeshStandardMaterial({ map: t2, color: 0x9c8e76, roughness: 1.0 }); TEXMAT.gardenSoil.userData = { worldUV: true };
  }
  if (GROUND_TEX.gravel) { const t = GROUND_TEX.gravel.clone(); t.needsUpdate = true; t.repeat.set(1 / 2.5, 1 / 2.5); // 개천 바닥·신사 자갈 (#319)
    TEXMAT.gravelWet = new THREE.MeshStandardMaterial({ map: t, color: 0x86827a, roughness: 0.85 }); TEXMAT.gravelWet.userData = { worldUV: true }; }
  for (const k of ['gardenSoil', 'gravelWet']) if (!TEXMAT[k]) TEXMAT[k] = MAT.concreteDark;
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

// 회전 박스 (#286): 기울어진 슬래브·열린 철문·쓰러진 기둥 등 장식. 콜라이더 없음, 탄착/차폐는 등록
function addBoxRot(cx, cy, cz, w, h, d, mat, { rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  mat = matOf(mat);
  const geo = new THREE.BoxGeometry(w, h, d);
  if (mat.userData && mat.userData.worldUV) uvWorldBox(geo, w, h, d, cx, cy, cz);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, cy, cz); mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  scene.add(mesh); obstacleMeshes.push(mesh);
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
  notePlacement('building', cx, cz, w / 2, d / 2, terrainH(cx, cz), terrainH(cx, cz) + h); // 겹침 진단 (#215)
  const dr = mulberry32(Math.round(cx * 73 + cz * 131) >>> 0); // 문 위치: 건물 좌표 시드 (#325 — 굽기 재생과 결정론 일치)
  addWallWithDoor(cx, cz + d / 2, w, h, 'x', mat, (dr() - 0.5) * (w - 4));
  addWallWithDoor(cx, cz - d / 2, w, h, 'x', mat, (dr() - 0.5) * (w - 4));
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
  notePlacement('house', hx, hz, W / 2, D / 2, terrainH(hx, hz), terrainH(hx, hz) + H + 2); // 겹침 진단 (#215)
  const a = (26 * Math.PI) / 180;       // 지붕 경사
  const halfD = D / 2 + 0.5;            // 처마 내밈 포함
  const rise = Math.tan(a) * (D / 2);

  // 기초 플린스 (실내 바닥 높이 0.4 — 문지방 스텝업)
  addBox(hx, 0.15, hz, W + 0.5, 0.5, D + 0.5, 'concrete');
  // 실내 바닥: 윗면(0.43)을 플린스 윗면(0.40)보다 3cm 위로 → 동일평면 z-fighting 회피 (#217)
  addBox(hx, 0.40, hz, W - 0.6, 0.06, D - 0.6, 'woodfloor', { collide: false, block: false, shadow: false });

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

// ── 배치 빌더 (#213 Phase 3): 박스/실린더/콘 파트를 재질별 mergeGeometries 로 병합 → 드로우콜 최소화.
// 이동충돌은 파트별 axisCollider 로 등록(collide), 병합 메시는 재질당 1개만 obstacleMeshes(탄착/차폐) 에 추가.
// ══════════════════════════════════════════════════════════════════════════════
// ── 맵 정적 형상 굽기 (#325): 레이드 시작 프리즈(절차 생성 3~5s, 대부분 박스 수만 개 조립 + 병합) 제거 ──
// 기록(record): 평소대로 빌드하면서 병합 배치(batchBuilder·forestBatch·townBatch)의 최종 병합 형상을 배치 순번별로 저장.
// 재생(replay): 빌드 로직(시드 PRNG·콜라이더·루팅·프롭 배치)은 그대로 돌리되 형상 생성만 건너뛰고, flush 에서 구운 형상으로 메시를 만든다.
// 재료는 이름(MAT/TEXMAT/TMAT/canopy/sakura/prop)으로 직렬화. main.js 해시가 다르면 굽기를 무시하고 기존 생성으로 폴백.
// 파일: assets/baked/<map>.bin.gz = [u32 헤더길이][헤더 JSON][4바이트 정렬 바이너리]. 위치·UV 는 메시별 min/scale Int16 양자화, 노멀 Int8, 색 Uint8(×2 범위).
// 굽기: scripts/bake_maps.py (헤드리스 크롬 → index.html?bake=1 → POST /__bake/<map>.bin.gz). 릴리스 스크립트가 자동 실행.
// ══════════════════════════════════════════════════════════════════════════════
const BAKE = { mode: null, seq: 0, out: null, data: null, fail: null, used: 0 };
const BAKED = {};              // key → 파싱된 굽기 { hash, batchCount, byBatch: Map<id, entry[]>, bytes }
let SRC_HASH = null;           // main.js 내용 해시(굽기 무효화 키)
const SRC_HASH_P = (async () => { // http(비보안 컨텍스트)에선 crypto.subtle 이 없어 cyrb53 사용
  try { const t = await (await fetch(import.meta.url)).text(); let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); SRC_HASH = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + t.length; }
  catch (e) { console.warn('[bake] 소스 해시 실패 — 굽기 사용 안 함', e && e.message); }
  return SRC_HASH;
})();
const bakeReplay = () => BAKE.mode === 'replay';
function bakeBatchId() { return BAKE.mode ? BAKE.seq++ : -1; }
let _matNames = null;
function matNameOf(m) {
  if (!_matNames || !_matNames.has(m)) {
    _matNames = new Map();
    const reg = (o, pfx) => { for (const [k, v] of Object.entries(o)) { if (v && v.isMaterial) { if (!_matNames.has(v)) _matNames.set(v, pfx + k); } else if (Array.isArray(v)) v.forEach((q, i) => { if (q && q.isMaterial && !_matNames.has(q)) _matNames.set(q, `${pfx}${k}.${i}`); }); } };
    reg(TEXMAT, 'TEXMAT.'); reg(MAT, 'MAT.'); reg(TMAT, 'TMAT.');
    for (const [k, v] of Object.entries(CANOPY_MAT)) _matNames.set(v, 'canopy:' + k);
    for (const [k, v] of Object.entries(SAKURA_MAT)) _matNames.set(v, 'sakura:' + k);
    for (const [k, v] of Object.entries(PROP_GEO)) if (v && v.mat) _matNames.set(v.mat, 'prop:' + k);
  }
  return _matNames.get(m) || null;
}
function matByName(n) {
  if (n.startsWith('canopy:')) return canopyMat(n.slice(7));
  if (n.startsWith('sakura:')) return sakuraMat(n.slice(7));
  if (n.startsWith('prop:')) { const ck = n.slice(5), i = ck.indexOf('|'), re = ck.slice(i + 1).match(/^\/(.*)\/([a-z]*)$/); const p = re && propGeo(ck.slice(0, i), new RegExp(re[1], re[2])); return p ? p.mat : null; }
  const [root, k, idx] = n.split('.'), o = { MAT, TEXMAT, TMAT }[root], v = o && o[k];
  return idx !== undefined ? v && v[+idx] : v;
}
// 병합 결과 기록 / 구운 메시 재생 — 배치 flush 공용
function bakeRecord(id, mesh, hit) {
  if (BAKE.mode !== 'record') return;
  const name = matNameOf(mesh.material);
  if (!name) { BAKE.fail = BAKE.fail || `이름 없는 재질 (batch ${id}, color #${mesh.material.color && mesh.material.color.getHexString()})`; return; }
  BAKE.out.push({ id, mat: name, cast: mesh.castShadow, hit, geo: mesh.geometry });
}
function bakeReplayFlush(id) {
  const list = (BAKE.data && BAKE.data.byBatch.get(id)) || [];
  let n = 0;
  for (const e of list) {
    const mat = matByName(e.mat);
    if (!mat) { BAKE.fail = BAKE.fail || `재질 복원 실패 ${e.mat}`; continue; }
    const mesh = new THREE.Mesh(e.geometry, mat); mesh.castShadow = e.cast; mesh.receiveShadow = true;
    scene.add(mesh); if (e.hit) obstacleMeshes.push(mesh); n++; BAKE.used++;
  }
  return n;
}
function bakeSerialize(entries, meta) {
  const parts = [], head = { v: 1, ...meta, entries: [] };
  let off = 0;
  const push = (arr) => { const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; } const o = off; parts.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); off += arr.byteLength; return o; };
  const quant = (attr, comps) => { // 메시별 min/scale → Int16
    const a = attr.array, n = attr.count, mn = new Array(comps).fill(Infinity), mx = new Array(comps).fill(-Infinity);
    for (let i = 0; i < n; i++) for (let c = 0; c < comps; c++) { const v = a[i * comps + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
    const sc = mn.map((m, c) => (mx[c] - m) / 65535 || 1), q = new Int16Array(n * comps);
    for (let i = 0; i < n; i++) for (let c = 0; c < comps; c++) q[i * comps + c] = Math.round((a[i * comps + c] - mn[c]) / sc[c]) - 32768;
    return { off: push(q), min: mn, sc };
  };
  for (const e of entries) {
    const g = e.geo, P = g.attributes.position, n = P.count, rec = { id: e.id, mat: e.mat, cast: e.cast, hit: e.hit, n };
    rec.pos = quant(P, 3);
    if (g.attributes.uv) rec.uv = quant(g.attributes.uv, 2);
    if (g.attributes.normal) { const a = g.attributes.normal.array, q = new Int8Array(n * 3); for (let i = 0; i < n * 3; i++) q[i] = Math.round(Math.max(-1, Math.min(1, a[i])) * 127); rec.nrm = push(q); }
    if (g.attributes.color) { const a = g.attributes.color.array, q = new Uint8Array(n * 3); for (let i = 0; i < n * 3; i++) q[i] = Math.round(Math.max(0, Math.min(2, a[i])) / 2 * 255); rec.col = push(q); }
    if (g.index) { const ia = g.index.array, big = n > 65535, q = big ? new Uint32Array(ia) : new Uint16Array(ia); rec.idx = push(q); rec.ni = ia.length; rec.i32 = big; }
    head.entries.push(rec);
  }
  const hj = new TextEncoder().encode(JSON.stringify(head)), total = 4 + hj.length, pad = (4 - (total % 4)) % 4;
  const out = new Uint8Array(total + pad + off); new DataView(out.buffer).setUint32(0, hj.length + pad, true);
  out.set(hj, 4); out.fill(32, 4 + hj.length, 4 + hj.length + pad); // 공백 패딩(JSON 유효)
  let p = total + pad; for (const part of parts) { out.set(part, p); p += part.byteLength; }
  return out;
}
function bakeParse(buf) {
  const dv = new DataView(buf), hl = dv.getUint32(0, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))), base = 4 + hl;
  const byBatch = new Map();
  const deq = (q, comps, n) => { const a = new Int16Array(buf, base + q.off, n * comps), f = new Float32Array(n * comps); for (let i = 0; i < n; i++) for (let c = 0; c < comps; c++) f[i * comps + c] = (a[i * comps + c] + 32768) * q.sc[c] + q.min[c]; return f; };
  for (const e of head.entries) {
    const g = new THREE.BufferGeometry(), n = e.n;
    g.setAttribute('position', new THREE.BufferAttribute(deq(e.pos, 3, n), 3));
    if (e.nrm !== undefined) g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf.slice(base + e.nrm, base + e.nrm + n * 3)), 3, true));
    if (e.uv) g.setAttribute('uv', new THREE.BufferAttribute(deq(e.uv, 2, n), 2));
    if (e.col !== undefined) { const a = new Uint8Array(buf, base + e.col, n * 3), f = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) f[i] = a[i] / 255 * 2; g.setAttribute('color', new THREE.BufferAttribute(f, 3)); }
    if (e.idx !== undefined) g.setIndex(new THREE.BufferAttribute(e.i32 ? new Uint32Array(buf.slice(base + e.idx, base + e.idx + e.ni * 4)) : new Uint16Array(buf.slice(base + e.idx, base + e.idx + e.ni * 2)), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    if (!byBatch.has(e.id)) byBatch.set(e.id, []);
    byBatch.get(e.id).push({ mat: e.mat, cast: e.cast, hit: e.hit, geometry: g });
  }
  return { hash: head.hash, key: head.key, batchCount: head.batchCount, entryCount: head.entries.length, byBatch };
}
const _bakedP = {};
function loadBaked(key) { // 레이드 시작 전 비동기 로드(1회 캐시). 실패·불일치는 null → 기존 생성
  if (!_bakedP[key]) _bakedP[key] = (async () => {
    const hash = await SRC_HASH_P; if (!hash) return null;
    const t0 = performance.now(), res = await fetch(`assets/baked/${key}.bin.gz${ASSET_VER}`);
    if (!res.ok) { console.info(`[bake] ${key}: 구운 파일 없음(${res.status}) — 절차 생성`); return null; }
    let buf = await res.arrayBuffer(); const bytes = buf.byteLength, b = new Uint8Array(buf, 0, 2);
    if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); // 서버가 Content-Encoding 으로 풀어 줬으면 그대로
    const d = bakeParse(buf);
    if (d.hash !== hash) { console.info(`[bake] ${key}: 소스 해시 불일치(구운 ${d.hash} ≠ 현재 ${hash}) — 절차 생성`); return null; }
    d.bytes = bytes; BAKED[key] = d;
    console.info(`[bake] ${key}: 로드 ${Math.round(performance.now() - t0)}ms · ${(bytes / 1048576).toFixed(2)}MB · 메시 ${d.entryCount} · 배치 ${d.batchCount}`);
    return d;
  })().catch((e) => { console.warn(`[bake] ${key}: 로드 실패 — 절차 생성`, e && e.message); return null; });
  return _bakedP[key];
}
// 굽기 페이지(index.html?bake=1): 전 맵을 기록 모드로 빌드 → gzip → POST. scripts/bake_maps.py 가 받아 assets/baked 에 저장
async function bakeAllMaps() {
  const hash = await SRC_HASH_P, summary = [];
  for (const key of Object.keys(MAPS)) {
    if (builtMapKey) tearDownStatic(); builtMapKey = null;
    BAKE.mode = 'record'; BAKE.seq = 0; BAKE.out = []; BAKE.fail = null;
    const t0 = performance.now();
    try { applyMap(key); } catch (e) { BAKE.fail = 'build: ' + e.message; }
    const ms = Math.round(performance.now() - t0), batchCount = BAKE.seq, entries = BAKE.out;
    BAKE.mode = null;
    if (BAKE.fail) { summary.push({ key, error: BAKE.fail }); console.warn('[bake]', key, BAKE.fail); continue; }
    const raw = bakeSerialize(entries, { hash, key, batchCount });
    const gz = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const r = await fetch(`/__bake/${key}.bin.gz`, { method: 'POST', body: gz });
    summary.push({ key, ms, batches: batchCount, meshes: entries.length, raw: raw.byteLength, gz: gz.byteLength, saved: r.status });
  }
  await fetch('/__bake/done.json', { method: 'POST', body: JSON.stringify({ hash, summary }) });
  console.info('[bake] done', JSON.stringify(summary));
  return summary;
}

function batchBuilder() {
  const byMat = new Map(), bid = bakeBatchId(), rp = bakeReplay(); // 굽기 재생이면 형상 생성 생략(콜라이더만) (#325)
  const put = (m, geo) => { if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(geo); };
  return {
    box(cx, cy, cz, w, h, d, mat, collide = true) {
      if (rp) { if (collide) colliders.push(axisCollider(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2)); return; }
      const m = matOf(mat);
      const geo = new THREE.BoxGeometry(w, h, d);
      if (m.userData && m.userData.worldUV) uvWorldBox(geo, w, h, d, cx, cy, cz);
      geo.translate(cx, cy, cz); put(m, geo);
      if (collide) colliders.push(axisCollider(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2));
    },
    cyl(cx, cy, cz, rTop, rBot, hh, mat, seg = 14, collide = true) {
      if (!rp) { const geo = new THREE.CylinderGeometry(rTop, rBot, hh, seg); geo.translate(cx, cy, cz); put(matOf(mat), geo); }
      const r = Math.max(rTop, rBot);
      if (collide) colliders.push(axisCollider(cx - r, cx + r, cy - hh / 2, cy + hh / 2, cz - r, cz + r));
    },
    cone(cx, cy, cz, r, hh, mat, seg = 14) { if (rp) return; const geo = new THREE.ConeGeometry(r, hh, seg); geo.translate(cx, cy, cz); put(matOf(mat), geo); },
    flush() {
      if (rp) return bakeReplayFlush(bid);
      for (const [m, gs] of byMat) {
        const merged = mergeGeometries(gs, false); for (const g of gs) g.dispose();
        const mesh = new THREE.Mesh(merged, m); mesh.castShadow = mesh.receiveShadow = true;
        scene.add(mesh); obstacleMeshes.push(mesh); bakeRecord(bid, mesh, true);
      }
    },
  };
}

// ── 산업 창고 (#212 Phase 2, #213 배치화, #214 진입가능): 콘크리트 플린스 + 골강판 벽 + 필라스터 +
// 롤셔터 + 고측창 + 평지붕 + 파라펫 + 옥상 그리블. open:true 면 셔터 롤업·통로 개방·내부 루팅공간.
function buildWarehouse(cx, cz, w, d, h, { front = 'north', shutterW = 6, shutterH = 4.6, open = false, wall = 'corrugated' } = {}) {
  const b = batchBuilder();
  const t = 0.35, plinth = 1.2, gy = terrainH(cx, cz);
  notePlacement('warehouse', cx, cz, w / 2, d / 2, gy, gy + h); // 겹침 진단 (#215)
  const wallMat = wall, baseMat = 'concrete'; // wall 변주 (#216)
  const fSign = front === 'north' ? 1 : -1;
  const fz = cz + fSign * d / 2, bz = cz - fSign * d / 2;
  b.box(cx, gy + 0.06, cz, w + 1.0, 0.12, d + 1.0, MAT.concreteDark, false); // 접지 패드
  const wallSeg = (ax, x, z, s0, s1) => {
    const sl = s1 - s0; if (sl < 0.15) return; const mid = (s0 + s1) / 2;
    if (ax === 'x') { b.box(x + mid, gy + plinth / 2, z, sl, plinth, t, baseMat); b.box(x + mid, gy + plinth + (h - plinth) / 2, z, sl, h - plinth, t, wallMat); }
    else { b.box(x, gy + plinth / 2, z + mid, t, plinth, sl, baseMat); b.box(x, gy + plinth + (h - plinth) / 2, z + mid, t, h - plinth, sl, wallMat); }
  };
  wallSeg('z', cx - w / 2, cz, -d / 2, d / 2);
  wallSeg('z', cx + w / 2, cz, -d / 2, d / 2);
  wallSeg('x', cx, bz, -w / 2, w / 2);
  wallSeg('x', cx, fz, -w / 2, -shutterW / 2);
  wallSeg('x', cx, fz, shutterW / 2, w / 2);
  b.box(cx, gy + shutterH + (h - shutterH) / 2, fz, shutterW, h - shutterH, t, wallMat); // 헤더
  if (open) { // 롤업된 셔터(문 상단 말린 박스) — 통로 개방(콜라이더 없음)
    b.box(cx, gy + shutterH - 0.32, fz, shutterW - 0.15, 0.64, t + 0.18, MAT.metalBlue, false);
    for (let i = 0; i < 4; i++) b.box(cx, gy + shutterH - 0.58 + i * 0.15, fz + fSign * (t / 2 + 0.06), shutterW - 0.28, 0.08, 0.05, MAT.concreteDark, false);
    // 문지방 램프(진입 유도) 대신 바닥 문턱 트림
    b.box(cx, gy + 0.09, fz, shutterW, 0.18, 0.4, MAT.concreteDark, false);
  } else { // 닫힌 셔터(차폐+충돌)
    b.box(cx, gy + shutterH / 2, fz, shutterW - 0.2, shutterH, t, MAT.metalBlue);
    for (let sy = 0.28; sy < shutterH; sy += 0.34) b.box(cx, gy + sy, fz + fSign * 0.19, shutterW - 0.3, 0.09, 0.06, MAT.concreteDark, false);
  }
  const nPil = Math.max(2, Math.round(d / 4.5)); // 필라스터 (돌출 강화 #216)
  for (let i = 0; i <= nPil; i++) { const pz = cz - d / 2 + (d * i) / nPil; for (const sx of [-1, 1]) b.box(cx + sx * (w / 2 + 0.13), gy + h / 2, pz, 0.55, h, 0.6, baseMat, false); }
  // 그라임 밴드 (#216) — 벽 하단 때 자국(후벽+측벽, 살짝 proud 어두운 띠; 정면 문 제외)
  b.box(cx, gy + 0.42, bz - fSign * 0.03, w - 0.4, 0.84, 0.06, MAT.concreteDark, false);
  b.box(cx - w / 2 - 0.03, gy + 0.42, cz, 0.06, 0.84, d - 0.4, MAT.concreteDark, false);
  b.box(cx + w / 2 + 0.03, gy + 0.42, cz, 0.06, 0.84, d - 0.4, MAT.concreteDark, false);
  // 녹물 스트릭 (#216) — 측벽 세로 녹자국(파라펫 아래에서 흘러내림)
  const streakN = Math.max(2, Math.round(d / 5));
  for (let i = 0; i < streakN; i++) {
    const sz = cz - d / 2 + d * (i + 0.5) / streakN + (i % 2 ? 0.6 : -0.5);
    for (const sx of [-1, 1]) b.box(cx + sx * (w / 2 + 0.02), gy + plinth + (h - plinth) * 0.5, sz, 0.06, (h - plinth) * 0.82, 0.13, MAT.rust, false);
  }
  { const wy = gy + h - 1.4, wh = 1.5; b.box(cx, wy, bz - fSign * 0.16, w - 1.6, wh, 0.1, MAT.glass, false); for (let mx = -w / 2 + 1.4; mx <= w / 2 - 1.4; mx += 2.0) b.box(cx + mx, wy, bz - fSign * 0.2, 0.12, wh + 0.1, 0.12, baseMat, false); }
  b.box(cx, gy + h + 0.06, cz, w, 0.12, d, MAT.roof, false); // 지붕
  const pH = 0.55, po = 0.1;                                  // 파라펫
  b.box(cx, gy + h + pH / 2, cz + d / 2 + po, w + 0.4, pH, 0.3, baseMat, false);
  b.box(cx, gy + h + pH / 2, cz - d / 2 - po, w + 0.4, pH, 0.3, baseMat, false);
  b.box(cx - w / 2 - po, gy + h + pH / 2, cz, 0.3, pH, d + 0.4, baseMat, false);
  b.box(cx + w / 2 + po, gy + h + pH / 2, cz, 0.3, pH, d + 0.4, baseMat, false);
  b.box(cx - w * 0.22, gy + h + 0.5, cz + d * 0.12, 1.6, 0.9, 1.2, MAT.metalGreen, false); // 옥상 그리블
  b.box(cx + w * 0.18, gy + h + 0.4, cz - d * 0.18, 1.2, 0.7, 1.0, MAT.barrel, false);
  b.cyl(cx + w * 0.30, gy + h + 0.9, cz + d * 0.28, 0.28, 0.28, 1.8, MAT.barrel, 10, false);
  if (open) { // 내부 루팅공간: 마감 바닥 + 지지기둥(엄폐) + 후면 선반랙
    b.box(cx, gy + 0.1, cz, w - t * 2, 0.14, d - t * 2, MAT.concreteDark, false); // 실내 바닥
    const colX = w * 0.24;
    for (const sx of [-1, 1]) b.box(cx + sx * colX, gy + (h - 0.2) / 2 + 0.2, cz, 0.5, h - 0.2, 0.5, MAT.steel); // 지지기둥(충돌)
    const rz = bz + fSign * (d * 0.30); // 후면 선반랙
    b.box(cx, gy + 1.0, rz, w * 0.6, 0.14, 1.0, MAT.rust, true);   // 하단 선반(충돌=엄폐)
    b.box(cx, gy + 2.1, rz, w * 0.6, 0.14, 1.0, MAT.rust, false);  // 상단 선반
    for (const px of [-w * 0.27, 0, w * 0.27]) for (const pz of [-0.44, 0.44]) b.box(cx + px, gy + 1.35, rz + pz, 0.1, 2.7, 0.1, MAT.rust, false); // 선반 기둥
  }
  b.flush();
  if (open) { const lamp = new THREE.PointLight(0xffd9a8, 14, Math.max(w, d) * 1.15, 2); lamp.position.set(cx, gy + h - 0.7, cz); scene.add(lamp); }
}

// ── 공장동 (#213): 콘크리트/벽돌 다층 + 층별 리본창 + 코너기둥 + 파라펫 + 옥상 계단탑/설비/굴뚝. ──
function buildFactory(cx, cz, w, d, h, { mat = 'concrete', floors = 3 } = {}) {
  const b = batchBuilder();
  const t = 0.4, gy = terrainH(cx, cz), plinth = 1.0;
  notePlacement('factory', cx, cz, w / 2, d / 2, gy, gy + h); // 겹침 진단 (#215)
  b.box(cx, gy + 0.06, cz, w + 1.0, 0.12, d + 1.0, MAT.concreteDark, false);
  const wall = (ax, x, z, len) => {
    if (ax === 'x') { b.box(x, gy + plinth / 2, z, len, plinth, t, mat); b.box(x, gy + plinth + (h - plinth) / 2, z, len, h - plinth, t, mat); }
    else { b.box(x, gy + plinth / 2, z, t, plinth, len, mat); b.box(x, gy + plinth + (h - plinth) / 2, z, t, h - plinth, len, mat); }
  };
  wall('x', cx, cz - d / 2, w); wall('x', cx, cz + d / 2, w);
  wall('z', cx - w / 2, cz, d); wall('z', cx + w / 2, cz, d);
  const fh = (h - plinth) / floors; // 층별 리본창 (유리 밴드) — 시각 오버레이
  for (let f = 0; f < floors; f++) {
    const wy = gy + plinth + fh * (f + 0.55), wh = Math.min(1.4, fh * 0.55);
    for (const s of [-1, 1]) b.box(cx, wy, cz + s * (d / 2 + 0.16), w - 1.8, wh, 0.1, MAT.glass, false);
    for (const s of [-1, 1]) b.box(cx + s * (w / 2 + 0.16), wy, cz, 0.1, wh, d - 1.8, MAT.glass, false);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(cx + sx * (w / 2), gy + h / 2, cz + sz * (d / 2), 0.7, h, 0.7, mat, false); // 코너기둥
  const pH = 0.6, po = 0.1; // 파라펫
  b.box(cx, gy + h + pH / 2, cz + d / 2 + po, w + 0.5, pH, 0.32, mat, false);
  b.box(cx, gy + h + pH / 2, cz - d / 2 - po, w + 0.5, pH, 0.32, mat, false);
  b.box(cx - w / 2 - po, gy + h + pH / 2, cz, 0.32, pH, d + 0.5, mat, false);
  b.box(cx + w / 2 + po, gy + h + pH / 2, cz, 0.32, pH, d + 0.5, mat, false);
  b.box(cx, gy + h + 0.06, cz, w, 0.12, d, MAT.roof, false); // 지붕
  b.box(cx - w * 0.2, gy + h + 1.4, cz - d * 0.15, w * 0.3, 2.8, d * 0.3, mat, false);      // 계단탑
  b.box(cx + w * 0.2, gy + h + 0.6, cz + d * 0.2, 2.0, 1.2, 1.6, MAT.metalGreen, false);    // 옥상 설비
  b.cyl(cx + w * 0.32, gy + h + 3.0, cz - d * 0.28, 0.5, 0.6, 6.0, MAT.rust, 12, false);    // 굴뚝 스택
  b.flush();
}

// ── 사일로 군 (#213): 금속 원통 2~3기 + 원뿔 지붕 + 링밴드 + 콘크리트 베이스 + 연결브릿지/배출파이프. ──
function buildSilo(cx, cz, count = 3, { r = 2.6, h = 12 } = {}) {
  const b = batchBuilder();
  const gy = terrainH(cx, cz);
  const gap = r * 2.3, x0 = cx - gap * (count - 1) / 2;
  notePlacement('silo', cx, cz, gap * (count - 1) / 2 + r, r, gy, gy + h); // 겹침 진단 (#215)
  for (let i = 0; i < count; i++) {
    const sx = x0 + gap * i, hh = h * (i % 2 ? 1.0 : 0.82); // 높이 변주
    b.box(sx, gy + 0.2, cz, r * 2.4, 0.4, r * 2.4, MAT.concreteDark, false);       // 베이스 패드
    b.cyl(sx, gy + hh / 2 + 0.4, cz, r, r, hh, MAT.steel, 16, true);               // 원통(충돌)
    b.cone(sx, gy + hh + 0.4 + r * 0.5, cz, r + 0.12, r, MAT.steel, 16);           // 원뿔 지붕
    for (let ry = 0.28; ry < 0.85; ry += 0.28) b.cyl(sx, gy + hh * ry + 0.4, cz, r + 0.06, r + 0.06, 0.12, MAT.rust, 16, false); // 링밴드
  }
  if (count > 1) b.box(cx, gy + h * 0.88, cz, gap * (count - 1) + r, 0.5, 1.2, MAT.rust, false);   // 상단 브릿지
  b.box(cx, gy + 1.2, cz + r + 0.5, gap * (count - 1) + r, 0.3, 0.3, MAT.steel, false);            // 하단 배출파이프
  b.flush();
}

function buildIndustrialMap() {
  const irnd = mulberry32(2370); // 시드 고정 (#325): 굽기 재생과 콜라이더·풀 배치가 일치하도록 (전엔 로드마다 소품 위치가 바뀜)
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
  buildWarehouse(30, 32, 22, 15, 7.5, { front: 'north', open: true }); // 히어로 절차 창고 (#212 Phase 2, buildingA 대체)
  buildFactory(44, -32, 16, 13, 9, { mat: 'concrete', floors: 3 }); // #213 (buildingE)
  buildWarehouse(-48, 42, 18, 13, 7, { front: 'south', open: true, wall: 'corrugatedRust' }); // (buildingH)
  buildSilo(8, 55, 3, { r: 2.6, h: 12 });                           // (buildingM)
  buildFactory(-62, -56, 14, 12, 8, { mat: 'brick', floors: 2 });   // (buildingQ)
  weatherModel(placeModel('tank', 58, 62, { height: 7 }));       // #216 리컬러
  weatherModel(placeModel('chimney', -44, -28, { height: 14 })); // #216 리컬러

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
  for (const [x, z] of drums) placeModel('barrel', x, z, { height: 1.1, rotY: irnd() * Math.PI * 2 });

  // 나무 (리얼 카드 트리 #280 — 산업지대는 침엽/고사목 위주로 황량하게, 리얼 바위와 톤 통일)
  { const trees = [[-70, -60], [-75, 20], [70, 60], [65, -60], [-20, 70], [50, 70], [-70, 70], [75, -20], [-40, -70], [20, -68], [-5, -55], [68, 30]], fb = forestBatch();
    trees.forEach(([x, z], i) => placeCardTree(fb, i % 4 === 0 ? 'dead' : i % 4 === 3 ? 'canopy_broad_b' : 'pine', x, z, 6 + ((i * 37) % 10) * 0.4, 0.35, 500 + i));
    fb.flush(); }

  // 바위 (Poly Haven photoscan 리얼 — 히어로 대형 + 중/소형 변주로 실루엣) #211
  const rocks = [
    ['rockRealA', -15, 62, 2.8], ['rockRealB', 55, -68, 1.7],
    ['rockRealC', -72, -15, 1.3], ['rockRealB', 35, 12, 1.9],
  ];
  for (const [key, x, z, h] of rocks) placeModel(key, x, z, { height: h + irnd() * 0.5, rotY: irnd() * Math.PI * 2 });

  // 나무상자 엄폐물 (Kenney survival-kit / blaster-kit)
  const boxes = [[3, -30], [-13, -6], [22, 5], [48, 30], [-52, -12], [10, 48], [-38, 22], [58, -25]];
  for (const [x, z] of boxes) {
    if (irnd() < 0.5) placeModel('box', x, z, { height: 1.0, rotY: irnd() * Math.PI * 2 });
    else placeModel('crateWide', x, z, { height: 1.0, rotY: Math.floor(irnd() * 4) * Math.PI / 2 });
  }

  // 추가 산업 건물 (city-kit-industrial 미사용분)
  buildWarehouse(-10, -66, 16, 12, 6.5, { front: 'north', open: true, wall: 'corrugatedPale' }); // #213 (buildingB)
  buildSilo(66, -12, 2, { r: 3.0, h: 13 });                  // (buildingF)
  buildFactory(-34, 64, 18, 14, 10, { mat: 'concreteStain', floors: 3 }); // (buildingG)
  buildWarehouse(-70, 34, 15, 20, 8, { front: 'south', open: true, wall: 'corrugatedGrn' }); // (buildingN, 세로 배치)
  weatherModel(placeModel('chimneyMed', 6, -56, { height: 10 })); // #215 이설 · #216 리컬러

  // 폐차 (Kenney car-kit — 어둡게 칠해 방치된 느낌)
  const wrecks = [
    ['carCovered', 2, 26, 0.5], ['carTruck', 38, -14, 2.2], ['carCovered', -22, -30, -0.7],
    ['carCovered', 26, 44, 1.3], ['carDelivery', -46, 52, 2.8], ['carCovered', 50, 4, -2.4],
  ];
  for (const [key, x, z, rotY] of wrecks) {
    const cov = key === 'carCovered';
    const m = placeModel(key, x, z, { height: key === 'carTruck' || key === 'carDelivery' ? 2.4 : (cov ? 1.5 : 1.6), rotY });
    if (!cov) m.traverse((o) => { // 방치차 어둡게 (covered_car 는 photoscan 이라 원톤 유지)
      if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.62); o.material.roughness = 0.92; }
    });
  }
  const tires = [[4.6, 24.2], [36, -11.5], [-20, -27.5], [27.8, 46.4], [14, -3]];
  for (const [x, z] of tires) placeModel('carTire', x, z, { height: 0.62, rotY: irnd() * Math.PI * 2, collide: false });

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

  // 공장/창고 옆 연료 탱크 / 소형 배기 굴뚝 — 건물 밖으로 배치. **스캐터보다 먼저** 놓아 스캐터가 회피 (#215)
  weatherModel(placeModel('tank', 55, -22, { height: 2.6, rotY: 0.4 }));   // #216 리컬러
  weatherModel(placeModel('tank', -22, -58, { height: 2.4, rotY: 1.9 }));
  weatherModel(placeModel('tank', -70, -45, { height: 2.8, rotY: 2.6 }));
  weatherModel(placeModel('chimneySmall', 55, -40, { height: 3.2 }));
  weatherModel(placeModel('chimneySmall', 2, -71, { height: 3.0 }));
  weatherModel(placeModel('chimneySmall', 62, -8, { height: 3.4 }));
  // 고철 패널 엄폐물
  const panels = [[18, -18, 0.3], [-26, 12, 1.8], [44, 22, -0.5], [-8, -44, 2.1]];
  for (const [x, z, r] of panels) placeModel('metalPanel', x, z, { height: 1.7, rotY: r });
  // 건물 주변 디테일 — 소품 스캐터(맨 뒤). clearR = 건물 풋프린트 밖 여유 반경, isPointOpen 1.3 으로 기존 프롭 회피 (#215)
  const PROPS = ['barrel', 'box', 'crateWide'];
  const scatterProps = (x, z, clearR, n) => {
    for (let i = 0; i < n; i++) {
      const a = irnd() * Math.PI * 2;
      const px = x + Math.cos(a) * (clearR + irnd() * 3.5);
      const pz = z + Math.sin(a) * (clearR + irnd() * 3.5);
      if (!isPointOpen(px, pz, 1.3)) continue;
      placeModel(PROPS[Math.floor(irnd() * PROPS.length)], px, pz,
        { height: 0.9 + irnd() * 0.3, rotY: irnd() * Math.PI * 2 });
    }
  };
  scatterProps(30, 32, 14, 4);   // warehouse A (22x15)
  scatterProps(44, -32, 12, 3);  // factory E (16x13)
  scatterProps(8, 55, 11, 3);    // silo M
  scatterProps(-62, -56, 11, 3); // factory Q (14x12)
  scatterProps(-10, -66, 12, 3); // warehouse B (16x12)
  scatterProps(-34, 64, 13, 3);  // factory G (18x14)
  scatterProps(-70, 34, 14, 2);  // warehouse N (15x20)

  // 풀 스캐터 (시야/이동 차단 없음) — 풀 카드 다발(grass_card 교차 카드 2장, 청크 병합). Kenney 스타일라이즈드 풀 대체 (#289), 시드 고정
  { const rg = mulberry32(289), fb = forestBatch(), gm = canopyMat('grass_card'); let n = 0;
    for (let i = 0; i < 120; i++) {
      const x = (rg() * 2 - 1) * (WORLD_HALF - 8), z = (rg() * 2 - 1) * (WORLD_HALF - 8);
      if (!isPointOpen(x, z, 1.5)) continue;
      const w = 0.9 + rg() * 1.1, h = w * 0.5, c = 0.5 + rg() * 0.3, yaw = rg() * Math.PI, gy = terrainH(x, z);
      for (let k = 0; k < 2; k++) fb.put(x, z, 'grass_card', gm, cardGeo(new THREE.Vector3(x, gy + h / 2 - 0.03, z), w, h, yaw + k * Math.PI / 2, 0, [c * 0.95, c, c * 0.8], rg() < 0.5));
      n++;
    }
    console.log(`[industrial] grass cards ${n}, merged ${fb.flush()}`); } // 0건이어도 남긴다

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
  [-28, -18], [-34, -14], [-22, -21],       // 중앙 창고 내부(진입가능)
  [30, 32], [33, 30], [-48, 42], [-45, 44], // 창고 A·H 내부(셔터 오픈, #214)
  [-10, -66], [-13, -64], [-70, 34], [-70, 38], // 창고 B·N 내부(셔터 오픈)
  [40, -24], [2, 49],                       // 공장 E·사일로 M 옆 야적(솔리드 건물이라 밖으로 이설)
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
  velocity: 700, lead: 0.6, // 발사체 탄속 m/s · 이동 리드 비율 (#316)
};

const HITBOX_MAT = new THREE.MeshBasicMaterial();
const CHAR_HEIGHT = 1.75;
// ── 플레이어 히트박스 (#316): 적 발사체 레이캐스트 전용(비표시). 적과 같은 캡슐(0.22, 1.0 @0.85) + 머리 구(0.16 @1.60) — 플레이어는 앉기 없음.
// 위치·요는 updateProjectiles 에서 레이 검사 직전에 player.pos/yaw 로 맞춘다(자동화 탭처럼 프레임이 없어도 정확).
const playerHit = { group: new THREE.Group() };
playerHit.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 8), HITBOX_MAT); playerHit.body.position.y = 0.85; playerHit.body.visible = false;
playerHit.head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), HITBOX_MAT); playerHit.head.position.y = 1.60; playerHit.head.visible = false;
playerHit.body.userData = { playerHit: true, part: 'body' }; playerHit.head.userData = { playerHit: true, part: 'head' };
playerHit.group.add(playerHit.body, playerHit.head); scene.add(playerHit.group);
function syncPlayerHit() { playerHit.group.position.copy(player.pos); playerHit.group.rotation.y = player.yaw || 0; playerHit.group.updateMatrixWorld(true); }

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
    if (isPointOpen(x, z, 0.8) && terrainH(x, z) > -0.3) return new THREE.Vector3(x, 0, z); // 개천 바닥 제외 (#319)
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
  initEnemyParts(e); // 부위 풀 (#313)
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
  initEnemyParts(e); // 부위 풀 ×3 (#313)
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
  if (e.bleed > 0 && state.phase === 'raid') { // 복부 파괴 출혈 (#313) — 치료 없이 계속 새어 나간다
    e.hp -= e.bleed * dt;
    if (e.hp <= 0) { killEnemy(e); return; }
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
            e.reloadT = (e.actReload ? e.actReload.getClip().duration : 1.7) * (enemyArmsOut(e) ? 1.4 : 1); // 팔 파괴 (#313)
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
    if (e.actLimp && (e.hp < (e.maxHp || ENEMY.hp) * 0.35 || enemyLegsOut(e)) && e.rollT <= 0) speed = Math.min(speed, 0.62); // 다리 파괴도 절뚝임 (#313)
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
    const wounded = e.actLimp && (e.hp < (e.maxHp || ENEMY.hp) * 0.35 || enemyLegsOut(e)) && e.rollT <= 0;
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

// ── 적 부위 체력 (#313): 플레이어 부위 시스템(#304)의 대칭. 총 HP(e.hp) 사망 모델은 유지하고 부위 풀을 따로 깎는다.
// 머리/흉부 풀 0 = 즉사(총 HP 와 무관). 다리 0 = 절뚝임(질주·회피 불가), 팔 0 = 명중률 ×0.5·재장전 ×1.4, 복부 0 = 출혈 1.5 HP/s.
// 팔·다리 피격은 총 HP 를 0.65 배만 깎아 "무력화는 되지만 처치는 안 되는" 타르코프식 사격 선택을 만든다.
const ENEMY_PARTS = {
  head: { max: 35, mul: 1.0, name: '머리' }, thorax: { max: 80, mul: 1.0, name: '흉부' }, stomach: { max: 55, mul: 0.9, name: '복부' },
  arms: { max: 40, mul: 0.65, name: '팔' }, legs: { max: 45, mul: 0.65, name: '다리' },
};
const ENEMY_BLEED = 1.5; // 복부 파괴 출혈 HP/s
function initEnemyParts(e) {
  const k = (e.maxHp || ENEMY.hp) / ENEMY.hp; // 보스(300)는 풀 ×3
  e.parts = {}; for (const key of Object.keys(ENEMY_PARTS)) e.parts[key] = ENEMY_PARTS[key].max * k;
  e.bleed = 0; e.lastHitPart = null;
}
function enemyLegsOut(e) { return !!(e.parts && e.parts.legs <= 0); }
function enemyArmsOut(e) { return !!(e.parts && e.parts.arms <= 0); }
// 피격점 → 부위. 머리 히트박스는 그대로 머리, 몸통 캡슐은 발 기준 높이(앉아쏴는 서 있는 자세로 정규화)와 측면 오프셋으로 판정.
// 서 있을 때 캡슐 y 0.13~1.57: 다리 <0.80 · 복부 0.80~1.05 · 흉부 >1.05, 팔 = 0.95~1.45 높이에서 |x| > 0.14(캡슐 반지름 0.22 의 바깥 테).
const _ehp = new THREE.Vector3();
function enemyHitPart(e, hitboxPart, point) {
  if (hitboxPart === 'head') return 'head';
  if (!point) return 'thorax';
  const lp = e.group.worldToLocal(_ehp.copy(point));
  const y = e.crouched ? (lp.y - 0.60) / 0.68 + 0.85 : lp.y;
  e.lastHitLocal = [+lp.x.toFixed(3), +y.toFixed(3)]; // QA
  return partFromLocal(lp.x, y);
}
function partFromLocal(x, y) { // 캡슐 로컬(발 기준 높이 y, 측면 x) → 부위. 적·플레이어 공용 (#313/#316)
  if (y < 0.80) return 'legs';
  if (Math.abs(x) > 0.14 && y >= 0.95 && y <= 1.45) return 'arms';
  return y < 1.05 ? 'stomach' : 'thorax';
}
function playerHitPart(hitboxPart, point) { // 적 탄 피격점 → 플레이어 부위 (#316): damagePlayer 의 랜덤 배정 대신 실제 피격점
  if (hitboxPart === 'head') return 'head';
  const lp = playerHit.group.worldToLocal(_ehp.copy(point));
  player.lastHitLocal = [+lp.x.toFixed(3), +lp.y.toFixed(3)]; // QA
  return partFromLocal(lp.x, lp.y);
}
// 부위 피해 적용 — 반환: 이번 피격으로 새로 파괴된 부위(없으면 null). 사망 처리는 호출측(e.hp <= 0 검사).
function damageEnemyPart(e, part, dmg) {
  if (!e.parts) initEnemyParts(e);
  const P = ENEMY_PARTS[part] || ENEMY_PARTS.thorax;
  const before = e.parts[part];
  e.parts[part] = Math.max(0, before - dmg);
  e.hp -= dmg * P.mul;
  e.lastHitPart = part;
  const blacked = before > 0 && e.parts[part] <= 0;
  if (blacked) {
    if (part === 'head' || part === 'thorax') e.hp = Math.min(e.hp, 0); // 치명 부위 파괴 = 즉사
    else if (part === 'stomach') { e.bleed = ENEMY_BLEED; addFeed('적 복부 관통 — 출혈'); }
    else if (part === 'legs') addFeed('적 다리 부상 — 절뚝임');
    else if (part === 'arms') addFeed('적 팔 부상 — 조준 흔들림');
  }
  return blacked ? part : null;
}
function enemyAccuracy(e, dist) {
  const moving = player.vel.lengthSq() > 4;
  let acc = 0.62 - dist * 0.011 - (moving ? 0.14 : 0) - (player.sprinting ? 0.08 : 0) + (e.crouched ? 0.06 : 0) + (e.boss ? 0.1 : 0);
  acc = THREE.MathUtils.clamp(acc, 0.06, 0.8);
  if (enemyArmsOut(e)) acc *= 0.5; // 팔 파괴 (#313)
  return acc;
}

function enemyShoot(e, dist) {
  e.flash.intensity = 50;
  sfx.enemyShoot(dist);

  // 트레이서: 총구 → 플레이어 근처
  const muzzleH = e.crouched ? 0.85 : 1.3;
  const muzzle = new THREE.Vector3(0.28, muzzleH, 0.95).applyEuler(new THREE.Euler(0, e.group.rotation.y, 0)).add(e.pos);
  // 발사체 (#316): 명중 롤(enemyAccuracy)은 그대로 두고 "어디를 겨누나"로 바꾼다 — 명중 롤이면 몸 안의 점(15% 머리), 빗나감 롤이면
  // 몸 바깥 링(0.5~1.6 m). 실제 명중은 탄이 물리적으로 판정(엄폐가 막고, 비행 중 이동하면 빗나감). 이동 리드 = 비행시간 × 속도 × ENEMY.lead.
  const acc = enemyAccuracy(e, dist);
  const hit = Math.random() < acc;
  const head = hit && Math.random() < 0.15;
  const aim = new THREE.Vector3(player.pos.x, player.pos.y + (head ? 1.6 : 0.5 + Math.random() * 0.9), player.pos.z);
  const tof = muzzle.distanceTo(aim) / ENEMY.velocity;
  aim.x += player.vel.x * tof * ENEMY.lead; aim.z += player.vel.z * tof * ENEMY.lead;
  const fwd = aim.clone().sub(muzzle); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // 사선에 수직인 측면 축
  if (hit) aim.addScaledVector(right, (Math.random() - 0.5) * 0.4); // 몸통 폭 안 산포(±0.2, 캡슐 r 0.22) → 팔 판정 ~15%
  else { // 빗나감: 항상 측면으로 0.45~1.45 m 비켜 겨눔(수직만 비끼면 몸에 맞아 명중률이 롤보다 올라간다 — v0.74 검증에서 발견)
    aim.addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random()));
    aim.y += (Math.random() - 0.4) * 1.0;
    if (aim.y < player.pos.y + 0.05) aim.y = player.pos.y + 0.05; // 발밑 지면에 맞게(땅 속으로 사라지지 않게)
  }
  const dir = aim.sub(muzzle).normalize();
  const dmg = (ENEMY.damageMin + Math.random() * (ENEMY.damageMax - ENEMY.damageMin)) * (e.boss ? 1.5 : 1);
  return spawnEnemyProjectile(muzzle, dir, dmg, e, hit);
}
let lastEnemyShot = null; // QA
function spawnEnemyProjectile(muzzle, dir, dmg, e, rolled) {
  const pr = { pos: muzzle.clone(), vel: dir.clone().multiplyScalar(ENEMY.velocity), t: 0, dist: 0, range: ENEMY.fireRange * 3, dmgBody: dmg, dmgHead: dmg,
    line: null, enemy: true, from: e, rolled, result: null };
  const geo = new THREE.BufferGeometry().setFromPoints([muzzle, muzzle]); // 라이브 트레이서(총구→현재 위치), 소멸 후 0.07s 페이드
  pr.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffaa66, transparent: true, opacity: 0.85 })); scene.add(pr.line);
  projectiles.push(pr); lastEnemyShot = pr;
  return pr;
}

const ARMOR_MAX = 80;
// ── 부위별 체력·부상 (#304): 머리/흉부/복부/팔/다리. 총 체력(player.hp) 모델은 유지하되 부위 상태가 따로 깎인다(팔·다리는 취약 ×2).
// 머리·흉부 0 = 사망. 팔·다리·복부 0 = 부상 효과(이동/조준/재장전/지구력). 출혈은 붕대, 부상 부위 회복은 구급킷.
const BODY_PARTS = {
  head: { max: 35, mul: 1.0, name: '머리' }, thorax: { max: 80, mul: 1.0, name: '흉부' }, stomach: { max: 55, mul: 1.6, name: '복부' },
  arms: { max: 45, mul: 2.0, name: '팔' }, legs: { max: 50, mul: 2.0, name: '다리' },
};
const PART_WEIGHTS = [['thorax', 0.33], ['stomach', 0.17], ['arms', 0.25], ['legs', 0.25]]; // 비헤드샷 피격 부위 가중치
function resetBodyParts() { player.parts = {}; for (const k of Object.keys(BODY_PARTS)) player.parts[k] = BODY_PARTS[k].max; player.bleeds = []; player.painkiller = 0; bodyDirty = true; }
function randomPart() { let r = Math.random(); for (const [k, w] of PART_WEIGHTS) { if ((r -= w) <= 0) return k; } return 'thorax'; }
function partFrac(k) { return player.parts ? player.parts[k] / BODY_PARTS[k].max : 1; }
function painFree() { return (player.painkiller || 0) > 0; } // 진통제 효과 중 (#307)
function legsK() { if (painFree()) return 1; const f = partFrac('legs'); return f <= 0 ? 0.55 : f < 0.5 ? 0.85 : 1; }         // 이동 속도 배수
function armsSpread() { if (painFree()) return 0; const f = partFrac('arms'); return f <= 0 ? 0.012 : f < 0.5 ? 0.005 : 0; }  // 탄퍼짐 가산
function limbBlacked() { return !!player.parts && ['stomach', 'arms', 'legs'].some((k) => player.parts[k] <= 0); }
const PART_EFFECT = { legs: '이동 저하·질주/점프 불가', arms: '조준 흔들림·재장전 지연', stomach: '지구력 회복 저하' };
function damagePlayer(dmg, headshot = false, part = null) {
  const k = headshot ? 'head' : (part || randomPart()); // 부위 먼저 — 방어구는 부위별 (#307)
  if (headshot) {
    if (player.helmet) {
      player.helmet = false;
      addFeed('헬멧이 헤드샷을 막았습니다 (파손)');
      sfx.hitmarker();
      return;
    }
    dmg *= 1.8;
  } else if (player.armorDur > 0 && (k === 'thorax' || k === 'stomach')) { // 방탄복은 흉부/복부만 경감, 팔·다리는 그대로 (#307)
    player.armorDur = Math.max(0, player.armorDur - dmg);
    dmg *= 0.55; // 45% 경감
    if (player.armorDur <= 0) addFeed('방탄복 파손');
  }
  let cause = '스캐브에게 사살당했습니다.';
  bodyDirty = true;
  if (player.parts) { // 부위 배정·부상·출혈 (#304)
    const was = player.parts[k];
    player.parts[k] = Math.max(0, was - dmg * BODY_PARTS[k].mul);
    if (was > 0 && player.parts[k] <= 0) {
      if (k === 'head' || k === 'thorax') { player.hp = 0; cause = k === 'head' ? '헤드샷으로 사망했습니다.' : '흉부 치명상으로 사망했습니다.'; }
      else addFeed(`${BODY_PARTS[k].name} 부상 — ${PART_EFFECT[k]}`);
    }
    if (dmg >= 9 && player.hp > 0 && !player.bleeds.includes(k) && player.bleeds.length < 2 && Math.random() < 0.4) { player.bleeds.push(k); addFeed(`출혈(${BODY_PARTS[k].name}) — 붕대로 지혈하세요`); }
  }
  player.hp -= dmg;
  sfx.playerHit();
  dom.damageVignette.style.opacity = '1';
  setTimeout(() => { dom.damageVignette.style.opacity = '0'; }, 120);
  if (player.hp <= 0) {
    player.hp = 0;
    endRaid('death', cause);
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
  if (e.state === 'combat' && e.rollT <= 0 && !enemyLegsOut(e) && Math.random() < 0.3 && // 다리 파괴 시 회피 불가 (#313)
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
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, terrainH(pos.x, pos.z) + 0.05, pos.z); scene.add(ring);
  const light = new THREE.PointLight(color, 30, 18, 2);
  light.position.set(pos.x, 3, pos.z); scene.add(light);
  return { beam, ring, light };
}
function setupExtractions(spawnPos) {
  if (state.range) { // 연습장: 퇴장 지점 1곳(짧은 유지), 유료 탈출 없음 (#209)
    for (const cand of EXTRACT_CANDIDATES) {
      extractions.push({ name: cand.name, pos: cand.pos.clone(), ...makeExtractBeacon(cand.pos, 0x51ff7a), progress: 0, hold: 1.5 });
    }
    return;
  }
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
  if (player.painkiller > 0) { player.painkiller -= dt; if (player.painkiller <= 0) { player.painkiller = 0; bodyDirty = true; addFeed('진통제 효과 종료'); } } // (#307)
  if (player.bleeds && player.bleeds.length) { // 출혈 (#304): 부위당 0.8 HP/s
    player.hp -= 0.8 * player.bleeds.length * dt;
    if (player.hp <= 0) { player.hp = 0; endRaid('death', '출혈로 사망했습니다.'); return; }
  }
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
  const cw = carryWeight(), wt = weightTier(cw); // 무게 (#310)
  if (wt !== player.wTier) { if (player.wTier !== undefined) addFeed(wt === 2 ? `심한 과중량 ${cw.toFixed(1)} kg — 질주 불가·크게 감속` : wt === 1 ? `과중량 ${cw.toFixed(1)} kg — 감속·지구력 소모↑` : '무게 정상'); player.wTier = wt; }
  const wantSprint = ((keys['ShiftLeft'] && keys['KeyW']) || touch.sprint) && hasInput && !player.aiming && !gun.triggerDown && wt < 2;
  if (wantSprint && player.stamina > 1 && (partFrac('legs') > 0 || painFree())) { // 다리 부상 시 질주 불가 (#304), 진통제 중엔 가능 (#307)
    player.sprinting = true;
    player.stamina = Math.max(0, player.stamina - 17 * dt * (wt >= 1 ? 1.4 : 1)); // 과중량 지구력 소모↑ (#310)
    if (player.stamina <= 0) player.sprinting = false;
  } else {
    player.sprinting = false;
    player.stamina = Math.min(100, player.stamina + 13 * dt * (partFrac('stomach') <= 0 && !painFree() ? 0.4 : 1)); // 복부 부상 시 회복 저하
  }
  const speed = PLAYER.walkSpeed * (player.sprinting ? PLAYER.sprintMult : 1) * (player.aiming ? 0.55 : 1) * legsK() * (wt === 2 ? 0.65 : wt === 1 ? 0.85 : 1); // 다리 부상 (#304)·과중량 (#310) 감속

  // --- 수평 가속 ---
  const targetVx = wish.x * speed, targetVz = wish.z * speed;
  const a = player.grounded ? PLAYER.accel : PLAYER.accel * 0.25;
  player.vel.x += THREE.MathUtils.clamp(targetVx - player.vel.x, -a * dt, a * dt);
  player.vel.z += THREE.MathUtils.clamp(targetVz - player.vel.z, -a * dt, a * dt);

  // --- 중력 / 점프 ---
  player.vel.y -= PLAYER.gravity * dt;
  if ((keys['Space'] || touch.jump) && player.grounded && player.stamina > 10 && (partFrac('legs') > 0 || painFree())) { // 다리 부상 시 점프 불가 (#304)
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
  if (state.range) updateRangeHud(); // 무기별 통계 패널 전환 (#295)
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
    gun.spread = base + moveS + gun.bloom * 0.02 + armsSpread(); // 팔 부상 가산 (#304)
    gun.bloom = Math.max(0, gun.bloom - dt * 2.4); // 연사 멈추면 탄퍼짐 회복
    if (state.range) gun.reserve = Math.max(gun.reserve, 900); // 연습장 무한 탄약 유지 (#209)
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
  gun.reloading = GUN.reloadTime * (partFrac('arms') <= 0 && !painFree() ? 1.4 : 1); // 팔 부상 시 지연 (#304)
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

  if (state.range) { // 연습장 발사 카운트(산탄은 1발) — 빗나가도 즉시 갱신 (#292) + 반동 궤적 (#295) + 연사 버스트 기록 (#298)
    const now = performance.now(); rs().shots++; updateRangeHud();
    recoilTrace.push({ yaw: player.recoilYaw, pitch: player.recoilPitch, t: now }); if (recoilTrace.length > 40) recoilTrace.shift();
    if (now - recoilPat.lastT > 500) { recoilPat.burst = []; recoilPat.saved = false; }
    recoilPat.burst.push([player.recoilYaw, player.recoilPitch]); recoilPat.lastT = now;
  }
  for (let p = 0; p < GUN.pellets; p++) { // 탄퍼짐 적용 방향으로 발사체 생성 (#301) — 명중은 비행 후 updateProjectiles 에서
    const dir = aimPoint.clone().sub(muzzle).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    spawnProjectile(muzzle, dir, tracerStart);
  }
}

function showHitmarker() {
  dom.hitmarker.style.opacity = '1';
  setTimeout(() => { dom.hitmarker.style.opacity = '0'; }, 80);
}

// ============================================================
// 트레이서 / 이펙트
// ============================================================
// ── 탄도 (#301): 플레이어 탄은 즉시 레이가 아니라 발사체 — 무기별 탄속(velocity m/s) + 중력 낙차. 매 프레임 이동 구간을 레이로 검사(터널링 없음),
// 사거리(range)·3초·지면 아래에서 소멸. 명중 처리는 resolveBulletHit(적/물리통/연습장 표적/탄흔) 로 분리. 적 사격은 기존 즉시 판정 유지.
let projectiles = [];
const BALLISTICS = { g: 9.8, maxTime: 3.0 };
function spawnProjectile(muzzle, dir, tracerStart) {
  const pr = { pos: muzzle.clone(), vel: dir.clone().multiplyScalar(GUN.velocity || 700), t: 0, dist: 0, range: GUN.range, dmgBody: GUN.damageBody, dmgHead: GUN.damageHead, line: null };
  if (currentAtt.includes('scope') || GUN.key === 'sniper') { // 라이브 트레이서(스코프 무기만 #183): 시작점→현재 위치, 소멸 후 0.07s 페이드
    const geo = new THREE.BufferGeometry().setFromPoints([tracerStart, muzzle]);
    pr.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.85 })); scene.add(pr.line);
  }
  projectiles.push(pr);
}
const _pDir = new THREE.Vector3(), _pNext = new THREE.Vector3();
function updateProjectiles(dt) {
  if (!projectiles.length) return;
  const targets = [...obstacleMeshes, ...propMeshes];
  for (const e of enemies) if (!e.dead) targets.push(e.body, e.head);
  let targetsE = null; // 적 탄: 장애물+소품+플레이어 히트박스 (아군 통과) (#316)
  let anyHit = false;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i]; if (!pr) continue; // 피격 사망 → clearRaidObjects 가 배열을 교체한 뒤의 인덱스
    const v0y = pr.vel.y;
    pr.vel.y -= BALLISTICS.g * dt;
    _pNext.copy(pr.pos).addScaledVector(pr.vel, dt); _pNext.y += (v0y - pr.vel.y) * 0.5 * dt; // 정확 적분: v0·dt − ½g·dt²
    _pDir.subVectors(_pNext, pr.pos); const seg = _pDir.length(); _pDir.normalize();
    _shootRay.set(pr.pos, _pDir); _shootRay.far = seg;
    if (pr.enemy && !targetsE) { syncPlayerHit(); targetsE = [...obstacleMeshes, ...propMeshes, playerHit.body, playerHit.head]; }
    const hits = _shootRay.intersectObjects(pr.enemy ? targetsE : targets, false);
    let done = false;
    if (hits.length) { if (resolveBulletHit(hits[0], _pDir, pr)) anyHit = true; _pNext.copy(hits[0].point); done = true; }
    pr.pos.copy(_pNext); pr.dist += seg; pr.t += dt;
    if (pr.line) { const a = pr.line.geometry.attributes.position; a.setXYZ(1, pr.pos.x, pr.pos.y, pr.pos.z); a.needsUpdate = true; pr.line.geometry.computeBoundingSphere(); }
    if (done || pr.dist >= pr.range || pr.t > BALLISTICS.maxTime || pr.pos.y < -5) {
      if (pr.line) tracers.push({ line: pr.line, life: 0.07 });
      projectiles.splice(i, 1);
    }
  }
  if (anyHit) { showHitmarker(); sfx.hitmarker(); }
}
// 명중 처리 — 적(부위 데미지)/물리통(폭발·임펄스)/연습장 표적/환경 탄흔. 적·표적 명중 시 true(히트마커)
function resolveBulletHit(h, dir, pr) {
  const ud = h.object.userData;
  if (ud && ud.playerHit) { // 적 탄 → 플레이어 (#316): 피격점 부위 → damagePlayer(헬멧/방탄복/부위 풀은 기존 경로)
    if (pr.enemy && state.phase === 'raid') { const part = playerHitPart(ud.part, h.point); pr.result = part; damagePlayer(pr.dmgBody, part === 'head', part); }
    return false;
  }
  if (ud && ud.enemy && !ud.enemy.dead) {
    const part = enemyHitPart(ud.enemy, ud.part, h.point); // 피격점 → 부위 (#313)
    const dmg = part === 'head' ? pr.dmgHead : pr.dmgBody;
    damageEnemyPart(ud.enemy, part, dmg);
    if (ud.enemy.hp > 0) enemyHitReact(ud.enemy, part === 'head');
    ud.enemy.lastKnown.copy(player.pos); // 피격당한 적은 즉시 교전 상태
    if (ud.enemy.hp <= 0) killEnemy(ud.enemy);
    else ud.enemy.state = 'combat';
    return true;
  }
  if (ud && ud.physProp && !ud.physProp.exploded) { // 물리 배럴 피격 — 폭발통은 폭발, 일반통은 임펄스로 튐 (#119)
    const p = ud.physProp;
    if (p.explosive) { p.exploded = true; blackenProp(p); removeMovementCollider(p); explodeAt(propWorldPos(p).clone()); }
    else {
      const m = p.body.mass();
      p.body.applyImpulse({ x: dir.x * 5 * m, y: 1.5 * m, z: dir.z * 5 * m }, true);
      p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * m, z: (Math.random() - 0.5) * m }, true);
    }
    return false;
  }
  if (ud && ud.rangeTarget) { // 연습장 표적 (#292): 점수/존/공 반응 + 종이·실루엣엔 탄흔
    rangeHit(ud.rangeTarget, h);
    if (ud.rangeTarget.kind !== 'gong' && h.face) { _decalN.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize(); spawnDecal(h.point, _decalN); }
    return true;
  }
  if (h.face) { _decalN.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize(); spawnDecal(h.point, _decalN); } // 환경 탄흔 (#208)
  if (pr.enemy) pr.result = 'env';
  return false;
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
  if (pd < radius && state.phase === 'raid') damagePlayer(damage * (1 - pd / radius) * 0.85, false, Math.random() < 0.55 ? 'legs' : Math.random() < 0.5 ? 'stomach' : 'thorax'); // 폭발은 다리/복부 위주 (#304)
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
  const left = []; // 무게 초과로 못 챙긴 아이템 (#310)
  for (const item of it.items) {
    if (item.ammo) {
      gun.reserve += item.ammo;
      addFeed(`+${item.ammo} 탄약`);
    } else {
      const kg = itemKg(item), cw = carryWeight();
      if (cw + kg > CARRY.max) { left.push(item); addFeed(`무게 초과 — ${item.name} 못 챙김 (${cw.toFixed(1)}/${CARRY.max} kg)`); sfx.dryFire(); continue; } // (#310) 상자에 남김
      inventory.push({ name: item.name, value: item.value, heal: item.heal, use: item.use, type: item.type, slot: item.slot, keyId: item.keyId, kg });
      addFeed(item.type === 'part' ? `${item.name} 획득 (총기 부품)`
        : item.type === 'key' ? `${item.name} 획득 (열쇠)`
        : `${item.name} 획득 (₽${item.value.toLocaleString('ko-KR')})`);
    }
  }
  it.items = left; if (left.length) it.opened = false; // 남은 아이템은 다시 열 수 있음 (#310)
  refreshInventoryUI();
}

function useHeal() {
  const bleeding = !!(player.bleeds && player.bleeds.length), blacked = limbBlacked();
  if (player.healCooldown > 0 || (player.hp >= PLAYER.maxHp && !bleeding && !blacked)) return;
  // 출혈·저체력은 붕대 우선, 부상 부위만 있으면 구급킷 우선 (#304)
  let idx = (blacked && !bleeding) ? inventory.findIndex(i => i.heal > 30) : inventory.findIndex(i => i.heal && i.heal <= 30);
  if (idx === -1) idx = inventory.findIndex(i => i.heal);
  if (idx === -1) { addFeed('치료 아이템 없음'); return; }
  const item = inventory.splice(idx, 1)[0];
  player.hp = Math.min(PLAYER.maxHp, player.hp + item.heal);
  const cured = player.bleeds ? player.bleeds.length : 0; player.bleeds = []; // 어느 치료든 지혈
  let fixed = 0;
  if (item.heal > 30 && player.parts) for (const k of Object.keys(BODY_PARTS)) { // 구급킷: 부상 부위 50% 복구 + 전 부위 +20
    if (player.parts[k] <= 0 && k !== 'head' && k !== 'thorax') fixed++;
    player.parts[k] = Math.min(BODY_PARTS[k].max, Math.max(player.parts[k], BODY_PARTS[k].max * 0.5) + 20);
  }
  player.healCooldown = 1.2; bodyDirty = true;
  sfx.heal();
  addFeed(`${item.name} 사용 (+${item.heal} HP${cured ? ' · 지혈' : ''}${fixed ? ' · 부상 처치' : ''})`);
  refreshInventoryUI();
}

// 부상 처치 (#307, X): 부목(부상 부위 0 인 팔/다리 → 30% 복구) 우선, 없으면 진통제(60s 부상 효과 억제). HP 는 회복하지 않는다.
function useMed() {
  if (player.healCooldown > 0 || !player.parts) return;
  const limb = ['legs', 'arms'].find((k) => player.parts[k] <= 0);
  let idx = -1, what = '';
  if (limb) { idx = inventory.findIndex((i) => i.use === 'splint'); what = 'splint'; }
  if (idx === -1) {
    const injured = limbBlacked() || partFrac('legs') < 0.5 || partFrac('arms') < 0.5;
    if (injured && !painFree()) { idx = inventory.findIndex((i) => i.use === 'painkiller'); what = 'painkiller'; }
  }
  if (idx === -1) { addFeed(limb ? '부목이 없습니다 (진통제로 임시 억제 가능)' : painFree() ? '진통제 효과 중' : '처치할 부상이 없거나 진통제가 없습니다'); return; }
  const item = inventory.splice(idx, 1)[0];
  if (what === 'splint') { player.parts[limb] = BODY_PARTS[limb].max * 0.3; addFeed(`${item.name} — ${BODY_PARTS[limb].name} 고정 (30% 복구)`); }
  else { player.painkiller = 60; addFeed(`${item.name} — 60초간 부상 효과 억제`); }
  player.healCooldown = 1.2; bodyDirty = true;
  sfx.heal();
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
  dom.invTotal.textContent = `₽ ${inventoryValue().toLocaleString('ko-KR')} · ⚖ ${carryWeight().toFixed(1)} kg`; // (#310)
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
// (FOREST_TREES 제거 — 숲은 placeCardTree 카드 트리 #280)

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
  // 폐교 창 변형 (#286): 멀쩡(유리+멀리언) / 깨짐(어두운 배킹+유리 파편+그을음) / 판자 막음. 시드 결정론. n = 바깥 법선 부호(+z 정면 1, 후면 -1)
  const b = batchBuilder(), rs = mulberry32(2026);
  const glaze = (wx, wz, axis, openings, baseY, n = 1) => {
    const gy = baseY + 1.5, gh = 1.0; // addWindowWall 개구부(sill 1.0~lintel 2.0) 대응
    for (const o of openings) {
      const r = rs(), cxw = wx + o.at, out = wz + n * (t / 2 + 0.03);
      if (r < 0.5) { b.box(cxw, gy, wz, o.w, gh, 0.06, MAT.glass, false); b.box(cxw, gy, wz, 0.07, gh, 0.13, MAT.woodDark, false); }
      else if (r < 0.78) { // 깨짐
        b.box(cxw, gy, wz - n * 0.16, o.w - 0.1, gh, 0.05, MAT.interior, false);
        b.box(cxw - o.w * 0.3, gy - 0.28, wz, o.w * 0.34, 0.4, 0.06, MAT.glass, false); b.box(cxw + o.w * 0.34, gy + 0.3, wz, o.w * 0.26, 0.36, 0.06, MAT.glass, false);
        if (rs() < 0.5) b.box(cxw, gy + 0.72, out, o.w + 0.5, 0.42, 0.03, MAT.soot, false);
      } else { // 판자
        b.box(cxw, gy, wz - n * 0.16, o.w - 0.1, gh, 0.05, MAT.interior, false);
        for (let k = 0; k < 3; k++) b.box(cxw + (rs() - 0.5) * 0.2, gy - 0.34 + k * 0.34, out, o.w + 0.3, 0.17, 0.05, MAT.woodDark, false);
      }
      if (rs() < 0.25) b.box(cxw + (rs() - 0.5) * 0.6, gy - 0.95, out - n * 0.01, 0.1, 0.8, 0.03, MAT.rust, false); // 창턱 아래 녹물
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
  addWindowWall(centerL, zF, halfL - entW / 2, FH, 'x', wall, winsSideL); glaze(centerL, zF, 'x', winsSideL, 0, 1);
  addWindowWall(centerR, zF, halfL - entW / 2, FH, 'x', wall, winsSideL); glaze(centerR, zF, 'x', winsSideL, 0, 1);
  addBox(cx, FH - 0.35, zF, entW + 0.6, 0.7, t, wall);   // 현관 상인방
  // 현관 캐노피(한쪽 기둥이 부러져 기운 슬래브 #286) + 기둥 + 계단
  addBoxRot(cx + 0.3, FH + 0.05 - 1.05, zF + 1.6, entW + 2.4, 0.3, 3.4, 'concrete', { rz: -0.24 }); // 캐노피 — 우측이 1.5m 까지 내려앉음
  addBox(cx - (entW / 2 + 0.6), FH / 2, zF + 3.0, 0.4, FH, 0.4, 'concrete');                        // 좌측 기둥(온전)
  addBox(cx + (entW / 2 + 0.6), 0.6, zF + 3.0, 0.4, 1.2, 0.4, 'concrete');                           // 우측 기둥 밑동
  addBoxRot(cx + entW / 2 + 2.3, 0.22, zF + 4.3, 0.4, 2.0, 0.4, 'concrete', { rz: Math.PI / 2 - 0.15, ry: 0.5 }); // 쓰러진 기둥 토막
  for (let s = 0; s < 3; s++) addBox(cx, 0.1 + s * 0.0, zF + 1.0 + s * 0.6, entW + 1.6 - s * 0.6, 0.2 + s * 0.2, 1.4 - s * 0.4, 'concrete', { block: false }); // 계단
  // 후면: 창 밴드
  addWindowWall(cx, zB, L, FH, 'x', wall, winsFull); glaze(cx, zB, 'x', winsFull, 0, -1);
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
    addWindowWall(cx, zF, L, FH, 'x', wall, winsFull, by); glaze(cx, zF, 'x', winsFull, by, 1);
    addWindowWall(cx, zB, L, FH, 'x', wall, winsFull, by); glaze(cx, zB, 'x', winsFull, by, -1);
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
  addBox(cx + halfL - 10, roofY + 2.3, cz - 1, 3.2, 4.6, 3.2, MAT.rust, { collide: false }); // 물탱크(사각, 녹슴 #286)

  // ── 폐교 마감 (#286): 그라임 밴드 · 덩굴 · 교실 책상 · 담장/교문 · 게양대 · 골대 · 벤치 · 운동장 잡초 ──
  const dark = MAT.concreteDark;
  for (const [x0, x1] of [[-halfL - 0.7, -entW / 2 - 0.9], [entW / 2 + 0.9, halfL + 0.7]]) b.box(cx + (x0 + x1) / 2, 0.36, zF + 0.73, x1 - x0, 0.62, 0.05, dark, false); // 정면 플린스 그라임(현관 제외)
  b.box(cx, 0.36, zB - 0.73, L + 1.4, 0.62, 0.05, dark, false);
  for (const sx of [-1, 1]) b.box(cx + sx * (halfL + 0.73), 0.36, cz, 0.05, 0.62, Dp + 1.4, dark, false);
  { const iv = forestBatch(), im = canopyMat('ivy_card'); // 덩굴 카드(벽면 proud 8cm): 코너·후면 위주, 일부는 2층까지
    for (const [x, z, n, s, y] of [[cx - halfL + 4, zF, 1, 5.5, 0], [cx + 20, zF, 1, 4.2, 0], [cx - 12, zB, -1, 6.5, 0], [cx + 26, zB, -1, 5, 0], [cx + 6, zB, -1, 4, 3.2], [cx - 30, zB, -1, 4.5, 0]]) {
      const c = 0.6 + rs() * 0.3; iv.put(x, z, 'ivy_card', im, cardGeo(new THREE.Vector3(x, y + s / 2 + 0.15, z + n * (t / 2 + 0.08)), s, s, n > 0 ? 0 : Math.PI, 0, [c * 0.9, c, c * 0.85], rs() < 0.5));
    }
    for (const [sx, y, s] of [[-1, 0, 5], [1, 0, 4], [1, 3.6, 3.5]]) { const c = 0.6 + rs() * 0.3; iv.put(cx + sx * halfL, cz, 'ivy_card', im, cardGeo(new THREE.Vector3(cx + sx * (halfL + t / 2 + 0.08), y + s / 2 + 0.15, cz + (rs() - 0.5) * 6), s, s, sx * Math.PI / 2, 0, [c * 0.9, c, c * 0.85], rs() < 0.5)); }
    iv.flush(); }
  for (let r = 0; r < roomCount; r++) { if (r === 1 || r === 4) continue; const rx = cx - halfL + roomW * (r + 0.5); // 교실 책상(엄폐 낮음)
    for (const dz of [-6, -3, 0]) for (const dx of [-2.6, 2.6]) { const x = rx + dx + (rs() - 0.5) * 0.6, z = cz + dz + (rs() - 0.5) * 0.5;
      b.box(x, 0.74, z, 1.1, 0.06, 0.6, MAT.wood, true); for (const lx of [-0.45, 0.45]) b.box(x + lx, 0.36, z, 0.05, 0.72, 0.5, MAT.woodDark, false); } }
  { const gz = 56; // 남쪽 담장 + 교문(개구 x ±3.2) + 철문 2짝(한 짝 열림·한 짝 반쯤 닫힘=콜라이더)
    for (const [x0, x1] of [[-38, -3.2], [3.2, 38]]) { for (let x = x0; x < x1 - 0.1; x += 7) { const x1s = Math.min(x1, x + 7), gy2 = terrainH((x + x1s) / 2, gz); b.box((x + x1s) / 2, gy2 + 0.7, gz, x1s - x, 1.4, 0.3, 'concreteStain', true); b.box(x, terrainH(x, gz) + 0.9, gz, 0.5, 1.8, 0.5, 'brick', true); } b.box(x1, terrainH(x1, gz) + 0.9, gz, 0.5, 1.8, 0.5, 'brick', true); }
    for (const sx of [-1, 1]) b.box(cx + sx * 3.5, terrainH(cx + sx * 3.5, gz) + 1.15, gz, 0.6, 2.3, 0.6, 'brick', true);
    addBoxRot(cx - 1.9, 1.0, gz - 1.1, 2.8, 1.9, 0.08, MAT.rust, { ry: 1.1 });
    addBoxRot(cx + 1.9, 1.0, gz + 0.3, 2.6, 1.9, 0.08, MAT.rust, { ry: -0.25 }); colliders.push(axisCollider(cx + 0.55, cx + 3.2, 0, 2, gz - 0.2, gz + 0.8)); }
  b.cyl(cx - 24, 4.6, 12, 0.05, 0.07, 9.2, MAT.steel, 8, true); b.box(cx - 23.3, 8.7, 12, 1.3, 0.8, 0.03, MAT.laneWhite, false); // 국기게양대 + 바랜 깃발
  for (const sx of [-1, 1]) { const gx = cx + sx * 29; for (const dz of [-3.66, 3.66]) b.box(gx, 1.2, 33 + dz, 0.12, 2.44, 0.12, MAT.steel, true); b.box(gx, 2.44, 33, 0.12, 0.12, 7.32, MAT.steel, false); } // 골대
  b.flush();
  for (const sx of [-1, 1]) weatherModel(placeModel('propBench', cx + sx * 7, zF + 6.5, { height: 0.85, rotY: Math.PI }));
  { const yg = forestBatch(), gm = canopyMat('grass_card'); // 운동장 잡초(현관 앞 제외)
    for (let i = 0; i < 80; i++) { const x = cx + (rs() - 0.5) * 70, z = 14 + rs() * 38; if (Math.abs(x) < 6 && z < 20) continue;
      const w = 0.8 + rs() * 1.0, h = w * 0.5, c = 0.55 + rs() * 0.3, yaw = rs() * Math.PI;
      for (let k = 0; k < 2; k++) yg.put(x, z, 'grass_card', gm, cardGeo(new THREE.Vector3(x, h / 2 + 0.01, z), w, h, yaw + k * Math.PI / 2, 0, [c * 0.95, c, c * 0.85], rs() < 0.5)); }
    yg.flush(); }
}

// 숲 배치: 격자+지터, 건물/운동장 플래튼·경계 회피.
// 일부는 대형 엄폐목(굵은 활엽수 줄기) — 플레이어가 서서 은엄폐로 쓸 수 있게. #172
function scatterForest(cx0, cz0, cx1, cz1) {
  const step = 6.5, rnd = mulberry32(165), fb = forestBatch(); // 시드 고정 → 매 로드 동일 숲 (QA 재현)
  let n = 0;
  for (let x = cx0; x <= cx1; x += step) {
    for (let z = cz0; z <= cz1; z += step) {
      const jx = x + (rnd() - 0.5) * step * 0.8;
      const jz = z + (rnd() - 0.5) * step * 0.8;
      if (Math.abs(jx) > WORLD_HALF - 4 || Math.abs(jz) > WORLD_HALF - 4) continue;
      if (terrainH(jx, jz) === 0 && insideAnyFlatten(jx, jz)) continue; // 플래튼(운동장/건물) 내부는 비움
      if (nearPath(jx, jz, 2.8)) continue; // 임도 위 나무 없음 (#283)
      if (rnd() < 0.28) continue; // 성김
      const seed = 1000 + n * 7919; n++;
      if (rnd() < 0.16) {
        // 대형 엄폐목: 큰 키 활엽 + 굵은 줄기 콜라이더(서서 뒤에 숨음)
        placeCardTree(fb, rnd() < 0.5 ? 'canopy_broad_a' : 'canopy_broad_b', jx, jz, 13 + rnd() * 4, 0.62, seed); // 13~17m, 줄기반경 0.62m
      } else {
        const r = rnd(), kind = r < 0.22 ? 'canopy_broad_a' : r < 0.42 ? 'canopy_broad_b' : r < 0.55 ? 'canopy_autumn' : r < 0.9 ? 'pine' : 'dead';
        placeCardTree(fb, kind, jx, jz, kind === 'pine' ? 9 + rnd() * 5 : 6.5 + rnd() * 4.5, 0.35, seed);
      }
    }
  }
  console.log(`[forest] card trees ${n}, merged meshes ${fb.flush()}`); // 0건이어도 남긴다
}
function insideAnyFlatten(x, z) {
  for (const f of FLATTENS) {
    if (f.r !== undefined) { if (Math.hypot(x - f.x, z - f.z) < f.r + 3) return true; }
    else if (Math.abs(x - f.x) < f.hw + 3 && Math.abs(z - f.z) < f.hd + 3) return true;
  }
  return false;
}

// ── 숲 바닥 (#283 학교 Phase 2): 풀 카드 다발(교차 카드 2장, grass_card) + Poly Haven 고사리/관목(지오메트리 병합) + 리얼 바위.
// 전부 청크·재질별 병합(forestBatch) → 클러터 ~800개가 ~40 draw call. 비충돌·비차폐(통과 장식, 병합 메시는 탄착만).
// 플래튼(운동장·건물·스폰)·임도 근처는 비운다.
const PROP_GEO = {};
function propGeo(key, keepRe) { // Poly Haven 프롭에서 keep 에 맞는 메시 1개의 geometry(월드 변환 굽기·바닥 중심 원점·속성 통일) + material. 캐시.
  const ck = key + '|' + keepRe;
  if (PROP_GEO[ck]) return PROP_GEO[ck];
  let found = null;
  ASSETS[key].scene.updateMatrixWorld(true);
  ASSETS[key].scene.traverse((o) => { if (!found && o.isMesh && keepRe.test(o.name)) found = o; });
  if (!found) return null;
  const g = found.geometry.clone(); g.applyMatrix4(found.matrixWorld);
  g.computeBoundingBox(); const bb = g.boundingBox; g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
  return (PROP_GEO[ck] = { geo: g, mat: found.material, h: bb.max.y - bb.min.y });
}
const _ppM = new THREE.Matrix4(), _ppP = new THREE.Vector3(), _ppQ = new THREE.Quaternion(), _ppS = new THREE.Vector3();
function putProp(fb, key, keepRe, x, z, height, rotY) {
  const p = propGeo(key, keepRe); if (!p) return false;
  if (bakeReplay()) return true; // (#325)
  const s = height / Math.max(0.01, p.h), g = p.geo.clone();
  g.applyMatrix4(_ppM.compose(_ppP.set(x, terrainH(x, z) - 0.02, z), _ppQ.setFromAxisAngle(_up, rotY), _ppS.set(s, s, s)));
  fb.put(x, z, key + '|' + keepRe, p.mat, g); return true;
}
const SCHOOL_PATHS = [[[0, 54], [0, 84]], [[38, 30], [78, 78]], [[40, 2], [78, -78]], [[-40, 2], [-78, -78]]]; // 흙길 폴리라인 [x,z]: 남문·SE 숲길·NE/NW 임도 (#283)
function nearPath(x, z, r) {
  for (const pl of SCHOOL_PATHS) for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    if (Math.hypot(x - (ax + t * dx), z - (az + t * dz)) < r) return true;
  }
  return false;
}
function buildSchoolPaths() { // 흙길: 지형 추종 스트립(2m 세그먼트), 자갈 텍스처(미터 UV). 1 draw call
  const src = GROUND_TEX.gravel || GROUND_TEX.ground; if (!src) return;
  const tex = src.clone(); tex.needsUpdate = true; tex.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x9a8c78, roughness: 1.0, polygonOffset: true, polygonOffsetFactor: -1 });
  const geos = [], W = 3.2;
  for (const pl of SCHOOL_PATHS) for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(len / 2)), yaw = Math.atan2(bx - ax, bz - az);
    const g = new THREE.PlaneGeometry(W, len, 1, n); g.rotateX(-Math.PI / 2); g.rotateY(yaw); g.translate((ax + bx) / 2, 0, (az + bz) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) { p.setY(k, terrainH(p.getX(k), p.getZ(k)) + 0.04); uv.setXY(k, uv.getX(k) * W / 2.5, uv.getY(k) * len / 2.5); }
    g.computeVertexNormals(); geos.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.receiveShadow = true; m.userData.terrainTile = true; scene.add(m); obstacleMeshes.push(m);
}
function scatterGroundClutter(cx0, cz0, cx1, cz1) {
  const rnd = mulberry32(177), fb = forestBatch(), gm = canopyMat('grass_card');
  const insideBuilding = (x, z) => Math.abs(x) < 35 && Math.abs(z) < 9;
  const step = 5; let grass = 0, plants = 0, rocks = 0;
  const fernKeep = [/fern_02_a$/, /fern_02_b$/, /fern_02_c$/, /fern_02_d$/], shrubKeep = [/shrub_03_a$/, /shrub_03_b$/, /shrub_03_c$/];
  for (let x = cx0; x <= cx1; x += step) {
    for (let z = cz0; z <= cz1; z += step) {
      const jx = x + (rnd() - 0.5) * step, jz = z + (rnd() - 0.5) * step;
      if (Math.abs(jx) > WORLD_HALF - 4 || Math.abs(jz) > WORLD_HALF - 4) continue;
      if (insideBuilding(jx, jz) || insideAnyFlatten(jx, jz) || nearPath(jx, jz, 1.8)) continue;
      const r = rnd(), gy = terrainH(jx, jz);
      if (r < 0.6) { // 풀 다발: 교차 카드 2장
        const w = 0.9 + rnd() * 1.2, h = w * 0.5, c = 0.68 + rnd() * 0.36, yaw = rnd() * Math.PI;
        for (let k = 0; k < 2; k++) fb.put(jx, jz, 'grass_card', gm, cardGeo(new THREE.Vector3(jx, gy + h / 2 - 0.03, jz), w, h, yaw + k * Math.PI / 2, 0, [c, c, c * 0.92], rnd() < 0.5));
        grass++;
      } else if (r < 0.74) { if (putProp(fb, 'fern', fernKeep[Math.floor(rnd() * 4)], jx, jz, 0.45 + rnd() * 0.5, rnd() * 6.28)) plants++; }
      else if (r < 0.82) { if (putProp(fb, 'shrub', shrubKeep[Math.floor(rnd() * 3)], jx, jz, 0.5 + rnd() * 0.6, rnd() * 6.28)) plants++; }
      else if (r < 0.85) { placeModel(rnd() < 0.5 ? 'rockRealB' : 'rockRealC', jx, jz, { height: 0.3 + rnd() * 0.6, rotY: rnd() * 6.28, collide: false }); rocks++; }
    }
  }
  console.log(`[clutter] grass ${grass} plants ${plants} rocks ${rocks} merged ${fb.flush()}`); // 0건이어도 남긴다
}

// 하이트필드 변위 지면 타일 (산업/학교/도심 공용) — tint 로 색조, texKey 로 GROUND_TEX 선택(도심=rubble #268)
function buildGroundTiles(tint, texKey = 'ground') {
  let groundMat;
  const src = GROUND_TEX[texKey] || GROUND_TEX.ground;
  if (src) { const t = src.clone(); t.needsUpdate = true; t.repeat.set(26, 26); groundMat = new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 1.0 }); }
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
  scene.fog = new THREE.Fog(0x8f9c8b, 55, 210); // 숲 안개 — 녹회색. 카드 트리(#280)는 원경 캐노피가 안개색으로 바래므로 시작 거리를 55m 로
  buildGroundTiles(0xaaa89a, 'forest'); // 숲 바닥 = ambientCG Ground076 낙엽/뿌리 (#283)
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

  // 숲: 임도 + 카드 트리 전역 산포 + 숲 바닥(풀 카드·고사리·관목·바위) + 그루터기/쓰러진 줄기 앵커 (#280, #283)
  buildSchoolPaths();
  scatterForest(-W + 6, -W + 6, W - 6, W - 6);
  scatterGroundClutter(-W + 6, -W + 6, W - 6, W - 6);
  { const r2 = mulberry32(283);
    for (const [x, z] of [[8, 66], [-6, 70], [46, 44], [60, -30], [-52, -20], [-66, 50], [30, -50], [-20, -60], [70, 20], [-40, -75]]) if (isPointOpen(x, z, 1.2) && !nearPath(x, z, 2)) placeModel('stump', x, z, { height: 0.5 + r2() * 0.3, rotY: r2() * 6.28 });
    for (const [x, z, r] of [[14, 72, 0.4], [-50, 40, 1.9], [56, 8, 2.6], [-30, -40, 0.9], [40, -66, 2.2], [-70, -8, 1.3]]) if (isPointOpen(x, z, 2.2) && !nearPath(x, z, 2.5)) placeModel('deadLog', x, z, { height: 1.0, rotY: r }); }

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
  look: 'forest', // (#319)
  sun: [30, 55, 60], // 남동광 — 교사 정면(+z)·현관 채광 (#286)
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
// 1층 진입 실내(#199)는 buildUrbanBlock 이 계승. 옛 박스 건물(urbanBuilding/buildRoom)은 Phase 3 롤아웃(#271)으로 제거.
// ── 시드 PRNG (결정론적 변주 — 매 로드 동일, QA 재현 가능. modular-game-architecture 스킬) ──
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 벽면/옥상 부착 프롭 (#265): placeModel 과 달리 절대 높이 y 에 바닥을 맞춘다(지형 무관). 다변형 GLB(Poly Haven 팩은 변형이
// X축으로 나란함)는 keep 정규식으로 1개만 남기고 그 bbox 중심을 원점으로 재정렬. 콜라이더 없음(벽·지붕이 막음), 탄착/차폐는 등록.
function placeProp(key, x, y, z, { rotY = 0, height = null, keep = null, block = true } = {}) {
  const m = instantiate(key);
  if (keep) { const drop = []; m.traverse((o) => { if (o.isMesh && !keep.test(o.name)) drop.push(o); }); for (const o of drop) o.parent.remove(o); }
  m.updateMatrixWorld(true);
  const bb0 = new THREE.Box3().setFromObject(m);
  if (height) m.scale.setScalar(height / Math.max(0.001, bb0.max.y - bb0.min.y));
  m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(m);
  const g = new THREE.Group();
  m.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); // 바닥 중심 → 원점
  g.add(m); g.rotation.y = rotY; g.position.set(x, y, z);
  scene.add(g); g.updateMatrixWorld(true);
  if (block) g.traverse((o) => { if (o.isMesh) obstacleMeshes.push(o); });
  return g;
}

// 상가 간판 캔버스 (#265): 바랜 도색판 + 때·하단 그라임. 시드로 색 조합 결정.
function signTexture(text, seed) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d'), rnd = mulberry32(seed);
  const pal = [['#1f2a44', '#e8e2cf'], ['#5a1f1f', '#f0e6d2'], ['#243d2c', '#efe9d5'], ['#3a2f22', '#e6d9b8'], ['#0f3a4a', '#efe7d0']];
  const [bg, fg] = pal[Math.floor(rnd() * pal.length)];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.fillStyle = fg; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
  for (let i = 0; i < 46; i++) { g.fillStyle = `rgba(22,18,12,${0.06 + rnd() * 0.2})`; g.fillRect(rnd() * 512, rnd() * 128, 8 + rnd() * 70, 3 + rnd() * 22); }
  const grd = g.createLinearGradient(0, 72, 0, 128); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = grd; g.fillRect(0, 72, 512, 56);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
const SHOP_NAMES = ['대한슈퍼', '명성부동산', '한빛약국', '동아세탁', '우리분식', '태양전자', '중앙문구', '서울미용실'];

// ── 도심 블록 kit-of-parts (#265 Phase 1): 1층 진입 셸(문·바닥·천장·기둥 = 기존 게임플레이 유지) + 상층 "파인 창"(피어+창턱+
// 상인방+어두운 배킹+유리 → 오버레이가 아니라 0.3m 깊이) + 발코니 + 층 밴드 + 코너 기둥 + 파라펫 + 옥상(계단탑·물탱크·AC·안테나·환기관)
// + 상가 롤셔터·간판 + 비상계단 + 마모(그라임 밴드·녹물 스트릭·그을음·판자 막은 창). batchBuilder 병합(재질별 ~10 draw call).
// 시드 PRNG 로 결정론적 변주. 상층은 도달 불가라 콜라이더 없음(1층 벽·기둥만). 동일평면 회피: 돌출 트림은 2~5cm proud, 끝단은 인접 매스 안으로.
function buildUrbanBlock(cx, cz, w, d, floors, { style = 'apartment', mat = 'brickCity', shop = true, fireEscape = null, seed = 1, door = 0, collapse = null, light = true } = {}) {
  const b = batchBuilder(), rnd = mulberry32(seed);
  const FH = 3.3, t = 0.35, gy = terrainH(cx, cz), H = floors * FH, trim = MAT.concrete, dark = MAT.concreteDark;
  notePlacement('ublock', cx, cz, w / 2 + 0.35, d / 2 + 0.35, gy, gy + H + 3); // 겹침 진단 (#215)
  const faces = [ // ax: 면이 뻗는 축, c: 면 중심의 수직 좌표, n: 바깥 법선 부호, len: 길이
    { ax: 'x', c: cz + d / 2, n: 1, len: w, key: 'south', front: true }, // +Z 정면(문/상가)
    { ax: 'x', c: cz - d / 2, n: -1, len: w, key: 'north' },
    { ax: 'z', c: cx + w / 2, n: 1, len: d, key: 'east' },
    { ax: 'z', c: cx - w / 2, n: -1, len: d, key: 'west' },
  ];
  // 붕괴 코너 (#274): collapse='ne'|'nw'|'se'|'sw' — 상부 2개 층의 코너 cw×cw 매스를 제거. 해당 두 면의 박스는 fbox 가 자동 클리핑.
  const cut = (collapse && floors >= 3) ? (() => {
    const sx = collapse.includes('e') ? 1 : -1, sz = collapse.includes('s') ? 1 : -1, cw = Math.min(6, w * 0.38, d * 0.38);
    return { sx, sz, cw, y0: gy + (floors - 2) * FH, range: (f) => { // 면별 절단 구간 [c0,c1](along). 코너는 면 끝이라 한쪽 끝 구간
      if (f.ax === 'z' && f.n === sx) return sz < 0 ? [-d / 2 - 1, -d / 2 + cw] : [d / 2 - cw, d / 2 + 1];
      if (f.ax === 'x' && f.n === sz) return sx < 0 ? [-w / 2 - 1, -w / 2 + cw] : [w / 2 - cw, w / 2 + 1];
      return null;
    } };
  })() : null;
  // 면 로컬 박스: along = 면 방향 오프셋(중심 기준), off = 바깥 돌출(+)/안쪽(−), th = 두께. 붕괴 구간과 겹치면 잘라내거나 생략
  const fbox = (f, along, y, off, len, h, th, m, collide = false) => {
    if (cut && y + h / 2 > cut.y0 + 0.01) { const r = cut.range(f); if (r) {
      let a0 = along - len / 2, a1 = along + len / 2;
      if (r[0] < -f.len / 2) a0 = Math.max(a0, r[1]); else a1 = Math.min(a1, r[0]);
      if (a1 - a0 < 0.05) return; along = (a0 + a1) / 2; len = a1 - a0;
    } }
    if (f.ax === 'x') b.box(cx + along, y, f.c + f.n * off, len, h, th, m, collide);
    else b.box(f.c + f.n * off, y, cz + along, th, h, len, m, collide);
  };
  const fpos = (f, along, off) => (f.ax === 'x' ? [cx + along, f.c + f.n * off] : [f.c + f.n * off, cz + along]); // 월드 [x,z]
  const fyaw = (f) => (f.ax === 'x' ? (f.n > 0 ? 0 : Math.PI) : (f.n > 0 ? Math.PI / 2 : -Math.PI / 2));   // 모델 +Z → 바깥
  const bays = (len, sp = 3.2, ww = 1.4) => { const n = Math.max(1, Math.floor((len - 2.6) / sp)), span = n * sp, o = []; for (let i = 0; i <= n; i++) o.push({ at: -span / 2 + i * sp, w: ww }); return o; };
  // 창 뚫린 벽(1층 = 실제 개구부·콜라이더 / 상층 = 파인 창): 창턱 밴드 + 상인방 밴드 + 피어. door={at,w} 면 문 개구부(창턱 밴드 분절, 상인방까지 개방)
  const winWall = (f, by, openings, collide, sill = 1.0, lintel = 2.2, door = null) => {
    const ops = door ? [...openings, { at: door.at, w: door.w }].sort((a, b) => a.at - b.at) : openings;
    if (door) { for (const [s0, s1] of [[-f.len / 2, door.at - door.w / 2], [door.at + door.w / 2, f.len / 2]]) if (s1 - s0 > 0.1) fbox(f, (s0 + s1) / 2, by + sill / 2, 0, s1 - s0, sill, t, mat, collide); }
    else fbox(f, 0, by + sill / 2, 0, f.len, sill, t, mat, collide);
    fbox(f, 0, by + lintel + (FH - lintel) / 2, 0, f.len, FH - lintel, t, mat, collide);
    const edges = [-f.len / 2, ...ops.flatMap((o) => [o.at - o.w / 2, o.at + o.w / 2]), f.len / 2];
    for (let i = 0; i < edges.length; i += 2) { const sl = edges[i + 1] - edges[i]; if (sl > 0.1) fbox(f, (edges[i] + edges[i + 1]) / 2, by + sill + (lintel - sill) / 2, 0, sl, lintel - sill, t, mat, collide); }
    for (const o of openings) fbox(f, o.at, by + sill + 0.03, t / 2 + 0.05, o.w + 0.3, 0.08, 0.12, trim); // 창턱 트림(proud)
    if (door) fbox(f, door.at, by + lintel + 0.02, t / 2 + 0.03, door.w + 0.5, 0.1, 0.1, MAT.woodDark); // 문틀 상단
  };
  const bay = style === 'office' ? [3.0, 2.2] : [3.2, 1.4]; // office = 넓은 리본창, 발코니 없음
  const props = []; // 배치 후 부착 프롭 (배치 빌더 flush 이후)

  // ── 1층: 진입 셸 ──
  b.box(cx, gy + 0.05, cz, w - t, 0.1, d - t, 'concrete', false);          // 실내 바닥
  b.box(cx, gy + FH + 0.15, cz, w + 0.2, 0.3, d + 0.2, 'concrete', false); // 천장(=2층 바닥)
  if (w >= 14) for (const sx of [-1, 1]) b.box(cx + sx * w * 0.25, gy + FH / 2, cz, 0.5, FH, 0.5, trim, true); // 실내 기둥(엄폐)
  if (shop) b.box(cx + (door < 0 ? 2.6 : -2.6), gy + 0.5, cz + d / 2 - 2.4, Math.min(3.2, w * 0.3), 1.0, 0.7, MAT.woodDark, true); // 상가 카운터(엄폐) (#277)
  for (const f of faces) {
    if (f.front && shop) { // 상가 정면: 솔리드 벽 + 문 + 롤셔터·파시아·간판
      const dw = 2.8;
      for (const [s0, s1] of [[-f.len / 2, door - dw / 2], [door + dw / 2, f.len / 2]]) if (s1 - s0 > 0.1) fbox(f, (s0 + s1) / 2, gy + FH / 2, 0, s1 - s0, FH, t, mat, true);
      fbox(f, door, gy + FH - 0.35, 0, dw, 0.7, t, mat, true); // 문 상단
      fbox(f, door, gy + 2.62, t / 2 + 0.03, dw + 0.5, 0.1, 0.1, MAT.woodDark); // 문틀 상단
      {
        fbox(f, 0, gy + 2.95, t / 2 + 0.07, f.len - 0.6, 0.7, 0.12, dark); // 파시아 밴드
        for (const [s0, s1] of [[-f.len / 2 + 0.4, door - dw / 2 - 0.3], [door + dw / 2 + 0.3, f.len / 2 - 0.4]]) {
          const n = Math.min(2, Math.floor((s1 - s0) / 2.72)); if (n < 1) continue;
          const mid = (s0 + s1) / 2;
          for (let i = 0; i < n; i++) { // 롤셔터(닫힌 상가) — plain/graffiti 변형 시드 선택
            const at = mid + (i - (n - 1) / 2) * 2.72, [px, pz] = fpos(f, at, t / 2 + 0.02 + 0.19);
            props.push(['rollShutter', px, gy, pz, { rotY: fyaw(f), height: 2.3, keep: rnd() < 0.4 ? /graffiti/ : /^rollershutter_window_01$/ }]);
          }
          const [sx, sz] = fpos(f, mid, t / 2 + 0.14); // 간판(캔버스) — 파시아보다 2cm 앞
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(4.8, n * 2.72), 0.62), new THREE.MeshStandardMaterial({ map: signTexture(SHOP_NAMES[Math.floor(rnd() * SHOP_NAMES.length)], seed * 7 + i0(f)), roughness: 0.9 }));
          sign.position.set(sx, gy + 2.95, sz); sign.rotation.y = fyaw(f); scene.add(sign); obstacleMeshes.push(sign);
        }
      }
    } else { // 측·후면(+비상가 정면: 문 포함): 실제 개구부(사격 가능) + 일부 판자 막음
      const dr = f.front ? { at: door, w: 2.8 } : null;
      const ws = bays(f.len, ...bay).filter((o) => !dr || Math.abs(o.at - dr.at) > (dr.w + o.w) / 2 + 0.4);
      winWall(f, gy, ws, true, 1.0, f.front ? 2.3 : 2.0, dr);
      for (const o of ws) if (rnd() < 0.3) for (let k = 0; k < 3; k++) fbox(f, o.at, gy + 1.2 + k * 0.32, 0.02, o.w + 0.24, 0.15, 0.06, MAT.woodDark);
    }
    fbox(f, f.front ? (door + 1.4 + f.len / 2) / 2 : 0, gy + 0.4, t / 2 + 0.03, f.front ? (f.len / 2 - door - 1.4) - 0.5 : f.len - 0.5, 0.8, 0.04, dark); // 그라임 밴드(정면은 문 우측)
    if (f.front) fbox(f, (-f.len / 2 + door - 1.4) / 2, gy + 0.4, t / 2 + 0.03, (door - 1.4 + f.len / 2) - 0.5, 0.8, 0.04, dark); // 정면 문 좌측
  }
  function i0(f) { return faces.indexOf(f); }

  // ── 상층: 파인 창 + 발코니 + 층 밴드 + 마모 ──
  for (let fl = 1; fl < floors; fl++) {
    const by = gy + fl * FH;
    for (const f of faces) {
      const ws = bays(f.len, ...bay); winWall(f, by, ws, false);
      fbox(f, 0, by + 1.6, -0.30, f.len - 0.5, 1.3, 0.06, MAT.interior); // 어두운 배킹(창 뒤 실내) — 깊이감
      for (const o of ws) {
        const burnt = rnd() < 0.1;
        if (!burnt) fbox(f, o.at, by + 1.6, -0.22, o.w - 0.04, 1.16, 0.03, MAT.glass);
        else fbox(f, o.at, by + 2.42, t / 2 + 0.02, o.w + 0.6, 0.46, 0.03, MAT.soot); // 화재 그을음(유리 없음)
        if (rnd() < 0.22) fbox(f, o.at + (rnd() - 0.5) * 0.5, by + 0.55, t / 2 + 0.03, 0.1, 0.85, 0.04, MAT.rust); // 창 아래 녹물
      }
      if (style === 'apartment' && f.ax === 'x') ws.forEach((o, i) => { // 발코니(격창): 슬래브 + 난간
        if (i % 2 !== 1) return;
        fbox(f, o.at, by + 0.06, t / 2 + 0.51, 2.2, 0.12, 1.0, trim);
        for (const px of [-1.05, 0, 1.05]) fbox(f, o.at + px, by + 0.62, t / 2 + 0.97, 0.05, 1.0, 0.05, MAT.rust);
        for (const ry of [0.62, 1.1]) fbox(f, o.at, by + ry, t / 2 + 0.97, 2.2, 0.05, 0.05, MAT.rust);
        for (const s of [-1, 1]) fbox(f, o.at + s * 1.075, by + 1.1, t / 2 + 0.5, 0.05, 0.05, 0.95, MAT.rust);
      });
      fbox(f, 0, by, t / 2 + 0.03, f.len + 0.1, 0.22, 0.1, trim); // 층 밴드(proud, 끝단은 코너 기둥 안)
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { // 코너 기둥(파라펫 위 5cm; 붕괴 코너는 절단 높이까지만)
    const hh = (cut && sx === cut.sx && sz === cut.sz) ? cut.y0 - gy : H + 0.75;
    b.box(cx + sx * w / 2, gy + hh / 2, cz + sz * d / 2, 0.7, hh, 0.7, trim, false);
  }
  if (cut) { // 붕괴 코너 디테일: 노출 슬래브 + 실내 칸막이(코너 룸) + 절단선 톱니 스텁 + 슬래브 위 잔해 + 철근 + 지면 잔해 더미
    const { sx, sz, cw, y0 } = cut, kx = cx + sx * (w / 2 - cw / 2), kz = cz + sz * (d / 2 - cw / 2);
    for (let fl = floors - 2; fl < floors; fl++) {
      const by = gy + fl * FH;
      b.box(kx, by + 0.12, kz, cw - 0.1, 0.24, cw - 0.1, 'concrete', false);                       // 노출 슬래브
      b.box(cx + sx * (w / 2 - cw), by + FH / 2, kz, 0.25, FH - 0.3, cw, 'plasterDirty', false);    // 칸막이(안쪽 벽)
      b.box(kx, by + FH / 2, cz + sz * (d / 2 - cw), cw, FH - 0.3, 0.25, 'plasterDirty', false);
      for (const [k, hh] of [[0.3, 0.8], [0.9, 0.5], [1.5, 0.25]]) {                                  // 톱니 스텁(양 면)
        b.box(cx + sx * (w / 2 - cw + k), by + FH * hh / 2, cz + sz * d / 2, 0.6, FH * hh, t, mat, false);
        b.box(cx + sx * w / 2, by + FH * hh / 2, cz + sz * (d / 2 - cw + k), t, FH * hh, 0.6, mat, false);
      }
      for (let i = 0; i < 4; i++) { const s = 0.5 + rnd() * 0.6; b.box(kx + (rnd() - 0.5) * (cw - 1.6), by + 0.24 + s * 0.2, kz + (rnd() - 0.5) * (cw - 1.6), s, s * 0.4, s * 0.8, MAT.concreteDark, false); } // 슬래브 위 잔해
    }
    for (let i = 0; i < 3; i++) b.cyl(cx + sx * (w / 2 - 0.3 - rnd() * 1.5), y0 + 0.24 + 0.55, cz + sz * (d / 2 - 0.3 - rnd() * 1.5), 0.02, 0.02, 1.1, MAT.rust, 5, false); // 철근
    const rx = cx + sx * (w / 2 + 1.7), rz = cz + sz * (d / 2 + 1.7);                                 // 지면 잔해 더미(콘크리트 조각; 바위는 flush 뒤 placeModel)
    for (let i = 0; i < 6; i++) { const s = 0.4 + rnd() * 0.8; b.box(rx + (rnd() - 0.5) * 3.5, gy + s * 0.25, rz + (rnd() - 0.5) * 3.5, s, s * 0.7, s * 0.8, MAT.concreteDark, false); }
  }

  // ── 옥상 ──
  if (cut) { const { sx, sz, cw } = cut; // 붕괴 코너 제외 L자 슬래브 2장
    b.box(cx, gy + H + 0.05, cz - sz * cw / 2, w - 0.2, 0.1, d - 0.2 - cw, MAT.roof, false);
    b.box(cx - sx * cw / 2, gy + H + 0.05, cz + sz * (d / 2 - cw / 2), w - 0.2 - cw, 0.1, cw - 0.1, MAT.roof, false);
  } else b.box(cx, gy + H + 0.05, cz, w - 0.2, 0.1, d - 0.2, MAT.roof, false);
  for (const f of faces) { fbox(f, 0, gy + H + 0.35, 0, f.len + 0.3, 0.7, t, mat); fbox(f, 0, gy + H + 0.74, 0, f.len + 0.44, 0.08, 0.5, trim); } // 파라펫 + 캡
  const phx = cx - w * 0.22, phz = cz + d * 0.1;
  if (floors > 1) { // 다층만 계단탑·물탱크 (1층 상가는 옥상이 좁음)
    b.box(phx, gy + H + 1.6, phz, 4.2, 3.2, 3.0, mat, false);                          // 계단탑
    b.box(phx, gy + H + 3.25, phz, 4.5, 0.1, 3.3, trim, false);                        // 계단탑 캡
    b.box(phx + 2.14, gy + H + 1.05, phz - 0.6, 0.06, 2.1, 0.9, MAT.woodDark, false);  // 계단탑 문(면에서 1cm proud)
    const wtx = cx + w * 0.26, wtz = cz - d * 0.22;                                    // 물탱크(다리+원통+원뿔)
    for (const [ox, oz] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) b.box(wtx + ox, gy + H + 0.8, wtz + oz, 0.14, 1.5, 0.14, MAT.rust, false);
    b.cyl(wtx, gy + H + 1.55 + 1.1, wtz, 1.2, 1.2, 2.2, MAT.steel, 14, false);
    b.cone(wtx, gy + H + 3.75 + 0.35, wtz, 1.26, 0.7, MAT.steel, 14);
  }
  for (let i = 0; i < (floors > 1 ? 3 : 1); i++) b.cyl(cx + (rnd() - 0.5) * w * 0.6, gy + H + 0.7, cz + (rnd() - 0.5) * d * 0.6, 0.12, 0.14, 1.2, MAT.rust, 8, false); // 환기관
  const anx = floors > 1 ? phx - 1.8 : cx + w * 0.3, anz = floors > 1 ? phz + 1.2 : cz - d * 0.3, anB = floors > 1 ? 3.3 : 0.1; // 안테나(계단탑 위 / 1층은 지붕 위)
  b.cyl(anx, gy + H + anB + 2.0, anz, 0.03, 0.04, 4.0, MAT.steel, 6, false);
  b.box(anx, gy + H + anB + 3.9, anz, 0.7, 0.04, 0.5, MAT.steel, false);
  b.flush();
  // 부착 프롭(배치 빌더 이후): 옥상 AC(rusted) + 측벽 AC + 롤셔터/간판 + 비상계단
  placeProp('acUnit', cx + w * 0.05, gy + H + 0.11, cz - d * 0.3, { rotY: 0.4, height: 0.95, keep: /rusted/ });
  if (floors > 1) placeProp('acUnit', cx - w * 0.3, gy + H + 0.11, cz - d * 0.25, { rotY: -1.2, height: 0.95, keep: /rusted/ });
  const acFace = faces.find((q) => q.key === (fireEscape === 'east' ? 'west' : 'east')); // 비상계단 반대 측벽 창 아래 실외기 3대(시드 층 선택)
  for (const o of (floors > 1 ? bays(acFace.len, ...bay).filter((_, i) => i % 2 === 0).slice(0, 3) : [])) {
    const fl = 1 + Math.floor(rnd() * (floors - 1)), [px, pz] = fpos(acFace, o.at + 0.9, t / 2 + 0.25);
    placeProp('acUnit', px, gy + fl * FH + 0.21, pz, { rotY: fyaw(acFace), height: 0.85, keep: rnd() < 0.5 ? /rusted/ : /^exterior_aircon_unit$/ });
    fbox(acFace, o.at + 0.9, gy + fl * FH + 0.17, t / 2 + 0.25, 0.9, 0.06, 0.5, MAT.rust); // 브래킷
  }
  for (const [k, x, y, z, o] of props) placeProp(k, x, y, z, o);
  if (light) { const f = faces[0], [lx, lz] = fpos(f, door + 1.9, t / 2 + 0.16); placeProp('securityLight', lx, gy + 3.44, lz, { rotY: fyaw(f) }); } // 문 옆 보안등 (#274)
  { // 1층 실내 소품 (#277): 상자 + 드럼통 — 콜라이더(엄폐)만 등록하고 notePlacement 는 생략(건물 footprint 안이라 겹침 진단 오탐 방지)
    const prop = (key, x, z, h) => { const ry = rnd() * 6.28, m = placeModel(key, x, z, { height: h, rotY: ry, collide: false }); colliders.push(colliderFromModel(m, x, z, ry, gy)); };
    prop(rnd() < 0.5 ? 'box' : 'crateWide', cx - w * 0.36, cz - d * 0.3, 1.0);
    prop('barrel', cx + w * 0.38, cz - d * 0.15, 1.1);
  }
  if (cut) { // 붕괴 코너 지면 잔해: 리얼 바위(엄폐, 콜라이더) 2개
    const rx = cx + cut.sx * (w / 2 + 1.7), rz = cz + cut.sz * (d / 2 + 1.7);
    placeModel('rockRealB', rx, rz, { height: 1.3 + rnd() * 0.3, rotY: rnd() * 6.28 });
    placeModel('rockRealC', rx - cut.sx * 1.6, rz + cut.sz * 0.5, { height: 0.8, rotY: rnd() * 6.28, collide: false }); // 소형(납작·넓음)은 콜라이더 없이 — 큰 바위가 엄폐, 겹침 진단 제외
  }
  if (fireEscape && floors >= 3) { // 비상계단: 2층부터 파라펫 아래까지, 벽에 붙여 (3층 이상만)
    const f = faces.find((q) => q.key === fireEscape) || faces[3];
    const fh = Math.min(H - FH - 0.8, 12.5), [px, pz] = fpos(f, -f.len * 0.04, t / 2 + 0.95); // 중앙 근처(코너 난간 돌출 방지)
    const fe = placeProp('fireEscape', px, gy + FH + 0.3, pz, { rotY: fyaw(f), height: fh });
    const bb = new THREE.Box3().setFromObject(fe), wallAt = f.c + f.n * (t / 2 + 0.02); // 벽면에 스냅(모델 깊이 무관)
    if (f.ax === 'z') fe.position.x += wallAt - (f.n > 0 ? bb.min.x : bb.max.x); else fe.position.z += wallAt - (f.n > 0 ? bb.min.z : bb.max.z);
    fe.updateMatrixWorld(true);
  }
  const lamp = new THREE.PointLight(0xffd9a8, 9, Math.max(w, d) * 1.1, 2); lamp.position.set(cx, gy + FH - 0.5, cz); scene.add(lamp); // 1층 실내 조명(루팅 가시)
}

// ── 도심 거리 인프라 (#268 Phase 2): 도로망(아스팔트 8m + 보도 2m + 연석) + 중앙 점선/정지선/횡단보도 + 광장 포장 + 가로등(절차) +
// 맨홀·소화전 프롭. 전부 batchBuilder 박스(worldUV → 재질별 1 draw call). 높이 규약(동일평면 회피): E-W 아스팔트 top 0.02 /
// N-S 0.03 / 보도·광장 0.04 / 연석 0.14 / 차선은 각 도로 top +0.01. 콜라이더는 가로등 기둥만(연석 14cm 는 통과).
// 보도는 교차로에서 분절 — N-S 보도가 교차 아스팔트 가장자리(±4)까지 뻗어 코너를 덮고, E-W 보도는 코리더 밖(±6)에서 끝난다.
const URBAN_NS = [-76, -22, 22, 76], URBAN_EW = [-76, -20, 22, 76]; // 도로 중심선 (외곽 순환로 ±76, 대로 x=±22, 도로 z=−20/+22)
function buildUrbanStreets() {
  const b = batchBuilder(), rnd = mulberry32(268);
  const AW = 8, SW = 2, HALF = AW / 2 + SW, L = 76, NS = URBAN_NS, EW = URBAN_EW;
  const segs = (lines, cut) => { const o = []; for (let i = 0; i < lines.length - 1; i++) o.push([lines[i] + cut, lines[i + 1] - cut]); return o; };
  const sides = (line) => [line - AW / 2 - SW / 2, line + AW / 2 + SW / 2]; // 보도 중심(±5)
  for (const x of NS) b.box(x, 0.02, 0, AW, 0.02, L * 2 + AW, 'asphalt', false); // N-S 아스팔트 top 0.03
  for (const z of EW) b.box(0, 0.01, z, L * 2 + AW, 0.02, AW, 'asphalt', false); // E-W top 0.02 (교차로 겹침은 높이 차로 회피)
  for (const x of NS) for (const [z0, z1] of segs(EW, AW / 2)) for (const sx of sides(x)) { // N-S 보도+연석
    const zc = (z0 + z1) / 2, zl = z1 - z0;
    b.box(sx, 0.02, zc, SW, 0.04, zl, 'paving', false);
    b.box(sx + (sx < x ? SW / 2 - 0.1 : -SW / 2 + 0.1), 0.07, zc, 0.2, 0.14, zl, MAT.concreteDark, false);
  }
  for (const z of EW) for (const [x0, x1] of segs(NS, HALF)) for (const sz of sides(z)) { // E-W 보도+연석
    const xc = (x0 + x1) / 2, xl = x1 - x0;
    b.box(xc, 0.02, sz, xl, 0.04, SW, 'paving', false);
    b.box(xc, 0.07, sz + (sz < z ? SW / 2 - 0.1 : -SW / 2 + 0.1), xl, 0.14, 0.2, MAT.concreteDark, false);
  }
  // 중앙 점선(바랜 노랑, 3m 대시/6m 주기, 일부 지워짐) — 교차로·횡단보도 구간(±9.5) 제외
  const dash = (ax, line, s0, s1, y) => { for (let s = s0; s + 3 <= s1; s += 6) { if (rnd() < 0.15) continue; if (ax === 'z') b.box(line, y, s + 1.5, 0.15, 0.01, 3, MAT.laneYellow, false); else b.box(s + 1.5, y, line, 3, 0.01, 0.15, MAT.laneYellow, false); } };
  for (const x of NS) for (const [z0, z1] of segs(EW, 9.5)) dash('z', x, z0, z1, 0.035);
  for (const z of EW) for (const [x0, x1] of segs(NS, 9.5)) dash('x', z, x0, x1, 0.025);
  for (const x of [-22, 22]) for (const z of [-20, 22]) for (const s of [-1, 1]) { // 내부 교차로 4곳: 횡단보도(6줄) + 정지선
    for (let i = 0; i < 6; i++) b.box(x - 3.5 + i * 1.4, 0.035, z + s * 6, 0.6, 0.01, 3, MAT.laneWhite, false);
    b.box(x, 0.035, z + s * 8.2, AW - 0.6, 0.01, 0.4, MAT.laneWhite, false);
    for (let i = 0; i < 6; i++) b.box(x + s * 6, 0.025, z - 3.5 + i * 1.4, 3, 0.01, 0.6, MAT.laneWhite, false);
    b.box(x + s * 8.2, 0.025, z, 0.4, 0.01, AW - 0.6, MAT.laneWhite, false);
  }
  b.box(0, 0.02, 1, 32, 0.04, 30, 'paving', false); // 광장 포장 |x|<16, z∈(−14,16) — 대로/도로 보도에 접함
  const lamp = (x, z, dx, dz) => { // 절차 가로등: 베이스 + 기둥(콜라이더) + 도로쪽 암 + 헤드. 기존 건물/엄폐 콜라이더 안이면 생략
    if (!isPointOpen(x, z, 1.0)) return;
    b.box(x, 0.09, z, 0.42, 0.1, 0.42, MAT.concreteDark, false);
    b.cyl(x, 2.74, z, 0.06, 0.09, 5.2, MAT.lampPole, 8, true);
    b.box(x + dx * 0.7, 5.3, z + dz * 0.7, dx ? 1.4 : 0.12, 0.1, dz ? 1.4 : 0.12, MAT.lampPole, false);
    b.box(x + dx * 1.3, 5.22, z + dz * 1.3, dx ? 0.55 : 0.3, 0.2, dz ? 0.55 : 0.3, MAT.steel, false);
  };
  for (const x of NS.slice(1, 3)) for (const [z0, z1] of segs(EW, HALF)) for (let z = z0 + 6, i = 0; z < z1 - 3; z += 20, i++) { const s = i % 2 ? 1 : -1; lamp(x + s * 5.6, z, -s, 0); }
  for (const z of EW.slice(1, 3)) for (const [x0, x1] of segs(NS, HALF)) for (let x = x0 + 6, i = 0; x < x1 - 3; x += 20, i++) { const s = i % 2 ? 1 : -1; lamp(x, z + s * 5.6, 0, -s); }
  b.flush();
  for (const [x, z] of [[-24, -48], [20.5, -6], [-20, 40], [24, 60], [-50, -18.5], [46, 23.5], [8, -21.5], [-60, 20.5]]) placeProp('manhole', x, 0.0, z, { rotY: rnd() * Math.PI }); // 맨홀(아스팔트 위 4cm)
  for (const [x, z, k] of [[-17.3, -30, 1], [-17.3, 31, 0], [17.3, -31, 1], [17.3, 30, 0], [-50, -14.7, 1], [46, 16.7, 0]]) if (isPointOpen(x, z, 0.7)) placeProp('hydrant', x, 0.04, z, { rotY: rnd() * Math.PI * 2, keep: k ? /_aged$/ : /^fire_hydrant(_cap_0[123]|_chain)?$/ }); // 소화전(보도 위, normal/aged; 건물 안이면 생략)
}

function buildUrbanMap() {
  buildTexMats();
  scene.fog = new THREE.Fog(0x949aa2, 42, 190);               // 회색 스모그
  buildGroundTiles(0xa39d92, 'rubble');                       // 공터 = 벽돌 잔해 흙 (ambientCG Ground107) #268
  const W = WORLD_HALF;
  addBox(0, 3, -W, W * 2 + 2, 6, 1, 'concrete', { shadow: false });
  addBox(0, 3, W, W * 2 + 2, 6, 1, 'concrete', { shadow: false });
  addBox(-W, 3, 0, 1, 6, W * 2 + 2, 'concrete', { shadow: false });
  addBox(W, 3, 0, 1, 6, W * 2 + 2, 'concrete', { shadow: false });
  // 아파트/오피스 블록 (다양한 높이·재질) — 중앙 광장(±16) 개방, 거리 형성
  // 블록 12동 = buildUrbanBlock 3스타일 변주 (#265 히어로, #271 롤아웃). 1층 진입·루팅 스팟은 건물 중심(기둥 사이) 유지.
  buildUrbanBlock(-36, -36, 20, 16, 5, { style: 'apartment', mat: 'brickCity', shop: true, fireEscape: 'west', seed: 11, door: -3 }); // 히어로 블록 (#265 Phase 1)
  buildUrbanBlock(36, -34, 18, 20, 6, { style: 'office', mat: 'concrete', shop: false, fireEscape: 'east', seed: 23, door: 2, collapse: 'sw' }); // 붕괴 코너 (#274)
  buildUrbanBlock(-38, 38, 22, 18, 4, { style: 'apartment', mat: 'plasterDirty', shop: true, fireEscape: 'west', seed: 31, door: 4, collapse: 'ne' });
  buildUrbanBlock(40, 36, 16, 16, 7, { style: 'apartment', mat: 'brickdirty', shop: true, seed: 41, door: -2 }); // 파사드 변주 (#277)
  buildUrbanBlock(-60, 2, 14, 28, 5, { style: 'office', mat: 'concreteStain', shop: false, fireEscape: 'north', seed: 53, door: 0 });
  buildUrbanBlock(60, 6, 16, 22, 6, { style: 'apartment', mat: 'plasterbroken', shop: true, fireEscape: 'east', seed: 61, door: -3 });
  buildUrbanBlock(0, -58, 30, 14, 4, { style: 'plain', mat: 'brickCity', shop: true, seed: 71, door: 6 });
  buildUrbanBlock(4, 60, 26, 14, 5, { style: 'office', mat: 'concrete', shop: false, seed: 83, door: -5 });
  buildUrbanBlock(-62, -60, 18, 16, 5, { style: 'apartment', mat: 'plasterbroken', shop: false, fireEscape: 'west', seed: 97, door: 3 });
  buildUrbanBlock(62, -62, 16, 18, 6, { style: 'plain', mat: 'brickdirty', shop: false, fireEscape: 'east', seed: 101, door: -1 });
  // 중앙 광장: 진입 가능한 1층 상가 2채 + 엄폐
  buildUrbanBlock(-13, -7, 9, 8, 1, { style: 'plain', mat: 'plasterDirty', shop: true, seed: 113, door: -2.5 });
  buildUrbanBlock(13, 9, 9, 8, 1, { style: 'plain', mat: 'brick', shop: true, seed: 127, door: -2.5 });
  [[-16, 18, 0], [18, -16, 1]].forEach(([x, z, rot], i) => addBox(x, 1.3, z, rot ? 2.4 : 5, 2.6, rot ? 5 : 2.4, [MAT.metalRed, MAT.metalBlue][i])); // 컨테이너 엄폐 2 (나머지 4 → 바리케이드 #274)
  for (const [x, z, ax] of [[-6, 0, 'x'], [8, -4, 'z'], [-2, 11, 'x'], [10, 6, 'z']]) addWall(x, z, 6, 1.1, ax, 'concrete'); // 낮은 방벽
  for (const [x, z] of [[-10, 4], [10, -8], [0, 16], [-20, 20], [22, -6]]) placeModel('barrel', x, z, { collide: true });
  buildUrbanStreets(); // 도로망·보도·차선·광장·가로등·맨홀·소화전 (#268) — 건물/엄폐 뒤에 호출: 가로등·소화전이 isPointOpen 으로 기존 콜라이더를 피함
  buildUrbanRuins();   // 폐허화 + 거리 프롭 (#274): 방치차·바리케이드·쓰레기·타이어·잔해 더미
  losMeshes = obstacleMeshes.filter((o) => !o.userData.terrainTile);
}
// ── 도심 폐허화 + 거리 프롭 (#274 Phase 4). 좌표는 도로/건물 footprint 검산값(도로: N-S 아스팔트 |x∓22|<4, E-W |z+20|<4·|z−22|<4, 순환로 |±76|<4).
// 바리케이드(방호벽 4 + 모래주머니 2)는 내부 교차로 4곳 접근로에 엄폐로, 방치차는 도로 한쪽 차선에. 프롭은 isPointOpen 으로 콜라이더 안이면 생략.
function buildUrbanRuins() {
  const rnd = mulberry32(274);
  const open = (x, z, r = 0.6) => isPointOpen(x, z, r);
  for (const [key, x, z, rotY] of [['carCovered', -20, -48, 0.2], ['carCovered', 23.5, 6, 3.3], ['carCovered', -8, 20.5, 1.5], ['carCovered', 44, -21, 1.6], ['carCovered', -74, 50, -1.4], ['carTruck', -60, 24, 0.1], ['carDelivery', 76, -40, 1.57]]) {
    if (!open(x, z, 2.2)) continue;
    const cov = key === 'carCovered', m = placeModel(key, x, z, { height: cov ? 1.5 : 2.4, rotY });
    if (!cov) m.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.62); o.material.roughness = 0.92; } }); // 방치차 어둡게
  }
  const barricade = (x0, z0, dx, dz, n, rotY) => { // 방호벽 n개 일렬 + 뒤쪽 모래주머니 2
    for (let i = 0; i < n; i++) { const x = x0 + dx * i, z = z0 + dz * i; if (open(x, z, 0.9)) placeModel('roadBarrier', x, z, { height: 1.05, rotY }); }
    const bx = x0 + dx * (n - 1) / 2, bz = z0 + dz * (n - 1) / 2, ox = dz ? 1.3 * Math.sign(x0) : 0, oz = dx ? 1.3 * Math.sign(z0) : 0; // 열 뒤쪽(교차로 반대편) 1.3m
    for (const s of [-1, 1]) { const x = bx + (dx ? s * 1.4 : 0) + ox, z = bz + (dz ? s * 1.4 : 0) + oz; addBox(x, terrainH(x, z) + 0.45, z, dx ? 2.4 : 0.9, 0.9, dz ? 2.4 : 0.9, MAT.sandbag); }
  };
  barricade(-25, -30, 1.65, 0, 4, 0);        // (-22,-20) 북측(−z) 접근로(대로 가로지름)
  barricade(32, -23, 0, 1.65, 4, Math.PI / 2); // (22,-20) 동측 접근로
  barricade(-32, 19, 0, 1.65, 4, Math.PI / 2); // (-22,22) 서측 접근로
  barricade(19, 32, 1.65, 0, 4, 0);          // (22,22) 남측(+z) 접근로
  for (const [x, z] of [[-3, 2], [-1, 2], [-3, 4]]) addBox(x, terrainH(x, z) + 0.45, z, 1.9, 0.9, 0.9, MAT.sandbag); // 광장 모래주머니 진지
  for (const [x, z] of [[14, -1], [14, 0.7]]) if (open(x, z, 0.9)) placeModel('roadBarrier', x, z, { height: 1.05, rotY: Math.PI / 2 });
  for (const [x, z] of [[-30, -46], [-28.5, -47], [30, -47.5], [-52, 46], [48, 48], [12, 44]]) if (open(x, z)) placeModel('carTire', x, z, { height: 0.62, rotY: rnd() * 6.28, collide: false }); // 눕힌 타이어
  for (const [x, z] of [[-29.6, -45.5], [47, 49.2], [13.2, 43.2], [-51, 47.1]]) if (open(x, z)) placeProp('tyre', x, terrainH(x, z), z, { rotY: rnd() * 6.28 }); // 세워진 타이어
  for (const [x, z] of [[-33, -26.6], [-31.5, -26.3], [3, -49.5], [5, -49.2], [-10.5, -2.2], [16, 15], [36, -23.3], [-56.5, 20.3], [62, 17.5], [-24.5, 46]]) if (open(x, z, 0.4)) placeModel('trashbag', x, z, { rotY: rnd() * 6.28, collide: false }); // 쓰레기봉투
  for (const [x, z, k] of [[-17.6, -34, 1], [17.6, 34, 0], [-26.6, 50, 1], [26.6, -50, 0], [-40, -14.8, 1], [44, 17.2, 0]]) if (open(x, z, 0.4)) placeProp('trashCan', x, 0.04, z, { rotY: rnd() * 6.28, keep: k ? /^metal_trash_can_rust$/ : /^metal_trash_can$/ }); // 쓰레기통(본체만)
  for (const [x, z, r] of [[-16.6, -40, Math.PI / 2], [16.6, 40, Math.PI / 2], [-40, -25.4, 0], [56, 26.6, 0]]) if (open(x, z, 0.5)) placeProp('utilityBox', x, 0.04, z, { rotY: r }); // 유틸리티 박스(보도 바깥쪽)
  const oilMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, transparent: true, opacity: 0.5, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }); // 도로 오일 얼룩 데칼 (#277)
  for (const [x, z, r, y] of [[-21, -40, 1.4, 0.036], [-23.5, 10, 1.1, 0.036], [20.5, -52, 1.6, 0.036], [23, 44, 1.2, 0.036], [-48, -21.5, 1.5, 0.026], [40, -19, 1.0, 0.026], [-44, 21, 1.3, 0.026], [50, 23.5, 1.1, 0.026]]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 18), oilMat); m.rotation.x = -Math.PI / 2; m.rotation.z = rnd() * 6.28; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m);
  }
  for (const [x, z] of [[-56, -46.5], [52, 50], [14, -48]]) { // 잔해 더미: 리얼 바위(엄폐) + 콘크리트 조각 (건물 벽에서 3m 이상 이격 — rockRealC 는 납작·넓음)
    if (!open(x, z, 1.5)) continue;
    placeModel('rockRealB', x, z, { height: 1.2 + rnd() * 0.4, rotY: rnd() * 6.28 });
    placeModel('rockRealC', x + 1.5, z - 0.8, { height: 0.7 + rnd() * 0.3, rotY: rnd() * 6.28, collide: false });
    for (let i = 0; i < 5; i++) { const s = 0.4 + rnd() * 0.7; addBox(x + (rnd() - 0.5) * 3.6, terrainH(x, z) + s * 0.25, z + (rnd() - 0.5) * 3.6, s, s * 0.7, s * 0.8, MAT.concreteDark, { collide: false }); }
  }
}
const URBAN_FLATTENS = [
  { x: 0, z: 0, hw: 84, hd: 84 }, // 순환로(±76)·탈출점(±80)까지 평탄 (#268)
];
const MAP_URBAN = {
  key: 'urban', name: '도심 폐허', desc: '무너진 도심 — 아파트 블록·거리 시가전',
  build: buildUrbanMap,
  look: 'smog', // (#319)
  sun: [40, 55, 60], // 남동광 — 정면(+z)·상가 파사드 채광 (#277)
  flattens: URBAN_FLATTENS,
  lootSpots: [
    [-13, -7], [13, 9], [0, 0], [-16, 18], [18, -16], [-27, -13], [25, 21], // 광장·상가·엄폐
    [-36, -36], [36, -34], [-38, 38], [40, 36], [0, -58], [4, 60],           // 건물 1층 실내
    [-36, -24], [36, -22], [-38, 26], [40, 24], [0, -46], [4, 48],           // 블록 주변 거리
    [-60, 2], [60, 6], [-62, -60], [62, -62], [-46, 46], [46, 48],           // 외곽 거리·건물
    [-22.5, -33.5], [35.5, -18], [-35.5, 21.5], [21, 35.5], [-54, -48], [50, 47.5], // 바리케이드 뒤·잔해 더미 옆 (#274)
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

// ══════════════════════════════════════════════════════════════════════════════
// ── 벚꽃 동네 (#319 비주얼 개편 1단계): 개천(수로)+양안 벚꽃길 + 좁은 주택가 + 2층 단독주택 kit + 공원·신사·편의점 + 전신주·전선 ──
// 좌표: 개천 z∈[1,7] (바닥 −2.0, 수면 −1.72) 동서 관통. 도로 E-W z=−7(개천 북안)·14.5(남안)·−40·48, N-S x=0(6m)·±44(5m), 골목 z=−64·69.
// 블록 x: A[−85,−46.5] B[−41.5,−3] C[3,41.5] D[46.5,85]. 특수 블록: 공원 B×북2열, 신사 D×북2열, 편의점 C×남1열, 코인주차 B×남2열.
// 배치는 chunk 병합(townBatch, 40m 청크·재질별) → 전 맵 ~200 draw call. 지형은 맵별 terrain 훅(개천 트렌치·계단 램프·다리).
// ══════════════════════════════════════════════════════════════════════════════
const TOWN = {
  canal: { z0: 1, z1: 7, bed: -2.0, water: -1.72 },
  roadBridges: [[-46.9, -41.1], [-3.4, 3.4], [41.1, 46.9]],
  footBridges: [[-23.2, -20.8], [20.8, 23.2]],
  ramps: [{ x0: -66, side: -1 }, { x0: 58, side: -1 }, { x0: 12, side: 1 }, { x0: -32, side: 1 }], // side −1 = 북안, +1 = 남안. x0 = 램프 상단(여기서 +x 로 내려감)
  rampLen: 7, rampW: 1.4, landing: 1.6,
  roadsEW: [[-9.5, -4.5], [12, 17], [-42.5, -37.5], [45.5, 50.5]], // z 구간
  roadsNS: [[-46.5, -41.5], [-3, 3], [41.5, 46.5]],                 // x 구간
  alleys: [[-65.5, -62.5], [67.5, 70.5]],
  blocksX: [[-85, -46.5], [-41.5, -3], [3, 41.5], [46.5, 85]],
};
TOWN.bridges = [...TOWN.roadBridges, ...TOWN.footBridges];
const TOWN_LOOT = [];     // 빌드 시 채움 (MAP_TOWN.lootSpots 와 같은 배열)
const SAKURA_TREES = [];  // 낙화 파티클 스폰원 {x,y,z,r}
let townFx = null;        // 매 프레임 갱신(낙화·수면) — buildTownMap 이 설정

function townTerrain(x, z) {
  const C = TOWN.canal;
  if (z <= C.z0 || z >= C.z1) return 0;
  for (const [a, b] of TOWN.bridges) if (x >= a && x <= b) return 0; // 다리 위 (다리 밑은 수문 격자 콜라이더가 막음)
  for (const r of TOWN.ramps) {
    const zin = r.side < 0 ? z < C.z0 + TOWN.rampW : z > C.z1 - TOWN.rampW;
    if (!zin) continue;
    if (x >= r.x0 - TOWN.landing && x <= r.x0) return 0;
    if (x > r.x0 && x < r.x0 + TOWN.rampLen) return C.bed * (x - r.x0) / TOWN.rampLen;
  }
  return C.bed;
}

// 청크 병합 빌더: box/boxR/cyl/seg/geo 를 40m 청크·재질별로 모아 flush 에서 merge. 비인덱스 지오메트리는 인덱스 부여(병합 호환).
function townBatch(chunk = 90) { // 90m 청크(맵 2×2 + 가장자리) — 40m 는 재질 수(~45) × 청크 수로 1000+ draw call
  const by = new Map(), bid = bakeBatchId(), rp = bakeReplay(); // 굽기 재생: 형상 생략·콜라이더만 (#325)
  const put = (x, z, m, g) => {
    if (rp || !g) return;
    if (!g.index) { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const k = `${Math.floor(x / chunk)},${Math.floor(z / chunk)}|${m.uuid}`;
    let e = by.get(k); if (!e) by.set(k, (e = { m, gs: [] })); e.gs.push(g);
  };
  return {
    put,
    box(cx, cy, cz, w, h, d, mat, collide = false) {
      if (!rp) { const m = matOf(mat), g = new THREE.BoxGeometry(w, h, d);
        if (m.userData && m.userData.worldUV) uvWorldBox(g, w, h, d, cx, cy, cz);
        g.translate(cx, cy, cz); put(cx, cz, m, g); }
      if (collide) colliders.push(axisCollider(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2));
    },
    boxR(cx, cy, cz, w, h, d, mat, rx = 0, ry = 0, rz = 0) {
      if (rp) return;
      const m = matOf(mat), g = new THREE.BoxGeometry(w, h, d);
      if (m.userData && m.userData.worldUV) uvWorldBox(g, w, h, d);
      if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
      g.translate(cx, cy, cz); put(cx, cz, m, g);
    },
    cyl(cx, cy, cz, rt, rb, h, mat, seg = 10, collide = false) {
      if (!rp) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(cx, cy, cz); put(cx, cz, matOf(mat), g); }
      if (collide) { const r = Math.max(rt, rb); colliders.push(axisCollider(cx - r, cx + r, cy - h / 2, cy + h / 2, cz - r, cz + r)); }
    },
    seg(p0, p1, r, mat, radial = 6) { if (rp) return; put((p0.x + p1.x) / 2, (p0.z + p1.z) / 2, matOf(mat), barkSeg(p0, p1, r, r, radial)); },
    geo(x, z, mat, g) { put(x, z, matOf(mat), g); },
    flush() {
      if (rp) return bakeReplayFlush(bid);
      let n = 0;
      for (const { m, gs } of by.values()) {
        const g = mergeGeometries(gs, false); for (const q of gs) q.dispose();
        if (!g) continue;
        const mesh = new THREE.Mesh(g, m), hit = !(m.userData && m.userData.noHit); mesh.castShadow = !(m.userData && m.userData.noShadow); mesh.receiveShadow = true;
        scene.add(mesh); if (hit) obstacleMeshes.push(mesh); bakeRecord(bid, mesh, hit); n++;
      }
      by.clear(); return n;
    },
  };
}
const _tv = (x, y, z) => new THREE.Vector3(x, y, z);
function metricPlane(w, h) { const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); return g; }

// 90° 단위 로컬 프레임(대지 앞 = 로컬 +v). face 0:+z 1:+x 2:−z 3:−x. 축정렬 박스는 치수 스왑으로, 기운 박스는 rotateY(th).
function lotFrame(cx, cz, face) {
  const th = [0, Math.PI / 2, Math.PI, -Math.PI / 2][face], c = Math.round(Math.cos(th)), s = Math.round(Math.sin(th));
  const W = (u, v) => [cx + u * c + v * s, cz - u * s + v * c];
  return {
    th, W,
    box(B, u, y, v, lw, h, ld, mat, collide = false) { const [x, z] = W(u, v); if (c !== 0) B.box(x, y, z, lw, h, ld, mat, collide); else B.box(x, y, z, ld, h, lw, mat, collide); },
    boxR(B, u, y, v, lw, h, ld, mat, rx = 0, rz = 0) { const [x, z] = W(u, v); B.boxR(x, y, z, lw, h, ld, mat, rx, th, rz); },
    geo(B, g, u, y, v, mat) { g.rotateY(th); const [x, z] = W(u, v); g.translate(x, y, z); B.geo(x, z, mat, g); },
    seg(B, u0, y0, v0, u1, y1, v1, r, mat) { const [x0, z0] = W(u0, v0), [x1, z1] = W(u1, v1); B.seg(_tv(x0, y0, z0), _tv(x1, y1, z1), r, mat); },
    pos(u, v) { return W(u, v); },
    yaw(ly = 0) { return th + ly; }, // 모델 +Z(로컬 앞) → 월드
  };
}
function gableGeo(span, rise, thick) { // 삼각 박공벽: 로컬 x ∈[−span/2, span/2], y ∈[0, rise], 두께 z (가운데 정렬). 캡 UV = 미터
  const sh = new THREE.Shape(); sh.moveTo(-span / 2, 0); sh.lineTo(span / 2, 0); sh.lineTo(0, rise); sh.lineTo(-span / 2, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false }); g.translate(0, 0, -thick / 2); return g;
}
function hipRoofGeo(A, Bz, pitch) { // 모임지붕: 처마 반치수 A(x)·Bz(z), 경사 pitch. 처마 y=0, 비인덱스 삼각형 + 경사면 미터 UV
  const tp = Math.tan(pitch), rise = Math.min(A, Bz) * tp, P = [], U = [];
  const r0 = A >= Bz ? [-(A - Bz), rise, 0] : [0, rise, -(Bz - A)], r1 = A >= Bz ? [A - Bz, rise, 0] : [0, rise, Bz - A];
  const c = [[-A, 0, -Bz], [A, 0, -Bz], [A, 0, Bz], [-A, 0, Bz]];
  const tri = (a, b, d, ax) => { for (const p of [a, b, d]) { P.push(...p); U.push(ax === 'x' ? p[0] : p[2], p[1] / Math.sin(pitch)); } };
  tri(c[3], c[2], r1, 'x'); tri(c[3], r1, r0, 'x');   // 앞(+z)
  tri(c[1], c[0], r0, 'x'); tri(c[1], r0, r1, 'x');   // 뒤(−z)
  tri(c[2], c[1], r1, 'z');                           // 오른(+x)
  tri(c[0], c[3], r0, 'z');                           // 왼(−x)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.computeVertexNormals();
  return { g, rise };
}

// ── 동네 전용 재질 (한 번 생성, 텍스처 재질은 buildTexMats 의 TEXMAT 사용) ──
const TMAT = {};
function buildTownMats() {
  if (TMAT.ready) return;
  const S = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
  Object.assign(TMAT, {
    alu: S(0x3d342c, { metalness: 0.45, roughness: 0.45 }), aluSilver: S(0xaeb3b6, { metalness: 0.6, roughness: 0.35 }),
    trimWhite: S(0xe6e2d8), trimDark: S(0x34312d), ridge: S(0x3a3d42, { roughness: 0.7 }),
    glass: S(0x8fa9b6, { roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.5, envMapIntensity: 1.6 }),
    interior: S(0x2b2723, { roughness: 1 }), doorWood: S(0x5a3f2c), doorMetal: S(0x6d665c, { metalness: 0.3, roughness: 0.5 }),
    curtain: [0xe9e2d0, 0xd9c9ae, 0xc6d4da, 0xe6cfd3, 0xd5dcc4].map((c) => S(c, { roughness: 1 })),
    fabric: [0xf2f0ea, 0x8fb3d9, 0xe9b7c4, 0xf0d98a, 0x9cc49a, 0x6f7f96, 0xd9d3c7].map((c) => S(c, { roughness: 1, side: THREE.DoubleSide })),
    pole: S(0xa29f98, { roughness: 0.9 }), poleYellow: S(0xd8b21c, { roughness: 0.7 }), poleBlack: S(0x1f1f1f, { roughness: 0.7 }),
    insulator: S(0xe8e8e2, { roughness: 0.3 }), transformer: S(0x8d9296, { metalness: 0.4, roughness: 0.5 }),
    rail: S(0x2e4438, { metalness: 0.4, roughness: 0.5 }), moss: S(0x3f4531, { roughness: 1 }),
    vermilion: S(0xb8321f, { roughness: 0.6 }), shrineWood: S(0x6b4a32, { roughness: 0.9 }), stone: S(0x9b978d, { roughness: 0.95 }),
    polycarb: S(0xd2dcdc, { roughness: 0.2, transparent: true, opacity: 0.42 }),
    orange: S(0xe0762a, { roughness: 0.5 }), mirror: S(0xdfe6ea, { metalness: 1, roughness: 0.04 }),
    red: S(0xc8392e, { roughness: 0.5 }), yellow: S(0xe0b52a, { roughness: 0.5 }), blue: S(0x2e6ab0, { roughness: 0.5 }), green: S(0x3a8a4a, { roughness: 0.5 }),
    sand: S(0xcbb994, { roughness: 1 }), rubber: S(0x1a1a1a, { roughness: 0.9 }), terracotta: S(0xa95e3e, { roughness: 0.9 }),
    lampGlow: S(0xfff1d6, { emissive: 0xffe2b0, emissiveIntensity: 0.6, roughness: 0.4 }),
    white: S(0xf0efea, { roughness: 0.6 }), whiteLine: S(0xe8e6de, { roughness: 0.9 }),
    ceiling: S(0xe8e4dc, { roughness: 1 }), fridgeGlow: S(0xdfe8f0, { emissive: 0xd8ecff, emissiveIntensity: 0.45 }),
  });
  for (const k of ['glass', 'polycarb']) TMAT[k].userData.noShadow = true;
  // 알파 컷아웃 재질 (체인 링크 펜스 / 지면·수면 꽃잎)
  const tex = (key, rep = 1) => { const t = CANOPY_TEX[key]; if (!t) return null; const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rep, rep); return c; };
  TMAT.chain = new THREE.MeshStandardMaterial({ map: tex('chainlink', 1 / 1.2), color: 0xbfc4c4, metalness: 0.5, roughness: 0.5, alphaTest: 0.45, side: THREE.DoubleSide });
  TMAT.chain.userData = { noShadow: false };
  TMAT.petalGround = new THREE.MeshStandardMaterial({ map: tex('sakura_ground', 1 / 2), transparent: true, alphaTest: 0.35, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 });
  TMAT.petalGround.userData = { noShadow: true, noHit: true };
  TMAT.ready = true;
}
function signCanvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function vendingTexture(seed) {
  const rnd = mulberry32(seed);
  return signCanvas(256, 512, (g, w, h) => {
    const body = ['#f4f4f2', '#1f5fae', '#c8302c', '#f4f4f2'][Math.floor(rnd() * 4)];
    g.fillStyle = body; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9f2f7'; g.fillRect(14, 20, w - 28, 250);                          // 진열창
    for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) {                           // 캔·병 모형
      const x = 22 + i * 31, y = 30 + r * 60, cols = ['#d23a2e', '#2e7bd0', '#f2c230', '#3aa35a', '#ffffff', '#8a4b2a', '#e86aa0'];
      g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(x, y, 22, 40);
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(x + 3, y + 3, 5, 34);
      g.fillStyle = '#e04030'; g.fillRect(x + 4, y + 46, 14, 6);                         // 버튼
    }
    g.fillStyle = '#20252a'; g.fillRect(40, 300, w - 80, 60);                            // 동전·지폐구
    g.fillStyle = '#10151a'; g.fillRect(30, 420, w - 60, 60);                            // 배출구
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 18, h);
  });
}

// ── 2층 단독주택 kit (#319): 기초 밴드 + 벽(창·문 개구부) + 알루미늄 새시·유리·커튼·방범창살·창 차양·덧문 두껍닫이 + 층 띠 + 발코니(빨래·이불)
// + 지붕(박공 u/v·모임·평지붕+태양광) + 처마 물받이·선홈통 + 현관 차양·계단 + 대지(블록 담·생울타리·대문 기둥·우편함·카포트·정원·화분·자전거).
// enter=true 면 1층 실내(바닥·천장·칸막이·가구·조명) + 문 열림 + 루팅 스팟. 이동 콜라이더는 1층 벽·담·가구만(2층·지붕 도달 불가).
const WALL_MATS = ['sidingCream', 'sidingGray', 'sidingBlue', 'sidingPink', 'sidingMint', 'plasterWhite', 'plasterBeige', 'sidingCream', 'plasterWhite', 'sidingBrown'];
const ROOF_MATS = ['kawara', 'kawara', 'kawaraBlue', 'kawaraBrown', 'kawara'];
let townLights = 0;
const TOWN_PROPS = []; // flush 뒤 placeProp 할 GLB 부착물 [key, x, y, z, opts]

function buildTownHouse(B, lot) {
  const { cx, cz, W: LW, D: LD, face, seed } = lot;
  const rnd = mulberry32(seed), F = lotFrame(cx, cz, face), pick = (a) => a[Math.floor(rnd() * a.length)];
  const hw = Math.min(LW - 3.6, 7.4 + rnd() * 2.8), hd = Math.min(LD - 5.4, 6.6 + rnd() * 2.4);
  const side = rnd() < 0.5 ? -1 : 1;                                     // 집을 붙이는 쪽(반대쪽 = 카포트)
  const u0 = side * (LW / 2 - 0.9 - hw / 2), v0 = -LD / 2 + 1.2 + hd / 2;
  const floors = rnd() < 0.88 ? 2 : 1, H1 = 2.8, H2 = 2.7, H = floors === 2 ? H1 + H2 : H1;
  const wm = lot.wall || pick(WALL_MATS), rm = pick(ROOF_MATS), t = 0.2;
  const frameM = rnd() < 0.6 ? TMAT.alu : TMAT.aluSilver, trim = rnd() < 0.5 ? TMAT.trimWhite : TMAT.trimDark;
  const rr = rnd(), roof = floors === 1 ? 'gableU' : rr < 0.42 ? 'gableU' : rr < 0.6 ? 'gableV' : rr < 0.82 ? 'hip' : 'flat';
  const enter = !!lot.enter;
  notePlacement('house', ...F.pos(u0, v0), (face % 2 ? hd : hw) / 2 + 0.3, (face % 2 ? hw : hd) / 2 + 0.3, 0, H + 3);
  const faces = [
    { ax: 'u', c: v0 + hd / 2, n: 1, len: hw + t, mid: u0, key: 'front' },
    { ax: 'u', c: v0 - hd / 2, n: -1, len: hw + t, mid: u0, key: 'back' },
    { ax: 'v', c: u0 - hw / 2, n: -1, len: hd - t, mid: v0, key: 'left' },
    { ax: 'v', c: u0 + hw / 2, n: 1, len: hd - t, mid: v0, key: 'right' },
  ];
  const fbox = (f, along, y, off, len, h, th, m, col = false) => {
    if (f.ax === 'u') F.box(B, f.mid + along, y, f.c + f.n * off, len, h, th, m, col);
    else F.box(B, f.c + f.n * off, y, f.mid + along, th, h, len, m, col);
  };
  const fpos = (f, along, off) => (f.ax === 'u' ? F.pos(f.mid + along, f.c + f.n * off) : F.pos(f.c + f.n * off, f.mid + along));
  const fyaw = (f) => F.yaw(f.ax === 'u' ? (f.n > 0 ? 0 : Math.PI) : (f.n > 0 ? Math.PI / 2 : -Math.PI / 2));
  // 벽 + 개구부: ops [{at,w,s,hh,kind}] (s=창턱, hh=상단, 층 바닥 기준)
  const wall = (f, y0, h, ops, col) => {
    let prev = -f.len / 2;
    for (const o of [...ops].sort((a, b) => a.at - b.at)) {
      const a = o.at - o.w / 2, b = o.at + o.w / 2;
      if (a - prev > 0.02) fbox(f, (prev + a) / 2, y0 + h / 2, 0, a - prev, h, t, wm, col);
      if (o.s > 0.01) fbox(f, o.at, y0 + o.s / 2, 0, o.w, o.s, t, wm, col);
      if (o.hh < h - 0.01) fbox(f, o.at, y0 + (o.hh + h) / 2, 0, o.w, h - o.hh, t, wm, col);
      prev = b;
    }
    if (f.len / 2 - prev > 0.02) fbox(f, (prev + f.len / 2) / 2, y0 + h / 2, 0, f.len / 2 - prev, h, t, wm, col);
  };
  const windowAt = (f, y0, o, inside) => { // 새시 + 유리 + (실내 없는 곳) 어두운 배킹·커튼 + 창턱 + 선택 디테일
    const h = o.hh - o.s, yc = y0 + o.s + h / 2;
    fbox(f, o.at, y0 + o.hh + 0.03, t / 2 - 0.02, o.w + 0.1, 0.06, 0.09, frameM);
    fbox(f, o.at, y0 + o.s - 0.03, t / 2 - 0.02, o.w + 0.1, 0.06, 0.09, frameM);
    for (const sx of [-1, 1]) fbox(f, o.at + sx * (o.w / 2 + 0.02), yc, t / 2 - 0.02, 0.06, h, 0.09, frameM);
    if (o.w > 1.1) fbox(f, o.at, yc, -0.01, 0.05, h, 0.06, frameM);                     // 미서기 가운데 문선
    fbox(f, o.at, yc, -0.02, o.w - 0.04, h - 0.04, 0.02, TMAT.glass);
    if (!inside) {
      fbox(f, o.at, yc, -t / 2 - 0.16, o.w + 0.1, h + 0.1, 0.03, TMAT.interior);
      const cw = o.w * (0.28 + rnd() * 0.25), cs = rnd() < 0.5 ? -1 : 1;
      if (rnd() < 0.8) fbox(f, o.at + cs * (o.w / 2 - cw / 2), yc, -t / 2 - 0.08, cw, h - 0.06, 0.02, pick(TMAT.curtain));
    }
    if (o.s > 0.3) fbox(f, o.at, y0 + o.s - 0.07, t / 2 + 0.05, o.w + 0.16, 0.04, 0.14, frameM);   // 창턱 물끊기
    if (o.s > 0.3 && (y0 > 0 || o.s > 1.0) && rnd() < 0.5) { const sh = Math.min(1.3, y0 + o.s - 0.2); fbox(f, o.at, y0 + o.s - 0.1 - sh / 2, t / 2 + 0.006, o.w * 0.95, sh, 0.004, TMAT.streak); } // 빗물 자국 (#322)
    if (o.kind === 'small') for (let i = 0; i < 4; i++) fbox(f, o.at - o.w / 2 + o.w * (i + 0.5) / 4, yc, t / 2 + 0.07, 0.025, h + 0.04, 0.025, frameM); // 방범 창살
    else if (rnd() < 0.55) fbox(f, o.at, y0 + o.hh + 0.16, t / 2 + 0.22, o.w + 0.34, 0.05, 0.44, trim);      // 창 차양
    if (o.kind === 'big' && rnd() < 0.4) {                                                                   // 덧문 두껍닫이(戸袋)
      const sd = rnd() < 0.5 ? -1 : 1; fbox(f, o.at + sd * (o.w / 2 + 0.47), yc + 0.05, t / 2 + 0.12, 0.86, h + 0.1, 0.24, wm);
      fbox(f, o.at, y0 + o.hh + 0.07, t / 2 + 0.12, o.w + 0.1, 0.08, 0.24, frameM);                        // 레일
    }
  };
  // ── 개구부 계획 ──
  const doorAt = -side * (hw / 2 - 0.9);               // 현관은 카포트 쪽 끝
  const bigAt = side * (hw / 2 - 1.3);
  const ops1 = {
    front: [{ at: doorAt, w: 0.95, s: 0, hh: 2.1, kind: 'door' }, { at: bigAt, w: 1.75, s: 0.35, hh: 2.05, kind: 'big' }],
    back: [{ at: -hw * 0.22, w: 1.2, s: 0.9, hh: 2.0, kind: 'win' }, { at: hw * 0.28, w: 0.7, s: 1.2, hh: 1.9, kind: 'small' }],
    left: [{ at: (rnd() - 0.5) * hd * 0.4, w: rnd() < 0.5 ? 0.7 : 1.2, s: 1.0, hh: 2.0, kind: rnd() < 0.5 ? 'small' : 'win' }],
    right: [{ at: (rnd() - 0.5) * hd * 0.4, w: 0.7, s: 1.2, hh: 1.9, kind: 'small' }],
  };
  const balcony = floors === 2 && rnd() < 0.72, bw = Math.min(hw - 1.2, 3.6 + rnd() * 1.4), bAt = side * (hw / 2 - 0.6 - bw / 2) * 0.6;
  const ops2 = {
    front: balcony ? [{ at: bAt, w: 1.7, s: 0.05, hh: 2.0, kind: 'win' }, { at: bAt - side * (bw / 2 + 1.2), w: 1.1, s: 0.9, hh: 1.95, kind: 'win' }] : [{ at: -hw * 0.22, w: 1.5, s: 0.9, hh: 2.0, kind: 'win' }, { at: hw * 0.25, w: 1.2, s: 0.9, hh: 2.0, kind: 'win' }],
    back: [{ at: -hw * 0.2, w: 1.5, s: 0.9, hh: 2.0, kind: 'win' }, { at: hw * 0.26, w: 0.9, s: 1.0, hh: 1.9, kind: 'win' }],
    left: [{ at: 0, w: 1.1, s: 0.9, hh: 1.95, kind: 'win' }],
    right: [{ at: (rnd() - 0.5) * 1.2, w: 0.8, s: 1.1, hh: 1.9, kind: 'small' }],
  };
  ops2.front = ops2.front.filter((o) => Math.abs(o.at) + o.w / 2 < hw / 2 - 0.3);
  // ── 1층 ──
  for (const f of faces) {
    const ops = ops1[f.key].filter((o) => Math.abs(o.at) + o.w / 2 < f.len / 2 - 0.25);
    wall(f, 0, H1, ops, true);
    for (const o of ops) {
      if (o.kind === 'door') {
        fbox(f, o.at, o.hh + 0.04, t / 2 - 0.02, o.w + 0.14, 0.08, 0.1, frameM);
        for (const sx of [-1, 1]) fbox(f, o.at + sx * (o.w / 2 + 0.03), o.hh / 2, t / 2 - 0.02, 0.07, o.hh, 0.1, frameM);
        const dm = rnd() < 0.5 ? TMAT.doorWood : TMAT.doorMetal;
        if (enter) fbox(f, o.at - o.w / 2 + 0.05, 1.03, -t / 2 - 0.45, 0.05, 2.04, 0.9, dm);   // 안으로 열린 문짝(벽에 수직) — fbox 는 len/th 가 벽 좌표라 len=두께
        else { fbox(f, o.at, 1.03, 0, o.w - 0.04, 2.06, 0.06, dm, true); fbox(f, o.at + o.w * 0.34, 1.0, 0.06, 0.04, 0.25, 0.05, TMAT.aluSilver); }
        fbox(f, o.at, 2.42, t / 2 + 0.46, 1.7, 0.08, 0.92, trim);                    // 현관 차양
        fbox(f, o.at, 0.08, t / 2 + 0.55, 1.6, 0.16, 1.1, 'concrete', true);          // 현관 디딤
        fbox(f, o.at + (o.w / 2 + 0.25), 2.05, t / 2 + 0.05, 0.12, 0.16, 0.08, TMAT.lampGlow); // 현관등
      } else windowAt(f, 0, o, enter && o.kind !== 'small');
    }
    // 기초 밴드(문 구간 제외) + 층 띠
    const door = ops.find((o) => o.kind === 'door');
    const spans = door ? [[-f.len / 2, door.at - door.w / 2], [door.at + door.w / 2, f.len / 2]] : [[-f.len / 2, f.len / 2]];
    for (const [a, b] of spans) if (b - a > 0.05) fbox(f, (a + b) / 2, 0.19, 0.03, b - a + (a === -f.len / 2 ? 0.06 : 0) + (b === f.len / 2 ? 0.06 : 0), 0.38, t, 'concreteDark');
    if (floors === 2) fbox(f, 0, H1 + 0.02, t / 2 + 0.03, f.len + 0.06, 0.14, 0.06, trim);
  }
  // ── 2층 ──
  if (floors === 2) for (const f of faces) {
    const ops = ops2[f.key].filter((o) => Math.abs(o.at) + o.w / 2 < f.len / 2 - 0.25);
    wall(f, H1, H2, ops, false);
    for (const o of ops) windowAt(f, H1, o, false);
  }
  // 실내 없는 집: 1층 창 배킹이 없으면 속이 보이므로 1층 천장(=막음)만. 진입 집은 실내 구성
  const [hx, hz] = F.pos(u0, v0);
  if (enter) {
    F.box(B, u0, 0.02, v0, hw - t, 0.04, hd - t, 'woodfloor');
    F.box(B, u0, H1 - 0.04, v0, hw - t, 0.08, hd - t, TMAT.ceiling);
    const pv = v0 - hd * 0.12;                                          // 칸막이(가운데 문 1.0)
    for (const [a, b] of [[-hw / 2 + t / 2, -0.5], [0.5, hw / 2 - t / 2]]) F.box(B, u0 + (a + b) / 2, H1 / 2, pv, b - a, H1, 0.12, 'plasterWhite', true);
    F.box(B, u0, H1 - 0.35, pv, 1.0, 0.7, 0.12, 'plasterWhite');
    F.box(B, u0 - side * hw * 0.18, 0.37, v0 + hd * 0.2, 1.3, 0.05, 0.8, TMAT.doorWood, true);   // 탁자(상판·다리)
    for (const [du, dv] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) F.box(B, u0 - side * hw * 0.18 + du, 0.18, v0 + hd * 0.2 + dv, 0.05, 0.36, 0.05, TMAT.doorWood);
    F.box(B, u0 + side * hw * 0.2, 0.22, v0 + hd * 0.3, 1.9, 0.44, 0.8, pick(TMAT.curtain), true); // 소파
    F.box(B, u0 + side * hw * 0.2, 0.62, v0 + hd * 0.3 - 0.32, 1.9, 0.46, 0.18, pick(TMAT.curtain));
    F.box(B, u0 - hw / 2 + 0.45, 0.9, v0 - hd / 2 + 0.9, 0.55, 1.8, 1.4, TMAT.doorWood, true);    // 책장·찬장
    F.box(B, u0 + hw * 0.1, 0.45, v0 - hd / 2 + 0.45, 2.2, 0.9, 0.6, TMAT.trimWhite, true);       // 싱크대
    const [lx, lz] = F.pos(u0, v0 + hd * 0.15);
    TOWN_LOOT.push([lx, lz]);
    if (townLights < 8) { const L = new THREE.PointLight(0xffdcae, 5, Math.max(hw, hd) * 1.2, 2); L.position.set(lx, H1 - 0.4, lz); scene.add(L); townLights++; }
  } else if (floors === 2) F.box(B, u0, H1, v0, hw - t, 0.1, hd - t, TMAT.interior);
  // ── 발코니 ──
  if (balcony) {
    const fr = faces[0], by = H1, dep = 0.95, bal = rnd() < 0.55;          // bal: 벽형 난간(외벽재) / 알루 난간
    fbox(fr, bAt, by - 0.06, t / 2 + dep / 2, bw, 0.14, dep, trim);
    if (bal) { fbox(fr, bAt, by + 0.5, t / 2 + dep - 0.05, bw, 1.0, 0.1, wm); for (const sx of [-1, 1]) fbox(fr, bAt + sx * (bw / 2 - 0.05), by + 0.5, t / 2 + dep / 2, 0.1, 1.0, dep, wm); fbox(fr, bAt, by + 1.02, t / 2 + dep - 0.05, bw + 0.04, 0.05, 0.14, frameM); }
    else { for (let i = 0; i <= Math.round(bw / 0.12); i++) fbox(fr, bAt - bw / 2 + i * bw / Math.round(bw / 0.12), by + 0.5, t / 2 + dep - 0.04, 0.025, 0.96, 0.025, frameM); fbox(fr, bAt, by + 0.99, t / 2 + dep - 0.04, bw, 0.05, 0.06, frameM); for (const sx of [-1, 1]) fbox(fr, bAt + sx * bw / 2, by + 0.5, t / 2 + dep / 2, 0.05, 1.0, dep, frameM); }
    if (rnd() < 0.75) { // 빨래 건조대 + 빨래
      fbox(fr, bAt, by + 1.62, t / 2 + dep * 0.55, bw - 0.3, 0.035, 0.035, TMAT.aluSilver);
      for (const sx of [-1, 1]) fbox(fr, bAt + sx * (bw / 2 - 0.2), by + 1.7, t / 2 + dep * 0.28, 0.03, 0.03, dep * 0.55, TMAT.aluSilver);
      let a = bAt - bw / 2 + 0.35; while (a < bAt + bw / 2 - 0.5) { const cw = 0.35 + rnd() * 0.3, ch = 0.45 + rnd() * 0.35; fbox(fr, a + cw / 2, by + 1.6 - ch / 2, t / 2 + dep * 0.55, cw, ch, 0.02, pick(TMAT.fabric)); a += cw + 0.08 + rnd() * 0.2; }
    }
    if (bal && rnd() < 0.35) { const fw = bw * 0.42, fc = pick(TMAT.fabric); fbox(fr, bAt + (rnd() - 0.5) * 0.6, by + 0.78, t / 2 + dep + 0.03, fw, 0.62, 0.05, fc); fbox(fr, bAt + (rnd() - 0.5) * 0.3, by + 0.9, t / 2 + dep - 0.14, fw, 0.4, 0.05, fc); } // 이불 널기
    const [ax, az] = fpos(fr, bAt + side * (bw / 2 - 0.55), t / 2 + 0.35); TOWN_PROPS.push(['acUnit', ax, by + 0.02, az, { rotY: fyaw(fr), height: 0.62, keep: /^exterior_aircon_unit$/ }]);
  }
  // ── 지붕 ──
  const e = 0.5, e2 = 0.36, p = 0.38 + rnd() * 0.14, tp = Math.tan(p), yT = H;
  const gutter = (a0, a1, b, y, alongU) => { if (alongU) F.seg(B, a0, y, b, a1, y, b, 0.055, TMAT.trimDark); else F.seg(B, b, y, a0, b, y, a1, 0.055, TMAT.trimDark); };
  const pipe = (u, v, y) => F.seg(B, u, y, v, u, 0.1, v, 0.04, TMAT.trimDark);
  if (roof === 'gableU' || roof === 'gableV') {
    const along = roof === 'gableU', A = along ? hw : hd, S = along ? hd : hw, rise = (S / 2) * tp;
    const Ls = (S / 2 + e) / Math.cos(p), yc0 = yT + rise - ((S / 2 + e) / 2) * tp + 0.07 / Math.cos(p);
    for (const s of [-1, 1]) {
      const bOff = s * (S / 2 + e) / 2;
      if (along) F.boxR(B, u0, yc0, v0 + bOff, A + 2 * e2, 0.14, Ls, rm, s > 0 ? p : -p, 0);
      else F.boxR(B, u0 + bOff, yc0, v0, Ls, 0.14, A + 2 * e2, rm, 0, s > 0 ? -p : p);
      for (const q of [-1, 1]) { // 박공 끝 판(破風)
        if (along) F.boxR(B, u0 + q * (A / 2 + e2 + 0.02), yc0 - 0.03, v0 + bOff, 0.05, 0.26, Ls + 0.04, trim, s > 0 ? p : -p, 0);
        else F.boxR(B, u0 + bOff, yc0 - 0.03, v0 + q * (A / 2 + e2 + 0.02), Ls + 0.04, 0.26, 0.05, trim, 0, s > 0 ? -p : p);
      }
      const ye = yT - e * tp - 0.04, bE = s * (S / 2 + e);                   // 처마 물받이
      if (along) { gutter(u0 - A / 2 - e2, u0 + A / 2 + e2, v0 + bE, ye, true); pipe(u0 + side * (A / 2 - 0.2), v0 + s * (S / 2 + 0.12), ye); }
      else { gutter(v0 - A / 2 - e2, v0 + A / 2 + e2, u0 + bE, ye, false); pipe(u0 + s * (S / 2 + 0.12), v0 + (A / 2 - 0.2), ye); }
    }
    for (const q of [-1, 1]) { // 박공벽(삼각)
      const g = gableGeo(S, rise, t);
      if (along) { g.rotateY(-Math.PI / 2); F.geo(B, g, u0 + q * hw / 2, yT, v0, wm); } else F.geo(B, g, u0, yT, v0 + q * hd / 2, wm);
      if (rnd() < 0.5) { if (along) F.box(B, u0 + q * (hw / 2 + 0.11), yT + rise * 0.42, v0, 0.04, 0.34, 0.5, trim); else F.box(B, u0, yT + rise * 0.42, v0 + q * (hd / 2 + 0.11), 0.5, 0.34, 0.04, trim); } // 환기구
    }
    if (along) F.box(B, u0, yT + rise + 0.12, v0, A + 2 * e2 + 0.06, 0.16, 0.32, TMAT.ridge); else F.box(B, u0, yT + rise + 0.12, v0, 0.32, 0.16, A + 2 * e2 + 0.06, TMAT.ridge);
    if (rnd() < 0.2) { // 태양광 패널(앞 경사면)
      const pw = Math.min(A - 0.6, 4), pl = S / 2 * 0.7, pOff = (S / 2) * 0.45;
      if (along) F.boxR(B, u0, yT + rise - pOff * tp + 0.2, v0 + pOff, pw, 0.05, pl / Math.cos(p), TMAT.blue, p, 0);
    }
  } else if (roof === 'hip') {
    const { g, rise } = hipRoofGeo(hw / 2 + e, hd / 2 + e, p);
    F.geo(B, g, u0, yT - e * tp + 0.05, v0, rm);
    F.box(B, u0, yT - e * tp - 0.02, v0, hw + 2 * e, 0.06, hd + 2 * e, trim);              // 처마 반자
    F.box(B, u0, yT + rise - e * tp + 0.12, v0, Math.max(0.3, hw - hd) + 0.2, 0.14, 0.3, TMAT.ridge);
    const ye = yT - e * tp - 0.05;
    for (const s of [-1, 1]) { gutter(u0 - hw / 2 - e, u0 + hw / 2 + e, v0 + s * (hd / 2 + e), ye, true); }
    pipe(u0 + side * (hw / 2 + 0.12), v0 + hd / 2 + 0.12, ye);
  } else { // 평지붕(모던): 슬래브 + 파라펫 + 코핑 + 옥상 물탱크/실외기
    F.box(B, u0, yT + 0.1, v0, hw + 0.1, 0.2, hd + 0.1, 'concrete');
    for (const f of faces) { fbox(f, 0, yT + 0.35, 0, f.len + (f.ax === 'u' ? 0 : 0), 0.5, t, wm); fbox(f, 0, yT + 0.62, 0.02, f.len + 0.08, 0.05, t + 0.08, TMAT.aluSilver); }
    const [tx, tz] = F.pos(u0 - hw * 0.2, v0 - hd * 0.15); B.cyl(tx, yT + 0.75, tz, 0.45, 0.45, 1.1, TMAT.white, 12);
    pipe(u0 + side * (hw / 2 + 0.1), v0 + hd / 2 + 0.1, yT + 0.3);
  }
  // ── 인입선 부착점 + TV 안테나/위성 안테나 (#322) ──
  { const f0 = faces[0], [ax, az] = fpos(f0, -side * (hw / 2 - 0.35), t / 2 + 0.05); TOWN_HOUSES.push({ ax, ay: floors === 2 ? H1 + 2.25 : 2.5, az });
    fbox(f0, -side * (hw / 2 - 0.35), floors === 2 ? H1 + 2.25 : 2.5, t / 2 + 0.05, 0.08, 0.08, 0.1, TMAT.insulator); }
  if (rnd() < 0.62) {
    if (roof === 'flat') { const [x, z] = F.pos(u0 + hw * 0.25, v0 + hd * 0.2); tvAntenna(B, x, yT + 0.2, z, F.yaw(rnd())); }
    else if (roof === 'gableU' || roof === 'gableV') { const along = roof === 'gableU', rise = ((along ? hd : hw) / 2) * tp, [x, z] = along ? F.pos(u0 + side * hw * 0.28, v0) : F.pos(u0, v0 - hd * 0.28); tvAntenna(B, x, yT + rise + 0.18, z, F.yaw(rnd() * 3)); }
    else { const { rise } = { rise: Math.min(hw / 2 + e, hd / 2 + e) * tp }, [x, z] = F.pos(u0, v0); tvAntenna(B, x, yT - e * tp + rise + 0.15, z, F.yaw(rnd() * 3)); }
  }
  if (floors === 2 && rnd() < 0.18) { // 위성 안테나(측벽)
    const f = faces[side > 0 ? 2 : 3], [dx, dz] = fpos(f, hd * 0.2, t / 2 + 0.35), g = new THREE.SphereGeometry(0.34, 12, 6, 0, Math.PI * 2, 0, 0.9);
    g.rotateX(-Math.PI / 2); g.rotateY(fyaw(f) + 0.5); g.translate(dx, H1 + 1.6, dz); B.geo(dx, dz, TMAT.white, g);
    fbox(f, hd * 0.2, H1 + 1.45, t / 2 + 0.18, 0.05, 0.05, 0.34, TMAT.aluSilver);
  }
  // ── 측면 설비: 실외기(지면) · 급탕기 · 계량기 ──
  const sf = faces[side > 0 ? 3 : 2]; // 집이 붙은 쪽(담 쪽) 측벽 — 좁은 틈에 설비
  {
    const [ax, az] = fpos(sf, -hd * 0.1, t / 2 + 0.3); TOWN_PROPS.push(['acUnit', ax, 0, az, { rotY: fyaw(sf), height: 0.62, keep: /^exterior_aircon_unit$/ }]);
    fbox(sf, hd * 0.25, 0.9, t / 2 + 0.3, 0.7, 1.8, 0.55, TMAT.white);           // 급탕기
    fbox(sf, hd * 0.25, 1.83, t / 2 + 0.3, 0.72, 0.06, 0.57, TMAT.aluSilver);
    fbox(sf, -hd * 0.32, 1.5, t / 2 + 0.07, 0.3, 0.4, 0.14, TMAT.aluSilver);       // 가스 계량기
  }
  return { u0, v0, hw, hd, side, doorAt, F };
}

// 대지(외구): 담·대문·카포트·정원. lot.walls: {front:'block'|'hedge'|'fence', left, right, back}
function buildTownLot(B, lot) {
  const { cx, cz, W: LW, D: LD, face, seed } = lot, rnd = mulberry32(seed * 3 + 7), F = lotFrame(cx, cz, face), pick = (a) => a[Math.floor(rnd() * a.length)];
  if (lot.vacant) return buildVacantLot(B, lot, F, rnd);
  const h = buildTownHouse(B, lot);
  const style = lot.frontStyle || (rnd() < 0.55 ? 'block' : rnd() < 0.6 ? 'hedge' : 'fence');
  const fv = LD / 2 - 0.1, gateU = h.u0 + h.doorAt, carSide = -h.side, carU = carSide * (LW / 2 - 1.8);
  const gaps = [[gateU - 0.65, gateU + 0.65], [carU - 1.5, carU + 1.5]].sort((a, b) => a[0] - b[0]);
  const wallRun = (a0, a1, v, alongU, kind, hgt = 1.2) => { // 담 한 줄 (로컬 u 또는 v 방향)
    const len = a1 - a0; if (len < 0.1) return; const mid = (a0 + a1) / 2;
    const put = (y, hh, th, m, col) => { if (alongU) F.box(B, mid, y, v, len, hh, th, m, col); else F.box(B, v, y, mid, th, hh, len, m, col); };
    if (kind === 'hedge') { put(0.1, 0.2, 0.3, 'blockwall', true); put(0.2 + 0.6, 1.2, 0.62, 'hedge', true); }
    else if (kind === 'fence') { put(0.3, 0.6, 0.15, 'blockwall', true); put(0.63, 0.06, 0.2, 'concrete'); put(1.0, 0.7, 0.05, TMAT.alu, true); for (let s = a0 + 0.1; s < a1; s += 0.14) { if (alongU) F.box(B, s, 1.0, v, 0.03, 0.66, 0.06, TMAT.alu); else F.box(B, v, 1.0, s, 0.06, 0.66, 0.03, TMAT.alu); } put(1.36, 0.04, 0.08, TMAT.alu); }
    else { put(hgt / 2, hgt, 0.15, 'blockwall', true); put(hgt + 0.03, 0.06, 0.2, 'concrete'); }
    if (kind !== 'hedge') for (const o of [-0.078, 0.078]) { if (alongU) F.box(B, mid, 0.22, v + o, len, 0.44, 0.004, TMAT.grime); else F.box(B, v + o, 0.22, mid, 0.004, 0.44, len, TMAT.grime); } // 담 밑 이끼·때 (#322)
    for (let q = a0 + 0.4; q < a1 - 0.2; q += 1.1) if (rnd() < 0.22) { const o = rnd() < 0.5 ? 0.2 : -0.2; TOWN_WEEDS.push(alongU ? F.pos(q, v + o) : F.pos(v + o, q)); }
    if (kind === 'block' && len > 3 && rnd() < 0.16) { const at = a0 + len * (0.25 + rnd() * 0.5), w = 1.4 + rnd() * 1.6, hh = 0.9 + rnd() * 0.5, o = rnd() < 0.5 ? 0.09 : -0.09, [x, z] = alongU ? F.pos(at, v + o) : F.pos(v + o, at); TOWN_IVY.push([x, hgt - hh / 2 + 0.05, z, alongU ? F.yaw(o > 0 ? 0 : Math.PI) : F.yaw(o > 0 ? Math.PI / 2 : -Math.PI / 2), w, hh]); } // 담쟁이
  };
  // 앞담: 대문·카포트 개구부로 분절
  let prev = -LW / 2;
  for (const [a, b] of gaps) { wallRun(prev, Math.max(prev, a), fv, true, style); prev = Math.max(prev, b); }
  wallRun(prev, LW / 2, fv, true, style);
  for (const s of [gateU - 0.8, gateU + 0.8]) { F.box(B, s, 0.68, fv, 0.32, 1.36, 0.32, style === 'hedge' ? 'blockwall' : pick(['blockwall', 'brickCity', 'concrete']), true); F.box(B, s, 1.39, fv, 0.36, 0.06, 0.36, 'concrete'); } // 대문 기둥
  F.box(B, gateU - 0.8, 1.05, fv + 0.17, 0.22, 0.08, 0.02, TMAT.trimDark);                      // 문패
  F.box(B, gateU + 0.8, 0.95, fv + 0.19, 0.3, 0.32, 0.1, pick([TMAT.red, TMAT.aluSilver, TMAT.trimDark, TMAT.green])); // 우편함
  F.box(B, gateU + 0.8, 1.2, fv + 0.17, 0.1, 0.16, 0.04, TMAT.aluSilver);                       // 인터폰
  F.box(B, gateU - 0.45, 0.6, fv - 0.5, 0.04, 1.1, 0.6, TMAT.alu);                               // 열린 대문짝(안쪽으로 젖힘)
  // 측·후면 담 (공유 경계는 한 번만)
  if (lot.left) wallRun(-LD / 2, LD / 2 - 0.1, -LW / 2 + 0.08, false, 'block');
  if (lot.right) wallRun(-LD / 2, LD / 2 - 0.1, LW / 2 - 0.08, false, 'block');
  if (lot.back) wallRun(-LW / 2, LW / 2, -LD / 2 + 0.08, true, rnd() < 0.3 ? 'fence' : 'block', 1.5);
  // 어프로치(현관까지 판석) + 카포트
  const doorV = h.v0 + h.hd / 2;
  for (let v = doorV + 1.15; v < fv - 0.2; v += 0.62) F.box(B, gateU + (rnd() - 0.5) * 0.08, 0.025, v, 0.55, 0.05, 0.48, 'paving');
  const cpD = Math.min(5.4, LD - 1.4), cpV = fv - cpD / 2 - 0.1;
  F.box(B, carU, 0.03, cpV, 2.9, 0.06, cpD, 'concrete');
  if (rnd() < 0.55) { // 카포트 지붕(폴리카보네이트)
    for (const dv of [-cpD / 2 + 0.3, cpD / 2 - 0.3]) F.box(B, carU - carSide * 1.4, 1.2, cpV + dv, 0.09, 2.4, 0.09, TMAT.aluSilver, true);
    F.boxR(B, carU, 2.45, cpV, 3.1, 0.04, cpD + 0.2, TMAT.polycarb, 0, carSide * 0.05);
    F.box(B, carU - carSide * 1.45, 2.42, cpV, 0.08, 0.1, cpD + 0.2, TMAT.aluSilver);
  }
  const [px, pz] = F.pos(carU, cpV);
  if (rnd() < 0.35) TOWN_PROPS.push(['@car', px, 0, pz, { rotY: F.yaw(rnd() < 0.5 ? 0 : Math.PI) }]);
  else if (rnd() < 0.7) townBike(B, ...F.pos(carU + carSide * 0.6, fv - 1.2), F.yaw(Math.PI / 2 + (rnd() - 0.5) * 0.3), seed);
  // 정원: 흙 + 풀 카드 + 작은 나무/벚나무 + 화분
  const gU = h.side * (LW / 2 - 1.6), gTop = doorV + 0.6;
  if (fv - gTop > 1.4) {
    const [gx, gz] = F.pos(h.u0 + h.side * 0.8, (gTop + fv) / 2);
    const gw = Math.min(h.hw - 1, 4), gd = fv - gTop - 0.3;
    F.box(B, h.u0 + h.side * 0.8, 0.02, (gTop + fv) / 2, gw, 0.04, gd, 'gardenSoil');
    lot.garden = { x: gx, z: gz, w: gw, d: gd };
  }
  for (let i = 0; i < 3 + Math.floor(rnd() * 3); i++) { // 화분(현관 앞)
    const [x, z] = F.pos(gateU + (i - 1.5) * 0.36 + (rnd() - 0.5) * 0.1, doorV + 0.85 + rnd() * 0.3), r = 0.12 + rnd() * 0.08;
    B.cyl(x, r * 0.9, z, r, r * 0.75, r * 1.8, rnd() < 0.6 ? TMAT.terracotta : TMAT.trimDark, 10);
    lot.pots = lot.pots || []; lot.pots.push([x, z, r * 1.8]);
  }
  return h;
}
function buildVacantLot(B, lot, F, rnd) { // 空き地: 잡초 흙 + 로프 울타리 + 방치 타이어·봉투 / 텃밭
  const { W: LW, D: LD } = lot;
  F.box(B, 0, 0.015, 0, LW - 0.4, 0.03, LD - 0.4, 'gardenSoil');
  lot.weeds = true;
  const fv = LD / 2 - 0.2;
  for (let u = -LW / 2 + 0.4; u <= LW / 2 - 0.3; u += 2.2) { F.box(B, u, 0.45, fv, 0.08, 0.9, 0.08, TMAT.trimWhite, true); }
  F.seg(B, -LW / 2 + 0.4, 0.8, fv, LW / 2 - 0.4, 0.75, fv, 0.012, TMAT.yellow);
  F.seg(B, -LW / 2 + 0.4, 0.45, fv, LW / 2 - 0.4, 0.42, fv, 0.012, TMAT.yellow);
  if (rnd() < 0.5) for (let i = 0; i < 4; i++) F.box(B, (i - 1.5) * 1.6, 0.12, -1 + (rnd() - 0.5), 1.1, 0.24, LD * 0.5, 'gardenSoil'); // 텃밭 이랑
  const [x, z] = F.pos((rnd() - 0.5) * LW * 0.5, (rnd() - 0.5) * LD * 0.4);
  TOWN_PROPS.push(['tyre', x, 0, z, { rotY: rnd() * 6 }]);
}
function townBike(B, x, z, yaw, seed) { // 절차 자전거(마마차리): 바퀴 2 + 프레임 + 안장 + 바구니. 콜라이더 없음
  const rnd = mulberry32(seed + 91), col = [TMAT.aluSilver, TMAT.red, TMAT.blue, TMAT.white, TMAT.trimDark][Math.floor(rnd() * 5)];
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (a, y) => _tv(x + a * s, y, z + a * c);
  for (const a of [-0.55, 0.55]) { const g = new THREE.TorusGeometry(0.31, 0.022, 6, 18); g.rotateY(yaw + Math.PI / 2); const p = P(a, 0.33); g.translate(p.x, p.y, p.z); B.geo(x, z, TMAT.rubber, g); }
  for (const [a0, y0, a1, y1] of [[-0.55, 0.33, -0.05, 0.36], [-0.05, 0.36, 0.42, 0.78], [-0.05, 0.36, -0.2, 0.8], [0.55, 0.33, 0.42, 0.9], [-0.55, 0.33, -0.2, 0.8]]) B.seg(P(a0, y0), P(a1, y1), 0.018, col);
  { const p = P(-0.22, 0.86); B.box(p.x, p.y, p.z, 0.12, 0.05, 0.12, TMAT.trimDark); }
  { const p = P(0.62, 0.86); B.boxR(p.x, p.y, p.z, 0.34, 0.24, 0.3, TMAT.aluSilver, 0, yaw, 0); }
}

// ── 개천 (#319): 트렌치 바닥(젖은 자갈) + 석축 벽(이끼 띠·물빼기 구멍) + 코핑 + 녹색 난간 + 수면(노멀 흐름) + 꽃잎 뗏목 + 다리 + 계단 호안 ──
function buildTownCanal(B) {
  const C = TOWN.canal, L = WORLD_HALF, rnd = mulberry32(3191);
  const zc = (C.z0 + C.z1) / 2, cw = C.z1 - C.z0;
  B.box(0, C.bed - 0.1, zc, L * 2, 0.2, cw, 'gravelWet');
  // 벽 구간: 다리·계단 참 제외
  const gapsFor = (side) => {
    const g = TOWN.bridges.map(([a, b]) => [a, b]);
    for (const r of TOWN.ramps) if (r.side === side) g.push([r.x0 - TOWN.landing, r.x0]);
    return g.sort((a, b) => a[0] - b[0]);
  };
  for (const side of [-1, 1]) {
    const zi = side < 0 ? C.z0 : C.z1, zw = zi + side * 0.3, zOut = zi + side * 0.6; // 벽 중심(0.6 두께, 수로 바깥쪽)
    let prev = -L;
    const run = (a, b) => {
      if (b - a < 0.2) return; const m = (a + b) / 2, len = b - a;
      B.box(m, (C.bed - 0.2 + 0.35) / 2, zw, len, 0.35 - C.bed + 0.2, 0.6, 'canalStone');
      colliders.push(axisCollider(a, b, C.bed - 0.3, 1.1, Math.min(zi, zOut), Math.max(zi, zOut)));
      B.box(m, 0.41, zw, len, 0.12, 0.74, 'concrete');                                            // 코핑
      B.box(m, C.bed + 0.3, zi - side * 0.012, len, 0.62, 0.02, TMAT.moss);                        // 수위 이끼 띠
      for (let x = a + 1.5; x < b - 0.5; x += 3.2) B.box(x, -0.9, zi - side * 0.012, 0.1, 0.1, 0.02, TMAT.interior); // 물빼기 구멍
      for (let x = a + 0.3; x <= b - 0.2; x += 1.9) B.box(x, 0.8, zw - side * 0.05, 0.05, 0.68, 0.05, TMAT.rail); // 난간 기둥
      for (const y of [0.78, 1.12]) B.box(m, y, zw - side * 0.05, len - 0.2, 0.045, 0.045, TMAT.rail);
    };
    for (const [a, b] of gapsFor(side)) { run(prev, a); prev = Math.max(prev, b); }
    run(prev, L);
  }
  // 계단 호안 (램프): 계단 블록 + 안쪽 난간(콜라이더) — 지형은 townTerrain 이 매끈한 경사로 처리
  for (const r of TOWN.ramps) {
    const zin = r.side < 0 ? C.z0 : C.z1, zr = zin - r.side * TOWN.rampW / 2, zEdge = zin - r.side * TOWN.rampW;
    B.box(r.x0 - TOWN.landing / 2, (C.bed - 0.2) / 2, zr, TOWN.landing, -C.bed + 0.2 - 0.0, TOWN.rampW, 'concrete');
    const N = 10;
    for (let i = 0; i < N; i++) {
      const top = C.bed * (i + 0.5) / N + 0.02, x = r.x0 + TOWN.rampLen * (i + 0.5) / N;
      B.box(x, (top + C.bed - 0.2) / 2, zr, TOWN.rampLen / N + 0.01, top - C.bed + 0.2, TOWN.rampW, 'concrete');
    }
    const xa = r.x0 - TOWN.landing, xb = r.x0 + TOWN.rampLen - 1.0;
    colliders.push(axisCollider(xa, xb, C.bed - 0.3, 1.0, Math.min(zEdge, zEdge - r.side * 0.12), Math.max(zEdge, zEdge - r.side * 0.12)));
    const hy = (x) => (x <= r.x0 ? 0 : C.bed * Math.min(1, (x - r.x0) / TOWN.rampLen)) + 0.95;
    for (let x = xa + 0.1; x <= xb; x += 1.2) B.box(x, hy(x) - 0.47, zEdge, 0.05, 0.95, 0.05, TMAT.rail);
    B.seg(_tv(xa, hy(xa), zEdge), _tv(r.x0, hy(r.x0), zEdge), 0.025, TMAT.rail);
    B.seg(_tv(r.x0, hy(r.x0), zEdge), _tv(xb, hy(xb), zEdge), 0.025, TMAT.rail);
  }
  // 다리: 도로교(콘크리트 상판 + 아스팔트 + 난간 파라펫) / 보행교(목재 데크 + 철 난간). 다리 밑 = 수문 격자(콜라이더)
  for (const [a, b] of TOWN.roadBridges) {
    const m = (a + b) / 2, w = b - a;
    B.box(m, -0.25, zc, w, 0.5, cw + 1.4, 'concrete');
    B.box(m, 0.0175, zc, w - 0.8, 0.035, cw + 1.4, 'asphaltTown');
    for (const x of [a + 0.2, b - 0.2]) {
      B.box(x, 0.45, zc, 0.35, 0.9, cw + 1.6, 'concrete', true);
      B.box(x, 0.93, zc, 0.42, 0.06, cw + 1.7, 'concrete');
      B.box(x, 0.2, zc, 0.36, 0.04, cw + 1.62, TMAT.moss);
    }
    B.box(m, -0.58, zc, w - 0.3, 0.16, 0.5, 'concreteStain');                                   // 거더
  }
  for (const [a, b] of TOWN.footBridges) {
    const m = (a + b) / 2, w = b - a;
    B.box(m, -0.12, zc, w, 0.24, cw + 1.4, TMAT.shrineWood);
    for (let z = C.z0 - 0.6; z < C.z1 + 0.7; z += 0.22) B.box(m, 0.005, z, w - 0.1, 0.012, 0.18, 'woodfloor');
    for (const x of [a + 0.06, b - 0.06]) {
      colliders.push(axisCollider(x - 0.06, x + 0.06, -0.2, 1.1, C.z0 - 0.7, C.z1 + 0.7));
      for (let z = C.z0 - 0.6; z <= C.z1 + 0.65; z += 1.1) B.box(x, 0.52, z, 0.05, 1.05, 0.05, TMAT.rail);
      B.box(x, 1.05, zc, 0.07, 0.05, cw + 1.4, TMAT.rail); B.box(x, 0.55, zc, 0.03, 0.03, cw + 1.4, TMAT.rail);
    }
  }
  for (const [a, b] of TOWN.bridges) for (const x of [a, b]) { // 수문 격자
    colliders.push(axisCollider(x - 0.1, x + 0.1, C.bed - 0.3, -0.4, C.z0, C.z1));
    const g = metricPlane(cw, 1.55); g.rotateY(Math.PI / 2); g.translate(x, C.bed + 0.78, zc); B.geo(x, zc, TMAT.chain, g);
    B.box(x, -0.42, zc, 0.1, 0.1, cw, TMAT.rail);
  }
  // 수면: 흐르는 노멀 + 꽃잎 뗏목 (배치 밖 개별 메시)
  const wn = GROUND_TEX.water_nrm ? GROUND_TEX.water_nrm.clone() : null;
  if (wn) { wn.needsUpdate = true; wn.wrapS = wn.wrapT = THREE.RepeatWrapping; wn.repeat.set(L * 2 / 7, cw / 7); wn.colorSpace = THREE.NoColorSpace; }
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x344f4a, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.86, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.5 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, cw), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(0, C.water, zc); water.receiveShadow = true; scene.add(water);
  const pt = (CANOPY_TEX.sakura_raft || CANOPY_TEX.sakura_ground) ? (CANOPY_TEX.sakura_raft || CANOPY_TEX.sakura_ground).clone() : null;
  if (pt) { pt.needsUpdate = true; pt.wrapS = pt.wrapT = THREE.RepeatWrapping; pt.repeat.set(L * 2 / 2.2, cw / 2.2); }
  const raftMat = new THREE.MeshStandardMaterial({ map: pt, transparent: true, alphaTest: 0.3, depthWrite: false, roughness: 0.8, alphaMap: null });
  const raft = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, cw - 0.1), raftMat); raft.rotation.x = -Math.PI / 2; raft.position.set(0, C.water + 0.006, zc); raft.receiveShadow = true; scene.add(raft);
  return { water: wn, raft: pt };
}

// ── 도로·골목·산책로·측구·노면 표시 ──
function buildTownStreets(B) {
  const L = WORLD_HALF, rnd = mulberry32(3192), C = TOWN.canal;
  // 바닥: 개천 남·북 두 판(흙·자갈) — 지형 타일 대신 평면(동네는 평탄)
  const src = GROUND_TEX.gravel || GROUND_TEX.ground;
  if (src) {
    const tex = src.clone(); tex.needsUpdate = true; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const gm = new THREE.MeshStandardMaterial({ map: tex, color: 0xa29a8c, roughness: 1 });
    for (const [z0, z1] of [[-L - 12, C.z0 - 0.6], [C.z1 + 0.6, L + 12]]) {
      const g = new THREE.PlaneGeometry(L * 2 + 24, z1 - z0); g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L * 2 + 24) / 4, uv.getY(i) * (z1 - z0) / 4);
      const m = new THREE.Mesh(g, gm); m.position.set(0, 0, (z0 + z1) / 2); m.receiveShadow = true; m.userData.terrainTile = true; scene.add(m); obstacleMeshes.push(m);
    }
  }
  const skipCanal = (z0, z1) => [[z0, C.z0 - 0.6], [C.z1 + 0.6, z1]].filter(([a, b]) => b - a > 0.1);
  for (const [z0, z1] of TOWN.roadsEW) B.box(0, 0.015, (z0 + z1) / 2, L * 2, 0.03, z1 - z0, 'asphaltTown');
  for (const [x0, x1] of TOWN.roadsNS) for (const [a, b] of skipCanal(-L, L)) B.box((x0 + x1) / 2, 0.0175, (a + b) / 2, x1 - x0, 0.035, b - a, 'asphaltTown');
  for (const [z0, z1] of TOWN.alleys) for (const [bx0, bx1] of TOWN.blocksX) {
    if (z0 < 0 && bx0 === -41.5) continue; if (z0 < 0 && bx0 === 46.5) continue; // 공원·신사 블록 관통 안 함
    B.box((bx0 + bx1) / 2, 0.012, (z0 + z1) / 2, bx1 - bx0 + 0.2, 0.024, z1 - z0, 'concrete');
  }
  // 산책로(개천 양안) — 포장
  B.box(0, 0.02, (-4.5 + C.z0 - 0.6) / 2, L * 2, 0.04, C.z0 - 0.6 + 4.5, 'paving');
  B.box(0, 0.02, (C.z1 + 0.6 + 12) / 2, L * 2, 0.04, 12 - C.z1 - 0.6, 'paving');
  // 백선(가장자리 실선) + 중앙 점선(x=0 간선) + 측구(뚜껑 콘크리트·격자)
  const nsCut = (x) => TOWN.roadsNS.some(([a, b]) => x > a - 1.2 && x < b + 1.2);
  for (const [z0, z1] of TOWN.roadsEW) for (const z of [z0 + 0.35, z1 - 0.35]) {
    for (let x = -L; x < L; x += 3) { if (nsCut(x + 1.5)) continue; B.box(x + 1.5, 0.036, z, 3, 0.01, 0.14, TMAT.whiteLine); }
  }
  for (const [x0, x1] of TOWN.roadsNS) for (const x of [x0 + 0.35, x1 - 0.35]) for (const [a, b] of skipCanal(-L, L)) {
    for (let z = a; z < b - 0.1; z += 3) { if (TOWN.roadsEW.some(([p, q]) => z + 1.5 > p - 1.2 && z + 1.5 < q + 1.2)) continue; B.box(x, 0.041, z + 1.5, 0.14, 0.01, 3, TMAT.whiteLine); }
  }
  for (const [a, b] of skipCanal(-L, L)) for (let z = a + 1; z < b - 3; z += 6) { if (TOWN.roadsEW.some(([p, q]) => z + 1.5 > p - 2 && z + 1.5 < q + 2)) continue; B.box(0, 0.041, z + 1.5, 0.12, 0.01, 3, TMAT.whiteLine); }
  for (const [z0, z1] of TOWN.roadsEW) for (const [z, s] of [[z0 - 0.2, -1], [z1 + 0.2, 1]]) {   // 측구: 도로 바깥 0.4m
    for (const [bx0, bx1] of TOWN.blocksX) {
      if (z > -5 && z < 12.5) continue; // 산책로 쪽은 없음
      B.box((bx0 + bx1) / 2, 0.05, z, bx1 - bx0, 0.1, 0.4, 'concrete');
      for (let x = bx0 + 2; x < bx1 - 1; x += 6) B.box(x, 0.105, z, 0.5, 0.02, 0.34, TMAT.trimDark);
    }
  }
  // 횡단보도: x=0 간선이 개천변 도로와 만나는 곳 + 공원 앞
  const zebra = (cx, cz, alongX, n, span) => { for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 0.9; if (alongX) B.box(cx + o, 0.043, cz, 0.45, 0.01, span, TMAT.whiteLine); else B.box(cx, 0.043, cz + o, span, 0.01, 0.45, TMAT.whiteLine); } };
  zebra(0, -11.2, true, 6, 2.6); zebra(0, 18.8, true, 6, 2.6); zebra(-22, -40, false, 5, 2.6); zebra(-5, -7, false, 5, 2.6);
  // 정지선: N-S 소로 → E-W 도로 진입
  for (const [x0, x1] of TOWN.roadsNS) for (const [z0, z1] of TOWN.roadsEW) for (const [z, s] of [[z0 - 0.6, -1], [z1 + 0.6, 1]]) {
    if (z > C.z0 - 6 && z < C.z1 + 6) continue;
    B.box((x0 + x1) / 2 + ((x1 - x0) / 4) * -s, 0.042, z, (x1 - x0) / 2 - 0.3, 0.01, 0.3, TMAT.whiteLine);
  }
  for (let i = 0; i < 46; i++) { // 아스팔트 보수 패치 (#322)
    const ew = rnd() < 0.6, r = ew ? TOWN.roadsEW[Math.floor(rnd() * 4)] : TOWN.roadsNS[Math.floor(rnd() * 3)], w = 0.8 + rnd() * 2.4, d = 0.6 + rnd() * 1.4;
    if (ew) { const x = (rnd() - 0.5) * 168, z = r[0] + 0.6 + rnd() * (r[1] - r[0] - 1.2); B.box(x, 0.031, z, w, 0.01, d, 'asphaltPatch'); }
    else { const z = (rnd() - 0.5) * 168; if (z > C.z0 - 1.5 && z < C.z1 + 1.5) continue; const x = r[0] + 0.6 + rnd() * (r[1] - r[0] - 1.2); B.box(x, 0.0355, z, d, 0.01, w, 'asphaltPatch'); }
  }
  for (const [x, z] of [[-5.5, -30], [22, -7.8], [-44, 26], [44, -20], [0, 36], [-22, 48], [60, 14.5], [-70, -40]]) TOWN_PROPS.push(['manhole', x, 0.02, z, { rotY: rnd() * 3 }]);
}

// ── 전신주 + 처진 전선 + 변압기 + 가로등 (#319) ──
function buildTownPoles(B) {
  const lines = [], wires = [], rnd = mulberry32(3193), C = TOWN.canal;
  const inRoad = (x, z) => TOWN.roadsNS.some(([a, b]) => x > a - 0.3 && x < b + 0.3) || TOWN.roadsEW.some(([a, b]) => z > a - 0.3 && z < b + 0.3);
  const lineAlongX = (z, x0, x1, step) => { const pts = []; for (let x = x0; x <= x1; x += step) { const xx = x + (rnd() - 0.5) * 3; if (TOWN.roadsNS.some(([a, b]) => xx > a - 2 && xx < b + 2)) continue; pts.push([xx, z, 'x']); } lines.push(pts); };
  const lineAlongZ = (x, z0, z1, step) => { const pts = []; for (let z = z0; z <= z1; z += step) { const zz = z + (rnd() - 0.5) * 3; if (TOWN.roadsEW.some(([a, b]) => zz > a - 2 && zz < b + 2) || (zz > C.z0 - 6 && zz < C.z1 + 6)) continue; pts.push([x, zz, 'z']); } lines.push(pts); };
  lineAlongX(-9.2, -82, 82, 25); lineAlongX(16.75, -82, 82, 25); lineAlongX(-42.2, -82, 82, 25); lineAlongX(50.2, -82, 82, 25); // 도로 가장자리(대지 쪽) 안
  lineAlongZ(2.72, -82, 82, 24); lineAlongZ(-46.2, -82, 82, 24); lineAlongZ(46.2, -82, 82, 24);
  let k = 0;
  const heads = [];
  for (const pts of lines) {
    const prevH = [];
    pts.forEach(([x, z, ax], i) => {
      if (!isPointOpen(x, z, 0.3)) { prevH.push(null); return; }
      B.cyl(x, 5, z, 0.12, 0.17, 10, TMAT.pole, 10, true);
      for (let j = 0; j < 4; j++) B.cyl(x, 0.3 + j * 0.4, z, 0.19, 0.19, 0.2, j % 2 ? TMAT.poleBlack : TMAT.poleYellow, 10); // 호랑이 표지
      const arm = (y, len) => { if (ax === 'x') B.box(x, y, z, 0.09, 0.09, len, TMAT.trimDark); else B.box(x, y, z, len, 0.09, 0.09, TMAT.trimDark); };
      arm(9.3, 1.7); arm(8.6, 1.3);
      const off = (o) => (ax === 'x' ? [x, z + o] : [x + o, z]);
      const hs = [];
      for (const [y, os] of [[9.42, [-0.7, 0, 0.7]], [8.72, [-0.5, 0.5]]]) for (const o of os) { const [ix, iz] = off(o); B.cyl(ix, y, iz, 0.035, 0.05, 0.14, TMAT.insulator, 6); hs.push([ix, y + 0.07, iz]); }
      hs.push([off(0.18)[0], 6.6, off(0.18)[1]]); // 통신선(아래)
      if (k % 3 === 1) { const [tx, tz] = off(-0.42); B.cyl(tx, 7.6, tz, 0.26, 0.26, 0.95, TMAT.transformer, 12); B.cyl(tx, 8.1, tz, 0.28, 0.28, 0.05, TMAT.transformer, 12); }
      if (k % 2 === 0) { // 방범등(도로 쪽)
        const [lx, lz] = off(0.9); const [ax1, az1] = off(0.1);
        B.seg(_tv(ax1, 5.4, az1), _tv(lx, 5.6, lz), 0.03, TMAT.pole);
        B.box(lx, 5.55, lz, 0.32, 0.1, 0.18, TMAT.lampGlow);
      }
      B.box(x, 3.2, z, 0.3, 0.5, 0.03, TMAT.aluSilver); // 번호판
      { const pm = TMAT.plates ? TMAT.plates[k % 3] : TMAT.white; if (ax === 'x') B.box(x, 2.3, z + (z < 0 ? 0.19 : -0.19), 0.24, 0.84, 0.015, pm); else B.box(x + (x > 0 ? -0.19 : 0.19), 2.3, z, 0.015, 0.84, 0.24, pm); } // 가로명판 — 도로 중심 쪽 (#322)
      prevH.push(hs); heads.push([x, z]); k++;
    });
    for (let i = 1; i < prevH.length; i++) { const a = prevH[i - 1], b = prevH[i]; if (!a || !b) continue; for (let j = 0; j < a.length; j++) wires.push([a[j], b[j]]); }
  }
  // 인입선 (#322): 각 주택 부착점 ← 가장 가까운 전신주(22m 이내) 저압선 높이
  let drops = 0;
  for (const h of TOWN_HOUSES) {
    let best = null, bd = 22;
    for (const [px, pz] of heads) { const d = Math.hypot(px - h.ax, pz - h.az); if (d < bd) { bd = d; best = [px, pz]; } }
    if (best) { wires.push([[best[0], 7.3, best[1]], [h.ax, h.ay, h.az]]); drops++; }
  }
  // 전선: 현수선 근사(포물선) → LineSegments 1개
  const P = [];
  for (const [a, b] of wires) {
    const span = Math.hypot(b[0] - a[0], b[2] - a[2]), sag = 0.3 + span * 0.014, N = 10;
    for (let i = 0; i < N; i++) for (const t of [i / N, (i + 1) / N]) P.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const wl = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b1c1e })); scene.add(wl);
  return heads;
}

// ── 벚나무 (소메이요시노): 낮게 갈라지는 굵은 줄기 + 수평으로 퍼지는 주지 + 넓은 반구 수관(벚꽃 카드). lean = 수관 치우침(개천 쪽) ──
function foliageNoFlip(m) { // 양면 재질의 뒷면 노멀 반전 제거 — 폴리지 노멀(바깥 방향)이 뒷면에서 뒤집혀 카드가 검게 보이는 문제 (#319)
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif'); };
  m.customProgramCacheKey = () => 'foliageNoFlip';
  return m;
}
function sphereNormals(g, cx, cy, cz) { // 폴리지 노멀: 정점 노멀 = 수관 중심에서 바깥 방향(+위쪽 가중) — 교차 카드가 구름처럼 매끈히 음영
  if (!g) return;
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - cx, (p.getY(i) - cy) + 1.2, p.getZ(i) - cz).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  n.needsUpdate = true;
}
const SAKURA_MAT = {};
function sakuraMat(key) { // 벚꽃 카드: 텍스처 자체 발광(약) — 얇은 꽃잎의 투과광, 수관 안쪽 그늘이 회보라로 탁해지는 것 방지
  if (!SAKURA_MAT[key]) { const t = CANOPY_TEX[key]; SAKURA_MAT[key] = foliageNoFlip(new THREE.MeshStandardMaterial({ map: t || null, color: t ? 0xffffff : 0xf0c8d4, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, vertexColors: true, emissive: 0xffffff, emissiveMap: t || null, emissiveIntensity: 0.16 })); }
  return SAKURA_MAT[key];
}
function placeSakura(fb, x, z, h, lx = 0, lz = 0, seed = 1) {
  const rnd = mulberry32(seed), gy = terrainH(x, z), V = (px, py, pz) => _tv(x + px, gy + py, z + pz), bm = matOf('barkSakura');
  const put = (g) => fb.put(x, z, 'barkSakura', bm, g);
  const r0 = 0.11 + h * 0.011, fk = h * (0.28 + rnd() * 0.08), fork = V(lx * 0.4, fk, lz * 0.4);
  { const b1 = V(lx * 0.1 + (rnd() - 0.5) * 0.25, fk * 0.38, lz * 0.1 + (rnd() - 0.5) * 0.25), b2 = V(lx * 0.25 + (rnd() - 0.5) * 0.3, fk * 0.72, lz * 0.25 + (rnd() - 0.5) * 0.3); // 곡선 줄기 3마디 + 뿌리 퍼짐 (#322)
    put(barkSeg(V(0, -0.2, 0), V(0, 0.35, 0), r0 * 1.45, r0 * 1.05, 9)); put(barkSeg(V(0, 0.3, 0), b1, r0 * 1.05, r0 * 0.95, 8)); put(barkSeg(b1, b2, r0 * 0.95, r0 * 0.85, 8)); put(barkSeg(b2, fork, r0 * 0.85, r0 * 0.78, 8)); }
  const rx = h * (0.58 + rnd() * 0.1), cyy = h * 0.66, ccx = lx * 1.3, ccz = lz * 1.3, cs = [];
  const nl = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2 + rnd() * 0.7, rr = rx * (0.55 + 0.3 * rnd());
    const end = V(ccx + Math.cos(a) * rr, cyy + (rnd() - 0.3) * h * 0.12, ccz + Math.sin(a) * rr);
    const mid = V(lx * 0.4 + Math.cos(a) * rr * 0.45, fk + (cyy - fk) * 0.55, lz * 0.4 + Math.sin(a) * rr * 0.45);
    put(barkSeg(fork, mid, r0 * 0.62, r0 * 0.4, 6)); put(barkSeg(mid, end, r0 * 0.4, 0.035, 5));
    cs.push([end.x - x, end.y - gy, end.z - z], [mid.x - x + (rnd() - 0.5), mid.y - gy + h * 0.1, mid.z - z + (rnd() - 0.5)]);
    if (rnd() < 0.6) { const a2 = a + (rnd() - 0.5) * 1.3, e2 = V(ccx + Math.cos(a2) * rx * 0.95, cyy - h * 0.12, ccz + Math.sin(a2) * rx * 0.95); put(barkSeg(mid, e2, 0.05, 0.02, 5)); cs.push([e2.x - x, e2.y - gy - 0.3, e2.z - z]); }
  }
  cs.push([ccx, cyy + h * 0.14, ccz], [ccx + (rnd() - 0.5) * 2, cyy + h * 0.08, ccz + (rnd() - 0.5) * 2]);
  const kind = rnd() < 0.7 ? 'canopy_sakura' : 'canopy_sakura_b', cm = sakuraMat(kind), tone = 0.95 + rnd() * 0.1;
  for (const [ox, oy, oz] of cs) { // 클러스터 = 무작위 방향 카드 6장(중심 ±0.35s 흩뿌림) → 근경에서 평면·교차선이 덜 보이고 윤곽이 둥글다
    const s = h * (0.26 + 0.08 * rnd()), hf = Math.min(1, Math.max(0, (oy - (cyy - h * 0.15)) / (h * 0.35))), c = tone * (0.9 + 0.16 * hf);
    for (let k = 0; k < 6; k++) {
      const jx = (rnd() - 0.5) * s * 0.7, jy = (rnd() - 0.4) * s * 0.5, jz = (rnd() - 0.5) * s * 0.7, sz = s * (0.8 + 0.4 * rnd());
      const g = cardGeo(V(ox + jx, oy + jy, oz + jz), sz, sz * 0.85, rnd() * Math.PI, (rnd() - 0.5) * 2.2, [c, c * 0.98, c * 0.99], rnd() < 0.5);
      sphereNormals(g, x + ccx, gy + cyy - h * 0.05, z + ccz); // 수관 전체를 한 덩어리로 음영 → 카드 면이 각져 보이지 않음
      fb.put(x, z, kind, cm, g);
    }
  }
  colliders.push(axisCollider(x - 0.3, x + 0.3, gy, gy + 3.2, z - 0.3, z + 0.3));
  SAKURA_TREES.push({ x: x + ccx, y: gy + cyy, z: z + ccz, r: rx, decal: h > 6 });
}

// 낙화 파티클: 카메라 주변 N장 순환. 재스폰은 근처(45m) 벚나무 수관 안(가중) 또는 카메라 주변 상공. 바람 + 흔들림 + 회전.
function makePetalSystem() {
  const N = IS_MOBILE ? 450 : 1400;
  const tex = CANOPY_TEX.petal || null;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xf0dce2 : 0xf6d6df, alphaTest: 0.4, side: THREE.DoubleSide }); // 무광(Basic): 역광 뒷면이 검은 점으로 보이던 문제 — 얇은 꽃잎은 투과광으로 늘 밝다
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.045), mat, N);
  mesh.frustumCulled = false; mesh.castShadow = false; scene.add(mesh);
  const P = new Float32Array(N * 3), Vv = new Float32Array(N * 4), R = new Float32Array(N * 6);
  let near = [], nearT = 0, t = 0;
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
  const spawn = (i, cam, init) => {
    const tr = near.length && Math.random() < 0.85 ? near[Math.floor(Math.random() * near.length)] : null;
    if (tr) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * tr.r; P[i * 3] = tr.x + Math.cos(a) * r; P[i * 3 + 1] = tr.y + (Math.random() - 0.4) * tr.r * 0.5; P[i * 3 + 2] = tr.z + Math.sin(a) * r; }
    else { P[i * 3] = cam.x + (Math.random() - 0.5) * 60; P[i * 3 + 1] = 2 + Math.random() * 9; P[i * 3 + 2] = cam.z + (Math.random() - 0.5) * 60; }
    if (init && tr) P[i * 3 + 1] -= Math.random() * (tr.y - 0.2); // 초기엔 공중 전역에 분포
    Vv[i * 4] = 0.45 + Math.random() * 0.6; Vv[i * 4 + 1] = Math.random() * 6.283; Vv[i * 4 + 2] = 0.8 + Math.random() * 1.6; Vv[i * 4 + 3] = 0.25 + Math.random() * 0.4;
    for (let k = 0; k < 3; k++) { R[i * 6 + k] = Math.random() * 6.283; R[i * 6 + 3 + k] = (Math.random() - 0.5) * 7; }
  };
  const refreshNear = (cam) => { near = SAKURA_TREES.filter((tr) => Math.hypot(tr.x - cam.x, tr.z - cam.z) < 48); };
  let inited = false;
  return {
    mesh,
    update(dt, cam) {
      t += dt; nearT -= dt;
      if (nearT <= 0) { refreshNear(cam); nearT = 0.5; }
      if (!inited) { for (let i = 0; i < N; i++) spawn(i, cam, true); inited = true; }
      const gust = 0.6 + 0.5 * Math.sin(t * 0.37) + 0.25 * Math.sin(t * 1.3 + 1.7), wx = 0.9 * gust, wz = 0.3 * gust;
      for (let i = 0; i < N; i++) {
        const ph = Vv[i * 4 + 1], fr = Vv[i * 4 + 2], sw = Vv[i * 4 + 3];
        P[i * 3] += (wx + Math.sin(ph + t * fr) * sw) * dt;
        P[i * 3 + 1] -= Vv[i * 4] * (0.75 + 0.35 * Math.sin(ph * 2 + t * fr * 1.3)) * dt;
        P[i * 3 + 2] += (wz + Math.cos(ph * 1.3 + t * fr * 0.8) * sw) * dt;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const floor = (z > TOWN.canal.z0 && z < TOWN.canal.z1) ? TOWN.canal.water : 0.02;
        if (y < floor || Math.abs(x - cam.x) > 38 || Math.abs(z - cam.z) > 38) spawn(i, cam, false);
        for (let k = 0; k < 3; k++) R[i * 6 + k] += R[i * 6 + 3 + k] * dt;
        _e.set(R[i * 6], R[i * 6 + 1], R[i * 6 + 2]); _q.setFromEuler(_e);
        mesh.setMatrixAt(i, _m.compose(_p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), _q, _s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ── 자판기 / 반사경 / 벤치 / 산책로 가로등 ──
const VEND_TEX = [];
function townVending(B, x, z, yaw, seed) {
  if (!VEND_TEX.length) for (let i = 0; i < 3; i++) VEND_TEX.push(vendingTexture(700 + i));
  const tex = VEND_TEX[seed % 3], c = Math.cos(yaw), s = Math.sin(yaw);
  B.boxR(x, 0.92, z, 1.0, 1.84, 0.72, TMAT.white, 0, yaw, 0);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 1.78), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.35 }));
  front.position.set(x + s * 0.362, 0.93, z + c * 0.362); front.rotation.y = yaw; scene.add(front); obstacleMeshes.push(front);
  colliders.push(axisCollider(x - 0.55, x + 0.55, 0, 1.84, z - 0.55, z + 0.55));
}
function townMirror(B, x, z, yaw) { // 커브미러: 주황 기둥 + 원형 볼록거울(금속 반사)
  B.cyl(x, 1.6, z, 0.045, 0.05, 3.2, TMAT.orange, 8, true);
  const c = Math.cos(yaw), s = Math.sin(yaw), mx = x + s * 0.18, mz = z + c * 0.18;
  const g = new THREE.CylinderGeometry(0.36, 0.36, 0.05, 20); g.rotateX(Math.PI / 2); g.rotateY(yaw); g.translate(mx, 3.05, mz); B.geo(mx, mz, TMAT.orange, g);
  const m = new THREE.CylinderGeometry(0.31, 0.31, 0.02, 20); m.rotateX(Math.PI / 2); m.rotateY(yaw); m.translate(mx + s * 0.03, 3.05, mz + c * 0.03); B.geo(mx, mz, TMAT.mirror, m);
}
function townBench(B, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (a, b) => [x + a * c + b * s, z - a * s + b * c];
  for (const a of [-0.7, 0.7]) { const [px, pz] = P(a, 0); B.boxR(px, 0.22, pz, 0.08, 0.44, 0.5, 'concrete', 0, yaw, 0); }
  for (let i = 0; i < 3; i++) { const [px, pz] = P(0, -0.18 + i * 0.13); B.boxR(px, 0.45, pz, 1.7, 0.035, 0.1, TMAT.doorWood, 0, yaw, 0); }
  for (let i = 0; i < 2; i++) { const [px, pz] = P(0, -0.26); B.boxR(px, 0.62 + i * 0.14, pz, 1.7, 0.1, 0.035, TMAT.doorWood, 0, yaw, 0); }
  colliders.push(axisCollider(x - 0.9, x + 0.9, 0, 0.5, z - 0.35, z + 0.35));
}
function townLamp(B, x, z) { // 복고풍 산책로 가로등(짙은 녹색 기둥 + 등롱)
  B.cyl(x, 0.12, z, 0.14, 0.16, 0.24, TMAT.rail, 8);
  B.cyl(x, 1.9, z, 0.05, 0.06, 3.6, TMAT.rail, 8, true);
  B.box(x, 3.85, z, 0.3, 0.42, 0.3, TMAT.lampGlow); B.cone(x, 4.2, z, 0.28, 0.26, TMAT.rail);
}
// batchBuilder 에는 cone 이 있지만 townBatch 에 없어 추가
function addConeTo(B) { B.cone = (cx, cy, cz, r, h, mat, seg = 4) => { const g = new THREE.ConeGeometry(r, h, seg); g.rotateY(Math.PI / 4); g.translate(cx, cy, cz); B.geo(cx, cz, mat, g); }; }

// ── 편의점 + 상가 2채 (C × 남1열, 개천변 도로 z=17 향) ──
function townKonbini(B) {
  const x0 = 5.5, x1 = 21.5, z0 = 22, z1 = 31, H = 4.0, t = 0.25, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  notePlacement('konbini', xm, zm, w / 2, d / 2, 0, H + 1);
  B.box(xm, 0.05, zm, w, 0.1, d, 'paving');
  B.box(xm, H / 2, z1, w, H, t, 'plasterWhite', true); B.box(x0, H / 2, zm, t, H, d, 'plasterWhite', true); B.box(x1, H / 2, zm, t, H, d, 'plasterWhite', true);
  // 정면 유리 커튼월 + 자동문(8~10) 개구부
  const door = [7.3, 9.3];
  for (const [a, b] of [[x0, door[0]], [door[1], x1]]) { B.box((a + b) / 2, 1.3, z0, b - a, 2.6, 0.06, TMAT.glass); colliders.push(axisCollider(a, b, 0, 2.6, z0 - 0.1, z0 + 0.1)); }
  for (let x = x0; x <= x1 + 0.01; x += 1.6) if (x < door[0] - 0.05 || x > door[1] + 0.05) B.box(x, 1.3, z0, 0.08, 2.6, 0.12, TMAT.aluSilver);
  for (const x of door) B.box(x, 1.3, z0, 0.1, 2.6, 0.14, TMAT.aluSilver);
  B.box(xm, 0.06, z0, w, 0.12, 0.14, TMAT.aluSilver); B.box(xm, 2.64, z0, w, 0.08, 0.14, TMAT.aluSilver);
  B.box(xm, 3.3, z0, w, 1.4, t, 'plasterWhite');
  const sign = signCanvas(1024, 96, (g, W, Hh) => {
    g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, W, Hh);
    for (const [y, c] of [[0, '#2f9d57'], [22, '#f08a24'], [44, '#2a64b8']]) { g.fillStyle = c; g.fillRect(0, y, W * 0.36, 20); }
    g.fillStyle = '#2a64b8'; g.font = 'bold 60px sans-serif'; g.textBaseline = 'middle'; g.fillText('24 MART', W * 0.42, Hh / 2 + 3);
  });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.2, 0.9), new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5 }));
  sm.position.set(xm, 3.35, z0 - 0.14); sm.rotation.y = Math.PI; scene.add(sm); obstacleMeshes.push(sm);
  B.box(xm, H + 0.05, zm, w + 0.3, 0.12, d + 0.3, 'concrete'); B.box(xm, H + 0.35, z0 - 0.05, w + 0.3, 0.5, 0.2, 'plasterWhite');
  B.box(xm, H - 0.05, zm, w - 0.4, 0.06, d - 0.4, TMAT.ceiling);
  for (let x = x0 + 2; x < x1 - 1; x += 3) for (let z = z0 + 2; z < z1 - 1; z += 3) B.box(x, H - 0.1, z, 1.2, 0.04, 0.3, TMAT.fridgeGlow); // 천장 조명
  // 실내: 곤돌라 진열대 3줄 + 냉장 벽 + 계산대 + 잡지 선반
  const goods = signCanvas(512, 128, (g, W, Hh) => { const r = mulberry32(55); g.fillStyle = '#e8e8e4'; g.fillRect(0, 0, W, Hh); for (let s = 0; s < 3; s++) for (let i = 0; i < 26; i++) { g.fillStyle = `hsl(${Math.floor(r() * 360)},${50 + r() * 40}%,${40 + r() * 30}%)`; g.fillRect(4 + i * 19.5, 6 + s * 41, 15, 34); } });
  goods.wrapS = THREE.RepeatWrapping; goods.repeat.set(3, 1); // 상품 1개 ≈ 8cm
  const gm = new THREE.MeshStandardMaterial({ map: goods, roughness: 0.7 });
  for (const z of [25.2, 27.4]) {
    B.box(13.5, 0.75, z, 6.5, 1.5, 0.9, TMAT.white, true);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.3), gm); p.position.set(13.5, 0.78, z + s * 0.46); p.rotation.y = s > 0 ? 0 : Math.PI; scene.add(p); obstacleMeshes.push(p); }
  }
  B.box(xm, 1.1, z1 - 0.55, w - 1.2, 2.2, 0.8, TMAT.fridgeGlow, true);
  for (let x = x0 + 1.2; x < x1 - 0.6; x += 0.9) B.box(x, 1.1, z1 - 0.96, 0.05, 2.2, 0.04, TMAT.aluSilver);
  B.box(19.2, 0.5, 24.2, 1.0, 1.0, 3.2, TMAT.trimWhite, true); B.box(19.2, 1.05, 23.5, 0.5, 0.3, 0.4, TMAT.trimDark);   // 계산대 + 계산기
  B.box(xm - 1, 0.5, z0 + 0.5, 6, 1.0, 0.45, TMAT.white, true);                                                    // 잡지 선반(창가)
  TOWN_LOOT.push([10.5, 26.3], [17.5, 28.8]);
  if (townLights < 8) { const L = new THREE.PointLight(0xf2f6ff, 6, 14, 2); L.position.set(xm, H - 0.6, zm); scene.add(L); townLights++; }
  // 외부: 주차 칸·차 멈춤·자판기·쓰레기통·옥상 실외기
  for (let x = x0 + 1; x <= x1 - 1; x += 2.6) { B.box(x, 0.034, 19.5, 0.12, 0.01, 4.6, TMAT.whiteLine); B.box(x + 1.3, 0.08, 21.1, 1.2, 0.12, 0.2, 'concrete'); }
  townVending(B, x1 + 0.9, 21.8, Math.PI, 1); townVending(B, x1 + 1.95, 21.8, Math.PI, 2);
  for (const x of [x0 + 0.5, x0 + 1.2]) B.box(x, 0.5, z0 - 0.4, 0.55, 1.0, 0.45, TMAT.aluSilver, true);
  TOWN_PROPS.push(['acUnit', x1 - 2, H + 0.11, z1 - 1.5, { rotY: Math.PI, height: 0.9, keep: /^exterior_aircon_unit$/ }], ['acUnit', x1 - 3.2, H + 0.11, z1 - 1.5, { rotY: Math.PI, height: 0.9, keep: /^exterior_aircon_unit$/ }]);
  townBike(B, x0 - 0.8, 20, Math.PI / 2 + 0.1, 5); townBike(B, x0 - 0.8, 21, Math.PI / 2 - 0.1, 6);
}
function townShop(B, x0, z0, w, d, name, col, seed, kind) { // 1층 가게(진입) + 2층 주거. 정면 −z(개천변 도로)
  const H1 = 3.0, H2 = 2.7, t = 0.22, xm = x0 + w / 2, zm = z0 + d / 2, rnd = mulberry32(seed), wm = kind === 'cafe' ? 'plasterBeige' : 'sidingGray';
  notePlacement('shop', xm, zm, w / 2, d / 2, 0, H1 + H2 + 1);
  B.box(xm, 0.04, zm, w, 0.08, d, 'woodfloor');
  B.box(xm, (H1 + H2) / 2, z0 + d, w, H1 + H2, t, wm, true); B.box(x0, (H1 + H2) / 2, zm, t, H1 + H2, d, wm, true); B.box(x0 + w, (H1 + H2) / 2, zm, t, H1 + H2, d, wm, true);
  const dA = xm - 0.8, dB = xm + 0.8; // 가게 문
  for (const [a, b] of [[x0, dA], [dB, x0 + w]]) { B.box((a + b) / 2, 0.3, z0, b - a, 0.6, t, wm, true); B.box((a + b) / 2, 1.55, z0, b - a - 0.1, 1.9, 0.05, TMAT.glass); colliders.push(axisCollider(a, b, 0, 2.5, z0 - 0.1, z0 + 0.1)); }
  B.box(xm, 2.75, z0, w, 0.5, t, wm); for (const x of [x0 + 0.1, dA, dB, x0 + w - 0.1]) B.box(x, 1.4, z0, 0.1, 2.8, 0.14, TMAT.trimDark);
  B.box(xm, H1 + H2 / 2, z0, w, H2, t, wm); // 2층 전면 벽
  for (const x of [x0 + w * 0.28, x0 + w * 0.72]) { B.box(x, H1 + 1.4, z0 - 0.02, 1.4, 1.1, 0.06, TMAT.glass); B.box(x, H1 + 1.4, z0 - 0.06, 1.5, 1.2, 0.04, TMAT.alu); B.box(x, H1 + 1.4, z0 + 0.16, 1.5, 1.2, 0.03, TMAT.interior); }
  const aw = signCanvas(256, 64, (g, W, Hh) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : col; g.fillRect(i * W / 8, 0, W / 8, Hh); } g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, Hh - 10, W, 10); });
  const am = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.04, 1.3), new THREE.MeshStandardMaterial({ map: aw, roughness: 0.9 }));
  am.position.set(xm, 2.72, z0 - 0.62); am.rotation.x = -0.32; am.castShadow = true; scene.add(am); obstacleMeshes.push(am);
  const sg = signCanvas(512, 96, (g, W, Hh) => { g.fillStyle = '#2b2622'; g.fillRect(0, 0, W, Hh); g.fillStyle = '#f3ead8'; g.font = 'bold 56px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, W / 2, Hh / 2 + 2); });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, 0.55), new THREE.MeshStandardMaterial({ map: sg, roughness: 0.6 }));
  sm.position.set(xm, 3.35, z0 - 0.13); sm.rotation.y = Math.PI; scene.add(sm); obstacleMeshes.push(sm);
  B.box(xm, H1 + H2 + 0.1, zm, w + 0.2, 0.2, d + 0.2, 'concrete'); B.box(xm, H1 + H2 + 0.4, z0, w + 0.2, 0.5, 0.2, wm);
  B.box(xm, H1, zm, w - 0.4, 0.12, d - 0.4, TMAT.ceiling);
  B.box(xm + w * 0.2, 0.55, zm + 1.2, 2.4, 1.1, 0.6, TMAT.doorWood, true);
  if (kind === 'cafe') for (const [x, z] of [[xm - 1.8, zm - 1], [xm - 1.2, zm + 1.8]]) { B.cyl(x, 0.37, z, 0.4, 0.4, 0.04, TMAT.doorWood, 14); B.cyl(x, 0.18, z, 0.04, 0.04, 0.36, TMAT.trimDark, 6); }
  if (kind === 'flower') for (let i = 0; i < 7; i++) { const x = x0 + 0.6 + i * 0.52, z = z0 - 0.5; B.cyl(x, 0.2, z, 0.16, 0.13, 0.4, TMAT.aluSilver, 10); B.cyl(x, 0.52, z, 0.2, 0.08, 0.3, [TMAT.red, TMAT.yellow, TMAT.fabric[2], TMAT.white, TMAT.fabric[3]][i % 5], 8); }
  if (kind === 'cafe') { townBench(B, x0 + 1.2, z0 - 1.0, Math.PI); }
  TOWN_LOOT.push([xm - 0.8, zm]);
}

// ── 공원 (B × 북2열): 흙 광장 + 체인 링크 울타리 + 벚나무 + 미끄럼틀·그네·정글짐·모래밭 + 벤치 + 공중화장실 + 음수대 + 시계탑 ──
function townPark(B, fb) {
  const x0 = -41.5, x1 = -3, z0 = -85, z1 = -42.5, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, rnd = mulberry32(3194);
  B.box(xm, 0.012, zm, x1 - x0, 0.024, z1 - z0, 'gardenSoil');
  B.box(-22, 0.02, (z1 + -58) / 2, 3.2, 0.04, z1 + 58, 'paving');                          // 정문 산책로
  const fence = (ax, c, a0, a1) => { // 낮은 블록 + 체인 링크(1.3m) + 기둥
    const len = a1 - a0, m = (a0 + a1) / 2; if (len < 0.3) return;
    if (ax === 'x') { B.box(m, 0.25, c, len, 0.5, 0.2, 'blockwall', true); const g = metricPlane(len, 1.3); g.translate(m, 1.15, c); B.geo(m, c, TMAT.chain, g); colliders.push(axisCollider(a0, a1, 0, 1.8, c - 0.1, c + 0.1)); for (let x = a0; x <= a1; x += 2.4) B.box(x, 1.2, c, 0.06, 1.4, 0.06, TMAT.aluSilver); B.box(m, 1.82, c, len, 0.04, 0.04, TMAT.aluSilver); }
    else { B.box(c, 0.25, m, 0.2, 0.5, len, 'blockwall', true); const g = metricPlane(len, 1.3); g.rotateY(Math.PI / 2); g.translate(c, 1.15, m); B.geo(c, m, TMAT.chain, g); colliders.push(axisCollider(c - 0.1, c + 0.1, 0, 1.8, a0, a1)); for (let z = a0; z <= a1; z += 2.4) B.box(c, 1.2, z, 0.06, 1.4, 0.06, TMAT.aluSilver); B.box(c, 1.82, m, 0.04, 0.04, len, TMAT.aluSilver); }
  };
  fence('x', z1 - 0.3, x0 + 0.3, -24); fence('x', z1 - 0.3, -20, x1 - 0.3);                    // 남(정문 −22)
  fence('z', x1 - 0.3, z0 + 0.3, -62); fence('z', x1 - 0.3, -58, z1 - 0.3);                     // 동(옆문 z=−60)
  fence('z', x0 + 0.3, z0 + 0.3, z1 - 0.3); fence('x', z0 + 0.4, x0 + 0.3, x1 - 0.3);
  for (const x of [-23.6, -20.4]) B.cyl(x, 0.4, z1 - 0.3, 0.09, 0.09, 0.8, TMAT.aluSilver, 8, true); // 차단 볼라드
  // 벚나무: 외곽 링 + 광장 두 그루
  const ring = [];
  for (let x = x0 + 3.5; x < x1 - 2; x += 7) ring.push([x, z0 + 3.5], [x, z1 - 3.2]);
  for (let z = z0 + 10; z < z1 - 6; z += 7.5) ring.push([x0 + 3.2, z], [x1 - 3.2, z]);
  ring.forEach(([x, z], i) => { if (Math.abs(x + 22) < 3 && z > z1 - 5) return; if (Math.abs(z + 60) < 3 && x > x1 - 5) return; placeSakura(fb, x + (rnd() - 0.5), z + (rnd() - 0.5), 7.5 + rnd() * 2.5, 0, 0, 900 + i); });
  placeSakura(fb, -14, -52, 10, 0, 0, 951); placeSakura(fb, -33, -70, 9.5, 0, 0, 952);
  // 미끄럼틀 (−28, −60): 계단 + 플랫폼 + 경사 슬라이드
  { const x = -30, z = -58;
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) B.cyl(x + dx, 1.1, z + dz, 0.05, 0.05, 2.2, TMAT.yellow, 8, true);
    B.box(x, 1.6, z, 1.4, 0.08, 1.4, TMAT.blue); for (const s of [-1, 1]) B.box(x + s * 0.68, 2.0, z, 0.05, 0.8, 1.3, TMAT.red);
    for (let i = 0; i < 6; i++) B.box(x, 0.25 + i * 0.26, z - 0.9 - i * 0.02, 0.6, 0.04, 0.12, TMAT.aluSilver);
    for (const s of [-1, 1]) B.seg(_tv(x + s * 0.3, 0, z - 1.05), _tv(x + s * 0.3, 1.7, z - 0.72), 0.03, TMAT.aluSilver);
    B.boxR(x, 0.85, z + 2.0, 0.6, 0.05, 3.3, TMAT.red, -0.52, 0, 0); for (const s of [-1, 1]) B.boxR(x + s * 0.3, 0.97, z + 2.0, 0.04, 0.22, 3.3, TMAT.red, -0.52, 0, 0);
    TOWN_LOOT.push([x + 1.4, z]); }
  // 그네 (−20, −66): A 프레임 + 가로대 + 줄(선) + 좌판 2
  { const x = -19, z = -67, W = 3.4;
    for (const s of [-1, 1]) for (const dz of [-0.9, 0.9]) B.seg(_tv(x + s * W / 2, 0, z + dz), _tv(x + s * W / 2, 2.4, z), 0.05, TMAT.green);
    B.seg(_tv(x - W / 2, 2.4, z), _tv(x + W / 2, 2.4, z), 0.06, TMAT.green);
    for (const sx of [-0.8, 0.8]) { for (const d of [-0.2, 0.2]) B.seg(_tv(x + sx + d, 2.38, z), _tv(x + sx + d, 0.5, z + (sx > 0 ? 0.25 : 0)), 0.008, TMAT.aluSilver); B.box(x + sx, 0.48, z + (sx > 0 ? 0.25 : 0), 0.46, 0.04, 0.22, TMAT.rubber); }
    B.box(x, 0.3, z + 1.6, W + 0.6, 0.6, 0.06, TMAT.yellow, true); }
  // 정글짐 (−33, −49)
  { const x = -34, z = -50, n = 3, s = 0.8;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) B.seg(_tv(x + i * s - 1.2, 0, z + j * s - 1.2), _tv(x + i * s - 1.2, n * s, z + j * s - 1.2), 0.025, TMAT.blue);
    for (let k = 1; k <= n; k++) for (let i = 0; i <= n; i++) { B.seg(_tv(x - 1.2, k * s, z + i * s - 1.2), _tv(x + 1.2, k * s, z + i * s - 1.2), 0.022, TMAT.red); B.seg(_tv(x + i * s - 1.2, k * s, z - 1.2), _tv(x + i * s - 1.2, k * s, z + 1.2), 0.022, TMAT.yellow); }
    colliders.push(axisCollider(x - 1.25, x + 1.25, 0, 2.4, z - 1.25, z + 1.25)); }
  // 모래밭 (−12, −62)
  { const x = -12, z = -63; B.box(x, 0.05, z, 4.2, 0.1, 3.6, TMAT.sand); for (const [dx, dz, w, d] of [[0, -1.9, 4.6, 0.2], [0, 1.9, 4.6, 0.2], [-2.2, 0, 0.2, 3.6], [2.2, 0, 0.2, 3.6]]) B.box(x + dx, 0.13, z + dz, w, 0.26, d, 'concrete'); }
  // 벤치 · 음수대 · 시계탑 · 휴지통
  for (const [x, z, y] of [[-26, -46.5, Math.PI], [-16, -46.5, Math.PI], [-37.5, -60, Math.PI / 2], [-7, -72, -Math.PI / 2], [-25, -80, 0]]) townBench(B, x, z, y);
  B.cyl(-24.5, 0.45, -52, 0.2, 0.26, 0.9, 'concrete', 12, true); B.box(-24.5, 0.93, -52, 0.5, 0.06, 0.5, TMAT.aluSilver);
  B.cyl(-19.5, 1.8, -50, 0.07, 0.07, 3.6, TMAT.aluSilver, 8, true); { const g = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 20); g.rotateX(Math.PI / 2); g.translate(-19.5, 3.7, -50); B.geo(-19.5, -50, TMAT.white, g); }
  for (const [x, z] of [[-23.8, -47], [-8, -60]]) B.cyl(x, 0.4, z, 0.25, 0.25, 0.8, TMAT.green, 12, true);
  // 공중화장실 (−10, −78)
  { const x = -9.5, z = -79, w = 5, d = 4, H = 2.9;
    for (const [dx, dz, ww, dd] of [[0, -d / 2, w, 0.22], [-w / 2, 0, 0.22, d], [w / 2, 0, 0.22, d]]) B.box(x + dx, H / 2, z + dz, ww, H, dd, 'concreteStain', true);
    for (const [a, b] of [[-w / 2, -1.6], [-0.4, 0.4], [1.6, w / 2]]) B.box(x + (a + b) / 2, H / 2, z + d / 2, b - a, H, 0.22, 'concreteStain', true);
    B.box(x, 0.3, z + d / 2 + 0.25, 1.4, 0.04, 0.3, TMAT.blue); B.box(x, 0.3, z + d / 2 - 0, 0.08, 0.6, 0.02, TMAT.whiteLine);
    B.box(x, H + 0.1, z, w + 0.8, 0.2, d + 0.8, 'concrete'); B.box(x, 0.8, z, 0.1, 1.6, d - 0.3, 'plasterWhite', true);
    B.box(x, 0.03, z, w - 0.3, 0.06, d - 0.3, 'paving');
    TOWN_LOOT.push([x - 1.1, z]); }
  // 풀 · 잡초 영역
  return { grass: [[x0 + 2, z0 + 2, x1 - 2, z1 - 2]] };
}

// ── 신사 (D × 북2열): 도리이 + 석등 + 참배로 + 데미즈야 + 배전(높은 마루·박공 기와) + 벚나무 + 삼나무 배경 ──
function townShrine(B, fb) {
  const x0 = 46.5, x1 = 85, z0 = -85, z1 = -42.5, cxs = 64, rnd = mulberry32(3195);
  B.box((x0 + x1) / 2, 0.012, (z0 + z1) / 2, x1 - x0, 0.024, z1 - z0, 'gravelWet');
  B.box(cxs, 0.03, -57, 2.4, 0.06, 29, 'paving');
  for (const [a, b] of [[x0 + 0.2, cxs - 3], [cxs + 3, x1 - 0.2]]) { B.box((a + b) / 2, 0.35, z1 - 0.3, b - a, 0.7, 0.4, TMAT.stone, true); B.box((a + b) / 2, 0.74, z1 - 0.3, b - a, 0.08, 0.5, TMAT.stone); } // 석축 담
  B.box(x1 - 0.3, 0.35, (z0 + z1) / 2, 0.4, 0.7, z1 - z0, TMAT.stone, true); B.box(x0 + 0.3, 0.35, (z0 + z1) / 2, 0.4, 0.7, z1 - z0, TMAT.stone, true); B.box((x0 + x1) / 2, 0.35, z0 + 0.3, x1 - x0, 0.7, 0.4, TMAT.stone, true);
  // 도리이 (z=−45)
  { const z = -45.5, s = 1.95;
    for (const d of [-s, s]) { B.cyl(cxs + d, 2.1, z, 0.2, 0.23, 4.2, TMAT.vermilion, 12, true); B.cyl(cxs + d, 0.2, z, 0.28, 0.3, 0.4, TMAT.poleBlack, 12); }
    B.box(cxs, 3.3, z, 4.8, 0.26, 0.26, TMAT.vermilion); B.box(cxs, 4.25, z, 5.6, 0.3, 0.4, TMAT.vermilion); B.box(cxs, 4.48, z, 6.0, 0.18, 0.5, TMAT.poleBlack);
    B.box(cxs, 3.78, z, 0.3, 0.7, 0.2, TMAT.vermilion); }
  // 석등 2쌍
  for (const z of [-51, -60]) for (const s of [-1, 1]) { const x = cxs + s * 2.3;
    B.box(x, 0.15, z, 0.7, 0.3, 0.7, TMAT.stone, true); B.cyl(x, 0.85, z, 0.13, 0.16, 1.1, TMAT.stone, 8); B.box(x, 1.55, z, 0.5, 0.3, 0.5, TMAT.stone);
    B.box(x, 1.9, z, 0.36, 0.4, 0.36, TMAT.lampGlow); B.cone(x, 2.35, z, 0.55, 0.4, TMAT.stone); B.cyl(x, 2.62, z, 0.07, 0.1, 0.16, TMAT.stone, 8); }
  // 데미즈야(손 씻는 정자) (57, −55)
  { const x = 57.5, z = -55; for (const [dx, dz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) B.cyl(x + dx, 1.2, z + dz, 0.08, 0.08, 2.4, TMAT.shrineWood, 8, true);
    B.boxR(x, 2.65, z - 0.65, 2.8, 0.1, 1.5, 'kawara', -0.5, 0, 0); B.boxR(x, 2.65, z + 0.65, 2.8, 0.1, 1.5, 'kawara', 0.5, 0, 0); B.box(x, 3.0, z, 2.9, 0.12, 0.2, TMAT.ridge);
    B.box(x, 0.45, z, 1.4, 0.7, 0.7, TMAT.stone, true); B.box(x, 0.82, z, 1.2, 0.04, 0.5, TMAT.glass); }
  // 배전 (64, −74): 높은 마루(0.6) + 계단 + 목조 벽(격자) + 깊은 처마 박공 기와
  { const x = cxs, z = -74, w = 8, d = 6.5, fy = 0.6, H = 3.2;
    B.box(x, fy / 2, z, w + 1.2, fy, d + 1.2, TMAT.shrineWood, true);
    for (let i = 0; i < 3; i++) B.box(x, 0.1 + i * 0.2, z + d / 2 + 1.25 - i * 0.3, 3, 0.2 * (i + 1), 0.3, TMAT.shrineWood, true);
    for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [-w / 6, d / 2], [w / 6, d / 2]]) B.cyl(x + dx, fy + H / 2, z + dz, 0.14, 0.14, H, TMAT.vermilion, 10, true);
    B.box(x, fy + H / 2, z - d / 2, w, H, 0.15, TMAT.shrineWood, true); B.box(x - w / 2, fy + H / 2, z, 0.15, H, d, TMAT.shrineWood, true); B.box(x + w / 2, fy + H / 2, z, 0.15, H, d, TMAT.shrineWood, true);
    for (const [a, b] of [[-w / 2, -w / 6], [w / 6, w / 2]]) { B.box(x + (a + b) / 2, fy + H / 2, z + d / 2 - 0.1, b - a, H, 0.1, TMAT.shrineWood, true); for (let k = a + 0.25; k < b; k += 0.3) B.box(x + k, fy + H / 2, z + d / 2 + 0.0, 0.04, H - 0.4, 0.06, TMAT.poleBlack); }
    B.box(x, fy + H - 0.3, z + d / 2 - 0.1, w / 3, 0.6, 0.1, TMAT.shrineWood);
    B.box(x, fy + 0.4, z + d / 2 + 0.3, 1.2, 0.6, 0.6, TMAT.shrineWood, true); // 새전함
    B.seg(_tv(x, fy + H - 0.2, z + d / 2 + 0.2), _tv(x, fy + 1.0, z + d / 2 + 0.25), 0.03, TMAT.sand); B.cyl(x, fy + H - 0.25, z + d / 2 + 0.2, 0.12, 0.14, 0.2, TMAT.yellow, 10); // 방울 줄
    const e = 1.3, p = 0.5, yT = fy + H, S = d, rise = (S / 2) * Math.tan(p), Ls = (S / 2 + e) / Math.cos(p), yc = yT + rise - ((S / 2 + e) / 2) * Math.tan(p) + 0.1;
    for (const s of [-1, 1]) B.boxR(x, yc, z + s * (S / 2 + e) / 2, w + 2.2, 0.18, Ls, 'kawara', s > 0 ? p : -p, 0, 0);
    for (const q of [-1, 1]) { const g = gableGeo(S, rise, 0.2); g.rotateY(-Math.PI / 2); g.translate(x + q * w / 2, yT, z); B.geo(x, z, TMAT.shrineWood, g); }
    B.box(x, yT + rise + 0.2, z, w + 2.4, 0.3, 0.4, TMAT.ridge);
    for (const q of [-1, 1]) for (const s of [-1, 1]) B.boxR(x + q * (w / 2 + 1.12), yc - 0.05, z + s * (S / 2 + e) / 2, 0.08, 0.34, Ls, TMAT.trimWhite, s > 0 ? p : -p, 0, 0);
    TOWN_LOOT.push([x - 2.5, z + d / 2 + 0.8], [x + 3, z + d / 2 + 0.8]); }
  // 나무: 벚꽃 4 + 배경 삼나무(침엽 카드)
  for (const [x, z, h, i] of [[53, -48, 8.5, 1], [76, -49, 9, 2], [52, -66, 8, 3], [78, -64, 9.5, 4]]) placeSakura(fb, x, z, h, 0, 0, 960 + i);
  for (let x = x0 + 3; x < x1 - 2; x += 4.2) placeCardTree(fb, 'pine', x + (rnd() - 0.5) * 1.5, z0 + 3 + rnd() * 2.5, 13 + rnd() * 5, 0.4, 970 + Math.round(x));
  for (const z of [-80, -72, -64]) { placeCardTree(fb, 'pine', x0 + 2.5, z, 12 + rnd() * 4, 0.4, 990 + z); placeCardTree(fb, 'pine', x1 - 2.5, z + 3, 12 + rnd() * 4, 0.4, 995 + z); }
  B.box(72, 0.9, -57, 0.5, 1.8, 0.25, TMAT.stone, true); // 비석
}

// ── 코인 주차장 (B × 남2열) ──
function townParking(B) {
  const x0 = -41.5, x1 = -3, z0 = 50.5, z1 = 67.5;
  B.box((x0 + x1) / 2, 0.02, (z0 + z1) / 2, x1 - x0, 0.04, z1 - z0, 'asphaltTown');
  for (let x = x0 + 1; x <= x1 - 1; x += 2.6) { B.box(x, 0.045, z1 - 3, 0.12, 0.01, 5, TMAT.whiteLine); B.box(x + 1.3, 0.1, z1 - 1, 1.1, 0.14, 0.18, 'concrete'); }
  B.box((x0 + x1) / 2, 0.8, z1 - 0.2, x1 - x0, 1.6, 0.1, 'blockwall', true);
  B.cyl(x1 - 1.5, 1.6, z0 + 1.2, 0.06, 0.06, 3.2, TMAT.aluSilver, 8, true);
  const ps = signCanvas(128, 128, (g, W, H) => { g.fillStyle = '#1f55a8'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = 'bold 100px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', W / 2, H / 2 + 6); });
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshStandardMaterial({ map: ps, roughness: 0.5, side: THREE.DoubleSide }));
  pm.position.set(x1 - 1.5, 3.0, z0 + 1.2); pm.rotation.y = Math.PI / 4; scene.add(pm); obstacleMeshes.push(pm);
  B.box(x0 + 2.2, 0.8, z0 + 1.4, 0.6, 1.6, 0.5, TMAT.yellow, true);
  for (const x of [x0 + 7.4, x0 + 15.2, x0 + 25.6]) TOWN_PROPS.push(['@car', x, 0, z1 - 3.2, { rotY: Math.PI / 2 * 0 + 0.02 }]);
  TOWN_LOOT.push([x0 + 12, z0 + 4]);
}

// ── 대지 행 구성 ──
const TOWN_ROWS = [
  { z0: -23.5, z1: -9.5, face: 0, back: true, blocks: [0, 1, 2, 3] },
  { z0: -37.5, z1: -23.5, face: 2, back: false, blocks: [0, 1, 2, 3] },
  { z0: -62.5, z1: -42.5, face: 0, back: true, blocks: [0, 2] },
  { z0: -85, z1: -65.5, face: 0, back: true, blocks: [0, 2] },
  { z0: 17, z1: 31, face: 2, back: true, blocks: [0, 1, 3] },
  { z0: 31, z1: 45.5, face: 0, back: false, blocks: [0, 1, 2, 3] },
  { z0: 50.5, z1: 67.5, face: 2, back: true, blocks: [0, 2, 3] },
  { z0: 70.5, z1: 85, face: 2, back: true, blocks: [0, 1, 2, 3] },
];
function townLots() {
  const rnd = mulberry32(3196), lots = [];
  let enterN = 0, seed = 5000;
  for (const row of TOWN_ROWS) for (const bi of row.blocks) {
    const [bx0, bx1] = TOWN.blocksX[bi], n = rnd() < 0.5 ? 2 : 3, W = (bx1 - bx0) / n, D = row.z1 - row.z0, cz = (row.z0 + row.z1) / 2;
    for (let i = 0; i < n; i++) {
      const cx = bx0 + W * (i + 0.5), last = row.face === 0 ? i === n - 1 : i === 0;
      const vacant = rnd() < 0.09, enter = !vacant && enterN < 12 && rnd() < 0.3;
      if (enter) enterN++;
      lots.push({ cx, cz, W, D, face: row.face, seed: seed++, left: true, right: last, back: row.back, vacant, enter });
    }
  }
  return lots;
}

function buildTownMap() {
  buildTexMats(); buildTownMats(); buildTownDetailMats();
  scene.fog = new THREE.Fog(0xdcd6dc, 55, 230);
  TOWN_LOOT.length = 0; SAKURA_TREES.length = 0; TOWN_PROPS.length = 0; townLights = 0;
  TOWN_HOUSES.length = 0; TOWN_WEEDS.length = 0; TOWN_IVY.length = 0; townFxExtra.length = 0;
  const B = townBatch(), fb = forestBatch(), rnd = mulberry32(3197), L = WORLD_HALF, T = [], tm = (k) => T.push(`${k} ${Math.round(performance.now() - t0)}`), t0 = performance.now();
  addConeTo(B);
  buildTownStreets(B);
  const canal = buildTownCanal(B);
  buildTownCanalDetail(B, fb);
  buildTownBackdrop();
  // 외곽: 블록 담(2.6m) + 생울타리 + 바깥 숲
  for (const [x, z, w, d] of [[0, -L, L * 2 + 1, 0.4], [0, L, L * 2 + 1, 0.4], [-L, 0, 0.4, L * 2 + 1], [L, 0, 0.4, L * 2 + 1]]) {
    B.box(x, 1.3, z, w, 2.6, d, 'blockwall', true); B.box(x, 3.2, z, w + (d > 1 ? 0.4 : 0), 1.2, d + (w > 1 ? 0.5 : 0), 'hedge'); colliders.push(axisCollider(x - w / 2, x + w / 2, 0, 6, z - d / 2, z + d / 2));
  }
  for (let a = -L; a <= L; a += 9) for (const [x, z] of [[a, -L - 5], [a, L + 5], [-L - 5, a], [L + 5, a]]) placeCardTree(fb, rnd() < 0.4 ? 'pine' : rnd() < 0.5 ? 'canopy_broad_a' : 'canopy_broad_b', x + (rnd() - 0.5) * 3, z + (rnd() - 0.5) * 3, 10 + rnd() * 6, 0.4, 3300 + Math.round(a * 3 + x));
  townKonbini(B);
  townShop(B, 24, 18.5, 8.2, 9, 'CAFE', '#3a6b4a', 1, 'cafe');
  townShop(B, 33, 18.5, 8.2, 9, 'FLOWER', '#c0506a', 2, 'flower');
  const park = townPark(B, fb);
  townShrine(B, fb);
  townParking(B);
  tm('special');
  const lots = townLots();
  for (const lot of lots) buildTownLot(B, lot);
  tm('lots');
  // 개천 벚꽃길: 양안 가로수(수관이 개천 쪽으로) + 가로등 + 벤치
  const nearGap = (x) => TOWN.bridges.some(([a, b]) => x > a - 2.5 && x < b + 2.5) || TOWN.roadsNS.some(([a, b]) => x > a - 2.5 && x < b + 2.5);
  let ti = 0;
  for (const [z, lz] of [[-2.3, 1.3], [10.0, -1.3]]) {
    for (let x = -83; x <= 83; x += 7.2) {
      const xx = x + (rnd() - 0.5) * 1.4;
      if (nearGap(xx)) continue;
      placeSakura(fb, xx, z + (rnd() - 0.5) * 0.4, 7.5 + rnd() * 2, 0, lz, 800 + ti++);
      if (ti % 2 === 0 && !nearGap(xx + 3.6)) townLamp(B, xx + 3.6, z < 0 ? -3.9 : 11.5);
      if (ti % 5 === 0 && !nearGap(xx + 3.6)) townBench(B, xx + 3.6, z < 0 ? -0.6 : 8.6, z < 0 ? 0 : Math.PI);
    }
  }
  buildTownHanami(B, nearGap);
  // 정원 벚나무·관목 + 풀
  const grassMat = canopyMat('grass_card');
  const tuft = (x, z, s = 1) => { const y = terrainH(x, z), c = 0.72 + rnd() * 0.25, yaw = rnd() * Math.PI; for (let k = 0; k < 2; k++) fb.put(x, z, 'grass_card', grassMat, cardGeo(_tv(x, y + 0.2 * s, z), 0.7 * s, 0.42 * s, yaw + k * Math.PI / 2, 0, [c, c, c * 0.95], rnd() < 0.5)); };
  for (const lot of lots) {
    if (lot.garden) { const g = lot.garden; for (let i = 0; i < 6; i++) tuft(g.x + (rnd() - 0.5) * g.w * 0.8, g.z + (rnd() - 0.5) * g.d * 0.8, 0.8); if (rnd() < 0.35) placeSakura(fb, g.x, g.z, 4.8 + rnd() * 1.2, 0, 0, lot.seed + 11); else if (rnd() < 0.6) placeCardTree(fb, rnd() < 0.5 ? 'canopy_broad_a' : 'canopy_broad_b', g.x, g.z, 3.4 + rnd() * 1.4, 0.2, lot.seed + 13); }
    if (lot.weeds) for (let i = 0; i < 26; i++) tuft(lot.cx + (rnd() - 0.5) * lot.W * 0.85, lot.cz + (rnd() - 0.5) * lot.D * 0.85, 1.2);
    if (lot.pots) for (const [x, z, h] of lot.pots) for (let k = 0; k < 2; k++) fb.put(x, z, 'grass_card', grassMat, cardGeo(_tv(x, h + 0.12, z), 0.36, 0.3, rnd() * 3 + k * 1.57, 0, [0.7, 0.8, 0.6], false));
  }
  const flowerMat = canopyMat('flowers_card'), ivyMat = canopyMat('ivy_card');
  const flowers = (x, z, w = 0.9) => { const yaw = rnd() * Math.PI; for (let k = 0; k < 2; k++) fb.put(x, z, 'flowers_card', flowerMat, cardGeo(_tv(x, 0.2, z), w, w * 0.45, yaw + k * Math.PI / 2, 0, [1, 1, 1], rnd() < 0.5)); };
  for (const lot of lots) if (lot.garden) { const g = lot.garden; for (let i = 0; i < 5; i++) flowers(g.x + (rnd() - 0.5) * g.w * 0.8, g.z + (rnd() - 0.5) * g.d * 0.8, 0.7 + rnd() * 0.4); }
  for (const [x, z] of [[-22, -60], [-22, -50.5]]) { for (let a = 0; a < 6.28; a += 0.35) B.box(x + Math.cos(a) * 2.2, 0.12, z + Math.sin(a) * 2.2, 0.35, 0.24, 0.2, 'brickCity'); B.cyl(x, 0.08, z, 2.1, 2.1, 0.16, 'gardenSoil', 20); for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 1.8; flowers(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.8); } } // 공원 화단
  for (const [x, z] of TOWN_WEEDS) tuft(x, z, 0.38 + rnd() * 0.22);
  for (const [x, y, z, yaw, w, h] of TOWN_IVY) { const c = 0.7 + rnd() * 0.25, g = cardGeo(_tv(x, y, z), w, h, yaw, 0, [c, c, c], rnd() < 0.5); fb.put(x, z, 'ivy_card', ivyMat, g); }
  for (const [x0, z0, x1, z1] of park.grass) for (let i = 0; i < 160; i++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (isPointOpen(x, z, 0.4)) tuft(x, z, 1); }
  // 자판기 · 반사경
  townVending(B, 6.2, -3.8, Math.PI, 3); townVending(B, -19.2, -42.0, 0, 4); townVending(B, 70.5, -42.1, 0, 5);
  for (const [x, z, y] of [[3.8, -10.2, -Math.PI * 0.75], [-41.0, -10.2, Math.PI * 0.75], [41.0, 17.8, -Math.PI * 0.25], [-3.8, 17.8, Math.PI * 0.25], [3.8, -43.0, -Math.PI * 0.75], [-41.0, 51.0, Math.PI * 0.25], [47.0, 51.0, -Math.PI * 0.25], [-47.0, -43.0, Math.PI * 0.75]]) townMirror(B, x, z, y);
  tm('trees');
  buildTownPoles(B);
  buildTownSigns(B);
  tm('poles');
  // 지면 꽃잎: 벚나무 아래 원판(도로·산책로·마당 위) — 텍스처 미터 UV
  for (const t of SAKURA_TREES) {
    if (!t.decal) continue; // 정원 소형목은 원판 없음(집 안으로 번짐)
    const r = t.r + 1.4, g = new THREE.CircleGeometry(r, 22); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + t.x), (p.getZ(i) + t.z));
    const y = (t.z > TOWN.canal.z0 - 0.1 && t.z < TOWN.canal.z1 + 0.1) ? 0.06 : 0.052;
    g.translate(t.x, y, t.z); B.geo(t.x, t.z, TMAT.petalGround, g);
  }
  tm('decals');
  const nb = B.flush(), nf = fb.flush();
  tm('flush');
  for (const [key, x, y, z, o] of TOWN_PROPS) {
    if (key === '@car') { if (ASSETS.carCovered) placeModel('carCovered', x, z, { height: 1.45, rotY: o.rotY }); continue; }
    if (key === 'tyre') { placeProp('tyre', x, 0.02, z, o); continue; }
    if (ASSETS[key]) placeProp(key, x, y, z, o);
  }
  tm('props');
  townFx = { petals: makePetalSystem(), water: canal.water, raft: canal.raft, t: 0 };
  console.info(`[town] batch meshes ${nb} · forest ${nf} · lots ${lots.length} (houses ${lots.filter((l) => !l.vacant).length}, enter ${lots.filter((l) => l.enter).length}) · sakura ${SAKURA_TREES.length} · loot ${TOWN_LOOT.length} · props ${TOWN_PROPS.length} · lights ${townLights} · houses ${TOWN_HOUSES.length} · weeds ${TOWN_WEEDS.length} · ivy ${TOWN_IVY.length} · ms ${T.join(', ')}`);
  losMeshes = obstacleMeshes.filter((o) => !o.userData.terrainTile);
}
// ══════════════════════════════════════════════════════════════════════════════
// ── 벚꽃 동네 디테일 2단계 (#322): 원경 · 인입선/안테나 · 꽃놀이 등롱/돗자리 · 표지판/가로명판 · 쓰레기 집하장 · 풍화 · 개천 바닥 · 꽃 ──
// ══════════════════════════════════════════════════════════════════════════════
const TOWN_HOUSES = [];  // 인입선 부착점 {ax, ay, az}
const TOWN_WEEDS = [];   // 담 밑 잡초 [x, z]
const TOWN_IVY = [];     // 담쟁이 카드 [x, y, z, yaw, w, h]
function buildTownDetailMats() {
  if (TMAT.detailReady) return;
  const dec = (key, extra = {}) => { const m = new THREE.MeshStandardMaterial({ map: CANOPY_TEX[key] || null, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, ...extra }); m.userData = { noShadow: true, noHit: true }; return m; };
  TMAT.streak = dec('streak'); TMAT.grime = dec('grime');
  TMAT.tarp = new THREE.MeshStandardMaterial({ color: 0x2c64c4, roughness: 0.55 });
  TMAT.net = TMAT.chain.clone(); TMAT.net.color = new THREE.Color(0x3a8c46); TMAT.net.metalness = 0; TMAT.net.roughness = 0.9;
  TMAT.signGray = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.5, roughness: 0.4 });
  TMAT.rock = new THREE.MeshStandardMaterial({ color: 0x6f6b62, roughness: 0.95, flatShading: true });
  const lantern = (paper, rib, band) => signCanvas(128, 128, (g, W, H) => {
    g.fillStyle = paper; g.fillRect(0, 0, W, H);
    g.strokeStyle = rib; g.lineWidth = 2; for (let y = 6; y < H; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    if (band) { g.fillStyle = band; g.beginPath(); for (let i = 0; i < 5; i++) { const x = 14 + i * 26, y = 64; g.moveTo(x, y); g.arc(x, y, 9, 0, Math.PI * 2); } g.fill(); }
  });
  const la = lantern('#f6ecdc', '#d8c9b0', '#e98aa6'), lb = lantern('#d8453a', '#a8302a', null);
  TMAT.lanternA = new THREE.MeshStandardMaterial({ map: la, emissiveMap: la, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.8 });
  TMAT.lanternB = new THREE.MeshStandardMaterial({ map: lb, emissiveMap: lb, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.8 });
  const plate = (txt) => signCanvas(64, 224, (g, W, H) => { g.fillStyle = '#1d4f9c'; g.fillRect(0, 0, W, H); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(4, 4, W - 8, H - 8); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; [...txt].forEach((ch, i) => g.fillText(ch, W / 2, 44 + i * 38)); });
  TMAT.plates = ['桜町一丁目', '桜町二丁目', '川端三丁目'].map((t) => new THREE.MeshStandardMaterial({ map: plate(t), roughness: 0.5 }));
  const stop = signCanvas(256, 224, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(4, 4); g.lineTo(252, 4); g.lineTo(128, 220); g.closePath(); g.fill(); g.fillStyle = '#c8202a'; g.beginPath(); g.moveTo(18, 12); g.lineTo(238, 12); g.lineTo(128, 204); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.fillText('止まれ', 128, 72); g.font = 'bold 22px sans-serif'; g.fillText('STOP', 128, 102); });
  TMAT.stopSign = new THREE.MeshStandardMaterial({ map: stop, transparent: true, alphaTest: 0.5, roughness: 0.5 });
  const lim = signCanvas(192, 192, (g) => { g.fillStyle = '#c8202a'; g.beginPath(); g.arc(96, 96, 92, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(96, 96, 72, 0, Math.PI * 2); g.fill(); g.fillStyle = '#1d4f9c'; g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('30', 96, 100); });
  TMAT.limitSign = new THREE.MeshStandardMaterial({ map: lim, transparent: true, alphaTest: 0.5, roughness: 0.5 });
  const road = signCanvas(256, 128, (g) => { g.fillStyle = 'rgba(240,238,230,0.95)'; g.font = 'bold 96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('止まれ', 128, 68); });
  TMAT.roadStop = new THREE.MeshStandardMaterial({ map: road, transparent: true, alphaTest: 0.3, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 });
  TMAT.roadStop.userData = { noShadow: true, noHit: true };
  const win = signCanvas(64, 64, (g) => { g.fillStyle = '#b9b4aa'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#4c5660'; g.fillRect(10, 14, 36, 30); g.fillStyle = '#8e8a82'; g.fillRect(0, 54, 64, 10); }); // 원경 건물: 1칸 = 4m×3m
  win.wrapS = win.wrapT = THREE.RepeatWrapping; win.repeat.set(1 / 4, 1 / 3);
  TMAT.bgCity = [0xc9cad0, 0xb9c0c8, 0xd2d0cc, 0xb2b6bc].map((c) => { const m = new THREE.MeshStandardMaterial({ map: win, color: c, roughness: 0.9 }); m.userData = { worldUV: true, noHit: true }; return m; });
  TMAT.detailReady = true;
}

// 원경: 도시 실루엣(115~165m, 안개가 자연스레 흐림) + 산 능선 2겹(안개 무시, 지평선 색으로 미리 섞은 Basic) + 송전탑
function buildTownBackdrop() {
  const rnd = mulberry32(3221), geos = new Map();
  const put = (m, g) => { if (!geos.has(m)) geos.set(m, []); geos.get(m).push(g); };
  for (let a = 0; a < Math.PI * 2; a += 0.075) {
    const n = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const r = 138 + rnd() * 52, aa = a + (rnd() - 0.5) * 0.05, x = Math.cos(aa) * r, z = Math.sin(aa) * r; // 138~190m: 안개 48~78% → 동네 뒤로 흐릿한 교외
      const w = 12 + rnd() * 22, d = 10 + rnd() * 12, h = 7 + Math.pow(rnd(), 2.4) * 28, ry = -aa + (rnd() - 0.5) * 0.3; // 대부분 저층(7~15m), 드물게 30m대
      const m = TMAT.bgCity[Math.floor(rnd() * TMAT.bgCity.length)], g = new THREE.BoxGeometry(w, h, d);
      uvWorldBox(g, w, h, d); g.rotateY(ry); g.translate(x, h / 2 - 0.5, z); put(m, g);
      if (rnd() < 0.3) { const g2 = new THREE.BoxGeometry(3, 2.5, 3); g2.translate(x, h + 1, z); put(TMAT.bgCity[0], g2); } // 옥상 계단탑
    }
  }
  for (const [m, gs] of geos) { const mesh = new THREE.Mesh(mergeGeometries(gs, false), m); mesh.receiveShadow = false; scene.add(mesh); }
  const hor = new THREE.Color(0xdcd6dc);
  const ridge = (R, base, amp, col, mix, seed) => { // 링 스트립: 바닥 R, 꼭대기 R+30 (높이 = 노이즈)
    const r2 = mulberry32(seed), N = 160, P = [], idx = [];
    const hs = []; for (let i = 0; i <= N; i++) hs.push(base + amp * (0.5 + 0.5 * Math.sin(i * 0.19 + seed) * Math.sin(i * 0.071 + seed * 2)) + r2() * amp * 0.15);
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); P.push(c * R, -2, s * R, c * (R + 30), hs[i], s * (R + 30)); }
    for (let i = 0; i < N; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).lerp(hor, mix), fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -1; scene.add(mesh);
  };
  ridge(262, 14, 38, 0x5f7466, 0.62, 7); ridge(232, 6, 22, 0x6c7f6e, 0.52, 3);
  // 송전탑 2기(능선 앞) + 전선
  const towerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5a5f63).lerp(hor, 0.55), fog: false });
  const tg = [], tops = [];
  for (const a of [0.55, 1.05]) {
    const x = Math.cos(a) * 205, z = -Math.sin(a) * 205, H = 42;
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) tg.push(barkSegRaw(_tv(x + dx, 0, z + dz), _tv(x + dx * 0.25, H, z + dz * 0.25), 0.25, 0.18, 4));
    for (let y = 8; y < H; y += 8) { const s = 3 * (1 - y / H * 0.75); for (const q of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]]) tg.push(barkSegRaw(_tv(x + q[0], y, z + q[1]), _tv(x + q[2], y, z + q[3]), 0.12, 0.12, 4)); }
    for (const y of [H - 6, H - 14]) { const g = new THREE.BoxGeometry(14, 0.6, 0.6); g.translate(x, y, z); tg.push(g); }
    tops.push([x, H - 6, z]);
  }
  for (const g of tg) { if (!g.index) { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); } for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); }
  scene.add(new THREE.Mesh(mergeGeometries(tg, false), towerMat));
  const WP = [], [a, b] = tops, span = Math.hypot(b[0] - a[0], b[2] - a[2]);
  for (const o of [-6, 0, 6]) for (let i = 0; i < 16; i++) for (const t of [i / 16, (i + 1) / 16]) WP.push(a[0] + (b[0] - a[0]) * t + o * 0.3, a[1] + (b[1] - a[1]) * t - span * 0.05 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t + o);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(WP, 3));
  scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: new THREE.Color(0x4a4e52).lerp(hor, 0.5), fog: false })));
}

function tvAntenna(B, x, y, z, yaw) { // 지붕 TV 안테나(八木): 마스트 + 붐 + 소자 7
  B.seg(_tv(x, y, z), _tv(x, y + 2.1, z), 0.025, TMAT.aluSilver, 5);
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (a, h) => _tv(x + s * a, y + h, z + c * a);
  B.seg(P(-0.9, 1.9), P(0.9, 1.9), 0.015, TMAT.aluSilver, 4);
  for (let i = 0; i < 7; i++) { const a = -0.8 + i * 0.27, L = 0.55 - i * 0.04, p = P(a, 1.9); B.seg(_tv(p.x - c * L, p.y, p.z + s * L), _tv(p.x + c * L, p.y, p.z - s * L), 0.008, TMAT.aluSilver, 3); }
  B.seg(_tv(x, y + 0.15, z), _tv(x + 0.7, y - 0.05, z + 0.4), 0.008, TMAT.trimDark, 3); // 지선
}

// 꽃놀이: 산책로 따라 대나무 기둥 + 등롱 줄(초롱 발광) — 다리·도로 구간에서 끊김
function buildTownHanami(B, nearGap) {
  const W = [], rnd = mulberry32(3222);
  for (const z of [-3.95, 11.45]) {
    let prev = null;
    for (let x = -84; x <= 84.01; x += 11) {
      if (nearGap(x) || !isPointOpen(x, z, 0.2)) { prev = null; continue; }
      B.cyl(x, 1.85, z, 0.045, 0.055, 3.7, TMAT.shrineWood, 6, true);
      B.cyl(x, 3.72, z, 0.06, 0.06, 0.08, TMAT.poleBlack, 6);
      if (prev !== null && x - prev < 11.5) {
        const N = Math.round((x - prev) / 1.05), sag = 0.32;
        for (let i = 0; i < 12; i++) for (const t of [i / 12, (i + 1) / 12]) W.push(prev + (x - prev) * t, 3.55 - sag * 4 * t * (1 - t), z);
        for (let i = 1; i < N; i++) {
          const t = i / N, lx = prev + (x - prev) * t, ly = 3.55 - sag * 4 * t * (1 - t) - 0.26;
          W.push(lx, ly + 0.26, z, lx, ly + 0.17, z);
          B.cyl(lx, ly, z, 0.12, 0.12, 0.3, (i + (z > 0 ? 1 : 0)) % 3 === 0 ? TMAT.lanternB : TMAT.lanternA, 10);
          B.cyl(lx, ly + 0.165, z, 0.075, 0.075, 0.035, TMAT.poleBlack, 8); B.cyl(lx, ly - 0.165, z, 0.075, 0.075, 0.035, TMAT.poleBlack, 8);
        }
      }
      prev = x;
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(W, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2826 })));
  // 돗자리 + 도시락·컵·병·보냉백·신발
  for (const [x, z, yaw] of [[-27, -64.5, 0.2], [-14.5, -57, -0.3], [-34, -76, 0.5], [-10, -50, 1.2], [-51, -1.6, 0.05], [30, 9.2, -0.08], [-70, 9.4, 0.1]]) {
    if (!isPointOpen(x, z, 1.2)) continue;
    B.boxR(x, 0.03, z, 2.6, 0.012, 2.0, TMAT.tarp, 0, yaw, 0);
    const c = Math.cos(yaw), s = Math.sin(yaw), P = (a, b) => [x + a * c + b * s, z - a * s + b * c];
    for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) { const [px, pz] = P((rnd() - 0.5) * 1.4, (rnd() - 0.5) * 1.0); B.boxR(px, 0.07, pz, 0.26, 0.07, 0.19, [TMAT.red, TMAT.trimDark, TMAT.yellow, TMAT.white][Math.floor(rnd() * 4)], 0, yaw + rnd(), 0); }
    for (let i = 0; i < 3; i++) { const [px, pz] = P((rnd() - 0.5) * 1.6, (rnd() - 0.5) * 1.2); B.cyl(px, 0.09, pz, 0.035, 0.03, 0.12, TMAT.white, 8); }
    { const [px, pz] = P(0.9, -0.6); B.cyl(px, 0.17, pz, 0.04, 0.045, 0.3, TMAT.green, 8); }
    if (rnd() < 0.7) { const [px, pz] = P(-1.0, 0.7); B.boxR(px, 0.2, pz, 0.5, 0.36, 0.34, rnd() < 0.5 ? TMAT.blue : TMAT.white, 0, yaw, 0); }
    for (let i = 0; i < 2; i++) { const [px, pz] = P(-0.6 + i * 0.5, 1.2); for (const d of [-0.07, 0.07]) B.boxR(px + d * c, 0.05, pz - d * s, 0.1, 0.08, 0.26, [TMAT.trimDark, TMAT.white, TMAT.red][i % 3], 0, yaw, 0); }
  }
}

// 표지판(멈춤·속도제한) + 노면 「止まれ」 + 쓰레기 집하장 + 자전거 거치대
function buildTownSigns(B) {
  const C = TOWN.canal, rnd = mulberry32(3223);
  const signAt = (x, z, yaw, mat, w, h, y) => {
    B.cyl(x, y / 2, z, 0.035, 0.035, y, TMAT.signGray, 6, true);
    const g = new THREE.BoxGeometry(w, h, 0.02); g.rotateY(yaw); g.translate(x + Math.sin(yaw) * 0.04, y - h / 2 + 0.1, z + Math.cos(yaw) * 0.04); B.geo(x, z, mat, g);
  };
  let n = 0;
  for (const [x0, x1] of TOWN.roadsNS) for (const [z0, z1] of TOWN.roadsEW) for (const [z, s] of [[z0 - 0.6, -1], [z1 + 0.6, 1]]) {
    if (z > C.z0 - 6 && z < C.z1 + 6) continue;
    const xm = (x0 + x1) / 2, lane = xm + ((x1 - x0) / 4) * -s;
    const g = new THREE.PlaneGeometry(2.0, 1.0); g.rotateX(-Math.PI / 2); g.rotateY(s > 0 ? 0 : Math.PI); g.translate(lane, 0.046, z + s * 1.6); B.geo(lane, z, TMAT.roadStop, g);
    if (n++ % 2 === 0) { const sx = s > 0 ? x0 - 0.5 : x1 + 0.5, sz = z + s * 0.9; if (isPointOpen(sx, sz, 0.3)) signAt(sx, sz, s > 0 ? Math.PI : 0, TMAT.stopSign, 0.8, 0.7, 2.4); }
  }
  for (const [x, z, yaw] of [[-3.5, -30, 0], [3.5, 34, Math.PI], [-41.1, 30, 0], [41.1, -25, Math.PI], [-60, -37.2, Math.PI / 2], [62, 45.8, -Math.PI / 2]]) if (isPointOpen(x, z, 0.3)) signAt(x, z, yaw, TMAT.limitSign, 0.6, 0.6, 2.3);
  // 쓰레기 집하장: 도로 가장자리, 초록 그물 + 봉투(프롭) + 작은 안내판
  for (const [x, z, alongX] of [[-30, -9.1, true], [26, 16.6, true], [-62, -42.1, true], [58, 50.1, true], [-40.9, -25, false], [2.6, 58, false]]) {
    if (!isPointOpen(x, z, 0.8)) continue;
    const w = alongX ? 1.6 : 0.9, d = alongX ? 0.9 : 1.6;
    const g = new THREE.BoxGeometry(w, 0.75, d); g.translate(x, 0.38, z); B.geo(x, z, TMAT.net, g);
    for (let i = 0; i < 3; i++) TOWN_PROPS.push(['trashbag', x + (alongX ? (i - 1) * 0.45 : 0), 0.03, z + (alongX ? 0 : (i - 1) * 0.45), { rotY: rnd() * 6, height: 0.5 }]);
    B.box(x + (alongX ? w / 2 + 0.1 : 0), 0.6, z + (alongX ? 0 : d / 2 + 0.1), 0.04, 1.2, 0.04, TMAT.aluSilver);
    B.box(x + (alongX ? w / 2 + 0.1 : 0), 1.15, z + (alongX ? 0 : d / 2 + 0.1), alongX ? 0.02 : 0.4, 0.3, alongX ? 0.4 : 0.02, TMAT.white);
  }
  // 자전거 거치대(공원 정문 안쪽)
  for (let i = 0; i < 5; i++) { const x = -29 + i * 0.7, z = -44.6; B.seg(_tv(x, 0, z - 0.3), _tv(x, 0.45, z - 0.3), 0.02, TMAT.aluSilver); if (i < 4) townBike(B, x + 0.35, z - 0.3, Math.PI, 40 + i); }
}

// 개천 바닥 디테일: 자갈 돌 · 수초 · 배수구 + 빗물 자국 · 가장자리 꽃잎 퇴적 띠
function buildTownCanalDetail(B, fb) {
  const C = TOWN.canal, rnd = mulberry32(3224), grassMat = canopyMat('grass_card');
  for (let i = 0; i < 160; i++) {
    const x = (rnd() - 0.5) * 172, edge = rnd() < 0.5, z = edge ? (rnd() < 0.5 ? C.z0 + 0.25 + rnd() * 0.8 : C.z1 - 0.25 - rnd() * 0.8) : C.z0 + 1 + rnd() * 4;
    if (TOWN.bridges.some(([a, b]) => x > a - 0.5 && x < b + 0.5)) continue;
    const r = 0.12 + rnd() * (edge ? 0.35 : 0.2), g = new THREE.DodecahedronGeometry(r, 0); g.scale(1, 0.55, 1 + rnd() * 0.4); g.rotateY(rnd() * 6); g.translate(x, C.bed + r * 0.3, z); B.geo(x, z, TMAT.rock, g);
  }
  for (let i = 0; i < 120; i++) { // 수초(벽 가까이, 수면 위로 살짝)
    const x = (rnd() - 0.5) * 170, z = rnd() < 0.5 ? C.z0 + 0.2 + rnd() * 0.5 : C.z1 - 0.2 - rnd() * 0.5;
    if (TOWN.bridges.some(([a, b]) => x > a - 0.5 && x < b + 0.5)) continue;
    const c = 0.55 + rnd() * 0.3, yaw = rnd() * 3;
    for (let k = 0; k < 2; k++) fb.put(x, z, 'grass_card', grassMat, cardGeo(_tv(x, C.water + 0.12, z), 0.8, 0.45, yaw + k * 1.57, 0, [c * 0.8, c, c * 0.7], rnd() < 0.5));
  }
  for (const side of [-1, 1]) for (let x = -80 + rnd() * 10; x < 80; x += 18 + rnd() * 14) { // 배수구
    if (TOWN.bridges.some(([a, b]) => x > a - 2 && x < b + 2) || TOWN.ramps.some((r) => r.side === side && x > r.x0 - 3 && x < r.x0 + TOWN.rampLen + 1)) continue;
    const zi = side < 0 ? C.z0 : C.z1, g = new THREE.CylinderGeometry(0.17, 0.17, 0.3, 12); g.rotateX(Math.PI / 2); g.translate(x, -1.05, zi - side * 0.12); B.geo(x, zi, 'concrete', g);
    const h = new THREE.CircleGeometry(0.12, 12); h.rotateY(side < 0 ? 0 : Math.PI); h.translate(x, -1.05, zi - side * 0.271); B.geo(x, zi, TMAT.interior, h);
    B.box(x, -1.5, zi - side * 0.014, 0.5, 0.8, 0.004, TMAT.streak);
  }
  const pt = (CANOPY_TEX.sakura_raft || CANOPY_TEX.sakura_ground); // 가장자리 꽃잎 퇴적(더 조밀)
  if (pt) for (const side of [-1, 1]) {
    const t = pt.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(WORLD_HALF * 2 / 1.1, 1);
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, depthWrite: false, roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, 0.9), m); mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, C.water + 0.009, (side < 0 ? C.z0 + 0.45 : C.z1 - 0.45)); scene.add(mesh);
    townFxExtra.push(t);
  }
}
const townFxExtra = []; // 흐르는 텍스처(가장자리 꽃잎)

function updateTownFx(dt) {
  if (!townFx) return;
  townFx.t += dt;
  if (townFx.water) { townFx.water.offset.x = townFx.t * 0.012; townFx.water.offset.y = Math.sin(townFx.t * 0.2) * 0.02; }
  if (townFx.raft) townFx.raft.offset.x = townFx.t * 0.018;
  for (const t of townFxExtra) t.offset.x = townFx.t * 0.012;
  townFx.petals.update(dt, camera.position);
}
const MAP_TOWN = {
  key: 'town', name: '벚꽃 동네', desc: '벚꽃 흩날리는 개천변 주택가 — 골목·담장·개천 트렌치 근접전',
  build: buildTownMap,
  terrain: townTerrain,
  sun: [55, 48, 40], // 남동 오전광 — 개천변 벚꽃 역광 방지, 집 정면(+z) 채광
  look: 'spring',
  flattens: [],
  lootSpots: TOWN_LOOT,
  extract: [
    { name: '북쪽 간선 끝', pos: new THREE.Vector3(0, 0, -83) },
    { name: '남쪽 간선 끝', pos: new THREE.Vector3(0, 0, 83) },
    { name: '개천 하류 수문', pos: new THREE.Vector3(83, 0, 4) },
    { name: '서쪽 골목', pos: new THREE.Vector3(-83, 0, 69) },
  ],
  spawns: [
    new THREE.Vector3(0, 0, -80), new THREE.Vector3(0, 0, 80), new THREE.Vector3(-82, 0, -7),
    new THREE.Vector3(82, 0, 14.5), new THREE.Vector3(-82, 0, 48), new THREE.Vector3(82, 0, -40),
  ],
  barrels: [[-20, -6.5, false], [25, 15, true], [-60, 48, false], [60, -40, true], [1.5, 30, false], [-44, -25, true], [44, 30, false], [-30, -40, false]],
};


// ── 사격 연습장 (#209): 반동·탄퍼짐·탄착군 연습. 적 없음·무한탄약·전 무기, 거리별 표적 + 후벽 ──
function rangeBullseyeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, 128, 128);
  for (const [r, col] of [[60, '#1c1c1c'], [50, '#2b6cc0'], [40, '#c8302e'], [30, '#f0f0f0'], [20, '#c8302e'], [10, '#ffcf3a']]) { g.fillStyle = col; g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}
function rangeLabelTexture(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 88;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(14,20,14,0.82)'; g.fillRect(0, 0, 256, 88);
  g.fillStyle = '#eaf2df'; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 48);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}
// ── 사격 연습장 보완 (#292): 리얼 사격장(자갈·흙 버름 백스톱·골강판 셸터·레인 4) + 반응 표적(종이 링 점수 / 실루엣 HEAD·BODY 존 /
// 스틸 공 진자 흔들림 + 거리 지연 딩) + 스코어 HUD(발사·명중·명중률·마지막·5발 그룹). T 로 리셋. 표적은 obstacleMeshes 에 들어가 탄 레이에 맞는다.
let rangeTargets = [];
// 무기별 통계 (#295): GUN.key 별 { shots, hits, last, groups, groupText }. rs() = 현재 무기 통계. T 는 전부 리셋.
const rangeStats = new Map();
// 통계 키 = 무기 + 부착물(정렬) (#298): 'rifle', 'rifle+grip+scope' … 부착물 조합별로 따로 센다
const ATT_SHORT = { scope: '스코프', silencer: '소음기', grip: '그립' };
function statKey() { const k = (typeof GUN !== 'undefined' && GUN && GUN.key) || 'rifle'; const a = (currentAtt || []).slice().sort(); return a.length ? k + '+' + a.join('+') : k; }
function statLabel() { const n = (typeof GUN !== 'undefined' && GUN && GUN.name) || '사격 연습장'; const a = (currentAtt || []).map((x) => ATT_SHORT[x] || x); return a.length ? `${n} +${a.join('·')}` : n; }
function rs() { const k = statKey(); let v = rangeStats.get(k); if (!v) { v = { shots: 0, hits: 0, last: '—', groups: new Map(), groupText: '—' }; rangeStats.set(k, v); } return v; }
// 드릴 (#295): 팝업 실루엣 5기가 무작위 순서로 하나씩 서고, 맞히면 눕고 다음이 선다. 총 시간·정확도 → 베스트(localStorage exshoot_range_best)
// 모드 (#298, U 전환): 표준 / 시간제한(limit 초 안에 못 맞히면 눕음 = 놓침, 놓침당 penalty 초) / HEAD(머리만 인정). 베스트 키 = 통계키(+'|모드'), 최근 기록 exshoot_range_hist
const DRILL_MODES = [{ key: 'standard', name: '표준' }, { key: 'timed', name: '시간제한', limit: 2.5, penalty: 3 }, { key: 'head', name: 'HEAD' }];
const drill = { active: false, order: [], idx: 0, t: 0, wait: 0, shots0: 0, result: '', best: {}, mode: 0, upT: 0, misses: 0, hist: [] };
try { drill.best = JSON.parse(localStorage.getItem('exshoot_range_best')) || {}; } catch { drill.best = {}; }
try { drill.hist = JSON.parse(localStorage.getItem('exshoot_range_hist')) || []; } catch { drill.hist = []; }
function drillMode() { return DRILL_MODES[drill.mode]; }
function drillBestKey() { const m = drillMode().key; return m === 'standard' ? statKey() : statKey() + '|' + m; }
function cycleDrillMode() { if (drill.active) return; drill.mode = (drill.mode + 1) % DRILL_MODES.length; drill.result = ''; addFeed(`드릴 모드: ${drillMode().name}${drillMode().limit ? ` (표적당 ${drillMode().limit}s, 놓치면 +${drillMode().penalty}s)` : drillMode().key === 'head' ? ' (머리만 인정)' : ''}`); tone({ freq: 620, dur: 0.07, gain: 0.1 }); updateRangeHud(); }
const recoilTrace = []; // 최근 사격의 반동 오프셋 [{yaw, pitch, t}] → 크로스헤어 위 궤적 (#295)
// 반동 패턴 스냅샷 (#298): 5발 이상 연사(발사 간격 <0.5s)가 끝나면 통계키별로 첫 발 기준 상대 오프셋을 저장(localStorage exshoot_recoil_pat) → 회색으로 현재 궤적 뒤에 겹쳐 비교
const recoilPat = { store: {}, burst: [], lastT: 0, saved: true };
try { recoilPat.store = JSON.parse(localStorage.getItem('exshoot_recoil_pat')) || {}; } catch { recoilPat.store = {}; }
let rfTick = 0; const _rfDir = new THREE.Vector3(); // 거리계 (#298): 4프레임마다 조준 레이 거리
let bodyTick = 0, bodyDirty = true; // 신체 HUD 갱신 주기 (#304) — 피격/치료 시 즉시
function drawBodyHud() { // 부위 색: 초록>60% · 노랑>30% · 빨강>0 · 검정(부상). 출혈 부위엔 붉은 점
  const c = dom.bodyHud, g = c.getContext('2d'), W = c.width, H = c.height; g.clearRect(0, 0, W, H);
  const col = (k) => { const f = partFrac(k); return f <= 0 ? '#151515' : f < 0.3 ? '#d94f3d' : f < 0.6 ? '#d9b23c' : '#6fb85f'; };
  const box = (k, x, y, w, h) => { g.fillStyle = col(k); g.fillRect(x, y, w, h); g.strokeStyle = partFrac(k) <= 0 ? '#d94f3d' : 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); };
  g.fillStyle = col('head'); g.beginPath(); g.arc(W / 2, 11, 8, 0, Math.PI * 2); g.fill(); g.strokeStyle = partFrac('head') <= 0 ? '#d94f3d' : 'rgba(0,0,0,0.6)'; g.stroke();
  box('thorax', 17, 22, 22, 22); box('stomach', 17, 45, 22, 14);
  box('arms', 6, 22, 9, 34); box('arms', 41, 22, 9, 34);
  box('legs', 18, 60, 9, 34); box('legs', 29, 60, 9, 34);
  const at = { head: [W / 2 + 9, 6], thorax: [40, 26], stomach: [40, 50], arms: [14, 26], legs: [28, 64] };
  for (const k of player.bleeds || []) { const [x, y] = at[k]; g.fillStyle = '#ff3b2f'; g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  if (painFree()) { g.font = '11px sans-serif'; g.textAlign = 'right'; g.fillText('💊', W - 1, 12); } // 진통제 중 (#307)
}
function rangeSilhouetteTexture() { // 실루엣 표적: 판지 + 회색 인체 + 머리(빨강)/몸통 중심(노랑) 존
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#c9b48e'; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(64, 44, 20, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(30, 74); g.lineTo(98, 74); g.lineTo(108, 250); g.lineTo(20, 250); g.closePath(); g.fill();
  g.lineWidth = 3; g.strokeStyle = '#d64c3c'; g.beginPath(); g.arc(64, 44, 22, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#e0c060'; g.beginPath(); g.rect(40, 96, 48, 70); g.stroke();
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}
function rangeFrame(x, z, w, h) { for (const s of [-1, 1]) addBox(x + s * w / 2, h / 2, z + 0.06, 0.1, h, 0.1, MAT.woodDark, { collide: false }); addBox(x, h, z + 0.06, w + 0.2, 0.08, 0.1, MAT.woodDark, { collide: false }); }
function addRangeLabel(x, z, dist) { const l = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.58), new THREE.MeshBasicMaterial({ map: rangeLabelTexture(dist + ' m'), transparent: true })); l.position.set(x, 3.05, z); scene.add(l); }
function addPaperTarget(x, z, dist) { // 종이 과녁: 링 점수 10~3 (텍스처 링 반지름 비율)
  rangeFrame(x, z, 1.3, 2.6);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9), new THREE.MeshLambertMaterial({ map: rangeBullseyeTexture() }));
  board.position.set(x, 1.55, z); board.receiveShadow = true; scene.add(board); obstacleMeshes.push(board); // 기본 plane 법선 +z = 사수쪽
  board.userData.rangeTarget = { kind: 'paper', dist, mesh: board, id: rangeTargets.length, hw: 0.65, hh: 0.95 };
  rangeTargets.push(board.userData.rangeTarget); addRangeLabel(x, z, dist);
}
function addSilhouette(x, z, dist) { // 실루엣: HEAD / BODY / 가장자리
  rangeFrame(x, z, 0.9, 2.5);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), new THREE.MeshLambertMaterial({ map: rangeSilhouetteTexture() }));
  board.position.set(x, 1.4, z); board.receiveShadow = true; scene.add(board); obstacleMeshes.push(board);
  board.userData.rangeTarget = { kind: 'silhouette', dist, mesh: board, id: rangeTargets.length };
  rangeTargets.push(board.userData.rangeTarget); addRangeLabel(x, z, dist);
}
function addGong(x, z, dist, r) { // 스틸 공: 녹슨 프레임 크로스바에 체인 2줄로 매단 원판 — 피격 시 진자 흔들림 + 딩
  const top = 2.6, L = 0.55;
  for (const s of [-1, 1]) addBox(x + s * (r + 0.35), top / 2, z, 0.08, top, 0.08, MAT.rust, { collide: false });
  addBox(x, top, z, r * 2 + 0.9, 0.08, 0.08, MAT.rust, { collide: false });
  const pivot = new THREE.Group(); pivot.position.set(x, top, z); scene.add(pivot);
  for (const s of [-1, 1]) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, L, 5), MAT.rust); ch.position.set(s * r * 0.6, -L / 2, 0); pivot.add(ch); }
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 24), MAT.steel); plate.rotation.x = Math.PI / 2; plate.position.set(0, -L - r, 0);
  plate.castShadow = true; pivot.add(plate); obstacleMeshes.push(plate);
  plate.userData.rangeTarget = { kind: 'gong', dist, mesh: plate, id: rangeTargets.length, pivot, L: L + r, ang: 0, vel: 0 };
  rangeTargets.push(plate.userData.rangeTarget); addRangeLabel(x, z + 0.3, dist);
}
function addPopupSilhouette(x, z, dist) { // 드릴 팝업 표적 (#295): 바닥 힌지 그룹 — 눕힘(rotation.x −90°, 사수 반대쪽으로) ↔ 세움(0)
  const hinge = new THREE.Group(); hinge.position.set(x, 0, z); hinge.rotation.x = -Math.PI / 2; scene.add(hinge);
  addBox(x, 0.06, z + 0.15, 0.6, 0.12, 0.5, MAT.rust, { collide: false }); // 힌지 베이스
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), new THREE.MeshLambertMaterial({ map: rangeSilhouetteTexture(), side: THREE.DoubleSide }));
  board.position.set(0, 0.92, 0); board.castShadow = true; hinge.add(board); obstacleMeshes.push(board);
  board.userData.rangeTarget = { kind: 'silhouette', dist, mesh: board, id: rangeTargets.length, popup: true, up: false, hinge };
  rangeTargets.push(board.userData.rangeTarget);
  return board.userData.rangeTarget;
}
function addMover(z, dist, x0, x1) { // 이동 표적 (#295): 지면 레일 위 실루엣 왕복. 맞히면 속도 단계 상승(3단계 순환)
  const cx = (x0 + x1) / 2, len = x1 - x0 + 1.2;
  addBox(cx, 0.06, z, len, 0.12, 0.16, MAT.steel, { collide: false });                      // 레일
  for (const x of [x0 - 0.5, x1 + 0.5]) addBox(x, 0.3, z, 0.25, 0.6, 0.25, MAT.rust, { collide: false }); // 엔드 포스트
  const car = new THREE.Group(); car.position.set(x0, 0, z); scene.add(car);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.45), MAT.rust); base.position.y = 0.2; car.add(base);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), new THREE.MeshLambertMaterial({ map: rangeSilhouetteTexture(), side: THREE.DoubleSide }));
  board.position.set(0, 1.2, 0); board.castShadow = true; car.add(board); obstacleMeshes.push(board);
  board.userData.rangeTarget = { kind: 'silhouette', dist, mesh: board, id: rangeTargets.length, mover: { car, x0, x1, dir: 1, level: 1 } };
  rangeTargets.push(board.userData.rangeTarget);
  const l = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.58), new THREE.MeshBasicMaterial({ map: rangeLabelTexture(dist + ' m 이동'), transparent: true })); l.position.set(cx, 3.05, z); scene.add(l);
  return board.userData.rangeTarget;
}
const MOVER_SPEEDS = [1.6, 2.6, 3.8];
function drillTargets() { return rangeTargets.filter((t) => t.popup); }
function startDrill() { // Y: 드릴 시작(진행 중이면 재시작)
  const ps = drillTargets(); if (!state.range || !ps.length) return;
  for (const t of ps) t.up = false;
  const order = ps.map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  Object.assign(drill, { active: true, order, idx: 0, t: 0, wait: 0.8, shots0: rs().shots, result: '', upT: 0, misses: 0 });
  addFeed(`드릴 시작 [${drillMode().name}] — 표적이 서면 ${drillMode().key === 'head' ? '머리를 ' : ''}쏘세요 (5기)`); tone({ freq: 880, dur: 0.12, gain: 0.12 });
  updateRangeHud();
}
function finishDrill() {
  const ps = drillTargets(), n = ps.length, m = drillMode(), hitN = n - drill.misses, shots = Math.max(hitN, rs().shots - drill.shots0), acc = shots ? Math.round(100 * hitN / shots) : 0;
  const pen = (m.penalty || 0) * drill.misses, time = +(drill.t + pen).toFixed(1), key = drillBestKey();
  drill.active = false;
  const prev = drill.best[key], isBest = !prev || time < prev.time;
  if (isBest) { drill.best[key] = { time, acc }; try { localStorage.setItem('exshoot_range_best', JSON.stringify(drill.best)); } catch {} }
  drill.hist.unshift({ key, time, acc, ts: Date.now() }); drill.hist = drill.hist.slice(0, 30); try { localStorage.setItem('exshoot_range_hist', JSON.stringify(drill.hist)); } catch {}
  drill.result = `[${m.name}] ${time}s${pen ? `(+${pen}s)` : ''} · ${acc}%${isBest ? ' ★NEW' : ''}`;
  addFeed(`드릴 완료 [${m.name}] ${time}s · 정확도 ${acc}%${drill.misses ? ` · 놓침 ${drill.misses}` : ''}${isBest ? ' — 베스트 갱신!' : ''}`); tone({ freq: isBest ? 1320 : 660, dur: 0.25, gain: 0.14 });
  updateRangeHud();
}
function gongRing(dist) { // 금속 딩: 배음 3개 사인 감쇠, 거리만큼 늦게(340 m/s)·작게 — 소리로 명중 확인
  const ctx = audio(), t0 = ctx.currentTime + dist / 340, vol = 0.35 / (1 + dist / 45);
  for (const [f, g, d] of [[2350, 1.0, 0.7], [3560, 0.5, 0.45], [1180, 0.35, 0.9]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(vol * g, t0 + 0.004); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(gn).connect(sfxBus); o.start(t0); o.stop(t0 + d + 0.05);
  }
}
function rangeHit(t, h) {
  if (t.popup && !t.up) return; // 눕힌 팝업 표적은 무효
  const st = rs(); st.hits++;
  const local = t.mesh.worldToLocal(h.point.clone());
  let label;
  if (t.kind === 'paper') {
    const rn = Math.hypot(local.x / t.hw, local.y / t.hh), score = rn < 0.16 ? 10 : rn < 0.31 ? 9 : rn < 0.47 ? 8 : rn < 0.63 ? 7 : rn < 0.78 ? 6 : rn < 0.94 ? 5 : 3;
    label = `${t.dist}m ${score}점${score === 10 ? ' ★' : ''}`;
  } else if (t.kind === 'silhouette') {
    const head = Math.hypot(local.x, local.y - 0.63) < 0.17, body = Math.abs(local.x) < 0.3 && local.y > -0.35 && local.y < 0.42;
    label = `${t.dist}m ${t.mover ? '이동 ' : t.popup ? '드릴 ' : ''}${head ? 'HEAD ★' : body ? 'BODY' : '가장자리'}`;
    if (t.mover && (head || body)) { t.mover.level = t.mover.level % MOVER_SPEEDS.length + 1; label += ` → Lv${t.mover.level}`; tone({ freq: 520 + t.mover.level * 120, dur: 0.08, gain: 0.1 }); }
    if (t.popup && drill.active && (drillMode().key === 'head' ? head : (head || body))) { t.up = false; drill.idx++; drill.wait = 0.7; tone({ freq: 740, dur: 0.06, gain: 0.1 }); } // 드릴 진행 (HEAD 모드는 머리만)
  } else { t.vel += 2.2 + Math.random() * 0.6; gongRing(t.dist); label = `${t.dist}m 공 ♪`; } // 사수는 항상 +z 쪽 → 뒤로 ~40° 흔들림(6 이면 한 바퀴 넘어감)
  st.last = label;
  if (t.kind !== 'gong' && !t.mover && !t.popup) { // 고정 표적만: 같은 표적 최근 5발 그룹 크기(최대 쌍 거리, cm)
    const arr = st.groups.get(t.id) || []; arr.push([local.x, local.y]); while (arr.length > 5) arr.shift(); st.groups.set(t.id, arr);
    let mx = 0; for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) mx = Math.max(mx, Math.hypot(arr[i][0] - arr[j][0], arr[i][1] - arr[j][1]));
    st.groupText = arr.length >= 2 ? `${Math.round(mx * 100)} cm (${arr.length}발 @${t.dist}m)` : '—';
  }
  updateRangeHud();
}
function updateRangeTargets(dt) { // 스틸 공 진자(θ'' = −(g/L)·sin θ − c·θ') · 팝업 힌지 · 이동 표적 · 드릴 타이머
  for (const t of rangeTargets) {
    if (t.kind === 'gong' && (t.vel || t.ang)) {
      t.vel += (-(9.8 / t.L) * Math.sin(t.ang) - 1.4 * t.vel) * dt; t.ang += t.vel * dt; t.pivot.rotation.x = t.ang;
      if (Math.abs(t.ang) < 0.002 && Math.abs(t.vel) < 0.01) { t.ang = 0; t.vel = 0; t.pivot.rotation.x = 0; }
    } else if (t.popup) {
      const goal = t.up ? 0 : -Math.PI / 2; t.hinge.rotation.x += (goal - t.hinge.rotation.x) * Math.min(1, dt * (t.up ? 9 : 6));
    } else if (t.mover) {
      const m = t.mover, v = MOVER_SPEEDS[m.level - 1]; m.car.position.x += m.dir * v * dt;
      if (m.car.position.x > m.x1) { m.car.position.x = m.x1; m.dir = -1; } else if (m.car.position.x < m.x0) { m.car.position.x = m.x0; m.dir = 1; }
    }
  }
  if (drill.active) {
    drill.t += dt;
    if (drill.wait > 0) { drill.wait -= dt; if (drill.wait <= 0) { const ps = drillTargets(); if (drill.idx >= ps.length) finishDrill(); else { ps[drill.order[drill.idx]].up = true; drill.upT = 0; } } }
    else if (drillMode().limit) { // 시간제한: 표적당 limit 초 — 넘기면 스스로 눕고 놓침 (#298)
      drill.upT += dt;
      if (drill.upT > drillMode().limit) { const t = drillTargets()[drill.order[drill.idx]]; if (t) t.up = false; drill.misses++; drill.idx++; drill.wait = 0.7; tone({ freq: 220, dur: 0.15, gain: 0.12 }); }
    }
    if ((drill.t * 10 | 0) !== drill._shown) { drill._shown = drill.t * 10 | 0; updateRangeHud(); } // 0.1s 단위 갱신
  }
}
function resetRange() { // T: 전 무기 통계·그룹·공·드릴·이동 단계·반동 궤적·탄흔 리셋
  rangeStats.clear(); recoilTrace.length = 0; recoilPat.burst = []; recoilPat.saved = true;
  Object.assign(drill, { active: false, order: [], idx: 0, t: 0, wait: 0, result: '', upT: 0, misses: 0 });
  for (const t of rangeTargets) { if (t.kind === 'gong') { t.ang = 0; t.vel = 0; t.pivot.rotation.x = 0; } if (t.popup) t.up = false; if (t.mover) t.mover.level = 1; }
  for (const d of decals) scene.remove(d); decals = [];
  updateRangeHud();
}
function updateRangeHud() {
  if (!dom.rangeHud) return;
  const st = rs(), m = drillMode(), bk = drillBestKey(), n = drillTargets().length;
  if (dom.rhTitle) dom.rhTitle.textContent = `🎯 ${statLabel()}`;
  dom.rhShots.textContent = st.shots; dom.rhHits.textContent = st.hits;
  dom.rhAcc.textContent = st.shots ? Math.round(100 * st.hits / st.shots) + '%' : '—';
  dom.rhLast.textContent = st.last; dom.rhGroup.textContent = st.groupText || '—';
  if (dom.rhDrill) dom.rhDrill.textContent = drill.active ? `[${m.name}] ${Math.min(drill.idx, n)}/${n} · ${drill.t.toFixed(1)}s${drill.misses ? ` · 놓침 ${drill.misses}` : ''}` : (drill.result || `[${m.name}] Y 시작 · U 모드`);
  if (dom.rhBest) { const b = drill.best[bk]; dom.rhBest.textContent = b ? `${b.time}s · ${b.acc}%` : '—'; }
  if (dom.rhHist) { const h = drill.hist.filter((x) => x.key === bk).slice(0, 3); dom.rhHist.textContent = h.length ? h.map((x) => `${x.time}s`).join(' · ') : '—'; }
  if (dom.rhPat) { const pt = recoilPat.store[statKey()]; dom.rhPat.textContent = pt ? `${pt.length}발 저장 (회색)` : '5발+ 연사 시 저장'; }
}
const RANGE_FIRE_Z = 58, RANGE_EXIT_Z = 68; // 사격선(스폰) / 퇴장 지점(스폰 10m 뒤, 반경5 밖)
function buildRangeMap() {
  buildTexMats();
  scene.fog = new THREE.Fog(0xb0b6bd, 90, 280);
  buildGroundTiles(0xb3ada2, 'gravel'); // 자갈 마당 (#292)
  const backZ = -48, frontZ = 74, hx = 16, midZ = (backZ + frontZ) / 2, lz = frontZ - backZ, rr = mulberry32(292);
  const b = batchBuilder();
  // 버름(흙 둔덕, 3단 계단형): 측면 2 + 백스톱(높고 두꺼움). 콘크리트 벽 대체 — 밑단만 콜라이더
  const berm = (cx, cz, len, ax, h, base) => { let y = 0; for (const [w, sh] of [[base, h * 0.42], [base * 0.62, h * 0.33], [base * 0.28, h * 0.25]]) { if (ax === 'x') b.box(cx, y + sh / 2, cz, len, sh, w, 'dirt', y === 0); else b.box(cx, y + sh / 2, cz, w, sh, len, 'dirt', y === 0); y += sh; } };
  berm(0, backZ, hx * 2 + 12, 'x', 9, 7);                                       // 백스톱
  berm(-hx, midZ, lz + 6, 'z', 4.5, 5); berm(hx, midZ, lz + 6, 'z', 4.5, 5);    // 측면
  addBox(0, 3, frontZ, hx * 2 + 4, 6, 1, 'concreteStain', { shadow: false });   // 사수 뒤 벽
  b.box(0, 0.4, frontZ - 0.53, hx * 2 + 2, 0.8, 0.06, MAT.concreteDark, false);  // 그라임
  // 사격 셸터: 콘크리트 패드 + 강관 기둥 8 + 골강판 지붕(살짝 경사) + 레인 4(사격대·모래주머니 받침·칸막이)
  b.box(0, 0.03, 60, 30, 0.06, 8, 'paving', false);
  for (const x of [-14, -5, 5, 14]) for (const z of [56.5, 62.5]) b.cyl(x, 1.7, z, 0.07, 0.07, 3.4, MAT.lampPole, 8, true);
  addBoxRot(0, 3.5, 59.5, 30.5, 0.1, 7.6, 'corrugatedPale', { rx: 0.05 });
  for (const s of [-1, 1]) b.box(s * 7, 1.05, 57.4, 0.06, 2.1, 2.4, MAT.woodDark, true);
  for (const x of [-10.5, -3.5, 3.5, 10.5]) {
    b.box(x, 0.98, 56.9, 1.7, 0.06, 0.8, MAT.wood, true); for (const lx of [-0.75, 0.75]) b.box(x + lx, 0.48, 56.9, 0.06, 0.96, 0.7, MAT.woodDark, false);
    b.box(x, 1.13, 56.65, 0.7, 0.24, 0.35, MAT.sandbag, false);
  }
  b.box(0, 0.1, RANGE_FIRE_Z - 1.7, hx * 2 - 4, 0.2, 0.3, MAT.laneWhite, false); // 사격선(백색 턱)
  for (let d = 25; d <= 100; d += 25) { const z = RANGE_FIRE_Z - d; if (z > backZ + 6) for (const s of [-1, 1]) b.box(s * (hx - 2), 0.2, z, 0.4, 0.4, 0.08, MAT.laneWhite, false); } // 거리 마커
  b.flush();
  for (const [k, x, z] of [['crateWide', -12.5, 64], ['box', -9.6, 64.8], ['crateWide', 12.5, 64.2]]) weatherModel(placeModel(k, x, z, { height: 0.9, rotY: rr() * 6.28 }), 0.6, 0.95); // 탄약 상자(리컬러, crateWide 는 폭 2.3m 라 간격)
  weatherModel(placeModel('barrel', 14.5, 64.5, { height: 1.0 }), 0.7, 0.9);
  for (let i = -8; i <= 8; i += 2) placeProp('tyre', i * 1.1 + (rr() - 0.5) * 0.3, 0, backZ + 4.2, { rotY: (rr() - 0.5) * 0.4 }); // 백스톱 앞 타이어 열
  for (const [x, z] of [[-12, backZ + 5.5], [13, backZ + 5.5]]) addBox(x, 0.45, z, 2.4, 0.9, 0.9, MAT.sandbag);
  // 표적: 10m 실루엣+종이, 25/50m 종이+스틸 공+실루엣, 100m 종이+스틸 공(큰)
  addSilhouette(-6, RANGE_FIRE_Z - 10, 10); addPaperTarget(6, RANGE_FIRE_Z - 10, 10);
  addPaperTarget(-2.3, RANGE_FIRE_Z - 25, 25); addGong(3.5, RANGE_FIRE_Z - 25, 25, 0.25); addSilhouette(9, RANGE_FIRE_Z - 25, 25);
  addPaperTarget(-7, RANGE_FIRE_Z - 50, 50); addGong(-1.5, RANGE_FIRE_Z - 50, 50, 0.3); addSilhouette(7, RANGE_FIRE_Z - 50, 50);
  addPaperTarget(2.3, RANGE_FIRE_Z - 100, 100); addGong(8, RANGE_FIRE_Z - 100, 100, 0.4);
  for (const [x, d] of [[-11, 14], [11, 20], [-10.5, 28], [11.5, 36], [-11.5, 44]]) addPopupSilhouette(x, RANGE_FIRE_Z - d, d); // 드릴 팝업 5기 (#295) — 버름 안쪽 가장자리, 눕히면 시야 방해 없음
  addMover(RANGE_FIRE_Z - 35, 35, -6.5, 6.5); // 이동 표적 레일 (#295)
  { const fb = forestBatch(); // 버름 뒤·옆 카드 트리(실루엣)
    for (let i = 0; i < 14; i++) { const x = -34 + i * 5.2 + (rr() - 0.5) * 3, z = backZ - 9 - rr() * 12; placeCardTree(fb, rr() < 0.55 ? 'pine' : rr() < 0.8 ? 'canopy_broad_b' : 'canopy_broad_a', x, z, 8 + rr() * 6, 0.35, 900 + i); }
    for (let i = 0; i < 10; i++) { const s = i < 5 ? -1 : 1, x = s * (hx + 8 + rr() * 8), z = backZ + 10 + rr() * 100; placeCardTree(fb, rr() < 0.6 ? 'pine' : 'canopy_broad_a', x, z, 7 + rr() * 5, 0.35, 950 + i); }
    fb.flush(); }
  // 퇴장 안내판 (뒤돌면 보이게 -z 향함)
  const exitLbl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9), new THREE.MeshBasicMaterial({ map: rangeLabelTexture('🚪 퇴장'), transparent: true }));
  exitLbl.position.set(0, 2.9, RANGE_EXIT_Z); exitLbl.rotation.y = Math.PI; scene.add(exitLbl);
  losMeshes = obstacleMeshes.filter((o) => !o.userData.terrainTile);
}
const MAP_RANGE = {
  key: 'range', name: '🎯 사격 연습장', desc: '적 없음 · 무한 탄약 · 전 무기. 반동/탄퍼짐/탄착군 연습 (10~100m 표적 + 후벽)',
  range: true,
  build: buildRangeMap,
  sun: [20, 60, 80], // 사수 뒤(+z)에서 비추는 광 — 표적면·백스톱이 그늘지지 않게 (#292)
  flattens: [{ x: 0, z: 12, hw: 20, hd: 66 }],
  lootSpots: [],
  extract: [{ name: '퇴장', pos: new THREE.Vector3(0, 0, RANGE_EXIT_Z) }],
  spawns: [new THREE.Vector3(0, 0, RANGE_FIRE_Z)],
  barrels: [],
};

// ── 맵 레지스트리 (#165) ──────────────────────────────────
// 산업지대 데이터 스냅샷 (지금 FLATTENS/LOOT_SPOTS 등은 산업지대 값 — applyMap 이 active 를 교체)
const MAP_INDUSTRIAL = {
  key: 'industrial', name: '산업지대', desc: '컨테이너 야적장·창고·주택 단지',
  build: buildIndustrialMap,
  flattens: FLATTENS, lootSpots: LOOT_SPOTS, extract: EXTRACT_CANDIDATES,
  spawns: SPAWN_POINTS, barrels: PHYS_BARRELS,
};
const MAPS = { industrial: MAP_INDUSTRIAL, town: MAP_TOWN, school: MAP_SCHOOL, urban: MAP_URBAN, range: MAP_RANGE };
let currentMapKey = 'industrial';
let builtMapKey = null;
let staticObjects = []; // 현재 정적 맵이 scene 에 추가한 최상위 오브젝트 (맵 전환 시 제거)

function tearDownStatic() {
  for (const o of staticObjects) { scene.remove(o); o.traverse && o.traverse((c) => c.geometry && c.geometry.dispose && c.geometry.dispose()); }
  staticObjects = [];
  colliders = [];
  obstacleMeshes = [];
  losMeshes = [];
  placements = [];
  rangeTargets = []; // 연습장 표적 (#292)
  if (physWorld) { physWorld.free && physWorld.free(); physWorld = null; }
}

// 선택된 맵의 정적 지오메트리·물리를 구성 (필요 시 이전 맵 teardown)
let lastBuildInfo = null;
function applyMap(key) {
  if (builtMapKey === key) return;
  const m = MAPS[key] || MAP_INDUSTRIAL;
  if (builtMapKey) tearDownStatic();
  FLATTENS = m.flattens; LOOT_SPOTS = m.lootSpots; EXTRACT_CANDIDATES = m.extract;
  TERRAIN_FN = m.terrain || null; townFx = null; // (#319)
  SPAWN_POINTS = m.spawns; PHYS_BARRELS = m.barrels;
  setMapSun(m.sun); // 맵별 태양 방향 (#277)
  applyLook(m.look || 'default'); // 맵별 하늘·조명·그레이딩 (#319)
  const before = new Set(scene.children);
  const bk = BAKE.mode === 'record' ? null : (BAKED[key] && BAKED[key].hash === SRC_HASH ? BAKED[key] : null);
  if (bk) { BAKE.mode = 'replay'; BAKE.data = bk; BAKE.seq = 0; BAKE.used = 0; BAKE.fail = null; }
  const t0 = performance.now();
  try { m.build(); } finally { if (bk) BAKE.mode = null; }
  if (bk && (BAKE.seq !== bk.batchCount || BAKE.used !== bk.entryCount || BAKE.fail)) { // 불일치 → 버리고 절차 생성으로 다시 (#325)
    console.warn(`[bake] ${key}: 재생 불일치(배치 ${BAKE.seq}/${bk.batchCount}, 메시 ${BAKE.used}/${bk.entryCount}${BAKE.fail ? ', ' + BAKE.fail : ''}) — 절차 생성으로 재빌드`);
    for (const c of scene.children) if (!before.has(c)) scene.remove(c);
    colliders = []; obstacleMeshes = []; losMeshes = []; placements = []; rangeTargets = [];
    delete BAKED[key]; m.build();
  }
  lastBuildInfo = { key, ms: Math.round(performance.now() - t0), baked: !!bk && !!BAKED[key] };
  console.info(`[map] ${key} 빌드 ${lastBuildInfo.ms}ms (${lastBuildInfo.baked ? '구운 형상' : '절차 생성'})`);
  for (const c of scene.children) if (!before.has(c)) staticObjects.push(c);
  buildPhysicsStatics();
  checkMapOverlaps(); // 배치 겹침 진단 (#215) — 겹침 있으면 console.warn + mapOverlaps 에 저장
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
  for (const pr of projectiles) if (pr.line) scene.remove(pr.line); projectiles = []; // 발사체 정리 (#301)
  tracers = [];
  for (const d of decals) scene.remove(d); // 탄흔 데칼 정리 (#208)
  decals = [];
  for (const c of corpses) scene.remove(c);
  corpses = [];
  clearPhysics(); // 물리 소품/래그돌 정리 (#119)
}

// 레이드 시작 (#325): 로딩 표시 → 구운 형상 로드(비동기) → 빌드 → 셰이더 선컴파일(renderer.compileAsync, 그동안 렌더 보류) → 표시
let renderHold = false, raidLoadingEl = null;
async function beginRaid(key) {
  if (!raidLoadingEl) { raidLoadingEl = document.createElement('div'); raidLoadingEl.style.cssText = 'position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(8,12,10,.86);color:#dfe8df;font-size:20px;letter-spacing:2px'; document.body.appendChild(raidLoadingEl); }
  raidLoadingEl.textContent = '지역 불러오는 중…'; raidLoadingEl.hidden = false;
  try {
    await Promise.race([loadBaked(key), new Promise((r) => setTimeout(r, 20000))]);
    await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 120))]); // 오버레이를 먼저 그린 뒤 동기 빌드 (탭이 백그라운드면 rAF 가 멈추므로 타임아웃 병행)
    startRaid(key);
    if (state.phase === 'raid' && renderer.compileAsync) {
      raidLoadingEl.textContent = '셰이더 준비 중…'; renderHold = true;
      const t0 = performance.now();
      await Promise.race([renderer.compileAsync(scene, camera).catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
      console.info(`[raid] 셰이더 선컴파일 ${Math.round(performance.now() - t0)}ms`);
    }
  } finally { renderHold = false; raidLoadingEl.hidden = true; }
}
function startRaid(mapKey) {
  if (!assetsReady) return;
  clearRaidObjects();
  applyMap(mapKey || currentMapKey); // 선택 맵 구성 (전환 시 이전 맵 teardown)
  const isRange = !!(MAPS[currentMapKey] && MAPS[currentMapKey].range); // 사격 연습장 모드 (#209)
  state.range = isRange;
  dom.rangeHud.style.display = isRange ? 'block' : 'none'; dom.hud.classList.toggle('range', isRange); if (isRange) resetRange(); // 스코어 HUD (#292) + 터치 버튼 (#295)

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
  resetBodyParts(); // 부위별 체력 (#304)
  player.wTier = undefined; // 무게 단계 피드 리셋 (#310)

  const stash0 = loadStash();
  const owned0 = (stash0.weapons || ['rifle']).filter((k) => WEAPONS[k]);
  // 로드아웃 반입 무기 (#189): 선택된 것만 반입(미설정 시 소지 전량), 최소 1정 보장
  let lw = Array.isArray(stash0.loadoutW) ? stash0.loadoutW.filter((k) => owned0.includes(k)) : owned0.slice();
  if (!lw.length) lw = [owned0.includes('rifle') ? 'rifle' : (owned0[0] || 'rifle')];
  carry = isRange ? Object.keys(WEAPONS) : lw; // 연습장은 전 무기 반입 (#209)
  for (const k of Object.keys(weaponAmmo)) delete weaponAmmo[k];
  for (const k of carry) { const ew = effectiveWeapon(k); weaponAmmo[k] = { mag: ew.magSize, reserve: isRange ? 9990 : ew.reserveMax }; } // 연습장 무한 탄약
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
    for (const c of broughtCons) inventory.push({ name: c.name, value: c.value, heal: c.heal, use: c.use, type: 'consumable' });
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
  state.raidTime = isRange ? 999999 : RAID_SECONDS; // 연습장은 시간 제한 없음 (#209)
  state.phase = 'raid';
  state.paused = false;
  pendingExtractFee = 0;
  state.airdropDone = false;
  state.airdropAt = RAID_SECONDS - (90 + Math.random() * 150); // 1.5~4분 경과 시 보급 투하 (#197)

  if (!isRange) { // 연습장은 적·루팅·물리통 없음 (#209)
    spawnLoot();
    spawnPhysProps(); // 동적 물리 배럴/폭발통 (#119)
    spawnEnemies(spawn);
  } else { state.airdropDone = true; }
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

  if (state.range) { // 연습장 퇴장: 통계·인벤토리 반영 없이 곧장 메뉴로 (#209)
    state.range = false;
    state.phase = 'menu';
    state.paused = false;
    dom.death.style.display = 'none';
    dom.extract.style.display = 'none';
    dom.menu.style.display = 'flex';
    updateMenuStash();
    return;
  }

  const stash = loadStash();
  stash.raids = (stash.raids || 0) + 1;
  stash.kills = (stash.kills || 0) + state.kills;

  if (result === 'extract') {
    const value = inventoryValue();
    stash.extracts = (stash.extracts || 0) + 1;
    // 반입 분류 (#185/#186/#187): 부품 → stash.parts, 소모품 → stash.consumables, 그 외 가치품 → stash.valuables
    const bankedParts = inventory.filter((i) => i.type === 'part').map((i) => ({ name: i.name, value: i.value, slot: i.slot }));
    const bankedCons = inventory.filter((i) => i.type === 'consumable').map((i) => ({ name: i.name, value: i.value, heal: i.heal, use: i.use }));
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
  onHold('tb-med', () => { if (inRaid()) useMed(); }); // 부상 처치 (#307)
  onHold('tb-reset', () => { if (inRaid() && state.range) resetRange(); }); // 연습장 (#295)
  onHold('tb-drill', () => { if (inRaid() && state.range) startDrill(); });
  onHold('tb-mode', () => { if (inRaid() && state.range) cycleDrillMode(); }); // (#298)
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
      card.onclick = () => { mapSelectEl.style.display = 'none'; beginRaid(key); };
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
  if (e.code === 'KeyT' && state.range) resetRange(); // 연습장 표적·탄흔 리셋 (#292)
  if (e.code === 'KeyY' && state.range) startDrill(); // 연습장 드릴 시작 (#295)
  if (e.code === 'KeyU' && state.range) cycleDrillMode(); // 드릴 모드 전환 (#298)
  if (e.code === 'KeyQ') useHeal();
  if (e.code === 'KeyX') useMed(); // 부상 처치 (#307)
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
  // 반동 궤적 (#295, 연습장): 최근 사격 시점의 반동 오프셋(yaw/pitch)을 화면 픽셀로 — 위로 올라가는 점열 = 반동 패턴. 3초 뒤 사라짐
  if (dom.recoilTrace) {
    const now = performance.now(); while (recoilTrace.length && now - recoilTrace[0].t > 3000) recoilTrace.shift();
    const showT = state.range && recoilTrace.length > 0 && !scopeShown;
    dom.recoilTrace.style.display = showT ? 'block' : 'none';
    // 버스트 종료(0.6s 무발사) 시 5발 이상이면 패턴 스냅샷 저장 (#298)
    if (state.range && !recoilPat.saved && recoilPat.burst.length >= 5 && now - recoilPat.lastT > 600) {
      const b = recoilPat.burst, [y0, p0] = b[0];
      recoilPat.store[statKey()] = b.slice(0, 30).map(([y, pp]) => [+(y - y0).toFixed(4), +(pp - p0).toFixed(4)]); recoilPat.saved = true;
      try { localStorage.setItem('exshoot_recoil_pat', JSON.stringify(recoilPat.store)); } catch {}
      updateRangeHud();
    }
    if (showT) {
      const c = dom.recoilTrace, g = c.getContext('2d'), W = c.width, H = c.height, ppr = (innerHeight / 2) / Math.tan(camera.fov * Math.PI / 360);
      g.clearRect(0, 0, W, H); g.lineWidth = 1;
      const pat = recoilPat.store[statKey()]; // 저장 패턴(회색): 현재 궤적 첫 점에 앵커해 비교
      if (pat) {
        const ax = W / 2 - recoilTrace[0].yaw * ppr, ay = H / 2 - recoilTrace[0].pitch * ppr; let qx = null, qy = null;
        for (const [dy, dp] of pat) {
          const x = Math.max(3, Math.min(W - 3, ax - dy * ppr)), y = Math.max(3, Math.min(H - 3, ay - dp * ppr));
          if (qx !== null) { g.strokeStyle = 'rgba(200,210,200,0.35)'; g.beginPath(); g.moveTo(qx, qy); g.lineTo(x, y); g.stroke(); }
          g.fillStyle = 'rgba(200,210,200,0.55)'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); qx = x; qy = y;
        }
      }
      let px = null, py = null;
      for (const r of recoilTrace) {
        const a = Math.max(0.15, 1 - (now - r.t) / 3000), x = Math.max(3, Math.min(W - 3, W / 2 - r.yaw * ppr)), y = Math.max(3, Math.min(H - 3, H / 2 - r.pitch * ppr));
        if (px !== null) { g.strokeStyle = `rgba(255,214,90,${a * 0.5})`; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); }
        g.fillStyle = `rgba(255,214,90,${a})`; g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
        px = x; py = y;
      }
    }
  }
  // 거리계 + 사격선 이탈 경고 (#298, 연습장): 4프레임마다 조준 레이 거리
  if (state.range && dom.rhDist && (rfTick = (rfTick + 1) % 4) === 0) {
    const warn = player.pos.z < RANGE_FIRE_Z - 2.0; // 사격선 턱(RANGE_FIRE_Z−1.7)을 넘어서면 경고
    let txt = '—';
    if (!warn) { camera.getWorldDirection(_rfDir); _aimRay.set(camera.position, _rfDir); _aimRay.far = 400; const h = _aimRay.intersectObjects(obstacleMeshes, false); if (h.length) { const d = h[0].point.distanceTo(player.pos), v = GUN.velocity || 700, drop = 0.5 * BALLISTICS.g * (d / v) ** 2; txt = `${d.toFixed(1)} m · 낙차 ${drop < 0.005 ? '0' : '−' + Math.round(drop * 100)} cm`; } } // 사수 기준 거리 + 현재 무기 낙차 (#301)
    dom.rhDist.textContent = warn ? '⚠ 사격선 이탈' : txt; dom.rhDist.classList.toggle('rh-warn', warn);
  }
  // 저체력 치료 힌트 (#110): useHeal 과 같은 우선순위(붕대 먼저)로 다음 사용 아이템 안내
  {
    const bleeding = !!(player.bleeds && player.bleeds.length), blacked = limbBlacked();
    const low = (player.hp < 45 || bleeding || blacked) && player.hp > 0 && state.phase === 'raid';
    const item = !low ? null : (blacked && !bleeding) ? (inventory.find((i) => i.heal > 30) || inventory.find((i) => i.heal)) : (inventory.find((i) => i.heal && i.heal <= 30) || inventory.find((i) => i.heal));
    const txt = item ? `Q — ${item.name}${bleeding ? ' (지혈)' : blacked ? ' (부상 처치)' : ` 사용 (+${item.heal} HP)`}` : '';
    if (dom.healHint.textContent !== txt) dom.healHint.textContent = txt;
    if (dom.painHint) { const limb = player.parts && ['legs', 'arms'].find((k) => player.parts[k] <= 0); const pt = painFree() ? `💊 진통제 ${Math.ceil(player.painkiller)}s` : (limb && state.phase === 'raid') ? (inventory.some((i) => i.use === 'splint') ? 'X — 부목 (부상 고정)' : inventory.some((i) => i.use === 'painkiller') ? 'X — 진통제 (임시 억제)' : '') : ''; if (dom.painHint.textContent !== pt) dom.painHint.textContent = pt; dom.painHint.style.display = pt ? 'block' : 'none'; } // (#307)
    dom.healHint.style.display = item ? 'block' : 'none';
    const tb = document.getElementById('tb-heal');
    if (tb) tb.classList.toggle('urgent', !!item);
  }
  dom.hpFill.style.width = `${player.hp}%`;
  dom.stamFill.style.width = `${player.stamina}%`;
  if (dom.weight && state.phase === 'raid') { const cw = carryWeight(), t = weightTier(cw); const txt = `⚖ ${cw.toFixed(1)} / ${CARRY.over} kg`; if (dom.weight.textContent !== txt) dom.weight.textContent = txt; dom.weight.className = t === 2 ? 'w-max' : t === 1 ? 'w-over' : ''; } // (#310)
  if (dom.bodyHud && player.parts && (bodyDirty || (bodyTick = (bodyTick + 1) % 4) === 0)) { bodyDirty = false; drawBodyHud(); } // 신체 HUD (#304)
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
  dom.raidTimer.textContent = state.range ? '🎯 사격 연습장' : fmtTime(state.raidTime); // 연습장은 타이머 대신 라벨 (#209)
  dom.raidTimer.style.color = (!state.range && state.raidTime < 60) ? '#d94f3d' : '#e8eee6';
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
    updateProjectiles(dt); // 발사체 비행·명중 (#301)
    for (const e of enemies) updateEnemy(e, dt);
    updatePhysics(dt); // Rapier 스텝 + 소품/래그돌 동기화 (#119)
    if (state.range) updateRangeTargets(dt); // 스틸 공 흔들림 (#292)
    updateExtraction(dt);
    updateEvents(dt);
    updateAcoustics(dt);
    updateHUD();
  }
  updateEffects(dt);
  if (townFx && builtMapKey === 'town') updateTownFx(dt); // 낙화·수면 (#319)
  // 하늘: 카메라 추종(구면 클리핑 방지) + 구름 드리프트
  skyMesh.position.copy(camera.position);
  skyUniforms.uTime.value = now / 1000;
  updateSunShadow(); // 그림자 범위 추종 (#319)
  if (gradePass) gradePass.uniforms.uTime.value = now / 1000;
  if (renderHold) return;                 // 셰이더 선컴파일 중 (#325)
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
  get overlaps() { return mapOverlaps; },   // 배치 겹침 진단 결과 (#215)
  get placements() { return placements; },
  _checkOverlaps: () => checkMapOverlaps(),
  terrainH,
  equipWeapon,
  lootInteractable,
  WEAPONS,
  kill(i) { const e = enemies[i]; if (e && !e.dead) killEnemy(e); },
  // 적 부위 (#313) QA: 부위 판정 / 부위 피해 / 명중률 / 적 1기 수동 스텝
  ENEMY_PARTS, _enemyPart(i, x, y, z) { const e = enemies[i]; return enemyHitPart(e, 'body', new THREE.Vector3(x, y, z)); },
  _hitEnemy(i, part, dmg) { const e = enemies[i]; if (!e || e.dead) return null; const b = damageEnemyPart(e, part, dmg); if (e.hp <= 0) killEnemy(e); else e.state = 'combat'; return b; },
  _enemyAcc(i, dist) { return enemyAccuracy(enemies[i], dist); }, _stepEnemy(i, dt) { updateEnemy(enemies[i], dt); },
  // 적 발사체 (#316) QA: 적 i 가 현재 거리로 1발 → 발사체 객체(rolled/result), 플레이어 히트박스 판정
  _enemyShoot(i) { const e = enemies[i]; const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z); return enemyShoot(e, d); },
  get lastEnemyShot() { return lastEnemyShot; }, playerHit, _playerPart(x, y, z) { syncPlayerHit(); return playerHitPart('body', new THREE.Vector3(x, y, z)); },
  _rayHit(ox, oy, oz, dx, dy, dz, far = 200) { _shootRay.set(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dx, dy, dz).normalize()); _shootRay.far = far; const h = _shootRay.intersectObjects([...obstacleMeshes, ...propMeshes], false)[0]; return h ? { name: h.object.name, type: h.object.type, ud: Object.keys(h.object.userData || {}), d: +h.distance.toFixed(2), p: h.point.toArray().map(v => +v.toFixed(2)) } : null; },
  _los(a, b) { return hasLineOfSight(new THREE.Vector3(...a), new THREE.Vector3(...b)); }, _openPoint() { return randomOpenPoint(); },
  hurt(n, hs = false, part = null) { damagePlayer(n, hs, part); }, get parts() { return player.parts; }, get bleeds() { return player.bleeds; }, get inventory() { return inventory; }, carryWeight, CARRY, _stepPlayer(dt) { updatePlayer(dt); }, _hud() { updateHUD(); }, _useMed() { useMed(); }, // (#304/#307) QA
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
  _startRaid(k) { startRaid(k); }, _beginRaid(k) { return beginRaid(k); }, _loadBaked(k) { return loadBaked(k); }, get bakeInfo() { return { hash: SRC_HASH, loaded: Object.keys(BAKED), last: lastBuildInfo }; },
  _fire() { if (state.phase !== 'raid') return; if (gun.mag <= 0) gun.mag = GUN.magSize; fireShot(); }, // QA: 트리거 게이트(포인터락·raiseT 등) 우회 1발, 탄창 자동 보충 (#292)
  get rangeTargets() { return rangeTargets; }, get drill() { return drill; }, _startDrill() { startDrill(); }, _rangeTick(dt) { updateRangeTargets(dt); }, _cycleDrillMode() { cycleDrillMode(); }, get recoilPat() { return recoilPat; }, // QA (#295/#298)
  _flushProjectiles() { for (let k = 0; k < 200 && projectiles.length; k++) updateProjectiles(0.02); return projectiles.length; }, _stepProjectiles(dt) { updateProjectiles(dt); }, get projectiles() { return projectiles; }, // QA (#301): 발사체를 즉시 비행 완료 / 수동 스텝 — 자동화 탭은 rAF 가 느려 드릴/이동 표적 시간을 수동 진행
  // 성능 QA (#280): _perfBegin() … (프레임 진행) … _perfEnd() → 그 사이 누적 draw call/삼각형의 프레임당 평균. renderer.info 는 프레임마다
  // 리셋되므로 autoReset 을 잠시 끈다. 두 호출로 나눈 이유: 자동화 탭에서는 JS 실행 중 rAF 가 멈춰 한 호출 안의 await 로는 프레임이 안 흐른다.
  _perfBegin() { const info = renderer.info; info.autoReset = false; info.reset(); this._pf0 = info.render.frame; return this._pf0; },
  _perfEnd() {
    const info = renderer.info, frames = Math.max(1, info.render.frame - (this._pf0 || 0));
    const out = { frames, calls: Math.round(info.render.calls / frames), triangles: Math.round(info.render.triangles / frames) };
    info.autoReset = true; return out;
  },
  get _map() { return { current: currentMapKey, built: builtMapKey, maps: Object.keys(MAPS) }; },
  // 렌더 QA (#319): 룩 전환·톤매핑 비교·낙화 상태
  applyLook(k) { currentLook = null; applyLook(k); }, LOOKS, _tone(name, exp) { renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[name] ?? renderer.toneMapping; if (exp) renderer.toneMappingExposure = exp; }, get townFx() { return townFx; }, get sakura() { return SAKURA_TREES; }, _townTick(dt) { updateTownFx(dt); }, _shadow() { updateSunShadow(true); return { t: sun.target.position.toArray(), half: SHADOW_HALF }; },
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
const _assetsP = loadAssets();
if (new URLSearchParams(location.search).has('bake')) _assetsP.then(() => bakeAllMaps()).catch((e) => fetch('/__bake/done.json', { method: 'POST', body: JSON.stringify({ error: String(e && e.message) }) }));
_assetsP.catch((err) => {
  console.error('asset load failed:', err);
  dom.btnStart.textContent = '에셋 로딩 실패 — 새로고침 해 주세요';
  const label = document.getElementById('load-label');
  const fill = document.getElementById('load-fill');
  if (label) label.textContent = '로딩 실패 (네트워크 확인 후 새로고침)';
  if (fill) fill.style.background = '#b83232';
});
loadAudio().catch((err) => console.warn('audio load failed (절차 생성 폴백 사용):', err));
loop();
