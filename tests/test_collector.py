"""오프라인 테스트: python -m pytest tests -q"""
import sys
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))

import boards  # noqa: E402
import lh  # noqa: E402
import onbid  # noqa: E402
import results  # noqa: E402
from common import KST, norm_date, org_type, sido_of  # noqa: E402

NOW = datetime(2026, 9, 30, 9, 0, tzinfo=KST)


def test_norm_date():
    assert norm_date("202610011000") == "2026-10-01 10:00"
    assert norm_date("20261001") == "2026-10-01"
    assert norm_date("2026.10.1") == "2026-10-01"
    assert norm_date("") == ""


def test_org_type_and_sido():
    assert org_type("한국토지주택공사 경기남부지역본부") == "LH"
    assert org_type("서울주택도시개발공사") == "SH"
    assert org_type("화성도시공사") == "지방공기업"
    assert org_type("한국자산관리공사") == "캠코"
    assert org_type("무궁화신탁") == "신탁사"
    assert org_type("수원시") == "지자체"
    assert sido_of("경기도", "") == "경기"
    assert sido_of("", "충청남도 천안시") == "충남"


def _row(no, nsq, bgn, end, **kw):
    base = {"cltrMngNo": no, "pbctNsq": nsq, "cltrBidBgngDt": bgn, "cltrBidEndDt": end,
            "onbidCltrNm": "경기도 화성시 동탄 토지", "lctnSdnm": "경기도", "lctnSggnm": "화성시",
            "orgNm": "화성도시공사", "prptDivNm": "기타일반재산", "dspsMthodNm": "매각",
            "cltrUsgMclsCtgrNm": "토지", "cltrUsgSclsCtgrNm": "대지",
            "apslEvlAmt": "100000000", "lowstBidPrcIndctCont": "90000000", "pbctStatCd": "0002",
            "pbctStatNm": "0002", "landSqms": "5200.5", "pvctTrgtYn": "N"}
    base.update(kw)
    return base


def test_onbid_groups_current_round_and_filters():
    raw = [
        _row("A1", "1", "202609010900", "202609031700"),              # 종료 회차
        _row("A1", "2", "202609290900", "202610011700"),              # 현재 회차
        _row("A1", "3", "202610060900", "202610081700", lowstBidPrcIndctCont="81000000"),
        _row("B2", "1", "202609290900", "202610011700", dspsMthodNm="임대"),  # 임대 제외
        _row("C3", "1", "202608010900", "202608031700"),              # 전부 종료 → 제외
    ]
    recs = onbid.to_records(raw, now=NOW)
    assert [r["id"] for r in recs] == ["onbid:A1"]
    r = recs[0]
    assert r["minp"] == 90000000 and r["ratio"] == 90.0
    assert r["status"] == "입찰진행중"
    assert r["ot"] == "지방공기업" and r["sido"] == "경기"
    assert r["end"] == "2026-10-01 17:00"
    assert "cltrMngNo=A1" in r["url"]


def test_onbid_real_response_shape_and_placeholder_dates():
    # 2026-10-01 실제 API 응답에서 발췌 (숫자형 금액, 2999 자리표시 날짜)
    data = {"header": {"resultCode": "00", "resultMsg": "NORMAL_CODE"}, "body": {"items": {"item": [
        {"cltrMngNo": "2022-0100-002855", "pbctNsq": "2", "prptDivNm": "기타일반재산", "dspsMthodNm": "매각",
         "cltrUsgMclsCtgrNm": "상가용및업무용건물", "cltrUsgSclsCtgrNm": "근린생활시설",
         "onbidCltrNm": "경기도 평택시 장당동 483-6 201호 근린생활시설", "usbdNft": 1, "pvctTrgtYn": "N",
         "cltrBidBgngDt": "299912301000", "cltrBidEndDt": "299912301600", "apslEvlAmt": 256000000,
         "lowstBidPrcIndctCont": "373248000", "lctnSdnm": "경기도", "lctnSggnm": "평택시", "lctnEmdNm": "장당동",
         "rqstOrgNm": None, "orgNm": "코리아신탁주식회사", "landSqms": 62.453, "bldSqms": 94.113,
         "pbctStatCd": "0001", "pbctStatNm": "입찰준비중"}]}, "numOfRows": 3, "pageNo": 1, "totalCount": 14733}}
    items, err = onbid.parse_response(data)
    assert err is None and len(items) == 1
    assert onbid.to_records(items, now=NOW) == []  # 상가(근린생활시설)는 토지 전용에서 제외
    items[0].update(cltrUsgMclsCtgrNm="토지", cltrUsgSclsCtgrNm="대지")
    assert onbid.to_records(items, now=NOW) == []  # 신탁사 물건은 개발용지 모드에서 제외
    items[0].update(orgNm="화성도시공사", landSqms=6000.123)
    r = onbid.to_records(items, now=NOW)[0]
    assert r["bgn"] == "" and r["end"] == ""
    assert r["apsl"] == 256000000 and r["minp"] == 373248000
    assert r["ot"] == "지방공기업" and r["sido"] == "경기" and r["area"] == 6000.12
    assert r["status"] == "입찰준비중" and r["fails"] == 1


