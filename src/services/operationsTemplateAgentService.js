const dns = require('node:dns').promises;
const net = require('node:net');

const DEFAULT_CHEMICALS = ['Acids', 'Alkalis', 'Solvents', 'Detergents', 'Disinfectants', 'Process additives'];
const DEFAULT_WATER_TREATMENTS = ['Sedimentation', 'Filtration', 'Biological treatment', 'RO treatment', 'Disinfection'];

const TEMPLATE_LIBRARY = {
  textiles: {
    templateName: 'Textile wet processing',
    rationale: 'Optimized for dyeing and washing intensive textile operations.',
    operationsData: {
      powerConsumptionKwhPerMonth: 26000,
      waterUsageKlPerMonth: 900,
      chemicalsUsageKgPerMonth: 1800,
      fuelUsageLitersPerMonth: 2400,
      solarInstallationKw: 35,
      solarGenerationKwhPerMonth: 4200,
      solarUsageKwhPerMonth: 3800,
      solarNetMeteringEnabled: true
    },
    suggestedChemicals: ['Dyes', 'Bleaching agents', 'Fixing agents', 'Softeners', 'Hydrogen peroxide'],
    suggestedWaterTreatments: ['Primary treatment', 'Biological treatment', 'Color removal', 'Zero Liquid Discharge', 'RO + MEE']
  },
  food: {
    templateName: 'Food processing line',
    rationale: 'Balanced utility setup for cleaning-heavy food production.',
    operationsData: {
      powerConsumptionKwhPerMonth: 18000,
      waterUsageKlPerMonth: 520,
      chemicalsUsageKgPerMonth: 640,
      fuelUsageLitersPerMonth: 1700,
      solarInstallationKw: 22,
      solarGenerationKwhPerMonth: 2600,
      solarUsageKwhPerMonth: 2400,
      solarNetMeteringEnabled: true
    },
    suggestedChemicals: ['Cleaning agents (CIP)', 'Sanitizers', 'Boiler treatment chemicals', 'Food-grade preservatives'],
    suggestedWaterTreatments: ['Screening', 'Oil-water separation', 'Biological treatment', 'Disinfection', 'Reuse in utilities']
  },
  electronics: {
    templateName: 'Electronics assembly',
    rationale: 'Lower fuel demand with process-chemistry and precision cleaning defaults.',
    operationsData: {
      powerConsumptionKwhPerMonth: 21000,
      waterUsageKlPerMonth: 260,
      chemicalsUsageKgPerMonth: 540,
      fuelUsageLitersPerMonth: 600,
      solarInstallationKw: 28,
      solarGenerationKwhPerMonth: 3400,
      solarUsageKwhPerMonth: 3200,
      solarNetMeteringEnabled: true
    },
    suggestedChemicals: ['Flux', 'Solvents', 'Etching solutions', 'Isopropyl alcohol', 'Cleaning chemicals'],
    suggestedWaterTreatments: ['Neutralization', 'Heavy-metal precipitation', 'RO treatment', 'Ion exchange', 'Reuse in process']
  },
  automotive: {
    templateName: 'Auto components plant',
    rationale: 'Defaults tuned for machining, painting, and transport-heavy movement.',
    operationsData: {
      powerConsumptionKwhPerMonth: 30000,
      waterUsageKlPerMonth: 400,
      chemicalsUsageKgPerMonth: 900,
      fuelUsageLitersPerMonth: 2200,
      solarInstallationKw: 45,
      solarGenerationKwhPerMonth: 5400,
      solarUsageKwhPerMonth: 5000,
      solarNetMeteringEnabled: true
    },
    suggestedChemicals: ['Coolants', 'Lubricants', 'Degreasers', 'Paints', 'Adhesives'],
    suggestedWaterTreatments: ['Oil-water separator', 'Chemical coagulation', 'Biological treatment', 'Sludge dewatering']
  },
  generic: {
    templateName: 'General MSME operations',
    rationale: 'Safe baseline where sector details are limited.',
    operationsData: {
      powerConsumptionKwhPerMonth: 12000,
      waterUsageKlPerMonth: 280,
      chemicalsUsageKgPerMonth: 350,
      fuelUsageLitersPerMonth: 900,
      solarInstallationKw: 15,
      solarGenerationKwhPerMonth: 1800,
      solarUsageKwhPerMonth: 1600,
      solarNetMeteringEnabled: false
    },
    suggestedChemicals: DEFAULT_CHEMICALS,
    suggestedWaterTreatments: DEFAULT_WATER_TREATMENTS
  }
};

