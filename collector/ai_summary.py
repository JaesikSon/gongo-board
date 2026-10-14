"""지구단위계획 AI 요약 (선택 기능).

GitHub Secrets 에 ANTHROPIC_API_KEY 가 있을 때만 동작한다. 없으면 아무것도 하지 않는다.
LH 공고의 지구단위계획(시행지침 PDF·결정조서 hwpx)과 공고문 PDF 에서 해당 블록 관련 쪽만 골라
Claude API 로 블록별 인허가 제한(허용·불허용도, 건폐율·용적률, 층수·높이 등)을 뽑는다.
첨부파일이 바뀌지 않으면 이전 결과를 재사용하므로 같은 공고는 한 번만 요금이 든다.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

from common import env, http_get

API_URL = "https://api.anthropic.com/v1/messages"
MAX_CHARS = 45000      # 모델에 보내는 본문 최대 글자 수 (공고 1건당 대략 $0.1 내외)
NOTICE_CHARS = 9000    # 그중 공고문 몫
KEYS = ("건폐율", "용적률", "높이", "층수", "층 이하", "허용용도", "불허용도", "건축물의 용도", "허용", "불허",
        "공동주택", "주상복합", "근린생활", "업무시설", "판매시설", "배치", "건축선", "주거비율", "세대")

PROMPT = """너는 한국 부동산 개발사업 실무자를 돕는 도시계획 검토자다.
아래는 LH 토지 공급공고의 첨부문서(지구단위계획 시행지침/결정조서, 공고문)에서 발췌한 본문이다. [p.N] 은 원문 쪽 번호다.

공급 대상 블록·용지: {targets}

해야 할 일: 공급 대상 블록별로 지구단위계획상 인허가 제한사항을 정리하라.
규칙
- 문서에 '기정'과 '변경'이 함께 있으면 반드시 '변경'(최신) 값을 쓴다.
- 문서에 없는 내용은 지어내지 말고 빈 문자열로 둔다. 추정하지 않는다.
- 값은 원문 표현을 짧게 옮긴다 (예: "200% 이하", "25층 이하", "해발 79.1m 이하").
- 근거 쪽은 [p.N] 표시를 보고 "p.34" 처럼 적는다.

JSON 하나만 출력하라 (설명·코드블록 없이):
{{"blocks":[{{"block":"블록명","use":"용지 용도","allowed":"허용용도 요약","banned":"불허용도 요약",
"bcr":"건폐율","far":"용적률","floors":"최고층수","height":"최고높이","units":"세대수·주택규모",
"other":["배치·건축선·주거비율·공공보행통로 등 개발에 영향이 큰 규제를 짧게"],"pages":"근거 쪽"}}],
"common":["지구 전체 공통 규제 중 중요한 것 (최대 5개)"]}}

