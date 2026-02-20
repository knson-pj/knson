export default async function handler(req, res) {
  try {
    // CORS (GitHub Pages에서 호출 가능하게)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    // serviceKey는 절대 프론트에 두지 말고 Vercel env에 저장
    const serviceKey = process.env.ONBID_SERVICE_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "Missing env: ONBID_SERVICE_KEY" });
    }

    // 온비드 부동산 물건목록 조회서비스 엔드포인트 (문서 기준)
    const baseUrl = "http://apis.data.go.kr/B010003/OnbidRlstListSrvc/getRlstCltrList";

    // 클라이언트에서 넘어온 query를 그대로 전달(화이트리스트 방식 추천)
    const q = req.query || {};

    // 기본값(부동산/매각/인터넷입찰) - 프론트에서도 보내지만, 서버에서 안전하게 기본 주입
    const params = new URLSearchParams();

    params.set("serviceKey", serviceKey);
    params.set("resultType", q.resultType || "json");
    params.set("pageNo", q.pageNo || "1");
    params.set("numOfRows", q.numOfRows || "50");

    params.set("prptDivCd", q.prptDivCd || "0007,0010,0005,0002,0003,0006,0008,0011");
    params.set("dspsMthodCd", q.dspsMthodCd || "0001"); // 매각
    params.set("bidDivCd", q.bidDivCd || "0001");       // 인터넷

    // 옵션 파라미터들(문서에 있는 것들 중 자주 쓰는 것만 패스스루)
    const passthroughKeys = [
      "cltrUsgLclsCtgrId","cltrUsgMclsCtgrId","cltrUsgSclsCtgrId",
      "cltrUsgLclsCtgrNm","cltrUsgMclsCtgrNm","cltrUsgSclsCtgrNm",
      "lctnSdnm","lctnSggnm","lctnEmdNm",
      "lowstBidPrcStart","lowstBidPrcEnd",
      "landSqmsStart","landSqmsEnd",
      "bldSqmsStart","bldSqmsEnd",
      "bidPrdYmdStart","bidPrdYmdEnd",
      "cptnMthodCd","pvctTrgtYn","alcYn",
      "usbdNftStart","usbdNftEnd",
      "apslEvlAmtStart","apslEvlAmtEnd",
      "onbidCltrNm","rqstOrgNm",
      "mdfcnYmdStart","mdfcnYmdEnd",
    ];

    for (const k of passthroughKeys) {
      if (q[k] !== undefined && q[k] !== null && String(q[k]).trim() !== "") {
        params.set(k, String(q[k]));
      }
    }

    const url = `${baseUrl}?${params.toString()}`;

    const upstream = await fetch(url, { method: "GET" });
    const text = await upstream.text();

    // data.go.kr은 JSON/XML 모두 가능. 우리는 JSON을 기대하지만, 실패 대비해 텍스트로 파싱 시도
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    try {
      const json = JSON.parse(text);
      return res.status(upstream.status).json(json);
    } catch {
      // 만약 XML로 오거나 JSON 파싱이 실패하면 원문 반환
      return res.status(upstream.status).json({ raw: text });
    }
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
