/**
 * RC-5D PR-5D-1 — item candidate collection, ranking, and correction orchestration.
 */

const itemCorrectionPolicy = require('./itemCorrectionPolicy');

const {
  CORRECTION_ACTION,
  ITEM_ENGINE_PRIORITY,
  DEFAULT_POLICY,
  normalizeItemName,
  readNumericFields,
  computeLineMathScore,
  evaluateCandidate,
  mergeItemRecords
} = itemCorrectionPolicy;

const AGREEMENT_WEIGHT = 0.35;
const PRIORITY_WEIGHT = 0.20;
const MATH_WEIGHT = 0.20;
const NAME_WEIGHT = 0.10;
const HEADER_WEIGHT = 0.05;
const GRAND_TOTAL_BAND_WEIGHT = 0.10;

function normalizeItemNameKey(item = {}) {
  const name = normalizeItemName(item.name || item.description || item.item_name).toLowerCase();
  return name || null;
}

function normalizeItemKey(item = {}) {
  const nameKey = normalizeItemNameKey(item);
  if (!nameKey) {
    return null;
  }
  const total = readNumericFields(item).total;
  if (isPositiveNumber(total)) {
    return `${nameKey}::${roundMoney(total)}`;
  }
  return `${nameKey}::missing_total`;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function scoreNameQuality(name) {
  const normalized = normalizeItemName(name);
  if (!normalized) {
    return 0;
  }
  const letters = (normalized.match(/[A-Za-z]/g) || []).length;
  if (letters < 3) {
    return 0.2;
  }
  if (letters >= 6 && normalized.length >= 8) {
    return 1;
  }
  return 0.6;
}

function scoreGrandTotalBand(total, grandTotal) {
  if (!isPositiveNumber(total) || !isPositiveNumber(grandTotal)) {
    return 0.5;
  }
  const ratio = total / grandTotal;
  if (ratio >= 0.00001 && ratio <= 1.25) {
    return 1;
  }
  if (ratio <= 2) {
    return 0.3;
  }
  return 0;
}

function buildCandidateRecord(rawCandidate = {}, options = {}) {
  const engine = rawCandidate.engine || 'ocr_text_heuristic';
  const evaluation = evaluateCandidate(rawCandidate.item || rawCandidate, options);

  if (evaluation.action === CORRECTION_ACTION.DROP) {
    return {
      ...evaluation,
      engine,
      normalizedKey: null,
      rankingScore: 0
    };
  }

  const item = evaluation.item;
  const numeric = readNumericFields(item);
  const math = computeLineMathScore(numeric.quantity, numeric.price, numeric.total, options);
  const nameScore = scoreNameQuality(item.name);
  const bandScore = scoreGrandTotalBand(numeric.total, options.grandTotal);
  const priorityScore = (ITEM_ENGINE_PRIORITY[engine] || 0) / 40;
  const headerBonus = rawCandidate.hasHeader ? HEADER_WEIGHT : 0;

  return {
    ...evaluation,
    engine,
    item,
    normalizedKey: normalizeItemKey(item),
    scores: {
      math: math.score,
      name: nameScore,
      grandTotalBand: bandScore,
      enginePriority: priorityScore,
      header: headerBonus
    },
    rankingScore: (
      math.score * MATH_WEIGHT
      + nameScore * NAME_WEIGHT
      + bandScore * GRAND_TOTAL_BAND_WEIGHT
      + priorityScore * PRIORITY_WEIGHT
      + headerBonus
    )
  };
}

function collectItemCandidates(sourceEntries = [], options = {}) {
  const candidates = [];
  if (!Array.isArray(sourceEntries)) {
    return candidates;
  }

  for (const entry of sourceEntries) {
    const engine = entry?.engine;
    const items = Array.isArray(entry?.items) ? entry.items : [];
    if (!engine || items.length === 0) {
      continue;
    }
    for (const item of items) {
      candidates.push(buildCandidateRecord(
        {
          engine,
          item,
          hasHeader: Boolean(entry.hasHeader)
        },
        options
      ));
    }
  }

  return candidates;
}

function rankItemCandidateGroup(group = [], options = {}) {
  if (!Array.isArray(group) || group.length === 0) {
    return null;
  }

  const viable = group.filter((candidate) => (
    candidate.action !== CORRECTION_ACTION.DROP
    && candidate.normalizedKey
  ));

  if (viable.length === 0) {
    return null;
  }

  const engines = [];
  let prioritySum = 0;
  let mathSum = 0;
  let nameSum = 0;
  let bandSum = 0;
  let rankingSum = 0;

  for (const candidate of viable) {
    if (!engines.includes(candidate.engine)) {
      engines.push(candidate.engine);
      prioritySum += ITEM_ENGINE_PRIORITY[candidate.engine] || 0;
    }
    mathSum += candidate.scores?.math || 0;
    nameSum += candidate.scores?.name || 0;
    bandSum += candidate.scores?.grandTotalBand || 0;
    rankingSum += candidate.rankingScore || 0;
  }

  const agreement = engines.length;
  const agreementScore = agreement >= 2 ? 1 : agreement === 1 ? 0.5 : 0;
  const priorityScore = prioritySum / 40;
  const mathScore = mathSum / viable.length;
  const nameScore = nameSum / viable.length;
  const bandScore = bandSum / viable.length;
  const compositeScore = (
    agreementScore * AGREEMENT_WEIGHT
    + priorityScore * PRIORITY_WEIGHT
    + mathScore * MATH_WEIGHT
    + nameScore * NAME_WEIGHT
    + bandScore * GRAND_TOTAL_BAND_WEIGHT
  );

  viable.sort((left, right) => {
    const leftPriority = ITEM_ENGINE_PRIORITY[left.engine] || 0;
    const rightPriority = ITEM_ENGINE_PRIORITY[right.engine] || 0;
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }
    return (right.rankingScore || 0) - (left.rankingScore || 0);
  });

  const winner = viable[0];
  const totals = new Set(
    viable
      .map((candidate) => readNumericFields(candidate.item).total)
      .filter(isPositiveNumber)
      .map((value) => roundMoney(value))
  );

  const ambiguous = agreement >= 2 && totals.size > 1;

  return {
    normalizedKey: winner.normalizedKey,
    item: winner.item,
    action: ambiguous ? CORRECTION_ACTION.DEFER : winner.action,
    reason: ambiguous ? 'ambiguous_cross_engine_totals' : winner.reason,
    agreement,
    engines: [...engines],
    prioritySum,
    scores: {
      agreement: agreementScore,
      enginePriority: priorityScore,
      math: mathScore,
      name: nameScore,
      grandTotalBand: bandScore,
      composite: roundMoney(compositeScore)
    },
    ambiguous,
    candidates: viable
  };
}

