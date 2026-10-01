"""온비드 물건 입찰결과 수집 (낙찰 여부·낙찰가).

API: 공공데이터포털 「한국자산관리공사_차세대 온비드 물건 입찰결과목록 조회서비스」
  GET https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2
  필수: cltrTypeCd(0001 부동산), prptDivCd(쉼표 구분 복수), opbdDtStart, opbdDtEnd (yyyyMMdd)
  개찰일_종료일자는 현재 이전 시점만 조회됨.
응답 1행 = 물건의 1개 회차 결과. 물건관리번호별로 가장 최근 개찰 회차만 남긴다.
"""
from __future__ import annotations

import time
from datetime import timedelta

from common import LAND_ONLY, env, http_get, is_land_usage, norm_date, now_kst, sido_of, to_int
from onbid import DETAIL_URL, PRPT_DIVS, parse_response

BASE = "https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2"

STAT = {"0010": "낙찰", "0011": "유찰", "0012": "취소", "0009": "낙찰결정대기"}


def _num(v):
    try:
        return None if v in (None, "") else float(str(v).replace(",", ""))
    except ValueError:
        return None


def fetch_window(key: str, start: str, end: str, stat: str = "", rows: int = 500,
                 log=print) -> tuple[list[dict], list[str]]:
    out, errors, page = [], [], 1
    while page <= 200:
        params = {"serviceKey": key, "pageNo": page, "numOfRows": rows, "resultType": "json",
                  "cltrTypeCd": "0001", "prptDivCd": ",".join(PRPT_DIVS), "dspsMthodCd": "0001",
                  "opbdDtStart": start, "opbdDtEnd": end}
        if stat:
            params["pbctStatCd"] = stat
        try:
            r = http_get(BASE, params=params, timeout=40)
            text = r.text.strip()
            if r.status_code != 200 or text.startswith("<"):
                errors.append(f"{start}~{end} p{page}: HTTP {r.status_code} {text[:160]}")
                break
            data = r.json()
            if "OpenAPI_ServiceResponse" in data:  # 키 미등록 등은 JSON 으로도 이렇게 온다
                h = data["OpenAPI_ServiceResponse"].get("cmmMsgHeader", {})
                errors.append(f"{h.get('returnReasonCode')}: {h.get('errMsg')}")
                break
            items, err = parse_response(data)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{start}~{end} p{page}: {e}")
            break
        if err:
            errors.append(f"{start}~{end} p{page}: {err}")
            break
        out.extend(items)
        if len(items) < rows:
            break
        page += 1
        time.sleep(0.2)
    return out, errors


def _round(v):
    return round(v, 1) if v is not None else None


def latest_by_item(rows: list[dict]) -> dict[str, dict]:
    best: dict[str, dict] = {}
    for r in rows:
        no = r.get("cltrMngNo")
        if not no:
            continue
        k = str(r.get("cltrOpbdDt") or "")
        if no not in best or k >= str(best[no].get("cltrOpbdDt") or ""):
            best[str(no)] = r
    return best


def to_result(r: dict) -> dict:
    cd = str(r.get("pbctStatCd") or "")
    nm = str(r.get("pbctStatNm") or "")
    stat = STAT.get(cd) or (nm if nm and nm != cd else STAT.get(nm, nm))
    amt = to_int(r.get("scfbAmt"))
    apsl = to_int(r.get("apslEvlAmt"))
    rate = _num(r.get("apslPrcCtrsScfbPrcRto"))
    if rate is None and amt and apsl:
        rate = amt / apsl * 100
    return {
        "stat": stat,
        "amt": amt if stat == "낙찰" else None,
        "rate": round(rate, 1) if rate is not None and stat == "낙찰" else None,
        "mrate": _round(_num(r.get("lowstBidCtrsScfbPrcRto"))) if stat == "낙찰" else None,
        "bidders": to_int(r.get("vldBddrNope")),
        "opbd": norm_date(r.get("cltrOpbdDt")),
        "nsq": str(r.get("pbctNsq") or ""),
    }


