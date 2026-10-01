"""SH·광역/기초 도시공사 홈페이지 게시판 수집 (보조 채널).

기관마다 게시판 구조가 달라서, 선택자를 하드코딩하지 않고 다음처럼 동작한다.
  1) sources.yaml 의 boards(게시판 URL)가 있으면 그 페이지를 읽는다.
  2) 없으면 homepage 를 읽고 '분양/매각/공고' 메뉴 링크를 찾아 최대 N개 게시판을 자동 탐색한다.
  3) 게시판 페이지의 링크 중 매각·분양 키워드를 포함한 글만 공고로 채택한다.
자바스크립트로만 목록을 그리는 사이트는 0건이 나오며, 사이트의 '수집 상태'에 표시된다.
그런 기관은 대부분 온비드에도 같은 물건을 올리므로 온비드 탭에서 기관명으로 찾을 수 있다.
"""
from __future__ import annotations

import hashlib
import re
from datetime import timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import yaml
from bs4 import BeautifulSoup

from common import env, find_dates, http_get, now_kst, sido_of

SALE_RX = re.compile(r"매각|공매|분양|수의계약|용지\s*공급|토지\s*공급|부지|필지|상가\s*공급|잔여\s*(토지|용지|필지|상가)")
EXCLUDE_RX = re.compile(
    r"채용|용역|시공|공사\s*입찰|물품|구매|제안|결과|낙찰자|계약\s*현황|임대주택|전세|행복주택|국민임대|"
    r"매입임대|청년|신혼|입주자\s*모집|당첨자|면접|교육|설명회\s*결과|개인정보|정정공고\s*결과"
)
# 매각·분양의 결과 공고 (낙찰자 공고, 개찰결과, 공급결과 등) → 보관함에 '결과공고'로 들어감
RESULT_RX = re.compile(r"낙찰|개찰\s*결과|입찰\s*결과|매각\s*결과|공급\s*결과|분양\s*결과|계약\s*체결\s*결과")
RESULT_EXCLUDE_RX = re.compile(r"채용|용역|시공|공사\s*입찰|물품|구매|임대주택|전세|행복주택|국민임대|매입임대|청년|신혼|당첨자|면접")
WON_RX = re.compile(r"(\d[\d,]{4,})\s*원")
MENU_RX = re.compile(r"분양|매각|판매|공급|공고|입찰")
MENU_EXCLUDE_RX = re.compile(r"채용|용역|계약|정보공개|청렴|인권|윤리|고객|민원|임대주택")


def _abs(base: str, href: str) -> str:
    if not href or href.startswith(("javascript", "#", "mailto:", "tel:")):
        return ""
    return urljoin(base, href)


def _same_site(a: str, b: str) -> bool:
    ha, hb = urlparse(a).hostname or "", urlparse(b).hostname or ""
    root = lambda h: ".".join(h.split(".")[-3:]) if h.endswith(".kr") else ".".join(h.split(".")[-2:])  # noqa: E731
    return root(ha) == root(hb)


def _soup(url: str) -> BeautifulSoup:
    r = http_get(url, timeout=25, retries=2)
    r.raise_for_status()
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding
    return BeautifulSoup(r.text, "html.parser")


def discover_boards(homepage: str, limit: int) -> list[str]:
    soup = _soup(homepage)
    found = []
    for a in soup.find_all("a"):
        text = " ".join(a.get_text(" ", strip=True).split())
        if not text or len(text) > 20 or not MENU_RX.search(text) or MENU_EXCLUDE_RX.search(text):
            continue
        url = _abs(homepage, a.get("href", ""))
        if url and _same_site(url, homepage) and url not in found:
            found.append(url)
    # '매각','분양' 메뉴를 '공고'보다 우선
    found.sort(key=lambda u: 0 if re.search(r"sale|bunyang|land|분양|매각", u, re.I) else 1)
    return found[:limit]


