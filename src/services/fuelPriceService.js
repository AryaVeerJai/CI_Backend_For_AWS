const axios = require('axios');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const PPAC_BASE_URL = 'https://ppac.gov.in';
const PPAC_RSP_PAGE_URL = `${PPAC_BASE_URL}/retail-selling-price-rsp-of-petrol-diesel-and-domestic-lpg/rsp-of-petrol-and-diesel-in-metro-cities-since-16-6-2017`;
const CACHE_KEY = 'ppac-metro-fuel-prices';
const CACHE_TTL_SECONDS = 30 * 60;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

const SUPPORTED_LOCATIONS = ['Delhi', 'Mumbai', 'Chennai', 'Kolkata'];
const LOCATION_ALIASES = {
  delhi: 'Delhi',
  'new delhi': 'Delhi',
  mumbai: 'Mumbai',
  bombay: 'Mumbai',
  chennai: 'Chennai',
  madras: 'Chennai',
  kolkata: 'Kolkata',
  calcutta: 'Kolkata'
};

const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

const cache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  checkperiod: 120,
  useClones: false
});

function resolveLocation(location) {
  if (!location) {
    return null;
  }

  const normalized = String(location).trim().toLowerCase();
  return LOCATION_ALIASES[normalized] || null;
}

function parseDateToken(dateToken) {
  const [dayRaw, monthRaw, yearRaw] = String(dateToken).split('-');
  const day = Number.parseInt(dayRaw, 10);
  const yearSuffix = Number.parseInt(yearRaw, 10);
  const month = MONTH_INDEX[String(monthRaw || '').toLowerCase()];

  if (!Number.isInteger(day) || !Number.isInteger(yearSuffix) || month === undefined) {
    return new Date(0);
  }

  const fullYear = yearSuffix >= 70 ? 1900 + yearSuffix : 2000 + yearSuffix;
  return new Date(Date.UTC(fullYear, month, day));
}

function parseFuelRowsFromPdfText(pdfText) {
  const normalizedText = String(pdfText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, ' ');

  const rowPattern = /(\d{1,2}-[A-Za-z]{3}-\d{2})\s*([0-9]{1,3}(?:\.[0-9]+)?)\s+([0-9]{1,3}(?:\.[0-9]+)?)\s+([0-9]{1,3}(?:\.[0-9]+)?)\s+([0-9]{1,3}(?:\.[0-9]+)?)\s+(\d{1,2}-[A-Za-z]{3}-\d{2})\s*([0-9]{1,3}(?:\.[0-9]+)?)\s+([0-9]{1,3}(?:\.[0-9]+)?)\s+([0-9]{1,3}(?:\.[0-9]+)?)\s+([0-9]{1,3}(?:\.[0-9]+)?)/g;

  const rows = [];
  const seen = new Set();
  let match = rowPattern.exec(normalizedText);

  while (match) {
    const petrolDate = match[1];
    const dieselDate = match[6];

    if (petrolDate === dieselDate) {
      const rowKey = `${petrolDate}-${match[2]}-${match[3]}-${match[4]}-${match[5]}-${match[7]}-${match[8]}-${match[9]}-${match[10]}`;
      if (!seen.has(rowKey)) {
        rows.push({
          date: petrolDate,
          petrol: {
            Delhi: Number.parseFloat(match[2]),
            Mumbai: Number.parseFloat(match[3]),
            Chennai: Number.parseFloat(match[4]),
            Kolkata: Number.parseFloat(match[5])
          },
          diesel: {
            Delhi: Number.parseFloat(match[7]),
            Mumbai: Number.parseFloat(match[8]),
            Chennai: Number.parseFloat(match[9]),
            Kolkata: Number.parseFloat(match[10])
          }
        });
        seen.add(rowKey);
      }
    }

    match = rowPattern.exec(normalizedText);
  }

  rows.sort((left, right) => parseDateToken(right.date) - parseDateToken(left.date));
  return rows;
}

function toAbsoluteUrl(href) {
  if (!href) {
    return null;
  }

  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  return new URL(href, PPAC_BASE_URL).toString();
}

