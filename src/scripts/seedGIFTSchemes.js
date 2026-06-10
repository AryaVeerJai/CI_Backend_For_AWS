const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../config/database');
const GIFTScheme = require('../models/GIFTScheme');
const User = require('../models/User');

const sampleGIFTSchemes = [
  {
    schemeName: 'ADEETIE — Energy Efficient Technologies (BEE)',
    schemeCode: 'ADEETIE-2025',
    description:
      'Ministry of Power / BEE flagship scheme: 5% interest subvention (Micro/Small), 3% (Medium) on loans ₹10 lakh–₹15 crore for energy-efficiency projects in 14 sectors and Phase-1 clusters. Includes IGEA, DPR, and M&V support.',
    category: 'energy',
    eligibilityCriteria: {
      minCarbonScore: 0,
      minAnnualTurnover: 0,
      maxAnnualTurnover: 25000000000,
      companyTypes: ['micro', 'small', 'medium'],
      industries: [
        'brass',
        'bricks',
        'ceramics',
        'chemicals',
        'fishery',
        'food_processing',
        'forging',
        'foundry',
        'glass',
        'leather',
        'paper',
        'pharma',
        'steel',
        'textiles'
      ],
      requiredCertifications: [],
      minEmployees: 1,
      maxEmployees: 10000
    },
    benefits: {
      incentiveType: 'loan_subsidy',
      incentiveAmount: 0,
      incentivePercentage: 5,
      maxIncentiveAmount: 0,
      description:
        '5% p.a. subvention (Micro/Small), 3% p.a. (Medium) for up to 3 years subject to ≥10% verified energy savings'
    },
    applicationProcess: {
      requiredDocuments: [
        'Udyam Registration Certificate',
        'GST Registration Certificate',
        'Investment Grade Energy Audit (IGEA)',
        'Detailed Project Report (DPR)',
        'Bank loan sanction letter',
        'M&V report (post-implementation)'
      ],
      applicationFee: 0,
      processingTime: 90,
      validityPeriod: 36
    },
    status: 'active',
    startDate: new Date('2025-04-01'),
    endDate: new Date('2028-03-31')
  },
  {
    schemeName: 'Green Technology Adoption Incentive',
    schemeCode: 'GTAI-2024',
    description: 'Financial support for MSMEs adopting green technologies to reduce carbon footprint and improve energy efficiency.',
    category: 'technology',
    eligibilityCriteria: {
      minCarbonScore: 60,
      minAnnualTurnover: 1000000,
      maxAnnualTurnover: 50000000,
      companyTypes: ['micro', 'small', 'medium'],
      industries: ['manufacturing', 'textiles', 'food', 'chemicals', 'electronics'],
      requiredCertifications: ['ISO 14001', 'Energy Audit Certificate'],
      minEmployees: 5,
      maxEmployees: 500
    },
    benefits: {
      incentiveType: 'subsidy',
      incentiveAmount: 500000,
      incentivePercentage: 25,
      maxIncentiveAmount: 2000000,
      description: 'Up to 25% of project cost or ₹5 lakhs, whichever is lower'
    },
    applicationProcess: {
      requiredDocuments: [
        'Project Proposal',
        'Technical Specifications',
        'Financial Projections',
        'Environmental Impact Assessment',
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (6 months)',
        'Audited Financial Statements (2 years)',
        'Energy Audit Report'
      ],
      applicationFee: 1000,
      processingTime: 30,
      validityPeriod: 12
    },
    status: 'active',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31')
  },
  {
    schemeName: 'Renewable Energy Implementation Grant',
    schemeCode: 'REIG-2024',
    description: 'Grant support for MSMEs implementing renewable energy solutions like solar panels, wind turbines, and biomass systems.',
    category: 'energy',
    eligibilityCriteria: {
      minCarbonScore: 70,
      minAnnualTurnover: 2000000,
      maxAnnualTurnover: 100000000,
      companyTypes: ['small', 'medium'],
      industries: ['manufacturing', 'textiles', 'food', 'chemicals'],
      requiredCertifications: ['ISO 50001', 'Renewable Energy Certificate'],
      minEmployees: 10,
      maxEmployees: 1000
    },
    benefits: {
      incentiveType: 'grant',
      incentiveAmount: 1000000,
      incentivePercentage: 30,
      maxIncentiveAmount: 5000000,
      description: 'Up to 30% of project cost or ₹10 lakhs, whichever is lower'
    },
    applicationProcess: {
      requiredDocuments: [
        'Detailed Project Report',
        'Technical Feasibility Study',
        'Environmental Clearance',
        'Grid Connectivity Certificate',
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (12 months)',
        'Audited Financial Statements (3 years)',
        'Renewable Energy Certificate',
        'Power Purchase Agreement (if applicable)'
      ],
      applicationFee: 2000,
      processingTime: 45,
      validityPeriod: 18
    },
    status: 'active',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31')
  },
  {
    schemeName: 'Digital Transformation Support',
    schemeCode: 'DTS-2024',
    description: 'Financial assistance for MSMEs to adopt digital technologies, automation, and Industry 4.0 solutions.',
    category: 'digital',
    eligibilityCriteria: {
      minCarbonScore: 50,
      minAnnualTurnover: 500000,
      maxAnnualTurnover: 25000000,
      companyTypes: ['micro', 'small', 'medium'],
      industries: ['manufacturing', 'textiles', 'food', 'electronics', 'automotive'],
      requiredCertifications: ['ISO 9001', 'Digital Security Certificate'],
      minEmployees: 3,
      maxEmployees: 300
    },
    benefits: {
      incentiveType: 'subsidy',
      incentiveAmount: 300000,
      incentivePercentage: 20,
      maxIncentiveAmount: 1500000,
      description: 'Up to 20% of project cost or ₹3 lakhs, whichever is lower'
    },
    applicationProcess: {
      requiredDocuments: [
        'Digital Transformation Plan',
        'Technology Vendor Quotations',
        'Implementation Timeline',
        'ROI Analysis',
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (6 months)',
        'Audited Financial Statements (2 years)',
        'IT Infrastructure Assessment'
      ],
      applicationFee: 500,
      processingTime: 21,
      validityPeriod: 9
    },
    status: 'active',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31')
  },
  {
    schemeName: 'Waste Management Innovation Fund',
    schemeCode: 'WMIF-2024',
    description: 'Support for MSMEs developing innovative waste management solutions and circular economy practices.',
    category: 'environment',
    eligibilityCriteria: {
      minCarbonScore: 65,
      minAnnualTurnover: 750000,
      maxAnnualTurnover: 30000000,
      companyTypes: ['micro', 'small', 'medium'],
      industries: ['manufacturing', 'textiles', 'food', 'chemicals', 'pharmaceuticals'],
      requiredCertifications: ['ISO 14001', 'Waste Management License'],
      minEmployees: 5,
      maxEmployees: 400
    },
    benefits: {
      incentiveType: 'grant',
      incentiveAmount: 750000,
      incentivePercentage: 35,
      maxIncentiveAmount: 3000000,
      description: 'Up to 35% of project cost or ₹7.5 lakhs, whichever is lower'
    },
    applicationProcess: {
      requiredDocuments: [
        'Innovation Proposal',
        'Technical Feasibility Study',
        'Environmental Impact Assessment',
        'Waste Management Plan',
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (6 months)',
        'Audited Financial Statements (2 years)',
        'Waste Management License',
        'Innovation Patent (if applicable)'
      ],
      applicationFee: 1500,
      processingTime: 35,
      validityPeriod: 15
    },
    status: 'active',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31')
  },
  {
    schemeName: 'Manufacturing Excellence Program',
    schemeCode: 'MEP-2024',
    description: 'Comprehensive support for MSMEs to improve manufacturing processes, quality standards, and operational efficiency.',
    category: 'manufacturing',
    eligibilityCriteria: {
      minCarbonScore: 55,
      minAnnualTurnover: 1500000,
      maxAnnualTurnover: 75000000,
      companyTypes: ['small', 'medium'],
      industries: ['manufacturing', 'textiles', 'food', 'chemicals', 'electronics', 'automotive'],
      requiredCertifications: ['ISO 9001', 'ISO 14001', 'Manufacturing License'],
      minEmployees: 10,
      maxEmployees: 600
    },
    benefits: {
      incentiveType: 'subsidy',
      incentiveAmount: 800000,
      incentivePercentage: 25,
      maxIncentiveAmount: 4000000,
      description: 'Up to 25% of project cost or ₹8 lakhs, whichever is lower'
    },
    applicationProcess: {
      requiredDocuments: [
        'Manufacturing Improvement Plan',
        'Process Optimization Study',
        'Quality Management System',
        'Equipment Specifications',
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (12 months)',
        'Audited Financial Statements (3 years)',
        'Manufacturing License',
        'Quality Certificates'
      ],
      applicationFee: 2500,
      processingTime: 40,
      validityPeriod: 18
    },
    status: 'active',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31')
  },
  {
    schemeName: 'Innovation and R&D Support',
    schemeCode: 'IRDS-2024',
    description: 'Funding support for MSMEs engaged in research and development of innovative products and technologies.',
    category: 'innovation',
    eligibilityCriteria: {
      minCarbonScore: 60,
      minAnnualTurnover: 1000000,
      maxAnnualTurnover: 50000000,
      companyTypes: ['small', 'medium'],
      industries: ['manufacturing', 'electronics', 'pharmaceuticals', 'chemicals', 'automotive'],
      requiredCertifications: ['ISO 9001', 'R&D Certificate'],
      minEmployees: 8,
      maxEmployees: 500
    },
    benefits: {
      incentiveType: 'grant',
      incentiveAmount: 1200000,
      incentivePercentage: 40,
      maxIncentiveAmount: 6000000,
      description: 'Up to 40% of project cost or ₹12 lakhs, whichever is lower'
    },
    applicationProcess: {
      requiredDocuments: [
        'R&D Project Proposal',
        'Technical Feasibility Study',
        'Innovation Patent Application',
        'Market Research Report',
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (12 months)',
        'Audited Financial Statements (3 years)',
        'R&D Certificate',
        'Innovation Patent (if available)',
        'Collaboration Agreements (if any)'
      ],
      applicationFee: 3000,
      processingTime: 60,
      validityPeriod: 24
    },
    status: 'active',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31')
  }
];

const seedGIFTSchemes = async () => {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // Find admin user
    const adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      console.log('No admin user found. Please create an admin user first.');
      process.exit(1);
    }

    // Clear existing schemes
    await GIFTScheme.deleteMany({});
    console.log('Cleared existing GIFT schemes');

    // Create new schemes
    const schemesWithAdmin = sampleGIFTSchemes.map(scheme => ({
      ...scheme,
      createdBy: adminUser._id
    }));

    const createdSchemes = await GIFTScheme.insertMany(schemesWithAdmin);
    console.log(`Created ${createdSchemes.length} GIFT schemes`);

    // Display created schemes
    createdSchemes.forEach(scheme => {
      console.log(`- ${scheme.schemeName} (${scheme.schemeCode})`);
    });

    console.log('GIFT schemes seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding GIFT schemes:', error);
    process.exit(1);
  }
};

// Run the seeder
if (require.main === module) {
  seedGIFTSchemes();
}

module.exports = seedGIFTSchemes;
