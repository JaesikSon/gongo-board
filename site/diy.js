/* 사업성 DIY — STEP1 토지 분석 → STEP2 설계개요 → STEP3 분양가·공사비 → 사업성 엑셀 */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const PY = 0.3025;
const f0 = v => v == null || !isFinite(v) ? '-' : Math.round(v).toLocaleString();
const f2 = v => v == null || !isFinite(v) ? '-' : (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const 억 = v => v == null || !isFinite(v) ? '-' : (v / 1e5).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '억';
const nv = v => { if (v === '' || v == null) return null; const x = parseFloat(String(v).replace(/,/g, '')); return isFinite(x) ? x : null; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LIB = {
  xlsx: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  ocr: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  ocrWorker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  ocrCore: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
};
const loaded = {};
const loadLib = k => loaded[k] || (loaded[k] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = LIB[k]; s.onload = ok; s.onerror = () => no(new Error('라이브러리를 불러오지 못했습니다')); document.head.appendChild(s); }));

// ── 상태 ──────────────────────────────────────────────────────────────
const sid = (() => { try { let v = localStorage.getItem('diy_sid'); if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem('diy_sid', v); } return v; } catch (e) { return Math.random().toString(36).slice(2, 10); } })();
let CFG = { collectUrl: '', vworldKey: '' };
const ST = {
  step: 1, consent: false, title: '',
  parcels: [], s1: { donate: 0, far: null, bcr: null, height: null, sido: '' },
  s2: { mode: 'gen', use: '공동주택', commPct: 0, floors: 25, perFloor: 4, hh: null, opEx: 84, stall: 35, partial: false, checked: false },
  design: null, files: [], land: null,
  s3: { land: null, date: '', permit: 12, sale: null, rate: 100, priceMode: 'py', price: null, prices: {}, mkt: null, mktRatio: 85, comm: null, cost: null, cover: 50, pfRate: 4.6, blRate: 6.0, blRate2: 8.0, build: null, landType: '민간택지', trust: '관리형토지신탁', midInt: '무이자', demol: null, sched: '0:10, 3:90', disc: 0 },
  notice: null,
  result: null,
};

// ── 데이터 수집 (운영자 Google 시트로만 전송) ──────────────────────────
function snapshot() {
  return { title: ST.title, parcels: ST.parcels.map(p => ({ q: p.q, pnu: p.pnu, area: p.area, jimok: p.jimok, zone: p.zone, price: p.price, uses: p.uses })),
    s1: ST.s1, s2: ST.s2, design: ST.design, s3: ST.s3, result: ST.result && { 매출: ST.result.매출, 사업비: ST.result.사업비, 이익: ST.result.이익, 이익률: ST.result.이익률, 판정: ST.result.판정, 자금부족: ST.result.자금부족 },
    files: ST.files.map(f => ({ name: f.name, type: f.type, size: f.size })) };
}
function collect(event, extra) {
  if (!CFG.collectUrl || !ST.consent) return;
  const body = JSON.stringify({ sid, event, ts: new Date().toISOString(), page: location.href, ua: navigator.userAgent, data: snapshot(), ...(extra || {}) });
  try { fetch(CFG.collectUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }); } catch (e) { /* 무시 */ }
}
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

// ── 브이월드 조회 ─────────────────────────────────────────────────────
function jsonp(url, ms = 12000) {
  return new Promise((ok, no) => {
    const cb = 'vw' + Date.now() + Math.floor(Math.random() * 1e6), s = document.createElement('script');
    const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { done(); no(new Error('응답 없음')); }, ms);
    window[cb] = d => { done(); ok(d); }; s.onerror = () => { done(); no(new Error('조회 실패')); };
    s.src = url + '&callback=' + cb; document.head.appendChild(s);
  });
}
async function vw(url) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { /* CORS → JSONP */ } return jsonp(url); }
const vkey = () => CFG.vworldKey || (() => { try { return localStorage.getItem('diy_vworld') || ''; } catch (e) { return ''; } })();
const arr = x => !x ? [] : Array.isArray(x) ? x : [x];
async function lookupParcel(q) {
  const key = vkey(), dom = location.hostname;
  const s = await vw(`https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=1&page=1&type=address&category=parcel&format=json&errorformat=json&key=${key}&query=${encodeURIComponent(q)}`);
  const it = s && s.response && s.response.result && arr(s.response.result.items)[0];
  if (!it) throw new Error((s && s.response && s.response.error && s.response.error.text) || '지번을 찾지 못했습니다');
  return lookupPnu(it.id, (it.address && (it.address.parcel || it.address.road)) || q, q);
}
async function lookupPnu(pnu, addr, q) {
  const key = vkey(), dom = location.hostname;
  const c = await vw(`https://api.vworld.kr/ned/data/getLandCharacteristics?key=${key}&domain=${dom}&pnu=${pnu}&format=json&numOfRows=100&pageNo=1`);
  const rows = arr(c && c.landCharacteristicss && c.landCharacteristicss.field).sort((a, b) => String(b.stdrYear).localeCompare(String(a.stdrYear)));
  const r0 = rows[0] || {};
  let uses = [];
  try {
    const u = await vw(`https://api.vworld.kr/ned/data/getLandUseAttr?key=${key}&domain=${dom}&pnu=${pnu}&format=json&numOfRows=100&pageNo=1`);
    uses = arr(u && u.landUses && u.landUses.field).map(x => ({ name: x.prposAreaDstrcCodeNm, rel: x.cnflcAtNm })).filter(x => x.name);
  } catch (e) { /* 토지이용계획 실패 시 토지특성만 */ }
  const zone = (r0.prposArea1Nm && r0.prposArea1Nm !== '지정되지않음') ? r0.prposArea1Nm : (uses.find(x => /지역$/.test(x.name) && D().NATIONAL[x.name]) || {}).name || '';
  if (!r0.stdrYear && !uses.length) throw new Error('토지정보가 없습니다');
  return { q: q || addr, addr, pnu, area: nv(r0.lndpclAr), jimok: r0.lndcgrCodeNm || '', zone, price: nv(r0.pblntfPclnd), year: r0.stdrYear || '', uses, status: 'ok' };
}
const D = () => window.designEngine, E = () => window.fsEngine;

// ── STEP1 분석 ───────────────────────────────────────────────────────
const FLAGS = [
  [/지구단위계획/, '지구단위계획구역 — 결정 고시문에서 기준·허용·상한 용적률과 권장·불허용도 확인'],
  [/정비구역|재개발|재건축|정비예정|재정비촉진/, '정비(예정)구역 — 도시정비법 절차·공공기여 적용 여부'],
  [/고도지구|최고고도/, '고도지구 — 높이 제한'],
  [/문화재|국가유산|역사문화환경/, '역사문화환경 보존지역 — 보존영향 검토·높이 제한'],
  [/군사|비행안전|대공방어/, '군사·비행안전 규제 — 높이 협의 필요'],
  [/토지거래/, '토지거래허가구역 — 매매 시 허가'],
  [/과밀억제/, '과밀억제권역 — 과밀부담금 등'],
  [/개발제한/, '개발제한구역 — 개발 불가'],
];
function analyze() {
  const ps = ST.parcels.filter(p => nv(p.area) > 0);
  const total = ps.reduce((a, p) => a + nv(p.area), 0);
  const byZone = {}; ps.forEach(p => { if (p.zone) byZone[p.zone] = (byZone[p.zone] || 0) + nv(p.area); });
  const zones = Object.entries(byZone).sort((a, b) => b[1] - a[1]);
  const main = zones.length ? zones[0][0] : '';
  const addrAll = ps.map(p => p.addr || p.q).join(' ');
  const seoul = /서울/.test(addrAll) || /서울/.test(ST.s1.sido);
  const lim = z => { const N = D().NATIONAL[z]; if (!N) return null; const s = seoul && D().SEOUL.zones[z]; return s ? { bcr: s.bcr, far: s.far, src: '서울시 도시계획 조례' } : { bcr: N[0], far: N[1], src: '국토계획법 시행령 상한 (시·도 조례 확인)' }; };
  let far = 0, bcr = 0, src = '';
  zones.forEach(([z, a]) => { const l = lim(z); if (l) { far += l.far * a / total; bcr += l.bcr * a / total; src = l.src; } });
  const priceSum = ps.reduce((a, p) => a + (nv(p.price) || 0) * nv(p.area), 0);
  const flags = [];
  const useNames = ps.flatMap(p => (p.uses || []).map(u => u.name + (u.rel ? `(${u.rel})` : '')));
  FLAGS.forEach(([re, msg]) => { if (useNames.some(n => re.test(n))) flags.push(msg); });
  if (ps.some(p => (p.uses || []).some(u => /도시계획시설|도로|공원|광장/.test(u.name) && /저촉/.test(u.rel || '')))) flags.push('도시계획시설(도로·공원 등) 저촉 — 저촉 면적은 사업 면적에서 제외 검토');
  if (/서울/.test(addrAll) && /(강남구|서초구|송파구|용산구)/.test(addrAll)) flags.push('민간택지 분양가상한제 적용지역 — 공동주택은 상한제(건축허가 주상복합 30세대 이상 포함), 오피스텔은 미적용');
  if (/공업|녹지|관리|농림|자연환경/.test(main)) flags.push(`${main} — 공동주택 건축 불가 또는 제한, 용도 변경(지구단위계획) 필요 여부 확인`);
  if (/상업|준주거/.test(main)) flags.push(`${main} — 주거복합 시 비주거 의무비율·주거 용적률 제한(지구단위계획·조례) 확인`);
  if (zones.length > 1) flags.push('복수 용도지역 — 용적률·건폐율은 면적 가중평균으로 산정');
  return { total, zones, main, far, bcr, src, priceSum, flags, seoul };
}

