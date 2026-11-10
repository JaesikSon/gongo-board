// 설계개요 검토기(대형·지구단위 모드) 계산 엔진 — 공고 자료로 개략 설계개요(지상·지하 연면적, 세대수, 주차, 지하층수)를 산출한다.
// 원본: '설계개요 검토기' 아티팩트의 computeL 로직을 그대로 옮기고, 공고 → 입력값 변환(fromNotice)을 덧붙임. 단위: ㎡, m
(function (root) {
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const f2 = n => Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const roundHalf = x => Math.floor(x + 0.5 + 1e-9);
const NATIONAL = { // 국토계획법 시행령 제84조·제85조 상한
  "제1종전용주거지역":[50,100],"제2종전용주거지역":[50,150],"제1종일반주거지역":[60,200],"제2종일반주거지역":[60,250],
  "제3종일반주거지역":[50,300],"준주거지역":[70,500],"중심상업지역":[90,1500],"일반상업지역":[80,1300],"근린상업지역":[70,900],
  "유통상업지역":[80,1100],"전용공업지역":[70,300],"일반공업지역":[70,350],"준공업지역":[70,400],"보전녹지지역":[20,80],
  "생산녹지지역":[20,100],"자연녹지지역":[20,100],"보전관리지역":[20,80],"생산관리지역":[20,80],"계획관리지역":[40,100],
  "농림지역":[20,80],"자연환경보전지역":[20,80]};
const ZONES = Object.keys(NATIONAL);
const SUN_ZONES = new Set(ZONES.slice(0,5));
const SEOUL = { id:"builtin-seoul", name:"서울특별시", builtin:true, parkingRegion:"특별시",
  source:"서울특별시 도시계획 조례 제54조·제55조, 건축 조례(조경)", checked:"미검증 — 원문 대조 필요",
  zones:{"제1종전용주거지역":{bcr:50,far:100},"제2종전용주거지역":{bcr:40,far:120},"제1종일반주거지역":{bcr:60,far:150},
  "제2종일반주거지역":{bcr:60,far:200},"제3종일반주거지역":{bcr:50,far:250},"준주거지역":{bcr:60,far:400},
  "중심상업지역":{bcr:60,far:1000,note:"역사도심 800%"},"일반상업지역":{bcr:60,far:800,note:"역사도심 600%"},
  "근린상업지역":{bcr:60,far:600,note:"역사도심 500%"},"유통상업지역":{bcr:60,far:600,note:"역사도심 500%"},
  "전용공업지역":{bcr:60,far:200},"일반공업지역":{bcr:60,far:200},"준공업지역":{bcr:60,far:400},
  "보전녹지지역":{bcr:20,far:50},"생산녹지지역":{bcr:20,far:50},"자연녹지지역":{bcr:20,far:50}},
  landscape:[{gfa:2000,ratio:15},{gfa:1000,ratio:10},{gfa:200,ratio:5}], commParking:134, officeParking:100, retailParking:100, hotelParking:134,
  openSpace:[{gfa:30000,ratio:10},{gfa:10000,ratio:7},{gfa:5000,ratio:5}] };

const PARK = { // 주택건설기준 등에 관한 규정 제27조
  basis:{"특별시":[75,65],"광역시_수도권시":[85,70],"시":[110,85],"기타":[120,100]},
  minUnit:1.0, minUnitLe60:0.7, small:0.6, smallLt30:0.5,
  commNational:200 }; // 주차장법 시행령 별표1: 제1·2종 근린생활시설 시설면적 200㎡당 1대
const PR_LABEL={"특별시":"특별시","광역시_수도권시":"광역시·수도권 시","시":"그 밖의 시","기타":"군 지역 등"};

const L_USES=["공동주택","오피스텔","업무","판매","근생","숙박"];

const L_PARK_KEY={업무:"officeParking",판매:"retailParking",근생:"commParking",숙박:"hotelParking"};

const L_PARK_NAT={업무:150,판매:150,근생:200,숙박:200};

const L_OPEN_USES=["업무","판매","숙박"];

const L_OPEN_ZONE=z=>z.includes("일반주거")||z==="준주거지역"||z.endsWith("상업지역")||z==="준공업지역";

function distributeUnits(totalEx, types, netR){
  types=types.filter(u=>num(u.ex)>0);
  const shares=types.reduce((a,u)=>a+(num(u.share)??1),0)||1;
  const avg=types.reduce((a,u)=>a+u.ex*(num(u.share)??1),0)/shares;
  const nTot=avg>0?Math.floor(totalEx/avg):0;
  let asg=0; const units=types.map((u,i)=>{let c=i===types.length-1?nTot-asg:Math.round(nTot*(num(u.share)??1)/shares);asg+=c;return{name:u.name||`T${i+1}`,ex:+u.ex,count:Math.max(c,0),supply:+u.ex/netR}});
  while(units.reduce((a,u)=>a+u.ex*u.count,0)>totalEx+1e-6){const b=units.filter(u=>u.count>0).sort((a,b)=>b.ex-a.ex)[0];if(!b)break;b.count--}
  return units;
}

function zoneLimits(z,reg){const oz=reg.zones?.[z];return oz?{bcr:+oz.bcr,far:+oz.far,src:"조례"}:{bcr:NATIONAL[z][0],far:NATIONAL[z][1],src:"국가상한"}}


function computeL(L){
  const warn=[], checks=[];
  const chk=(item,plan,limit,ok,note="")=>checks.push({item,plan,limit,ok,note});
  const reg=findRegion(L.region);
  const gross=num(L.gross)||0, donate=num(L.donate)||0, net=gross-donate;
  if(gross<=0||net<=0) return {empty:true};
  const zs=L.zones.filter(z=>NATIONAL[z.zone]&&num(z.area)>0);
  if(!zs.length) return {empty:true};
  const zA=zs.reduce((a,z)=>a+ +z.area,0);
  let zb=0,zf=0;
  const zrows=zs.map(z=>{const l=zoneLimits(z.zone,reg);zb+=l.bcr*z.area/zA;zf+=l.far*z.area/zA;return{zone:z.zone,area:+z.area,...l}});
  const mainZone=[...zrows].sort((a,b)=>b.area-a.area)[0].zone;
  if(zrows.length>1) warn.push(`복수 용도지역 — 건폐율·용적률을 면적 가중평균(${zb.toFixed(1)}% / ${zf.toFixed(1)}%)으로 산정했습니다 (건축법 제54조). 그 밖의 규정은 과반 용도지역(${mainZone}) 기준 적용 여부를 확인하세요.`);
  if(Math.abs(zA-gross)>1) warn.push(`용도지역 면적 합계(${f2(zA)}㎡)가 대지면적(${f2(gross)}㎡)과 다릅니다. 면적 비율로만 사용했습니다.`);
  if(zrows.some(z=>z.src==="국가상한")) warn.push("조례 값이 없는 용도지역은 국가법령 상한을 적용했습니다. 조례 데이터 탭에서 값을 입력하세요.");

  /* --- 용적률 체계 --- */
  const du=L.du, alpha=donate/net;
  let bcr=zb, base, allowed, upper, chain;
  if(du.on){
    base=num(du.baseFar)??zf;
    const inc=du.incentives.reduce((a,i)=>a+(num(i.far)||0),0);
    const am=num(du.allowMax); allowed=base+inc; const allowCut=am!=null&&allowed>am; if(allowCut) allowed=am;
    const coef=num(du.coef)??1.3, um=num(du.upperMax);
    const upperRaw=allowed*(1+coef*alpha); upper=um!=null?Math.min(upperRaw,um):upperRaw;
    if(num(du.bcr)!=null) bcr=+du.bcr;
    chain=[["용도지역 용적률",zf,zrows.length>1?"면적 가중평균":zrows[0].src],
      ["기준용적률",base,num(du.baseFar)!=null?"지구단위계획 지정":"용도지역 용적률 사용"],
      ...du.incentives.filter(i=>num(i.far)).map(i=>["+ "+(i.name||"인센티브"),+i.far,"허용용적률 인센티브"]),
      ["허용용적률",allowed,allowCut?`기준+인센티브 ${f2(base+inc)}% → 허용 최대 ${am}%로 제한`:"기준 + 인센티브"],
      ["공공시설 제공 α",alpha*100,`제공 ${f2(donate)}㎡ ÷ 제공 후 대지 ${f2(net)}㎡`],
      ["상한용적률",upper,`허용 × (1 + ${coef} × α) = ${f2(upperRaw)}%${um!=null&&upperRaw>um?` → 상한 ${um}%로 제한`:""}`]];
    if(coef>1.5) warn.push("공공시설 제공 계수가 1.5를 넘습니다. 국토계획법 시행령 제46조의 완화 한도를 확인하세요.");
  } else {
    base=allowed=upper=zf;
    chain=[["용도지역 용적률",zf,zrows.length>1?"면적 가중평균":zrows[0].src],["적용 용적률",upper,"지구단위계획 미적용"]];
    if(donate>0) warn.push("지구단위계획 미적용 상태에서 공공시설 제공 면적을 입력했습니다. 용적률은 제공 후 대지 기준으로만 계산했고, 국토계획법 시행령 제46조 등 완화는 반영하지 않았습니다.");
  }
  const farCap=net*upper/100, bcrCap=net*bcr/100;

  /* --- 지상 개방 공간 --- */
  const setbackArea=du.on?(num(du.setback)||0)*(num(L.frontage)||0):0;
  const walkArea=du.on?(num(du.walkW)||0)*(num(du.walkL)||0):0;
  const openProv=num(L.openProvided)||0;
  const footCap=Math.max(0,Math.min(bcrCap, net-setbackArea-openProv-walkArea));

  /* --- 매스: 저층부 + 타워 --- */
  const P=L.podium, pF=num(P.floors)||0, pH=num(P.floorH)||5;
  const pPlateIn=num(P.plate)||0, pPlate=pF?Math.min(pPlateIn,footCap):0;
  if(pF&&pPlateIn>footCap+1e-6) warn.push(`저층부 바닥면적 ${f2(pPlateIn)}㎡를 건축 가능 면적 ${f2(footCap)}㎡로 줄였습니다 (건폐율·건축한계선·공개공지·보행통로 반영).`);
  const podiumH=pF*pH;
  const hMax=du.on?num(du.maxHeight):null;
  const towers=L.towers.filter(t=>num(t.plate)>0).map(t=>({name:t.name||"동",use:t.use,plate:+t.plate,fH:num(t.floorH)||3,fixed:num(t.floors),n:0}));
  let used=pF*pPlate;
  for(const t of towers) if(t.fixed!=null){t.n=t.fixed;used+=t.n*t.plate}
  let rem=farCap-used;
  let active=towers.filter(t=>t.fixed==null);
  const capN=t=>hMax?Math.max(0,Math.floor((hMax-podiumH)/t.fH+1e-9)):150;
  while(active.length&&rem>0){
    const share=rem/active.length; let prog=false; const next=[];
    for(const t of active){
      const add=Math.min(Math.floor(share/t.plate+1e-9),capN(t)-t.n);
      if(add>0){t.n+=add;rem-=add*t.plate;prog=true}
      if(t.n<capN(t)) next.push(t);
    }
    if(!prog){ // 남은 면적이 균등배분으로는 한 층이 안 될 때, 들어가는 동에 한 층씩
      const t=next.filter(t=>t.plate<=rem+1e-6).sort((a,b)=>a.n-b.n)[0]; if(!t)break; t.n++; rem-=t.plate; continue }
    active=next;
  }
  for(const t of towers){t.area=t.n*t.plate;t.h=podiumH+t.n*t.fH}
  const towerFoot=towers.filter(t=>t.n>0).reduce((a,t)=>a+t.plate,0);
  if(towerFoot>footCap+1e-6) warn.push(`타워 바닥면적 합계 ${f2(towerFoot)}㎡가 건축 가능 면적 ${f2(footCap)}㎡를 넘습니다. 저층부 위 배치라도 지상층 투영면적을 확인하세요.`);
  const ba=Math.max(pPlate,towerFoot);
  const area=Object.fromEntries(L_USES.map(u=>[u,0]));
  if(pF) area[P.use]+=pF*pPlate;
  for(const t of towers) area[t.use]+=t.area;
  const above=Object.values(area).reduce((a,v)=>a+v,0), farA=above, farPct=farA/net*100;
  const maxFl=Math.max(pF,...towers.map(t=>pF+t.n)), maxH=Math.max(podiumH,...towers.map(t=>t.h));
  if(rem>Math.max(...towers.map(t=>t.plate),0)&&towers.some(t=>t.fixed==null)) warn.push(`높이 제한 때문에 상한용적률 중 ${f2(rem)}㎡(${(rem/net*100).toFixed(1)}%p)를 쓰지 못했습니다. 타워 바닥면적을 늘리거나 동을 추가해 보세요.`);

  /* --- 세대·호실 --- */
  const aptNet=(num(L.aptNet)||75)/100, opNet=(num(L.opNet)||52)/100, opEx=num(L.opEx)||30;
  const units=area.공동주택>0?distributeUnits(area.공동주택*aptNet,L.units,aptNet):[];
  const nApt=units.reduce((a,u)=>a+u.count,0);
  const nOp=area.오피스텔>0?Math.floor(area.오피스텔*opNet/opEx):0;
  const rentalRatio=num(L.rental.ratio), nRental=rentalRatio?Math.round(nApt*rentalRatio/100):0;

  /* --- 주차 --- */
  const pr=PARK.basis[L.parkingRegion];
  const pk={rows:[]};
  if(nApt){const le=units.filter(u=>u.ex<=85).reduce((a,u)=>a+u.ex*u.count,0), gt=units.filter(u=>u.ex>85).reduce((a,u)=>a+u.ex*u.count,0);
    const byA=Math.ceil(le/pr[0]+gt/pr[1]-1e-9), byU=Math.ceil(units.reduce((a,u)=>a+u.count*(u.ex<=60?0.7:1),0)-1e-9);
    pk.rows.push({use:"공동주택",n:Math.max(byA,byU),basis:`전용합계 기준 ${byA}대 / 세대당 기준 ${byU}대 중 큰 값 (주택건설기준 제27조, ${PR_LABEL[L.parkingRegion]})`})}
  if(nOp){const ex=nOp*opEx;const n=Math.ceil((opEx<=85?ex/pr[0]:ex/pr[1])-1e-9);
    pk.rows.push({use:"오피스텔",n,basis:`전용합계 ${f2(ex)}㎡ ÷ ${opEx<=85?pr[0]:pr[1]}㎡ (주차장법 시행령 별표1 → 주택건설기준 제27조 준용). 조례의 오피스텔 기준 확인`})}
  let nrRaw=0; const nrParts=[];
  for(const u of ["업무","판매","근생","숙박"]) if(area[u]>0){const b=num(reg[L_PARK_KEY[u]])||L_PARK_NAT[u];const r=area[u]/b;nrRaw+=r;
    nrParts.push({use:u,raw:r,basis:`시설면적 ${f2(area[u])}㎡ ÷ ${b}㎡ = ${r.toFixed(2)}대 (${num(reg[L_PARK_KEY[u]])?reg.name+" 조례":"주차장법 시행령 별표1"})`})}
  const nrReq=nrRaw>0?roundHalf(nrRaw):0;
  nrParts.forEach(p=>pk.rows.push({use:p.use,n:+p.raw.toFixed(2),basis:p.basis,raw:true}));
  if(nrParts.length) pk.rows.push({use:"비주거 소계",n:nrReq,basis:`용도별 합산 ${nrRaw.toFixed(2)}대 → 0.5 이상 1대`});
  pk.req=pk.rows.filter(r=>!r.raw&&r.use!=="비주거 소계").reduce((a,r)=>a+r.n,0)+nrReq;
  if(nrParts.some(p=>!num(reg[L_PARK_KEY[p.use]]))) warn.push("일부 비주거 용도의 주차를 국가 기준으로 산정했습니다. 조례 데이터 탭에서 지자체 기준을 입력하세요.");
  if(L.parkingRegion==="특별시"&&mainZone.endsWith("상업지역")) warn.push("서울 상업지역 등은 주차상한제 적용 지역일 수 있습니다. 비주거 용도의 주차 상한을 확인하세요.");

  /* --- 지하 --- */
  const B=L.bsmt, bCov=(num(B.cov)||85)/100, bArea=pk.req*(num(B.stallArea)||35)+farA*(num(B.mep)||0)/100+(num(B.extra)||0);
  const bPer=net*bCov, nB=bArea>0?Math.ceil(bArea/bPer):0, bTotal=nB*bPer;
  const gfa=above+bTotal;

  /* --- 조경 --- */
  let ls=null; if(reg.landscape?.length){ls=0;for(const t of [...reg.landscape].sort((a,b)=>b.gfa-a.gfa)){if(gfa>=t.gfa){ls=+t.ratio;break}}}
  else warn.push("조경 기준 데이터가 없습니다. 해당 지자체 건축조례를 확인하세요.");

  /* --- 체크리스트 --- */
  chk("건폐율",`${(ba/net*100).toFixed(2)}%`,`${bcr.toFixed(1)}% 이하`,ba<=bcrCap+1e-6);
  chk("용적률",`${farPct.toFixed(2)}%`,`${upper.toFixed(2)}% 이하`,farA<=farCap+1e-3,farA>farCap+1e-3?"층수 지정 동이 상한을 넘습니다":"");
  if(hMax!=null) chk("최고높이",`${maxH.toFixed(1)}m`,`${hMax}m 이하`,maxH<=hMax+1e-6,"저층부 위 타워 기준");
  if(du.on&&num(du.setback)) chk("건축한계선",`후퇴 ${du.setback}m × 접도 ${num(L.frontage)||0}m`,`지상 ${f2(setbackArea)}㎡ 개방`,num(L.frontage)?null:false,num(L.frontage)?"배치도에서 후퇴선 확인":"접도 길이를 입력하세요");
  const planned=L_USES.filter(u=>area[u]>0);
  if(du.on) for(const u of du.banned||[]) chk(`불허용도: ${u}`,planned.includes(u)?"계획 포함":"미포함","불허",!planned.includes(u));
  const resA=area.공동주택+(L.opInRes?area.오피스텔:0), resRatio=above>0?resA/above*100:0, resFar=resA/net*100;
  if(du.on&&num(du.resRatioMax)!=null) chk("주거 비율",`${resRatio.toFixed(1)}%`,`${du.resRatioMax}% 이하`,resRatio<=+du.resRatioMax+1e-6,L.opInRes?"오피스텔 포함":"오피스텔 제외");
  if(du.on&&num(du.resFarMax)!=null) chk("주거 용적률",`${resFar.toFixed(1)}%`,`${du.resFarMax}% 이하`,resFar<=+du.resFarMax+1e-6,"용도용적제·주거용적률 제한");
  const openUseArea=L_OPEN_USES.reduce((a,u)=>a+area[u],0);
  let openReq=0, openNote="";
  if(du.on&&num(du.openReq)!=null){openReq=+du.openReq;openNote="지구단위계획 지정"}
  else if(openUseArea>=5000&&L_OPEN_ZONE(mainZone)){
    let r=10; const tiers=reg.openSpace; if(tiers?.length){r=0;for(const t of [...tiers].sort((a,b)=>b.gfa-a.gfa)){if(gfa>=t.gfa){r=+t.ratio;break}}openNote=`${reg.name} 건축조례 — 대지의 ${r}%`}
    else openNote="조례 기준 없음 — 법정 최대 10% 적용";
    openReq=net*r/100;
  } else openNote=openUseArea>0?"대상 용도 바닥면적 5,000㎡ 미만 — 의무 아님":"대상 용도(업무·판매·숙박 등) 없음";
  chk("공개공지",`${f2(openProv)}㎡`,openReq?`${f2(openReq)}㎡ 이상`:"의무 없음",openReq?openProv>=openReq-1e-6:null,openNote);
  if(openReq&&openProv>openReq) warn.push(`공개공지를 의무보다 ${f2(openProv-openReq)}㎡ 더 확보했습니다. 건축법 시행령 제27조의2에 따라 용적률·높이 1.2배 이내 완화가 가능하며, 지구단위계획 인센티브 항목으로 반영했는지 확인하세요.`);
  if(walkArea) chk("공공보행통로",`폭 ${du.walkW}m × ${du.walkL}m`,`${f2(walkArea)}㎡ 지상 개방`,null,"건축 가능 면적에서 제외");
  const groundOpen=net-ba, groundNeed=openProv+walkArea+setbackArea;
  chk("지상 개방 면적",`${f2(groundOpen)}㎡`,`${f2(groundNeed)}㎡ 이상`,groundOpen>=groundNeed-1e-6,"공개공지 + 보행통로 + 한계선 후퇴");
  if(zrows.some(z=>SUN_ZONES.has(z.zone))){const need=maxH>10?maxH/2:1.5;
    chk("정북일조",num(L.northDist)!=null?`${L.northDist}m`:"(미입력)",`${need.toFixed(1)}m 이상`,num(L.northDist)!=null?+L.northDist>=need-1e-6:null,"최고 높이 부분 기준 — 층별 사선은 배치도에서 확인")}
  const aptT=towers.filter(t=>t.use==="공동주택"&&t.n>0);
  if(aptT.length>=2){const need=(num(L.lightRatio)||0.5)*Math.max(...aptT.map(t=>t.h));
    chk("공동주택 동간 거리",num(L.gap)!=null?`${L.gap}m`:"(미입력)",`${need.toFixed(1)}m 이상`,num(L.gap)!=null?+L.gap>=need-1e-6:null,`채광창 마주보는 경우 높이 × ${num(L.lightRatio)||0.5} (건축법 시행령 제86조)`)}

  /* --- 부대복리시설 (주택건설기준) --- */
  const welfare=[];
  if(nApt>=100){welfare.push(["주민공동시설 총량",`${f2(nApt>=1000?500+2*nApt:2.5*nApt)}㎡ 이상`,nApt>=1000?"500㎡ + 세대당 2㎡":"세대당 2.5㎡"]);
    if(nApt>=150) welfare.push(["경로당 · 어린이놀이터","설치","150세대 이상"]);
    if(nApt>=300) welfare.push(["어린이집","설치","300세대 이상"]);
    if(nApt>=500) welfare.push(["주민운동시설 · 작은도서관","설치","500세대 이상"]);
    warn.push("부대복리시설 기준(주택건설기준 등에 관한 규정 제55조의2)은 개략 기준입니다. 지자체 조례로 비율을 조정할 수 있으니 확인하세요.")}

  /* --- 정비사업 --- */
  let pub=null;
  const pf=num(L.rental.planFar), lf=num(L.rental.legalFar);
  if(pf!=null&&lf!=null&&lf>pf){const a=net*(lf-pf)/100*(num(L.rental.pubRatio)??50)/100;
    pub={planFar:pf,legalFar:lf,ratio:num(L.rental.pubRatio)??50,area:a};
    warn.push(`법적상한 초과 용적률(${(lf-pf).toFixed(1)}%p)의 ${pub.ratio}% → 공공주택 등 공급 연면적 약 ${f2(a)}㎡. 도시정비법·조례의 비율을 확인하세요.`)}
  if(du.on&&(mainZone.endsWith("상업지역")||mainZone==="준주거지역")&&resA>0&&num(du.resFarMax)==null) warn.push("상업·준주거 주거복합은 지자체 용도용적제(주거 비율별 용적률)가 적용될 수 있습니다. ‘주거 용적률 상한’에 해당 값을 입력하면 체크합니다.");

  return {empty:false,L:structuredClone(L),reg,gross,donate,net,alpha,zrows,mainZone,bcr,base,allowed,upper,chain,farCap,bcrCap,footCap,
    setbackArea,walkArea,openProv,openReq,P,pF,pH,pPlate,podiumH,towers,ba,area,above,farA,farPct,maxFl,maxH,hMax,
    units,nApt,nOp,nRental,rentalRatio,pk,nB,bPer,bTotal,gfa,ls,checks,welfare,pub,resRatio,resFar,warn};
}


const REGIONS = () => [{ id: 'national', name: '국가법령 상한 (조례 미적용)' }, SEOUL];
function findRegion(id) { return REGIONS().find(r => r.id === id) || REGIONS()[0]; }

// ── 공고 → 설계개요 입력값 ────────────────────────────────────────────────
const firstNum = (s, re = /(\d+(?:\.\d+)?)\s*%/) => { const m = String(s || '').match(re); return m ? +m[1] : null; };
const maxNum = (s, re) => { const xs = [...String(s || '').matchAll(re)].map(m => +m[1].replace(/,/g, '')); return xs.length ? Math.max(...xs) : null; };
function parkingRegionOf(addr, sido) {
  const a = `${sido || ''} ${addr || ''}`;
  if (/서울/.test(a)) return '특별시';
  if (/부산|대구|인천|광주|대전|울산|세종/.test(a)) return '광역시_수도권시';
  if (/경기/.test(a)) return /군\s/.test(a) && !/시\s/.test(a) ? '시' : '광역시_수도권시';
  if (/군\s|군$/.test(a) && !/시\s/.test(a)) return '기타';
  return '시';
}
// opt: { 층수, 세대수, 지하주차대당, 동당세대(층당 호수), 층고 } — F/S 입력값이 있으면 그것을 우선
function fromNotice(r, opt = {}) {
  const ps = (r.sum && r.sum.plots) || [], b = ((r.ai && r.ai.blocks) || [])[0] || {}, p0 = ps[0] || {};
  const area = opt.대지 || r.area || ps.reduce((t, p) => t + (p.area || 0), 0);
  const zone = (p0.zone && NATIONAL[p0.zone]) ? p0.zone : (NATIONAL[r.zone] ? r.zone : '제2종일반주거지역');
  const far = opt.용적률 ? opt.용적률 * 100 : (firstNum(b.far) || firstNum(p0.far) || NATIONAL[zone][1]);
  const bcr = firstNum(b.bcr) || firstNum(p0.bcr) || NATIONAL[zone][0];
  const floorsLim = opt.층수 || firstNum(b.floors, /(\d+)\s*층/) || firstNum(b.height, /(\d+)\s*층/) || firstNum(p0.floors, /(\d+)\s*층/) || 25;
  const fH = opt.층고 || 2.9;
  const above = area * far / 100, aptNet = 0.75;
  let hh = opt.세대수 || maxNum(b.units, /([\d,]+)\s*(?:세대|호)/g) || null;
  // 세대 타입: 계획 세대수가 있으면 평균 전용면적을 맞추도록 59·84·114 구성비 산정, 없으면 84㎡ 단일
  const T = [59.9, 84.9, 114.9]; let units;
  const avg = hh ? above * aptNet / hh : 84.9;
  if (avg <= T[0]) units = [{ name: '59', ex: T[0], share: 100 }];
  else if (avg <= T[1]) { const s = (avg - T[0]) / (T[1] - T[0]); units = [{ name: '59', ex: T[0], share: (1 - s) * 100 }, { name: '84', ex: T[1], share: s * 100 }]; }
  else if (avg <= T[2]) { const s = (avg - T[1]) / (T[2] - T[1]); units = [{ name: '84', ex: T[1], share: (1 - s) * 100 }, { name: '114', ex: T[2], share: s * 100 }]; }
  else units = [{ name: '114', ex: T[2], share: 100 }];
  const avgEx = units.reduce((a, u) => a + u.ex * u.share, 0) / 100;
  const perFloor = opt.동당세대 || 4, plate = Math.round(perFloor * avgEx / aptNet);
  const nDong = Math.max(1, Math.ceil(above / (plate * floorsLim)));
  const L = {
    gross: area, donate: 0, frontage: '', northDist: '',
    zones: [{ zone, area }], region: /서울/.test(`${r.sido} ${r.addr}`) ? 'builtin-seoul' : 'national', parkingRegion: parkingRegionOf(r.addr, r.sido),
    du: { on: true, bcr, baseFar: far, allowMax: '', incentives: [], coef: 1.3, upperMax: '', maxHeight: floorsLim * fH + 0.01, setback: '', banned: [], resRatioMax: '', resFarMax: '', walkW: '', walkL: '', openReq: '' },
    openProvided: 0, podium: { floors: 0, plate: 0, use: '근생', floorH: 5 },
    towers: Array.from({ length: nDong }, (_, i) => ({ name: `${101 + i}동`, use: '공동주택', plate, floors: '', floorH: fH })),
    units, aptNet: aptNet * 100, opEx: 29.5, opNet: 52, opInRes: true,
    rental: { ratio: '', planFar: '', legalFar: '', pubRatio: 50 },
    bsmt: { stallArea: opt.지하주차대당 || 35, mep: 6, cov: 85, floorH: 3.8, extra: 0 }, gap: '', lightRatio: 0.5,
  };
  const res = computeL(L);
  if (res.empty) return null;
  // 지구단위계획의 세대당 주차 기준(예: '세대당 1.3대 이상')이 법정보다 크면 그 값을 적용하고 지하를 다시 산정
  const ratio = Math.max(0, ...[...(b.other || []), ...((r.ai && r.ai.common) || [])].map(t => { const m = String(t).match(/세대당\s*([\d.]+)\s*대/); return m ? +m[1] : 0; }));
  let pkReq = res.pk.req, pkNote = '법정 기준(주택건설기준 제27조)';
  if (ratio && Math.ceil(ratio * res.nApt) > pkReq) { pkReq = Math.ceil(ratio * res.nApt); pkNote = `지구단위계획 세대당 ${ratio}대`; }
  const bArea = pkReq * L.bsmt.stallArea + res.farA * L.bsmt.mep / 100;
  const nB = bArea > 0 ? Math.ceil(bArea / res.bPer) : 0, bTotal = nB * res.bPer, gfa = res.above + bTotal;
  return {
    L, res, 대지: area, 용적률: res.upper, 건폐율: res.bcr, 지상: res.above, 지하: bTotal, 지하층: nB, 연면적: gfa,
    배수: res.above ? gfa / res.above : null, 세대: res.nApt, 주차: pkReq, 주차근거: pkNote, 동수: res.towers.filter(t => t.n > 0).length,
    최고층: res.maxFl, 기준층: plate, 층당세대: perFloor, 평균전용: avgEx, 경고: res.warn, 건축면적: res.ba,
    타입: (() => { const us = res.units.filter(u => u.count > 0), t = us.reduce((x, u) => x + u.ex * u.count, 0) || 1;
      return us.map(u => ({ name: u.name, ex: u.ex, count: u.count, w: u.ex * u.count / t })); })(),
  };
}

function toSpec(o) {
  if (!o) return null;
  const r1 = x => Math.round(x * 10) / 10;
  return { 지상: r1(o.지상), 지하: r1(o.지하), 연면적: r1(o.연면적), 지하층: o.지하층, 최고층: o.최고층, 동수: o.동수, 건축면적: r1(o.건축면적),
    주차: o.주차, 주차근거: o.주차근거, 세대: o.세대, 건폐율: o.건폐율, 용적률: o.용적률, 배수: Math.round(o.배수 * 1000) / 1000,
    타입: o.타입.map(t => ({ name: t.name, ex: t.ex, count: t.count, w: Math.round(t.w * 1e6) / 1e6 })) };
}
const api = { computeL, fromNotice, toSpec, parkingRegionOf, NATIONAL, SEOUL, PARK };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.designEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