const KEYWORD_TO_TEMPLATE = [
  { pattern: /\b(textile|garment|yarn|fabric|dye)\b/i, key: 'textiles' },
  { pattern: /\b(food|beverage|dairy|snack|grain)\b/i, key: 'food' },
  { pattern: /\b(electronic|pcb|chip|solder|board)\b/i, key: 'electronics' },
  { pattern: /\b(automotive|vehicle|auto component|machining|paint shop)\b/i, key: 'automotive' }
];

const stripHtml = (html = '') =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const inferTemplateKeyFromText = (text = '') => {
  const match = KEYWORD_TO_TEMPLATE.find(({ pattern }) => pattern.test(text));
  return match ? match.key : 'generic';
};

const IPV4_PRIVATE_BLOCKS = [
  { base: '10.0.0.0', mask: 8 },
  { base: '127.0.0.0', mask: 8 },
  { base: '169.254.0.0', mask: 16 },
  { base: '172.16.0.0', mask: 12 },
  { base: '192.168.0.0', mask: 16 }
];

const ipv4ToInt = (ip) =>
  ip.split('.').map(Number).reduce((acc, octet) => ((acc << 8) + octet) >>> 0, 0);

const isPrivateIPv4 = (ip) => {
  if (!net.isIPv4(ip)) return false;
  const target = ipv4ToInt(ip);
  return IPV4_PRIVATE_BLOCKS.some(({ base, mask }) => {
    const baseInt = ipv4ToInt(base);
    const bitmask = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
    return (target & bitmask) === (baseInt & bitmask);
  });
};

const normalizeIPv6 = (ip) => ip.toLowerCase();

const isPrivateIPv6 = (ip) => {
  if (!net.isIPv6(ip)) return false;
  const normalized = normalizeIPv6(ip);
  return normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:169.254.')
    || normalized.startsWith('::ffff:172.16.')
    || normalized.startsWith('::ffff:172.17.')
    || normalized.startsWith('::ffff:172.18.')
    || normalized.startsWith('::ffff:172.19.')
    || normalized.startsWith('::ffff:172.2')
    || normalized.startsWith('::ffff:172.30.')
    || normalized.startsWith('::ffff:172.31.')
    || normalized.startsWith('::ffff:192.168.');
};

const isDisallowedHost = (hostname = '') => {
  const lowerHost = hostname.toLowerCase();
  return lowerHost === 'localhost'
    || lowerHost.endsWith('.localhost')
    || lowerHost === 'metadata.google.internal';
};

const ensureSafeWebsiteUrl = async (websiteUrl = '') => {
  if (!websiteUrl) return '';

  let parsedUrl;
  try {
    parsedUrl = new URL(websiteUrl);
  } catch (_error) {
    throw new Error('Invalid website URL format');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP/HTTPS website URLs are allowed');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Website URL must not include credentials');
  }

  if (isDisallowedHost(parsedUrl.hostname)) {
    throw new Error('Website URL host is not allowed');
  }

  if (net.isIP(parsedUrl.hostname)) {
    if (isPrivateIPv4(parsedUrl.hostname) || isPrivateIPv6(parsedUrl.hostname)) {
      throw new Error('Website URL resolves to a private or loopback address');
    }
    return parsedUrl.toString();
  }

  const resolutions = await dns.lookup(parsedUrl.hostname, { all: true });
  if (!resolutions.length) {
    throw new Error('Website URL host did not resolve');
  }

  for (const resolved of resolutions) {
    if (isPrivateIPv4(resolved.address) || isPrivateIPv6(resolved.address)) {
      throw new Error('Website URL resolves to a private or loopback address');
    }
  }

  return parsedUrl.toString();
};

