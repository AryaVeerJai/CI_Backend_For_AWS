/**
 * Detects state electricity DISCOM / water-utility bills so emissions use one
 * consolidated bill total (document amount + consumption signals) instead of
 * per-line-item spend splits.
 */

const SUPPORTED_DOC_TYPES = new Set(['bill', 'receipt', 'invoice', 'statement']);

const ELECTRICITY_HINTS = [
  /\b(state\s+)?electricity\s+board\b/i,
  /\bpower\s+distribution\s+compan(y|ies)\b/i,
  /\bdiscom\b/i,
  /\b(tneb|msedcl|mseb|mahadiscom|bescom|gescom|hescom|cescom|mescom)\b/i,
  /\b(npcl|npdcl|spdcl|tsnpdcl|tsspdcl|apdcl|apepdcl|apeastern|apcentral)\b/i,
  /\b(uhbvn|dhbvn|pspcl|upepcl|uppcl|dvvnl|mvvnl|pvvnl)\b/i,
  /\b(wbsedcl|sbpdcl|nbpdcl|jusco|tata\s+power\s+ddl)\b/i,
  /\b(torrent\s+power|adani\s+electricity|adani\s+power)\b/i,
  /\benergy\s+charges\b/i
];

const WATER_HINTS = [
  /\bwater\s+board\b/i,
  /\bjal\s+(board|nigam|sansthan)\b/i,
  /\b(delhi\s+)?jal\s+board\b/i,
  /\b(bwssb|djb|cgwb|jal\s+kal)\b/i,
  /\bmunicipal\s+water\s+supply\b/i,
  /\bwater\s+charges\b/i,
  /\bdomestic\s+consumption\s+water\b/i
];

function vendorLooksLikeUtilityBoard(vendorName = '') {
  const v = String(vendorName).toLowerCase();
  if (!v.trim()) return { electricity: false, water: false };
  const electricity =
    /(electricity|power|discom|distribution|energy)\b/.test(v) &&
    /(board|state|government|municipal|corporation|limited|ltd|discom)/.test(v);
  const water =
    /\b(water|jal)\b/.test(v) && /(board|nigam|municipal|corporation|supply|department)/.test(v);
  return { electricity, water };
}

function corpusFromContext({ document = {}, extractedData = {} }) {
  const vendor =
    typeof extractedData.vendor === 'string'
      ? extractedData.vendor
      : extractedData.vendor?.name || '';
  const parts = [
    vendor,
    extractedData.description,
    extractedData.rawText,
    document.originalName,
    ...(Array.isArray(extractedData.items) ? extractedData.items.map(i => i?.name || '') : [])
  ];
  const rawPayload = extractedData.raw && typeof extractedData.raw === 'object' ? extractedData.raw : {};
  parts.push(rawPayload.vendor, rawPayload.description);
  return parts.filter(Boolean).join(' ');
}

function matchesAnyPattern(text, patterns) {
  return patterns.some(re => re.test(text));
}

function carbonMatchesUtility({ carbonExtraction, utilityType }) {
  const cd = carbonExtraction?.extractedData;
  if (!cd) return false;
  if (utilityType === 'electricity') {
    return Boolean(cd.energy?.electricity?.consumption > 0);
  }
  if (utilityType === 'water') {
    return Boolean(cd.water?.consumption > 0);
  }
  return false;
}

function analyzeStateUtilityBoardBill({ document = {}, extractedData = {}, carbonExtraction = null } = {}) {
  const docType = String(document.documentType || '').toLowerCase();
  if (!SUPPORTED_DOC_TYPES.has(docType)) {
    return {
      consolidateAsSingleUtilityBill: false,
      utilityType: null,
      agents: []
    };
  }

  const corpus = corpusFromContext({ document, extractedData }).toLowerCase();
  if (!corpus.trim()) {
    return { consolidateAsSingleUtilityBill: false, utilityType: null, agents: [] };
  }

  const vendorName =
    typeof extractedData.vendor === 'string'
      ? extractedData.vendor
      : extractedData.vendor?.name || '';
  const vendorGuess = vendorLooksLikeUtilityBoard(vendorName);

  const electricityFromText = matchesAnyPattern(corpus, ELECTRICITY_HINTS);
  const waterFromText = matchesAnyPattern(corpus, WATER_HINTS);

  let utilityType = null;
  if ((electricityFromText || vendorGuess.electricity) && !(waterFromText || vendorGuess.water)) {
    utilityType = 'electricity';
  } else if ((waterFromText || vendorGuess.water) && !(electricityFromText || vendorGuess.electricity)) {
    utilityType = 'water';
  } else if (electricityFromText || vendorGuess.electricity) {
    utilityType = 'electricity';
  } else if (waterFromText || vendorGuess.water) {
    utilityType = 'water';
  }

  if (!utilityType) {
    return { consolidateAsSingleUtilityBill: false, utilityType: null, agents: [] };
  }

  const carbonOk = carbonMatchesUtility({ carbonExtraction, utilityType });
  const hasKwh = /\bkwh\b/i.test(corpus);
  const hasWaterUnits = /\b(kl|kilolitre|kiloliter)\b/i.test(corpus);

  const boardOrVendorSignal =
    utilityType === 'electricity'
      ? electricityFromText || vendorGuess.electricity
      : waterFromText || vendorGuess.water;

  const consolidateAsSingleUtilityBill = Boolean(
    utilityType &&
      (boardOrVendorSignal || carbonOk || (utilityType === 'electricity' && hasKwh) || (utilityType === 'water' && hasWaterUnits))
  );

  const agents = [
    {
      name: 'state_utility_board_single_bill_agent',
      role: 'Detect state DISCOM / water-board utility invoices and consolidate emissions on the bill total.',
      utilityType,
      signals: {
        electricityFromText,
        waterFromText,
        vendorElectricity: vendorGuess.electricity,
        vendorWater: vendorGuess.water,
        hasKwh,
        hasWaterUnits,
        carbonOk
      }
    }
  ];

  return {
    consolidateAsSingleUtilityBill,
    utilityType,
    agents
  };
}

module.exports = {
  analyzeStateUtilityBoardBill,
  corpusFromContext
};
