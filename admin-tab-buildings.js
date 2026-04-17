(() => {
  const AdminModules = window.KNSN_ADMIN_MODULES = window.KNSN_ADMIN_MODULES || {};
  const mod = {};

  // 서울시 25개 구 법정동 목록 (행정안전부 공식 법정동 코드 2025-08-07 기준)
  const DONG_LIST = {
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
  };

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
  function renderDongGrid(region) {
    var grid = $("bldDongGrid");
    if (!grid) return;
    var dongs = region ? (DONG_LIST[region] || []) : Object.values(DONG_LIST).flat();
    grid.innerHTML = dongs.map(function(d) {
      var checked = selectedDongs.has(d.code) ? "checked" : "";
      return '<label class="bld-dong-chip' + (checked ? ' is-checked' : '') + '">' +
        '<input type="checkbox" value="' + d.code + '" data-name="' + escHtml(d.name) + '" ' + checked + ' />' +
        '<span>' + escHtml(d.name) + '</span></label>';
    }).join("");
    // 이벤트
    grid.querySelectorAll("input[type=checkbox]").forEach(function(cb) {
      cb.addEventListener("change", function() {
        if (cb.checked) selectedDongs.add(cb.value); else selectedDongs.delete(cb.value);
        cb.parentElement.classList.toggle("is-checked", cb.checked);
        updateSelectedCount();
      });
    });
    updateSelectedCount();
  }

  function updateSelectedCount() {
    var el = $("bldSelectedCount");
    if (el) el.textContent = selectedDongs.size + "개 선택";
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

    for (var i = 0; i < total; i++) {
      if (shouldStop) { appendLog("사용자에 의해 중단됨"); break; }
      var code = dongs[i];
      var name = findDongName(code);
      $("bldProgressLabel").textContent = "표제부 수집: " + name + " (" + (i+1) + "/" + total + ")";
      $("bldProgressPct").textContent = Math.round(((i+1)/total)*100) + "%";
      $("bldProgressBar").style.width = Math.round(((i+1)/total)*100) + "%";

      appendLog(name + " 표제부 수집 시작...");
      try {
        var res = await fetch(baseUrl + "?mode=collect&dongCode=" + code + "&dongName=" + encodeURIComponent(name), { headers: headers });
        if (res.status === 401) {
          var errBody = await res.text().catch(function() { return ""; });
          appendLog(name + " ❌ 인증 실패(401): " + errBody);
          appendLog("토큰 갱신을 시도합니다...");
          headers = await getAuthHeaders();
          if (!headers["Authorization"]) { appendLog("❌ 토큰 갱신 실패. 다시 로그인해 주세요."); break; }
          // 재시도
          res = await fetch(baseUrl + "?mode=collect&dongCode=" + code + "&dongName=" + encodeURIComponent(name), { headers: headers });
        }
        var data = await res.json();
        if (data.ok) {
          appendLog(name + " ✅ " + (data.parcels||0) + "필지 수집 완료");
        } else {
          appendLog(name + " ❌ " + (data.error||"실패"));
        }
      } catch (e) {
        appendLog(name + " ❌ 오류: " + e.message);
      }
    }

    // enrich 자동 실행
    if (!shouldStop) {
      appendLog("── 전유부+지오코딩 보충 시작 ──");
      $("bldProgressBar").style.width = "0%";
      $("bldProgressPct").textContent = "0%";
      $("bldProgressDetail").textContent = "";
      for (var j = 0; j < dongs.length; j++) {
        if (shouldStop) break;
        var code2 = dongs[j];
        var name2 = findDongName(code2);
        var enrichDone = false;
        var enrichRound = 0;
        $("bldProgressPct").textContent = Math.round(((j+1)/dongs.length)*100) + "%";
        $("bldProgressBar").style.width = Math.round(((j+1)/dongs.length)*100) + "%";
        while (!enrichDone && !shouldStop && enrichRound < 100) {
          enrichRound++;
          $("bldProgressLabel").textContent = "보충: " + name2 + " (라운드 " + enrichRound + ")";
          try {
            var eres = await fetch(baseUrl + "?mode=enrich&dongCode=" + code2 + "&limit=20", { headers: headers });
            var edata = await eres.json();
            if (edata.done) {
              enrichDone = true;
              appendLog(name2 + " 보충 완료 ✅");
            } else {
              $("bldProgressDetail").textContent = "enriched=" + (edata.enriched||0) + " geocoded=" + (edata.geocoded||0) + " remaining=" + (edata.remainingResidential||0);
            }
          } catch (e) {
            appendLog(name2 + " 보충 오류: " + e.message);
            enrichDone = true;
          }
        }
      }
    }

    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    $("bldProgressLabel").textContent = shouldStop ? "중단됨" : "완료";
    updateSelectedCount();
    appendLog("── 수집 작업 " + (shouldStop ? "중단" : "완료") + " ──");
    loadStatus();
    loadUsage();
  }

  // ── enrich만 실행 ──
  async function runEnrichOnly() {
    if (isRunning) return;
    var dongs = Array.from(selectedDongs);
    if (!dongs.length) return;
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

    for (var j = 0; j < dongs.length; j++) {
      if (shouldStop) break;
      var code = dongs[j];
      var name = findDongName(code);
      var enrichDone = false;
      var enrichRound = 0;
      while (!enrichDone && !shouldStop && enrichRound < 100) {
        enrichRound++;
        $("bldProgressLabel").textContent = "보충: " + name + " (" + enrichRound + "회)";
        $("bldProgressPct").textContent = Math.round(((j+1)/dongs.length)*100) + "%";
        try {
          var eres = await fetch(baseUrl + "?mode=enrich&dongCode=" + code + "&limit=20", { headers: headers });
          var edata = await eres.json();
          if (edata.done) { enrichDone = true; appendLog(name + " 보충 완료 ✅"); }
          else { $("bldProgressDetail").textContent = "enriched=" + (edata.enriched||0) + " remaining=" + (edata.remainingResidential||0); }
        } catch (e) { appendLog(name + " 보충 오류: " + e.message); enrichDone = true; }
      }
    }
    isRunning = false;
    $("bldBtnStop").classList.add("hidden");
    updateSelectedCount();
    loadStatus();
    loadUsage();
  }

  function findDongName(code) {
    for (var region in DONG_LIST) {
      for (var d of DONG_LIST[region]) { if (d.code === code) return d.name; }
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
    var maxRounds = opts.maxRounds || 50;          // 동당 최대 반복 호출
    var sleepBetween = opts.sleepBetween || 300;   // ms
    var doneWhenProcessedZero = opts.doneWhenProcessedZero !== false;  // 기본 true

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

          // 통계 누적
          var processed = Number(data.processed || 0);
          var inserted = Number(data.inserted || data.unitsInserted || 0);
          var enriched = Number(data.enriched || 0);
          var geocoded = Number(data.geocoded || 0);
          dongTotals.processed += processed;
          dongTotals.inserted += inserted;
          dongTotals.enriched += enriched;
          dongTotals.geocoded += geocoded;

          $("bldProgressDetail").textContent =
            "processed=" + dongTotals.processed +
            " inserted=" + dongTotals.inserted +
            (dongTotals.enriched ? " enriched=" + dongTotals.enriched : "") +
            (dongTotals.geocoded ? " geocoded=" + dongTotals.geocoded : "");

          // 종료 조건
          if (data.done === true) {
            done = true;
          } else if (doneWhenProcessedZero && processed === 0 && inserted === 0 && enriched === 0) {
            // 더 이상 처리할 대상 없음
            done = true;
          }
        } catch (e) {
          appendLog(name + " " + label + " 네트워크 오류: " + e.message);
          done = true;
        }

        if (sleepBetween > 0 && !done) {
          await new Promise(function(r) { setTimeout(r, sleepBetween); });
        }
      }

      appendLog(name + " " + label + " 완료 · processed=" + dongTotals.processed +
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
    var sequence = [
      { id: "bldBatchOpt_collect",       mode: "collect",       label: "표제부",         isCollect: true },
      { id: "bldBatchOpt_enrich_v2",     mode: "enrich_v2",     label: "전유부+공용면적", isV4: true, opts: { limitPerCall: 10, maxRounds: 100 } },
      { id: "bldBatchOpt_collect_atch",  mode: "collect_atch",  label: "부속지번",       isV4: true, opts: { limitPerCall: 20, maxRounds: 50 } },
      { id: "bldBatchOpt_enrich_recap",  mode: "enrich_recap",  label: "총괄표제부",     isV4: true, opts: { limitPerCall: 10, maxRounds: 30 } },
      { id: "bldBatchOpt_enrich_extras", mode: "enrich_extras", label: "층별·지역·오수", isV4: true, opts: { limitPerCall: 10, maxRounds: 100 } },
      { id: "bldBatchOpt_enrich_price",  mode: "enrich_price",  label: "공시가격",       isV4: true, opts: { limitPerCall: 10, maxRounds: 100 } },
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
    tbody.innerHTML = jobs.map(function(j) {
      var statusBadge = j.status === "done" || j.status === "collected"
        ? '<span style="color:#4CAF50;font-weight:700;">' + escHtml(j.status) + '</span>'
        : '<span style="color:#FF9800;">' + escHtml(j.status || "pending") + '</span>';
      return '<tr>' +
        '<td>' + escHtml(j.dong_name || j.dong_code) + '</td>' +
        '<td>' + (j.total_buildings || 0) + '</td>' +
        '<td>' + (j.collected_buildings || 0) + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="font-size:10px;">' + fmtDate(j.finished_at) + '</td>' +
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

  function renderUsage(summary) {
    // summary: null | {today_date, today_count, today_success, today_error, today_remaining, today_percent, today_by_endpoint, recent_days, total_recent}
    var $date = $("bldUsageDate");
    var $count = $("bldUsageCount");
    var $pct = $("bldUsagePct");
    var $bar = $("bldUsageBar");
    var $success = $("bldUsageSuccess");
    var $error = $("bldUsageError");
    var $remaining = $("bldUsageRemaining");
    var $endpoints = $("bldUsageEndpoints");
    var $recent = $("bldUsageRecent");

    if (!summary) {
      if ($date) $date.textContent = new Date().toLocaleDateString("ko-KR");
      if ($count) $count.textContent = "0";
      if ($pct) $pct.textContent = "0%";
      if ($bar) $bar.style.width = "0%";
      if ($success) $success.textContent = "0";
      if ($error) $error.textContent = "0";
      if ($remaining) $remaining.textContent = "10,000";
      if ($endpoints) $endpoints.innerHTML = '<span style="color:var(--muted);">아직 API 호출 기록이 없습니다.</span>';
      if ($recent) $recent.innerHTML = "";
      return;
    }

    var todayCount = Number(summary.today_count || 0);
    var todayPct = Number(summary.today_percent || 0);
    var todaySuccess = Number(summary.today_success || 0);
    var todayError = Number(summary.today_error || 0);
    var todayRemaining = Number(summary.today_remaining || 10000);

    if ($date) $date.textContent = summary.today_date || new Date().toISOString().slice(0,10);
    if ($count) $count.textContent = todayCount.toLocaleString("ko-KR");
    if ($pct) $pct.textContent = todayPct.toFixed(1) + "%";
    if ($bar) {
      $bar.style.width = Math.min(todayPct, 100) + "%";
      // 80% 이상이면 붉은색, 60% 이상이면 주황, 그 외 초록
      if (todayPct >= 80) {
        $bar.style.background = "linear-gradient(90deg,#F44336,#E57373)";
      } else if (todayPct >= 60) {
        $bar.style.background = "linear-gradient(90deg,#FF9800,#FFB74D)";
      } else {
        $bar.style.background = "linear-gradient(90deg,#4CAF50,#8BC34A)";
      }
    }
    if ($success) $success.textContent = todaySuccess.toLocaleString("ko-KR");
    if ($error) $error.textContent = todayError.toLocaleString("ko-KR");
    if ($remaining) $remaining.textContent = todayRemaining.toLocaleString("ko-KR");

    // 엔드포인트별 사용량
    if ($endpoints) {
      var by = summary.today_by_endpoint || {};
      var keys = Object.keys(by).sort(function(a,b){ return (by[b]||0) - (by[a]||0); });
      if (!keys.length) {
        $endpoints.innerHTML = '<span style="color:var(--muted);">오늘 아직 API 호출이 없습니다.</span>';
      } else {
        $endpoints.innerHTML = '<div style="margin-bottom:4px;font-weight:700;color:var(--text);">엔드포인트별 호출</div>' +
          keys.map(function(k) {
            var cnt = by[k] || 0;
            var label = escHtml(k);
            return '<div style="display:flex;justify-content:space-between;padding:2px 0;">' +
              '<span>' + label + '</span><span><b>' + cnt.toLocaleString("ko-KR") + '</b></span>' +
              '</div>';
          }).join("");
      }
    }

    // 최근 7일 추이
    if ($recent) {
      var recent = Array.isArray(summary.recent_days) ? summary.recent_days : [];
      if (!recent.length) {
        $recent.innerHTML = "";
      } else {
        var totalRecent = Number(summary.total_recent || 0);
        $recent.innerHTML = '<div style="margin-bottom:4px;font-weight:700;color:var(--text);">최근 7일 (총 ' + totalRecent.toLocaleString("ko-KR") + '건)</div>' +
          '<div style="display:flex;gap:2px;align-items:flex-end;height:36px;">' +
          recent.slice().reverse().map(function(d) {
            var cnt = Number(d.count || 0);
            var h = Math.max(2, Math.min(36, (cnt / 10000) * 36));
            var color = cnt >= 8000 ? "#F44336" : cnt >= 6000 ? "#FF9800" : "#4CAF50";
            var datestr = String(d.date || "").slice(5);
            return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;" title="' + escHtml(d.date) + ': ' + cnt.toLocaleString("ko-KR") + '건">' +
              '<div style="width:100%;background:' + color + ';height:' + h + 'px;border-radius:2px 2px 0 0;"></div>' +
              '<div style="font-size:8px;white-space:nowrap;">' + escHtml(datestr) + '</div>' +
              '</div>';
          }).join("") +
          '</div>';
      }
    }
  }

  // ── 초기화 ──
  mod.init = function init() {
    // 시군구 셀렉트
    var regionSel = $("bldRegionSelect");
    if (regionSel) {
      regionSel.innerHTML = '<option value="">▽ 전체 (구 선택)</option>' +
        Object.keys(DONG_LIST).map(function(k) { return '<option value="' + escHtml(k) + '">' + escHtml(k) + '</option>'; }).join("");
      regionSel.addEventListener("change", function() { renderDongGrid(regionSel.value); });
    }
    renderDongGrid("");

    // 전체선택/해제
    if ($("bldSelectAll")) $("bldSelectAll").addEventListener("click", function() {
      var region = regionSel ? regionSel.value : "";
      var dongs = region ? (DONG_LIST[region]||[]) : Object.values(DONG_LIST).flat();
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
    if ($("bldBtnEnrichV2")) $("bldBtnEnrichV2").addEventListener("click", function() {
      runEnrichV4("enrich_v2", "전유부+공용면적", { limitPerCall: 10, maxRounds: 100 });
    });
    if ($("bldBtnCollectAtch")) $("bldBtnCollectAtch").addEventListener("click", function() {
      runEnrichV4("collect_atch", "부속지번", { limitPerCall: 20, maxRounds: 50 });
    });
    if ($("bldBtnEnrichRecap")) $("bldBtnEnrichRecap").addEventListener("click", function() {
      runEnrichV4("enrich_recap", "총괄표제부", { limitPerCall: 10, maxRounds: 30 });
    });
    if ($("bldBtnEnrichExtras")) $("bldBtnEnrichExtras").addEventListener("click", function() {
      runEnrichV4("enrich_extras", "층별·지역·오수", { limitPerCall: 10, maxRounds: 100 });
    });
    if ($("bldBtnEnrichPrice")) $("bldBtnEnrichPrice").addEventListener("click", function() {
      runEnrichV4("enrich_price", "공시가격", { limitPerCall: 10, maxRounds: 100 });
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
