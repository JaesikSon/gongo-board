// 사업성 분석(F/S) 엑셀 — data/fs/index.json 의 가정값으로 브라우저에서 바로 만든다 (단위: 천원, ㎡, 평=㎡×0.3025)
(function(){
const PY = 0.3025;
const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

function design(a){
  const sup = a.mix.reduce((s,[e,n]) => s + n*e*a['공급전용비'], 0);
  const above = sup + a['세대수']*a['부대복리_세대당'];
  const park = Math.ceil(a['세대수']*a['주차_계획'] - 1e-9);
  const under = park*a['주차_대당면적'] + a['지하_기타'];
  const floors = Math.ceil(under/(a['대지']*a['지하_건폐']) - 1e-9);
  const unit = floors <= 4 ? a['공사비_4층이하'] : a['공사비_4층초과'];
  const gfa = above + under;
  return {공급:sup, 지상:above, 주차:park, 지하:under, 지하층수:floors, 공사단가:unit, 연면적:gfa, 공급평:sup*PY, 연면적평:gfa*PY};
}
function run(a, L){
  const d = design(a), con = d.연면적평*d.공사단가;
  const dh = a['지역난방_m2']*d.지상;
  const tj = L*(1 + a['법정이자율']*a['택지이자기간'] + a['상한_취득세'] + a['재산세율'] + a['택지가산률']) + con*(a['말뚝률'] + a['흙막이률']) + dh;
  const bh = d.지상*a['기본형_지상'] + d.지하*a['기본형_지상']*a['기본형_지하비'];
  const cap = (tj + bh*(1 + a['건축가산률']))/d.공급평, mkt = a['시세']*a['시세반영률'], price = Math.min(cap, mkt);
  const sales = d.공급평*price, rev = sales + a['세대수']*a['발코니'], pf = rev*a['PF비율'];
  const ind = d.연면적평*a['간접_평당'] + d.지상*a['표준건축비']*a['미술률'] + a['용역비'];
  const cost = L*(1 + a['취득세등기'] + a['할부이자부담'] + a['재산세율']) + con + ind + dh + a['기타부담금']
    + rev*(a['광고률'] + a['분양보증률']) + a.MH + a['세대수']*a['분양수수료'] + pf*a['PF보증률']*(a['공기']+3)/12
    + (con + ind)*a['보존등기률'] + a['신탁'] + a['관리비_월']*a['사업기간'] + a['세대수']*a['입주관리'] + rev*a['예비비률']
    + pf*(a['PF금리']*a['공기']/12*a['PF평균잔액'] + a['PF수수료']) + sales*a['중도금비율']*a['후불금리']*a['후불기간'] + L*a['BL대상']*a['BL금리']*a['BL기간'];
  return {cap, mkt, price, rev, cost, margin: (rev - cost)/rev};
}
function solve(a, target){
  let lo = -5e8, hi = 5e8;
  if (run(a, lo).margin < target) return null;
  for (let i = 0; i < 200; i++){ const m = (lo+hi)/2; if (run(a, m).margin >= target) lo = m; else hi = m; }
  return lo;
}

const F = '맑은 고딕', NAVY='FF1F3864', LB='FFDAE3F3', GR='FFF2F2F2', OR='FFC55A11', YEL='FFFFF2CC', GO='FFE2EFDA';
const thin = {style:'thin', color:{argb:'FF8C8C8C'}}, BOX = {top:thin, left:thin, bottom:thin, right:thin};
function st(c, o = {}){
  c.font = {name:F, bold:!!o.b, size:o.sz || 10, color:{argb:o.color || 'FF262626'}};
  c.border = BOX; c.alignment = {horizontal:o.al || 'left', vertical:'middle', wrapText:true};
  if (o.fill) c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:o.fill}};
  if (o.fmt) c.numFmt = o.fmt;
}
const title = (ws, t, sz = 13) => { const c = ws.getCell('A1'); c.value = t; c.font = {name:F, bold:true, size:sz}; };
const col = n => { let s = ''; n++; while (n > 0){ const m = (n-1)%26; s = String.fromCharCode(65+m) + s; n = Math.floor((n-1)/26); } return s; };

