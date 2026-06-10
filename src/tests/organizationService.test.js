const mongoose = require('mongoose');

jest.mock('../models/Organization');
jest.mock('../models/MSME');
jest.mock('../models/Enterprise');

const Organization = require('../models/Organization');
const MSME = require('../models/MSME');
const Enterprise = require('../models/Enterprise');
const {
  createOrganizationForMsme,
  createOrganizationForEnterprise,
  resolveOrganizationContext
} = require('../services/organizationService');

describe('organizationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an organization for MSME profiles', async () => {
    const msme = {
      _id: new mongoose.Types.ObjectId(),
      companyName: 'Acme Fabrics',
      industry: 'textiles',
      udyamRegistrationNumber: 'UDYAM-DL-01-0000001',
      gstNumber: '07AABCS1234C1ZP',
      panNumber: 'AABCS1234C'
    };

    Organization.create.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      segment: 'msme',
      legalName: msme.companyName
    });
    MSME.findByIdAndUpdate.mockResolvedValue(msme);

    const organization = await createOrganizationForMsme(new mongoose.Types.ObjectId(), msme);

    expect(Organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        segment: 'msme',
        legalName: 'Acme Fabrics',
        msmeProfileId: msme._id
      })
    );
    expect(MSME.findByIdAndUpdate).toHaveBeenCalled();
    expect(organization.segment).toBe('msme');
  });

  it('creates an organization for enterprise profiles', async () => {
    const enterprise = {
      _id: new mongoose.Types.ObjectId(),
      companyName: 'Large Corp Ltd',
      industry: 'manufacturing',
      cinNumber: 'L12345MH2010PLC123456',
      gstNumber: '27AABCL1234A1Z5',
      panNumber: 'AABCL1234A'
    };

    Organization.create.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      segment: 'enterprise',
      legalName: enterprise.companyName
    });
    Enterprise.findByIdAndUpdate.mockResolvedValue(enterprise);

    const organization = await createOrganizationForEnterprise(new mongoose.Types.ObjectId(), enterprise);

    expect(Organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        segment: 'enterprise',
        enterpriseProfileId: enterprise._id
      })
    );
    expect(organization.segment).toBe('enterprise');
  });

  it('resolves organization context for authenticated users', async () => {
    const orgId = new mongoose.Types.ObjectId();
    Organization.findOne.mockResolvedValue({
      _id: orgId,
      segment: 'enterprise',
      legalName: 'Large Corp Ltd',
      msmeProfileId: null,
      enterpriseProfileId: new mongoose.Types.ObjectId()
    });
    MSME.updateOne.mockResolvedValue({});
    Enterprise.updateOne.mockResolvedValue({});

    const context = await resolveOrganizationContext({
      userId: new mongoose.Types.ObjectId(),
      role: 'enterprise',
      msmeId: null,
      enterpriseId: new mongoose.Types.ObjectId()
    });

    expect(context.organizationId).toEqual(orgId);
    expect(context.segment).toBe('enterprise');
  });
});
