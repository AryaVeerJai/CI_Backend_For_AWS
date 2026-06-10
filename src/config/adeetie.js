/**
 * ADEETIE — Assistance in Deploying Energy Efficient Technologies in Industries & Establishments
 * Ministry of Power / Bureau of Energy Efficiency (BEE). Phase-1 reference data.
 */

const ADEETIE_SCHEME_CODE = 'ADEETIE-2025';
const ADEETIE_PORTAL_URL = 'https://adeetie.beeindia.gov.in/';
const ADEETIE_PIB_URL = 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2144822&reg=3&lang=2';

const LOAN_AMOUNT_MIN_INR = 1_000_000; // ₹10 lakh
const LOAN_AMOUNT_MAX_INR = 150_000_000; // ₹15 crore
const MIN_ENERGY_SAVINGS_PERCENT = 10;
const MAX_DEBT_FUNDING_PERCENT = 75;
const SCHEME_FY_START = '2025-26';
const SCHEME_FY_END = '2027-28';

const SUBVENTION_RATES = {
  micro: 5,
  small: 5,
  medium: 3
};

const BEE_SECTORS = [
  { id: 'brass', label: 'Brass' },
  { id: 'bricks', label: 'Bricks' },
  { id: 'ceramics', label: 'Ceramics' },
  { id: 'chemicals', label: 'Chemicals' },
  { id: 'fishery', label: 'Fishery' },
  { id: 'food_processing', label: 'Food Processing' },
  { id: 'forging', label: 'Forging' },
  { id: 'foundry', label: 'Foundry' },
  { id: 'glass_refractory', label: 'Glass & Refractory' },
  { id: 'leather', label: 'Leather' },
  { id: 'paper', label: 'Paper' },
  { id: 'pharma', label: 'Pharmaceutical' },
  { id: 'steel_rerolling', label: 'Steel Re-rolling' },
  { id: 'textiles', label: 'Textiles' }
];

/** Representative Phase-1 industrial clusters (extend as BEE publishes full list). */
const PHASE1_CLUSTERS = [
  { id: 'textiles-panipat-haryana', name: 'Panipat Textiles Cluster', state: 'Haryana', sectorId: 'textiles' },
  { id: 'textiles-tiruppur-tn', name: 'Tiruppur Knitwear Cluster', state: 'Tamil Nadu', sectorId: 'textiles' },
  { id: 'textiles-surat-gujarat', name: 'Surat Textiles Cluster', state: 'Gujarat', sectorId: 'textiles' },
  { id: 'foundry-agra-up', name: 'Agra Foundry Cluster', state: 'Uttar Pradesh', sectorId: 'foundry' },
  { id: 'foundry-kolhapur-mh', name: 'Kolhapur Foundry Cluster', state: 'Maharashtra', sectorId: 'foundry' },
  { id: 'brass-moradabad-up', name: 'Moradabad Brass Cluster', state: 'Uttar Pradesh', sectorId: 'brass' },
  { id: 'ceramics-morbi-gujarat', name: 'Morbi Ceramics Cluster', state: 'Gujarat', sectorId: 'ceramics' },
  { id: 'bricks-varanasi-up', name: 'Varanasi Brick Kiln Cluster', state: 'Uttar Pradesh', sectorId: 'bricks' },
  { id: 'chemicals-vapi-gujarat', name: 'Vapi Chemicals Cluster', state: 'Gujarat', sectorId: 'chemicals' },
  { id: 'food_processing-nashik-mh', name: 'Nashik Food Processing Cluster', state: 'Maharashtra', sectorId: 'food_processing' },
  { id: 'leather-kanpur-up', name: 'Kanpur Leather Cluster', state: 'Uttar Pradesh', sectorId: 'leather' },
  { id: 'leather-chennai-tn', name: 'Chennai Leather Cluster', state: 'Tamil Nadu', sectorId: 'leather' },
  { id: 'paper-vapi-gujarat', name: 'Vapi Paper Cluster', state: 'Gujarat', sectorId: 'paper' },
  { id: 'pharma-hyderabad-tg', name: 'Hyderabad Pharma Cluster', state: 'Telangana', sectorId: 'pharma' },
  { id: 'steel_rerolling-mandi-hp', name: 'Mandi Steel Re-rolling Cluster', state: 'Himachal Pradesh', sectorId: 'steel_rerolling' },
  { id: 'forging-ludhiana-pb', name: 'Ludhiana Forging Cluster', state: 'Punjab', sectorId: 'forging' },
  { id: 'glass_refractory-firozabad-up', name: 'Firozabad Glass Cluster', state: 'Uttar Pradesh', sectorId: 'glass_refractory' },
  { id: 'fishery-kochi-kl', name: 'Kochi Fisheries Processing Cluster', state: 'Kerala', sectorId: 'fishery' }
];

const JOURNEY_STAGES = [
  'not_started',
  'eligibility_reviewed',
  'expression_of_interest',
  'igea_scheduled',
  'dpr_prepared',
  'loan_sanctioned',
  'implementation',
  'monitoring_verification',
  'subvention_claimed'
];

const BUSINESS_DOMAIN_TO_BEE_SECTOR = {
  textiles: 'textiles',
  food_processing: 'food_processing',
  leather: 'leather',
  chemicals: 'chemicals',
  manufacturing: null
};

const INDUSTRY_KEYWORD_TO_BEE_SECTOR = [
  { pattern: /textile|garment|weav|knit/i, sectorId: 'textiles' },
  { pattern: /foundry|casting/i, sectorId: 'foundry' },
  { pattern: /forg(e|ing)/i, sectorId: 'forging' },
  { pattern: /brass/i, sectorId: 'brass' },
  { pattern: /brick|kiln/i, sectorId: 'bricks' },
  { pattern: /ceramic|tile|pottery/i, sectorId: 'ceramics' },
  { pattern: /chemical|petro|polymer/i, sectorId: 'chemicals' },
  { pattern: /leather|footwear|tannery/i, sectorId: 'leather' },
  { pattern: /paper|pulp/i, sectorId: 'paper' },
  { pattern: /pharma|pharmaceutical|api\b/i, sectorId: 'pharma' },
  { pattern: /steel|reroll|rolling mill/i, sectorId: 'steel_rerolling' },
  { pattern: /glass|refractory/i, sectorId: 'glass_refractory' },
  { pattern: /fish|seafood|aquaculture/i, sectorId: 'fishery' },
  { pattern: /food|dairy|beverage|agro/i, sectorId: 'food_processing' }
];

module.exports = {
  ADEETIE_SCHEME_CODE,
  ADEETIE_PORTAL_URL,
  ADEETIE_PIB_URL,
  LOAN_AMOUNT_MIN_INR,
  LOAN_AMOUNT_MAX_INR,
  MIN_ENERGY_SAVINGS_PERCENT,
  MAX_DEBT_FUNDING_PERCENT,
  SCHEME_FY_START,
  SCHEME_FY_END,
  SUBVENTION_RATES,
  BEE_SECTORS,
  PHASE1_CLUSTERS,
  JOURNEY_STAGES,
  BUSINESS_DOMAIN_TO_BEE_SECTOR,
  INDUSTRY_KEYWORD_TO_BEE_SECTOR
};