function build(ExcelJS, S){
  const A = S.A, wb = new ExcelJS.Workbook();
  wb.calcProperties = {fullCalcOnLoad: true};
  const sum = wb.addWorksheet('요약'), t = wb.addWorksheet('토지가검토'), g = wb.addWorksheet('가정'), s = wb.addWorksheet('설계개요'), m = wb.addWorksheet('민감도');
  [sum,t,g,s,m].forEach(w => w.pageSetup = {orientation:'landscape', paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0});
  const name = (n, ref) => wb.definedNames.add(ref, n);

  // 가정
  title(g, `가정 — ${S.title} (단위: 천원, ㎡ / 노란 칸 수정 시 전체 재계산)`);
  ['항목','값','단위','근거·출처'].forEach((h,i) => { g.getCell(3,i+1).value = h; st(g.getCell(3,i+1), {b:true, fill:NAVY, color:'FFFFFFFF', al:'center'}); });
  let r = 4;
  for (const row of S.inputs){
    if (row.length === 1){ g.getCell(r,1).value = row[0]; for (let j=1;j<=4;j++) st(g.getCell(r,j), {b:j===1, fill:LB}); r++; continue; }
    const [lab, key, val, unit, src] = row;
    g.getCell(r,1).value = lab; st(g.getCell(r,1));
    const c = g.getCell(r,2); c.value = A[key] ?? val; st(c, {fill:YEL, color:'FF0000FF', al:'right', fmt: unit === '%' ? '0.00%' : '#,##0.####'});
    g.getCell(r,3).value = unit; st(g.getCell(r,3), {al:'center'});
    g.getCell(r,4).value = src; st(g.getCell(r,4));
    name(key, `'가정'!$B$${r}`); r++;
  }
  g.columns = [{width:28},{width:16},{width:10},{width:70}];

  // 설계개요
  title(s, '개략 설계개요 (지구단위계획 기준 자동 산정)');
  ['타입(전용㎡)','세대수','공급면적(㎡)','공급면적 합계(㎡)'].forEach((h,i) => { s.getCell(3,i+1).value = h; st(s.getCell(3,i+1), {b:true, fill:NAVY, color:'FFFFFFFF', al:'center'}); });
  A.mix.forEach(([e,n], k) => {
    const rr = 4+k;
    s.getCell(rr,1).value = e; st(s.getCell(rr,1), {fill:YEL, color:'FF0000FF', al:'center'});
    s.getCell(rr,2).value = n; st(s.getCell(rr,2), {fill:YEL, color:'FF0000FF', al:'center', fmt:'#,##0'});
    s.getCell(rr,3).value = {formula:`A${rr}*공급전용비`}; st(s.getCell(rr,3), {al:'right', fmt:'#,##0.0'});
    s.getCell(rr,4).value = {formula:`B${rr}*C${rr}`}; st(s.getCell(rr,4), {al:'right', fmt:'#,##0'});
  });
  const tr = 4 + A.mix.length;
  s.getCell(tr,1).value = '합계'; s.getCell(tr,2).value = {formula:`SUM(B4:B${tr-1})`}; s.getCell(tr,4).value = {formula:`SUM(D4:D${tr-1})`};
  for (let j=1;j<=4;j++) st(s.getCell(tr,j), {b:true, fill:GR, al: j===4 ? 'right' : 'center', fmt:'#,##0'});
  const items = [
    ['공급면적(㎡)', `D${tr}`, '#,##0', '공급면적'],
    ['지상 연면적(㎡)', `D${tr}+B${tr}*부대복리_세대당`, '#,##0', '지상면적'],
    ['용적률', `B${tr+3}/대지`, '0.0%'],
    ['주차대수(대)', `ROUNDUP(B${tr}*주차_계획,0)`, '#,##0'],
    ['지하 연면적(㎡)', `B${tr+5}*주차_대당면적+지하_기타`, '#,##0', '지하면적'],
    ['지하층수', `ROUNDUP(B${tr+6}/(대지*지하_건폐),0)`, '0"층"', '지하층수'],
    ['적용 공사비(천원/평)', `IF(B${tr+7}<=4,공사비_4층이하,공사비_4층초과)`, '#,##0', '공사단가'],
    ['연면적(㎡)', `B${tr+3}+B${tr+6}`, '#,##0'],
    ['연면적(평)', `B${tr+9}*0.3025`, '#,##0.0', '연면적평'],
    ['공급면적(평)', `B${tr+2}*0.3025`, '#,##0.0', '공급평'],
    ['세대수 검증', `IF(B${tr}<=세대수,"OK (≤"&세대수&")","초과")`, '@'],
  ];
  items.forEach(([lab, f, fmt, nm], k) => {
    const rr = tr+2+k;
    s.getCell(rr,1).value = lab; st(s.getCell(rr,1), {b:true, fill:LB});
    s.getCell(rr,2).value = {formula:f}; st(s.getCell(rr,2), {al:'right', fmt});
    if (nm) name(nm, `'설계개요'!$B$${rr}`);
  });
  s.columns = [{width:24},{width:16},{width:16},{width:16}];

  // 토지가검토
  title(t, `토지가(입찰가)별 분양가·사업수지 — ${S.title} (단위: 천원)`);
  const cols = [0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3].map(p => [`공급가 ${Math.round(p*100)}%`, {formula:`공급가격*${p}`}]);
  const be = solve(A, 0), mx = solve(A, A['목표이익률']);
  if (be != null) cols.unshift(['손익분기', Math.round(be)]);
  if (mx != null) cols.unshift(['목표이익 최대가', Math.round(mx)]);
  const L = [['구분'],['토지가(입찰가)','L'],['공급가 대비','=X4/공급가격'],['■ 분양가상한제'],
    ['택지비 원금','=X4'],['법정택지이자','=X4*법정이자율*택지이자기간'],['취등록세','=X4*상한_취득세'],['재산세','=X4*재산세율'],
    ['말뚝박기','=X37*말뚝률'],['흙막이·차수벽','=X37*흙막이률'],['지역난방부담금','=지역난방_m2*지상면적'],['택지비 가산(6%)','=X4*택지가산률'],
    ['택지비 계','=SUM(X7:X14)'],['기본형건축비(지상)','=지상면적*기본형_지상'],['기본형건축비(지하)','=지하면적*기본형_지상*기본형_지하비'],
    ['건축비 가산비','=(X16+X17)*건축가산률'],['상한금액','=X15+X16+X17+X18'],
    ['상한 분양가(천원/평)','=X19/공급평'],['시장 수용가(천원/평)','=시세*시세반영률'],['적용 분양가(천원/평)','=MIN(X20,X21)'],
    ['분양가 제약요인','=IF(X20<=X21,"상한제","시장")'],
    ['■ 수입'],['분양매출','=공급평*X22'],['발코니 확장','=세대수*발코니'],['수입 계','=X25+X26'],
    ['■ 지출'],['토지비','=X4'],['취득세·등기','=X4*취득세등기'],['토지 할부이자','=X4*할부이자부담'],['재산세','=X4*재산세율'],
    ['토지비 소계','=SUM(X29:X32)'],[''],[''],[''],
    ['공사비','=연면적평*공사단가'],['간접비·용역','=연면적평*간접_평당+지상면적*표준건축비*미술률+용역비'],
    ['분담금','=지역난방_m2*지상면적+기타부담금'],
    ['분양관련','=X27*(광고률+분양보증률)+MH+세대수*분양수수료+X27*PF비율*PF보증률*(공기+3)/12'],
    ['기타(등기·관리·예비비)','=(X37+X38)*보존등기률+신탁+관리비_월*사업기간+세대수*입주관리+X27*예비비률'],
    ['금융비','=X27*PF비율*(PF금리*공기/12*PF평균잔액+PF수수료)+X25*중도금비율*후불금리*후불기간+X4*BL대상*BL금리*BL기간'],
    ['지출 계','=X33+SUM(X37:X42)'],
    ['■ 결과'],['사업이익','=X27-X43'],['이익률(매출 대비)','=X45/X27'],['판정','=IF(X46>=목표이익률,"Go","No-go")']];
  const BOLD = new Set(['상한금액','적용 분양가(천원/평)','수입 계','지출 계','사업이익','이익률(매출 대비)','판정','토지비 소계','택지비 계','상한 분양가(천원/평)']);
  const HL = new Set(['적용 분양가(천원/평)','사업이익','이익률(매출 대비)','판정']);
  L.forEach(([lab, f], i) => {
    const rr = 3+i, sec = f === undefined && lab.startsWith('■');
    t.getCell(rr,1).value = lab; st(t.getCell(rr,1), {b: sec || BOLD.has(lab), fill: sec ? LB : rr === 3 ? GR : null});
    if (f === undefined && lab === '' ) t.getRow(rr).hidden = true;
    cols.forEach(([cn, lv], j) => {
      const c = t.getCell(rr, 2+j), cl = col(1+j);
      if (rr === 3){ c.value = cn; st(c, {b:true, fill:NAVY, color:'FFFFFFFF', al:'center'}); return; }
      if (f === undefined){ st(c, {fill: sec ? LB : null}); return; }
      c.value = f === 'L' ? lv : {formula: f.slice(1).replace(/X/g, cl)};
      st(c, {b: BOLD.has(lab) && lab !== '상한금액' && lab !== '수입 계' && lab !== '지출 계' && lab !== '토지비 소계' && lab !== '택지비 계' ? true : HL.has(lab),
             fill: rr === 4 ? YEL : null, color: HL.has(lab) ? OR : 'FF262626', al:'right',
             fmt: (lab === '공급가 대비' || lab === '이익률(매출 대비)') ? '0.0%' : '#,##0'});
    });
  });
  t.getColumn(1).width = 24; cols.forEach((_, j) => t.getColumn(2+j).width = 14);
  t.views = [{state:'frozen', xSplit:1, ySplit:3}];

  // 민감도 (엔진 계산값)
  title(m, `민감도 — 공급가격 기준 이익률 (엔진 계산값, 가정 변경 시 재계산 필요)`);
  const grid = (r0, head, xs, ys, setx, sety, fx, fy) => {
    m.getCell(r0,1).value = head; st(m.getCell(r0,1), {b:true, fill:NAVY, color:'FFFFFFFF', al:'center'});
    xs.forEach((x, j) => { m.getCell(r0, 2+j).value = x; st(m.getCell(r0, 2+j), {b:true, fill:NAVY, color:'FFFFFFFF', al:'center', fmt:fx}); });
    ys.forEach((y, i) => {
      m.getCell(r0+1+i, 1).value = y; st(m.getCell(r0+1+i, 1), {b:true, fill:LB, al:'center', fmt:fy});
      xs.forEach((x, j) => {
        const b = Object.assign({}, A); setx(b, x); sety(b, y);
        const v = run(b, A['공급가격']).margin, ok = v >= A['목표이익률'];
        const c = m.getCell(r0+1+i, 2+j); c.value = v; st(c, {b:ok, fill: ok ? GO : null, al:'center', fmt:'0.0%'});
      });
    });
  };
  const costs = [5500,6000,6500,7000,7500,8000];
  const setCost = (b, v) => { b['공사비_4층이하'] = v; b['공사비_4층초과'] = v; };
  grid(3, '공사비(천원/평) ＼ 인근 시세(천원/평)', [17000,18000,19500,21000,23000], costs, (b,x) => b['시세'] = x, setCost, '#,##0', '#,##0');
  grid(12, '건축비 가산비율 ＼ 공사비(천원/평)', costs, [0.30,0.38,0.45,0.50,0.60], setCost, (b,y) => b['건축가산률'] = y, '#,##0', '0%');
  m.getColumn(1).width = 34; for (let j = 2; j <= 7; j++) m.getColumn(j).width = 12;

  // 요약
  title(sum, `${S.title} — 토지가 역산 F/S 요약 (${S.date})`, 14);
  sum.getCell('A2').value = '단위: 억원·만원/평(공급면적) / 상세 수식은 토지가검토·가정 시트'; sum.getCell('A2').font = {name:F, size:9, color:{argb:'FF595959'}};
  S.summary.forEach(([k, v, c], i) => {
    const rr = 4+i;
    sum.getCell(rr,1).value = k; st(sum.getCell(rr,1), {b:true, fill:LB, al:'center'});
    sum.getCell(rr,2).value = v; st(sum.getCell(rr,2), {b:!!c, color: c ? 'FF' + c : 'FF262626'});
    sum.getRow(rr).height = v.length > 60 ? 34 : 22;
  });
  const sr = 4 + S.summary.length + 1;
  sum.getCell(sr,1).value = '출처'; sum.getCell(sr,1).font = {name:F, bold:true, size:9};
  (S.sources || []).forEach((x, j) => { const c = sum.getCell(sr+1+j, 1); c.value = '· ' + x; c.font = {name:F, size:9, color:{argb:'FF595959'}}; });
  sum.columns = [{width:24},{width:110}];
  return wb;
}

async function exportFs(id){
  const FS = window.FS || {}; let S = FS[id]; if (typeof S === 'string') S = FS[S]; if (!S) throw new Error('분석 자료가 없습니다');
  const ExcelJS = await window.fsLoadLib(EXCELJS, 'ExcelJS');
  const wb = build(ExcelJS, S);
  const buf = await wb.xlsx.writeBuffer();
  window.fsDownload(new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), S.name || 'FS.xlsx');
}
window.fsEngine = {design, run, solve, build};
window.exportFs = exportFs;
})();