def test_onbid_parse_response_variants():
    items, err = onbid.parse_response({"header": {"resultCode": "00"}, "body": {"items": {"item": {"cltrMngNo": "X"}}}})
    assert err is None and items == [{"cltrMngNo": "X"}]
    items, err = onbid.parse_response({"response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}})
    assert items == [] and err is None
    _, err = onbid.parse_response({"header": {"resultCode": "30", "resultMsg": "SERVICE_KEY_IS_NOT_REGISTERED"}})
    assert err and "30" in err


def test_lh_parse_nested():
    data = [{"dsSch": [{"PG_SZ": "100"}]},
            {"dsList": [{"PAN_ID": "2015122300012345", "PAN_NM": "화성동탄2 상업용지 공급공고",
                         "CNP_CD_NM": "경기도", "PAN_SS": "공고중", "PAN_NT_ST_DT": "2026.09.25",
                         "CLSG_DT": "2026.10.10", "DTL_URL": "https://apply.lh.co.kr/x", "AIS_TP_CD_NM": "상업용지"}],
             "resHeader": [{"SS_CODE": "Y"}]}]
    recs = lh.parse(data, "토지")
    assert len(recs) == 1
    assert recs[0]["posted"] == "2026-09-25" and recs[0]["end"] == "2026-10-10"
    assert recs[0]["sido"] == "경기" and recs[0]["ot"] == "LH"


BOARD_HTML = """
<table><tbody>
<tr><td>12</td><td><a href="view.do?id=12">2026년 동탄 상업용지 매각 공고</a></td><td>2026-09-20</td></tr>
<tr><td>11</td><td><a href="view.do?id=11">2026년 하반기 신규직원 채용 공고</a></td><td>2026-09-19</td></tr>
<tr><td>10</td><td><a href="view.do?id=10">청년 매입임대주택 입주자 모집</a></td><td>2026-09-18</td></tr>
<tr><td>9</td><td><a href="javascript:fn_view(9)">잔여 필지 수의계약 공급 안내</a></td><td>2026.09.15</td></tr>
<tr><td>3</td><td><a href="view.do?id=3">옛날 토지 매각 공고</a></td><td>2025-01-01</td></tr>
</tbody></table>
"""


def test_board_extract_keywords_and_dates():
    soup = BeautifulSoup(BOARD_HTML, "html.parser")
    src = {"name": "테스트도시공사", "sido": "경기", "type": "지방공기업"}
    recs = boards.extract_notices("https://ex.or.kr/board/list.do", soup, src, since="2026-06-01")
    titles = [r["title"] for r in recs]
    assert titles == ["2026년 동탄 상업용지 매각 공고", "잔여 필지 수의계약 공급 안내"]
    assert recs[0]["url"] == "https://ex.or.kr/board/view.do?id=12"
    assert recs[1]["url"] == "https://ex.or.kr/board/list.do"  # JS 링크는 게시판으로
    assert recs[0]["posted"] == "2026-09-20"


RESULT_HTML = """
<ul>
<li><a href="v?1">동탄 상업용지 매각 개찰결과 공고</a> 2026-09-25</li>
<li><a href="v?2">청사 청소용역 낙찰자 공고</a> 2026-09-25</li>
<li><a href="v?3">잔여 필지 수의계약 공급 안내</a> 2026-09-20</li>
</ul>"""


def test_board_result_posts_are_marked():
    soup = BeautifulSoup(RESULT_HTML, "html.parser")
    src = {"name": "테스트도시공사", "sido": "경기", "type": "지방공기업"}
    recs = boards.extract_notices("https://ex.or.kr/b/", soup, src, since="2026-06-01")
    kinds = {r["title"]: r["kind"] for r in recs}
    assert kinds == {"동탄 상업용지 매각 개찰결과 공고": "결과공고", "잔여 필지 수의계약 공급 안내": "공고"}
    res = next(r for r in recs if r["kind"] == "결과공고")["res"]
    assert res["stat"] == "결과공고" and res["opbd"] == "2026-09-25"


# 2026-10-01 실제 입찰결과 API 응답에서 발췌
WIN_ROW = {"cltrMngNo": "2025-0900-063750", "prptDivNm": "기타일반재산", "cltrUsgMclsCtgrNm": "토지",
           "cltrUsgSclsCtgrNm": "대지", "onbidCltrNm": "강원특별자치도 정선군 고한읍 고한리 124-19 단독주택",
           "landSqms": 152, "bldSqms": 82.85, "pbctNsq": "1", "apslEvlAmt": 136952000,
           "lowstBidPrcIndctCont": "86279400", "cltrOpbdDt": "202609301000", "pbctStatCd": "0010",
           "pbctStatNm": "낙찰", "scfbAmt": "88200000", "vldBddrNope": 1, "apslPrcCtrsScfbPrcRto": 64.4,
           "lowstBidCtrsScfbPrcRto": 102.23}


def test_result_parsing_real_row():
    res = results.to_result(WIN_ROW)
    assert res == {"stat": "낙찰", "amt": 88200000, "rate": 64.4, "mrate": 102.2, "bidders": 1,
                   "opbd": "2026-09-30 10:00", "nsq": "1"}
    rec = results.to_archive_record(WIN_ROW)
    assert rec["sido"] == "강원" and rec["area"] == 152 and rec["res"]["amt"] == 88200000
    fail = results.to_result({**WIN_ROW, "pbctStatCd": "0011", "pbctStatNm": "유찰", "scfbAmt": None})
    assert fail["stat"] == "유찰" and fail["amt"] is None and fail["rate"] is None
    no_apsl = results.to_result({**WIN_ROW, "apslEvlAmt": None, "apslPrcCtrsScfbPrcRto": None})
    assert no_apsl["rate"] is None and no_apsl["mrate"] == 102.2
    assert sido_of("전남광주통합특별시 장흥군 장흥읍") == "광주·전남"


def test_latest_by_item_keeps_newest_round():
    rows = [{**WIN_ROW, "cltrOpbdDt": "202609231000", "pbctStatCd": "0011"}, WIN_ROW]
    best = results.latest_by_item(rows)
    assert results.to_result(best["2025-0900-063750"])["stat"] == "낙찰"


def _act(id_, end, **kw):
    return {"id": id_, "src": "온비드", "kind": "물건", "title": id_, "end": end, "first_seen": "x",
            "usage": "토지 > 대지", **kw}


def test_build_archive_flow():
    today = NOW.strftime("%Y-%m-%d")
    prev = {"onbid:A": _act("onbid:A", "2026-10-02 17:00"), "onbid:GONE": _act("onbid:GONE", "2026-10-05"),
            "lh:1": {**_act("lh:1", "2026-09-29"), "src": "LH", "kind": "공고", "prpt": "토지"}}
    active = {"onbid:A": _act("onbid:A", "2026-10-02 17:00"), "onbid:B": _act("onbid:B", "2026-10-03"),
              "lh:1": {**_act("lh:1", "2026-09-29"), "src": "LH", "kind": "공고"}}
    archive = {"onbid:OLD": {**_act("onbid:OLD", "2026-05-01"), "closed": "2026-05-01"}}
    rows = {"A": {**WIN_ROW, "cltrMngNo": "A"},                                    # 진행 중 → 낙찰
            "B": {**WIN_ROW, "cltrMngNo": "B", "pbctStatCd": "0011", "pbctStatNm": "유찰"},  # 진행 중 유찰
            "NEW": {**WIN_ROW, "cltrMngNo": "NEW"},                                # 처음 보는 낙찰
            "NEWFAIL": {**WIN_ROW, "cltrMngNo": "NEWFAIL", "pbctStatCd": "0011"}}  # 처음 보는 유찰 → 무시
    extra = [{"id": "board:r1", "src": "GH", "kind": "결과공고", "title": "결과", "end": "2026-09-25",
              "res": {"stat": "결과공고", "opbd": "2026-09-25"}}]
    import collect
    act, arch = collect.build(active, prev, archive, rows, extra, "2026-09-30 09:00", today, 90)
    act_ids = {r["id"] for r in act}
    arch_by = {r["id"]: r for r in arch}
    assert act_ids == {"onbid:B"}
    assert active["onbid:B"]["last"]["stat"] == "유찰"
    assert arch_by["onbid:A"]["res"]["amt"] == 88200000 and arch_by["onbid:A"]["status"] == "낙찰"
    assert "onbid:GONE" in arch_by and "lh:1" in arch_by  # 목록에서 빠짐 / 마감 지남
    assert "onbid:NEW" in arch_by and "onbid:NEWFAIL" not in arch_by
    assert "board:r1" in arch_by
    assert "onbid:OLD" not in arch_by  # 90일 지남 → 삭제


def test_board_menu_discovery_filters(monkeypatch):
    html = """<nav><a href="/sale/land.do">토지분양</a><a href="/recruit.do">채용공고</a>
              <a href="/notice.do">공지사항·공고</a><a href="https://other.com/x">분양정보</a></nav>"""
    monkeypatch.setattr(boards, "_soup", lambda url: BeautifulSoup(html, "html.parser"))
    got = boards.discover_boards("https://www.ex.or.kr", 5)
    assert got == ["https://www.ex.or.kr/sale/land.do", "https://www.ex.or.kr/notice.do"]


def test_dev_land_filters():
    from common import dev_category, is_dev_title, is_land_record
    assert dev_category("화성동탄2 C-3블록 주상복합용지 공급") == "주상복합·복합"
    assert dev_category("평택고덕 A-12BL 공동주택용지 공급공고") == "공동주택"
    assert dev_category("세종 4-1 업무시설용지 매각") == "상업·업무"
    assert is_dev_title("2026년 제3차 토지 공급 공고")           # 용도 미표기 일반 공고는 포함
    assert not is_dev_title("단독주택용지(점포겸용) 추첨 공급")    # 소규모 용도 제외
    assert not is_dev_title("근린생활시설용지 입찰")
    assert not is_dev_title("아파트 잔여세대 분양")
    base = {"kind": "물건", "usage": "토지 > 대지", "ot": "지방공기업", "prpt": "공유재산", "title": "x"}
    assert is_land_record({**base, "area": 3500})
    assert not is_land_record({**base, "area": 800})
    assert is_land_record({**base, "area": 800, "title": "OO지구 공동주택용지"})
    assert not is_land_record({**base, "area": 9000, "ot": "신탁사"})
    assert not is_land_record({**base, "area": 9000, "prpt": "압류재산"})
    assert not is_land_record({**base, "area": 9000, "usage": "주거용건물 > 아파트"})
    assert is_land_record({"kind": "공고", "src": "LH", "title": "인천검단 AA-30 공공주택용지 공급", "usage": ""})
    soup = BeautifulSoup('<ul><li><a href="a">아파트 분양 공고</a> 2026-09-20</li>'
                         '<li><a href="b">국민임대 공동주택용지 공급 공고</a> 2026-09-20</li>'
                         '<li><a href="c">중심상업용지 입찰 공고</a> 2026-09-20</li>'
                         '<li><a href="d">이주자택지 공급 안내</a> 2026-09-20</li></ul>', "html.parser")
    recs = boards.extract_notices("https://ex.or.kr/", soup, {"name": "X"}, since="2026-01-01")
    assert [(r["title"], r["cat"]) for r in recs] == [("국민임대 공동주택용지 공급 공고", "공동주택"),
                                                      ("중심상업용지 입찰 공고", "상업·업무")]


def test_zoning_text_and_vworld_parse():
    from common import norm_zone, zone_of
    import zoning
    assert zone_of("OO지구 C1 (제2종일반주거지역) 공동주택용지") == "제2종일반주거"
    assert zone_of("중심상업지역 내 상업용지") == "중심상업"
    assert zone_of("준주거지역") == "준주거" and zone_of("준주거용지 C4-2") == ""   # 용지명만으로는 추정하지 않음
    assert norm_zone("제3종일반주거지역") == "제3종일반주거" and norm_zone("자연녹지지역") == "자연녹지"
    data = {"landCharacteristicss": {"field": [
        {"stdrYear": "2024", "prposArea1Nm": "자연녹지지역"},
        {"stdrYear": "2025", "prposArea1Nm": "제2종일반주거지역"}]}}
    assert zoning.parse(data) == "제2종일반주거"
    items = [{"id": "onbid:A", "kind": "물건", "pnu": "123", "zone": ""}]
    st = zoning.enrich(items, {"onbid:A": {"zone": "준주거", "zone_src": "vworld"}}, log=lambda *_: None)
    assert items[0]["zone"] == "준주거" and st["ok"]