본문:
{body}
"""


# ── 요약 대상 조건 (사용자 지정) ───────────────────────────────────────
PYEONG = 3.305785
MIN_PYEONG = float(env("AI_MIN_PYEONG", "1500"))          # 1) 토지면적 1,500평 이상
HOUSING_RX = re.compile(r"공동\s*주택|아파트|주상\s*복합|복합\s*용지|준\s*주거|주택\s*용지|주거\s*용지|도시형")  # 2) 주택건설 가능 용지
NON_HOUSING_RX = re.compile(r"단독|근린|상업|업무|산업|유통|주차|종교|의료|교육|공공|자족|연구|물류|판매")
HOUSING_CATS = ("공동주택", "주상복합·복합")
DATE_RX = re.compile(r"(20\d\d)[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})")
DEADLINE_LABEL_RX = re.compile(r"신청|접수|입찰|개찰|추첨|마감")


def is_housing(use: str) -> bool:
    u = use or ""
    if re.search(r"주상\s*복합", u):
        return True
    return bool(HOUSING_RX.search(u)) and not NON_HOUSING_RX.search(u)


def eligible_plots(r: dict) -> list[dict]:
    """조건 1·2를 만족하는 필지. 필지 정보가 없으면 공고 단위(용지유형·합계면적)로 판단."""
    plots = (r.get("sum") or {}).get("plots") or []
    min_m2 = MIN_PYEONG * PYEONG
    if plots:
        return [p for p in plots if (p.get("area") or 0) >= min_m2
                and (is_housing(p.get("use", "")) or (not p.get("use") and r.get("cat") in HOUSING_CATS))]
    if r.get("cat") in HOUSING_CATS and (r.get("area") or 0) >= min_m2:
        return [{"block": "", "area": r.get("area")}]
    return []


def deadline(r: dict) -> str:
    """신청·입찰 관련 일정 중 가장 늦은 날짜 (없으면 공고 마감일)."""
    days = []
    for k, v in ((r.get("sum") or {}).get("schedule") or {}).items():
        if DEADLINE_LABEL_RX.search(k) and "계약" not in k:
            days += [f"{y}-{int(m):02d}-{int(d):02d}" for y, m, d in DATE_RX.findall(v)]
    return max(days) if days else (r.get("end") or "")[:10]


def why_not(r: dict, today: str) -> str:
    """요약 대상이 아니면 이유, 대상이면 ''."""
    dl = deadline(r)
    if dl and dl < today:
        return "마감"
    if not eligible_plots(r):
        return "조건 미달(1,500평 이상 주택건설 용지 없음)"
    return ""


# ── 월 사용액 상한 ────────────────────────────────────────────────────
USAGE = Path(__file__).resolve().parent.parent / "site" / "data" / "ai_usage.json"
PRICE_IN = float(env("AI_PRICE_IN", "2"))     # USD / 100만 토큰 (claude-sonnet-5-5)
PRICE_OUT = float(env("AI_PRICE_OUT", "10"))
BUDGET = float(env("AI_BUDGET_USD", "18"))    # 콘솔 월 한도($20)보다 조금 낮게 — 여기서 먼저 멈춘다
EST_CALL = 0.20                               # 1건 최대 예상비용 (여유 있게)


def load_usage(month: str) -> dict:
    try:
        u = json.loads(USAGE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        u = {}
    if u.get("month") != month:
        u = {"month": month, "usd": 0.0, "calls": 0, "in": 0, "out": 0, "log": []}
    return u


def save_usage(u: dict) -> None:
    USAGE.parent.mkdir(parents=True, exist_ok=True)
    u["log"] = u.get("log", [])[-200:]
    USAGE.write_text(json.dumps(u, ensure_ascii=False, indent=1), encoding="utf-8")


def _pdf_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader
    rd = PdfReader(io.BytesIO(data))
    out = []
    for p in rd.pages:
        try:
            out.append(p.extract_text() or "")
        except Exception:  # noqa: BLE001
            out.append("")
    return out


def _hwpx_pages(data: bytes) -> list[str]:
    """hwpx = zip 안의 Contents/section*.xml. 쪽 정보가 없어 섹션을 쪽처럼 취급한다."""
    out = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n))
        for n in names:
            xml = z.read(n).decode("utf-8", "ignore")
            xml = re.sub(r"</hp:p>|</hp:tr>", "\n", xml)
            xml = re.sub(r"</hp:tc>", " | ", xml)
            txt = re.sub(r"<[^>]+>", "", xml)
            # 큰 섹션은 2,500자씩 잘라 '쪽'으로
            for i in range(0, len(txt), 2500):
                out.append(txt[i:i + 2500])
    return out


def _zip_name(info: zipfile.ZipInfo) -> str:
    """한글 파일명이 cp949 로 들어 있는 zip 이 많다."""
    n = info.filename
    if not info.flag_bits & 0x800:
        try:
            n = n.encode("cp437").decode("cp949")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return n


def pages_of(name: str, data: bytes, depth: int = 0) -> list[str]:
    """PDF·HWPX 는 쪽별 본문, ZIP 은 안의 PDF·HWPX 를 모두 읽는다. 읽을 수 없는 파일은 빈 목록."""
    low = name.lower()
    try:
        if low.endswith(".pdf"):
            return _pdf_pages(data)
        if low.endswith(".hwpx"):
            return _hwpx_pages(data)
        if low.endswith(".zip") and depth == 0:
            out = []
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for info in z.infolist():
                    inner = _zip_name(info)
                    if inner.lower().endswith((".pdf", ".hwpx")) and info.file_size < 60_000_000:
                        out += [f"〔{inner.rsplit('/', 1)[-1]}〕\n{t}" for t in pages_of(inner, z.read(info), 1)]
            return out
    except Exception:  # noqa: BLE001  손상·암호 걸린 파일 등은 건너뛴다
        return []
    return []


def _norm(s: str) -> str:
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()


def select_pages(pages: list[str], targets: list[str], budget: int) -> str:
    """대상 블록명이 나오는 쪽 > 규제 키워드가 많은 쪽 순으로 예산 안에서 고른다 (원래 순서 유지)."""
    tg = [t for t in targets if t and len(t) <= 12]
    scored = []
    for i, p in enumerate(pages):
        s = _norm(p)
        if len(s) < 30:
            continue
        hit = sum(s.count(t) for t in tg)
        kw = sum(s.count(k) for k in KEYS)
        scored.append((-(hit * 10 + kw), i, s))
    scored.sort()
    chosen, used = [], 0
    for sc, i, s in scored:
        if sc == 0:
            break
        piece = s[:6000]
        if used + len(piece) > budget:
            continue
        chosen.append((i, piece))
        used += len(piece)
    chosen.sort()
    return "\n\n".join(f"[p.{i + 1}]\n{s}" for i, s in chosen)


def targets_of(summary: dict, plots: list[dict] | None = None) -> list[str]:
    out = []
    for p in (plots if plots is not None else summary.get("plots") or []):
        b = (p.get("block") or "").strip()
        lab = b or (p.get("jibun") or "")
        if lab and lab not in out:
            out.append(lab)
    return out[:30]


def build_body(summary: dict, fetch, targets: list[str] | None = None) -> tuple[str, list[str]]:
    files = summary.get("files") or []
    targets = targets if targets is not None else targets_of(summary)
    parts, used = [], []
    plan = [f for f in files if f["kind"] == "지구단위계획" and f["name"].lower().endswith((".pdf", ".hwpx", ".zip"))]
    notice = [f for f in files if f["kind"] == "공고문" and f["name"].lower().endswith(".pdf")][:1]
    budget_plan = MAX_CHARS - (NOTICE_CHARS if notice else 0)
    readable = [(f, pages_of(f["name"], fetch(f["url"]))) for f in plan[:3]]
    readable = [(f, pg) for f, pg in readable if pg][:2]   # 읽을 수 있는 지구단위계획 문서 최대 2개
    for f, pages in readable:
        txt = select_pages(pages, targets, budget_plan // max(1, len(readable)))
        if txt:
            parts.append(f"=== 문서: {f['name']} ===\n{txt}")
            used.append(f["name"])
    for f in notice:
        pages = pages_of(f["name"], fetch(f["url"]))
        txt = select_pages(pages, targets, NOTICE_CHARS)
        if txt:
            parts.append(f"=== 문서: {f['name']} ===\n{txt}")
            used.append(f["name"])
    return "\n\n".join(parts), used


def parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("JSON 없음")
    d = json.loads(m.group(0))
    blocks = []
    for b in d.get("blocks") or []:
        if not isinstance(b, dict):
            continue
        other = b.get("other") or []
        if isinstance(other, str):
            other = [other]
        blocks.append({k: str(b.get(k) or "").strip() for k in
                       ("block", "use", "allowed", "banned", "bcr", "far", "floors", "height", "units", "pages")}
                      | {"other": [str(x).strip() for x in other if str(x).strip()][:6]})
    common = [str(x).strip() for x in (d.get("common") or []) if str(x).strip()][:6]
    return {"blocks": blocks, "common": common}


def call_claude(key: str, model: str, prompt: str) -> tuple[str, dict]:
    import requests
    r = requests.post(API_URL, timeout=180, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": model, "max_tokens": 4000, "messages": [{"role": "user", "content": prompt}]})
    if r.status_code != 200:
        raise RuntimeError(f"API {r.status_code}: {r.text[:200]}")
    d = r.json()
    text = "".join(c.get("text", "") for c in d.get("content", []) if c.get("type") == "text")
    return text, d.get("usage") or {}


def _get(url: str) -> bytes:
    r = http_get(url, timeout=60, retries=2)
    r.raise_for_status()
    return r.content


def enrich(items: list[dict], stamp: str, log=print, fetch=_get, caller=call_claude) -> dict:
    """조건(1,500평 이상 · 주택건설 가능 용지 · 마감 전)을 만족하는 공고만 요약. 월 사용액 상한에서 멈춘다."""
    name = "지구단위계획 AI 요약"
    key = env("ANTHROPIC_API_KEY")
    if not key:
        return {"name": name, "ok": True, "count": 0, "message": "ANTHROPIC_API_KEY 미설정 — 건너뜀 (원문 링크만 제공)"}
    model = env("AI_MODEL", "claude-sonnet-5-5")
    limit = int(env("AI_MAX_PER_RUN", "6"))
    today = stamp[:10]
    usage = load_usage(stamp[:7])
    done = skipped = failed = out_of_scope = 0
    budget_hit = False
    errs = []
    for r in items:
        s = r.get("sum")
        if not s or not s.get("files"):
            continue
        ai = r.get("ai") or {}
        same = ai.get("sig") == s.get("sig")
        sample = "시연" in (ai.get("model") or "")   # 수동 견본은 실제 결과로 교체
        plan_names = {f["name"] for f in s["files"] if f["kind"] == "지구단위계획"}
        missed_plan = bool(ai.get("blocks") and plan_names and not plan_names & set(ai.get("src") or []) and not ai.get("retried"))
        if same and not sample and not missed_plan and (ai.get("blocks") or ai.get("none") or ai.get("fail", 0) >= 2):
            continue
        reason = why_not(r, today)
        if reason:
            out_of_scope += 1
            continue
        if done + failed >= limit:
            skipped += 1
            continue
        if usage["usd"] + EST_CALL > BUDGET:
            budget_hit = True
            skipped += 1
            continue
        try:
            plots = eligible_plots(r)
            targets = targets_of(s, plots)
            body, used = build_body(s, fetch, targets)
            if not body:
                r["ai"] = {"sig": s.get("sig"), "none": "지구단위계획 PDF/HWPX 첨부 없음", "at": stamp}
                continue
            prompt = PROMPT.format(targets=", ".join(targets) or "(목록 없음 — 문서에서 공급 대상 용지를 찾아 정리)", body=body)
            text, u = caller(key, model, prompt)
            tin, tout = u.get("input_tokens", 0), u.get("output_tokens", 0)
            cost = tin / 1e6 * PRICE_IN + tout / 1e6 * PRICE_OUT
            usage.update(usd=round(usage["usd"] + cost, 4), calls=usage["calls"] + 1,
                         **{"in": usage["in"] + tin, "out": usage["out"] + tout})
            usage.setdefault("log", []).append({"at": stamp, "id": r.get("id"), "title": (r.get("title") or "")[:40],
                                                "in": tin, "out": tout, "usd": round(cost, 4)})
            res = parse_json(text)
            r["ai"] = {"sig": s.get("sig"), "model": model, "at": stamp, "src": used, **res}
            if missed_plan:
                r["ai"]["retried"] = True
            done += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            if isinstance(e, ValueError):  # 응답 형식 문제(같은 문서면 반복될 가능성) → 횟수 기록해 과금 반복 방지
                r["ai"] = {"sig": s.get("sig"), "fail": (ai.get("fail", 0) if same else 0) + 1, "at": stamp}
            errs.append(f"{r.get('title', '')[:20]}: {str(e)[:120]}")
            log(f"  AI 요약 실패 {r.get('title', '')[:30]}: {e}")
    save_usage(usage)
    msg = f"새로 요약 {done}건 · 조건 밖 {out_of_scope}건"
    if skipped:
        msg += f", 다음 회차로 미룸 {skipped}건"
    if budget_hit:
        msg += f" (이번 달 상한 ${BUDGET:g} 도달)"
    if failed:
        msg += f", 실패 {failed}건 ({errs[0]})"
    msg += f" · 이번 달 사용 ${usage['usd']:.2f} / ${BUDGET:g} ({usage['calls']}회)"
    log(f"  {msg}")
    return {"name": name, "ok": failed == 0 or done > 0, "count": done, "message": msg}
