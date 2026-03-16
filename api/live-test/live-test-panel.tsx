"use client";

import { useCallback, useMemo, useState } from "react";

type E2EApiResponse = {
  ok: boolean;
  error?: string;
  latestDrawRound?: number | null;
  nextTargetRound?: number | null;
  tables?: {
    lottoDrawsCount: number | null;
    predictionRunsCount: number | null;
    modelProbabilityExportsCount: number | null;
  };
  dryRun?: {
    ok: boolean;
    targetRound: number | null;
    modelVersion?: string;
    featureVersion?: string;
    topPoolSize?: number;
    comboCount?: number;
    top24Sorted?: number[];
    error?: string;
  };
  snapshotSources?: {
    supabaseLatest: {
      ok: boolean;
      targetRound?: number;
      modelVersion?: string;
      featureVersion?: string;
      candidateCount?: number;
      generatedAt?: string;
      error?: string;
    };
    publicFile: {
      ok: boolean;
      targetRound?: number;
      modelVersion?: string;
      featureVersion?: string;
      candidateCount?: number;
      generatedAt?: string;
      error?: string;
    };
  };
};

type PredictApiResponse = {
  ok: boolean;
  error?: string;
  requestId?: string;
  runId?: number;
  targetRound?: number;
  exportedCount?: number;
  top24?: Array<{
    number: number;
    probability: number;
    rank: number;
  }>;
  combos?: Array<{
    rank: number;
    numbers: number[];
    score: number;
  }>;
};

type BacktestApiResponse = {
  ok: boolean;
  error?: string;
  targetRange?: {
    fromRound: number;
    toRound: number;
  };
  summary?: {
    evaluatedRounds: number;
    averageTopHits: number;
    roundsWith4PlusTopHits: number;
    roundsWith5PlusTopHits: number;
    averageMaxComboHit: number;
    roundsWith4PlusComboHit: number;
    roundsWith5PlusComboHit: number;
  };
};

type LatestApiResponse = {
  ok: boolean;
  error?: string;
  summary?: {
    targetRound: number;
    modelKey: string;
    modelVersion: string;
    featureVersion: string;
    candidateCount: number;
    topNumbersByRank: number[];
    topNumbersSorted: number[];
    generatedAt: string;
    sourceTable: string;
  };
};

function cardStyle() {
  return {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 16,
    background: "#fff",
  } as const;
}

function buttonStyle(disabled?: boolean) {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: disabled ? "#e2e8f0" : "#0f172a",
    color: disabled ? "#64748b" : "#fff",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}

function preStyle() {
  return {
    margin: 0,
    padding: 12,
    borderRadius: 12,
    background: "#0f172a",
    color: "#e2e8f0",
    overflowX: "auto" as const,
    fontSize: 12,
    lineHeight: 1.5,
  };
}

export default function LiveTestPanel() {
  const [busy, setBusy] = useState<string>("");
  const [e2e, setE2E] = useState<E2EApiResponse | null>(null);
  const [predict, setPredict] = useState<PredictApiResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestApiResponse | null>(null);
  const [latest, setLatest] = useState<LatestApiResponse | null>(null);
  const [error, setError] = useState<string>("");

  const targetRound = useMemo(() => e2e?.nextTargetRound ?? null, [e2e]);

  const runJsonRequest = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const json = await response.json();

    if (!response.ok || !json.ok) {
      throw new Error(json.error || `Request failed: ${response.status}`);
    }

    return json;
  }, []);

  const handleCheckE2E = useCallback(async () => {
    try {
      setBusy("e2e");
      setError("");
      const json = (await runJsonRequest("/api/admin/e2e")) as E2EApiResponse;
      setE2E(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "e2e check failed");
    } finally {
      setBusy("");
    }
  }, [runJsonRequest]);

  const handleRunPredict = useCallback(async () => {
    try {
      setBusy("predict");
      setError("");

      const ensured = e2e ?? ((await runJsonRequest("/api/admin/e2e")) as E2EApiResponse);
      if (!e2e) setE2E(ensured);

      const nextRound = ensured.nextTargetRound;
      if (typeof nextRound !== "number") {
        throw new Error("nextTargetRound 를 찾지 못했습니다.");
      }

      const json = (await runJsonRequest("/api/predict", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetRound: nextRound }),
      })) as PredictApiResponse;

      setPredict(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "predict failed");
    } finally {
      setBusy("");
    }
  }, [e2e, runJsonRequest]);

  const handleRunBacktest = useCallback(async () => {
    try {
      setBusy("backtest");
      setError("");
      const json = (await runJsonRequest("/api/admin/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rounds: 20,
          historyWindow: 80,
          topPoolSize: 24,
          comboCount: 5,
        }),
      })) as BacktestApiResponse;

      setBacktest(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "backtest failed");
    } finally {
      setBusy("");
    }
  }, [runJsonRequest]);

  const handleFetchLatest = useCallback(async () => {
    try {
      setBusy("latest");
      setError("");
      const json = (await runJsonRequest("/api/predictions/latest")) as LatestApiResponse;
      setLatest(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "latest fetch failed");
    } finally {
      setBusy("");
    }
  }, [runJsonRequest]);

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif", display: "grid", gap: 16 }}>
      <section style={cardStyle()}>
        <p style={{ margin: 0, color: "#2563eb", fontWeight: 700 }}>Phase B / B-6</p>
        <h1 style={{ margin: "8px 0 12px" }}>Live Execution Test</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          이 페이지는 실제 API를 호출해서 현재 파이프라인이 살아있는지 확인하는 수동 테스트 화면이다.
        </p>
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>실행 순서</h2>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>E2E 상태 확인</li>
          <li>예측 실행(`/api/predict`)</li>
          <li>최신 예측 조회(`/api/predictions/latest`)</li>
          <li>백테스트 실행(`/api/admin/backtest`)</li>
        </ol>

        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button style={buttonStyle(busy !== "")} disabled={busy !== ""} onClick={handleCheckE2E}>
            1) E2E 상태 확인
          </button>
          <button style={buttonStyle(busy !== "")} disabled={busy !== ""} onClick={handleRunPredict}>
            2) 예측 실행
          </button>
          <button style={buttonStyle(busy !== "")} disabled={busy !== ""} onClick={handleFetchLatest}>
            3) 최신 예측 조회
          </button>
          <button style={buttonStyle(busy !== "")} disabled={busy !== ""} onClick={handleRunBacktest}>
            4) 백테스트 실행
          </button>
        </div>

        <p style={{ marginTop: 12, marginBottom: 0, color: "#475569" }}>
          현재 nextTargetRound: <strong>{String(targetRound ?? "-")}</strong>
        </p>

        {error ? (
          <p style={{ marginTop: 12, marginBottom: 0, color: "#b91c1c", fontWeight: 700 }}>error: {error}</p>
        ) : null}
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>1) E2E 상태 확인 결과</h2>
        <pre style={preStyle()}>{JSON.stringify(e2e, null, 2)}</pre>
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>2) 예측 실행 결과</h2>
        <pre style={preStyle()}>{JSON.stringify(predict, null, 2)}</pre>
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>3) 최신 예측 조회 결과</h2>
        <pre style={preStyle()}>{JSON.stringify(latest, null, 2)}</pre>
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>4) 백테스트 실행 결과</h2>
        <pre style={preStyle()}>{JSON.stringify(backtest, null, 2)}</pre>
      </section>
    </main>
  );
}
