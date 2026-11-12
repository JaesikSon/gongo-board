/* 사업성 DIY — 설계개요 파일 인식 (PDF·엑셀 → 마크다운 → 설계개요 숫자)
 * 브라우저·Node 공용. PDF는 pdf.js, 엑셀은 ExcelJS 를 인자로 받는다. */
(function (root) {
'use strict';

// PDF → 마크다운: 페이지별 텍스트를 같은 줄(y)끼리 묶고, 간격이 벌어진 곳을 표 칸(|)으로 나눈다
async function pdfToMd(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const out = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p), tc = await pg.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }));
    chars += items.reduce((a, i) => a + i.s.length, 0);
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) { const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.35)); if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] }); }
    rows.sort((a, b) => b.y - a.y);
    out.push(`\n## p.${p}\n`);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      const cells = []; let cur = null;
      for (const it of r.items) {
        if (cur && it.x - (cur.x + cur.w) < Math.max(4, it.h * 0.6)) { cur.s += (it.x - (cur.x + cur.w) > it.h * 0.15 ? ' ' : '') + it.s; cur.w = it.x + it.w - cur.x; }
        else { cur = { ...it }; cells.push(cur); }
      }
      out.push(cells.length > 1 ? '| ' + cells.map(c => c.s).join(' | ') + ' |' : cells[0].s);
    }
  }
  return { md: out.join('\n'), pages: doc.numPages, chars };
}

// 엑셀 → 마크다운 (시트별 표)
async function xlsxToMd(ExcelJS, buf) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet(ws => {
    out.push(`\n## ${ws.name}\n`);
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = [];
      for (let ci = 1; ci <= row.cellCount; ci++) {
        const c = row.getCell(ci); let v = c.value;
        if (v && typeof v === 'object') v = v.result != null ? v.result : (v.richText ? v.richText.map(t => t.text).join('') : (v.text || ''));
        if (typeof v === 'number') v = Math.abs(v) < 1 && v !== 0 && c.numFmt && /%/.test(c.numFmt) ? (v * 100).toFixed(2) + '%' : String(Math.round(v * 10000) / 10000);
        vals.push(v == null ? '' : String(v).replace(/\|/g, '/').replace(/\s+/g, ' ').trim());
      }
      while (vals.length && !vals[vals.length - 1]) vals.pop();
      if (vals.some(Boolean)) out.push(vals.length > 1 ? '| ' + vals.join(' | ') + ' |' : vals[0]);
    });
  });
  const md = out.join('\n');
  return { md, pages: wb.worksheets.length, chars: md.length };
}

const num = s => { const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) ? v : null; };
const NUM = '([\\d,]+(?:\\.\\d+)?)';