def to_archive_record(r: dict) -> dict:
    """결과만 있고 우리가 진행 중일 때 본 적 없는 물건 → 보관 레코드 생성."""
    no = str(r.get("cltrMngNo"))
    title = (r.get("onbidCltrNm") or no).strip()
    apsl = to_int(r.get("apslEvlAmt"))
    minp = to_int(r.get("lowstBidPrcIndctCont"))
    area = _num(r.get("landSqms")) or _num(r.get("bldSqms"))
    res = to_result(r)
    return {
        "id": f"onbid:{no}", "src": "온비드", "kind": "물건", "title": title,
        "org": "", "ot": "", "sido": sido_of(title), "sgg": "", "addr": title,
        "prpt": r.get("prptDivNm") or "",
        "usage": " > ".join(filter(None, [r.get("cltrUsgMclsCtgrNm"), r.get("cltrUsgSclsCtgrNm")])),
        "area": round(area, 2) if area else None, "apsl": apsl, "minp": minp,
        "ratio": round(minp / apsl * 100, 1) if apsl and minp else None,
        "status": res["stat"], "bgn": "", "end": res["opbd"], "url": DETAIL_URL.format(no),
        "res": res,
    }


def collect(first_run: bool, log=print) -> dict:
    """반환: {"results": {cltrMngNo: row}, "status": {...}}"""
    key = env("ONBID_RESULT_API_KEY") or env("ONBID_API_KEY") or env("DATA_GO_KR_KEY")
    name = "온비드 입찰결과"
    if not key:
        return {"results": {}, "status": {"name": name, "ok": False, "count": 0, "message": "ONBID_API_KEY 미설정"}}
    today = now_kst().date()
    lookback = int(env("RESULT_LOOKBACK_DAYS", "7"))
    backfill = int(env("RESULT_BACKFILL_DAYS", "90"))
    rows, errors = [], []

    def sweep(days: int, stat: str):
        cur = today - timedelta(days=days)
        while cur <= today:
            w_end = min(cur + timedelta(days=6), today)
            got, err = fetch_window(key, cur.strftime("%Y%m%d"), w_end.strftime("%Y%m%d"), stat, log=log)
            if err and w_end == today:  # 종료일=오늘이 거부되면 어제까지
                got, err = fetch_window(key, cur.strftime("%Y%m%d"),
                                        (today - timedelta(days=1)).strftime("%Y%m%d"), stat, log=log)
            rows.extend(got)
            errors.extend(err)
            if err and "SERVICE_KEY" in err[0]:
                return
            cur = w_end + timedelta(days=1)

    # 첫 실행: 최근 N일 낙찰 이력만 채움(유찰은 양이 10배라 제외) / 매번: 최근 7일 전체 결과
    if first_run:
        sweep(backfill, "0010")
    if not errors or "SERVICE_KEY" not in errors[0]:
        sweep(lookback, "")
    days = backfill if first_run else lookback
    if LAND_ONLY:
        rows = [x for x in rows if is_land_usage(x.get("cltrUsgMclsCtgrNm"), x.get("cltrUsgSclsCtgrNm"))]
    best = latest_by_item(rows)
    n_win = sum(1 for r in best.values() if to_result(r)["stat"] == "낙찰")
    msg = f"최근 {days}일 개찰 {len(rows)}행 → 물건 {len(best)}건 (낙찰 {n_win})"
    if errors:
        msg += f" / 오류: {errors[0][:160]}"
        if "SERVICE_KEY_IS_NOT_REGISTERED" in errors[0]:
            msg += " — 공공데이터포털에서 '차세대 온비드 물건 입찰결과목록 조회서비스' 활용신청 필요"
    log(f"  {msg}")
    return {"results": best, "status": {"name": name, "ok": bool(best) or not errors,
                                        "count": len(best), "message": msg}}
