"""오프라인 테스트: python -m pytest tests -q"""
import sys
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collector"))

import boards  # noqa: E402
import lh  # noqa: E402
import onbid  # noqa: E402
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
            "apslEvlAmt": "100000000", "lowstBidPrcIndctCont": "90000000", "pbctStatCd": "0002",
            "pbctStatNm": "0002", "landSqms": "330.5", "pvctTrgtYn": "N"}
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
    r = onbid.to_records(items, now=NOW)[0]
    assert r["bgn"] == "" and r["end"] == ""
    assert r["apsl"] == 256000000 and r["minp"] == 373248000
    assert r["ot"] == "신탁사" and r["sido"] == "경기" and r["area"] == 62.45
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


def test_board_menu_discovery_filters(monkeypatch):
    html = """<nav><a href="/sale/land.do">토지분양</a><a href="/recruit.do">채용공고</a>
              <a href="/notice.do">공지사항·공고</a><a href="https://other.com/x">분양정보</a></nav>"""
    monkeypatch.setattr(boards, "_soup", lambda url: BeautifulSoup(html, "html.parser"))
    got = boards.discover_boards("https://www.ex.or.kr", 5)
    assert got == ["https://www.ex.or.kr/sale/land.do", "https://www.ex.or.kr/notice.do"]
