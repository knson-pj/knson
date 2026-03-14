import { supabaseAdmin } from "@/lib/supabase-admin";

type DrawRow = {
  round: number;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  bonus: number;
};

export type PredictionNumberScore = {
  number: number;
  probability: number;
  rank: number;
  extra?: Record<string, unknown>;
};

export type PredictionCombo = {
  rank: number;
  numbers: [number, number, number, number, number, number];
  score: number;
  meta?: Record<string, unknown>;
};

export type PredictionRunResult = {
  targetRound: number;
  modelVersion: string;
  featureVersion: string;
  topPoolSize: number;
  comboCount: number;
  numberScores: PredictionNumberScore[];
  combos: PredictionCombo[];
};

export const CURRENT_MODEL_VERSION = process.env.MODEL_VERSION ?? "stage3-minimal";
export const CURRENT_FEATURE_VERSION = process.env.FEATURE_VERSION ?? "baseline-v1";
const DEFAULT_TOP_POOL_SIZE = 24;
const DEFAULT_COMBO_COUNT = 5;
const DRAW_FETCH_LIMIT = 80;

function uniqueSorted(numbers: number[]): [number, number, number, number, number, number] {
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  if (sorted.length !== 6) {
    throw new Error(`combo numbers must contain 6 unique values: ${numbers.join(",")}`);
  }
  return sorted as [number, number, number, number, number, number];
}

function buildCombos(topPool: PredictionNumberScore[], comboCount: number): PredictionCombo[] {
  const scoreMap = new Map(topPool.map((item) => [item.number, item.probability]));
  const poolNumbers = topPool.map((item) => item.number);

  if (poolNumbers.length < 24) {
    throw new Error("top pool size must be at least 24 to generate default combos");
  }

  return Array.from({ length: comboCount }, (_, index) => {
    const start = index;
    const selected = [
      poolNumbers[start],
      poolNumbers[start + 4],
      poolNumbers[start + 8],
      poolNumbers[start + 12],
      poolNumbers[start + 16],
      poolNumbers[start + 20],
    ];

    const numbers = uniqueSorted(selected);
    const score = numbers.reduce((sum, value) => sum + (scoreMap.get(value) ?? 0), 0);

    return {
      rank: index + 1,
      numbers,
      score,
      meta: {
        source: "heuristic-stage3-minimal",
        poolOffsets: [start, start + 4, start + 8, start + 12, start + 16, start + 20],
      },
    };
  });
}

function buildProbabilityScores(draws: DrawRow[]): PredictionNumberScore[] {
  const scores = Array.from({ length: 46 }, () => 0);
  const latestSeenIndex = Array.from<number | null>({ length: 46 }, () => null);

  draws.forEach((draw, index) => {
    const mainNumbers = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6];
    const mainWeight = index < 10 ? 1.6 : index < 30 ? 0.9 : 0.45;
    const bonusWeight = mainWeight * 0.25;

    for (const number of mainNumbers) {
      scores[number] += mainWeight;
      if (latestSeenIndex[number] === null) {
        latestSeenIndex[number] = index;
      }
    }

    scores[draw.bonus] += bonusWeight;
  });

  for (let number = 1; number <= 45; number += 1) {
    const latestSeen = latestSeenIndex[number];

    if (latestSeen === null) {
      scores[number] *= 1.08;
      continue;
    }

    if (latestSeen === 0) {
      scores[number] *= 0.94;
    } else if (latestSeen >= 12) {
      scores[number] *= 1.05;
    }
  }

  const totalScore = scores.slice(1).reduce((sum, value) => sum + value, 0);
  if (totalScore <= 0) {
    throw new Error("failed to build probability scores");
  }

  const ranked = Array.from({ length: 45 }, (_, idx) => {
    const number = idx + 1;
    const probability = scores[number] / totalScore;
    return {
      number,
      probability,
      rank: 0,
      extra: {
        latestSeenDrawOffset: latestSeenIndex[number],
      },
    } satisfies PredictionNumberScore;
  }).sort((a, b) => b.probability - a.probability || a.number - b.number);

  return ranked.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

export async function runPrediction(targetRound: number): Promise<PredictionRunResult> {
  const drawRes = await supabaseAdmin
    .from("lotto_draws")
    .select("round,n1,n2,n3,n4,n5,n6,bonus")
    .order("round", { ascending: false })
    .limit(DRAW_FETCH_LIMIT);

  if (drawRes.error) {
    throw drawRes.error;
  }

  const draws = (drawRes.data ?? []) as DrawRow[];
  if (draws.length < 20) {
    throw new Error("lotto_draws data is insufficient. sync draws first.");
  }

  const numberScores = buildProbabilityScores(draws);
  const topPool = numberScores.slice(0, DEFAULT_TOP_POOL_SIZE);
  const combos = buildCombos(topPool, DEFAULT_COMBO_COUNT);

  return {
    targetRound,
    modelVersion: CURRENT_MODEL_VERSION,
    featureVersion: CURRENT_FEATURE_VERSION,
    topPoolSize: DEFAULT_TOP_POOL_SIZE,
    comboCount: DEFAULT_COMBO_COUNT,
    numberScores,
    combos,
  };
}
