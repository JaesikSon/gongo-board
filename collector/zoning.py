"""온비드 물건 용도지역 정확 조회 (선택 기능).

국토교통부 토지특성정보 — 브이월드 데이터 API
  GET https://api.vworld.kr/ned/data/getLandCharacteristics?key=..&pnu=..&format=json
  응답 landCharacteristicss.field[].prposArea1Nm = '제2종일반주거지역' 등
키 발급: https://www.vworld.kr → 회원가입 → 오픈API → 인증키 발급 (서비스 URL 에 사이트 주소 입력)
GitHub Secrets 에 VWORLD_KEY 로 넣으면 동작한다. 없으면 건너뛴다.

한 번 조회한 필지는 결과를 저장해 두고 다시 묻지 않는다(호출 수 최소화).
"""
from __future__ import annotations

import time

from common import env, http_get, norm_zone

BASE = "https://api.vworld.kr/ned/data/getLandCharacteristics"


def _fields(data) -> list[dict]:
    root = (data or {}).get("landCharacteristicss") or {}
    f = root.get("field") or []
    return [f] if isinstance(f, dict) else [x for x in f if isinstance(x, dict)]


def parse(data) -> str:
    """가장 최근 기준연도의 용도지역1."""
    rows = _fields(data)
    rows.sort(key=lambda r: str(r.get("stdrYear") or ""), reverse=True)
    for r in rows:
        z = r.get("prposArea1Nm") or ""
        if z and z != "지정되지않음":
            return norm_zone(z)
    return ""


def lookup(key: str, pnu: str, domain: str) -> tuple[str, str | None]:
    params = {"key": key, "pnu": pnu, "format": "json", "numOfRows": 10, "pageNo": 1}
    if domain:
        params["domain"] = domain
    try:
        r = http_get(BASE, params=params, timeout=20, retries=2)
        if r.status_code != 200:
            return "", f"HTTP {r.status_code}"
        data = r.json()
        if "response" in data and isinstance(data["response"], dict) and data["response"].get("status") == "ERROR":
            return "", str(data["response"].get("error"))[:120]
        return parse(data), None
    except Exception as e:  # noqa: BLE001
        return "", f"{type(e).__name__}: {str(e)[:100]}"


def enrich(items: list[dict], prev: dict[str, dict], log=print) -> dict:
    """items(진행 목록)의 온비드 물건에 용도지역을 채운다. 반환: 수집 상태."""
    name = "용도지역(브이월드)"
    # 이전 실행에서 조회해 둔 값 재사용
    for r in items:
        old = prev.get(r["id"]) or {}
        if old.get("zone_src") == "vworld" and old.get("zone"):
            r["zone"], r["zone_src"] = old["zone"], "vworld"
    key = env("VWORLD_KEY")
    targets = [r for r in items if r.get("kind") == "물건" and r.get("pnu") and r.get("zone_src") != "vworld"]
    if not key:
        return {"name": name, "ok": True, "count": 0,
                "message": "VWORLD_KEY 미설정 — 공고문에 적힌 용도지역만 표시 (설정 방법은 README)"}
    domain = env("VWORLD_DOMAIN", "jaesikson.github.io")
    done, errors = 0, []
    for r in targets[: int(env("VWORLD_MAX_CALLS", "300"))]:
        z, err = lookup(key, r["pnu"], domain)
        if err:
            errors.append(err)
            if len(errors) >= 3 and done == 0:  # 키·차단 문제면 일찍 중단
                break
            continue
        if z:
            r["zone"], r["zone_src"] = z, "vworld"
            done += 1
        time.sleep(0.1)
    msg = f"신규 조회 {len(targets)}필지 중 {done}건 확인"
    if errors:
        msg += f" / 오류 {len(errors)}건: {errors[0]}"
    log(f"  {msg}")
    return {"name": name, "ok": done > 0 or not errors, "count": done, "message": msg}
