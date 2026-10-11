// 스모크 테스트 페이지 코드 (#349) — index.html?smoke=<맵 인덱스> 일 때만 로드된다 (index.html 의 동적 import).
// scripts/smoke_test.py 가 맵마다 이 페이지를 새로 열어 결과를 받는다.
// 요점: 개발용 진입점(__ex._startRaid)이 아니라 **사용자가 밟는 경로** — #btn-start 클릭 → 맵 카드 클릭 → beginRaid — 로 레이드를 시작한다.
// (#346: 개발용 진입점만 쓰던 QA 가 로딩 오버레이가 안 사라지는 버그를 두 릴리스 동안 못 잡았다.)
const qs = new URLSearchParams(location.search);
const idx = parseInt(qs.get('smoke'), 10) || 0, ONLY = qs.has('only'); // only: 이 맵 하나만 (스크립트 --only)
const errors = [];
addEventListener('error', (e) => errors.push(`error: ${e.message || (e.target && e.target.src) || '?'} @${String(e.filename || '').split('/').pop()}:${e.lineno || 0}`), true);
addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${e.reason && (e.reason.message || e.reason)}`));
const ce = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ').slice(0, 220)); ce.apply(console, a); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step = 25) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return !!fn();
}
const post = (path, obj) => fetch(path, { method: 'POST', body: JSON.stringify(obj) }).catch(() => {});

// 화면 대부분을 덮는 불투명 막(로딩·메뉴 오버레이 등)이 남아 있나 — body 직계 자식과 #hud 를 훑는다
function blockers() {
  const out = [];
  for (const el of document.body.children) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.position !== 'fixed' && cs.position !== 'absolute')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) continue;
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0;
    if (alpha > 0.2 || (cs.backdropFilter && cs.backdropFilter !== 'none')) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.textContent ? ' "' + el.textContent.trim().slice(0, 20) + '"' : ''} bg=${cs.backgroundColor}`);
  }
  return out;
}

