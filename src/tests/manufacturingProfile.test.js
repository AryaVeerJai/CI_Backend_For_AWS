const { normalizeMSMEPayload, normalizeManufacturingProfile } = require('../utils/manufacturingProfile');

describe('manufacturingProfile normalization (registration payloads)', () => {
  test('maps food processing sector to food_processing business domain', () => {
    const payload = normalizeMSMEPayload({
      companyName: 'Spice Pack Foods',
      Industry_Sector: 'Food products and spices',
      MSME_Type: 'Small Enterprise',
      NIC_Code: '1080'
    });
    expect(payload.businessDomain).toBe('food_processing');
    expect(payload.industry).toBe('Food products and spices');
    expect(payload.companyType).toBe('small');
    expect(payload.manufacturingProfile?.nicCode).toBe('1080');
  });

  test('maps textile sector to textiles business domain', () => {
    const payload = normalizeMSMEPayload({
      companyName: 'Cotton Weave Pvt Ltd',
      industrySector: 'Textile mill operations',
      msmeType: 'micro'
    });
    expect(payload.businessDomain).toBe('textiles');
    expect(payload.companyType).toBe('micro');
  });

  test('maps electronics and automotive sector strings', () => {
    const electronics = normalizeMSMEPayload({
      companyName: 'PCB Assembly Unit',
      industrySector: 'Electronic components assembly'
    });
    expect(electronics.businessDomain).toBe('electronics');

    const automotive = normalizeMSMEPayload({
      companyName: 'Auto Parts Fab',
      industrySector: 'Automotive supplier tier-2'
    });
    expect(automotive.businessDomain).toBe('automotive');
  });

  test('maps logistics and construction for service-adjacent manufacturing profiles', () => {
    const logistics = normalizeMSMEPayload({
      companyName: 'Cold Chain Logistics MSME',
      industrySector: 'Transport and cold storage'
    });
    expect(logistics.businessDomain).toBe('logistics');

    const construction = normalizeMSMEPayload({
      companyName: 'Precast Concrete Works',
      industrySector: 'Construction materials plant'
    });
    expect(construction.businessDomain).toBe('construction');
  });

  test('maps generic services and retail for MSME service companies', () => {
    const services = normalizeMSMEPayload({
      companyName: 'City Facility Services',
      industrySector: 'Commercial facility services'
    });
    expect(services.businessDomain).toBe('services');

    const retail = normalizeMSMEPayload({
      companyName: 'Neighbourhood Retail Mart',
      industrySector: 'Retail grocery chain'
    });
    expect(retail.businessDomain).toBe('retail');
  });

  test('maps trading and engineering manufacturing wording', () => {
    const trading = normalizeMSMEPayload({
      companyName: 'Agri Trade House',
      industrySector: 'Import export trading desk'
    });
    expect(trading.businessDomain).toBe('trading');

    const engineering = normalizeMSMEPayload({
      companyName: 'Precision Engineering Works',
      industrySector: 'Engineering workshop'
    });
    expect(engineering.businessDomain).toBe('manufacturing');
  });

  test('merges explicit manufacturingProfile over CSV-style root fields', () => {
    const payload = normalizeMSMEPayload(
      {
        Industry_Sector: 'Food processing',
        manufacturingProfile: {
          industrySector: 'chemical_chemical_products',
          primaryEnergySource: 'Grid + Solar',
          exportActivity: 'yes'
        }
      },
      {}
    );
    expect(payload.manufacturingProfile.industrySector).toBe('chemical_chemical_products');
    expect(payload.manufacturingProfile.primaryEnergySource).toBe('Grid + Solar');
    expect(payload.manufacturingProfile.exportActivity).toBe(true);
  });

  test('normalizeManufacturingProfile parses fuel list and comma-separated products', () => {
    const profile = normalizeManufacturingProfile({
      mainFuelsUsed: 'Diesel, PNG',
      keyProducts: 'Motors; Wiring harness',
      operationalDaysPerYear: '310'
    });
    expect(profile.mainFuelsUsed).toEqual(['Diesel', 'PNG']);
    expect(profile.keyProducts).toEqual(['Motors', 'Wiring harness']);
    expect(profile.operationalDaysPerYear).toBe(310);
  });
});