def extract_notices(board_url: str, soup: BeautifulSoup, src: dict, since: str) -> list[dict]:
    out = []
    for a in soup.find_all("a"):
        title = " ".join(a.get_text(" ", strip=True).split())
        if len(title) < 6 or not SALE_RX.search(title):
            continue
        is_result = bool(RESULT_RX.search(title)) and not RESULT_EXCLUDE_RX.search(title)
        if not is_result and EXCLUDE_RX.search(title):
            continue
        row = a.find_parent(["tr", "li", "dl", "div"]) or a
        row_text = " ".join(row.get_text(" ", strip=True).split())
        dates = find_dates(row_text)
        posted = dates[0] if dates else ""
        end = dates[-1] if len(dates) > 1 and dates[-1] > dates[0] else ""
        if posted and posted < since:
            continue
        link = _abs(board_url, a.get("href", "")) or board_url
        nid = hashlib.md5(f"{src['name']}|{title}|{posted}".encode()).hexdigest()[:12]
        rec = {
            "id": f"board:{nid}",
            "src": src["name"],
            "kind": "결과공고" if is_result else "공고",
            "title": title[:200],
            "org": src["name"],
            "ot": src.get("type", "지방공기업"),
            "sido": src.get("sido") or sido_of(src["name"], title),
            "addr": "",
            "prpt": "",
            "usage": "",
            "status": "",
            "posted": posted,
            "end": end,
            "url": link,
        }
        if is_result:
            # 제목에 금액이 적혀 있으면(드묾) 낙찰가로 사용, 대부분은 원문 링크로 확인
            m = WON_RX.search(title)
            rec["res"] = {"stat": "결과공고", "amt": int(m.group(1).replace(",", "")) if m else None,
                          "rate": None, "bidders": None, "opbd": posted, "nsq": ""}
            rec["end"] = posted
        out.append(rec)
    return out


def load_sources(path: Path) -> list[dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return [s for s in data.get("sources", []) if s.get("enabled", True)]


def collect_one(src: dict, since: str, limit: int) -> tuple[list[dict], dict]:
    boards = src.get("boards") or []
    msg_prefix = ""
    try:
        if not boards and src.get("homepage"):
            boards = discover_boards(src["homepage"], limit)
            msg_prefix = f"게시판 {len(boards)}개 자동탐색 · "
        recs, seen, errs = [], set(), []
        for b in boards:
            try:
                for n in extract_notices(b, _soup(b), src, since):
                    if n["id"] not in seen:
                        seen.add(n["id"])
                        recs.append(n)
            except Exception as e:  # noqa: BLE001
                errs.append(f"{b}: {type(e).__name__}")
        msg = msg_prefix + f"공고 {len(recs)}건"
        if not boards:
            msg += " (게시판을 찾지 못함 — boards 에 URL 지정 필요)"
        elif not recs:
            msg += " (목록이 자바스크립트로 그려지는 사이트일 수 있음)"
        if errs:
            msg += f" / 실패 {len(errs)}: {errs[0][:120]}"
        return recs, {"name": src["name"], "ok": bool(recs), "count": len(recs), "message": msg,
                      "url": src.get("homepage") or (boards[0] if boards else "")}
    except Exception as e:  # noqa: BLE001
        return [], {"name": src["name"], "ok": False, "count": 0,
                    "message": f"접속 실패: {type(e).__name__} {str(e)[:120]}",
                    "url": src.get("homepage", "")}


def collect(sources_path: Path, log=print) -> dict:
    since = (now_kst() - timedelta(days=int(env("BOARD_LOOKBACK_DAYS", "120")))).strftime("%Y-%m-%d")
    limit = int(env("BOARD_DISCOVER_LIMIT", "6"))
    records, statuses = [], []
    for src in load_sources(sources_path):
        recs, st = collect_one(src, since, limit)
        log(f"  {src['name']}: {st['message']}")
        records.extend(recs)
        statuses.append(st)
    return {"records": records, "statuses": statuses}