async function extractCurrentDailyPdfUrl() {
  const response = await axios.get(PPAC_RSP_PAGE_URL, {
    timeout: 15000
  });

  const $ = cheerio.load(response.data);
  const candidates = [];

  $('ul.price-list a').each((_, linkElement) => {
    const href = $(linkElement).attr('href');
    const text = $(linkElement).text().trim();

    if (/\.pdf$/i.test(href || '') && /current/i.test(text)) {
      candidates.push(href);
    }
  });

  if (candidates.length === 0) {
    $('a[href$=".pdf"], a[href*=".pdf"]').each((_, linkElement) => {
      const href = $(linkElement).attr('href');
      if (/dailyprice/i.test(href || '')) {
        candidates.push(href);
      }
    });
  }

  const pdfUrl = toAbsoluteUrl(candidates[0]);
  if (!pdfUrl) {
    throw new Error('Unable to locate current PPAC daily petrol/diesel PDF');
  }

  return pdfUrl;
}

async function fetchFuelPricePayloadFromPpac() {
  const documentUrl = await extractCurrentDailyPdfUrl();
  const documentResponse = await axios.get(documentUrl, {
    responseType: 'arraybuffer',
    timeout: 20000
  });

  const parsedPdf = await pdfParse(documentResponse.data);
  const rows = parseFuelRowsFromPdfText(parsedPdf.text);

  if (rows.length === 0) {
    throw new Error('Failed to parse fuel prices from PPAC daily document');
  }

  return {
    rows,
    documentUrl,
    fetchedAt: new Date().toISOString()
  };
}

function buildLocationPriceMap(latestRow) {
  return SUPPORTED_LOCATIONS.reduce((accumulator, city) => {
    accumulator[city] = {
      petrol: latestRow.petrol[city],
      diesel: latestRow.diesel[city],
      unit: 'INR/L'
    };
    return accumulator;
  }, {});
}

function clampHistoryDays(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_DAYS;
  }

  return Math.max(1, Math.min(MAX_DAYS, Math.trunc(value)));
}

async function getFuelPrices(options = {}) {
  const requestedDays = clampHistoryDays(Number(options.days));
  const normalizedRequestedLocation = resolveLocation(options.location);
  const hasLocationFilter = options.location !== undefined && options.location !== null && String(options.location).trim() !== '';

  if (hasLocationFilter && !normalizedRequestedLocation) {
    const locationError = new Error(`Unsupported location "${options.location}". Supported locations: ${SUPPORTED_LOCATIONS.join(', ')}`);
    locationError.statusCode = 400;
    throw locationError;
  }
  const resolvedLocation = normalizedRequestedLocation || 'Delhi';

  let payload = cache.get(CACHE_KEY);
  if (!payload || options.forceRefresh === true) {
    payload = await fetchFuelPricePayloadFromPpac();
    cache.set(CACHE_KEY, payload);
    logger.info('Refreshed PPAC metro fuel prices', {
      rowsFetched: payload.rows.length,
      documentUrl: payload.documentUrl
    });
  }

  const [latestRow] = payload.rows;
  const historyRows = payload.rows.slice(0, requestedDays);

  return {
    source: {
      authority: 'Petroleum Planning and Analysis Cell (PPAC), Ministry of Petroleum and Natural Gas, Government of India',
      pageUrl: PPAC_RSP_PAGE_URL,
      documentUrl: payload.documentUrl
    },
    fetchedAt: payload.fetchedAt,
    lastUpdated: latestRow.date,
    priceUnit: 'INR/L',
    availableLocations: SUPPORTED_LOCATIONS,
    latestPrices: buildLocationPriceMap(latestRow),
    location: {
      name: resolvedLocation,
      unit: 'INR/L',
      petrol: latestRow.petrol[resolvedLocation],
      diesel: latestRow.diesel[resolvedLocation],
      history: historyRows.map((row) => ({
        date: row.date,
        petrol: row.petrol[resolvedLocation],
        diesel: row.diesel[resolvedLocation]
      }))
    }
  };
}

function clearFuelPriceCache() {
  cache.flushAll();
}

module.exports = {
  getFuelPrices,
  clearFuelPriceCache,
  __private: {
    parseFuelRowsFromPdfText,
    resolveLocation,
    extractCurrentDailyPdfUrl
  }
};
