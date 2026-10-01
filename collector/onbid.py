"""온비드(차세대) 부동산 물건목록 수집.

API: 공공데이터포털 「한국자산관리공사_차세대 온비드 부동산 물건목록 조회서비스」
  GET https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2
  응답 1행 = 물건의 1개 회차. 물건관리번호(cltrMngNo)로 묶어 현재 회차만 남긴다.
"""
from __future__ import annotations

import time

from common import LAND_ONLY, dev_category, zone_of, env, http_get, is_land_record, is_land_usage, norm_date, now_kst, org_type, sido_of, to_int

BASE = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
DETAIL_URL = "https://www.onbid.co.kr/op/cta/ctaDetail.do?cltrMngNo={}"

# 재산유형코드: 목록 API에 실제 데이터가 있는 코드 (압류·기타일반·국유·공유 등).
# 이름은 응답의 prptDivNm 을 그대로 쓴다.
PRPT_DIVS = ("0007", "0005", "0010", "0002", "0008")

STATUS_NAME = {
    "0001": "입찰준비중", "0002": "입찰진행중", "0003": "입찰마감", "0006": "개찰중",
    "0009": "수의계약가능", "0010": "낙찰", "0011": "유찰", "0012": "취소",
}


def parse_response(data) -> tuple[list[dict], str | None]:
    """(items, error). NODATA 는 빈 목록."""
    if not isinstance(data, dict):
        return [], "응답 형식 오류"
    # 공공데이터포털은 {"response": {...}} 로 감싸기도 한다
    if "response" in data and isinstance(data["response"], dict):
        data = data["response"]
    header = data.get("header") or data.get("result") or {}
    rc = str(header.get("resultCode", "00") or "00")
    msg = header.get("resultMsg", "") or ""
    if rc == "03" or "NODATA" in msg.upper() or "DB_ERROR" in msg:
        return [], None
    if rc not in ("00", "0", "000", ""):
        return [], f"API 오류 {rc}: {msg}"
    items = (data.get("body") or {}).get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if isinstance(items, dict):
        items = [items]
    return [i for i in items if isinstance(i, dict)], None


def fetch_rows(key: str, pvct: str, rows: int = 500, log=print) -> tuple[list[dict], list[str]]:
    all_rows, errors = [], []
    for div in PRPT_DIVS:
        page = 1
        while True:
            params = {"serviceKey": key, "pageNo": page, "numOfRows": rows,
                      "resultType": "json", "prptDivCd": div, "pvctTrgtYn": pvct}
            try:
                r = http_get(BASE, params=params, timeout=40)
                if r.status_code != 200:
                    errors.append(f"{div} p{page}: HTTP {r.status_code} {r.text[:120]}")
                    break
                text = r.text.strip()
                if text.startswith("<"):  # 키 오류 등은 XML 로 온다
                    errors.append(f"{div} p{page}: {text[:160]}")
                    break
                items, err = parse_response(r.json())
            except Exception as e:  # noqa: BLE001
                errors.append(f"{div} p{page}: {e}")
                break
            if err:
                errors.append(f"{div} p{page}: {err}")
                break
            if not items:
                break
            all_rows.extend(items)
            if len(items) < rows:
                break
            page += 1
            time.sleep(0.2)
        log(f"  온비드 재산유형 {div} (수의계약={pvct}): 누적 {len(all_rows)}행")
    return all_rows, errors


def _key_dt(v: str) -> str:
    return "".join(ch for ch in str(v or "") if ch.isdigit())[:12]


def _real_date(v) -> str:
    """온비드는 일정 미확정 회차를 2999-12-30 같은 자리표시 날짜로 준다 → 빈 값으로."""
    d = norm_date(v)
    return "" if d.startswith(("2999", "9999")) else d


def _not_ended(end, now_s: str) -> bool:
    e = _key_dt(end)
    if not e:
        return False
    return e >= now_s[: len(e)]


