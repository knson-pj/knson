import { supabaseAdmin } from "@/lib/supabase-admin";
import type { PredictionSnapshot, PredictionNumber } from "@/lib/predict";
import type { PredictionRunResult } from "@/lib/prediction-engine";

type ModelProbabilityExportRow = {
  id: number;
  target_round: number;
  model_version: string;
  feature_version: string;
  number: number;
  probability: number;
  meta: Record<string, unknown> | null;
  created_at: string;
};

function toPredictionNumbers(rows: ModelProbabilityExportRow[]): PredictionNumber[] {
  const sorted = rows
    .slice()
    .sort((a, b) => {
      const rankA = typeof a.meta?.rank === "number" ? a.meta.rank : Number.POSITIVE_INFINITY;
      const rankB = typeof b.meta?.rank === "number" ? b.meta.rank : Number.POSITIVE_INFINITY;
      return rankA - rankB || b.probability - a.probability || a.number - b.number;
    });

  return sorted.map((row, index) => ({
    number: row.number,
    probability: row.probability,
    rank: typeof row.meta?.rank === "number" ? row.meta.rank : index + 1,
    extra: row.meta?.extra && typeof row.meta.extra === "object" ? (row.meta.extra as Record<string, unknown>) : undefined,
  }));
}

function buildSnapshot(rows: ModelProbabilityExportRow[]): PredictionSnapshot {
  const numbers = toPredictionNumbers(rows);
  const head = rows[0];
  const generatedAt = rows
    .map((row) => row.created_at)
    .sort((a, b) => (a < b ? 1 : -1))[0];

  const probabilitySum = numbers.reduce((sum, item) => sum + item.probability, 0);
  const topNumbersByRank = numbers.map((item) => item.number);
  const topNumbersSorted = topNumbersByRank.slice().sort((a, b) => a - b);

  return {
    snapshotVersion: 1,
    generatedAt,
    source: {
      kind: "supabase",
      table: "model_probability_exports",
      exportId: null,
    },
    prediction: {
      targetRound: head.target_round,
      modelKey: "stage3-minimal",
      modelVersion: head.model_version,
      featureVersion: head.feature_version,
      topK: numbers.length,
      topNumbersByRank,
      topNumbersSorted,
      numbers,
    },
    summary: {
      candidateCount: numbers.length,
      probabilitySum: Number(probabilitySum.toFixed(12)),
      maxProbability: numbers.length > 0 ? Math.max(...numbers.map((item) => item.probability)) : null,
      minProbability: numbers.length > 0 ? Math.min(...numbers.map((item) => item.probability)) : null,
    },
    metadata: {
      source: "model_probability_exports",
      rowCount: rows.length,
    },
  };
}

function pickLatestGroup(rows: ModelProbabilityExportRow[]): ModelProbabilityExportRow[] {
  const groups = new Map<string, ModelProbabilityExportRow[]>();

  for (const row of rows) {
    const key = `${row.target_round}__${row.model_version}__${row.feature_version}`;
    const current = groups.get(key);
    if (current) {
      current.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const grouped = Array.from(groups.values());
  if (grouped.length === 0) {
    return [];
  }

  grouped.sort((a, b) => {
    const aHead = a[0];
    const bHead = b[0];
    const aCreated = a.map((row) => row.created_at).sort((x, y) => (x < y ? 1 : -1))[0];
    const bCreated = b.map((row) => row.created_at).sort((x, y) => (x < y ? 1 : -1))[0];

    return (
      bHead.target_round - aHead.target_round ||
      (aCreated < bCreated ? 1 : -1) ||
      aHead.model_version.localeCompare(bHead.model_version) ||
      aHead.feature_version.localeCompare(bHead.feature_version)
    );
  });

  return grouped[0];
}

export async function upsertModelProbabilityExports(
  result: PredictionRunResult,
  triggeredBy: "user" | "cron",
): Promise<{ upsertedCount: number }> {
  const nowIso = new Date().toISOString();

  const rows = result.numberScores.map((item) => ({
    target_round: result.targetRound,
    model_version: result.modelVersion,
    feature_version: result.featureVersion,
    number: item.number,
    probability: item.probability,
    meta: {
      rank: item.rank,
      source: triggeredBy,
      topPoolSize: result.topPoolSize,
      comboCount: result.comboCount,
      ...(item.extra ? { extra: item.extra } : {}),
    },
    created_at: nowIso,
  }));

  const response = await supabaseAdmin
    .from("model_probability_exports")
    .upsert(rows, {
      onConflict: "target_round,model_version,feature_version,number",
    })
    .select("id");

  if (response.error) {
    throw response.error;
  }

  return {
    upsertedCount: response.data?.length ?? rows.length,
  };
}

export async function getLatestModelProbabilitySnapshot(targetRound?: number): Promise<PredictionSnapshot | null> {
  let query = supabaseAdmin
    .from("model_probability_exports")
    .select("id,target_round,model_version,feature_version,number,probability,meta,created_at")
    .order("target_round", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (typeof targetRound === "number") {
    query = query.eq("target_round", targetRound);
  }

  const response = await query;
  if (response.error) {
    throw response.error;
  }

  const rows = (response.data ?? []) as ModelProbabilityExportRow[];
  if (rows.length === 0) {
    return null;
  }

  const latestGroup = pickLatestGroup(rows);
  if (latestGroup.length === 0) {
    return null;
  }

  return buildSnapshot(latestGroup);
}