const fetchWebsiteProfileText = async (websiteUrl) => {
  if (!websiteUrl) return '';
  try {
    const safeUrl = await ensureSafeWebsiteUrl(websiteUrl);
    const response = await fetch(safeUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return '';
    const html = await response.text();
    return stripHtml(html).slice(0, 8000);
  } catch (_error) {
    return '';
  }
};

const mergeWithHistory = (template, workflowOperations = {}) => {
  const numericFields = [
    'powerConsumptionKwhPerMonth',
    'waterUsageKlPerMonth',
    'chemicalsUsageKgPerMonth',
    'fuelUsageLitersPerMonth',
    'solarInstallationKw',
    'solarGenerationKwhPerMonth',
    'solarUsageKwhPerMonth'
  ];
  const operationsData = { ...template.operationsData };
  numericFields.forEach((field) => {
    const historicalValue = Number(workflowOperations[field]);
    if (Number.isFinite(historicalValue) && historicalValue > 0) {
      operationsData[field] = historicalValue;
    }
  });
  return operationsData;
};

const generateOperationsTemplate = async ({
  msmeProfile = {},
  workflow = {},
  websiteUrl = ''
} = {}) => {
  const profileText = [
    msmeProfile.companyName,
    msmeProfile.industry,
    msmeProfile.businessDomain,
    ...(Array.isArray(msmeProfile?.manufacturingProfile?.keyProducts) ? msmeProfile.manufacturingProfile.keyProducts : [])
  ]
    .filter(Boolean)
    .join(' ');
  const websiteText = await fetchWebsiteProfileText(websiteUrl);

  const profileTemplateKey = inferTemplateKeyFromText(profileText);
  const websiteTemplateKey = inferTemplateKeyFromText(websiteText);
  const selectedTemplateKey = websiteTemplateKey !== 'generic' ? websiteTemplateKey : profileTemplateKey;
  const baseTemplate = TEMPLATE_LIBRARY[selectedTemplateKey] || TEMPLATE_LIBRARY.generic;

  const mergedOperationsData = mergeWithHistory(baseTemplate, workflow.operationsData || {});
  const historyChemicals = Array.isArray(workflow?.operationsData?.selectedChemicalOptions)
    ? workflow.operationsData.selectedChemicalOptions
    : [];
  const historyWater = Array.isArray(workflow?.operationsData?.selectedWaterTreatmentOptions)
    ? workflow.operationsData.selectedWaterTreatmentOptions
    : [];

  return {
    ...baseTemplate,
    agentSignals: {
      profileAgent: { detectedTemplate: profileTemplateKey },
      websiteAgent: { detectedTemplate: websiteTemplateKey, used: Boolean(websiteUrl) },
      historyAgent: {
        hasWorkflowHistory: Boolean(workflow && Object.keys(workflow).length > 0),
        reusedNumericMetrics: Object.values(mergedOperationsData).some((value) => Number(value) > 0)
      }
    },
    operationsData: mergedOperationsData,
    selectedChemicalOptions: historyChemicals.length > 0 ? historyChemicals : baseTemplate.suggestedChemicals.slice(0, 3),
    selectedWaterTreatmentOptions: historyWater.length > 0 ? historyWater : baseTemplate.suggestedWaterTreatments.slice(0, 3),
    availableTemplates: Object.values(TEMPLATE_LIBRARY).map((template) => ({
      templateName: template.templateName,
      rationale: template.rationale
    }))
  };
};

module.exports = {
  generateOperationsTemplate,
  ensureSafeWebsiteUrl
};