async function run() {
  const res = { idx, key: null, name: null, total: null, ok: false, fail: [], warn: [], info: {} };
  const bad = (m) => { res.fail.push(m); };
  const start = document.getElementById('btn-start');
  if (!(await waitFor(() => !!window.__ex && start && !start.disabled, 120000, 100))) { bad('에셋 로딩이 끝나지 않음(시작 버튼 비활성)'); return res; }
  const x = window.__ex;
  for (const h of ['loadingVisible', 'renderHold', '_hold', 'bakeInfo', 'projectiles']) if (!(h in x)) { bad(`QA 훅 __ex.${h} 없음 — 훅이 빠지면 검사가 조용히 통과하므로 실패로 본다`); return res; }
  start.click();
  const ms = document.getElementById('mapselect');
  const cards = ms ? [...ms.querySelectorAll('button')].slice(0, -1) : []; // 마지막은 '취소'
  res.total = cards.length;
  if (!cards.length) { bad('맵 선택 카드가 없음'); return res; }
  if (idx >= cards.length) { res.skip = true; return res; }
  res.name = cards[idx].querySelector('div') && cards[idx].querySelector('div').textContent;
  const snap = () => ({ t: x.state.raidTime, px: x.player.pos.x, pz: x.player.pos.z, hp: x.player.hp, proj: x.projectiles.length });
  let sawOverlay = false, sawHold = false, holdFirst = null, holdLast = null, tHold0 = 0, tHold1 = 0;
  const iv = setInterval(() => {
    if (x.loadingVisible) sawOverlay = true;
    if (x.renderHold) { if (!sawHold) { sawHold = true; holdFirst = snap(); tHold0 = performance.now(); } holdLast = snap(); tHold1 = performance.now(); }
  }, 15);
  const hp0 = x.player.hp, t0 = performance.now();
  cards[idx].click(); // 실제 사용자 경로: 맵 카드 → beginRaid
  // 레이드가 시작됐고(렌더 보류도 끝났는데) 오버레이가 4초 넘게 남아 있으면 #346 유형 — 120초를 기다리지 않고 바로 실패
  let stuckSince = 0, stuck = false;
  const reached = await waitFor(() => {
    const live = x.state.phase === 'raid' && !x.renderHold;
    if (live && x.loadingVisible) { stuckSince = stuckSince || performance.now(); if (performance.now() - stuckSince > 4000) { stuck = true; return true; } } else stuckSince = 0;
    return live && !x.loadingVisible;
  }, 120000);
  clearInterval(iv);
  if (stuck) { bad('레이드가 시작됐는데 로딩 오버레이가 4초 넘게 남아 있음 (#346 유형: 인라인 display 가 hidden 속성을 이김)'); res.key = x.bakeInfo.last && x.bakeInfo.last.key; const bl0 = blockers(); if (bl0.length) bad('화면을 덮는 불투명 막: ' + bl0.join(' | ')); return res; }
  res.info.loadMs = Math.round(performance.now() - t0);
  res.key = x.bakeInfo.last && x.bakeInfo.last.key;
  if (!reached) { bad(`레이드에 도달하지 못함(phase=${x.state.phase}, overlay=${x.loadingVisible}, hold=${x.renderHold})`); return res; }
  if (!sawOverlay) bad('로딩 오버레이가 한 번도 보이지 않음(경로가 beginRaid 가 아님?)');
  if (sawHold) {
    res.info.holdMs = Math.round(tHold1 - tHold0);
    if (holdFirst.t !== holdLast.t || holdFirst.px !== holdLast.px || holdFirst.pz !== holdLast.pz || holdFirst.proj !== holdLast.proj) bad(`셰이더 준비 중 시뮬이 진행됨(raidTime ${holdFirst.t}→${holdLast.t})`);
  } else res.warn.push('셰이더 선컴파일 구간(renderHold)을 관측하지 못함');
  if (x.player.hp !== hp0) bad(`로딩 중 체력이 변함(${hp0}→${x.player.hp}) — 준비 화면 뒤에서 피격`);

  // 오버레이가 실제로 사라졌나(계산된 display) + 화면을 덮는 막이 없나 — #346 의 직접 회귀 검사
  if (x.loadingVisible) bad('로딩 오버레이가 계산된 display 로 아직 보임');
  const bl = blockers(); if (bl.length) bad('화면을 덮는 불투명 막: ' + bl.join(' | '));

  // 이후 3 초: 프레임이 돌고 시뮬이 진행되나
  // 헤드리스 SwiftShader 는 ~1 fps 라 시간이 아니라 **프레임 수**로 기다린다(시간 기준은 불안정하고, 프레임이 안 돌면 시뮬 검사가 공허해진다)
  let frames = 0, run = true; const tick = () => { frames++; if (run) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const r0 = x.state.raidTime; const framesOk = await waitFor(() => frames >= 3, 40000, 50); run = false;
  res.info.frames = frames; res.info.raidDt = +(r0 - x.state.raidTime).toFixed(2);
  if (!framesOk) bad(`40초 동안 프레임 ${frames}개 — 렌더 루프가 멈춘 듯`);
  if (!(x.state.raidTime < r0)) bad('레이드 타이머가 줄지 않음(시뮬이 안 도는 듯)');
  if (x.state.phase !== 'raid') bad(`3초 뒤 phase=${x.state.phase}`);
  const bl2 = blockers(); if (bl2.length) bad('3초 뒤 화면을 덮는 막: ' + bl2.join(' | '));
  res.info.enemies = x.enemies.length; res.info.hp = x.player.hp;

  // 셰이더 준비(renderHold) 중 시뮬 정지 게이트 — 실제 컴파일은 메인 스레드를 막아 중간 관측이 안 되므로 훅으로 보류를 강제한다.
  // 루프(rAF)는 도는데(렌더만 건너뜀) 타이머·이동·발사체는 멈춰 있어야 하고, 풀리면 다시 진행해야 한다.
  { let fr = 0, go = true; const tk = () => { fr++; if (go) requestAnimationFrame(tk); }; requestAnimationFrame(tk);
    x._hold(true); const a = snap();
    const f0 = fr; const heldOk = await waitFor(() => fr - f0 >= 4, 40000, 50); const b = snap();   // 보류 중 루프가 4프레임 도는 동안
    res.info.holdFrames = fr - f0;
    if (!heldOk) bad(`렌더 보류 중 프레임이 ${fr - f0}개뿐 — 시뮬 정지 검사가 공허함`);
    if (a.t !== b.t || a.px !== b.px || a.pz !== b.pz || a.proj !== b.proj) bad(`렌더 보류 중 시뮬이 진행됨(raidTime ${a.t}→${b.t})`);
    x._hold(false); const c = x.state.raidTime, f1 = fr;
    const resumed = await waitFor(() => fr - f1 >= 3 && x.state.raidTime < c, 40000, 50); go = false;   // 풀린 뒤 3프레임 안에 시뮬 재개
    if (!resumed) bad('보류가 풀린 뒤 시뮬이 재개되지 않음'); }

  const bk = x.bakeInfo.last;
  res.info.baked = !!(bk && bk.baked); res.info.buildMs = bk && bk.ms;
  if (!res.info.baked) res.warn.push('구운 형상을 쓰지 않음(절차 생성 폴백) — main.js 가 바뀌었으면 scripts/bake_maps.py 필요');
  const rbad = performance.getEntriesByType('resource').filter((r) => r.responseStatus >= 400 && !/favicon\.ico/.test(r.name)).map((r) => `${r.responseStatus} ${r.name.split('/').slice(-2).join('/')}`);
  if (rbad.length) errors.push(...rbad.map((s) => 'resource: ' + s));
  return res;
}

run().catch((e) => ({ idx, fail: ['스모크 코드 예외: ' + (e && e.message)], warn: [], info: {} })).then(async (res) => {
  if (errors.length) res.fail = [...(res.fail || []), ...errors.slice(0, 8).map((e) => '오류: ' + e)];
  res.ok = !res.fail.length;
  await post('/__smoke/result', res);
  if (res.skip || res.total == null || ONLY || idx + 1 >= res.total) await post('/__smoke/done', { total: ONLY ? 1 : res.total });
  else location.replace(`index.html?smoke=${idx + 1}&t=${Date.now()}`); // 다음 맵: 깨끗한 페이지로
});
