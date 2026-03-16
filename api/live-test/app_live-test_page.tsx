import LiveTestPanel from "./live-test-panel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live Execution Test",
  description: "예측 파이프라인 실제 호출 테스트 페이지",
};

export default function LiveTestPage() {
  return <LiveTestPanel />;
}