function rankItemCandidates(candidates = [], options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const buckets = new Map();
  for (const candidate of candidates) {
    if (candidate.action === CORRECTION_ACTION.DROP || !candidate.normalizedKey) {
      continue;
    }
    if (!buckets.has(candidate.normalizedKey)) {
      buckets.set(candidate.normalizedKey, []);
    }
    buckets.get(candidate.normalizedKey).push(candidate);
  }

  const ranked = [];
  for (const [, group] of buckets) {
    const result = rankItemCandidateGroup(group, options);
    if (result) {
      ranked.push(result);
    }
  }

  ranked.sort((left, right) => {
    if (right.agreement !== left.agreement) {
      return right.agreement - left.agreement;
    }
    if (right.prioritySum !== left.prioritySum) {
      return right.prioritySum - left.prioritySum;
    }
    return (right.scores?.composite || 0) - (left.scores?.composite || 0);
  });

  return ranked;
}

function mergeDuplicateItems(candidates = [], options = {}) {
  const merged = new Map();

  for (const candidate of candidates) {
    if (candidate.action === CORRECTION_ACTION.DROP || !candidate.normalizedKey) {
      continue;
    }

    const key = candidate.normalizedKey;
    if (!merged.has(key)) {
      merged.set(key, {
        ...candidate,
        engines: [candidate.engine].filter(Boolean),
        agreement: 1
      });
      continue;
    }

    const existing = merged.get(key);
    const mergedRecord = mergeItemRecords(existing, candidate, options);
    merged.set(key, {
      ...existing,
      ...mergedRecord,
      action: CORRECTION_ACTION.MERGE,
      engines: mergedRecord.engines,
      agreement: mergedRecord.engines.length,
      item: {
        ...mergedRecord.item,
        name: mergedRecord.name || mergedRecord.item.name
      }
    });
  }

  return Array.from(merged.values());
}

function splitAmbiguousByName(ranked = []) {
  const byName = new Map();

  for (const row of ranked) {
    const nameKey = normalizeItemNameKey(row.item);
    if (!nameKey) {
      continue;
    }
    if (!byName.has(nameKey)) {
      byName.set(nameKey, []);
    }
    byName.get(nameKey).push(row);
  }

  const deferredNameKeys = new Set();
  for (const [nameKey, rows] of byName) {
    const totals = new Set(
      rows
        .map((row) => readNumericFields(row.item).total)
        .filter(isPositiveNumber)
        .map((value) => roundMoney(value))
    );
    const engines = new Set(rows.flatMap((row) => row.engines || []));
    if (totals.size > 1 && engines.size >= 2) {
      deferredNameKeys.add(nameKey);
    }
  }

  const winners = [];
  const deferred = [];

  for (const row of ranked) {
    const nameKey = normalizeItemNameKey(row.item);
    if (row.action === CORRECTION_ACTION.DEFER || row.ambiguous) {
      deferred.push(row);
      continue;
    }
    if (nameKey && deferredNameKeys.has(nameKey)) {
      deferred.push({
        ...row,
        action: CORRECTION_ACTION.DEFER,
        reason: 'ambiguous_cross_engine_totals',
        ambiguous: true
      });
      continue;
    }
    winners.push(row);
  }

  return { winners, deferred };
}

function pickItemWinners(candidates = [], options = {}) {
  const merged = mergeDuplicateItems(candidates, options);
  const ranked = rankItemCandidates(merged, options);
  const split = splitAmbiguousByName(ranked);

  return {
    winners: split.winners,
    deferred: split.deferred,
    ranked
  };
}

function processItemCandidates(sourceEntries = [], options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  const collected = collectItemCandidates(sourceEntries, policy);
  const merged = mergeDuplicateItems(collected, policy);
  const pick = pickItemWinners(collected, policy);

  return {
    collected,
    merged,
    winners: pick.winners,
    deferred: pick.deferred,
    ranked: pick.ranked
  };
}

module.exports = {
  AGREEMENT_WEIGHT,
  PRIORITY_WEIGHT,
  MATH_WEIGHT,
  normalizeItemNameKey,
  normalizeItemKey,
  collectItemCandidates,
  rankItemCandidates,
  rankItemCandidateGroup,
  mergeDuplicateItems,
  pickItemWinners,
  processItemCandidates,
  scoreNameQuality,
  scoreGrandTotalBand
};
