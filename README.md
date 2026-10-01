# 공공 매각공고 모아보기

온비드·LH·SH·광역/기초 도시공사의 **토지·부동산 매각공고**를 매일 **오전 8시·오후 2시·오후 6시(KST)** 자동으로 모아
하나의 웹페이지로 보여주는 사이트입니다. 서버 없이 GitHub(무료)만으로 돌아갑니다.

- 검색(주소·물건명·기관명), 지역·기관유형·재산유형 필터, 최저가 범위
- 정렬: 마감 임박 / 최근 등록 / 최저가 / 감정가 대비 비율
- **신규** 표시(직전 갱신 이후 새로 올라온 것), D-day, 유찰 횟수
- 필터 상태가 주소(URL)에 남아서 즐겨찾기·공유 가능
- 하단 **수집 상태**에서 출처별 성공/실패를 확인

## 수집 출처

| 출처 | 방식 | 내용 |
|---|---|---|
| 온비드 | 공공데이터포털 OpenAPI | 입찰 진행·예정인 부동산 물건 전체 (압류·국유·공유·기타일반재산). 이용기관명으로 LH·SH·도시공사·지자체·신탁사 등 자동 분류 |
| LH | 공공데이터포털 OpenAPI | 토지·상가 분양/공급 공고 |
| SH·도시공사 | 홈페이지 게시판 읽기 | `collector/sources.yaml` 목록(광역 15곳 + 기초 10곳). 온비드에 없는 분양·매각 공고 보완 |

공공기관·지방공기업 매각 물건은 대부분 온비드에도 등록되므로, 기초 지자체 공사의 물건은 **온비드 탭에서 기관유형 '지방공기업'**으로 가장 넓게 볼 수 있습니다.

---

## 처음 설정 (약 15분)

### 1. 공공데이터포털 서비스키 받기 (무료)
1. <https://www.data.go.kr> 회원가입·로그인
2. 아래 두 서비스를 검색해서 각각 **[활용신청]** (용도는 "개인 조회용 웹사이트" 정도로 입력). 대부분 즉시 승인, 늦어도 1~2시간
   - `한국자산관리공사_차세대 온비드 부동산 물건목록 조회서비스`
   - `한국토지주택공사_분양임대공고문 조회 서비스`
3. 마이페이지 → 개발계정 → 신청한 서비스 → **일반 인증키 (Decoding)** 값을 복사
   (두 서비스 모두 같은 키를 씁니다)

### 2. GitHub 저장소 만들기
1. GitHub 로그인 → 오른쪽 위 **+** → **New repository**
2. 이름 예: `gonggo-board`, **Public** 선택(무료 Pages 조건) → **Create repository**
3. 이 폴더의 파일을 올립니다. 가장 쉬운 방법은 저장소 화면의 **uploading an existing file** 링크를 눌러
   압축을 푼 폴더 안의 내용 전체를 끌어다 놓고 **Commit changes**
   - ⚠️ `.github` 폴더는 숨김 폴더라 탐색기/Finder에서 안 보일 수 있습니다. 올린 뒤 저장소에
     `.github/workflows/update.yml` 이 없다면: **Add file → Create new file**, 파일 이름에
     `.github/workflows/update.yml` 입력, 이 폴더의 같은 파일 내용을 붙여넣고 커밋하세요.

### 3. 서비스키 등록
저장소 **Settings → Secrets and variables → Actions → New repository secret**
- Name `ONBID_API_KEY`, Secret: 1단계에서 복사한 키
- Name `LH_API_KEY`, Secret: 같은 키

### 4. 웹사이트 켜기
**Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택

### 5. 첫 수집 실행
**Actions** 탭 → (처음이면 활성화 버튼 클릭) → 왼쪽 **매각공고 수집·배포** → **Run workflow**
5~15분 뒤 초록색 체크가 뜨면 사이트 주소에서 확인:
`https://<GitHub아이디>.github.io/gonggo-board/`

이후로는 매일 08:00·14:00·18:00에 자동으로 갱신됩니다. (GitHub 서버 사정으로 10~30분 늦어질 수 있습니다.)

---

## 자주 하는 조정

- **기관 추가·게시판 지정**: `collector/sources.yaml` 에 한 줄 추가. 첫 실행 후 수집 상태에서 0건인 기관은
  그 기관 홈페이지의 매각/분양 공고 게시판 목록 URL을 `boards: ["https://…"]` 로 넣으면 정확해집니다.
- **수의계약 가능 물건 포함**(유찰 후 수의계약으로 전환된 물건, 주로 신탁사 약 1만여 건):
  Settings → Secrets and variables → Actions → **Variables** 탭 → `ONBID_INCLUDE_PVCT` = `true`
- **갱신 시각 변경**: `.github/workflows/update.yml` 의 `cron` 두 줄 (UTC 기준, KST−9시간)

## 알아둘 점
- 수집 실패 시 해당 출처의 **직전 데이터를 유지**하고 수집 상태에 오류를 표시합니다. 모두 실패하면 워크플로가
  실패로 끝나 GitHub가 이메일로 알려줍니다.
- 일부 기관 홈페이지는 목록을 자바스크립트로 그리거나 해외 접속(GitHub 서버는 해외)을 막아 0건일 수 있습니다.
  그런 기관도 온비드에 올린 물건은 온비드 탭에 나옵니다.
- 공고 요약 정보이므로 입찰 전 반드시 원문 공고를 확인하세요.

## 로컬에서 실행해 보기
```bash
pip install -r requirements.txt pytest
python -m pytest tests -q
ONBID_API_KEY=발급키 LH_API_KEY=발급키 python collector/collect.py
cd site && python -m http.server 8000   # http://localhost:8000
```
