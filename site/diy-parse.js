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
      row.eachCell({ includeEmpty: false }, c => {
        let v = c.value; if (v && typeof v === 'object') v = v.result != null ? v.result : (v.richText ? v.richText.map(t => t.text).join('') : (v.text || ''));
        if (typeof v === 'number') v = Math.abs(v) < 1 && v !== 0 && c.numFmt && /%/.test(c.numFmt) ? (v * 100).toFixed(2) + '%' : String(Math.round(v * 100) / 100);
        if (v != null && String(v).trim()) vals.push(String(v).trim());
      });
      if (vals.length) out.push(vals.length > 1 ? '| ' + vals.join(' | ') + ' |' : vals[0]);
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

const api = { pdfToMd, xlsxToMd, parseDesignMd };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.diyParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
