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
    ("광주·전남", ["전남광주통합"]),
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


# ── 개발용 공공택지 필터 ─────────────────────────────────────────────
# 부동산 개발 검토용: 공동주택·주상복합/복합·상업/업무 용지만.
# DEV_ONLY=false 로 두면 토지 전체(LAND_ONLY), 둘 다 false 면 부동산 전체.
DEV_ONLY = env("DEV_ONLY", "true").lower() not in ("0", "false", "n", "no")
LAND_ONLY = DEV_ONLY or env("LAND_ONLY", "true").lower() not in ("0", "false", "n", "no")
MIN_AREA = float(env("MIN_AREA", "3000"))  # 온비드 물건: 용지 키워드가 없으면 이 면적(㎡) 이상만

CAT_RULES = [
    ("주상복합·복합", re.compile(r"주상\s*복합|복합\s*용지|복합\s*개발|복합\s*시설\s*용지|준\s*주거")),
    ("공동주택", re.compile(r"공동\s*주택|아파트\s*용지|연립\s*주택\s*용지|주택\s*건설\s*용지|공공\s*주택\s*용지|임대\s*주택\s*용지")),
    ("상업·업무", re.compile(r"상업\s*용지|상업\s*지역|중심\s*상업|일반\s*상업|업무\s*(시설\s*)?용지|도시\s*지원\s*시설|자족\s*(시설|기능)|지식\s*산업\s*센터\s*용지")),
]
GENERIC_SUPPLY_RX = re.compile(r"(토지|용지|택지|부지|필지)\s*(을\s*)?(공급|매각|분양|입찰|공매)|잔여\s*(토지|용지|필지)|체비지|보류지|공공\s*택지")
SMALL_USE_RX = re.compile(r"단독\s*주택|점포\s*겸용|근린\s*생활|주차\s*장|종교|주유소|유치원|의료\s*시설|농지|임야|창고|이주자|협의\s*양도|생활\s*대책|공장\s*용지|산업\s*시설\s*용지")
NOT_LAND_TITLE_RX = re.compile(r"아파트\s*(분양|잔여|입주|임대)|오피스텔|상가\s*(분양|공급|입찰)|점포\s*(분양|임대)|입주자\s*모집|주택\s*분양")
PUBLIC_OT = {"LH", "SH", "지방공기업", "지자체", "국가기관", "캠코", "기타공공"}


def dev_category(*texts: str) -> str:
    t = " ".join(x for x in texts if x)
    for name, rx in CAT_RULES:
        if rx.search(t):
            return name
    return ""


def is_land_usage(mcls: str, scls: str = "") -> bool:
    """온비드 용도 중분류가 '토지' (대지·전·답·임야·잡종지 등)."""
    return "토지" in (mcls or "")


def is_dev_title(title: str) -> bool:
    """LH·공사 공고 제목: 개발용지가 명시됐거나, 용도 미표기 일반 토지공급 공고(소규모 용도 제외)."""
    t = title or ""
    if NOT_LAND_TITLE_RX.search(t):
        return False
    if dev_category(t):
        return True
    return bool(GENERIC_SUPPLY_RX.search(t)) and not SMALL_USE_RX.search(t)


def is_land_title(title: str) -> bool:
    return is_dev_title(title) if DEV_ONLY else bool(re.search(r"토지|용지|부지|필지|택지|임야|대지|잡종지|체비지|보류지", title or "")) and not NOT_LAND_TITLE_RX.search(title or "")


def is_dev_onbid(rec: dict) -> bool:
    """온비드 물건: 공공기관이 파는 토지 중 개발용지 키워드가 있거나 대형(MIN_AREA 이상)."""
    if (rec.get("usage") or "").split(" > ")[0].strip() != "토지":
        return False
    if rec.get("prpt") == "압류재산":
        return False
    ot = rec.get("ot") or ""
    if ot and ot not in PUBLIC_OT:
        return False
    if not ot and rec.get("prpt") not in ("국유재산", "공유재산"):  # 기관명 모르는 결과 전용 레코드
        return False
    if dev_category(rec.get("title", ""), rec.get("usage", "")):
        return True
    return (rec.get("area") or 0) >= MIN_AREA


def is_land_record(r: dict) -> bool:
    if r.get("kind") == "물건":
        if DEV_ONLY:
            return is_dev_onbid(r)
        return (r.get("usage") or "").split(" > ")[0].strip() == "토지"
    if r.get("src") == "LH" and not DEV_ONLY:
        return r.get("prpt") == "토지"
    return is_land_title(f'{r.get("title", "")} {r.get("usage", "")}'.strip())


# ── 용도지역 ────────────────────────────────────────────────────────
# 공고문·물건명에 적힌 용도지역을 읽는다. (정확한 값은 zoning.py 의 브이월드 조회가 덮어씀)
ZONE_RULES = [
    ("제1종전용주거", r"제\s*1\s*종\s*전용\s*주거"), ("제2종전용주거", r"제\s*2\s*종\s*전용\s*주거"),
    ("제1종일반주거", r"제\s*1\s*종\s*일반\s*주거|1종\s*일반\s*주거"),
    ("제2종일반주거", r"제\s*2\s*종\s*일반\s*주거|2종\s*일반\s*주거"),
    ("제3종일반주거", r"제\s*3\s*종\s*일반\s*주거|3종\s*일반\s*주거"),
    ("준주거", r"준\s*주거\s*지역"),
    ("중심상업", r"중심\s*상업\s*지역"), ("일반상업", r"일반\s*상업\s*지역"),
    ("근린상업", r"근린\s*상업\s*지역"), ("유통상업", r"유통\s*상업\s*지역"),
    ("전용공업", r"전용\s*공업\s*지역"), ("일반공업", r"일반\s*공업\s*지역"), ("준공업", r"준\s*공업\s*지역"),
    ("보전녹지", r"보전\s*녹지"), ("생산녹지", r"생산\s*녹지"), ("자연녹지", r"자연\s*녹지"),
    ("계획관리", r"계획\s*관리\s*지역"), ("생산관리", r"생산\s*관리\s*지역"), ("보전관리", r"보전\s*관리\s*지역"),
    ("농림", r"농림\s*지역"), ("자연환경보전", r"자연\s*환경\s*보전\s*지역"),
]
ZONE_RULES = [(n, re.compile(rx)) for n, rx in ZONE_RULES]


def zone_of(*texts: str) -> str:
    t = " ".join(x for x in texts if x)
    for name, rx in ZONE_RULES:
        if rx.search(t):
            return name
    return ""


def norm_zone(name: str) -> str:
    """브이월드 '제2종일반주거지역' → '제2종일반주거'."""
    n = re.sub(r"\s+", "", name or "")
    n = re.sub(r"지역$", "", n)
    return zone_of(n + "지역") or n
