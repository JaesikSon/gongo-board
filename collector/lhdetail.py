"""LH 공고 상세 요약 (무료 · 규칙 기반).

공고 상세페이지(apply.lh.or.kr)와 첨부 '공급대상토지 목록' 엑셀에서 아래 항목을 뽑는다.
  필지별: 블록, 소재지·지번, 지목, 공급용도, 용도지역, 면적, 공급가격, 신청예약금/보증금,
          건폐율, 용적률, 최고층수·높이, 세대수, 토지사용가능시기
  공고: 공급일정(신청·개찰/추첨·계약), 첨부파일(공고문·지구단위계획 등) 링크
결과는 공고 레코드의 "sum" 에 저장되고, 첨부파일 목록이 바뀌지 않으면 다시 받지 않는다.
"""
from __future__ import annotations

import io
import re
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

from common import env, http_get

FILE_URL = "https://apply.lh.or.kr/lhapply/lhFile.do?fileid={}"

# ── 첨부파일 ──────────────────────────────────────────────────────────


def file_kind(name: str) -> str:
    n = name or ""
    if re.search(r"지구단위계획|시행지침|결정조서|건축물\s*등에\s*관한", n):
        return "지구단위계획"
    if re.search(r"공고문|공고\s*\(|공급공고", n) and re.search(r"\.(pdf|hwpx?)$", n, re.I):
        return "공고문"
    if re.search(r"\.xlsx?$", n, re.I) and not re.search(r"장애|서식|신청서", n):
        return "필지목록"
    if re.search(r"토지이용계획도|위치도", n):
        return "도면"
    if re.search(r"지구계획|고시문|설명서", n):
        return "지구계획"
    if re.search(r"장애", n):
        return "장애사항"
    return "기타"


def parse_files(soup: BeautifulSoup) -> list[dict]:
    out = []
    for a in soup.select('a[href^="javascript:fileDownLoad"]'):
        m = re.search(r"'(\d+)'", a.get("href", ""))
        name = a.get_text(strip=True)
        if not m or not name:
            continue
        out.append({"name": name, "id": m.group(1), "url": FILE_URL.format(m.group(1)), "kind": file_kind(name)})
    return out


# ── 상세페이지 표·일정 ────────────────────────────────────────────────


def _num(s) -> float | None:
    if s is None:
        return None
    t = re.sub(r"[^\d.]", "", str(s))
    try:
        return float(t) if t not in ("", ".") else None
    except ValueError:
        return None


def parse_page_plots(soup: BeautifulSoup) -> list[dict]:
    plots = []
    for sec in soup.select('section[id^="div"]'):
        heads = [th.get_text(" ", strip=True) for th in sec.select("thead th")]
        if not heads or "면적" not in " ".join(heads):
            continue
        for tr in sec.select("tbody tr"):
            tds = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
            if len(tds) < 4:
                continue
            row = dict(zip(heads, tds))
            get = lambda *ks: next((row[h] for h in row for k in ks if k in h and row[h]), "")  # noqa: E731
            price = _num(get("공급가격", "예정가격", "공급금액"))
            plots.append({
                "use": get("공급용도"), "addr": get("소재지"), "jibun": get("지번"),
                "area": _num(get("면적")), "price": int(price) if price else None,
                "deposit": int(_num(get("예약금", "보증금")) or 0) or None,
            })
    return plots


def parse_schedule(soup: BeautifulSoup) -> dict:
    sched = {}
    for sec in soup.select('section[id$="_info"]'):
        for li in sec.select("li"):
            span = li.find("span")
            if not span:
                continue
            label = span.get_text(strip=True).rstrip(":").strip()
            val = li.get_text(" ", strip=True).replace(span.get_text(" ", strip=True), "", 1).strip()
            if val and label not in sched:
                sched[label] = val
    return sched


# ── 공급대상토지 목록 엑셀 ────────────────────────────────────────────

COLS = [  # (필드, 제목 패턴) — 위에서부터 먼저 맞는 것
    ("block", r"^블록$|블록명|블록지번|가구.*획지|토지이용.*블록"),
    ("gagu", r"가구번호|가구\s*번호"),
    ("lot", r"획지위치|획지번호|^획지$"),
    ("jibun", r"확정.*지번|확정.*본번|^지번$|예정지번|예정.*본번|^본번$"),
    ("jibun_sub", r"부번"),
    ("district", r"사업지구|지구명"),
    ("addr", r"소재지"),
    ("jimok", r"^지목$"),
    ("use", r"공급용도|토지이용구분"),
    ("zone", r"용도지역"),
    ("area", r"면적"),
    ("unit", r"단가"),
    ("price", r"공급가격|공급예정금액|공급금액|공급예정가격|예정가격"),
    ("deposit", r"예약금|보증금"),
    ("bcr", r"건폐율"),
    ("far", r"용적률"),
    ("floors", r"층수|높이"),
    ("units", r"세대수|가구수|호수"),
    ("use_from", r"토지사용|사용가능"),
    ("method", r"공급방법"),
    ("note", r"비고|특이사항|장애사항|^기타$"),
]
KEY_HEADS = ("면적", "건폐율", "용적률", "용도지역", "공급", "블록", "지번", "본번", "층수", "토지이용")


