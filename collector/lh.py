"""LH 분양·매각 공고 수집 (토지·상가).

API: 공공데이터포털 「한국토지주택공사_분양임대공고문 조회 서비스」
  GET https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1
  UPP_AIS_TP_CD: 01=토지, 22=상가 (05 분양주택, 06 임대주택 등은 제외)
응답 JSON 은 [{dsSch:[...]}, {dsList:[...], resHeader:[...]}] 형태라서
PAN_NM 을 가진 dict 를 재귀적으로 찾아 파싱한다 (형식 변화에 강하게).
"""
from __future__ import annotations

from datetime import timedelta

from common import LAND_ONLY, dev_category, zone_of, env, http_get, is_land_record, norm_date, now_kst, sido_of

BASE = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1"
TYPES = {"01": "토지"} if LAND_ONLY else {"01": "토지", "22": "상가"}
LH_LIST_URL = "https://apply.lh.co.kr/lh/lndLs/selectWrtancList.do"


def _walk(obj):
    if isinstance(obj, dict):
        if "PAN_NM" in obj:
            yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def parse(data, category: str) -> list[dict]:
    out = []
    for it in _walk(data):
        pid = it.get("PAN_ID") or it.get("PAN_NM")
        region = it.get("CNP_CD_NM") or ""
        out.append({
            "id": f"lh:{pid}",
            "src": "LH",
            "kind": "공고",
            "title": (it.get("PAN_NM") or "").strip(),
            "org": "한국토지주택공사",
            "ot": "LH",
            "sido": sido_of(region, it.get("PAN_NM") or ""),
            "addr": region,
            "prpt": category,
            "usage": it.get("AIS_TP_CD_NM") or category,
            "status": it.get("PAN_SS") or "",
            "posted": norm_date(it.get("PAN_NT_ST_DT") or it.get("PAN_DT")),
            "end": norm_date(it.get("CLSG_DT")),
            "url": it.get("DTL_URL") or LH_LIST_URL,
            "cat": dev_category(it.get("PAN_NM") or "", it.get("AIS_TP_CD_NM") or ""),
            "zone": zone_of(it.get("PAN_NM") or "", it.get("AIS_TP_CD_NM") or ""),
        })
    return [r for r in out if is_land_record(r)] if LAND_ONLY else out


def collect(log=print) -> dict:
    key = env("LH_API_KEY") or env("DATA_GO_KR_KEY") or env("ONBID_API_KEY")
    if not key:
        return {"records": [], "status": {"name": "LH", "ok": False, "count": 0,
                                           "message": "LH_API_KEY 미설정"}}
    today = now_kst()
    start = (today - timedelta(days=int(env("LH_LOOKBACK_DAYS", "90")))).strftime("%Y.%m.%d")
    end = (today + timedelta(days=1)).strftime("%Y.%m.%d")
    recs, errors = [], []
    for code, name in TYPES.items():
        page = 1
        while page <= 20:
            params = {"serviceKey": key, "PG_SZ": 100, "PAGE": page, "UPP_AIS_TP_CD": code,
                      "PAN_NT_ST_DT": start, "CLSG_DT": end}
            try:
                r = http_get(BASE, params=params, timeout=30)
                if r.status_code != 200 or r.text.lstrip().startswith("<"):
                    errors.append(f"{name}: HTTP {r.status_code} {r.text[:160]}")
                    break
                items = parse(r.json(), name)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{name}: {e}")
                break
            recs.extend(items)
            if len(items) < 100:
                break
            page += 1
        log(f"  LH {name}: 누적 {len(recs)}건")
    # 동일 공고 중복 제거
    seen, uniq = set(), []
    for r in recs:
        if r["id"] not in seen:
            seen.add(r["id"])
            uniq.append(r)
    msg = f"공고 {len(uniq)}건"
    if errors:
        msg += f" / 오류: {errors[0][:160]}"
    return {"records": uniq, "status": {"name": "LH", "ok": bool(uniq) or not errors,
                                        "count": len(uniq), "message": msg}}
