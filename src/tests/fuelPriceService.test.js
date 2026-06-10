jest.mock('axios', () => ({
  get: jest.fn()
}));
jest.mock('pdf-parse', () => jest.fn());
jest.mock('cheerio', () => ({
  load: (html = '') => {
    const links = [];
    const anchorRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match = anchorRegex.exec(html);

    while (match) {
      links.push({
        href: match[1],
        text: String(match[2]).replace(/<[^>]*>/g, '').trim()
      });
      match = anchorRegex.exec(html);
    }

    const query = (selectorOrElement) => {
      if (typeof selectorOrElement === 'string') {
        let filtered = links;
        if (selectorOrElement.includes('a[href')) {
          filtered = links.filter((link) => /\.pdf/i.test(link.href));
        }

        return {
          each: (callback) => {
            filtered.forEach((link, index) => callback(index, link));
          }
        };
      }

      return {
        attr: (name) => (name === 'href' ? selectorOrElement.href : undefined),
        text: () => selectorOrElement.text || ''
      };
    };

    return query;
  }
}));

if (typeof global.ReadableStream === 'undefined') {
  const { ReadableStream } = require('node:stream/web');
  global.ReadableStream = ReadableStream;
}

if (typeof global.Blob === 'undefined') {
  const { Blob } = require('node:buffer');
  global.Blob = Blob;
}

if (typeof global.File === 'undefined') {
  const { File } = require('node:buffer');
  if (File) {
    global.File = File;
  }
}

const axios = require('axios');
const pdfParse = require('pdf-parse');
const fuelPriceService = require('../services/fuelPriceService');

const SAMPLE_PDF_TEXT = `
Table Posted:24-Feb-26
DelhiMumbaiChennaiKolkataDelhiMumbaiChennaiKolkata
24-Feb-2694.77           103.54         100.84         105.45        24-Feb-2687.67             90.03           92.39            92.02
23-Feb-2694.76           103.50         100.80         105.40        23-Feb-2687.60             90.00           92.30            91.99
`;

describe('fuelPriceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fuelPriceService.clearFuelPriceCache();
  });

  test('parses metro city rows from PPAC PDF text', () => {
    const rows = fuelPriceService.__private.parseFuelRowsFromPdfText(SAMPLE_PDF_TEXT);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: '24-Feb-26',
      petrol: {
        Delhi: 94.77,
        Mumbai: 103.54,
        Chennai: 100.84,
        Kolkata: 105.45
      },
      diesel: {
        Delhi: 87.67,
        Mumbai: 90.03,
        Chennai: 92.39,
        Kolkata: 92.02
      }
    });
  });

  test('returns location-wise fuel prices and history', async () => {
    axios.get.mockResolvedValueOnce({
      data: `
        <html>
          <ul class="price-list">
            <li><a href="/uploads/page-images/current-daily-price.pdf">Current</a></li>
          </ul>
        </html>
      `
    });
    axios.get.mockResolvedValueOnce({ data: Buffer.from('pdf-bytes') });
    pdfParse.mockResolvedValue({ text: SAMPLE_PDF_TEXT });

    const result = await fuelPriceService.getFuelPrices({
      location: 'mumbai',
      days: 2
    });

    expect(result.location).toMatchObject({
      name: 'Mumbai',
      petrol: 103.54,
      diesel: 90.03
    });
    expect(result.location.history).toHaveLength(2);
    expect(result.latestPrices.Delhi.petrol).toBe(94.77);
    expect(result.availableLocations).toEqual(['Delhi', 'Mumbai', 'Chennai', 'Kolkata']);
    expect(result.source.documentUrl).toBe('https://ppac.gov.in/uploads/page-images/current-daily-price.pdf');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('rejects unsupported locations', async () => {
    await expect(fuelPriceService.getFuelPrices({ location: 'Pune' }))
      .rejects
      .toMatchObject({ statusCode: 400 });
  });
});