def read_sheet(data: bytes, name: str) -> list[list]:
    """xls/xlsx 첫 시트를 2차원 목록으로."""
    if name.lower().endswith(".xlsx"):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        return [["" if v is None else v for v in row] for row in ws.iter_rows(values_only=True)]
    import xlrd
    wb = xlrd.open_workbook(file_contents=data)
    sh = wb.sheet_by_index(0)
    return [sh.row_values(i) for i in range(sh.nrows)]


def _cell(v) -> str:
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()


def _header_row(rows: list[list]) -> int:
    best, best_i = 0, -1
    for i, r in enumerate(rows[:15]):
        s = " ".join(_cell(c) for c in r)
        score = sum(k in s for k in KEY_HEADS)
        if score > best:
            best, best_i = score, i
    return best_i if best >= 3 else -1


def _ratio(v, scale: float) -> str:
    """'60%이하' → '60% 이하'. 배수로 적힌 표(0.7, 5.15)는 scale=100."""
    s = _cell(v)
    n = _num(s)
    if not s or n is None:
        return s if s not in ("-", "") else ""
    txt = f"{round(n * scale, 2):g}%"
    return txt + (" 이하" if "이하" in s else "")


def _merge_heads(rows, hi, width):
    heads = [_cell(c) for c in rows[hi]] + [""] * width
    data_start = hi + 1
    for j in range(hi + 1, min(hi + 3, len(rows))):
        cells = [_cell(c) for c in rows[j]]
        filled = [c for c in cells if c]
        is_head = filled and sum(bool(re.fullmatch(r"[\d,.\-]+", c)) for c in filled) <= 1 and \
            any(k in " ".join(filled) for k in ("건폐율", "용적률", "층수", "면적", "토지사용", "건축"))
        if not is_head:
            break
        for k, c in enumerate(cells):
            if c:
                heads[k] = c if heads[k] in ("", "건축관련사항", "조회내용") else f"{heads[k]} {c}"
        data_start = j + 1
    return heads[:width], data_start


def parse_parcel_rows(rows: list[list]) -> list[dict]:
    rows = [list(r) for r in rows]
    hi = _header_row(rows)
    if hi < 0:
        return []
    width = max(len(r) for r in rows)
    heads, data_start = _merge_heads(rows, hi, width)
    colmap: dict[str, int] = {}
    for idx, h in enumerate(heads):
        if not h:
            continue
        for field, rx in COLS:
            if field not in colmap and re.search(rx, h):
                colmap[field] = idx
                break
    # 면적은 '확정' 면적 우선, 지번은 '확정' 우선
    for field, kw in (("area", "면적"), ("jibun", "본번"), ("jibun", "지번")):
        for idx, h in enumerate(heads):
            if kw in h and "확정" in h and "가분할" not in h.split("확정")[0]:
                colmap[field] = idx
                break
    if "jibun" in colmap:
        jh = heads[colmap["jibun"]]
        prefix = "확정" if "확정" in jh else ("예정" if "예정" in jh else "")
        sub = next((i for i, h in enumerate(heads) if "부번" in h and prefix in h), None)
        if sub is not None:
            colmap["jibun_sub"] = sub
    body = []
    for r in rows[data_start:]:
        cells = [_cell(c) for c in r] + [""] * width
        if not any(cells) or cells[0].startswith(("※", "*", "□", "ㅇ")):
            continue
        rec = {f: cells[i] for f, i in colmap.items()}
        if _num(rec.get("area")) in (None, 0):
            continue
        body.append(rec)
    # 건폐율·용적률이 배수(0.7, 5.15)로 적힌 표인지 열 단위로 판단
    def col_max(f):
        vals = [_num(b.get(f)) for b in body if _num(b.get(f)) is not None]
        return max(vals) if vals else None
    bmax, fmax = col_max("bcr"), col_max("far")
    bscale = 100 if bmax is not None and bmax <= 1 else 1
    fscale = 100 if fmax is not None and fmax <= 20 else 1
    out, last = [], {}
    for rec in body:
        for f in ("district", "addr", "use", "zone"):  # 병합 셀(위와 같음) 채우기
            if not rec.get(f) and last.get(f):
                rec[f] = last[f]
        last = rec
        block = rec.get("block", "")
        if not block or re.fullmatch(r"0+", block):
            block = "-".join(x for x in (rec.get("gagu", ""), rec.get("lot", "")) if x and not re.fullmatch(r"0+", x))
        jibun = rec.get("jibun", "")
        if rec.get("jibun_sub") and not re.fullmatch(r"0*", rec["jibun_sub"]):
            jibun = f"{jibun}-{rec['jibun_sub']}"
        price = _num(rec.get("price"))
        floors = rec.get("floors", "")
        out.append({
            "block": block, "district": rec.get("district", ""), "addr": rec.get("addr", ""), "jibun": jibun,
            "jimok": rec.get("jimok", ""), "use": rec.get("use", ""), "zone": rec.get("zone", ""),
            "area": _num(rec.get("area")), "price": int(price) if price else None,
            "deposit": int(_num(rec.get("deposit")) or 0) or None,
            "bcr": _ratio(rec.get("bcr"), bscale), "far": _ratio(rec.get("far"), fscale),
            "floors": (f"{floors}층" if re.fullmatch(r"\d+", floors) else ("" if floors == "-" else floors)),
            "units": rec.get("units", ""), "use_from": rec.get("use_from", ""),
            "method": rec.get("method", ""), "note": rec.get("note", "")[:200],
        })
    return out