// ── STEP2 설계개요 생성기 ─────────────────────────────────────────────
function generate() {
  const A1 = analyze(), s2 = ST.s2, gross = A1.total, donate = nv(ST.s1.donate) || 0;
  const far = nv(ST.s1.far) != null ? nv(ST.s1.far) : A1.far, bcr = nv(ST.s1.bcr) != null ? nv(ST.s1.bcr) : A1.bcr;
  if (!(gross > 0) || !A1.main) throw new Error('STEP1의 면적·용도지역을 먼저 입력하세요');
  const net = gross - donate, fH = s2.use === '오피스텔' ? 3.0 : 2.9, floors = nv(s2.floors) || 25;
  const hLim = nv(ST.s1.height) || floors * fH + 0.01;
  const above = net * far / 100, commA = above * (nv(s2.commPct) || 0) / 100, resA = above - commA;
  const aptNet = 0.75, opNet = 50;
  let units = [{ name: '84', ex: 84.9, share: 100 }], plate;
  if (s2.use === '공동주택') {
    const hh = nv(s2.hh), T = [59.9, 84.9, 114.9], avg = hh ? resA * aptNet / hh : 84.9;
    if (avg <= T[0]) units = [{ name: '59', ex: T[0], share: 100 }];
    else if (avg <= T[1]) { const s = (avg - T[0]) / (T[1] - T[0]); units = [{ name: '59', ex: T[0], share: (1 - s) * 100 }, { name: '84', ex: T[1], share: s * 100 }]; }
    else if (avg <= T[2]) { const s = (avg - T[1]) / (T[2] - T[1]); units = [{ name: '84', ex: T[1], share: (1 - s) * 100 }, { name: '114', ex: T[2], share: s * 100 }]; }
    else units = [{ name: '114', ex: T[2], share: 100 }];
    const avgEx = units.reduce((a, u) => a + u.ex * u.share, 0) / 100;
    plate = Math.round((nv(s2.perFloor) || 4) * avgEx / aptNet);
  } else plate = Math.round((nv(s2.perFloor) || 8) * (nv(s2.opEx) || 84) / (opNet / 100));
  const nDong = Math.max(1, Math.ceil(resA / (plate * floors)));
  const L = {
    gross, donate, frontage: '', northDist: '', zones: A1.zones.map(([zone, area]) => ({ zone, area })),
    region: A1.seoul ? 'builtin-seoul' : 'national', parkingRegion: D().parkingRegionOf(ST.parcels.map(p => p.addr || p.q).join(' '), ST.s1.sido),
    du: { on: true, bcr, baseFar: far, allowMax: '', incentives: [], coef: 1.3, upperMax: far, maxHeight: hLim, setback: '', banned: [], resRatioMax: '', resFarMax: '', walkW: '', walkL: '', openReq: '' },
    openProvided: 0, podium: commA > 0 ? { floors: 1, plate: commA, use: '근생', floorH: 5 } : { floors: 0, plate: 0, use: '근생', floorH: 5 },
    towers: Array.from({ length: nDong }, (_, i) => ({ name: `${101 + i}동`, use: s2.use === '오피스텔' ? '오피스텔' : '공동주택', plate, floors: '', floorH: fH })),
    units, aptNet: aptNet * 100, opEx: nv(s2.opEx) || 84, opNet, opInRes: true,
    rental: { ratio: '', planFar: '', legalFar: '', pubRatio: 50 },
    bsmt: { stallArea: nv(s2.stall) || 35, mep: 6, cov: 85, floorH: 3.8, extra: 0 }, gap: '', lightRatio: 0.5,
  };
  const r = D().computeL(L);
  if (r.empty) throw new Error('설계개요를 산출하지 못했습니다 — 면적·용도지역을 확인하세요');
  const bNeed = r.pk.req * L.bsmt.stallArea + r.farA * L.bsmt.mep / 100;
  const nB = bNeed > 0 ? Math.ceil(bNeed / r.bPer) : 0, bArea = s2.partial ? bNeed : nB * r.bPer;
  const comm = r.area.근생 || 0, res = r.above - comm, under = bArea;
  let types;
  if (s2.use === '공동주택') types = r.units.filter(u => u.count > 0).map(u => ({ name: u.name, use: '공동주택', ex: u.ex, count: u.count }));
  else types = [{ name: String(Math.round(nv(s2.opEx) || 84)), use: '오피스텔', ex: nv(s2.opEx) || 84, count: r.nOp }];
  const exSum = types.reduce((a, t) => a + t.ex * t.count, 0) || 1;
  types.forEach(t => { t.sup = Math.round(t.ex * res / exSum * 100) / 100; t.con = Math.round(t.sup * (res + under * res / r.above) / res * 100) / 100; });
  return {
    source: '설계개요 생성기', use: s2.use, 대지: net, 공부상면적: gross, 기부채납: donate, 건축면적: r.ba, 건폐율: r.ba / net * 100,
    지상: r.above, 지하: under, 연면적: r.above + under, 용적률: r.above / net * 100, 지하층: s2.partial ? Math.round(bNeed / r.bPer * 10) / 10 : nB,
    지상층: r.maxFl, 동수: r.towers.filter(t => t.n > 0).length, 주차: r.pk.req, 세대: types.reduce((a, t) => a + t.count, 0),
    comm: comm > 0 ? { ex: Math.round(comm * 0.85 * 100) / 100, sup: comm, con: Math.round((comm + under * comm / r.above) * 100) / 100 } : null,
    types, warn: r.warn.slice(0, 6), recognized: {},
  };
}

// ── 스캔 PDF·이미지 글자 인식 (OCR, 브라우저 안에서 처리) ─────────────────
let OCRW = null;
const ocrStat = t => { const el = $('#fstat'); if (el) el.textContent = t; };
async function ocrWorker() {
  if (OCRW) return OCRW;
  await loadLib('ocr');
  OCRW = (async () => {
    const w = await window.Tesseract.createWorker(['kor', 'eng'], 1, { langPath: new URL('data/ocr/', location.href).href, gzip: true, workerPath: LIB.ocrWorker, corePath: LIB.ocrCore,
      logger: m => { if (m.status === 'recognizing text') ocrStat(`글자 인식 중… ${Math.round(m.progress * 100)}%`); else if (/loading/.test(m.status)) ocrStat('글자 인식 엔진 준비 중… (처음 한 번, 약 5MB)'); } });
    await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    return w;
  })();
  return OCRW;
}
function binarize(cv) {   // 표 칸 배경색 제거 → 흑백
  const ctx = cv.getContext('2d'), im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 150 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(im, 0, 0); return cv;
}
async function ocrCanvas(cv, label) {
  const w = await ocrWorker(); ocrStat(`${label} 글자 인식 중…`);
  const { data } = await w.recognize(binarize(cv), {}, { blocks: true });
  const words = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words))).map(x => ({ s: x.text.trim(), x: x.bbox.x0, y: (x.bbox.y0 + x.bbox.y1) / 2, w: x.bbox.x1 - x.bbox.x0, h: x.bbox.y1 - x.bbox.y0 }));
  return window.diyParse.ocrFix(window.diyParse.wordsToMd(words));
}
async function ocrPdf(data, maxPages = 8) {
  const doc = await window.pdfjsLib.getDocument({ data }).promise, out = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const pg = await doc.getPage(p), vp0 = pg.getViewport({ scale: 1 }), sc = Math.min(300 / 72, 5000 / Math.max(vp0.width, vp0.height)), vp = pg.getViewport({ scale: sc });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(`\n## p.${p} (OCR)\n`, await ocrCanvas(cv, `${p}/${Math.min(doc.numPages, maxPages)}쪽`));
  }
  return out.join('\n');
}
async function ocrImage(file) {
  const bmp = await createImageBitmap(file), k = Math.min(1, 5000 / Math.max(bmp.width, bmp.height)) * (Math.max(bmp.width, bmp.height) < 2500 ? 2 : 1);
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return `\n## ${file.name} (OCR)\n` + await ocrCanvas(cv, '이미지');
}

// ── STEP2 파일 인식 ───────────────────────────────────────────────────
async function readFile(file) {
  const buf = await file.arrayBuffer(), rec = { name: file.name, type: file.type, size: file.size, md: '', kind: '' };
  if (/pdf$/i.test(file.name) || file.type === 'application/pdf') {
    await loadLib('pdf'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    const r = await window.diyParse.pdfToMd(window.pdfjsLib, new Uint8Array(buf.slice(0)));
    rec.md = r.md; rec.kind = r.chars < 40 ? 'scan' : 'pdf';
    if (rec.kind === 'scan') { try { rec.md = await ocrPdf(new Uint8Array(buf.slice(0))); rec.kind = 'ocr'; } catch (e) { rec.err = 'OCR 실패: ' + e.message; } }   // 스캔 PDF도 최대한 읽기
  } else if (/\.xlsx?$/i.test(file.name)) {
    await loadLib('xlsx'); const r = await window.diyParse.xlsxToMd(window.ExcelJS, buf.slice(0)); rec.md = r.md; rec.kind = 'xlsx';
  } else if (/^image\//.test(file.type)) {
    rec.kind = 'image'; rec.url = URL.createObjectURL(file);
    try { rec.md = await ocrImage(file); rec.kind = 'ocr-img'; } catch (e) { rec.err = 'OCR 실패: ' + e.message; }
  }
  else rec.kind = 'other';
  if (CFG.collectUrl && ST.consent) collect('upload', { file: { name: file.name, type: file.type, size: file.size, md: rec.md.slice(0, 200000), b64: file.size <= 20e6 ? b64(buf) : null } });
  return rec;
}
function fromParsed(p, gross) {
  const v = p.values, types = p.types.filter(t => t.count > 0);
  const use = types.some(t => t.use === '오피스텔') ? '오피스텔' : '공동주택';
  const 대지 = v.대지 || (gross ? gross - (v.기부채납 || 0) : null);
  const 지상 = v.지상 || v.용적면적 || (v.용적률 && 대지 ? 대지 * v.용적률 / 100 : null);
  const rec = {}; Object.keys(v).forEach(k => rec[k] = p.src[k]);
  return {
    source: '파일 인식', use, 대지, 공부상면적: v.공부상면적 || (대지 && v.기부채납 ? 대지 + v.기부채납 : 대지), 기부채납: v.기부채납 || 0,
    건축면적: v.건축면적, 건폐율: v.건폐율, 지상, 지하: v.지하 || (v.연면적 && 지상 ? v.연면적 - 지상 : null), 연면적: v.연면적 || (지상 && v.지하 ? 지상 + v.지하 : null),
    용적률: v.용적률 || (지상 && 대지 ? 지상 / 대지 * 100 : null), 지하층: v.지하층, 지상층: v.지상층, 동수: 1, 주차: v.주차, 세대: v.세대 || types.reduce((a, t) => a + t.count, 0),
    comm: p.comm ? { ex: p.comm.ex, sup: p.comm.sup, con: p.comm.con } : null,
    types: types.map(t => ({ name: t.name, use: t.use, ex: t.ex, sup: t.sup, con: t.con, count: t.count })),
    warn: [], recognized: rec,
  };
}

// ── 토지대금 납부일정: '0:10, 18:8, … 60:50' (개월차:비율%) ─────────────
function parseSched(t) {
  const out = String(t || '').split(/[,\n;]+/).map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(-?\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*%?$/); return m ? [+m[1], +m[2] / 100] : null; });
  if (!out.length || out.some(x => !x)) return null;
  return out.sort((a, b) => a[0] - b[0]);
}
const schedText = arr => arr.map(([m, r]) => `${m}:${Math.round(r * 10000) / 100}`).join(', ');

