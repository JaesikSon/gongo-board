"""전체 수집 실행: python collector/collect.py

결과: site/data/notices.json
  - 이전 결과와 비교해 first_seen(최초 발견 시각)을 유지 → 사이트에서 '신규' 표시
  - 어떤 출처가 이번에 실패하면 그 출처의 이전 데이터를 그대로 유지(일시 장애로 목록이 비지 않게)
  - 마감일이 지난 항목은 제거
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import boards  # noqa: E402
import lh  # noqa: E402
import onbid  # noqa: E402
from common import now_kst  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data" / "notices.json"
SOURCES = Path(__file__).parent / "sources.yaml"


def load_prev() -> dict:
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def expired(rec: dict, today: str) -> bool:
    end = (rec.get("end") or "")[:10]
    return bool(end) and end < today and not rec.get("pvct")


def main() -> int:
    now = now_kst()
    stamp = now.strftime("%Y-%m-%d %H:%M")
    today = now.strftime("%Y-%m-%d")
    prev = load_prev()
    prev_items = {r["id"]: r for r in prev.get("items", [])}

    print(f"[{stamp} KST] 수집 시작")
    results = []
    print("온비드…")
    results.append(onbid.collect())
    print("LH…")
    results.append(lh.collect())
    print("기관 게시판…")
    b = boards.collect(SOURCES)

    statuses = [r["status"] for r in results] + b["statuses"]
    by_source: list[tuple[dict, list[dict]]] = [(r["status"], r["records"]) for r in results]
    for st in b["statuses"]:
        by_source.append((st, [x for x in b["records"] if x["src"] == st["name"]]))

    items: dict[str, dict] = {}
    for st, recs in by_source:
        if not st["ok"] and not recs:
            # 이번 실패 → 이전 데이터 유지
            kept = [r for r in prev_items.values() if r.get("src") == st["name"]]
            if kept:
                st["message"] += f" · 이전 데이터 {len(kept)}건 유지"
            recs = kept
        for r in recs:
            old = prev_items.get(r["id"])
            r["first_seen"] = (old or {}).get("first_seen") or stamp
            items[r["id"]] = r

    final = [r for r in items.values() if not expired(r, today)]
    final.sort(key=lambda r: (r.get("end") or "9999", r.get("title") or ""))

    out = {
        "updated": stamp,
        "total": len(final),
        "new_count": sum(1 for r in final if r["first_seen"] == stamp and prev_items),
        "statuses": statuses,
        "items": final,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"완료: {len(final)}건 → {OUT.relative_to(ROOT)}")
    for st in statuses:
        print(f"  {'OK ' if st['ok'] else 'ERR'} {st['name']}: {st['message']}")
    # 모든 주요 출처가 실패하면 워크플로를 실패로 표시(알림 메일)
    return 0 if any(s["ok"] for s in statuses[:2]) or len(final) else 1


if __name__ == "__main__":
    sys.exit(main())
