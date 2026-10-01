"""전체 수집 실행: python collector/collect.py

결과
  site/data/notices.json  진행 중 공고·물건
  site/data/archive.json  종료된 공고·물건 (종료일로부터 ARCHIVE_DAYS=90일 보관) + 낙찰결과

규칙
  - first_seen(최초 발견 시각) 유지 → 사이트 '신규' 표시
  - 어떤 출처가 이번에 실패하면 그 출처의 이전 데이터를 유지 (일시 장애로 목록이 비지 않게)
  - 진행 목록에서 빠지거나 마감일이 지난 항목 → archive 로 이동
  - 온비드 입찰결과(낙찰/유찰/취소)를 물건관리번호로 붙임. 낙찰·취소면 진행 목록에서도 내림
  - 결과만 있고 본 적 없는 물건은 '낙찰'일 때만 archive 에 새로 추가 (유찰은 양이 너무 많음)
"""
from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import boards  # noqa: E402
import lh  # noqa: E402
import onbid  # noqa: E402
import results  # noqa: E402
from common import LAND_ONLY, env, is_land_record, now_kst  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
OUT = DATA / "notices.json"
ARCH = DATA / "archive.json"
SOURCES = Path(__file__).parent / "sources.yaml"
FINAL_STATS = ("낙찰", "취소")


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def dump(path: Path, head: dict, items: list[dict]) -> None:
    """한 줄에 항목 하나 → git 이 변경분만 저장해서 저장소가 덜 커진다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    head_s = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1]
    body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in items)
    path.write_text(f'{head_s},"items":[\n{body}\n]}}\n', encoding="utf-8")


def expired(rec: dict, today: str) -> bool:
    end = (rec.get("end") or "")[:10]
    return bool(end) and end < today and not rec.get("pvct")


def closed_date(rec: dict) -> str:
    res = rec.get("res") or {}
    return ((res.get("opbd") or rec.get("end") or rec.get("closed") or rec.get("posted") or "")[:10])


def merge_active(by_source, prev_items: dict, stamp: str) -> dict[str, dict]:
    items: dict[str, dict] = {}
    for st, recs in by_source:
        if not st["ok"] and not recs:
            kept = [r for r in prev_items.values() if r.get("src") == st["name"]]
            if kept:
                st["message"] += f" · 이전 데이터 {len(kept)}건 유지"
            recs = kept
        for r in recs:
            old = prev_items.get(r["id"])
            r["first_seen"] = (old or {}).get("first_seen") or stamp
            items[r["id"]] = r
    return items


def build(active: dict[str, dict], prev_items: dict, archive: dict[str, dict],
          result_rows: dict[str, dict], extra_archive: list[dict], stamp: str, today: str,
          keep_days: int) -> tuple[list[dict], list[dict]]:
    """진행/보관 목록을 계산한다 (테스트하기 쉽게 순수 함수로 분리)."""
    # 0) 다시 진행 목록에 올라온 항목(재공고 등)은 보관함에서 뺀다
    for rid in list(active):
        if rid in archive and (archive[rid].get("res") or {}).get("stat") not in FINAL_STATS:
            archive.pop(rid)
    # 1) 진행 목록에서 빠진 항목, 마감 지난 항목 → 보관
    for rid, r in prev_items.items():
        if rid not in active and rid not in archive:
            archive[rid] = {**r, "closed": stamp}
    for rid in [k for k, r in active.items() if expired(r, today)]:
        archive[rid] = {**active.pop(rid), "closed": stamp}

    # 2) 온비드 입찰결과 붙이기
    for no, row in result_rows.items():
        rid = f"onbid:{no}"
        res = results.to_result(row)
        if rid in active:
            if res["stat"] in FINAL_STATS:
                archive[rid] = {**active.pop(rid), "res": res, "status": res["stat"], "closed": stamp}
            else:
                active[rid]["last"] = res  # 직전 회차 결과(유찰 등) — 진행 중이므로 정보로만
        elif rid in archive:
            old = (archive[rid].get("res") or {}).get("opbd") or ""
            if res["opbd"] >= old:
                archive[rid]["res"] = res
                archive[rid]["status"] = res["stat"]
        elif res["stat"] == "낙찰":
            archive[rid] = {**results.to_archive_record(row), "closed": stamp, "first_seen": stamp}

    # 3) 게시판 결과공고 (낙찰자 공고 등)
    for r in extra_archive:
        if r["id"] not in archive:
            archive[r["id"]] = {**r, "closed": stamp, "first_seen": stamp}

    # 4) 보관 기간 정리
    from datetime import date
    cutoff = (date.fromisoformat(today) - timedelta(days=keep_days)).isoformat()
    arch = [r for r in archive.values() if (closed_date(r) or today) >= cutoff]
    arch.sort(key=lambda r: closed_date(r), reverse=True)

    act = list(active.values())
    act.sort(key=lambda r: (r.get("end") or "9999", r.get("title") or ""))
    return act, arch


def main() -> int:
    now = now_kst()
    stamp = now.strftime("%Y-%m-%d %H:%M")
    today = now.strftime("%Y-%m-%d")
    keep_days = int(env("ARCHIVE_DAYS", "90"))
    prev = load(OUT)
    prev_items = {r["id"]: r for r in prev.get("items", [])}
    prev_arch = load(ARCH)
    archive = {r["id"]: r for r in prev_arch.get("items", [])}

    if LAND_ONLY:  # 기준을 바꾸기 전에 쌓인 대상 외 항목 정리
        prev_items = {k: v for k, v in prev_items.items() if is_land_record(v)}
        archive = {k: v for k, v in archive.items() if is_land_record(v)}

    print(f"[{stamp} KST] 수집 시작")
    srcs = []
    print("온비드…")
    srcs.append(onbid.collect())
    print("LH…")
    srcs.append(lh.collect())
    print("온비드 입찰결과…")
    rs = results.collect(first_run=not prev_arch.get("result_backfilled"))
    print("기관 게시판…")
    b = boards.collect(SOURCES)

    board_active = [x for x in b["records"] if x["kind"] != "결과공고"]
    board_results = [x for x in b["records"] if x["kind"] == "결과공고"]
    statuses = [s["status"] for s in srcs] + [rs["status"]] + b["statuses"]
    by_source = [(s["status"], s["records"]) for s in srcs]
    for st in b["statuses"]:
        by_source.append((st, [x for x in board_active if x["src"] == st["name"]]))

    active = merge_active(by_source, prev_items, stamp)
    act, arch = build(active, prev_items, archive, rs["results"], board_results, stamp, today, keep_days)
    if LAND_ONLY:  # 결과 전용으로 새로 들어온 온비드 낙찰 레코드도 같은 기준으로 거름
        arch = [r for r in arch if is_land_record(r)]

    n_win = sum(1 for r in arch if (r.get("res") or {}).get("stat") == "낙찰")
    dump(OUT, {"updated": stamp, "total": len(act),
               "new_count": sum(1 for r in act if r["first_seen"] == stamp and prev_items),
               "archive_total": len(arch), "archive_won": n_win, "archive_days": keep_days,
               "statuses": statuses}, act)
    dump(ARCH, {"updated": stamp, "total": len(arch), "keep_days": keep_days,
                "result_backfilled": bool(prev_arch.get("result_backfilled") or rs["results"])}, arch)

    print(f"완료: 진행 {len(act)}건, 종료 {len(arch)}건(낙찰 {n_win})")
    for st in statuses:
        print(f"  {'OK ' if st['ok'] else 'ERR'} {st['name']}: {st['message']}")
    return 0 if any(s["ok"] for s in statuses[:2]) or act else 1


if __name__ == "__main__":
    sys.exit(main())