// ── 매각공고 목록 (STEP1 '공고에서 불러오기' 선택용) ─────────────────────
let NLIST = null;
async function noticeList() {
  if (NLIST) return NLIST;
  const N = await fetch('data/notices.json?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  NLIST = ((N && N.items) || []).filter(r => (r.area || r.sum) && !/건물|주택 >|아파트|차량|동산/.test(r.usage || ''))
    .sort((a, b) => String(a.end || '9').localeCompare(String(b.end || '9')));
  return NLIST;
}
function noticeOptions(q) {
  const t = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const L = (NLIST || []).filter(r => t.every(w => [r.title, r.org, r.src, r.addr, r.sido, r.sgg, r.cat].join(' ').toLowerCase().includes(w)));
  return `<option value="">${NLIST ? `공고 선택 (${L.length}건)` : '목록 불러오는 중…'}</option>` + L.map(r => `<option value="${esc(r.id)}"${ST.notice && ST.notice.id === r.id ? ' selected' : ''}>${r.end ? `[마감 ${esc(String(r.end).slice(5, 10))}] ` : ''}${esc(r.title)} · ${esc(r.org || r.src)}${r.area ? ` · ${f0(r.area)}㎡` : ''}</option>`).join('');
}

// ── 공고에서 불러오기 (diy.html?notice=ID) ───────────────────────────────
async function loadNotice(id) {
  const get = u => fetch(u + '?t=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  const [N, OV, FS] = await Promise.all([get('data/notices.json'), get('data/notice_sum.json'), get('data/fs/index.json')]);
  let r = N && (N.items || []).find(x => x.id === id);
  if (!r) return alertBox('공고를 찾지 못했습니다 — 마감되었거나 목록에서 빠진 공고입니다.');
  if (OV && OV[id] && !r.sum) r = Object.assign({}, r, OV[id]);
  const sum = r.sum || {}, plots = (sum.plots || []).filter(p => nv(p.area) > 0), fs = FS && FS[id];
  const pct = s => { const m = String(s || '').match(/([\d.]+)\s*%/); return m ? +m[1] : null; };
  const flo = s => { const m = String(s || '').match(/(\d+)\s*층/); return m ? +m[1] : null; };
  const zoneOf = p => p.zone || r.zone || '';
  ST.notice = { id, title: r.title, url: r.url, org: r.org || r.src, noZone: false };
  Object.assign(ST.s3, { land: null, date: '', sched: '0:10, 3:90', disc: 0, landType: '민간택지', prices: {}, price: null }); ST.s1 = { donate: 0, far: null, bcr: null, height: null, sido: '' };
  ST.design = null; ST.files = []; ST.land = null; ST.s2.checked = false;   // 다른 공고로 바꿔 불러올 때 이전 값 초기화
  ST.title = r.title;
  const base = (r.addr || [r.sido, r.sgg].filter(Boolean).join(' ')).trim();
  ST.parcels = (plots.length ? plots : [{ block: '', addr: base, area: r.area, zone: r.zone }]).map(p => ({
    q: `${p.addr && !base.includes(p.addr) ? p.addr : base} ${p.block || p.jibun || ''}`.trim(), addr: `${p.addr && !base.includes(p.addr) ? p.addr : base} ${p.block || p.jibun || ''}`.trim(),
    area: nv(p.area), jimok: p.jimok || '대', zone: zoneOf(p), price: null, pnu: r.pnu || '', uses: [], src: 'notice' }));
  if (ST.parcels.some(p => !p.zone)) { ST.notice.noZone = true; ST.parcels.forEach(p => { if (!p.zone) p.zone = '제3종일반주거지역'; }); }
  const p0 = plots[0] || {};
  ST.s1.sido = r.sido || ''; ST.s1.far = pct(p0.far); ST.s1.bcr = pct(p0.bcr);
  const fl = flo(p0.floors); if (fl) ST.s2.floors = fl;
  const hh = plots.reduce((a, p) => a + (nv(String(p.units || '').replace(/[^\d].*$/, '')) || 0), 0); if (hh) ST.s2.hh = hh;
  ST.s2.mode = 'file';
  const price = r.supply || plots.reduce((a, p) => a + (nv(p.price) || 0), 0) || r.apsl || r.minp;
  if (price) ST.s3.land = Math.round(price / 1e6) / 100;   // 원 → 억
  const sch = sum.schedule || {}, ck = Object.keys(sch).find(k => /계약/.test(k));
  const dm = ck && String(sch[ck]).match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/); if (dm) ST.s3.date = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
  if (/LH|iH|GH|도시공사|토지주택|택지|공동주택용지/.test([r.src, r.org, r.ot, r.title].join(' '))) ST.s3.landType = '공공택지';
  if (fs && fs.A) {   // 같은 공고의 사업성 분석이 있으면 공고 조건(토지대금 납부일정·선납할인·인허가)을 그대로 사용
    if (Array.isArray(fs.A.토지일정)) ST.s3.sched = schedText(fs.A.토지일정);
    if (fs.A.선납할인율 != null) ST.s3.disc = fs.A.선납할인율 * 100;
    if (fs.A.인허가기간) ST.s3.permit = fs.A.인허가기간;
    ST.notice.fs = true;
  } else ST.s3.permit = 24;   // 공고 검토 기본: 설계 6 + 심의·승인 15 + 착공·분양 준비 3
  ST.step = 1; render();
  alertBox('공고 조건을 불러왔습니다 — 동의 후 설계개요 파일을 올리세요.');
}

// ── STEP3 → F/S 입력 ─────────────────────────────────────────────────
const DIY_DEF = {
  분양기간: 12, 분양률: 1, 공사비평당: 8000, 분양가입력: '', BL선순위금리: 0.06, BL후순위금리: 0.08, PF선순위금리: 0.046, PF선순위취급: 0.01, 후불금리: 0.05,
  인허가기간: 12, 공사기간입력: '', 계약일: '', 공급가격: 0, 대지: 0, 용적률: 0, 연면적배수: 1.5, 세대수: 0, 층수: 25, 근생비율: 0, 시세: 0, 시세반영률: 0.85, 상가시세: 0, 발코니: 10000,
  기본형_지상: 2328, 기본형_지하비: 0.43, 건축가산률: 0.38, 법정이자율: 0.045, 상한_취득세: 0.05, 택지가산률: 0.06, 말뚝률: 0.02042, 흙막이률: 0.0214,
  계약률: 0.1, 할부간격: 3, 할부회차: 1, 할부이자율: 0, 취득세등기: 0.048, 재산세율: 0.0048, 계약금비율: 0.1, 중도금비율: 0.6, 잔금비율: 0.3,
  인입_평당: 20, 설계_평당: 55, 감리_평당: 110, 표준건축비: 2392, 미술률: 0.001, 용역비: 1000000, 지역난방_m2: 14.04, 기타부담금: 500000, 광고률: 0.005,
  MH: 2200000, MH운영: 30000, 분양수수료: 3000, 분양보증률: 0.0029, 보존등기률: 0.032, 신탁: 250000, 관리비_월: 30000, 입주관리: 1000, 예비비률: 0.0035, 기타비기준: 0.28,
  BL선순위비중: 0.64, BL선순위취급: 0.005, BL후순위취급: 0.03, BL자문: 0.005, PF자문: 0.005, PF보증률: 0.00848, 최소현금: 500000, Equity입력: '', 목표이익률: 0.1, 공사비확보율: 0.5,
};
// 평형 묶음: 59A·59B → 59, 84A·84B → 84 (이름 앞 숫자, 없으면 전용면적 반올림)
const gKey = t => (String(t.name || '').match(/\d{2,3}/) || [])[0] || String(Math.round(nv(t.ex) || 0));
function typeGroups(d) {
  const G = new Map();
  (d.types || []).filter(t => nv(t.count) > 0).forEach(t => {
    const k = gKey(t), n = nv(t.count), g = G.get(k) || { key: k, count: 0, ex: 0, sup: 0, con: 0, use: t.use, names: [] };
    g.count += n; g.ex += nv(t.ex) * n; g.sup += (nv(t.sup) || nv(t.ex)) * n; g.con += (nv(t.con) || nv(t.sup) || nv(t.ex)) * n; g.names.push(t.name); G.set(k, g);
  });
  return [...G.values()].map(g => ({ ...g, ex: g.ex / g.count, sup: g.sup / g.count, con: g.con / g.count })).sort((a, b) => a.ex - b.ex);
}
// 타입별 공급평당 분양가(만원/평) — 비어 있으면 시세×반영률
const gPrice = (g, s3) => nv((s3.prices || {})[g.key]) || (nv(s3.mkt) ? nv(s3.mkt) * (nv(s3.mktRatio) || 85) / 100 : null);
const allPriced = s3 => { const gs = ST.design ? typeGroups(ST.design) : []; return gs.length && gs.every(g => nv((s3.prices || {})[g.key])); };
function specOf() {
  const d = ST.design, s3 = ST.s3, A1 = analyze();
  const types = d.types.filter(t => nv(t.count) > 0);
  const 세대 = types.reduce((a, t) => a + nv(t.count), 0);
  const 지상 = nv(d.지상), 대지 = nv(d.대지), commSup = d.comm ? nv(d.comm.sup) || 0 : 0;
  const 근생비율 = 지상 ? commSup / 지상 : 0, 주거평 = 지상 * (1 - 근생비율) * PY;
  const supTot = types.reduce((a, t) => a + (nv(t.sup) || nv(t.ex)) * nv(t.count), 0);
  let 주거총 = null;   // 천원 (발코니 제외)
  const groups = typeGroups(d), priced = allPriced(s3);
  if (priced) 주거총 = groups.reduce((a, g) => a + nv(s3.prices[g.key]) * 10 * g.sup * g.count * PY, 0);   // 타입별 공급평당 분양가 × 공급면적
  const op = d.use === '오피스텔';
  const unitPrice = 주거총 ? 주거총 / 세대 : (nv(s3.mkt) || 0) * 10 * (supTot / 세대) * PY * (nv(s3.mktRatio) || 85) / 100;
  const sched = parseSched(s3.sched) || [[0, 0.1], [3, 0.9]];
  const allSup = types.length && types.every(t => nv(t.sup) > 0);
  const A = Object.assign({}, DIY_DEF, {
    대지, 용적률: 지상 / 대지, 근생비율, 주거분양평: allSup ? Math.round(supTot * PY * 100) / 100 : '',
    토지일정: sched, 계약률: sched[0][0] === 0 ? sched[0][1] : 0, 선납할인율: (nv(s3.disc) || 0) / 100, 세대수: 세대, 층수: nv(d.지상층) || 25, 설계연면적: nv(d.연면적),
    공급가격: Math.round(nv(s3.land) * 1e5), 계약일: s3.date || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    인허가기간: nv(s3.permit) || 12, 공사기간입력: nv(s3.build) != null ? nv(s3.build) : '', 분양기간: nv(s3.sale), 분양률: (nv(s3.rate) || 100) / 100,
    분양가입력: 주거총 ? 주거총 / (allSup ? supTot * PY : 주거평) : '', 시세: nv(s3.mkt) ? nv(s3.mkt) * 10 * (supTot / 세대 * PY) / (주거평 / 세대) : 0, 시세반영률: (nv(s3.mktRatio) || 85) / 100,
    상가시세: d.comm && nv(s3.comm) ? nv(s3.comm) * 10 * (nv(d.comm.ex) || commSup * 0.85) / commSup : 0,   // 근생: 전용평당 입력 → 엔진 공급평당 환산
    공사비평당: nv(s3.cost) * 10, 공사비확보율: (nv(s3.cover) || 50) / 100,
    PF선순위금리: (nv(s3.pfRate) || 4.6) / 100, BL선순위금리: (nv(s3.blRate) || 6) / 100, BL후순위금리: (nv(s3.blRate2) != null ? nv(s3.blRate2) : (nv(s3.blRate) || 6) + 2) / 100,
    택지구분: s3.landType || '민간택지', 주거용도: op ? '오피스텔' : '아파트', 신탁유형: s3.trust || '관리형토지신탁', 신탁: 300000,
    중도금이자방식: s3.midInt || '무이자', 근생중도금이자방식: s3.midInt || '무이자', 철거비: nv(s3.demol) ? Math.round(nv(s3.demol) * 1e5) : 0,
    광역부과율: /서울|경기|인천/.test(ST.parcels.map(p => p.addr || p.q).join(' ') + ST.s1.sido) ? 0.04 : 0.02,
    발코니: op ? 0 : 10000, 분양수수료: op ? Math.round(unitPrice * 0.03) : 3000, 광고률: op ? 0.01 : 0.005,
  });
  const today = new Date().toISOString().slice(0, 10);
  const design = { 지상, 지하: nv(d.지하), 연면적: nv(d.연면적), 지하층: nv(d.지하층), 최고층: nv(d.지상층), 동수: nv(d.동수) || 1, 건축면적: nv(d.건축면적) || 0,
    주차: nv(d.주차), 주차근거: d.source, 세대, 건폐율: nv(d.건폐율) || 0, 용적률: nv(d.용적률) || 지상 / 대지 * 100, 배수: nv(d.연면적) / 지상,
    타입: groups.map(g => ({ name: g.key, ex: Math.round(g.ex * 100) / 100, count: g.count, sup: Math.round(g.sup * 10000) / 10000, con: Math.round(g.con * 10000) / 10000, price: priced ? nv(s3.prices[g.key]) * 10 : undefined })),   // 평형 묶음(59·84…) + 타입별 평당가
    주거용도: op ? '오피스텔' : '아파트', 근생: d.comm ? { ex: nv(d.comm.ex), sup: commSup, con: nv(d.comm.con) } : undefined };
  const capArea = A1.flags.some(f => /분양가상한제/.test(f)) && !op;
  const title = ST.title || (ST.parcels[0] ? (ST.parcels[0].addr || ST.parcels[0].q) : '사업성 DIY');
  return {
    title, date: today.replace(/-/g, '.'), dateISO: today, name: `${title.replace(/[\\/:*?"<>|]/g, '')}_사업성검토_${today.replace(/-/g, '')}.xlsx`, A, design,
    site: { addr: ST.parcels.map(p => p.addr || p.q).join(', '), zone: A1.zones.map(([z]) => z).join(', ') + (A1.flags.some(f => /지구단위/.test(f)) ? ', 지구단위계획구역' : '') },
    notes: {
      대지: `사업 대지(기부채납 후) — ${d.source}`, 용적률: '설계개요 지상 연면적 ÷ 대지', 설계연면적: `${d.source}: 지상+지하`,
      분양가입력: 주거총 ? `타입별 공급평당 ${groups.map(g => `${g.key}타입 ${f0(nv(s3.prices[g.key]))}만원`).join(' · ')} → 평균` : '시세×반영률 / 상한제 상한 중 낮은 값', 상가시세: d.comm && nv(s3.comm) ? `근생 전용평당 ${s3.comm}만원 → 공급평당 환산` : '',
      시세: nv(s3.mkt) ? `인근 시세 공급평당 ${s3.mkt}만원(사용자 조사)` : '', 공사비평당: `사용자 입력 ${s3.cost}만원/평`, 분양기간: `${s3.sale}개월 ${s3.rate}% (사용자 입력)`,
      인허가기간: '사용자 입력', 선납할인율: nv(s3.disc) ? `선납일수 × 연 ${s3.disc}% (공고 조건)` : '', 주거분양평: allSup ? '설계개요 타입별 공급면적 합계' : '',
      공급가격: ST.notice ? `공고 공급가격(기준가) — ${ST.notice.title}` : '사용자 입력 토지 매입가', 택지구분: `사용자 선택: ${s3.landType || '민간택지'}`, 신탁유형: `사용자 선택: ${s3.trust || '관리형토지신탁'}`, 중도금이자방식: `사용자 선택: ${s3.midInt || '무이자'}`, 공사비확보율: '사용자 입력(기본 50%)', 공사기간입력: nv(s3.build) != null ? '사용자 입력' : '미입력 → 기준(30층 미만 34개월, 30층 이상 34+(층수−29))',
    },
    summary: [
      ...(ST.notice ? [['공고', `${ST.notice.title} — 토지대금 ${schedText(sched)} (개월차:비율%)${nv(s3.disc) ? ` · 선납할인 연 ${s3.disc}%` : ''}`, null]] : []),
      ['토지 분석', `${A1.zones.map(([z, a]) => `${z} ${f0(a)}㎡`).join(', ')} · 합계 ${f0(A1.total)}㎡ · 공시지가 합계 ${억(A1.priceSum / 1000)}`, null],
      ...A1.flags.slice(0, 4).map(t => ['규제·확인', t, /상한제|불가|저촉/.test(t) ? 'C55A11' : null]),
      ['설계개요', `${d.source} · 지상 ${f0(지상)}㎡ + 지하 ${f0(nv(d.지하))}㎡ = ${f0(nv(d.연면적))}㎡ · ${op ? '오피스텔' : '공동주택'} ${세대}${op ? '실' : '세대'}`, null],
      ...(capArea ? [['분양가', '분양가상한제 지역 — 상한 산정 시 택지비를 매입가로 가정(실제는 감정평가액)', 'C55A11']] : []),
    ],
    sources: [...(ST.notice ? [`공고: ${ST.notice.title} (${ST.notice.org || ''})`] : []), '브이월드 토지특성·토지이용계획 (사용자 조회)', `설계개요: ${d.source}`, '분양가·공사비: 사용자 입력', '금융·기타비: 당사 표준 가정'],
  };
}
function runFs() {
  const S = specOf(), r = E().run(S.A);
  const 판정 = r.이익률 >= S.A.목표이익률 && !r.자금부족 ? 'Go' : 'No-go';
  ST.result = { S, r, 매출: r.매출, 사업비: r.토지비 + r.공사비 + r.기타비, 이익: r.이익, 이익률: r.이익률, 판정, 자금부족: r.자금부족 };
  return ST.result;
}
async function download() {
  const { S } = runFs();
  await loadLib('xlsx');
  const L = await fetch('data/fs/layout.json?v=20261112').then(r => r.json());
  const buf = await E().build(window.ExcelJS, S, L).xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = S.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  collect('download');
}

// ── 화면 ─────────────────────────────────────────────────────────────
function sel(label, key, obj, opts, o = {}) {
  return `<label class="fld${o.key ? ' key' : ''}"><span>${label}</span><select data-k="${key}" data-o="${o.o || ''}">${opts.map(x => `<option${x === obj[key] ? ' selected' : ''}>${x}</option>`).join('')}</select>${o.hint ? `<small>${o.hint}</small>` : ''}</label>`;
}
const ZONE_OPTS = () => Object.keys(D().NATIONAL).map(z => `<option>${z}</option>`).join('');
function field(label, key, obj, opt = {}) {
  const v = obj[key] == null ? '' : obj[key];
  return `<label class="fld${opt.key ? ' key' : ''}"><span>${label}${opt.req ? ' <b class="req">*</b>' : ''}</span>
    <span class="inp"><input data-k="${key}" data-o="${opt.o || ''}" value="${esc(v)}" ${opt.type ? `type="${opt.type}"` : 'inputmode="decimal"'} placeholder="${esc(opt.ph || '')}">${opt.unit ? `<em>${opt.unit}</em>` : ''}</span>
    ${opt.hint ? `<small>${opt.hint}</small>` : ''}</label>`;
}
function renderStepper() {
  const names = ['토지 분석', '설계개요', '분양가·공사비', '결과·다운로드'];
  $('#stepper').innerHTML = names.map((n, i) => `<button class="st${ST.step === i + 1 ? ' on' : ''}${ST.step > i + 1 ? ' done' : ''}" data-go="${i + 1}"><b>STEP${i + 1}</b><span>${n}</span></button>${i < 3 ? '<i>→</i>' : ''}`).join('');
  $$('#stepper [data-go]').forEach(b => b.onclick = () => { const g = +b.dataset.go; if (g < ST.step || canGo(g)) { ST.step = g; render(); } });
}
function canGo(g) {
  if (g >= 2 && !(ST.consent && analyze().total > 0 && analyze().main)) return false;
  if (g >= 3 && !(ST.design && ST.s2.checked)) return false;
  if (g >= 4 && !(nv(ST.s3.land) && nv(ST.s3.sale) && nv(ST.s3.cost) && (allPriced(ST.s3) || nv(ST.s3.mkt)))) return false;
  return true;
}
function render() {
  renderStepper();
  const P = $('#panel');
  if (ST.step === 1) P.innerHTML = view1();
  if (ST.step === 2) P.innerHTML = view2();
  if (ST.step === 3) P.innerHTML = view3();
  if (ST.step === 4) P.innerHTML = view4();
  bind();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function nav(prev, next, nextLabel) {
  return `<div class="nav">${prev ? `<button class="btn ghost" data-act="prev">← 이전</button>` : '<span></span>'}${next ? `<button class="btn" data-act="next">${nextLabel || '다음 →'}</button>` : ''}</div>`;
}
function view1() {
  const A1 = analyze();
  const MAXR = 40;
  const rows = ST.parcels.slice(0, MAXR).map((p, i) => `<tr>
    <td>${esc(p.addr || p.q)}${p.pnu ? `<div class="small"><a href="https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=${p.pnu}&mode=search&isNoScr=script" target="_blank" rel="noopener">토지이음 ↗</a></div>` : ''}${p.err ? `<div class="err">${esc(p.err)}</div>` : ''}</td>
    <td><input class="cell" data-pi="${i}" data-pk="area" value="${p.area ?? ''}" inputmode="decimal"></td>
    <td>${esc(p.jimok || '')}</td>
    <td><select class="cell" data-pi="${i}" data-pk="zone"><option value="">선택</option>${ZONE_OPTS().replace(`<option>${p.zone}</option>`, `<option selected>${p.zone}</option>`)}</select></td>
    <td><input class="cell" data-pi="${i}" data-pk="price" value="${p.price ?? ''}" inputmode="decimal"></td>
    <td class="wrap">${(p.uses || []).filter(u => !/^(도시지역|.*지역)$/.test(u.name) || /지구|구역/.test(u.name)).slice(0, 8).map(u => `<span class="chip">${esc(u.name)}${u.rel && u.rel !== '포함' ? `·${esc(u.rel)}` : ''}</span>`).join('')}</td>
    <td><button class="x" data-del="${i}" title="삭제">×</button></td></tr>`).join('');
  return `<section class="card">
    <h2>STEP 1. 토지 분석</h2>
    ${ST.notice ? `<div class="consent"><b>공고에서 불러옴: <a href="${esc(ST.notice.url || '#')}" target="_blank" rel="noopener">${esc(ST.notice.title)}</a></b><small>공급가격·면적·건폐율·용적률·층수·세대수·계약일${ST.notice.fs ? '·토지대금 납부일정·선납할인·인허가기간(기존 사업성 분석)' : ''}을 채웠습니다. 다음 단계에서 설계개요 파일(가설계)을 올리세요.${ST.notice.noZone ? ' 공고에 용도지역이 없어 제3종일반주거지역으로 가정했습니다 — 용적률은 공고 값을 씁니다.' : ''}</small></div>` : ''}
    <p class="lead">사업 부지의 지번을 입력하면 브이월드에서 면적·지목·용도지역·공시지가와 토지이용계획(지역·지구·구역)을 조회해 개발 가능 규모와 확인할 규제를 정리합니다. 조회가 안 되면 표에 직접 입력하세요.</p>
    <div class="consent"><label><input type="checkbox" id="consent" ${ST.consent ? 'checked' : ''}> <b>입력값과 업로드 파일이 사이트 운영자에게 전송·보관되는 데 동의합니다.</b></label>
      <small>사업성 분석 품질 개선을 위한 데이터 수집 목적이며, 운영자 외에는 열람할 수 없습니다. 토지조서 원본(소유자 정보)은 보내지 않고 인식된 필지 정보만 전송합니다. 동의해야 진행할 수 있습니다.</small></div>
    <div class="pick"><span class="lab">매각공고에서 불러오기</span>
      <input id="nq" placeholder="공고명·지역 검색 (예: 검단, 공동주택)" value="">
      <select id="nsel">${noticeOptions('')}</select>
      <button class="btn ghost sm" data-act="nload">불러오기</button>
      <small>공고 목록의 토지 공고를 고르면 공급가격·면적·용적률·층수·세대수·계약일·납부조건을 채웁니다.</small></div>
    <div class="grid2">
      ${field('사업명', 'title', ST, { o: 'root', type: 'text', ph: '예) ○○동 주상복합' })}
      <label class="fld"><span>지번 (한 줄에 하나, 합필 가능)</span><textarea id="jibun" rows="3" placeholder="○○시 ○○구 ○○동 123-4&#10;○○시 ○○구 ○○동 123-5">${esc(ST.parcels.length > 60 ? '' : ST.parcels.map(p => p.q).join('\n'))}</textarea></label>
    </div>
    <div class="drop sm"><input type="file" id="landfile" accept=".pdf,.xlsx,.xls,.csv"><span>IM·토지조서 파일 업로드 (PDF·엑셀) — 지번·지목·면적·공시지가 자동 인식</span></div>
    <div id="lstat" class="small"></div>
    ${ST.land ? `<div class="sum land"><b>${esc(ST.land.name)}</b> — ${ST.land.sections.length > 1 ? `<select id="lsec">${ST.land.sections.map((s, i) => `<option value="${i}"${i === ST.land.pick ? ' selected' : ''}>${esc(s.title)} · ${s.parcels.length}필지 · ${f0(s.area)}㎡</option>`).join('')}</select>` : `${esc(ST.land.sections[0].title)}`}
      <span class="small">${ST.parcels.length}필지 · 면적 합계 ${f0(analyze().total)}㎡ 인식 (편입면적 우선). 소유자 등 개인정보는 읽지 않습니다. 숫자는 표에서 고칠 수 있습니다.</span>
      <div class="row"><button class="btn ghost sm" data-act="vfill">용도지역·공시지가 보완 조회 (브이월드)</button></div></div>` : ''}
    <div class="row"><button class="btn" data-act="lookup">토지 조회</button><button class="btn ghost" data-act="addrow">직접 입력 행 추가</button>
      <details class="key"><summary>브이월드 인증키 ${vkey() ? '(설정됨)' : '(미설정)'}</summary><div class="row"><input id="vkey" placeholder="인증키 입력 — 이 브라우저에만 저장" value=""><button class="btn ghost" data-act="savekey">저장</button></div><small>vworld.kr → 오픈API → 인증키 발급(서비스 URL: ${location.hostname}). 운영자 설정 키가 있으면 자동 사용.</small></details></div>
    <div class="tw"><table class="pt"><thead><tr><th>지번</th><th>면적(㎡)</th><th>지목</th><th>용도지역</th><th>공시지가(원/㎡)</th><th>지역·지구·구역</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="small">지번을 입력해 조회하거나 IM·토지조서 파일을 올리세요.</td></tr>'}${ST.parcels.length > MAXR ? `<tr><td colspan="7" class="small">외 ${ST.parcels.length - MAXR}필지 — 합계·분석에는 모두 반영</td></tr>` : ''}</tbody></table></div>
    ${A1.total > 0 ? `<div class="sum">
      <div class="kpis"><div><small>합계 면적</small><b>${f2(A1.total)}㎡</b><em>${f2(A1.total * PY)}평</em></div>
        <div><small>대표 용도지역</small><b>${esc(A1.main || '-')}</b><em>${A1.zones.length > 1 ? '복수 용도지역' : ''}</em></div>
        <div><small>용적률 / 건폐율</small><b>${f0(nv(ST.s1.far) ?? A1.far)}% / ${f0(nv(ST.s1.bcr) ?? A1.bcr)}%</b><em>${nv(ST.s1.far) != null ? (ST.notice ? '공고·지구단위계획 적용값' : '적용값 (직접 입력)') : esc(A1.src)}</em></div>
        <div><small>공시지가 합계</small><b>${억(A1.priceSum / 1000)}</b><em>${A1.total ? f0(A1.priceSum / A1.total / PY / 1e4) + '만원/평' : ''}</em></div></div>
      ${A1.flags.length ? `<ul class="flags">${A1.flags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="grid3">
        ${field('도로 등 기부채납 면적', 'donate', ST.s1, { o: 's1', unit: '㎡', hint: '사업 대지에서 제외' })}
        ${field('적용 용적률 (지구단위계획 상한 등)', 'far', ST.s1, { o: 's1', unit: '%', ph: f0(A1.far), hint: '비우면 조례 용적률', key: true })}
        ${field('적용 건폐율', 'bcr', ST.s1, { o: 's1', unit: '%', ph: f0(A1.bcr) })}
        ${field('높이 제한', 'height', ST.s1, { o: 's1', unit: 'm', hint: '지구단위계획·고도지구 등' })}
      </div></div>` : ''}
    ${nav(false, true)}</section>`;
}
function designTable(d) {
  const rec = d.recognized || {}, mark = k => rec[k] ? ` class="rec" title="인식 근거: ${esc(rec[k])}"` : '';
  const F = (lab, k, unit) => `<tr><th>${lab}</th><td${mark(k)}><input class="dz" data-dk="${k}" value="${d[k] == null ? '' : Math.round(d[k] * 100) / 100}" inputmode="decimal"><em>${unit}</em></td></tr>`;
  const types = d.types.map((t, i) => `<tr><td><input class="dt" data-ti="${i}" data-tk="name" value="${esc(t.name)}"></td><td><select class="dt" data-ti="${i}" data-tk="use">${['공동주택', '오피스텔', '도시형생활주택'].map(u => `<option${u === t.use ? ' selected' : ''}>${u}</option>`).join('')}</select></td>
    ${['ex', 'sup', 'con', 'count'].map(k => `<td><input class="dt" data-ti="${i}" data-tk="${k}" value="${t[k] == null ? '' : t[k]}" inputmode="decimal"></td>`).join('')}<td><button class="x" data-tdel="${i}">×</button></td></tr>`).join('');
  const c = d.comm || {};
  return `<div class="grid2"><table class="pt kv"><tbody>
    ${F('대지면적 (사업)', '대지', '㎡')}${F('공부상 면적', '공부상면적', '㎡')}${F('기부채납', '기부채납', '㎡')}${F('건축면적', '건축면적', '㎡')}${F('건폐율', '건폐율', '%')}${F('용적률', '용적률', '%')}
    </tbody></table><table class="pt kv"><tbody>
    ${F('지상 연면적 (용적률 산정)', '지상', '㎡')}${F('지하 연면적', '지하', '㎡')}${F('전체 연면적', '연면적', '㎡')}${F('지하 층수', '지하층', '층')}${F('지상 층수', '지상층', '층')}${F('동수', '동수', '동')}${F('주차대수', '주차', '대')}
    </tbody></table></div>
    <h3>타입별 면적 (전용·공급·계약 ㎡, 세대·실 수)</h3>
    <div class="tw"><table class="pt"><thead><tr><th>타입</th><th>용도</th><th>전용</th><th>공급</th><th>계약</th><th>세대(실)</th><th></th></tr></thead><tbody>${types}</tbody></table></div>
    <button class="btn ghost sm" data-act="addtype">+ 타입 추가</button>
    <h3>근린생활시설 (㎡)</h3>
    <div class="grid3">${['ex:전용', 'sup:공급(지상)', 'con:계약'].map(s => { const [k, l] = s.split(':'); return `<label class="fld"><span>${l}</span><span class="inp"><input class="dc" data-ck="${k}" value="${c[k] == null ? '' : c[k]}" inputmode="decimal"><em>㎡</em></span></label>`; }).join('')}</div>
    ${(d.warn || []).length ? `<ul class="flags">${d.warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
}
function view2() {
  const s2 = ST.s2, A1 = analyze();
  const files = ST.files.map((f, i) => `<div class="file"><b>${esc(f.name)}</b> <span class="small">${(f.size / 1024).toFixed(0)}KB · ${{ pdf: 'PDF 텍스트 인식', xlsx: '엑셀 인식', ocr: '스캔 PDF — 이미지 글자 인식(OCR), 숫자를 원문과 꼭 대조하세요', 'pdf+ocr': 'PDF 텍스트 + 이미지 글자 인식(OCR)', 'ocr-img': '이미지 글자 인식(OCR), 숫자를 원문과 꼭 대조하세요', scan: '스캔 PDF — 글자 인식 실패, 직접 입력', image: '이미지 — 글자 인식 실패, 직접 입력', other: '지원하지 않는 형식' }[f.kind]}${f.err ? ` <span class="err">${esc(f.err)}</span>` : ''}</span>
    ${f.md ? `<details><summary>변환된 마크다운 보기</summary><pre>${esc(f.md.slice(0, 30000))}</pre></details>` : ''}${f.url ? `<img src="${f.url}" alt="${esc(f.name)}" class="prev">` : ''}</div>`).join('');
  return `<section class="card">
    <h2>STEP 2. 설계개요</h2>
    <div class="seg"><button class="${s2.mode === 'gen' ? 'on' : ''}" data-mode="gen">설계개요 생성기로 산출</button><button class="${s2.mode === 'file' ? 'on' : ''}" data-mode="file">설계개요·IM 파일 업로드</button></div>
    ${s2.mode === 'gen' ? `<p class="lead">STEP1 결과(대지 ${f0(A1.total - (nv(ST.s1.donate) || 0))}㎡, 용적률 ${f0(nv(ST.s1.far) ?? A1.far)}%)에 용도·층수·평형을 넣어 지상·지하 면적, 세대(실)수, 주차를 산출합니다.</p>
      <div class="grid3">
        <label class="fld key"><span>주용도</span><select data-k="use" data-o="s2">${['공동주택', '오피스텔'].map(u => `<option${u === s2.use ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
        ${field('근생 비율 (지상 연면적 대비)', 'commPct', s2, { o: 's2', unit: '%' })}
        ${field('최고 층수', 'floors', s2, { o: 's2', unit: '층', key: true })}
        ${field(s2.use === '공동주택' ? '층당 세대수' : '층당 호실수', 'perFloor', s2, { o: 's2', unit: '호' })}
        ${s2.use === '공동주택' ? field('계획 세대수 (선택)', 'hh', s2, { o: 's2', unit: '세대', hint: '평균 면적으로 59·84·114 구성' }) : field('오피스텔 전용면적', 'opEx', s2, { o: 's2', unit: '㎡' })}
        ${field('지하 주차 1대당 면적', 'stall', s2, { o: 's2', unit: '㎡' })}
      </div>
      <label class="chk"><input type="checkbox" data-k="partial" data-o="s2" ${s2.partial ? 'checked' : ''}> 지하 마지막 층은 필요한 면적만 반영 (정수 층 올림 안 함)</label>
      <div class="row"><button class="btn" data-act="gen">설계개요 산출</button></div>`
    : `<p class="lead">설계개요 PDF·엑셀(IM 포함)을 올리면 텍스트를 마크다운으로 바꿔 대지·연면적·층수·세대(실)·타입별 면적을 자동 인식합니다. <b>인식 결과는 아래 표에서 칸마다 고칠 수 있습니다.</b> 스캔 PDF·이미지는 브라우저 안에서 글자 인식(OCR)으로 읽습니다 — 쪽당 10~20초, 숫자를 꼭 대조하세요.</p>
      <div class="drop"><input type="file" id="file" accept=".pdf,.xlsx,.xls,image/*" multiple><span>파일을 끌어다 놓거나 눌러서 선택 (PDF · 엑셀 · 이미지)</span></div>
      <div id="fstat" class="small"></div>${files}`}
    ${ST.design ? `<div class="sum"><h3>설계개요 확인 ${ST.design.source === '파일 인식' ? '<span class="chip hot">파일 인식 — 숫자를 원문과 대조하세요</span>' : `<span class="chip">${esc(ST.design.source)}</span>`}</h3>
      <p class="small">파란 테두리 칸은 파일에서 인식한 값입니다(마우스를 올리면 인식 근거 표시). 틀린 숫자는 바로 고치세요.</p>
      ${designTable(ST.design)}
      <label class="chk confirm"><input type="checkbox" id="checked" ${s2.checked ? 'checked' : ''}> <b>설계개요 숫자를 확인했습니다</b> (다음 단계 진행 조건)</label></div>` : ''}
    ${nav(true, true)}</section>`;
}
// 타입별 세대(실)당 분양가 자동 계산 (공급평당 분양가 × 타입 공급평)
function unitOf(g, s3) { const px = gPrice(g, s3); return px ? px * g.sup * PY / 1e4 : null; }   // 억원
function priceRows(d, s3) {
  const op = d.use === '오피스텔';
  return typeGroups(d).map(g => { const u = unitOf(g, s3), own = nv((s3.prices || {})[g.key]);
    return `<div class="prow"><span class="pl"><b>${esc(g.key)}타입</b><small>전용 ${f2(g.ex)}㎡ · 공급 ${f2(g.sup * PY)}평 · ${f0(g.count)}${op ? '실' : '세대'}${g.names.length > 1 ? ` (${g.names.map(esc).join('·')})` : ''}</small></span>
      <span class="pi"><input class="gp" data-gk="${esc(g.key)}" value="${own == null ? '' : own}" inputmode="decimal" placeholder="${nv(s3.mkt) ? f0(gPrice(g, s3)) : '예) 1900'}"><em>만원/평</em></span>
      <span class="pu" id="pu-${esc(g.key)}">${u ? `(${op ? '실당' : '세대당'} ${u.toFixed(2)}억원${own == null ? ' · 시세×반영률' : ''})` : `(${op ? '실당' : '세대당'} -억원)`}</span></div>`; }).join('');
}
function priceTotal(d, s3) {
  const gs = typeGroups(d); let tot = 0, n = 0, ok = true;
  gs.forEach(g => { const u = unitOf(g, s3); if (u == null) ok = false; else { tot += u * g.count; n += g.count; } });
  const c = d.comm && nv(s3.comm) ? (nv(d.comm.ex) || nv(d.comm.sup) * 0.85) * PY * nv(s3.comm) / 1e4 : 0;
  return ok && n ? `주거 매출 ${f0(tot)}억 · 평균 ${d.use === '오피스텔' ? '실당' : '세대당'} ${(tot / n).toFixed(2)}억${c ? ` · 근생 ${f0(c)}억` : ''} (발코니 확장비 별도)` : '타입별 공급평당 분양가를 모두 넣거나, 비워 두고 인근 시세를 넣으세요.';
}
function view3() {
  const s3 = ST.s3, d = ST.design, A1 = analyze(), op = d.use === '오피스텔';
  const cap = A1.flags.some(f => /분양가상한제/.test(f)) && !op;
  const n = d.types.reduce((a, t) => a + (nv(t.count) || 0), 0);
  return `<section class="card">
    <h2>STEP 3. 분양가 · 공사비 · 사업조건</h2>
    ${s3.landType === '공공택지' && !op && !cap ? `<div class="warnbox">공공택지 공동주택은 분양가상한제 대상입니다. 분양가를 넣으면 그 값으로 계산하고, 엑셀 '분양가' 시트에서 상한 금액과 비교할 수 있습니다.</div>` : ''}
    ${cap ? `<div class="warnbox">분양가상한제 적용지역의 공동주택입니다. 분양가를 직접 넣어도 상한을 넘을 수 없으니, <b>시세 칸만 입력</b>하면 엑셀에서 MIN(상한제 상한, 시세×반영률)을 적용합니다(상한 산정 택지비는 매입가 가정).</div>` : ''}
    <h3>토지·일정</h3>
    <div class="grid3">
      ${field('토지 매입가', 'land', s3, { o: 's3', unit: '억원', req: true, key: true, hint: A1.priceSum ? `공시지가 합계 ${억(A1.priceSum / 1000)}` : '' })}
      ${field('토지 계약일', 'date', s3, { o: 's3', type: 'date' })}
      ${sel('택지 구분', 'landType', s3, ['민간택지', '공공택지'], { o: 's3', hint: '민간택지: 광역교통·학교용지·상하수도 부담금, 중개수수료 1% 반영' })}
      ${field('기존건축물 철거비', 'demol', s3, { o: 's3', unit: '억원', hint: '토지 컨디션별 — 없으면 비움' })}
      ${field('인허가 기간 (계약→착공)', 'permit', s3, { o: 's3', unit: '개월', key: true, hint: '설계 6 + 심의·승인 12~15 + 착공·분양 준비 2~4' })}
      ${(() => { const sc = parseSched(s3.sched), tot = sc ? sc.reduce((a, x) => a + x[1], 0) : 0; return field('토지대금 납부일정 (개월차:비율%)', 'sched', s3, { o: 's3', type: 'text', hint: sc ? `합계 ${Math.round(tot * 1000) / 10}%${Math.abs(tot - 1) > 0.001 ? ' — 100%가 아닙니다' : ''} · 착공(인허가 기간) 이후 회차는 착공 때 선납` : '형식: 0:10, 18:8, 27:8 … (쉼표로 구분)' }); })()}
      ${field('선납할인율 (연)', 'disc', s3, { o: 's3', unit: '%', hint: '공공택지 선납할인 — 없으면 0' })}
      ${(() => { const fl = nv(d.지상층) || 25, auto = fl < 30 ? 34 : 34 + fl - 29; return field('공사기간', 'build', s3, { o: 's3', unit: '개월', ph: String(auto), hint: `비우면 기준 적용: 지상 ${fl}층 → ${auto}개월 (30층 미만 34개월, 30층 이상 34+(층수−29))` }); })()}
    </div>
    <h3>분양가 (${op ? '오피스텔' : '공동주택'} ${n}${op ? '실' : '세대'}) — 타입별 공급평당 분양가</h3>
    <div class="prices">${priceRows(d, s3)}</div>
    <p class="small" id="ptot">${priceTotal(d, s3)}</p>
    <div class="grid3">
      ${field('인근 시세 (공급평당, 자체 조사)', 'mkt', s3, { o: 's3', unit: '만원/평', hint: '분양가가 없을 때 시세×반영률 적용' })}
      ${field('시세 반영률', 'mktRatio', s3, { o: 's3', unit: '%' })}
      ${d.comm ? field('근생 분양가 (전용평당)', 'comm', s3, { o: 's3', unit: '만원/평', hint: `근생 전용 ${f2((nv(d.comm.ex) || nv(d.comm.sup) * 0.85) * PY)}평` }) : ''}
      ${field('분양기간', 'sale', s3, { o: 's3', unit: '개월', req: true, key: true, hint: '반드시 입력' })}
      ${field('분양률', 'rate', s3, { o: 's3', unit: '%' })}
      ${sel('중도금 이자 방식', 'midInt', s3, ['무이자', '후불제'], { o: 's3', hint: '무이자 = 시행사 부담 / 후불제 = 수분양자 부담' })}
    </div>
    <h3>공사비·금융</h3>
    <div class="grid3">
      ${field('공사비 (연면적 평당)', 'cost', s3, { o: 's3', unit: '만원/평', req: true, key: true, hint: '지방 중층 600~750 · 수도권 고층 800~1,000' })}
      ${field('공사비 확보율 (PF 조달)', 'cover', s3, { o: 's3', unit: '%', hint: '나머지 분양불' })}
      ${sel('신탁 구분', 'trust', s3, ['관리형토지신탁', '개발형토지신탁', '자금관리대리사무', '없음'], { o: 's3', hint: '관리형 매출 0.5% · 개발형 3% · 대리사무 정액 3억 (가정 시트에서 조정)' })}
      ${field('PF 금리', 'pfRate', s3, { o: 's3', unit: '%' })}
      ${field('브릿지론 선순위 금리', 'blRate', s3, { o: 's3', unit: '%' })}
      ${field('브릿지론 후순위 금리', 'blRate2', s3, { o: 's3', unit: '%' })}
    </div>
    <p class="small">기타 사업비(설계·감리·판매비·제세·부대비)와 세부 금융조건은 당사 표준 가정으로 넣고, 내려받은 엑셀의 '가정' 시트에서 고칠 수 있습니다.</p>
    ${nav(true, true, '사업성 계산 →')}</section>`;
}
function view4() {
  let R, err = '';
  try { R = runFs(); } catch (e) { err = e.message; }
  if (err) return `<section class="card"><h2>결과</h2><div class="warnbox">${esc(err)}</div>${nav(true, false)}</section>`;
  const r = R.r, S = R.S;
  collect('result');
  return `<section class="card">
    <h2>사업성 결과 <span class="chip ${R.판정 === 'Go' ? 'win' : 'hot'}">${R.판정}</span></h2>
    <div class="kpis"><div><small>총매출</small><b>${억(r.매출)}</b></div><div><small>총사업비</small><b>${억(R.사업비)}</b><em>토지 ${억(r.토지비)} · 공사 ${억(r.공사비)} · 기타 ${억(r.기타비)}</em></div>
      <div><small>사업이익</small><b>${억(r.이익)}</b><em>이익률 ${(r.이익률 * 100).toFixed(1)}%</em></div>
      <div><small>자금</small><b>${r.자금부족 ? '자금부족' : '부족 없음'}</b><em>Equity ${억(r.Eq)} · BL ${억(r.BL)} · PF ${억(r.PF)}</em></div></div>
    <ul class="flags">${S.summary.map(([k, t]) => `<li><b>${esc(k)}</b> ${esc(t)}</li>`).join('')}${r.자금부족 ? '<li><b>자금</b> 운영계좌 현금이 마이너스인 달이 있습니다 — 공사비 확보율이나 Equity를 높여 보세요.</li>' : ''}</ul>
    <div class="row"><button class="btn big" data-act="dl">사업성 엑셀 다운로드</button><button class="btn ghost" data-act="save">작업 저장(JSON)</button></div>
    <p class="small">엑셀: 요약 · 사업수지 · 건축개요 · CF(VAT분리) · 분양가 · 가정 · 민감도. 가정 시트의 주황 칸을 바꾸면 전체가 다시 계산됩니다.</p>
    ${nav(true, false)}</section>`;
}
const later = () => setTimeout(render, 0);
function bind() {
  $$('[data-k]').forEach(el => {
    const o = el.dataset.o, tgt = o === 'root' ? ST : ST[o];
    const upd = () => { tgt[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; if (el.tagName === 'SELECT' || el.type === 'checkbox') later(); };
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', upd);
  });
  const c = $('#consent'); if (c) c.onchange = () => { ST.consent = c.checked; if (c.checked) collect('consent'); };
  const ck = $('#checked'); if (ck) ck.onchange = () => { ST.s2.checked = ck.checked; if (ck.checked) collect('design'); renderStepper(); };
  $$('.cell').forEach(el => el.addEventListener('change', () => { ST.parcels[+el.dataset.pi][el.dataset.pk] = el.dataset.pk === 'zone' ? el.value : nv(el.value); later(); }));
  $$('[data-del]').forEach(b => b.onclick = () => { ST.parcels.splice(+b.dataset.del, 1); later(); });
  $$('[data-mode]').forEach(b => b.onclick = () => { ST.s2.mode = b.dataset.mode; later(); });
  const refreshP = () => { const d = ST.design, s3 = ST.s3; if (!d) return; typeGroups(d).forEach(g => { const el = document.getElementById('pu-' + g.key), u = unitOf(g, s3), own = nv((s3.prices || {})[g.key]); if (el) el.textContent = u ? `(${d.use === '오피스텔' ? '실당' : '세대당'} ${u.toFixed(2)}억원${own == null ? ' · 시세×반영률' : ''})` : `(${d.use === '오피스텔' ? '실당' : '세대당'} -억원)`; }); const t = $('#ptot'); if (t) t.textContent = priceTotal(d, s3); };
  $$('.gp').forEach(el => el.addEventListener('input', () => { ST.s3.prices = ST.s3.prices || {}; const v = nv(el.value); if (v == null) delete ST.s3.prices[el.dataset.gk]; else ST.s3.prices[el.dataset.gk] = v; refreshP(); }));
  ['mkt', 'mktRatio', 'comm'].forEach(k => { const el = $(`[data-k=${k}][data-o=s3]`); if (el) el.addEventListener('input', refreshP); });
  $$('.dz').forEach(el => el.addEventListener('change', () => { ST.design[el.dataset.dk] = nv(el.value); ST.s2.checked = false; later(); }));
  $$('.dt').forEach(el => el.addEventListener('change', () => { const t = ST.design.types[+el.dataset.ti]; t[el.dataset.tk] = /name|use/.test(el.dataset.tk) ? el.value : nv(el.value); if (el.dataset.tk === 'use') ST.design.use = ST.design.types.some(x => x.use === '오피스텔') ? '오피스텔' : '공동주택'; ST.s2.checked = false; later(); }));
  $$('.dc').forEach(el => el.addEventListener('change', () => { ST.design.comm = ST.design.comm || {}; ST.design.comm[el.dataset.ck] = nv(el.value); if (!nv(ST.design.comm.sup)) ST.design.comm = null; ST.s2.checked = false; later(); }));
  $$('[data-tdel]').forEach(b => b.onclick = () => { ST.design.types.splice(+b.dataset.tdel, 1); later(); });
  const lf = $('#landfile');
  if (lf) { const dz = lf.parentElement; ['dragover', 'dragenter'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, () => dz.classList.remove('over'))); lf.onchange = () => lf.files[0] && handleLandFile(lf.files[0]); }
  const ls = $('#lsec'); if (ls) ls.onchange = () => { applyLand(+ls.value); later(); };
  const nq = $('#nq'), ns = $('#nsel');
  if (nq && ns) { nq.oninput = () => { ns.innerHTML = noticeOptions(nq.value); }; if (!NLIST) noticeList().then(() => { ns.innerHTML = noticeOptions(nq.value); }); }
  const fi = $('#file');
  if (fi) {
    const drop = fi.parentElement;
    ['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('over')));
    fi.onchange = () => handleFiles([...fi.files]);
  }
  $$('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b));
}
async function handleLandFile(file) {
  const st = $('#lstat'); st.textContent = '파일을 읽는 중…';
  try {
    const buf = await file.arrayBuffer(); let md = '';
    if (/pdf$/i.test(file.name) || file.type === 'application/pdf') { await loadLib('pdf'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker; md = (await window.diyParse.pdfToMd(window.pdfjsLib, new Uint8Array(buf))).md; }
    else if (/\.(xlsx|xls|csv)$/i.test(file.name)) { await loadLib('xlsx'); md = (await window.diyParse.xlsxToMd(window.ExcelJS, buf)).md; }
    else { st.textContent = 'PDF·엑셀 파일만 인식할 수 있습니다.'; return; }
    const r = window.diyParse.parseParcelsMd(md);
    if (!r.sections.length) { st.textContent = '지번 목록을 찾지 못했습니다' + (r.site ? ` (문서상 부지: ${r.site})` : '') + ' — 지번을 직접 입력하세요.'; return; }
    ST.land = { name: file.name, sido: r.sido, site: r.site, sections: r.sections, pick: 0 };
    applyLand(0);
    collect('land_file', { file: { name: file.name, type: file.type, size: file.size, parcels: r.sections[0].parcels.length } });   // 원본(소유자 등 개인정보)은 보내지 않음
  } catch (e) { st.textContent = '파일 처리 오류: ' + e.message; return; }
  render();
}
function applyLand(i) {
  const L = ST.land; L.pick = i; const sec = L.sections[i];
  ST.parcels = sec.parcels.map(p => ({ q: `${p.addr} ${p.jibun}`.trim(), addr: `${p.addr} ${p.jibun}`.trim(), pnu: p.pnu, area: p.area, jimok: p.jimok, zone: p.zone, price: p.price, uses: [], src: 'file' }));
  if (L.sido) ST.s1.sido = L.sido.split(' ')[0];
}
async function fillFromVworld(btn) {
  if (!vkey()) return alertBox('브이월드 인증키가 없어 보완 조회를 할 수 없습니다.');
  const todo = ST.parcels.filter(p => !p.uses || !p.uses.length).slice(0, 300);
  let done = 0, fail = 0; btn.disabled = true;
  for (const p of todo) {
    btn.textContent = `조회 중… ${done + fail}/${todo.length}`;
    try {
      const r = p.pnu ? await lookupPnu(p.pnu, p.addr, p.q) : await lookupParcel(p.q);
      p.pnu = r.pnu; p.uses = r.uses; p.zone = p.zone || r.zone; p.price = p.price || r.price; p.jimok = p.jimok || r.jimok; p.year = r.year; if (p.area == null) p.area = r.area; p.err = ''; done++;
    } catch (e) { p.err = '보완 조회 실패: ' + e.message; fail++; }
  }
  alertBox(`보완 조회 ${done}필지 완료${fail ? `, ${fail}필지 실패` : ''}`);
  render();
}
async function handleFiles(files) {
  const st = $('#fstat'); st.textContent = '파일을 읽는 중…';
  try {
    let best = null;
    for (const f of files) {
      const rec = await readFile(f); ST.files.push(rec);
      const scoreOf = p => Object.keys(p.values).length + p.types.length * 2;
      let p = rec.md ? window.diyParse.parseDesignMd(rec.md) : null;
      if (rec.kind === 'pdf' && (!p || scoreOf(p) <= 4)) {   // 글자층이 있어도 설계개요 표가 이미지인 PDF → OCR로 한 번 더
        try { await loadLib('pdf'); rec.md += '\n' + await ocrPdf(new Uint8Array(await f.arrayBuffer())); rec.kind = 'pdf+ocr'; p = window.diyParse.parseDesignMd(rec.md); } catch (e) { rec.err = 'OCR 실패: ' + e.message; }
      }
      if (p) { const score = scoreOf(p); if (!best || score > best.score) best = { p, score }; }
    }
    if (best && best.score > 2) { ST.design = fromParsed(best.p, analyze().total); ST.s2.checked = false; st.textContent = `인식 완료 — ${Object.keys(best.p.values).length}개 항목, 타입 ${best.p.types.length}개. 아래 표에서 숫자를 확인하세요.`; }
    else { st.textContent = '설계개요 숫자를 찾지 못했습니다. 생성기로 산출한 뒤 표에 직접 입력하세요.'; if (!ST.design) try { ST.design = generate(); ST.design.source = '직접 입력(생성기 초안)'; } catch (e) { /* STEP1 미완 */ } }
  } catch (e) { st.textContent = '파일 처리 오류: ' + e.message; }
  render();
}
async function act(a, btn) {
  if (a === 'next') {
    if (ST.step === 1) { if (!ST.consent) return alertBox('데이터 전송에 동의해야 진행할 수 있습니다.'); if (!(analyze().total > 0 && analyze().main)) return alertBox('면적과 용도지역을 입력(또는 조회)하세요.'); collect('step1'); }
    if (ST.step === 2) { if (!ST.design) return alertBox('설계개요를 산출하거나 파일을 올리세요.'); if (!ST.s2.checked) return alertBox('설계개요 숫자를 확인하고 체크해 주세요.'); }
    if (ST.step === 3) { const s = ST.s3; if (!nv(s.land) || !nv(s.sale) || !nv(s.cost) || !(allPriced(s) || nv(s.mkt))) return alertBox('토지 매입가, 타입별 분양가(또는 시세), 분양기간, 공사비는 필수입니다.'); collect('step3'); }
    ST.step++; render(); return;
  }
  if (a === 'prev') { ST.step--; render(); return; }
  if (a === 'vfill') { await fillFromVworld(btn); return; }
  if (a === 'nload') { const id = $('#nsel').value; if (!id) return alertBox('불러올 공고를 고르세요.'); const keep = ST.consent; btn.disabled = true; await loadNotice(id); ST.consent = keep; try { history.replaceState(null, '', '?notice=' + encodeURIComponent(id)); } catch (e) { /* 무시 */ } return; }
  if (a === 'addrow') { ST.parcels.push({ q: '직접 입력', area: null, zone: '', price: null, uses: [] }); render(); return; }
  if (a === 'savekey') { try { localStorage.setItem('diy_vworld', $('#vkey').value.trim()); } catch (e) { /* 무시 */ } render(); return; }
  if (a === 'lookup') {
    const qs = $('#jibun').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!qs.length) return alertBox('지번을 입력하세요.');
    btn.disabled = true; btn.textContent = '조회 중…';
    const keep = ST.parcels.filter(p => !p.pnu && p.q === '직접 입력');
    const out = [];
    for (const q of qs) {
      if (!vkey()) { out.push({ q, area: null, zone: '', price: null, uses: [], err: '브이월드 인증키가 없어 조회하지 못했습니다 — 면적·용도지역을 직접 입력하세요' }); continue; }
      try { out.push(await lookupParcel(q)); } catch (e) { out.push({ q, area: null, zone: '', price: null, uses: [], err: '조회 실패: ' + e.message + ' — 직접 입력하세요' }); }
    }
    ST.parcels = [...out, ...keep]; ST.s1.sido = qs[0].split(/\s/)[0];
    render(); return;
  }
  if (a === 'gen') { try { ST.design = generate(); ST.s2.checked = false; } catch (e) { return alertBox(e.message); } render(); return; }
  if (a === 'addtype') { ST.design.types.push({ name: '', use: ST.design.use, ex: null, sup: null, con: null, count: null }); render(); return; }
  if (a === 'dl') { btn.disabled = true; btn.textContent = '엑셀 만드는 중…'; try { await download(); } catch (e) { alertBox('엑셀 생성 오류: ' + e.message); } btn.disabled = false; btn.textContent = '사업성 엑셀 다운로드'; return; }
  if (a === 'save') {
    const s = JSON.stringify({ ...ST, files: ST.files.map(f => ({ name: f.name, size: f.size, kind: f.kind })), result: null }, null, 1);
    const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([s], { type: 'application/json' })); el.download = `${ST.title || '사업성DIY'}_작업.json`; el.click(); return;
  }
}
function alertBox(msg) { const b = $('#toast'); b.textContent = msg; b.classList.add('on'); clearTimeout(alertBox.t); alertBox.t = setTimeout(() => b.classList.remove('on'), 3500); }
$('#load').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const o = JSON.parse(await f.text()); Object.assign(ST, o, { files: [], result: null, step: 1 });
    if (ST.s3.priceMode === 'unit') { const ts = ((ST.design || {}).types || []).filter(t => nv(t.count) > 0), sp = ts.reduce((a, t) => a + (nv(t.sup) || nv(t.ex)) * nv(t.count), 0) * PY, n = ts.reduce((a, t) => a + nv(t.count), 0);
      ST.s3.price = nv(ST.s3.price) && sp ? Math.round(nv(ST.s3.price) * 1e4 * n / sp) : null; ST.s3.priceMode = 'py'; }   // 예전 세대당 입력 → 공급평당 환산
    if (nv(ST.s3.price) && ST.design && !Object.keys(ST.s3.prices || {}).length) { ST.s3.prices = {}; typeGroups(ST.design).forEach(g => { ST.s3.prices[g.key] = nv(ST.s3.price); }); }   // 단일 평당가 → 타입별
    render(); } catch (err) { alertBox('불러오기 실패: ' + err.message); }
};
fetch('data/diy_config.json?v=' + Date.now()).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(c => { CFG = Object.assign(CFG, c || {}); render();
  const nid = new URLSearchParams(location.search).get('notice'); if (nid) loadNotice(nid); });
window.__diy = { ST, analyze, generate, specOf, runFs, fromParsed };
})();
