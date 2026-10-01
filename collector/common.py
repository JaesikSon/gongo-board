"""공통 유틸: HTTP, 시간, 기관 분류, 지역 추출."""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta, timezone

import requests

KST = timezone(timedelta(hours=9))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 gonggo-board/1.0")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})


def now_kst() -> datetime:
    return datetime.now(KST)


def http_get(url: str, params: dict | None = None, timeout: int = 30, retries: int = 3):
    """GET with retry. Returns Response or raises the last error."""
    last = None
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout)
            if r.status_code == 429:
                time.sleep(int(r.headers.get("Retry-After", 20)))
                continue
            if r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            return r
        except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise last  # type: ignore[misc]


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def to_int(v, default=None):
    try:
        if v in (None, ""):
            return default
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return default


# ── 날짜 ────────────────────────────────────────────────────────────
_DATE_RE = re.compile(r"(20\d{2})[.\-/년\s]{1,3}(\d{1,2})[.\-/월\s]{1,3}(\d{1,2})")


def norm_date(v) -> str:
    """'202610011000' / '2026.10.01' / '2026-10-01 10:00' → '2026-10-01 10:00' 또는 '2026-10-01'."""
    if not v:
        return ""
    s = str(v).strip()
    digits = re.sub(r"\D", "", s)
    if re.fullmatch(r"20\d{10,12}", digits):  # YYYYMMDDHHMM(SS)
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]} {digits[8:10]}:{digits[10:12]}"
    if re.fullmatch(r"20\d{6}", digits):
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    m = _DATE_RE.search(s)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return ""


def find_dates(text: str) -> list[str]:
    out = []
    for y, mo, d in _DATE_RE.findall(text or ""):
        try:
            datetime(int(y), int(mo), int(d))
        except ValueError:
            continue
        out.append(f"{y}-{int(mo):02d}-{int(d):02d}")
    return out


# ── 지역 ────────────────────────────────────────────────────────────
SIDO = [
    ("서울", ["서울"]), ("부산", ["부산"]), ("대구", ["대구"]), ("인천", ["인천"]),
    ("광주", ["광주광역시", "광주시 ", "광주 "]), ("대전", ["대전"]), ("울산", ["울산"]),
    ("세종", ["세종"]), ("경기", ["경기"]), ("강원", ["강원"]), ("충북", ["충북", "충청북도"]),
    ("충남", ["충남", "충청남도"]), ("전북", ["전북", "전라북도"]), ("전남", ["전남", "전라남도"]),
    ("경북", ["경북", "경상북도"]), ("경남", ["경남", "경상남도"]), ("제주", ["제주"]),
]


def sido_of(*texts: str) -> str:
    joined = " ".join(t for t in texts if t)
    for short, keys in SIDO:
        if any(k in joined for k in keys):
            return short
    return ""


# ── 기관 분류 ────────────────────────────────────────────────────────
ORG_RULES = [
    ("LH", re.compile(r"한국토지주택공사|^LH|\bLH\b")),
    ("SH", re.compile(r"서울주택도시|서울특별시\s*SH|\bSH\b")),
    ("지방공기업", re.compile(r"도시공사|개발공사|도시개발공사|도시관리공사|주택도시공사|시설관리공단|공단$")),
    ("캠코", re.compile(r"한국자산관리공사|캠코|KAMCO")),
    ("신탁사", re.compile(r"신탁")),
    ("지자체", re.compile(r"(시청|군청|구청|도청|특별시|광역시|특별자치|[가-힣]+[시군구]$|[가-힣]+도$|교육청|교육지원청)")),
    ("국가기관", re.compile(r"청$|부$|처$|법원|세무서|국세청|조달청|국방부|경찰")),
    ("금융기관", re.compile(r"은행|저축은행|보험|카드|캐피탈|농협|수협|신협|새마을금고|예금보험")),
]


def org_type(org: str) -> str:
    o = (org or "").strip()
    for name, rx in ORG_RULES:
        if rx.search(o):
            return name
    return "기타공공" if o else ""