// 마크다운 → 설계개요 값. 각 값에 인식 근거(원문 줄)를 붙인다
function parseDesignMd(md) {
  const lines = md.split('\n').map(l => l.trim()).filter(Boolean);
  const flat = lines.map(l => l.replace(/\s+/g, '').replace(/\|/g, ''));   // '대 지 면 적 | 3,585.99 ㎡' → '대지면적3,585.99㎡'
  const R = {}, src = {};
  const set = (k, v, i) => { if (v != null && R[k] == null) { R[k] = v; src[k] = lines[i]; } };
  const find = (re, k, pick = m => num(m[1])) => { for (let i = 0; i < flat.length; i++) { const m = flat[i].match(re); if (m) { set(k, pick(m), i); if (R[k] != null) return; } } };
  const lastOf = (s, unit) => { const a = [...s.matchAll(new RegExp(NUM + unit, 'g'))].map(m => num(m[1])); return a.length ? a[a.length - 1] : null; };

  find(new RegExp('공부상면적' + NUM + '㎡'), '공부상면적');
  find(new RegExp('(?:도로)?기부채납' + NUM + '㎡'), '기부채납');
  find(new RegExp('대지면적' + NUM + '(?:㎡|m2|m²)'), '대지');
  find(new RegExp('건축면적' + NUM + '(?:㎡|m2|m²)'), '건축면적');
  find(new RegExp('건폐율' + NUM + '%'), '건폐율');
  find(/(?:건축)?규모지하(\d+)층[,·/]?지상(\d+)층/, '지하층', m => +m[1]);
  find(/(?:건축)?규모지하(\d+)층[,·/]?지상(\d+)층/, '지상층', m => +m[2]);
  for (let i = 0; i < flat.length; i++) {
    const f = flat[i];
    const after = (re) => { const m = f.match(re); return m ? f.slice(m.index + m[0].length).replace(/\(.*$/, '') : null; };
    let t;
    if (R.지상 == null && (t = after(/지상(층면적|연면적)/))) set('지상', lastOf(t, '㎡'), i);
    if (R.지하 == null && (t = after(/지하(층면적|연면적)/))) set('지하', lastOf(t, '㎡'), i);
    if (R.연면적 == null && (t = after(/^(전체연면적|연면적합계|연면적계)/))) set('연면적', lastOf(t, '㎡'), i);
    if (/^용적률산정(연)?면적/.test(f) && R.용적면적 == null) set('용적면적', lastOf(f.replace(/\(.*$/, ''), '㎡'), i);
    if (/^용적률[\d]/.test(f) && R.용적률 == null) set('용적률', lastOf(f.replace(/\(.*$/, ''), '%'), i);
    if (/합계[\d,]+대법정대수/.test(f) && R.주차 == null) set('주차', num(f.match(/합계([\d,]+)대/)[1]), i);
  }
  find(/주차대수(?:합계)?([\d,]+)대/, '주차');
  // 세대·실 수: '합계 0 세대 | 합계 280 실' → 합산
  for (let i = 0; i < flat.length; i++) {
    const ms = [...flat[i].matchAll(/합계([\d,]+)(세대|실|호)/g)];
    if (ms.length) { const n = ms.reduce((a, m) => a + num(m[1]), 0); if (n > 0) { set('세대', n, i); break; } }
  }
  // 타입별 면적표: 'xx TYPE | 수 | 비율 | 전용률 | 전용 | … | 공급 | … | 계약'
  const types = []; let ctx = '공동주택';
  lines.forEach((l, i) => {
    if (/오피스텔/.test(flat[i]) && /면적개요|실별|호실/.test(flat[i])) ctx = '오피스텔';
    else if (/(세대별|주택).*면적개요/.test(flat[i])) ctx = /도시형/.test(flat[i]) ? '도시형생활주택' : '공동주택';
    const cells = l.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length < 5) return;
    const m = cells[0].match(/^([0-9A-Za-z\-.]+)\s*(TYPE|타입|형|㎡형)$/i) || cells[0].match(/^(\d{2,3}[A-Za-z]?)$/);
    if (!m) return;
    const ns = cells.slice(1).filter(c => !/%$/.test(c)).map(num).filter(v => v != null);
    if (ns.length < 3) return;
    const cnt = ns[0]; if (!(cnt >= 1 && Number.isInteger(cnt))) return;
    const rest = ns.slice(1), ex = rest[0], con = rest[rest.length - 1];
    const mid = rest.slice(1, -1).filter(v => v > ex && v < con);
    const sup = mid.length ? Math.max(...mid) : null;
    if (!(ex > 10 && con >= ex)) return;
    types.push({ name: m[1] + (/^\d/.test(m[1]) ? '' : ''), use: ctx, ex, sup, con, count: cnt, src: l });
  });
  // 근생·업무 면적: '근린생활시설 | 1층 | 425 | 75 | 500 | 150 | 126 | 776'
  let comm = null;
  lines.forEach((l, i) => {
    if (comm || !/근린생활시설|근생/.test(flat[i])) return;
    const ns = l.split('|').map(s => s.trim()).filter(s => /^[\d,]+(\.\d+)?$/.test(s)).map(num);
    if (ns.length >= 3 && ns[0] > 0) {
      const ex = ns[0], con = ns[ns.length - 1];
      const sup = ns.find((v, j) => j > 0 && Math.abs(v - (ex + ns[1])) < 0.6) || ns[2];
      comm = { ex, sup, con, src: l };
    }
  });
  return { values: R, src, types, comm };
}

// ── 토지조서·IM → 필지 목록 ────────────────────────────────────────────
const JIMOK = { 대: '대', 전: '전', 답: '답', 임: '임야', 임야: '임야', 도: '도로', 도로: '도로', 잡: '잡종지', 잡종지: '잡종지', 구: '구거', 구거: '구거', 천: '하천', 하천: '하천',
  공: '공원', 공원: '공원', 학: '학교용지', 학교용지: '학교용지', 주: '주차장', 주차장: '주차장', 창: '창고용지', 창고용지: '창고용지', 장: '공장용지', 공장용지: '공장용지',
  종: '종교용지', 종교용지: '종교용지', 유: '유지', 유지: '유지', 철: '철도용지', 철도용지: '철도용지', 제: '제방', 제방: '제방', 수: '수도용지', 수도용지: '수도용지',
  과: '과수원', 과수원: '과수원', 목: '목장용지', 목장용지: '목장용지', 광: '광천지', 염: '염전', 양: '양어장', 체: '체육용지', 체육용지: '체육용지', 사: '사적지', 묘: '묘지', 묘지: '묘지', 원: '유원지', 유원지: '유원지', 주유소용지: '주유소용지' };
const ZONE_RX = /(제[12]종전용주거|제[123]종일반주거|[123]종일반주거|[12]종일주|[123]종일주|준주거|중심상업|일반상업|근린상업|유통상업|전용공업|일반공업|준공업|보전녹지|생산녹지|자연녹지|보전관리|생산관리|계획관리|농림|자연환경보전)(지역)?/;
const ZONE_FULL = z => { if (!z) return ''; let t = z.replace(/지역$/, ''); t = t.replace(/^([123])종일(반)?주(거)?$/, '제$1종일반주거').replace(/^([12])종전용주거$/, '제$1종전용주거'); return t + '지역'; };
const JIBUN_RX = /^(산\s*)?(\d{1,5})(?:-(\d{1,5}))?\s*(?:번지)?\s*([가-힣]{0,4})$/;
const SIDO_RX = /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)(\s+[가-힣]+(?:시|군|구))?(\s+[가-힣]+구)?/;
function parseParcelsMd(md) {
  const SHORT = { 서울시: '서울특별시', 서울: '서울특별시', 부산시: '부산광역시', 대구시: '대구광역시', 인천시: '인천광역시', 광주시: '광주광역시', 대전시: '대전광역시', 울산시: '울산광역시', 세종시: '세종특별자치시' };
  const m2 = md.match(/(서울특별시|서울시|부산광역시|부산시|대구광역시|대구시|인천광역시|인천시|광주광역시|대전광역시|대전시|울산광역시|울산시|세종특별자치시|세종시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도)\s*([가-힣]+(?:시|군|구))?(?:\s+([가-힣]+구))?/);
  const sido = m2 ? [SHORT[m2[1]] || m2[1], m2[2], m2[3]].filter(Boolean).join(' ') : '';
  const sections = md.split(/\n(?=## )/);
  const results = [];
  for (const sec of sections) {
    const title = (sec.match(/^## (.+)/) || ['', '문서'])[1].trim();
    const rows = sec.split('\n').map(l => l.trim()).filter(l => l.startsWith('|')).map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    // 머리글 찾기
    let H = null, hi = -1;
    rows.forEach((r, i) => {
      if (H) return;
      const idx = {}; r.forEach((c, j) => { const t = c.replace(/\s/g, '');
        if (idx.jibun == null && /^(지번|번지|소재지번)$/.test(t)) idx.jibun = j;
        if (idx.addr == null && /^(소재지|소재|위치|행정동|법정동|주소|소재지주소)$/.test(t)) idx.addr = j;
        if (idx.jimok == null && /^지목/.test(t)) idx.jimok = j;
        if (/편입면적/.test(t)) idx.inc = j; else if (idx.area == null && /^(면적|대장면적|공부면적|토지면적|지적면적)/.test(t)) idx.area = j;
        if (idx.zone == null && /용도지역/.test(t)) idx.zone = j;
        if (idx.price == null && /공시지가/.test(t)) idx.price = j;
        if (idx.pnu == null && /^PNU$/i.test(t)) idx.pnu = j; });
      if (idx.jibun != null && (idx.area != null || idx.inc != null || idx.jimok != null)) { H = idx; hi = i; }
    });
    const parcels = [];
    const numOf = c => { const t = String(c || '').replace(/,/g, '').replace(/㎡|원/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(t) ? +t : null; };
    if (H) {
      for (const r of rows.slice(hi + 1)) {
        const jb = (r[H.jibun] || '').replace(/\s+/g, ' ').trim(), m = jb.match(JIBUN_RX);
        if (!m) continue;
        const san = !!m[1] || /^산/.test(jb), bon = +m[2], bu = m[3] ? +m[3] : 0;
        const jm = (H.jimok != null && JIMOK[(r[H.jimok] || '').trim()]) || JIMOK[m[4]] || '';
        const area = H.inc != null && numOf(r[H.inc]) != null ? numOf(r[H.inc]) : (H.area != null ? numOf(r[H.area]) : null);
        const zr = H.zone != null ? (r[H.zone] || '').match(ZONE_RX) : null;
        const addr = H.addr != null ? (r[H.addr] || '').replace(/\s+/g, ' ').trim() : '';
        let pnu = '';
        if (H.pnu != null) { const d = String(r[H.pnu] || '').replace(/\D/g, ''); if (d.length >= 19) pnu = d.slice(0, 19); else if (d.length >= 10) pnu = d.slice(0, 10) + (san ? '2' : '1') + String(bon).padStart(4, '0') + String(bu).padStart(4, '0'); }
        const jibun = `${san ? '산' : ''}${bon}${bu ? '-' + bu : ''}`;
        parcels.push({ jibun, addr: (addr && !/[가-힣]+(동|리|가)\d*$/.test(addr) && sido && !addr.includes(sido.split(' ')[0]) ? sido + ' ' : '') + addr, jimok: jm, area, zone: zr ? ZONE_FULL(zr[1]) : '', price: H.price != null ? numOf(r[H.price]) : null, pnu });
      }
    } else {
      // 머리글 없는 표·문장: '○○동 11-22' 형태 + 숫자
      let lastDong = '';
      for (const r of rows) {
        const line = r.join(' ');
        const am = line.match(/([가-힣]+(?:동|리|가)\d?)\s*(산\s*)?(\d{1,5})(?:-(\d{1,5}))?\s*(?:번지)?/);
        if (!am) continue;
        lastDong = am[1];
        const nums = r.filter(c => /[.,]\d|㎡/.test(c)).map(numOf).filter(v => v != null && v > 0 && v !== +am[3] && v !== +am[4]);
        const zr = line.match(ZONE_RX), jm = r.map(c => JIMOK[c.trim()]).find(Boolean) || '';
        parcels.push({ jibun: `${am[2] ? '산' : ''}${+am[3]}${am[4] ? '-' + +am[4] : ''}`, addr: (sido ? sido + ' ' : '') + lastDong, jimok: jm, area: nums.find(v => v >= 1 && v < 1e7) || null, zone: zr ? ZONE_FULL(zr[1]) : '', price: null, pnu: '' });
      }
    }
    // 중복 제거
    const seen = new Set(), uniq = parcels.filter(p => { const k = (p.pnu || p.addr + ' ' + p.jibun); if (seen.has(k)) return false; seen.add(k); return true; });
    if (uniq.length) results.push({ title, header: !!H, parcels: uniq, area: uniq.reduce((a, p) => a + (p.area || 0), 0) });
  }
  // 문장 속 사업부지 요약(예: '서울시 용산구 문배동 11-22번지 일원 … 4,040.6㎡')
  const site = (md.match(/([가-힣]+(?:시|도)\s+[가-힣]+(?:구|시|군)\s+[가-힣]+(?:동|리|가)\d?\s*\d+(?:-\d+)?\s*(?:번지)?\s*일원)/) || [''])[0];
  return { sido, sections: results.sort((a, b) => b.parcels.length - a.parcels.length), site };
}

const api = { pdfToMd, xlsxToMd, parseDesignMd, parseParcelsMd };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.diyParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
