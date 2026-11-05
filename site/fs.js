// 택지 투자검토(F/S) — data/fs/index.json 의 입력값으로 엑셀(수식 연동 월별 현금흐름)을 만든다. 단위: 천원, ㎡, 평=㎡×0.3025
(function (root) {
const PY = 0.3025, NM = 96; // 현금흐름 월 수(0~95개월)
const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

// ── 입력값 정의: [키, 항목, 단위, 비고] — 순서대로 '가정' 시트에 놓인다 ─────────────
const KEY_INPUTS = [ // 주요 변경 입력값 (맨 위)
  ['분양기간', '주택 분양기간', '개월', '담당자·회사 판단에 따라 조정'],
  ['분양률', '분양기간 내 분양률', '%', ''],
  ['공사비평당', '평당 공사비(연면적)', '천원/평', '지침: 공동주택 용지 550만원'],
  ['분양가입력', '분양 평당가(직접 입력)', '천원/평', '비우면 MIN(상한제 상한, 시세×85%) 자동 적용'],
  ['BL선순위금리', '브릿지론 선순위 금리', '%', '상봉 샘플'],
  ['BL후순위금리', '브릿지론 후순위 금리', '%', '상봉 샘플'],
  ['PF금리', 'PF 금리', '%', '은평 샘플'],
  ['후불금리', '중도금 후불제 금리', '%', '상봉 샘플'],
  ['인허가기간', '인허가 기간(계약→착공·분양·PF)', '개월', '상봉 샘플 BL 10개월'],
  ['공사기간입력', '공사기간(직접 입력)', '개월', '비우면 지침 자동: 30층 미만 34개월, 30층 이상 34+(층수−29)'],
];
const SECTIONS = [
  ['사업 개요', [
    ['계약일', '토지 매매계약일', '날짜', ''],
    ['공급가격', '토지비(공급가격·입찰가)', '천원', ''],
    ['대지', '대지면적', '㎡', ''],
    ['용적률', '상한 용적률', '%', ''],
    ['연면적배수', '전체 연면적 배수(용적률 대비)', '배', '지침: 대지×상한용적률×150%'],
    ['세대수', '세대수', '세대', ''],
    ['층수', '최고 층수', '층', '공사기간 산정'],
    ['근생비율', '근생(상가) 비율(용적률 면적 대비)', '%', '지구단위계획 근생 비율'],
  ]],
  ['분양가', [
    ['시세', '인근 신축 시세(공급평당)', '천원/평', ''],
    ['시세반영률', '상한제 단지 시세 반영률', '%', '지침 85%'],
    ['상가시세', '인근 상가 시세(평당)', '천원/평', ''],
    ['발코니', '발코니 확장비', '천원/세대', '샘플'],
    ['기본형_지상', '기본형건축비 지상(㎡당)', '천원/㎡', '최신 고시'],
    ['기본형_지하비', '기본형건축비 지하층 단가 비율', '배', '은평 샘플 역산'],
    ['건축가산률', '건축비 가산비 비율', '%', '은평 샘플'],
    ['법정이자율', '법정 택지이자율', '%', '은평 샘플'],
    ['상한_취득세', '상한제 인정 취등록세', '%', ''],
    ['택지가산률', '택지비 가산(택지비 대비)', '%', '은평 샘플 6%'],
    ['말뚝률', '말뚝박기(공사비 대비)', '%', ''],
    ['흙막이률', '흙막이·차수벽(공사비 대비)', '%', ''],
  ]],
  ['토지 대금', [
    ['계약률', '계약금(Equity 투입) 약정비율', '%', '매매계약서'],
    ['할부간격', '중도금 납부 간격', '개월', ''],
    ['할부회차', '중도금·잔금 분할 회차', '회', ''],
    ['할부이자율', '토지 할부이자율', '%', ''],
    ['취득세등기', '취득세·등기', '%', '4.6% + 0.2%'],
    ['재산세율', '재산세(연)', '%', ''],
  ]],
  ['분양 수납', [
    ['계약금비율', '계약금', '%', '상봉 샘플'],
    ['중도금비율', '중도금(6회)', '%', '상봉 샘플'],
    ['잔금비율', '잔금(입주 2개월 50:50)', '%', '상봉 샘플'],
  ]],
  ['기타비 (샘플 기준)', [
    ['인입_평당', '인입비(연면적 평당)', '천원/평', ''],
    ['설계_평당', '설계비(연면적 평당)', '천원/평', ''],
    ['감리_평당', '감리비(연면적 평당)', '천원/평', ''],
    ['표준건축비', '표준건축비(미술장식품)', '천원/㎡', ''],
    ['미술률', '미술장식품 요율', '%', ''],
    ['용역비', '용역비', '천원', ''],
    ['지역난방_m2', '지역난방부담금', '천원/㎡', ''],
    ['기타부담금', '기타부담금(가스·전기)', '천원', '학교·광역교통·상하수도 0'],
    ['광고률', '광고선전비(매출 대비)', '%', ''],
    ['MH', '모델하우스 건립·임대', '천원', ''],
    ['MH운영', '모델하우스 운영(월)', '천원/월', ''],
    ['분양수수료', '분양수수료', '천원/세대', ''],
    ['분양보증률', '분양보증(매출 대비)', '%', ''],
    ['보존등기률', '보존등기(공사비+간접비)', '%', ''],
    ['신탁', '신탁수수료', '천원', ''],
    ['관리비_월', '시행사 관리비(월)', '천원/월', ''],
    ['입주관리', '입주관리비', '천원/세대', ''],
    ['예비비률', '예비비(매출 대비)', '%', ''],
    ['기타비기준', '검산 기준: (토지비+공사비) 대비', '%', '지침 28%'],
  ]],
  ['금융·투자', [
    ['BL선순위비중', '브릿지론 선순위 비중', '%', '상봉 샘플 380/595억'],
    ['BL선순위취급', '선순위 취급수수료', '%', ''],
    ['BL후순위취급', '후순위 취급수수료', '%', ''],
    ['BL자문', '브릿지론 금융자문', '%', ''],
    ['PF비율', 'PF 규모(총매출 대비)', '%', '은평 샘플'],
    ['PF수수료', 'PF 취급수수료', '%', ''],
    ['PF보증률', 'PF 보증료(연)', '%', ''],
    ['최소현금', '최소 유지현금', '천원', '상봉 샘플'],
    ['Equity입력', 'Equity(기본값: 토지비×10%×120%)', '천원', '비우면 기본값'],
    ['목표이익률', '목표 시행이익률', '%', ''],
  ]],
];

// ── 계산 엔진 (엑셀 수식과 동일한 로직, 민감도·BEP 산출용) ─────────────────────────
function derive(a) {
  const d = {};
  d.공기자동 = a.층수 < 30 ? 34 : 34 + a.층수 - 29;
  d.공기 = a.공사기간입력 ? a.공사기간입력 : d.공기자동;
  d.PFm = a.인허가기간;
  d.준공 = d.PFm + d.공기;
  d.용적면적 = a.대지 * a.용적률;
  d.주거평 = d.용적면적 * (1 - a.근생비율) * PY;
  d.상가평 = d.용적면적 * a.근생비율 * PY;
  d.연면적평 = d.용적면적 * a.연면적배수 * PY;
  d.지하면적 = d.용적면적 * (a.연면적배수 - 1);
  d.공사비 = d.연면적평 * a.공사비평당;
  d.BLm = a.할부간격;
  d.BL필요 = d.PFm > d.BLm ? 1 : 0;
  d.BL금리 = a.BL선순위금리 * a.BL선순위비중 + a.BL후순위금리 * (1 - a.BL선순위비중);
  d.BL수수료율 = a.BL선순위취급 * a.BL선순위비중 + a.BL후순위취급 * (1 - a.BL선순위비중) + a.BL자문;
  d.중도금월 = [1, 2, 3, 4, 5, 6].map(k => d.PFm + Math.round(k * d.공기 / 7));
  return d;
}
function capPrice(a, d, L) {
  const tj = L * (1 - a.근생비율) * (1 + a.법정이자율 * a.인허가기간 / 12 + a.상한_취득세 + a.재산세율 + a.택지가산률)
    + d.공사비 * (a.말뚝률 + a.흙막이률) + a.지역난방_m2 * d.용적면적;
  const bh = (d.용적면적 * (1 - a.근생비율) + d.지하면적 * a.기본형_지하비) * a.기본형_지상;
  return (tj + bh * (1 + a.건축가산률)) / d.주거평;
}
function run(a, Lover) {
  const L = Lover == null ? a.공급가격 : Lover, d = derive(a);
  const cap = capPrice(a, d, L), mkt = a.시세 * a.시세반영률;
  const price = a.분양가입력 ? a.분양가입력 : Math.min(cap, mkt);
  const 주거매출 = d.주거평 * price + a.세대수 * a.발코니, 상가매출 = d.상가평 * a.상가시세, 총매출 = 주거매출 + 상가매출;
  const PF = Math.round(총매출 * a.PF비율 / 1e5) * 1e5;
  const 설계 = d.연면적평 * a.설계_평당, 감리 = d.연면적평 * a.감리_평당, 인입 = d.연면적평 * a.인입_평당;
  const 미술 = d.용적면적 * a.표준건축비 * a.미술률, 난방 = a.지역난방_m2 * d.용적면적;
  const 광고 = 총매출 * a.광고률, 보증 = 총매출 * a.분양보증률, 예비 = 총매출 * a.예비비률;
  const 보존 = (d.공사비 + 설계 + 감리 + 인입) * a.보존등기률;
  const inst = L * (1 - a.계약률) / a.할부회차;
  const 선납 = L * a.계약률 + inst * Math.min(a.할부회차, Math.floor((d.PFm - 1) / a.할부간격));
  const out = [], rows = {};
  const R = k => rows[k] || (rows[k] = new Array(NM).fill(0));
  let S = 0, unpaid = 0, mid = 0, blBal = 0, pfBal = 0, cash = 0, accr = 0;
  // 1차: 비금융 유출(BL 규모 산정용)
  const nonfin = new Array(NM).fill(0);
  for (let m = 0; m < NM; m++) {
    const s = (m >= d.PFm && m < d.PFm + a.분양기간) ? a.분양률 / a.분양기간 : 0;
    const k = m - d.PFm, w = (k >= 0 && k < d.공기) ? (Math.cos(Math.PI * k / d.공기) - Math.cos(Math.PI * (k + 1) / d.공기)) / 2 : 0;
    let land = 0;
    if (m === 0) land = L * a.계약률;
    else if (m < d.PFm) land = (m % a.할부간격 === 0 && m / a.할부간격 <= a.할부회차) ? inst : 0;
    else if (m === d.PFm) land = L - 선납;
    const prevUnpaid = unpaid; unpaid = (m === 0 ? L : unpaid) - land;
    const 할부이자 = (m >= 1 && m <= d.PFm) ? prevUnpaid * a.할부이자율 / 12 : 0;
    const v = {
      토지비: land, 토지할부이자: 할부이자,
      취득세등기: m === d.PFm ? L * a.취득세등기 : 0,
      재산세: (m >= 6 && (m - 6) % 12 === 0 && m <= d.준공) ? L * a.재산세율 : 0,
      공사비: d.공사비 * w,
      설계비: 설계 * ((m === 1 ? 0.5 : 0) + (m === d.PFm ? 0.5 : 0)),
      감리비: w > 0 ? 감리 / d.공기 : 0,
      인입미술부담: (m === d.준공 - 1 ? 인입 : 0) + (m === d.준공 ? 미술 + a.기타부담금 : 0),
      용역비: a.용역비 * ((m === 1 ? 0.5 : 0) + (m === d.PFm ? 0.5 : 0)),
      지역난방: m === d.PFm ? 난방 : 0,
      분양관련: (s > 0 ? 광고 / a.분양기간 + a.세대수 * a.분양수수료 * s : 0) + (m === Math.max(d.PFm - 2, 1) ? a.MH : 0)
        + ((m >= d.PFm - 2 && m < d.PFm + a.분양기간) ? a.MH운영 : 0) + (m === d.PFm ? 보증 : 0),
      보존등기신탁: (m === d.준공 ? 보존 : 0) + a.신탁 * ((m === d.PFm ? 0.5 : 0) + (m === d.준공 ? 0.5 : 0)),
      입주관리예비비: (m === d.준공 + 1 ? a.세대수 * a.입주관리 : 0) + 예비 * w,
      관리비: m <= d.준공 + 2 ? a.관리비_월 : 0,
    };
    let t = 0; for (const key in v) { R(key)[m] = v[key]; t += v[key]; }
    nonfin[m] = t; R('s')[m] = s; R('w')[m] = w;
  }
  const BLend = d.BL필요 ? d.BLm : d.PFm;
  let need = 0; for (let m = 0; m < BLend; m++) need += nonfin[m];
  const EqDefault = L * 0.1 * 1.2, EqIn = a.Equity입력 ? a.Equity입력 : EqDefault, Eq = Math.max(EqIn, need);
  let blBase = 0; for (let m = d.BLm; m < d.PFm; m++) blBase += nonfin[m];
  const BL = d.BL필요 ? Math.ceil(blBase / (1 - d.BL금리 * (d.PFm - d.BLm) / 12 - d.BL수수료율) / 1e5 - 1e-9) * 1e5 : 0;
  const future = new Array(NM + 1).fill(0); for (let m = NM - 1; m >= 0; m--) future[m] = future[m + 1] + nonfin[m];
  let minCash = Infinity, 자금부족 = 0;
  for (let m = 0; m < NM; m++) {
    const s = R('s')[m]; S += s;
    const due = d.중도금월.filter(t => t === m).length, past = d.중도금월.filter(t => t < m).length;
    const 계약금 = (주거매출) * a.계약금비율 * s;
    const 중도금 = 주거매출 * (a.중도금비율 / 6) * (due * S + s * past);
    const 잔금 = 주거매출 * a.잔금비율 * 0.5 * ((m === d.준공 + 1 ? 1 : 0) + (m === d.준공 + 2 ? 1 : 0)) * S;
    const 상가 = m === d.준공 + 1 ? 상가매출 : 0;
    const inflow = 계약금 + 중도금 + 잔금 + 상가;
    const eq = m === 0 ? Eq : 0, blIn = (d.BL필요 && m === d.BLm) ? BL : 0, pfIn = m === d.PFm ? PF : 0;
    const blRepay = m === d.PFm ? blBal + blIn : 0;
    const blInt = blBal * d.BL금리 / 12, blFee = (d.BL필요 && m === d.BLm) ? BL * d.BL수수료율 : 0;
    const pfInt = pfBal * a.PF금리 / 12, pfFee = m === d.PFm ? PF * a.PF수수료 + PF * a.PF보증률 * (d.공기 + 3) / 12 : 0;
    accr += m <= d.준공 + 1 ? mid * a.후불금리 / 12 : 0; R('후불이자발생')[m] = m <= d.준공 + 1 ? mid * a.후불금리 / 12 : 0;
    const 후불 = m === d.준공 + 1 ? accr : 0;
    mid = m > d.준공 + 1 ? 0 : mid + 중도금;
    const pre = cash + inflow + eq + blIn + pfIn - nonfin[m] - blRepay - blInt - blFee - pfInt - pfFee - 후불;
    const pfRepay = m > d.PFm ? (m >= d.준공 + 2 ? pfBal : Math.min(pfBal, Math.max(0, pre - a.최소현금 - future[m + 1]))) : 0;
    blBal = blBal + blIn - blRepay; pfBal = pfBal + pfIn - pfRepay; cash = pre - pfRepay;
    Object.entries({계약금, 중도금, 잔금, 상가, BL이자: blInt, BL수수료: blFee, PF이자: pfInt, PF수수료보증: pfFee, 후불이자: 후불, 기말현금: cash})
      .forEach(([k, v]) => R(k)[m] = v);
    minCash = Math.min(minCash, cash); if (cash < 0) 자금부족 = 1;
  }
  const sum = k => R(k).reduce((x, y) => x + y, 0);
  const 금융비 = sum('토지할부이자') + sum('BL이자') + sum('BL수수료') + sum('PF이자') + sum('PF수수료보증') + sum('후불이자');
  const 토지비 = sum('토지비'), 공사비 = sum('공사비');
  const 기타비 = nonfin.reduce((x, y) => x + y, 0) - 토지비 - 공사비 + 금융비 - sum('토지할부이자');
  const 매출 = sum('계약금') + sum('중도금') + sum('잔금') + sum('상가');
  const 이익 = 매출 - 토지비 - 공사비 - 기타비;
  return { cap, mkt, price, 주거매출, 상가매출, 매출, 토지비, 공사비, 기타비, 기타비율: 기타비 / (토지비 + 공사비),
    rows, 이익, 이익률: 이익 / 매출, 상가제외이익: 이익 - sum('상가'), EqDefault, EqNeed: need, Eq, ROE: 이익 / Eq, BL, PF, minCash, 자금부족, d };
}
function solveL(a, target) { // 이익률 target 을 만족하는 최대 토지가 (없으면 null)
  let lo = 0, hi = a.공급가격 * 5;
  if (run(a, lo).이익률 < target) return null;
  if (run(a, hi).이익률 >= target) return hi;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (run(a, m).이익률 >= target) lo = m; else hi = m; }
  return lo;
}

// ── 엑셀 작성 ─────────────────────────────────────────────────────────────
const F = '맑은 고딕', NAVY = 'FF1F3864', LB = 'FFDAE3F3', GR = 'FFF2F2F2', OR = 'FFC55A11', YEL = 'FFFFF2CC', KEY = 'FFFCE4D6', GO = 'FFE2EFDA';
const thin = { style: 'thin', color: { argb: 'FF8C8C8C' } }, BOX = { top: thin, left: thin, bottom: thin, right: thin };
function st(c, o = {}) {
  c.font = { name: F, bold: !!o.b, size: o.sz || 10, color: { argb: o.color || 'FF262626' } };
  c.border = BOX; c.alignment = { horizontal: o.al || 'left', vertical: 'middle', wrapText: o.wrap !== false };
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  if (o.fmt) c.numFmt = o.fmt;
}
const colL = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const fmtOf = u => u === '%' ? '0.00%' : u === '날짜' ? 'yyyy.mm' : '#,##0.####';

function build(ExcelJS, S) {
  const A = S.A, wb = new ExcelJS.Workbook();
  wb.calcProperties = { fullCalcOnLoad: true };
  const sum = wb.addWorksheet('요약'), pl = wb.addWorksheet('사업수지'), cf = wb.addWorksheet('현금흐름'),
    pr = wb.addWorksheet('분양가'), g = wb.addWorksheet('가정'), sn = wb.addWorksheet('민감도');
  [sum, pl, pr, g, sn].forEach(w => w.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
  const name = (n, ref) => wb.definedNames.add(ref, n);
  const T = (ws, t, sz = 13) => { const c = ws.getCell('A1'); c.value = t; c.font = { name: F, bold: true, size: sz }; };

  // 가정
  T(g, `가정 — ${S.title} (단위: 천원 / 노란 칸을 고치면 현금흐름·사업수지 전체가 다시 계산됩니다)`);
  ['항목', '값', '단위', '근거·비고'].forEach((h, i) => { g.getCell(3, i + 1).value = h; st(g.getCell(3, i + 1), { b: true, fill: NAVY, color: 'FFFFFFFF', al: 'center' }); });
  let r = 4;
  const sec = t => { g.getCell(r, 1).value = t; for (let j = 1; j <= 4; j++) st(g.getCell(r, j), { b: true, fill: LB }); r++; };
  const put = ([k, lab, unit, note], fill) => {
    g.getCell(r, 1).value = lab; st(g.getCell(r, 1), { b: fill === KEY });
    const c = g.getCell(r, 2), v = A[k];
    c.value = (unit === '날짜' && v) ? new Date(v + 'T00:00:00Z') : (v === '' || v == null ? null : v);
    st(c, { fill, color: 'FF0000FF', al: 'right', fmt: fmtOf(unit) });
    g.getCell(r, 3).value = unit; st(g.getCell(r, 3), { al: 'center' });
    g.getCell(r, 4).value = (S.notes && S.notes[k]) || note; st(g.getCell(r, 4));
    name(k, `'가정'!$B$${r}`); r++;
  };
  sec('★ 주요 변경 입력값'); KEY_INPUTS.forEach(x => put(x, KEY));
  SECTIONS.forEach(([t, xs]) => { sec(t); xs.forEach(x => put(x, YEL)); });
  sec('자동 산정 (수식)');
  const calc = [
    ['공기자동', '공사기간(지침 자동)', 'IF(층수<30,34,34+층수-29)', '개월'],
    ['공기', '적용 공사기간', 'IF(ISNUMBER(공사기간입력),공사기간입력,공기자동)', '개월'],
    ['PFm', '착공·분양·PF 실행월', '인허가기간', '개월차'],
    ['준공m', '준공월', 'PFm+공기', '개월차'],
    ['용적면적', '용적률 산정 면적', '대지*용적률', '㎡'],
    ['주거평', '주거 분양면적', '용적면적*(1-근생비율)*0.3025', '평'],
    ['상가평', '상가 분양면적', '용적면적*근생비율*0.3025', '평'],
    ['연면적평', '전체 연면적', '용적면적*연면적배수*0.3025', '평'],
    ['지하면적', '지하 연면적', '용적면적*(연면적배수-1)', '㎡'],
    ['공사비총액', '공사비', '연면적평*공사비평당', '천원'],
    ['BLm', '브릿지론 실행월(첫 중도금)', '할부간격', '개월차'],
    ['BL필요', '브릿지론 필요(1=예)', 'IF(PFm>BLm,1,0)', ''],
    ['BL금리', '브릿지론 가중 금리', 'BL선순위금리*BL선순위비중+BL후순위금리*(1-BL선순위비중)', '%'],
    ['BL수수료율', '브릿지론 가중 수수료', 'BL선순위취급*BL선순위비중+BL후순위취급*(1-BL선순위비중)+BL자문', '%'],
    ['할부금', '토지 중도금 1회분', '공급가격*(1-계약률)/할부회차', '천원'],
    ['선납누계', 'PF 이전 납부 토지대금', '공급가격*계약률+할부금*MIN(할부회차,INT((PFm-1)/할부간격))', '천원'],
    ['적용분양가', '적용 분양 평당가', "IF(ISNUMBER(분양가입력),분양가입력,'분양가'!B16)", '천원/평'],
    ['주거매출', '주거 매출', '주거평*적용분양가+세대수*발코니', '천원'],
    ['상가매출', '상가 매출', '상가평*상가시세', '천원'],
    ['총매출', '총 매출', '주거매출+상가매출', '천원'],
    ['PF금액', 'PF 규모', 'ROUND(총매출*PF비율,-5)', '천원'],
    ['EqDefault', 'Equity 기본값(토지비×10%×120%)', '공급가격*0.1*1.2', '천원'],
    ['EqIn', '투입 Equity(입력 또는 기본값)', 'IF(ISNUMBER(Equity입력),Equity입력,EqDefault)', '천원'],
  ];
  calc.forEach(([k, lab, f, unit]) => {
    g.getCell(r, 1).value = lab; st(g.getCell(r, 1));
    g.getCell(r, 2).value = { formula: f }; st(g.getCell(r, 2), { al: 'right', fmt: unit === '%' ? '0.00%' : '#,##0' });
    g.getCell(r, 3).value = unit; st(g.getCell(r, 3), { al: 'center' }); st(g.getCell(r, 4));
    name(k, `'가정'!$B$${r}`); r++;
  });
  // 중도금 납부월 6회
  g.getCell(r, 1).value = '분양 중도금 납부월(1~6회)'; st(g.getCell(r, 1));
  for (let k = 1; k <= 6; k++) { const c = g.getCell(r, 4 + k); c.value = { formula: `PFm+ROUND(${k}*공기/7,0)` }; st(c, { al: 'center', fmt: '0' }); }
  st(g.getCell(r, 2)); st(g.getCell(r, 3)); st(g.getCell(r, 4));
  name('중도금월', `'가정'!$E$${r}:$J$${r}`); r++;
  g.columns = [{ width: 34 }, { width: 16 }, { width: 10 }, { width: 46 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }];
  g.views = [{ state: 'frozen', ySplit: 3 }];

  // 분양가 (상한제)
  T(pr, `분양가 산정 — 분양가상한제 (최신 고시 기본형건축비)`);
  const P = [
    ['택지비(주거분)', '공급가격*(1-근생비율)'],
    ['법정택지이자', 'B3*법정이자율*인허가기간/12'],
    ['취등록세', 'B3*상한_취득세'],
    ['재산세', 'B3*재산세율'],
    ['택지비 가산', 'B3*택지가산률'],
    ['말뚝·흙막이', '공사비총액*(말뚝률+흙막이률)'],
    ['지역난방부담금', '지역난방_m2*용적면적'],
    ['택지비 계', 'SUM(B3:B9)'],
    ['기본형건축비(지상)', '용적면적*(1-근생비율)*기본형_지상'],
    ['기본형건축비(지하)', '지하면적*기본형_지상*기본형_지하비'],
    ['건축비 가산비', '(B11+B12)*건축가산률'],
    ['상한금액', 'B10+B11+B12+B13'],
    ['상한 분양가(천원/평)', 'B14/주거평'],
    ['시장 수용가 = 시세×반영률', 'MIN(B15,시세*시세반영률)'],
    ['참고: 시세×반영률', '시세*시세반영률'],
    ['분양가 제약요인', 'IF(ISNUMBER(분양가입력),"직접 입력",IF(B15<=B17,"상한제","시세"))'],
  ];
  P.forEach(([lab, f], i) => {
    const rr = 3 + i; pr.getCell(rr, 1).value = lab; st(pr.getCell(rr, 1), { b: [10, 14, 15, 16].includes(rr), fill: rr === 16 ? LB : null });
    pr.getCell(rr, 2).value = { formula: f }; st(pr.getCell(rr, 2), { al: 'right', fmt: '#,##0', b: rr === 16, color: rr === 16 ? OR : 'FF262626' });
  });
  pr.getCell('A16').value = '자동 분양가 = MIN(상한, 시세×85%)';
  pr.columns = [{ width: 32 }, { width: 18 }];

  // 현금흐름
  T(cf, `월별 현금흐름 — ${S.title} (단위: 천원, 0개월차 = 토지 계약)`);
  const C0 = 3, MC = j => colL(C0 - 1 + j); // 월 j 의 열 문자
  const cfRows = []; const rowOf = {};
  const add = (key, lab, f, o = {}) => { cfRows.push({ key, lab, f, o }); rowOf[key] = 3 + cfRows.length; };
  // f: (m열, 이전열, j) → 수식 문자열 / null(빈칸)
  add('m', '개월차', (c, p, j) => String(j), { fmt: '0', head: true });
  add('ym', '연월', (c) => `EDATE(계약일,${c}$4)`, { fmt: 'yyyy.mm', head: true });
  add('s', '분양 계약률', (c) => `IF(AND(${c}$4>=PFm,${c}$4<PFm+분양기간),분양률/분양기간,0)`, { fmt: '0.0%' });
  add('S', '누적 계약률', (c, p, j) => j === 0 ? `${c}6` : `${p}7+${c}6`, { fmt: '0.0%' });
  add('w', '공정률(월)', (c) => `IF(AND(${c}$4-PFm>=0,${c}$4-PFm<공기),(COS(PI()*(${c}$4-PFm)/공기)-COS(PI()*(${c}$4-PFm+1)/공기))/2,0)`, { fmt: '0.0%' });
  add('unpaid', '토지 미납잔액', (c, p, j) => j === 0 ? `공급가격-${c}${'{LAND}'}` : `${p}{UNPAID}-${c}{LAND}`, {});
  add('h0', '■ 유입', null, { sec: true });
  add('계약금', '주거 계약금', (c) => `주거매출*계약금비율*${c}6`);
  add('중도금', '주거 중도금', (c) => `주거매출*중도금비율/6*(COUNTIF(중도금월,${c}$4)*${c}7+${c}6*COUNTIF(중도금월,"<"&${c}$4))`);
  add('잔금', '주거 잔금', (c) => `주거매출*잔금비율*0.5*((${c}$4=준공m+1)+(${c}$4=준공m+2))*${c}7`);
  add('상가', '상가 매출', (c) => `IF(${c}$4=준공m+1,상가매출,0)`);
  add('유입계', '유입 계', (c) => `SUM(${c}{계약금}:${c}{상가})`, { b: true });
  add('h1', '■ 유출 (사업비)', null, { sec: true });
  add('토지비', '토지비', (c) => `IF(${c}$4=0,공급가격*계약률,IF(${c}$4<PFm,IF(AND(MOD(${c}$4,할부간격)=0,${c}$4/할부간격<=할부회차),할부금,0),IF(${c}$4=PFm,공급가격-선납누계,0)))`);
  add('토지할부이자', '토지 할부이자', (c, p, j) => j === 0 ? '0' : `IF(${c}$4<=PFm,${p}{UNPAID}*할부이자율/12,0)`);
  add('취득세등기', '취득세·등기', (c) => `IF(${c}$4=PFm,공급가격*취득세등기,0)`);
  add('재산세', '재산세', (c) => `IF(AND(${c}$4>=6,MOD(${c}$4-6,12)=0,${c}$4<=준공m),공급가격*재산세율,0)`);
  add('공사비', '공사비', (c) => `공사비총액*${c}8`);
  add('설계비', '설계비', (c) => `연면적평*설계_평당*((${c}$4=1)*0.5+(${c}$4=PFm)*0.5)`);
  add('감리비', '감리비', (c) => `IF(${c}8>0,연면적평*감리_평당/공기,0)`);
  add('인입미술부담', '인입·미술장식품·기타부담금', (c) => `IF(${c}$4=준공m-1,연면적평*인입_평당,0)+IF(${c}$4=준공m,용적면적*표준건축비*미술률+기타부담금,0)`);
  add('용역비', '용역비', (c) => `용역비*((${c}$4=1)*0.5+(${c}$4=PFm)*0.5)`);
  add('지역난방', '지역난방부담금', (c) => `IF(${c}$4=PFm,지역난방_m2*용적면적,0)`);
  add('분양관련', '분양관련(광고·MH·수수료·보증)', (c) => `IF(${c}6>0,총매출*광고률/분양기간+세대수*분양수수료*${c}6,0)+IF(${c}$4=MAX(PFm-2,1),MH,0)+IF(AND(${c}$4>=PFm-2,${c}$4<PFm+분양기간),MH운영,0)+IF(${c}$4=PFm,총매출*분양보증률,0)`);
  add('보존등기신탁', '보존등기·신탁', (c) => `IF(${c}$4=준공m,(공사비총액+연면적평*(설계_평당+감리_평당+인입_평당))*보존등기률,0)+신탁*((${c}$4=PFm)*0.5+(${c}$4=준공m)*0.5)`);
  add('입주관리예비비', '입주관리·예비비', (c) => `IF(${c}$4=준공m+1,세대수*입주관리,0)+총매출*예비비률*${c}8`);
  add('관리비', '시행사 관리비', (c) => `IF(${c}$4<=준공m+2,관리비_월,0)`);
  add('사업비계', '사업비 계', (c) => `SUM(${c}{토지비}:${c}{관리비})`, { b: true });
  add('h2', '■ 자금조달·금융', null, { sec: true });
  add('Equity', 'Equity 투입', (c) => `IF(${c}$4=0,적용Equity,0)`);
  add('BL인출', '브릿지론 인출', (c) => `IF(AND(BL필요=1,${c}$4=BLm),BL금액,0)`);
  add('BL상환', '브릿지론 상환', (c, p, j) => j === 0 ? '0' : `IF(${c}$4=PFm,${p}{BL잔액}+${c}{BL인출},0)`);
  add('BL잔액', '브릿지론 잔액', (c, p, j) => j === 0 ? `${c}{BL인출}` : `${p}{BL잔액}+${c}{BL인출}-${c}{BL상환}`);
  add('BL이자', '브릿지론 이자', (c, p, j) => j === 0 ? '0' : `${p}{BL잔액}*BL금리/12`);
  add('BL수수료', '브릿지론 수수료', (c) => `IF(AND(BL필요=1,${c}$4=BLm),BL금액*BL수수료율,0)`);
  add('PF인출', 'PF 인출', (c) => `IF(${c}$4=PFm,PF금액,0)`);
  add('PF이자', 'PF 이자', (c, p, j) => j === 0 ? '0' : `${p}{PF잔액}*PF금리/12`);
  add('PF수수료보증', 'PF 수수료·보증료', (c) => `IF(${c}$4=PFm,PF금액*PF수수료+PF금액*PF보증률*(공기+3)/12,0)`);
  add('중도금누계', '중도금 대출 누계(후불제)', (c, p, j) => j === 0 ? `${c}{중도금}` : `IF(${c}$4>준공m+1,0,${p}{중도금누계}+${c}{중도금})`);
  add('후불이자발생', '중도금 후불제 이자(발생)', (c, p, j) => j === 0 ? '0' : `IF(${c}$4<=준공m+1,${p}{중도금누계}*후불금리/12,0)`);
  add('후불이자', '중도금 후불제 이자(입주 시 지급)', (c) => `IF(${c}$4=준공m+1,SUMPRODUCT((${'$'}${MC(0)}$4:${'$'}${MC(NM - 1)}$4<=${c}$4)*${'$'}${MC(0)}{후불이자발생}:${'$'}${MC(NM - 1)}{후불이자발생}),0)`);
  add('상환전현금', '상환 전 현금', (c, p, j) => `${j === 0 ? '0' : p + '{기말현금}'}+${c}{유입계}+${c}{Equity}+${c}{BL인출}+${c}{PF인출}-${c}{사업비계}-${c}{BL상환}-${c}{BL이자}-${c}{BL수수료}-${c}{PF이자}-${c}{PF수수료보증}-${c}{후불이자}`);
  add('잔여사업비', '향후 사업비(다음 달 이후)', (c) => `SUMPRODUCT((${'$'}${MC(0)}$4:${'$'}${MC(NM - 1)}$4>${c}$4)*${'$'}${MC(0)}${'{사업비계}'}:${'$'}${MC(NM - 1)}${'{사업비계}'})`);
  add('PF상환', 'PF 상환', (c, p, j) => j === 0 ? '0' : `IF(${c}$4>PFm,IF(${c}$4>=준공m+2,${p}{PF잔액},MIN(${p}{PF잔액},MAX(0,${c}{상환전현금}-최소현금-${c}{잔여사업비}))),0)`);
  add('PF잔액', 'PF 잔액', (c, p, j) => j === 0 ? `${c}{PF인출}` : `${p}{PF잔액}+${c}{PF인출}-${c}{PF상환}`);
  add('기말현금', '기말 현금', (c) => `${c}{상환전현금}-${c}{PF상환}`, { b: true });
  const rowNum = { UNPAID: rowOf.unpaid, LAND: rowOf.토지비 };
  Object.keys(rowOf).forEach(k => rowNum[k] = rowOf[k]);
  const fill = f => f.replace(/\{([^}]+)\}/g, (_, k) => rowNum[k]);
  cf.getCell(3, 1).value = '구분'; cf.getCell(3, 2).value = '합계'; st(cf.getCell(3, 1), { b: true, fill: NAVY, color: 'FFFFFFFF', al: 'center' }); st(cf.getCell(3, 2), { b: true, fill: NAVY, color: 'FFFFFFFF', al: 'center' });
  const sumRows = new Set(['s', '계약금', '중도금', '잔금', '상가', '유입계', '토지비', '토지할부이자', '취득세등기', '재산세', '공사비', '설계비', '감리비', '인입미술부담', '용역비', '지역난방', '분양관련', '보존등기신탁', '입주관리예비비', '관리비', '사업비계', 'Equity', 'BL인출', 'BL상환', 'BL이자', 'BL수수료', 'PF인출', 'PF이자', 'PF수수료보증', '후불이자', 'PF상환', 'w']);
  cfRows.forEach(({ key, lab, f, o }) => {
    const rr = rowOf[key]; const lc = cf.getCell(rr, 1); lc.value = lab;
    st(lc, { b: o.b || o.sec || o.head, fill: o.sec ? LB : o.head ? GR : null, wrap: false });
    const tc = cf.getCell(rr, 2);
    if (sumRows.has(key)) tc.value = { formula: `SUM(${MC(0)}${rr}:${MC(NM - 1)}${rr})` };
    if (key === '기말현금') tc.value = { formula: `MIN(${MC(0)}${rr}:${MC(NM - 1)}${rr})` };
    st(tc, { b: true, al: 'right', fmt: o.fmt && o.fmt.includes('%') ? '0.0%' : '#,##0', fill: o.sec ? LB : GR });
    for (let j = 0; j < NM; j++) {
      const c = cf.getCell(rr, C0 + j);
      if (f) { const txt = fill(f(MC(j), j > 0 ? MC(j - 1) : null, j)); c.value = /^\d+$/.test(txt) && key === 'm' ? j : { formula: txt }; }
      st(c, { al: 'right', fmt: o.fmt || '#,##0', fill: o.sec ? LB : o.head ? GR : null, b: o.b, wrap: false });
    }
  });
  cf.getCell('B5').value = null;
  cf.getColumn(1).width = 30; cf.getColumn(2).width = 14; for (let j = 0; j < NM; j++) cf.getColumn(C0 + j).width = 11;
  cf.views = [{ state: 'frozen', xSplit: 2, ySplit: 5 }];
  const CFR = k => `'현금흐름'!$B$${rowOf[k]}`, CFrow = k => `'현금흐름'!$${MC(0)}$${rowOf[k]}:$${MC(NM - 1)}$${rowOf[k]}`, CFm = `'현금흐름'!$${MC(0)}$4:$${MC(NM - 1)}$4`;
  // BL·Equity 규모 (현금흐름 사업비 기준)
  const fr = r;
  [['BL기준액', '브릿지론 대상 사업비(BL실행~PF 전)', `SUMPRODUCT((${CFm}>=BLm)*(${CFm}<PFm)*${CFrow('사업비계')})`],
   ['BL금액', '브릿지론 금액(이자·수수료 유보 포함)', `IF(BL필요=1,ROUNDUP(BL기준액/(1-BL금리*(PFm-BLm)/12-BL수수료율),-5),0)`],
   ['EqNeed', '필요 Equity(BL 전 사업비)', `SUMPRODUCT((${CFm}<IF(BL필요=1,BLm,PFm))*${CFrow('사업비계')})`],
   ['적용Equity', '적용 Equity = MAX(투입, 필요)', 'MAX(EqIn,EqNeed)']].forEach(([k, lab, f], i) => {
    const rr = fr + i; g.getCell(rr, 1).value = lab; st(g.getCell(rr, 1));
    g.getCell(rr, 2).value = { formula: f }; st(g.getCell(rr, 2), { al: 'right', fmt: '#,##0' });
    g.getCell(rr, 3).value = '천원'; st(g.getCell(rr, 3), { al: 'center' }); st(g.getCell(rr, 4));
    name(k, `'가정'!$B$${rr}`);
  });

  // 사업수지
  T(pl, `사업수지 — ${S.title} (단위: 천원)`);
  const PLs = [
    ['■ 매출', null, 'sec'],
    ['주거 매출', `${CFR('계약금')}+${CFR('중도금')}+${CFR('잔금')}`],
    ['상가 매출', CFR('상가')],
    ['매출 계', 'B4+B5', 'b'],
    ['■ 비용', null, 'sec'],
    ['토지비', CFR('토지비')],
    ['공사비', CFR('공사비')],
    ['기타비(간접·분양·제세·금융)', `${CFR('사업비계')}-B8-B9+${CFR('BL이자')}+${CFR('BL수수료')}+${CFR('PF이자')}+${CFR('PF수수료보증')}+${CFR('후불이자')}`],
    ['비용 계', 'B8+B9+B10', 'b'],
    ['기타비 비율 [(토지비+공사비) 대비]', 'B10/(B8+B9)', 'pct'],
    ['기타비 검산 (지침 28%)', 'IF(B12>기타비기준,"28% 초과","28% 미만")', 'txt'],
    ['■ 수익성', null, 'sec'],
    ['사업이익', 'B6-B11', 'hl'],
    ['이익률(매출 대비)', 'B15/B6', 'pcthl'],
    ['상가 매출 제외 이익', 'B15-B5', 'b'],
    ['■ 투자', null, 'sec'],
    ['Equity 기본값(토지비×10%×120%)', 'EqDefault'],
    ['필요 Equity(BL 전 기말현금 부족 방지)', 'EqNeed'],
    ['BL 전 기말현금 부족 여부(기본값 기준)', 'IF(EqNeed>EqIn,"부족 — "&TEXT(EqNeed-EqIn,"#,##0")&"천원 추가 필요","부족 없음")', 'txt'],
    ['적용 Equity = MAX(기본값, 필요)', '적용Equity'],
    ['ROE (사업이익 ÷ Equity)', 'B15/B22', 'pcthl'],
    ['브릿지론 금액', 'BL금액'],
    ['PF 금액', 'PF금액'],
    ['사업기간 중 최저 기말현금', `${CFR('기말현금')}`],
    ['자금 부족 발생 여부', `IF(${CFR('기말현금')}<0,"발생 — PF 규모 확대 필요","없음")`, 'txt'],
    ['■ 판정', null, 'sec'],
    ['투자 판정', 'IF(B17<0,"투자 보류 (상가 제외 이익 음수)",IF(B16>=목표이익률,"Go","No-go (이익률 "&TEXT(목표이익률,"0%")&" 미달)"))', 'hltxt'],
  ];
  PLs.forEach(([lab, f, k], i) => {
    const rr = 3 + i; pl.getCell(rr, 1).value = lab;
    st(pl.getCell(rr, 1), { b: k === 'sec' || (k || '').includes('b') || (k || '').includes('hl'), fill: k === 'sec' ? LB : null });
    const c = pl.getCell(rr, 2); if (f) c.value = { formula: f };
    st(c, { fill: k === 'sec' ? LB : null, al: (k || '').includes('txt') ? 'center' : 'right', fmt: (k || '').includes('pct') ? '0.0%' : '#,##0',
      b: k && k !== 'sec', color: (k || '').includes('hl') ? OR : 'FF262626' });
  });
  pl.columns = [{ width: 40 }, { width: 30 }];

  // 민감도 (엔진 계산값)
  const base = run(A);
  T(sn, '민감도 — 이익률 (엔진 계산값: 가정 시트를 고치면 이 표는 바뀌지 않습니다)');
  const grid = (r0, head, xs, ys, setx, sety, fx, fy, Lf) => {
    sn.getCell(r0, 1).value = head; st(sn.getCell(r0, 1), { b: true, fill: NAVY, color: 'FFFFFFFF', al: 'center' });
    xs.forEach((x, j) => { sn.getCell(r0, 2 + j).value = x; st(sn.getCell(r0, 2 + j), { b: true, fill: NAVY, color: 'FFFFFFFF', al: 'center', fmt: fx }); });
    ys.forEach((y, i) => {
      sn.getCell(r0 + 1 + i, 1).value = y; st(sn.getCell(r0 + 1 + i, 1), { b: true, fill: LB, al: 'center', fmt: fy });
      xs.forEach((x, j) => {
        const b = Object.assign({}, A); setx(b, x); sety(b, y);
        const v = run(b, Lf ? Lf(b, y) : null).이익률, ok = v >= A.목표이익률;
        const c = sn.getCell(r0 + 1 + i, 2 + j); c.value = v; st(c, { b: ok, fill: ok ? GO : null, al: 'center', fmt: '0.0%' });
      });
    });
  };
  const p0 = Math.round(base.price / 100) * 100, prices = [-2000, -1000, 0, 1000, 2000].map(x => p0 + x);
  grid(3, '토지가(공급가 대비) ＼ 분양 평당가(천원)', prices, [0.8, 0.9, 1.0, 1.1, 1.2, 1.3], (b, x) => b.분양가입력 = x, () => {}, '#,##0', '0%', (b, y) => A.공급가격 * y);
  grid(12, '평당 공사비(천원) ＼ 분양 평당가(천원)', prices, [4500, 5000, 5500, 6000, 6500], (b, x) => b.분양가입력 = x, (b, y) => b.공사비평당 = y, '#,##0', '#,##0');
  sn.getColumn(1).width = 36; for (let j = 2; j <= 6; j++) sn.getColumn(j).width = 12;

  // 요약
  T(sum, `${S.title} — 택지 투자검토 요약 (${S.date})`, 14);
  sum.getCell('A2').value = '수치 칸은 사업수지·가정 시트와 연동됩니다. 손익분기·목표 토지가와 민감도는 작성 시점 엔진 계산값입니다.'; sum.getCell('A2').font = { name: F, size: 9, color: { argb: 'FF595959' } };
  const be = solveL(A, 0), tg = solveL(A, A.목표이익률);
  const won = v => v == null ? '산출 불가' : Math.round(v / 1e5).toLocaleString() + '억원 (공급가 대비 ' + Math.round(v / A.공급가격 * 100) + '%)';
  const SR = [
    ['투자 판정', { formula: "'사업수지'!B29" }, 'hl'],
    ['매출 / 비용 / 사업이익', { formula: `TEXT('사업수지'!B6/100000,"#,##0")&"억 / "&TEXT('사업수지'!B11/100000,"#,##0")&"억 / "&TEXT('사업수지'!B15/100000,"#,##0")&"억"` }],
    ['이익률 / ROE', { formula: `TEXT('사업수지'!B16,"0.0%")&" / "&TEXT('사업수지'!B23,"0.0%")` }, 'hl'],
    ['적용 분양 평당가', { formula: `TEXT(적용분양가/10,"#,##0")&"만원 ("&'분양가'!B18&") · 상한 "&TEXT('분양가'!B15/10,"#,##0")&"만원 / 시세×85% "&TEXT('분양가'!B17/10,"#,##0")&"만원"` }],
    ['공사비', { formula: `TEXT(공사비평당/10,"#,##0")&"만원/평 × 연면적 "&TEXT(연면적평,"#,##0")&"평 = "&TEXT(공사비총액/100000,"#,##0")&"억"` }],
    ['기타비 검산', { formula: `TEXT('사업수지'!B12,"0.0%")&" → "&'사업수지'!B13` }],
    ['Equity', { formula: `TEXT(적용Equity/100000,"#,##0.0")&"억 · "&'사업수지'!B21` }],
    ['일정', { formula: `"인허가 "&인허가기간&"개월 → 착공·분양(분양기간 "&분양기간&"개월) → 공사 "&공기&"개월 → 준공 "&TEXT(EDATE(계약일,준공m),"yyyy.mm")` }],
    ['손익분기 토지가', won(be)],
    ['목표이익(' + Math.round(A.목표이익률 * 100) + '%) 최대 토지가', won(tg)],
  ].concat((S.summary || []).map(x => [x[0], x[1], x[2] ? 'hl' : null]));
  SR.forEach(([k, v, h], i) => {
    const rr = 4 + i; sum.getCell(rr, 1).value = k; st(sum.getCell(rr, 1), { b: true, fill: LB, al: 'center' });
    sum.getCell(rr, 2).value = v; st(sum.getCell(rr, 2), { b: !!h, color: h ? OR : 'FF262626' });
    sum.getRow(rr).height = (typeof v === 'string' && v.length > 70) ? 34 : 22;
  });
  const sr = 4 + SR.length + 1;
  sum.getCell(sr, 1).value = '출처'; sum.getCell(sr, 1).font = { name: F, bold: true, size: 9 };
  (S.sources || []).forEach((x, j) => { const c = sum.getCell(sr + 1 + j, 1); c.value = '· ' + x; c.font = { name: F, size: 9, color: { argb: 'FF595959' } }; });
  sum.columns = [{ width: 26 }, { width: 110 }];
  return wb;
}

async function exportFs(id) {
  const FS = root.FS || {}; let S = FS[id]; if (typeof S === 'string') S = FS[S]; if (!S) throw new Error('분석 자료가 없습니다');
  const ExcelJS = await root.fsLoadLib(EXCELJS, 'ExcelJS');
  const buf = await build(ExcelJS, S).xlsx.writeBuffer();
  root.fsDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), S.name || 'FS.xlsx');
}
const api = { derive, run, solveL, build, exportFs };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { root.fsEngine = api; root.exportFs = exportFs; }
})(typeof window !== 'undefined' ? window : globalThis);
