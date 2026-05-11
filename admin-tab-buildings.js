(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  // 서울시 25개 구 법정동 목록 (행정안전부 공식 법정동 코드 2025-08-07 기준)
    // 시도별 법정동 목록 (초기값: 서울만 하드코딩. 다른 시/도는 dong-list-full.json 에서 lazy fetch)
  const DONG_LIST_BY_SIDO = {
    "서울특별시": {
      "강남구": [
        { code: "1168010100", name: "역삼동" }, { code: "1168010300", name: "개포동" },
        { code: "1168010400", name: "청담동" }, { code: "1168010500", name: "삼성동" },
        { code: "1168010600", name: "대치동" }, { code: "1168010700", name: "신사동" },
        { code: "1168010800", name: "논현동" }, { code: "1168011000", name: "압구정동" },
        { code: "1168011100", name: "세곡동" }, { code: "1168011200", name: "자곡동" },
        { code: "1168011300", name: "율현동" }, { code: "1168011400", name: "일원동" },
        { code: "1168011500", name: "수서동" }, { code: "1168011800", name: "도곡동" },
      ],
      "강동구": [
        { code: "1174010100", name: "명일동" }, { code: "1174010200", name: "고덕동" },
        { code: "1174010300", name: "상일동" }, { code: "1174010500", name: "길동" },
        { code: "1174010600", name: "둔촌동" }, { code: "1174010700", name: "암사동" },
        { code: "1174010800", name: "성내동" }, { code: "1174010900", name: "천호동" },
        { code: "1174011000", name: "강일동" },
      ],
      "강북구": [
        { code: "1130510100", name: "미아동" }, { code: "1130510200", name: "번동" },
        { code: "1130510300", name: "수유동" }, { code: "1130510400", name: "우이동" },
      ],
      "강서구": [
        { code: "1150010100", name: "염창동" }, { code: "1150010200", name: "등촌동" },
        { code: "1150010300", name: "화곡동" }, { code: "1150010400", name: "가양동" },
        { code: "1150010500", name: "마곡동" }, { code: "1150010600", name: "내발산동" },
        { code: "1150010700", name: "외발산동" }, { code: "1150010800", name: "공항동" },
        { code: "1150010900", name: "방화동" }, { code: "1150011000", name: "개화동" },
        { code: "1150011100", name: "과해동" }, { code: "1150011200", name: "오곡동" },
        { code: "1150011300", name: "오쇠동" },
      ],
      "관악구": [
        { code: "1162010100", name: "봉천동" }, { code: "1162010200", name: "신림동" },
        { code: "1162010300", name: "남현동" },
      ],
      "광진구": [
        { code: "1121510100", name: "중곡동" }, { code: "1121510200", name: "능동" },
        { code: "1121510300", name: "구의동" }, { code: "1121510400", name: "광장동" },
        { code: "1121510500", name: "자양동" }, { code: "1121510700", name: "화양동" },
        { code: "1121510900", name: "군자동" },
      ],
      "구로구": [
        { code: "1153010100", name: "신도림동" }, { code: "1153010200", name: "구로동" },
        { code: "1153010300", name: "가리봉동" }, { code: "1153010600", name: "고척동" },
        { code: "1153010700", name: "개봉동" }, { code: "1153010800", name: "오류동" },
        { code: "1153010900", name: "궁동" }, { code: "1153011000", name: "온수동" },
        { code: "1153011100", name: "천왕동" }, { code: "1153011200", name: "항동" },
      ],
      "금천구": [
        { code: "1154510100", name: "가산동" }, { code: "1154510200", name: "독산동" },
        { code: "1154510300", name: "시흥동" },
      ],
      "노원구": [
        { code: "1135010200", name: "월계동" }, { code: "1135010300", name: "공릉동" },
        { code: "1135010400", name: "하계동" }, { code: "1135010500", name: "상계동" },
        { code: "1135010600", name: "중계동" },
      ],
      "도봉구": [
        { code: "1132010500", name: "쌍문동" }, { code: "1132010600", name: "방학동" },
        { code: "1132010700", name: "창동" }, { code: "1132010800", name: "도봉동" },
      ],
      "동대문구": [
        { code: "1123010100", name: "신설동" }, { code: "1123010200", name: "용두동" },
        { code: "1123010300", name: "제기동" }, { code: "1123010400", name: "전농동" },
        { code: "1123010500", name: "답십리동" }, { code: "1123010600", name: "장안동" },
        { code: "1123010700", name: "청량리동" }, { code: "1123010800", name: "회기동" },
        { code: "1123010900", name: "휘경동" }, { code: "1123011000", name: "이문동" },
      ],
      "동작구": [
        { code: "1159010100", name: "노량진동" }, { code: "1159010200", name: "상도동" },
        { code: "1159010300", name: "상도1동" }, { code: "1159010400", name: "본동" },
        { code: "1159010500", name: "흑석동" }, { code: "1159010600", name: "동작동" },
        { code: "1159010700", name: "사당동" }, { code: "1159010800", name: "대방동" },
        { code: "1159010900", name: "신대방동" },
      ],
      "마포구": [
        { code: "1144010100", name: "아현동" }, { code: "1144010200", name: "공덕동" },
        { code: "1144010300", name: "신공덕동" }, { code: "1144010400", name: "도화동" },
        { code: "1144010500", name: "용강동" }, { code: "1144010600", name: "토정동" },
        { code: "1144010700", name: "마포동" }, { code: "1144010800", name: "대흥동" },
        { code: "1144010900", name: "염리동" }, { code: "1144011000", name: "노고산동" },
        { code: "1144011100", name: "신수동" }, { code: "1144011200", name: "현석동" },
        { code: "1144011300", name: "구수동" }, { code: "1144011400", name: "창전동" },
        { code: "1144011500", name: "상수동" }, { code: "1144011600", name: "하중동" },
        { code: "1144011700", name: "신정동" }, { code: "1144011800", name: "당인동" },
        { code: "1144012000", name: "서교동" }, { code: "1144012100", name: "동교동" },
        { code: "1144012200", name: "합정동" }, { code: "1144012300", name: "망원동" },
        { code: "1144012400", name: "연남동" }, { code: "1144012500", name: "성산동" },
        { code: "1144012600", name: "중동" }, { code: "1144012700", name: "상암동" },
      ],
      "서대문구": [
        { code: "1141010100", name: "충정로2가" }, { code: "1141010200", name: "충정로3가" },
        { code: "1141010300", name: "합동" }, { code: "1141010400", name: "미근동" },
        { code: "1141010500", name: "냉천동" }, { code: "1141010600", name: "천연동" },
        { code: "1141010700", name: "옥천동" }, { code: "1141010800", name: "영천동" },
        { code: "1141010900", name: "현저동" }, { code: "1141011000", name: "북아현동" },
        { code: "1141011100", name: "홍제동" }, { code: "1141011200", name: "대현동" },
        { code: "1141011300", name: "대신동" }, { code: "1141011400", name: "신촌동" },
        { code: "1141011500", name: "봉원동" }, { code: "1141011600", name: "창천동" },
        { code: "1141011700", name: "연희동" }, { code: "1141011800", name: "홍은동" },
        { code: "1141011900", name: "북가좌동" }, { code: "1141012000", name: "남가좌동" },
      ],
      "서초구": [
        { code: "1165010100", name: "방배동" }, { code: "1165010200", name: "양재동" },
        { code: "1165010300", name: "우면동" }, { code: "1165010400", name: "원지동" },
        { code: "1165010600", name: "잠원동" }, { code: "1165010700", name: "반포동" },
        { code: "1165010800", name: "서초동" }, { code: "1165010900", name: "내곡동" },
        { code: "1165011000", name: "염곡동" }, { code: "1165011100", name: "신원동" },
      ],
      "성동구": [
        { code: "1120010100", name: "상왕십리동" }, { code: "1120010200", name: "하왕십리동" },
        { code: "1120010300", name: "홍익동" }, { code: "1120010400", name: "도선동" },
        { code: "1120010500", name: "마장동" }, { code: "1120010600", name: "사근동" },
        { code: "1120010700", name: "행당동" }, { code: "1120010800", name: "응봉동" },
        { code: "1120010900", name: "금호동1가" }, { code: "1120011000", name: "금호동2가" },
        { code: "1120011100", name: "금호동3가" }, { code: "1120011200", name: "금호동4가" },
        { code: "1120011300", name: "옥수동" }, { code: "1120011400", name: "성수동1가" },
        { code: "1120011500", name: "성수동2가" }, { code: "1120011800", name: "송정동" },
        { code: "1120012200", name: "용답동" },
      ],
      "성북구": [
        { code: "1129010100", name: "성북동" }, { code: "1129010200", name: "성북동1가" },
        { code: "1129010300", name: "돈암동" }, { code: "1129010400", name: "동소문동1가" },
        { code: "1129010500", name: "동소문동2가" }, { code: "1129010600", name: "동소문동3가" },
        { code: "1129010700", name: "동소문동4가" }, { code: "1129010800", name: "동소문동5가" },
        { code: "1129010900", name: "동소문동6가" }, { code: "1129011000", name: "동소문동7가" },
        { code: "1129011100", name: "삼선동1가" }, { code: "1129011200", name: "삼선동2가" },
        { code: "1129011300", name: "삼선동3가" }, { code: "1129011400", name: "삼선동4가" },
        { code: "1129011500", name: "삼선동5가" }, { code: "1129011600", name: "동선동1가" },
        { code: "1129011700", name: "동선동2가" }, { code: "1129011800", name: "동선동3가" },
        { code: "1129011900", name: "동선동4가" }, { code: "1129012000", name: "동선동5가" },
        { code: "1129012100", name: "안암동1가" }, { code: "1129012200", name: "안암동2가" },
        { code: "1129012300", name: "안암동3가" }, { code: "1129012400", name: "안암동4가" },
        { code: "1129012500", name: "안암동5가" }, { code: "1129012600", name: "보문동4가" },
        { code: "1129012700", name: "보문동5가" }, { code: "1129012800", name: "보문동6가" },
        { code: "1129012900", name: "보문동7가" }, { code: "1129013000", name: "보문동1가" },
        { code: "1129013100", name: "보문동2가" }, { code: "1129013200", name: "보문동3가" },
        { code: "1129013300", name: "정릉동" }, { code: "1129013400", name: "길음동" },
        { code: "1129013500", name: "종암동" }, { code: "1129013600", name: "하월곡동" },
        { code: "1129013700", name: "상월곡동" }, { code: "1129013800", name: "장위동" },
        { code: "1129013900", name: "석관동" },
      ],
      "송파구": [
        { code: "1171010100", name: "잠실동" }, { code: "1171010200", name: "신천동" },
        { code: "1171010300", name: "풍납동" }, { code: "1171010400", name: "송파동" },
        { code: "1171010500", name: "석촌동" }, { code: "1171010600", name: "삼전동" },
        { code: "1171010700", name: "가락동" }, { code: "1171010800", name: "문정동" },
        { code: "1171010900", name: "장지동" }, { code: "1171011100", name: "방이동" },
        { code: "1171011200", name: "오금동" }, { code: "1171011300", name: "거여동" },
        { code: "1171011400", name: "마천동" },
      ],
      "양천구": [
        { code: "1147010100", name: "신정동" }, { code: "1147010200", name: "목동" },
        { code: "1147010300", name: "신월동" },
      ],
      "영등포구": [
        { code: "1156010100", name: "영등포동" }, { code: "1156010200", name: "영등포동1가" },
        { code: "1156010300", name: "영등포동2가" }, { code: "1156010400", name: "영등포동3가" },
        { code: "1156010500", name: "영등포동4가" }, { code: "1156010600", name: "영등포동5가" },
        { code: "1156010700", name: "영등포동6가" }, { code: "1156010800", name: "영등포동7가" },
        { code: "1156010900", name: "영등포동8가" }, { code: "1156011000", name: "여의도동" },
        { code: "1156011100", name: "당산동1가" }, { code: "1156011200", name: "당산동2가" },
        { code: "1156011300", name: "당산동3가" }, { code: "1156011400", name: "당산동4가" },
        { code: "1156011500", name: "당산동5가" }, { code: "1156011600", name: "당산동6가" },
        { code: "1156011700", name: "당산동" }, { code: "1156011800", name: "도림동" },
        { code: "1156011900", name: "문래동1가" }, { code: "1156012000", name: "문래동2가" },
        { code: "1156012100", name: "문래동3가" }, { code: "1156012200", name: "문래동4가" },
        { code: "1156012300", name: "문래동5가" }, { code: "1156012400", name: "문래동6가" },
        { code: "1156012500", name: "양평동1가" }, { code: "1156012600", name: "양평동2가" },
        { code: "1156012700", name: "양평동3가" }, { code: "1156012800", name: "양평동4가" },
        { code: "1156012900", name: "양평동5가" }, { code: "1156013000", name: "양평동6가" },
        { code: "1156013100", name: "양화동" }, { code: "1156013200", name: "신길동" },
        { code: "1156013300", name: "대림동" }, { code: "1156013400", name: "양평동" },
      ],
      "용산구": [
        { code: "1117010100", name: "후암동" }, { code: "1117010200", name: "용산동2가" },
        { code: "1117010300", name: "용산동4가" }, { code: "1117010400", name: "갈월동" },
        { code: "1117010500", name: "남영동" }, { code: "1117010600", name: "용산동1가" },
        { code: "1117010700", name: "동자동" }, { code: "1117010800", name: "서계동" },
        { code: "1117010900", name: "청파동1가" }, { code: "1117011000", name: "청파동2가" },
        { code: "1117011100", name: "청파동3가" }, { code: "1117011200", name: "원효로1가" },
        { code: "1117011300", name: "원효로2가" }, { code: "1117011400", name: "신창동" },
        { code: "1117011500", name: "산천동" }, { code: "1117011600", name: "청암동" },
        { code: "1117011700", name: "원효로3가" }, { code: "1117011800", name: "원효로4가" },
        { code: "1117011900", name: "효창동" }, { code: "1117012000", name: "도원동" },
        { code: "1117012100", name: "용문동" }, { code: "1117012200", name: "문배동" },
        { code: "1117012300", name: "신계동" }, { code: "1117012400", name: "한강로1가" },
        { code: "1117012500", name: "한강로2가" }, { code: "1117012600", name: "용산동3가" },
        { code: "1117012700", name: "용산동5가" }, { code: "1117012800", name: "한강로3가" },
        { code: "1117012900", name: "이촌동" }, { code: "1117013000", name: "이태원동" },
        { code: "1117013100", name: "한남동" }, { code: "1117013200", name: "동빙고동" },
        { code: "1117013300", name: "서빙고동" }, { code: "1117013400", name: "주성동" },
        { code: "1117013500", name: "용산동6가" }, { code: "1117013600", name: "보광동" },
      ],
      "은평구": [
        { code: "1138010100", name: "수색동" }, { code: "1138010200", name: "녹번동" },
        { code: "1138010300", name: "불광동" }, { code: "1138010400", name: "갈현동" },
        { code: "1138010500", name: "구산동" }, { code: "1138010600", name: "대조동" },
        { code: "1138010700", name: "응암동" }, { code: "1138010800", name: "역촌동" },
        { code: "1138010900", name: "신사동" }, { code: "1138011000", name: "증산동" },
        { code: "1138011400", name: "진관동" },
      ],
      "종로구": [
        { code: "1111010100", name: "청운동" }, { code: "1111010200", name: "신교동" },
        { code: "1111010300", name: "궁정동" }, { code: "1111010400", name: "효자동" },
        { code: "1111010500", name: "창성동" }, { code: "1111010600", name: "통의동" },
        { code: "1111010700", name: "적선동" }, { code: "1111010800", name: "통인동" },
        { code: "1111010900", name: "누상동" }, { code: "1111011000", name: "누하동" },
        { code: "1111011100", name: "옥인동" }, { code: "1111011200", name: "체부동" },
        { code: "1111011300", name: "필운동" }, { code: "1111011400", name: "내자동" },
        { code: "1111011500", name: "사직동" }, { code: "1111011600", name: "도렴동" },
        { code: "1111011700", name: "당주동" }, { code: "1111011800", name: "내수동" },
        { code: "1111011900", name: "세종로" }, { code: "1111012000", name: "신문로1가" },
        { code: "1111012100", name: "신문로2가" }, { code: "1111012200", name: "청진동" },
        { code: "1111012300", name: "서린동" }, { code: "1111012400", name: "수송동" },
        { code: "1111012500", name: "중학동" }, { code: "1111012600", name: "종로1가" },
        { code: "1111012700", name: "공평동" }, { code: "1111012800", name: "관훈동" },
        { code: "1111012900", name: "견지동" }, { code: "1111013000", name: "와룡동" },
        { code: "1111013100", name: "권농동" }, { code: "1111013200", name: "운니동" },
        { code: "1111013300", name: "익선동" }, { code: "1111013400", name: "경운동" },
        { code: "1111013500", name: "관철동" }, { code: "1111013600", name: "인사동" },
        { code: "1111013700", name: "낙원동" }, { code: "1111013800", name: "종로2가" },
        { code: "1111013900", name: "팔판동" }, { code: "1111014000", name: "삼청동" },
        { code: "1111014100", name: "안국동" }, { code: "1111014200", name: "소격동" },
        { code: "1111014300", name: "화동" }, { code: "1111014400", name: "사간동" },
        { code: "1111014500", name: "송현동" }, { code: "1111014600", name: "가회동" },
        { code: "1111014700", name: "재동" }, { code: "1111014800", name: "계동" },
        { code: "1111014900", name: "원서동" }, { code: "1111015000", name: "훈정동" },
        { code: "1111015100", name: "묘동" }, { code: "1111015200", name: "봉익동" },
        { code: "1111015300", name: "돈의동" }, { code: "1111015400", name: "장사동" },
        { code: "1111015500", name: "관수동" }, { code: "1111015600", name: "종로3가" },
        { code: "1111015700", name: "인의동" }, { code: "1111015800", name: "예지동" },
        { code: "1111015900", name: "원남동" }, { code: "1111016000", name: "연지동" },
        { code: "1111016100", name: "종로4가" }, { code: "1111016200", name: "효제동" },
        { code: "1111016300", name: "종로5가" }, { code: "1111016400", name: "종로6가" },
        { code: "1111016500", name: "이화동" }, { code: "1111016600", name: "연건동" },
        { code: "1111016700", name: "충신동" }, { code: "1111016800", name: "동숭동" },
        { code: "1111016900", name: "혜화동" }, { code: "1111017000", name: "명륜1가" },
        { code: "1111017100", name: "명륜2가" }, { code: "1111017200", name: "명륜4가" },
        { code: "1111017300", name: "명륜3가" }, { code: "1111017400", name: "창신동" },
        { code: "1111017500", name: "숭인동" }, { code: "1111017600", name: "교남동" },
        { code: "1111017700", name: "평동" }, { code: "1111017800", name: "송월동" },
        { code: "1111017900", name: "홍파동" }, { code: "1111018000", name: "교북동" },
        { code: "1111018100", name: "행촌동" }, { code: "1111018200", name: "구기동" },
        { code: "1111018300", name: "평창동" }, { code: "1111018400", name: "부암동" },
        { code: "1111018500", name: "홍지동" }, { code: "1111018600", name: "신영동" },
        { code: "1111018700", name: "무악동" },
      ],
      "중구": [
        { code: "1114010100", name: "무교동" }, { code: "1114010200", name: "다동" },
        { code: "1114010300", name: "태평로1가" }, { code: "1114010400", name: "을지로1가" },
        { code: "1114010500", name: "을지로2가" }, { code: "1114010600", name: "남대문로1가" },
        { code: "1114010700", name: "삼각동" }, { code: "1114010800", name: "수하동" },
        { code: "1114010900", name: "장교동" }, { code: "1114011000", name: "수표동" },
        { code: "1114011100", name: "소공동" }, { code: "1114011200", name: "남창동" },
        { code: "1114011300", name: "북창동" }, { code: "1114011400", name: "태평로2가" },
        { code: "1114011500", name: "남대문로2가" }, { code: "1114011600", name: "남대문로3가" },
        { code: "1114011700", name: "남대문로4가" }, { code: "1114011800", name: "남대문로5가" },
        { code: "1114011900", name: "봉래동1가" }, { code: "1114012000", name: "봉래동2가" },
        { code: "1114012100", name: "회현동1가" }, { code: "1114012200", name: "회현동2가" },
        { code: "1114012300", name: "회현동3가" }, { code: "1114012400", name: "충무로1가" },
        { code: "1114012500", name: "충무로2가" }, { code: "1114012600", name: "명동1가" },
        { code: "1114012700", name: "명동2가" }, { code: "1114012800", name: "남산동1가" },
        { code: "1114012900", name: "남산동2가" }, { code: "1114013000", name: "남산동3가" },
        { code: "1114013100", name: "저동1가" }, { code: "1114013200", name: "충무로4가" },
        { code: "1114013300", name: "충무로5가" }, { code: "1114013400", name: "인현동2가" },
        { code: "1114013500", name: "예관동" }, { code: "1114013600", name: "묵정동" },
        { code: "1114013700", name: "필동1가" }, { code: "1114013800", name: "필동2가" },
        { code: "1114013900", name: "필동3가" }, { code: "1114014000", name: "남학동" },
        { code: "1114014100", name: "주자동" }, { code: "1114014200", name: "예장동" },
        { code: "1114014300", name: "장충동1가" }, { code: "1114014400", name: "장충동2가" },
        { code: "1114014500", name: "광희동1가" }, { code: "1114014600", name: "광희동2가" },
        { code: "1114014700", name: "쌍림동" }, { code: "1114014800", name: "을지로6가" },
        { code: "1114014900", name: "을지로7가" }, { code: "1114015000", name: "을지로4가" },
        { code: "1114015100", name: "을지로5가" }, { code: "1114015200", name: "주교동" },
        { code: "1114015300", name: "방산동" }, { code: "1114015400", name: "오장동" },
        { code: "1114015500", name: "을지로3가" }, { code: "1114015600", name: "입정동" },
        { code: "1114015700", name: "산림동" }, { code: "1114015800", name: "충무로3가" },
        { code: "1114015900", name: "초동" }, { code: "1114016000", name: "인현동1가" },
        { code: "1114016100", name: "저동2가" }, { code: "1114016200", name: "신당동" },
        { code: "1114016300", name: "흥인동" }, { code: "1114016400", name: "무학동" },
        { code: "1114016500", name: "황학동" }, { code: "1114016600", name: "서소문동" },
        { code: "1114016700", name: "정동" }, { code: "1114016800", name: "순화동" },
        { code: "1114016900", name: "의주로1가" }, { code: "1114017000", name: "충정로1가" },
        { code: "1114017100", name: "중림동" }, { code: "1114017200", name: "의주로2가" },
        { code: "1114017300", name: "만리동1가" }, { code: "1114017400", name: "만리동2가" },
      ],
      "중랑구": [
        { code: "1126010100", name: "면목동" }, { code: "1126010200", name: "상봉동" },
        { code: "1126010300", name: "중화동" }, { code: "1126010400", name: "묵동" },
        { code: "1126010500", name: "망우동" }, { code: "1126010600", name: "신내동" },
      ],
    }
  };;

  // 현재 선택된 시도의 구 → 동 맵
  // 초기 상태: 서울만 내장. 다른 시도 선택 시 dong-list-full.json 을 fetch 해서 확장
  var DONG_LIST = DONG_LIST_BY_SIDO["서울특별시"];
  var CURRENT_SIDO = "서울특별시";
  var FULL_LIST_LOADED = false;  // dong-list-full.json 이 이미 로드됐는지

  async function ensureFullSidoList() {
    // 이미 로드됐으면 패스
    if (FULL_LIST_LOADED) return;
    try {
      var res = await fetch("./dong-list-full.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var all = await res.json();
      // 각 시도를 DONG_LIST_BY_SIDO 에 병합 (서울은 이미 있으므로 덮어쓰기)
      for (var sido in all) {
        DONG_LIST_BY_SIDO[sido] = all[sido];
      }
      FULL_LIST_LOADED = true;
    } catch (e) {
      console.warn("dong-list-full.json 로드 실패:", e && e.message);
      // 실패 시 서울만 계속 사용
    }
  }

  function switchSido(sido) {
    CURRENT_SIDO = sido || "서울특별시";
    DONG_LIST = DONG_LIST_BY_SIDO[CURRENT_SIDO] || {};
    // 기존 선택 초기화 (시도 바뀌면 이전 코드들 유효성 없음)
    selectedDongs.clear();
  }

  let selectedDongs = new Set();
  let isRunning = false;
  let shouldStop = false;

  function getProxyUrl() {
    return document.querySelector('meta[name="vworld-proxy-url"]')?.getAttribute("content")?.replace("vworld-proxy", "building-collector") || "";
  }

  async function getAuthHeaders() {
    var headers = {};
    var K = window.KNSN || {};

    // anon key 취득: Supabase 클라이언트 → localStorage → meta 태그
    var anonKey = "";
    try {
      if (typeof K.initSupabase === "function") {
        var sb = K.initSupabase();
        if (sb && sb.supabaseKey) anonKey = String(sb.supabaseKey).trim();
      }
    } catch (e) {}
    if (!anonKey) {
      try { anonKey = String(localStorage.getItem("knson_supabase_key") || "").trim(); } catch (e) {}
    }
    if (!anonKey) {
      anonKey = (document.querySelector('meta[name="supabase-anon-key"]') || {}).content || "";
    }

    // Supabase Edge Function 호출 표준 헤더
    if (anonKey) {
      headers["apikey"] = anonKey;
      headers["Authorization"] = "Bearer " + anonKey;
    }

    return headers;
  }

  function $(id) { return document.getElementById(id); }

  function escHtml(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function fmtDate(iso) {
    if (!iso) return "-";
    try { var d = new Date(iso); return d.toLocaleDateString("ko-KR") + " " + d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
  }

  function appendLog(msg) {
    var el = $("bldLog");
    if (!el) return;
    el.innerHTML += '<div>' + escHtml(new Date().toLocaleTimeString("ko-KR")) + ' ' + escHtml(msg) + '</div>';
    el.scrollTop = el.scrollHeight;
  }

  // ── 동 선택 UI ──
  // region(시/군/구)을 반드시 선택해야 동 목록이 표시됨. 미선택 시 가이드 메시지.
  function renderDongGrid(region) {
    var grid = $("bldDongGrid");
    if (!grid) return;

    if (!region) {
      grid.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted);text-align:center;">좌측 상단에서 <b>시/군/구</b> 를 선택하면 해당 법정동 목록이 표시됩니다.</div>';
      updateSelectedCount();
      return;
    }

    var dongs = DONG_LIST[region] || [];
    if (!dongs.length) {
      grid.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted);text-align:center;">이 시/군/구의 법정동 정보가 없습니다.</div>';
      updateSelectedCount();
      return;
    }

    grid.innerHTML = dongs.map(function(d) {
      var checked = selectedDongs.has(d.code) ? "checked" : "";
      // 인라인 스타일로 외부 CSS 유무와 무관하게 칩 모양 보장
      var baseStyle = "display:inline-flex;align-items:center;gap:4px;padding:4px 10px;margin:2px;border-radius:16px;border:1px solid var(--line,#E5E7EB);background:var(--surface,#fff);font-size:11px;font-weight:600;cursor:pointer;user-select:none;";
      var activeStyle = "background:#FFF3E0;border-color:#F37022;color:#E65100;";
      var style = baseStyle + (checked ? activeStyle : "");
      return '<label class="bld-dong-chip' + (checked ? ' is-checked' : '') + '" style="' + style + '">' +
        '<input type="checkbox" value="' + d.code + '" data-name="' + escHtml(d.name) + '" ' + checked + ' style="display:none;" />' +
        '<span>' + escHtml(d.name) + '</span></label>';
    }).join("");
    // 이벤트
    grid.querySelectorAll("input[type=checkbox]").forEach(function(cb) {
      cb.addEventListener("change", function() {
        if (cb.checked) selectedDongs.add(cb.value); else selectedDongs.delete(cb.value);
        var label = cb.parentElement;
        label.classList.toggle("is-checked", cb.checked);
        // 인라인 스타일 갱신
        var baseStyle = "display:inline-flex;align-items:center;gap:4px;padding:4px 10px;margin:2px;border-radius:16px;border:1px solid var(--line,#E5E7EB);background:var(--surface,#fff);font-size:11px;font-weight:600;cursor:pointer;user-select:none;";
        var activeStyle = "background:#FFF3E0;border-color:#F37022;color:#E65100;";
        label.setAttribute("style", baseStyle + (cb.checked ? activeStyle : ""));
        updateSelectedCount();
      });
    });
    updateSelectedCount();
  }

  function updateSelectedCount() {
    var el = $("bldSelectedCount");
    if (el) {
      el.textContent = selectedDongs.size + "개 선택";
      // [UX 개선 2026-05-11] 0개일 때 회색, 1개 이상이면 브랜드 강조
      el.setAttribute("data-empty", selectedDongs.size === 0 ? "true" : "false");
    }
    var disabled = selectedDongs.size === 0 || isRunning;
    var ids = [
      "bldBtnCollect", "bldBtnEnrich",
      "bldBtnEnrichV2", "bldBtnCollectAtch",
      "bldBtnEnrichRecap", "bldBtnEnrichExtras", "bldBtnEnrichPrice",
      "bldBtnBatchAll"
    ];
    for (var i = 0; i < ids.length; i++) {
      var b = $(ids[i]);
      if (b) b.disabled = disabled;
    }
  }

  // ── 수집 실행 ──
  async function runCollect() {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;

    // Supabase 세션 동기화
    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }

    isRunning = true; shouldStop = false;
    $("bldBtnCollect").disabled = true;
    $("bldBtnEnrich").disabled = true;
    $("bldBtnStop").classList.remove("hidden");
    $("bldProgress").classList.remove("hidden");
    $("bldLog").innerHTML = "";

    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();

    // 인증 사전 검증
    if (!headers["Authorization"]) {
      appendLog("❌ 인증 토큰을 가져올 수 없습니다. 다시 로그인 후 시도해 주세요.");
      isRunning = false;
      $("bldBtnStop").classList.add("hidden");
      updateSelectedCount();
      return;
    }

    var total = dongs.length;
    // ── pagination 안전장치 ──
    // Supabase Edge Function 은 wall-clock 한도(~150s)에 걸리면
    // 한 번 호출에 처리 가능한 필지만 처리하고 부분 응답을 반환한다.
    // 따라서 동당 단일 호출(v3 방식) 로는 표제부 수집이 미완료로 끝난다.
    // 다른 모드(enrich_v2/collect_atch/geocode 등) 와 동일하게
    // done=true 또는 더 이상 처리할 필지가 없을 때까지 반복 호출한다.
    var COLLECT_MAX_ROUNDS = 30;       // 동당 최대 라운드 (안전상한)
    var COLLECT_SLEEP_MS = 300;        // 라운드 간 sleep — 서버/quota 보호
    var COLLECT_STALL_LIMIT = 2;       // 누적 카운트 정체 시 종료 라운드 수

    for (var i = 0; i < total; i++) {
      if (shouldStop) { appendLog("사용자에 의해 중단됨"); break; }
      var code = dongs[i];
      var name = findDongName(code);

      var collectDone = false;
      var round = 0;
      var dongCumulativeParcels = 0;
      var dongCumulativeInserted = 0;
      var prevReportedParcels = -1;
      var stallRounds = 0;

      appendLog(name + " 표제부 수집 시작...");

      while (!collectDone && !shouldStop && round < COLLECT_MAX_ROUNDS) {
        round++;
        $("bldProgressLabel").textContent = "표제부 수집: " + name + " (" + (i+1) + "/" + total + " · 라운드 " + round + ")";
        $("bldProgressPct").textContent = Math.round(((i+1)/total)*100) + "%";
        $("bldProgressBar").style.width = Math.round(((i+1)/total)*100) + "%";

        try {
          var collectUrl = baseUrl + "?mode=collect&dongCode=" + encodeURIComponent(code) + "&dongName=" + encodeURIComponent(name);
          var res = await fetch(collectUrl, { headers: headers });
          if (res.status === 401) {
            var errBody = await res.text().catch(function() { return ""; });
            appendLog(name + " ❌ 인증 실패(401): " + errBody);
            appendLog("토큰 갱신을 시도합니다...");
            if (typeof K.sbSyncLocalSession === "function") {
              try { await K.sbSyncLocalSession(true); } catch (e) {}
            }
            headers = await getAuthHeaders();
            if (!headers["Authorization"]) {
              appendLog("❌ 토큰 갱신 실패. 다시 로그인해 주세요.");
              collectDone = true;
              shouldStop = true;
              break;
            }
            // 재시도
            res = await fetch(collectUrl, { headers: headers });
          }

          var data = await res.json();

          if (data && data.error) {
            appendLog(name + " ❌ " + data.error);
            collectDone = true;
            break;
          }

          if (!data || !data.ok) {
            appendLog(name + " ❌ 응답 비정상: " + JSON.stringify(data || {}).slice(0, 200));
            collectDone = true;
            break;
          }

          // server-side note 가 있으면 표시
          if (data.note) appendLog("ℹ️ " + name + ": " + data.note);

          // 필드 추출 — Edge Function 이 round-incremental 을 주든 cumulative 를 주든 모두 안전하게 처리
          var roundParcels  = Number(data.parcels  || 0);
          var roundInserted = Number(data.inserted || data.unitsInserted || 0);
          var totalBldNow   = Number(data.total_buildings || data.totalBuildings || 0);
          dongCumulativeParcels  += roundParcels;
          dongCumulativeInserted += roundInserted;

          $("bldProgressDetail").textContent =
            name + " · 라운드 " + round +
            " · parcels=" + dongCumulativeParcels +
            (dongCumulativeInserted ? " inserted=" + dongCumulativeInserted : "") +
            (totalBldNow ? " total=" + totalBldNow : "");

          // 종료 판정 (3중 안전망)
          //   1) 서버가 명시적으로 done=true 신호 → 즉시 종료
          //   2) 이번 라운드에서 처리/삽입 모두 0 → 더 처리할 필지 없음
          //   3) 누적 응답값이 같은 값으로 stall (cumulative 응답 케이스 대비)
          if (data.done === true) {
            collectDone = true;
          } else if (roundParcels === 0 && roundInserted === 0) {
            // 서버가 일관되게 round 단위로 응답한 경우: 더 할 일 없음
            collectDone = true;
          } else if (roundParcels > 0 && roundParcels === prevReportedParcels) {
            // 서버가 cumulative 단위로 응답하는 경우: 같은 값이 반복되면 stall
            stallRounds++;
            if (stallRounds >= COLLECT_STALL_LIMIT) {
              appendLog("ℹ️ " + name + " · 진행 정체 감지(라운드 " + round + ") — 다음 동으로 이동");
              collectDone = true;
            }
          } else {
            stallRounds = 0;
          }
          prevReportedParcels = roundParcels;

        } catch (e) {
          appendLog(name + " ❌ 오류: " + (e && e.message));
          collectDone = true;
          break;
        }

        if (!collectDone && !shouldStop && COLLECT_SLEEP_MS > 0) {
          await new Promise(function(r) { setTimeout(r, COLLECT_SLEEP_MS); });
        }
      }

      if (!collectDone && round >= COLLECT_MAX_ROUNDS) {
        appendLog("⚠️ " + name + " · 최대 라운드(" + COLLECT_MAX_ROUNDS + ") 도달 — 다음 동으로 이동 (필요 시 재실행)");
      }
      appendLog(name + " ✅ 표제부 수집 종료 · 라운드 " + round +
                " · 누적 parcels=" + dongCumulativeParcels +
                (dongCumulativeInserted ? " · inserted=" + dongCumulativeInserted : ""));
    }

    // v3 에는 표제부 수집 직후 자동으로 enrich (전유부+지오코딩) 이 실행되었습니다.
    // v4/v5 부터는 버튼별 단일 책임 원칙으로, [표제부 수집] 은 표제부만 합니다.
    // 이어서 보충이 필요하면 [전유부+지오코딩] 버튼을 눌러주세요.
    // 또는 상단의 [🚀 일괄 실행] 바에서 원하는 모드를 체크 후 [선택 모드 일괄 실행] 하시면 됩니다.

    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    $("bldProgressLabel").textContent = shouldStop ? "중단됨" : "표제부 수집 완료";
    updateSelectedCount();
    appendLog("── 표제부 수집 " + (shouldStop ? "중단" : "완료") + " ──");
    if (!shouldStop) {
      appendLog("💡 다음 단계: [전유부+공용면적] → [지오코딩] 순서 권장, 혹은 [🚀 일괄 실행] 사용");
    }
    loadStatus();
    loadUsage();
  }

  // ── 지오코딩 (주소 → 좌표) ──
  // v3 'enrich' 에 포함되어 있던 전유부 합계 로직은 v4 'enrich_v2' 가 더 완전하게 커버함.
  // 이 버튼은 순수 지오코딩만 수행 (mode=geocode).
  async function runEnrichOnly() {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;
    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }
    isRunning = true; shouldStop = false;
    updateSelectedCount();  // 모든 버튼 disable
    $("bldBtnStop").classList.remove("hidden");
    $("bldProgress").classList.remove("hidden");
    $("bldLog").innerHTML = "";
    appendLog("── 지오코딩 시작 (동 " + dongs.length + "개) ──");

    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();

    for (var j = 0; j < dongs.length; j++) {
      if (shouldStop) { appendLog("⛔ 중단됨"); break; }
      var code = dongs[j];
      var name = findDongName(code);
      var done = false;
      var round = 0;
      var totalGeo = 0;
      while (!done && !shouldStop && round < 100) {
        round++;
        $("bldProgressLabel").textContent = "지오코딩: " + name + " (라운드 " + round + ")";
        $("bldProgressPct").textContent = Math.round(((j+1)/dongs.length)*100) + "%";
        try {
          var res = await fetch(baseUrl + "?mode=geocode&dongCode=" + code + "&limit=50", { headers: headers });
          if (res.status === 401) {
            if (typeof K.sbSyncLocalSession === "function") { try { await K.sbSyncLocalSession(true); } catch {} }
            headers = await getAuthHeaders();
            res = await fetch(baseUrl + "?mode=geocode&dongCode=" + code + "&limit=50", { headers: headers });
          }
          var data = await res.json();
          if (data.error) { appendLog(name + " 오류: " + data.error); done = true; break; }
          totalGeo += (data.geocoded || 0);
          $("bldProgressDetail").textContent = "geocoded=" + totalGeo + " remaining=" + (data.remaining || 0);
          if (data.done === true) { done = true; appendLog(name + " 지오코딩 완료 ✅ (geocoded=" + totalGeo + ")"); }
          else if ((data.processed || 0) === 0) { done = true; appendLog(name + " 처리할 항목 없음"); }
        } catch (e) {
          appendLog(name + " 지오코딩 오류: " + e.message);
          done = true;
        }
      }
    }
    appendLog("── 지오코딩 " + (shouldStop ? "중단" : "완료") + " ──");
    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    updateSelectedCount();
    loadStatus();
    loadUsage();
  }

  function findDongName(code) {
    // 현재 시/도부터 검색 (흔한 경우)
    for (var region in DONG_LIST) {
      for (var d of DONG_LIST[region]) { if (d.code === code) return d.name; }
    }
    // 다른 시/도도 순회 (lazy load 된 경우)
    for (var sido in DONG_LIST_BY_SIDO) {
      if (sido === CURRENT_SIDO) continue;
      var sidoGus = DONG_LIST_BY_SIDO[sido];
      for (var gu in sidoGus) {
        for (var d2 of sidoGus[gu]) { if (d2.code === code) return d2.name; }
      }
    }
    return code;
  }

  // ── v4 확장 모드 제네릭 실행 ──
  // mode: "enrich_v2" | "collect_atch" | "enrich_recap" | "enrich_extras" | "enrich_price"
  // label: 사용자 노출용 한글 라벨
  async function runEnrichV4(mode, label, opts) {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;

    opts = opts || {};
    var limitPerCall = opts.limitPerCall || 15;   // 한 번 호출에 처리할 건물 수
    var maxRounds = opts.maxRounds || 50;          // 동당 최대 반복 호출 (안전 상한)
    var sleepBetween = opts.sleepBetween || 300;   // ms
    var doneWhenProcessedZero = opts.doneWhenProcessedZero !== false;  // 기본 true
    // [개선 2026-05-11] 한도(maxRounds)에 의존하지 않고 자연스럽게 끝까지 진행하기 위한 옵션
    //  - stallLimit: 서버 remaining 값이 N라운드 연속으로 같으면 진행 정체로 보고 종료
    //  - autoContinue: 한도 도달 시 즉시 종료 대신 콘솔에 명확히 안내
    var stallLimit = opts.stallLimit || 3;

    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }

    isRunning = true; shouldStop = false;
    updateSelectedCount();  // 모든 버튼 disable
    $("bldBtnStop").classList.remove("hidden");
    $("bldProgress").classList.remove("hidden");
    $("bldLog").innerHTML = "";
    appendLog("── " + label + " 시작 (동 " + dongs.length + "개) ──");

    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();

    var totalDongProcessed = 0;
    var grandTotals = { processed: 0, inserted: 0, enriched: 0, geocoded: 0 };

    for (var j = 0; j < dongs.length; j++) {
      if (shouldStop) { appendLog("⛔ 중단됨"); break; }
      var code = dongs[j];
      var name = findDongName(code);

      var done = false;
      var round = 0;
      var dongTotals = { processed: 0, inserted: 0, enriched: 0, geocoded: 0 };
      // [개선 2026-05-11] 진행 정체 감지용 상태 — 동마다 초기화
      var prevRemaining = -1;
      var stallRounds = 0;
      var hitMaxRounds = false;

      while (!done && !shouldStop && round < maxRounds) {
        round++;
        $("bldProgressLabel").textContent = label + ": " + name + " (라운드 " + round + ")";
        $("bldProgressPct").textContent = Math.round(((j) / dongs.length) * 100) + "%";

        try {
          var url = baseUrl + "?mode=" + encodeURIComponent(mode) +
                    "&dongCode=" + encodeURIComponent(code) +
                    "&limit=" + limitPerCall;
          var res = await fetch(url, { headers: headers });

          // 401 → 세션 갱신 후 재시도
          if (res.status === 401) {
            if (typeof K.sbSyncLocalSession === "function") {
              try { await K.sbSyncLocalSession(true); } catch (e) {}
            }
            headers = await getAuthHeaders();
            res = await fetch(url, { headers: headers });
          }

          var data = await res.json();

          if (data && data.error) {
            appendLog(name + " " + label + " 오류: " + data.error);
            done = true;
            break;
          }

          // 서버에서 note 메시지 전달 시 로그 출력
          if (data && data.note) {
            appendLog("ℹ️ " + name + ": " + data.note);
          }

          // 통계 누적
          var processed = Number(data.processed || 0);
          var inserted = Number(data.inserted || data.unitsInserted || 0);
          var enriched = Number(data.enriched || 0);
          var geocoded = Number(data.geocoded || 0);
          dongTotals.processed += processed;
          dongTotals.inserted += inserted;
          dongTotals.enriched += enriched;
          dongTotals.geocoded += geocoded;

          // [개선 2026-05-11] 진행 상황 표시에 remaining 도 포함 → 사용자가 끝까지 갈지 가늠 가능
          var remainingTxt = (typeof data.remaining === "number") ? (" · remaining=" + data.remaining) : "";
          $("bldProgressDetail").textContent =
            "processed=" + dongTotals.processed +
            " inserted=" + dongTotals.inserted +
            (dongTotals.enriched ? " enriched=" + dongTotals.enriched : "") +
            (dongTotals.geocoded ? " geocoded=" + dongTotals.geocoded : "") +
            remainingTxt;

          // 종료 조건
          if (data.done === true) {
            done = true;
          } else if (doneWhenProcessedZero && processed === 0 && inserted === 0 && enriched === 0) {
            // 더 이상 처리할 대상 없음
            done = true;
          } else if (
            typeof data.remaining === "number" &&
            data.remaining === prevRemaining &&
            processed === 0 && inserted === 0 && enriched === 0
          ) {
            // [수정 2026-05-11] stall 감지는 "처리 진척이 0건일 때만" 작동.
            //   서버의 remaining 값은 PostgREST 기본 한도(1,000건)에 캡될 수 있어
            //   실제 진척이 일어나고 있어도 값이 같아 보일 수 있음 → processed/inserted 조건 추가.
            stallRounds++;
            if (stallRounds >= stallLimit) {
              appendLog("⚠️ " + name + " · 진행 정체 감지 (처리 0건이 " + stallLimit + "라운드 연속, 라운드 " + round + ") — 다음 동으로 이동");
              done = true;
            }
          } else {
            // 정상적으로 진행 중이면 stall 카운터 리셋
            stallRounds = 0;
          }
          if (typeof data.remaining === "number") prevRemaining = data.remaining;
        } catch (e) {
          appendLog(name + " " + label + " 네트워크 오류: " + e.message);
          done = true;
        }

        if (sleepBetween > 0 && !done) {
          await new Promise(function(r) { setTimeout(r, sleepBetween); });
        }
      }

      // [개선 2026-05-11] 한도(maxRounds) 도달로 끝난 경우 명확히 안내
      if (!done && round >= maxRounds) {
        hitMaxRounds = true;
        appendLog("⚠️ " + name + " · 한 번에 처리 가능한 한도(" + maxRounds + "라운드 = 약 " +
                  (maxRounds * limitPerCall).toLocaleString("ko-KR") + "건) 도달. " +
                  "남은 분은 같은 버튼을 한 번 더 눌러주세요.");
      }

      appendLog(name + " " + label + (hitMaxRounds ? " 일부 완료" : " 완료") +
                " · processed=" + dongTotals.processed +
                " inserted=" + dongTotals.inserted +
                (dongTotals.enriched ? " enriched=" + dongTotals.enriched : "") +
                (dongTotals.geocoded ? " geocoded=" + dongTotals.geocoded : ""));
      grandTotals.processed += dongTotals.processed;
      grandTotals.inserted += dongTotals.inserted;
      grandTotals.enriched += dongTotals.enriched;
      grandTotals.geocoded += dongTotals.geocoded;
      totalDongProcessed++;
    }

    $("bldProgressLabel").textContent = label + " 완료";
    $("bldProgressPct").textContent = "100%";
    $("bldProgressDetail").textContent =
      "동 " + totalDongProcessed + "개 · processed=" + grandTotals.processed +
      " inserted=" + grandTotals.inserted +
      (grandTotals.enriched ? " enriched=" + grandTotals.enriched : "") +
      (grandTotals.geocoded ? " geocoded=" + grandTotals.geocoded : "");
    appendLog("── " + label + " 전체 완료 ✅ ──");

    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    updateSelectedCount();
    loadStatus();
    loadUsage();  // 사용량 카드 갱신
  }

  // ── 일괄 실행 ──
  // 체크박스로 선택된 모드들을 선택된 동들에 대해 순차 실행
  // 실행 순서: collect → enrich_v2 → collect_atch → enrich_recap → enrich_extras → enrich_price
  async function runBatchAll() {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;

    // 체크된 모드 수집
    // [개선 2026-05-11] maxRounds 확대 — 한 번 일괄 실행으로 동당 5,000~10,000건 처리.
    //   stall 감지가 있어 더 처리할 게 없으면 자동 종료. maxRounds 는 안전 상한선.
    var sequence = [
      { id: "bldBatchOpt_collect",       mode: "collect",       label: "표제부",         isCollect: true },
      { id: "bldBatchOpt_enrich_v2",     mode: "enrich_v2",     label: "전유부+공용면적", isV4: true, opts: { limitPerCall: 10, maxRounds: 1000 } },
      { id: "bldBatchOpt_geocode",       mode: "geocode",       label: "지오코딩",       isGeo: true },
      { id: "bldBatchOpt_collect_atch",  mode: "collect_atch",  label: "부속지번",       isV4: true, opts: { limitPerCall: 20, maxRounds: 500 } },
      { id: "bldBatchOpt_enrich_recap",  mode: "enrich_recap",  label: "총괄표제부",     isV4: true, opts: { limitPerCall: 10, maxRounds: 500 } },
      { id: "bldBatchOpt_enrich_extras", mode: "enrich_extras", label: "층별·지역·오수", isV4: true, opts: { limitPerCall: 10, maxRounds: 1000 } },
      { id: "bldBatchOpt_enrich_price",  mode: "enrich_price",  label: "공시가격",       isV4: true, opts: { limitPerCall: 10, maxRounds: 1000 } },
    ];
    var selected = sequence.filter(function(s) {
      var cb = $(s.id);
      return cb && cb.checked;
    });
    if (!selected.length) {
      alert("일괄 실행할 모드를 한 개 이상 선택해주세요.");
      return;
    }

    // 사용자 확인
    var msg = "선택된 동 " + dongs.length + "개 × 모드 " + selected.length + "개를 순차 실행합니다.\n\n" +
              "순서: " + selected.map(function(s){ return s.label; }).join(" → ") + "\n\n" +
              "API 호출이 대량 발생합니다. 사용량 한도를 확인했나요?\n\n계속하시겠습니까?";
    if (!confirm(msg)) return;

    appendLog("══════════════════════════════════════");
    appendLog("🚀 일괄 실행 시작: 동 " + dongs.length + "개 × 모드 " + selected.length + "개");
    appendLog("순서: " + selected.map(function(s){ return s.label; }).join(" → "));
    appendLog("══════════════════════════════════════");

    for (var si = 0; si < selected.length; si++) {
      if (shouldStop) { appendLog("⛔ 일괄 실행 중단됨"); break; }
      var step = selected[si];
      appendLog("── [" + (si+1) + "/" + selected.length + "] " + step.label + " 시작 ──");

      try {
        if (step.isCollect) {
          // collect 는 기존 runCollect 재사용 — 다만 그 함수는 자체 UI 초기화를 하므로 await 하고 끝나길 기다림
          await runCollect();
        } else if (step.isGeo) {
          // 지오코딩은 runEnrichOnly (내부는 mode=geocode 루프) 재사용
          await runEnrichOnly();
        } else if (step.isV4) {
          await runEnrichV4(step.mode, step.label, step.opts);
        }
      } catch (e) {
        appendLog("❌ " + step.label + " 예외: " + (e && e.message));
      }

      // 한 모드 끝나면 isRunning 이 풀렸지만, 다음 모드 실행을 위해 재설정 필요
      if (si < selected.length - 1 && !shouldStop) {
        // 잠깐 대기 (API rate 보호)
        await new Promise(function(r) { setTimeout(r, 1000); });
      }
    }

    appendLog("══════════════════════════════════════");
    appendLog("✅ 일괄 실행 전체 완료");
    appendLog("══════════════════════════════════════");
    loadStatus();
    loadUsage();
  }

  // ── 수집 잡 정리 (buildings 에 없는 동 제거) ──
  async function runCleanOrphanedJobs() {
    if (isRunning) return;
    if (!confirm("buildings 테이블에 없는 동의 수집 잡 기록을 제거합니다.\n실제 건물 데이터는 그대로 유지됩니다.\n\n계속하시겠습니까?")) return;

    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }
    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();
    try {
      var res = await fetch(baseUrl + "?mode=reset_jobs&scope=orphaned", { headers: headers });
      if (res.status === 401) {
        if (typeof K.sbSyncLocalSession === "function") {
          try { await K.sbSyncLocalSession(true); } catch (e) {}
        }
        headers = await getAuthHeaders();
        res = await fetch(baseUrl + "?mode=reset_jobs&scope=orphaned", { headers: headers });
      }
      var data = await res.json();
      if (data.error) {
        alert("정리 실패: " + data.error);
        return;
      }
      appendLog("🧹 잡 정리 완료: " + (data.deleted || 0) + "개 제거, " + (data.kept || 0) + "개 유지");
      loadStatus();
    } catch (e) {
      alert("정리 실패: " + (e && e.message));
    }
  }

  // ── 수집 잡 전체 초기화 ──
  async function runResetAllJobs() {
    if (isRunning) return;
    if (!confirm("⚠️ 수집 잡 기록을 모두 삭제합니다.\n실제 건물 데이터(buildings)는 그대로 유지됩니다.\n\n정말 계속하시겠습니까?")) return;

    var K = window.KNSN || {};
    if (typeof K.sbSyncLocalSession === "function") {
      try { await K.sbSyncLocalSession(); } catch (e) {}
    }
    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();
    try {
      var res = await fetch(baseUrl + "?mode=reset_jobs&scope=all", { headers: headers });
      if (res.status === 401) {
        if (typeof K.sbSyncLocalSession === "function") {
          try { await K.sbSyncLocalSession(true); } catch (e) {}
        }
        headers = await getAuthHeaders();
        res = await fetch(baseUrl + "?mode=reset_jobs&scope=all", { headers: headers });
      }
      var data = await res.json();
      if (data.error) {
        alert("초기화 실패: " + data.error);
        return;
      }
      appendLog("🗑 잡 전체 초기화 완료");
      loadStatus();
    } catch (e) {
      alert("초기화 실패: " + (e && e.message));
    }
  }

  // ── 상태 테이블 ──
  async function loadStatus() {
    var baseUrl = getProxyUrl();
    var headers = await getAuthHeaders();
    try {
      var res = await fetch(baseUrl + "?mode=status", { headers: headers });
      if (res.status === 401) {
        // 토큰 갱신 후 재시도
        var K = window.KNSN || {};
        if (typeof K.sbSyncLocalSession === "function") {
          try { await K.sbSyncLocalSession(true); } catch (e) {}
        }
        headers = await getAuthHeaders();
        res = await fetch(baseUrl + "?mode=status", { headers: headers });
      }
      var data = await res.json();
      renderStatus(data.jobs || []);
    } catch (e) {
      appendLog("상태 조회 실패: " + e.message);
    }
  }

  function renderStatus(jobs) {
    var tbody = $("bldStatusBody");
    var empty = $("bldStatusEmpty");
    if (!tbody) return;
    if (!jobs.length) { tbody.innerHTML = ""; if (empty) empty.classList.remove("hidden"); return; }
    if (empty) empty.classList.add("hidden");

    // 모드 코드 → 한글 라벨
    var MODE_LABEL = {
      "collect":        "표제부",
      "enrich":         "전유부+지오코딩",
      "enrich_v2":      "전유+공용",
      "geocode":        "지오코딩",
      "collect_atch":   "부속지번",
      "enrich_recap":   "총괄표제",
      "enrich_extras":  "층별·지역·오수",
      "enrich_price":   "공시가격"
    };

    tbody.innerHTML = jobs.map(function(j) {
      // 모드별 진행 칩 렌더링
      var titleCnt    = Number(j.title_count      || 0);
      var v2Cnt       = Number(j.enrich_v2_count  || 0);
      var geoCnt      = Number(j.geocode_count    || 0);
      var atchCnt     = Number(j.atch_count       || 0);
      var recapCnt    = Number(j.recap_count      || 0);
      var extrasCnt   = Number(j.extras_count     || 0);
      var priceCnt    = Number(j.price_count      || 0);
      var totalBld    = Number(j.total_buildings  || titleCnt || 0);

      // [UX 개선 2026-05-11] C안 — 미니바 + 분수 칩
      //   denom > 0  : 비율 기반 (분모 표시 + 진행바)
      //   denom = 0  : binary (있음/없음만)
      //   description (선택): 호버 툴팁에 모드 의미를 명시 → 0건이 "안 된 것"인지 "원래 없음"인지 구분
      //   색상은 CSS 클래스(.bld-pchip--idle/low/mid/done/has) 로 분리 → 다크모드 자동 대응
      function pchip(label, n, denom, description) {
        var cls = "bld-pchip--idle", pct = 0;
        var nFmt = Number(n).toLocaleString("ko-KR");
        var countText, tooltipText;
        if (denom > 0) {
          pct = Math.min(100, Math.round((n / denom) * 100));
          if (n === 0)            cls = "bld-pchip--idle";
          else if (pct >= 95)     cls = "bld-pchip--done";
          else if (pct >= 50)     cls = "bld-pchip--mid";
          else                    cls = "bld-pchip--low";
          countText = nFmt + "/" + Number(denom).toLocaleString("ko-KR");
          tooltipText = label + ": " + nFmt + " / " + Number(denom).toLocaleString("ko-KR") + " (" + pct + "%)";
          if (description) tooltipText = description + "\n" + tooltipText;
        } else {
          // binary 모드: n > 0 → has(녹색), 0 → idle(회색)
          cls = n > 0 ? "bld-pchip--has" : "bld-pchip--idle";
          pct = n > 0 ? 100 : 0;
          countText = nFmt + "건";
          tooltipText = label + ": " + nFmt + "건";
          if (description) tooltipText = description + "\n" + tooltipText;
        }
        var barWidth = pct + "%";
        return '<span class="bld-pchip ' + cls + '" title="' + escHtml(tooltipText) + '">' +
          '<span class="bld-pchip__top">' +
            '<span class="bld-pchip__label">' + escHtml(label) + '</span>' +
            '<span class="bld-pchip__count">' + escHtml(countText) + '</span>' +
          '</span>' +
          '<span class="bld-pchip__bar"><i style="width:' + barWidth + '"></i></span>' +
        '</span>';
      }

      // [UX 개선 2026-05-11] 모드별 표시 방식 차별화
      //   - 표제부 / 지오코딩: 모든 건물 대상이라 분수(미니바) 표시가 의미 있음
      //   - 전유+공용 / 부속지번 / 총괄표제 / 층별등 / 공시가: 일부 건물에만 해당하는 데이터.
      //     분모를 표제부 수로 잡으면 "거짓 미흡" 으로 표시되므로 절대 건수만 표시 (binary)
      var chips =
        pchip("표제부",     titleCnt,  totalBld, "동 전체 건물 중 표제부가 수집된 비율") +
        pchip("전유+공용",  v2Cnt,     0,        "전유부 호실 데이터가 저장된 건물 수 (집합건축물만 해당)") +
        pchip("지오코딩",   geoCnt,    totalBld, "좌표 변환이 완료된 건물 비율") +
        pchip("부속지번",   atchCnt,   0,        "부속 지번 정보가 있는 건물 수 (합필된 건물만 해당)") +
        pchip("총괄표제",   recapCnt,  0,        "단지 단위 총괄 정보가 있는 건물 수 (대단지만 해당)") +
        pchip("층별등",     extrasCnt, 0,        "층별·지역지구·오수정화 정보가 있는 건물 수") +
        pchip("공시가",     priceCnt,  0,        "공시가격 정보가 있는 호실/건물 수 (집합·거주만 해당)");

      // 마지막 모드 한글 변환
      var lastModeLabel = "";
      if (j.last_mode) {
        var label = MODE_LABEL[j.last_mode] || j.last_mode;
        lastModeLabel = '<span style="font-size:10px;color:var(--text-3);">' + escHtml(label) + '</span>';
      }

      return '<tr>' +
        '<td>' + escHtml(j.dong_name || j.dong_code) + '</td>' +
        '<td style="font-variant-numeric:tabular-nums;font-weight:600;">' + Number(totalBld).toLocaleString("ko-KR") + '</td>' +
        '<td><div class="bld-chip-row">' + chips + '</div></td>' +
        '<td>' + lastModeLabel + '</td>' +
        '<td style="font-size:10px;color:var(--text-3);">' + fmtDate(j.last_run_at || j.finished_at) + '</td>' +
        '</tr>';
    }).join("");
  }

  // ── API 사용량 ──
  async function loadUsage() {
    var baseUrl = getProxyUrl();
    if (!baseUrl) return;
    var headers = await getAuthHeaders();
    try {
      var res = await fetch(baseUrl + "?mode=usage&days=7&quota=10000", { headers: headers });
      if (res.status === 401) {
        var K = window.KNSN || {};
        if (typeof K.sbSyncLocalSession === "function") {
          try { await K.sbSyncLocalSession(true); } catch (e) {}
        }
        headers = await getAuthHeaders();
        res = await fetch(baseUrl + "?mode=usage&days=7&quota=10000", { headers: headers });
      }
      var data = await res.json();
      renderUsage(data && data.summary);
    } catch (e) {
      console.warn("usage load failed:", e && e.message);
    }
  }

  // 엔드포인트 한글 라벨 + 일일 한도 (각 10,000 독립)
  var ENDPOINT_LABELS = {
    "getBrTitleInfo":            { label: "표제부",       quota: 10000 },
    "getBrExposPubuseAreaInfo":  { label: "전유+공용면적",  quota: 10000 },
    "getBrBasisOulnInfo":        { label: "기본개요",     quota: 10000 },
    "getBrFlrOulnInfo":          { label: "층별개요",     quota: 10000 },
    "getBrExposInfo":            { label: "전유부",       quota: 10000 },
    "getBrRecapTitleInfo":       { label: "총괄표제부",   quota: 10000 },
    "getBrAtchJibunInfo":        { label: "부속지번",     quota: 10000 },
    "getBrJijiguInfo":           { label: "지역지구구역", quota: 10000 },
    "getBrWclfInfo":             { label: "오수정화시설", quota: 10000 },
    "getBrHsprcInfo":            { label: "공시가격",     quota: 10000 },
    "vworld_geocode":            { label: "지오코딩",     quota: 40000 }
  };

  // 엔드포인트 표시 순서 (자주 사용 순)
  var ENDPOINT_ORDER = [
    "getBrTitleInfo","getBrExposPubuseAreaInfo","vworld_geocode",
    "getBrRecapTitleInfo","getBrAtchJibunInfo",
    "getBrFlrOulnInfo","getBrJijiguInfo","getBrWclfInfo","getBrHsprcInfo",
    "getBrBasisOulnInfo","getBrExposInfo"
  ];

  // [UX 개선 2026-05-11] 주요/보조 그룹 분할
  //   주요: 일괄 실행 기본 체크 4종 + 지오코딩 = 일상 모니터링 대상
  //   보조: 가끔 쓰거나 향후 확장용 = 접기보다는 시각적 비중만 낮춤
  var ENDPOINT_GROUP_PRIMARY = ["getBrTitleInfo","getBrExposPubuseAreaInfo","vworld_geocode","getBrRecapTitleInfo","getBrAtchJibunInfo"];
  var ENDPOINT_GROUP_SECONDARY = ["getBrFlrOulnInfo","getBrJijiguInfo","getBrWclfInfo","getBrHsprcInfo","getBrBasisOulnInfo","getBrExposInfo"];

  function renderUsage(summary) {
    var $date = $("bldUsageDate");
    var $endpoints = $("bldUsageEndpoints");
    var $recent = $("bldUsageRecent");

    // 레거시 바·숫자 요소 (사용하지 않음 — 남아있으면 숨김 처리)
    ["bldUsageCount","bldUsagePct","bldUsageBar","bldUsageSuccess","bldUsageError","bldUsageRemaining"].forEach(function(id){
      var el = $(id); if (!el) return;
      var parent = el.closest && el.closest(".usage-legacy-line");
      if (parent) parent.style.display = "none";
    });

    if ($date) $date.textContent = summary && summary.today_date ? summary.today_date : new Date().toISOString().slice(0,10);

    // ── 엔드포인트별 카드 그리드 (주요/보조 2그룹) ──
    // [UX 개선 2026-05-11]
    //   1) 모든 인라인 스타일을 CSS 클래스(.bld-usage-card 등)로 이관 → 다크모드 자동 대응
    //   2) ENDPOINT_GROUP_PRIMARY/SECONDARY 로 시각적 그룹 분리
    if ($endpoints) {
      $endpoints.style.display = "";
      var byEp = (summary && summary.today_by_endpoint) || {};

      function cardHtml(ep) {
        var meta = ENDPOINT_LABELS[ep] || { label: ep, quota: 10000 };
        var used = Number(byEp[ep] || 0);
        var quota = meta.quota;
        var pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
        var remaining = Math.max(0, quota - used);

        // 상태 결정 (CSS 클래스가 색을 결정)
        var state = "idle";
        if (used === 0)        state = "idle";
        else if (pct >= 80)    state = "high";
        else if (pct >= 60)    state = "mid";
        else                   state = "low";

        return '<div class="bld-usage-card" data-state="' + state + '">' +
          '<div class="bld-usage-card__head">' +
            '<div>' +
              '<span class="bld-usage-card__name">' + escHtml(meta.label) + '</span> ' +
              '<span class="bld-usage-card__ep">' + escHtml(ep) + '</span>' +
            '</div>' +
            '<span class="bld-usage-card__pct">' + pct + '%</span>' +
          '</div>' +
          '<div class="bld-usage-card__bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="bld-usage-card__nums">' +
            '<span>' + used.toLocaleString("ko-KR") + ' / ' + quota.toLocaleString("ko-KR") + '</span>' +
            '<span>잔여 ' + remaining.toLocaleString("ko-KR") + '</span>' +
          '</div>' +
        '</div>';
      }

      var primaryHtml = ENDPOINT_GROUP_PRIMARY.map(cardHtml).join("");
      var secondaryHtml = ENDPOINT_GROUP_SECONDARY.map(cardHtml).join("");

      $endpoints.innerHTML =
        '<div class="bld-usage-section bld-usage-section--primary">' +
          '<div class="bld-usage-section__title">주요 엔드포인트</div>' +
          '<div class="bld-usage-grid">' + primaryHtml + '</div>' +
        '</div>' +
        '<div class="bld-usage-section">' +
          '<div class="bld-usage-section__title">보조 엔드포인트</div>' +
          '<div class="bld-usage-grid">' + secondaryHtml + '</div>' +
        '</div>';
    }

    // ── 최근 7일 추이 ──
    // [UX 개선 2026-05-11] 막대 위 호버 시 숫자 노출, 오늘/평균/최고 요약 통계 추가, 오늘은 강조
    if ($recent) {
      var recent = Array.isArray(summary && summary.recent_days) ? summary.recent_days : [];
      var totalRecent = Number(summary && summary.total_recent || 0);

      var days7 = [];
      var base = new Date();
      for (var di = 6; di >= 0; di--) {
        var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - di);
        var ymd = d.getFullYear() + "-" +
                  String(d.getMonth()+1).padStart(2,"0") + "-" +
                  String(d.getDate()).padStart(2,"0");
        days7.push(ymd);
      }
      var todayYmd = days7[days7.length - 1];

      var byDate = {};
      recent.forEach(function(r){ byDate[r.date] = Number(r.count || 0); });

      var counts7 = days7.map(function(y){ return Number(byDate[y]||0); });
      var maxInWeek = Math.max(1, Math.max.apply(null, counts7));
      var todayCnt = Number(byDate[todayYmd] || 0);
      var nonZero = counts7.filter(function(c){ return c > 0; });
      var avgInWeek = nonZero.length > 0 ? Math.round(nonZero.reduce(function(a,b){return a+b;},0) / nonZero.length) : 0;

      var bars = days7.map(function(ymd) {
        var cnt = Number(byDate[ymd] || 0);
        var h = cnt > 0 ? Math.max(2, Math.round((cnt / maxInWeek) * 38)) : 0;
        var datestr = ymd.slice(5).replace("-",".");
        var modCls = "";
        if (cnt === 0) modCls = " bld-trend__bar--zero";
        if (ymd === todayYmd) modCls += " bld-trend__bar--today";
        return '<div class="bld-trend__bar' + modCls + '" title="' + escHtml(ymd) + ': ' + cnt.toLocaleString("ko-KR") + '건">' +
          '<div class="bld-trend__bar-fill-wrap">' +
            '<span class="bld-trend__bar-value">' + cnt.toLocaleString("ko-KR") + '</span>' +
            '<div class="bld-trend__bar-fill" style="height:' + h + 'px"></div>' +
          '</div>' +
          '<div class="bld-trend__bar-label">' + escHtml(datestr) + '</div>' +
          '</div>';
      }).join("");

      $recent.innerHTML =
        '<div class="bld-trend">' +
          '<div class="bld-trend__head">' +
            '<div class="bld-trend__title">최근 7일 사용량 (총 ' + totalRecent.toLocaleString("ko-KR") + '건)</div>' +
            '<div class="bld-trend__stats">' +
              '<span>오늘 <b>' + todayCnt.toLocaleString("ko-KR") + '</b></span>' +
              '<span>일평균 <b>' + avgInWeek.toLocaleString("ko-KR") + '</b></span>' +
              '<span>최고 <b>' + maxInWeek.toLocaleString("ko-KR") + '</b></span>' +
            '</div>' +
          '</div>' +
          '<div class="bld-trend__chart">' + bars + '</div>' +
        '</div>';
    }
  }

  // ── 초기화 ──
  mod.init = function init() {
    var sidoSel = $("bldSidoSelect");
    var regionSel = $("bldRegionSelect");

    // 전국 17개 시/도 — 데이터 로드 여부와 무관하게 드롭다운에는 항상 노출
    var SIDO_ALL = [
      "서울특별시","부산광역시","대구광역시","인천광역시","광주광역시",
      "대전광역시","울산광역시","세종특별자치시","경기도","충청북도",
      "충청남도","전라남도","경상북도","경상남도","제주특별자치도",
      "강원특별자치도","전북특별자치도"
    ];

    function populateSidoSelect() {
      if (!sidoSel) return;
      var currentValue = sidoSel.value;
      sidoSel.innerHTML = '<option value="">▽ 시/도 선택</option>' +
        SIDO_ALL.map(function(s) { return '<option value="' + escHtml(s) + '">' + escHtml(s) + '</option>'; }).join("");
      if (currentValue && SIDO_ALL.indexOf(currentValue) >= 0) sidoSel.value = currentValue;
    }

    function populateRegionSelect() {
      if (!regionSel) return;
      var gus = Object.keys(DONG_LIST);
      regionSel.innerHTML = '<option value="">▽ 시/군/구 선택</option>' +
        gus.map(function(g) { return '<option value="' + escHtml(g) + '">' + escHtml(g) + '</option>'; }).join("");
    }

    // 시/도 변경 이벤트
    if (sidoSel) {
      sidoSel.addEventListener("change", async function() {
        var sido = sidoSel.value || "";
        if (!sido) {
          switchSido("");
          populateRegionSelect();
          renderDongGrid("");
          return;
        }
        // 서울 외 시도 선택 시: full JSON 이 아직 안 로드됐으면 lazy fetch
        if (sido !== "서울특별시" && !FULL_LIST_LOADED) {
          appendLog("전국 법정동 데이터를 로드하는 중...");
          await ensureFullSidoList();
          if (!FULL_LIST_LOADED) {
            appendLog("❌ 전국 법정동 데이터 로드 실패 — dong-list-full.json 을 확인하세요");
            // 로드 실패 시 서울로 복귀
            sidoSel.value = "서울특별시";
            switchSido("서울특별시");
            populateRegionSelect();
            renderDongGrid("");
            return;
          }
          appendLog("전국 법정동 데이터 로드 완료");
        }
        switchSido(sido);
        populateRegionSelect();
        renderDongGrid("");
      });
    }

    // 시/군/구 변경 이벤트
    if (regionSel) {
      regionSel.addEventListener("change", function() { renderDongGrid(regionSel.value); });
    }

    // 초기값: 서울특별시 자동 선택, 구 미선택 상태로 가이드 메시지 노출
    populateSidoSelect();
    if (sidoSel) sidoSel.value = "서울특별시";
    switchSido("서울특별시");
    populateRegionSelect();
    renderDongGrid("");

    // 전체선택: 현재 선택된 시/군/구 내 동만 선택
    if ($("bldSelectAll")) $("bldSelectAll").addEventListener("click", function() {
      var region = regionSel ? regionSel.value : "";
      if (!region) { alert("먼저 시/군/구를 선택해주세요."); return; }
      var dongs = DONG_LIST[region] || [];
      dongs.forEach(function(d) { selectedDongs.add(d.code); });
      renderDongGrid(region);
    });
    if ($("bldDeselectAll")) $("bldDeselectAll").addEventListener("click", function() {
      selectedDongs.clear();
      renderDongGrid(regionSel ? regionSel.value : "");
    });

    // 수집 버튼
    if ($("bldBtnCollect")) $("bldBtnCollect").addEventListener("click", function() { runCollect(); });
    if ($("bldBtnEnrich")) $("bldBtnEnrich").addEventListener("click", function() { runEnrichOnly(); });
    if ($("bldBtnStop")) $("bldBtnStop").addEventListener("click", function() { shouldStop = true; });
    if ($("bldBtnRefreshStatus")) $("bldBtnRefreshStatus").addEventListener("click", function() { loadStatus(); });
    if ($("bldBtnRefreshUsage")) $("bldBtnRefreshUsage").addEventListener("click", function() { loadUsage(); });

    // v4 확장 모드 버튼
    // [개선 2026-05-11] maxRounds 를 충분히 크게 늘려 한 번 클릭으로 한 동을 끝까지 처리.
    //   실제 종료는 서버의 done=true (remaining===0) 신호 또는 stall 감지로 자연스럽게 일어남.
    //   maxRounds 는 무한 루프 방지용 안전망 (정상 동작에선 거의 도달하지 않음).
    if ($("bldBtnEnrichV2")) $("bldBtnEnrichV2").addEventListener("click", function() {
      runEnrichV4("enrich_v2", "전유부+공용면적", { limitPerCall: 10, maxRounds: 2000 });
    });
    if ($("bldBtnCollectAtch")) $("bldBtnCollectAtch").addEventListener("click", function() {
      runEnrichV4("collect_atch", "부속지번", { limitPerCall: 20, maxRounds: 1000 });
    });
    if ($("bldBtnEnrichRecap")) $("bldBtnEnrichRecap").addEventListener("click", function() {
      runEnrichV4("enrich_recap", "총괄표제부", { limitPerCall: 10, maxRounds: 1000 });
    });
    if ($("bldBtnEnrichExtras")) $("bldBtnEnrichExtras").addEventListener("click", function() {
      runEnrichV4("enrich_extras", "층별·지역·오수", { limitPerCall: 10, maxRounds: 2000 });
    });
    if ($("bldBtnEnrichPrice")) $("bldBtnEnrichPrice").addEventListener("click", function() {
      runEnrichV4("enrich_price", "공시가격", { limitPerCall: 10, maxRounds: 2000 });
    });

    // 일괄 실행
    if ($("bldBtnBatchAll")) $("bldBtnBatchAll").addEventListener("click", function() { runBatchAll(); });

    // 잡 정리 / 전체 초기화
    if ($("bldBtnCleanJobs")) $("bldBtnCleanJobs").addEventListener("click", function() { runCleanOrphanedJobs(); });
    if ($("bldBtnResetJobs")) $("bldBtnResetJobs").addEventListener("click", function() { runResetAllJobs(); });

    // 초기 상태 로드 (세션 동기화 후)
    (async function() {
      var K = window.KNSN || {};
      if (typeof K.sbSyncLocalSession === "function") {
        try { await K.sbSyncLocalSession(); } catch (e) {}
      }
      loadStatus();
      loadUsage();
    })();
  };

  AdminModules.buildingsTab = mod;
})();
