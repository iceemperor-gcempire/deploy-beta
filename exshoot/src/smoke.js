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
  for (const h of ['loadingVisible', 'renderHold', '_hold', 'bakeInfo', 'projectiles', '_los', '_openPoint', 'raySplit', 'grenades', 'grenadeStats', '_giveGrenade', '_throwGrenade', '_stepGrenades', '_terrainH']) if (!(h in x)) { bad(`QA 훅 __ex.${h} 없음 — 훅이 빠지면 검사가 조용히 통과하므로 실패로 본다`); return res; }
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

  // 레이캐스트 비용 가드 (#355): 병합된 큰 메시는 three 의 Mesh.raycast 가 삼각형을 전부 검사해 벚꽃 동네에서 레이 하나가 27 ms 였고 총알 1발이 프레임을 33 ms 로 만들었다.
  // 적 시야·총알·카메라 레이가 모두 이 비용을 낸다 — 무작위 10~45 m 쌍의 시야 레이 평균·p90 으로 회귀를 막는다(이 값은 GPU 가 아니라 JS 속도라 헤드리스에서도 유효).
  { const ts = []; for (let i = 0; i < 40; i++) { const a = x._openPoint(); let b = null; for (let k = 0; k < 30; k++) { const q = x._openPoint(); const d = Math.hypot(q.x - a.x, q.z - a.z); if (d >= 10 && d <= 45) { b = q; break; } } if (!b) continue; const t = performance.now(); x._los([a.x, 1.6, a.z], [b.x, 1.6, b.z]); ts.push(performance.now() - t); }
    if (ts.length >= 10) { ts.sort((p, q) => p - q); const mean = ts.reduce((p, q) => p + q, 0) / ts.length, p90 = ts[Math.floor(ts.length * 0.9)];
      res.info.losMs = +mean.toFixed(2); res.info.losP90 = +p90.toFixed(2); res.info.rayProxies = x.raySplit ? x.raySplit.proxies : 0;
      if (mean > 2.5 || p90 > 8) bad(`시야(LOS) 레이 평균 ${mean.toFixed(1)} ms · p90 ${p90.toFixed(1)} ms — 병합 메시 레이캐스트 비용 회귀 (#355: 가속 전 벚꽃 동네 27 ms)`); }
    else res.warn.push('시야 레이 비용 표본이 부족함(열린 지점 쌍을 못 찾음)'); }

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

  // 수류탄 경로 (#359): 인벤토리 → 투척 → 비행·바운스 → 퓨즈 폭발 → 정리가 오류 없이 한 바퀴 돌아야 한다. 정확도·차폐·회피는 이 검사의 범위 밖(전투 QA, docs/grenade.md).
  // 호는 직선 시야보다 높아(25 m 에서 정점 약 4 m) 수관·처마에 걸려 되튀면 던진 사람이 맞는다(벚꽃 동네에서 100→69) — 직선 시야만 보고 던지면 게이트가 무작위로 실패한다.
  // 그래서 던지는 자리·목표를 모두 열린 점에서 고르고 게임과 같은 식으로 호를 샘플링해 열린 쌍만 쓴다. 이 시점엔 다른 검사가 끝났으므로 플레이어를 그 자리로 옮겨도 된다.
  // 시뮬은 훅으로 직접 스텝한다 — 헤드리스 ~1 fps 라 실시간을 기다릴 수 없다. 쌍을 못 찾으면 건너뛰되 info 에 남긴다(경고로 올리면 --strict 가 막는다).
  { x._hold(true); const G = x.GRENADE, pp = x.player.pos, gyOf = (a, b) => x._terrainH(a, b);
    const arcClear = (px, pz, T) => { // 게임과 같은 식(손 위치·비행 시간·속도). 마지막 10%(착지 직전)는 지형 샘플링이 섞이므로 뺀다
      const e = [px, gyOf(px, pz) + 1.62, pz]; let hx = T.x - e[0], hz = T.z - e[2]; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const S = [e[0] + hx * 0.4, e[1] - 0.25, e[2] + hz * 0.4], ty = gyOf(T.x, T.z), dx = T.x - S[0], dy = ty - S[1], dz = T.z - S[2];
      const t = Math.min(G.maxT, Math.max(G.minT, Math.hypot(dx, dz) / G.speed)), v = [dx / t, (dy + 0.5 * 9.8 * t * t) / t, dz / t];
      const at = (u) => [S[0] + v[0] * u, S[1] + v[1] * u - 0.5 * 9.8 * u * u, S[2] + v[2] * u];
      if (!x._los(e, [T.x, ty + 1.0, T.z])) return false;
      let prev = S; for (let k = 1; k <= 12; k++) { const c = at(t * 0.9 * k / 12); if (!x._los(prev, c)) return false; prev = c; } return true; };
    let from = null, T = null;
    for (let k = 0; k < 400 && !T; k++) { const a = x._openPoint(), q = x._openPoint(), d = Math.hypot(q.x - a.x, q.z - a.z); if (d >= 12 && d <= 25 && arcClear(a.x, a.z, q)) { from = a; T = q; } }
    if (!T) res.info.gren = 'skip(호가 열린 12~25 m 쌍을 못 찾음)';
    else {
      pp.set(from.x, gyOf(from.x, from.z), from.z);
      const det0 = x.grenadeStats.detonated, left0 = x.grenadeCount(); x._giveGrenade(1);
      if (x.grenadeCount() !== left0 + 1) bad('수류탄 검사: 수류탄을 인벤토리에 못 넣음');
      else if (!x._throwGrenade(T.x, gyOf(T.x, T.z), T.z)) bad('수류탄 검사: 투척 실패(레이드 중인데 던지지 못함)');
      else {
        if (x.grenades.length !== 1) bad(`수류탄 검사: 던진 뒤 비행 중 ${x.grenades.length}개`);
        for (let i = 0; i < 400 && x.grenades.length; i++) x._stepGrenades(1 / 60);
        if (x.grenades.length) bad('수류탄 검사: 퓨즈 3.4 s 가 지나도 안 터짐');
        else if (x.grenadeStats.detonated !== det0 + 1) bad(`수류탄 검사: 폭발 횟수 ${det0}→${x.grenadeStats.detonated}`);
        if (x.grenadeCount() !== left0) bad(`수류탄 검사: 던진 뒤 남은 수 ${x.grenadeCount()}(${left0} 이어야 함)`);
        res.info.gren = x.grenadeStats.detonated - det0;
      }
    }
    x._hold(false); }

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