def to_records(raw: list[dict], now=None) -> list[dict]:
    """회차 행 → 물건 단위 레코드 (현재 회차 기준). 임대·종료 물건 제외."""
    now_s = (now or now_kst()).strftime("%Y%m%d%H%M")
    groups: dict[str, list[dict]] = {}
    for it in raw:
        no = it.get("cltrMngNo")
        if no:
            groups.setdefault(str(no), []).append(it)

    out = []
    for no, rounds in groups.items():
        live = [r for r in rounds if _not_ended(r.get("cltrBidEndDt"), now_s)]
        pvct = any(str(r.get("pvctTrgtYn", "")).upper() == "Y" for r in rounds)
        if not live and not pvct:
            continue
        pool = live or rounds
        cur = sorted(pool, key=lambda r: _key_dt(r.get("cltrBidBgngDt")) or "9" * 12)[0]

        if LAND_ONLY and not is_land_usage(cur.get("cltrUsgMclsCtgrNm"), cur.get("cltrUsgSclsCtgrNm")):
            continue
        dsps = cur.get("dspsMthodNm") or ""
        if "임대" in dsps:
            continue

        stat_cd = str(cur.get("pbctStatCd") or "")
        stat_nm = str(cur.get("pbctStatNm") or "")
        if not stat_nm or stat_nm == stat_cd:
            stat_nm = STATUS_NAME.get(stat_nm or stat_cd, stat_nm)
        if pvct and not live:
            stat_nm = "수의계약가능"

        addr = (cur.get("zadrNm") or cur.get("cltrAdr") or cur.get("cltrRadr")
                or " ".join(filter(None, [cur.get("lctnSdnm"), cur.get("lctnSggnm"), cur.get("lctnEmdNm")])))
        apsl = to_int(cur.get("apslEvlAmt"))
        minp = to_int(cur.get("lowstBidPrcIndctCont")) or to_int(cur.get("lowstBidPrc"))
        area = None
        for f in ("landSqms", "bldSqms"):
            v = cur.get(f)
            try:
                if v not in (None, ""):
                    area = round(float(str(v).replace(",", "")), 2)
                    break
            except ValueError:
                pass
        org = cur.get("orgNm") or cur.get("rqstOrgNm") or ""
        usage = " > ".join(filter(None, [cur.get("cltrUsgMclsCtgrNm"), cur.get("cltrUsgSclsCtgrNm")]))

        out.append({
            "id": f"onbid:{no}",
            "src": "온비드",
            "kind": "물건",
            "title": (cur.get("onbidCltrNm") or addr or no).strip(),
            "org": org,
            "ot": org_type(org),
            "sido": sido_of(cur.get("lctnSdnm") or "", addr),
            "sgg": cur.get("lctnSggnm") or "",
            "addr": addr,
            "prpt": cur.get("prptDivNm") or "",
            "usage": usage,
            "area": area,
            "apsl": apsl,
            "minp": minp,
            "ratio": round(minp / apsl * 100, 1) if apsl and minp else None,
            "fails": to_int(cur.get("usbdNft"), 0),
            "status": stat_nm,
            "bgn": _real_date(cur.get("cltrBidBgngDt")),
            "end": _real_date(cur.get("cltrBidEndDt")),
            "pvct": pvct and not live,
            "url": DETAIL_URL.format(no),
            "pnu": str(cur.get("ltnoPnu") or ""),
        })
    for rec in out:
        rec["cat"] = dev_category(rec["title"], rec["usage"])
        rec["zone"] = zone_of(rec["title"], rec["addr"])
    return [r for r in out if is_land_record(r)] if LAND_ONLY else out


def collect(log=print) -> dict:
    """반환: {"records": [...], "status": {...}}"""
    key = env("ONBID_API_KEY") or env("DATA_GO_KR_KEY")
    if not key:
        return {"records": [], "status": {"name": "온비드", "ok": False, "count": 0,
                                           "message": "ONBID_API_KEY 미설정"}}
    raw, errors = fetch_rows(key, "N", log=log)
    if env("ONBID_INCLUDE_PVCT", "false").lower() in ("1", "true", "y", "yes"):
        raw2, err2 = fetch_rows(key, "Y", log=log)
        raw += raw2
        errors += err2
    recs = to_records(raw)
    ok = bool(recs) or not errors
    msg = f"회차 {len(raw)}행 → 물건 {len(recs)}건"
    if errors:
        msg += f" / 오류 {len(errors)}건: {errors[0][:160]}"
    return {"records": recs, "status": {"name": "온비드", "ok": ok, "count": len(recs), "message": msg}}
