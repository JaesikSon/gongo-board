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


def pages_of(name: str, data: bytes) -> list[str]:
    low = name.lower()
    if low.endswith(".pdf"):
        return _pdf_pages(data)
    if low.endswith(".hwpx"):
        return _hwpx_pages(data)
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


def targets_of(summary: dict) -> list[str]:
    out = []
    for p in summary.get("plots") or []:
        b = (p.get("block") or "").strip()
        lab = b or (p.get("jibun") or "")
        if lab and lab not in out:
            out.append(lab)
    return out[:30]


def build_body(summary: dict, fetch) -> tuple[str, list[str]]:
    files = summary.get("files") or []
    targets = targets_of(summary)
    parts, used = [], []
    plan = [f for f in files if f["kind"] == "지구단위계획" and f["name"].lower().endswith((".pdf", ".hwpx"))]
    notice = [f for f in files if f["kind"] == "공고문" and f["name"].lower().endswith(".pdf")][:1]
    budget_plan = MAX_CHARS - (NOTICE_CHARS if notice else 0)
    for f in plan[:2]:
        pages = pages_of(f["name"], fetch(f["url"]))
        txt = select_pages(pages, targets, budget_plan // max(1, len(plan[:2])))
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
    name = "지구단위계획 AI 요약"
    key = env("ANTHROPIC_API_KEY")
    if not key:
        return {"name": name, "ok": True, "count": 0, "message": "ANTHROPIC_API_KEY 미설정 — 건너뜀 (원문 링크만 제공)"}
    model = env("AI_MODEL", "claude-sonnet-5-5")
    limit = int(env("AI_MAX_PER_RUN", "6"))
    done = skipped = failed = 0
    tin = tout = 0
    errs = []
    for r in items:
        s = r.get("sum")
        if not s or not s.get("files"):
            continue
        ai = r.get("ai") or {}
        same = ai.get("sig") == s.get("sig")
        if same and (ai.get("blocks") or ai.get("none") or ai.get("fail", 0) >= 2):  # 형식 오류 2회면 첨부 바뀔 때까지 중단
            continue
        if done + failed >= limit:
            skipped += 1
            continue
        try:
            body, used = build_body(s, fetch)
            if not body:
                r["ai"] = {"sig": s.get("sig"), "none": "지구단위계획 PDF/HWPX 첨부 없음", "at": stamp}
                continue
            prompt = PROMPT.format(targets=", ".join(targets_of(s)) or "(목록 없음 — 문서에서 공급 대상 용지를 찾아 정리)",
                                   body=body)
            text, usage = caller(key, model, prompt)
            res = parse_json(text)
            tin += usage.get("input_tokens", 0)
            tout += usage.get("output_tokens", 0)
            r["ai"] = {"sig": s.get("sig"), "model": model, "at": stamp, "src": used, **res}
            done += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            if isinstance(e, ValueError):  # 응답 형식 문제(같은 문서면 반복될 가능성) → 횟수 기록해 과금 반복 방지
                r["ai"] = {"sig": s.get("sig"), "fail": (ai.get("fail", 0) if same else 0) + 1, "at": stamp}
            errs.append(f"{r.get('title', '')[:20]}: {str(e)[:120]}")
            log(f"  AI 요약 실패 {r.get('title', '')[:30]}: {e}")
    msg = f"새로 요약 {done}건"
    if skipped:
        msg += f", 다음 회차로 미룸 {skipped}건"
    if failed:
        msg += f", 실패 {failed}건 ({errs[0]})"
    if tin:
        msg += f" · 토큰 입력 {tin:,} / 출력 {tout:,}"
    log(f"  {msg}")
    return {"name": name, "ok": failed == 0 or done > 0, "count": done, "message": msg}