# ── 전체 ──────────────────────────────────────────────────────────────


def summarize(html: str, fetch=None) -> dict:
    """상세페이지 HTML → 요약. fetch(url)->bytes 를 주면 필지목록 엑셀도 읽는다."""
    soup = BeautifulSoup(html, "html.parser")
    files = parse_files(soup)
    plots = parse_page_plots(soup)
    sheet_plots, sheet_err = [], ""
    xls = next((f for f in files if f["kind"] == "필지목록"), None)
    if xls and fetch:
        try:
            sheet_plots = parse_parcel_rows(read_sheet(fetch(xls["url"]), xls["name"]))
        except Exception as e:  # noqa: BLE001
            sheet_err = f"{type(e).__name__}: {str(e)[:80]}"
    if sheet_plots and plots:  # 엑셀에 가격이 없으면 상세페이지 값으로 채움 (지번 일치 또는 1:1)
        page_by_jibun = {re.sub(r"-0$", "", p.get("jibun") or ""): p for p in plots}
        for i, sp in enumerate(sheet_plots):
            pp = page_by_jibun.get(re.sub(r"-0$", "", sp.get("jibun") or "")) or (
                plots[i] if len(plots) == len(sheet_plots) else None)
            if pp:
                for k in ("price", "deposit"):
                    if not sp.get(k) and pp.get(k):
                        sp[k] = pp[k]
                if not sp.get("addr") and pp.get("addr"):
                    sp["addr"] = pp["addr"]
    return {
        "plots": sheet_plots or plots,
        "plots_src": "필지목록" if sheet_plots else ("상세페이지" if plots else ""),
        "schedule": parse_schedule(soup),
        "files": [f for f in files if f["kind"] in ("공고문", "지구단위계획", "필지목록", "지구계획", "도면", "장애사항")],
        "sig": ",".join(sorted(f["id"] for f in files)),
        "err": sheet_err,
    }


def _get_bytes(url: str) -> bytes:
    r = http_get(url, timeout=40, retries=2)
    r.raise_for_status()
    return r.content


def enrich(items: list[dict], prev: dict[str, dict], log=print) -> dict:
    """진행 중 LH 공고에 요약을 붙인다.
    상세페이지(가벼움)는 매번 읽어 첨부파일 목록을 비교하고, 바뀌지 않았으면 이전 요약을 그대로 쓴다
    (정정공고로 첨부가 바뀐 경우에만 엑셀을 다시 받음)."""
    limit = int(env("LH_DETAIL_MAX", "40"))
    done = reused = failed = 0
    for r in items:
        if r.get("src") != "LH":
            continue
        old_rec = prev.get(r["id"]) or {}
        old = old_rec.get("sum")
        if done + failed >= limit:
            if old:
                r["sum"], r["ai"] = old, old_rec.get("ai")
            continue
        try:
            html = http_get(r["url"], timeout=30, retries=2).text
            sig = ",".join(sorted(f["id"] for f in parse_files(BeautifulSoup(html, "html.parser"))))
            if old and not old.get("err") and old.get("sig") == sig:
                r["sum"] = old
                if old_rec.get("ai"):
                    r["ai"] = old_rec["ai"]
                reused += 1
                continue
            r["sum"] = summarize(html, fetch=_get_bytes)
            done += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            if old:
                r["sum"], r["ai"] = old, old_rec.get("ai")
            log(f"  LH 상세 실패 {r['title'][:30]}: {e}")
    for r in items:  # 목록의 면적·금액 필터가 LH 공고에도 걸리도록 필지 합계를 붙인다
        plots = [p for p in ((r.get("sum") or {}).get("plots") or []) if isinstance(p, dict)]
        areas = [p.get("area") for p in plots if p.get("area")]
        prices = [p.get("price") for p in plots if p.get("price")]
        if areas and not r.get("area"):
            r["area"] = round(sum(areas), 2)
        if prices and len(prices) == len(plots):
            r["supply"] = int(sum(prices))
    msg = f"새로 요약 {done}건, 재사용 {reused}건" + (f", 실패 {failed}건" if failed else "")
    log(f"  {msg}")
    return {"name": "LH 공고 요약", "ok": failed == 0 or done + reused > 0, "count": done + reused, "message": msg}


def pan_id(url: str) -> str:
    return (parse_qs(urlparse(url).query).get("panId") or [""])[0]
