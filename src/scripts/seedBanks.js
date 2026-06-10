const mongoose = require('mongoose');
const Bank = require('../models/Bank');
require('dotenv').config();

const connectDB = require('../config/database');

const sampleBanks = [
  {
    bankName: 'State Bank of India',
    bankCode: 'SBI001',
    contact: {
      email: 'greenloans@sbi.co.in',
      phone: '+91-11-23456789',
      address: {
        street: 'State Bank Bhavan, Madame Cama Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400021',
        country: 'India'
      }
    },
    greenLoanPolicy: {
      minCarbonScore: 60,
      maxLoanAmount: 50000000, // 5 crores
      minLoanAmount: 100000, // 1 lakh
      interestRateRange: {
        min: 8.5,
        max: 12.0
      },
      tenureRange: {
        min: 12,
        max: 60
      },
      carbonScoreDiscounts: [
        {
          scoreRange: { min: 80, max: 100 },
          discountPercentage: 1.5
        },
        {
          scoreRange: { min: 70, max: 79 },
          discountPercentage: 1.0
        },
        {
          scoreRange: { min: 60, max: 69 },
          discountPercentage: 0.5
        }
      ],
      requiredDocuments: [
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (6 months)',
        'Carbon Assessment Report',
        'Project Proposal',
        'Financial Statements'
      ],
      eligibilityCriteria: [
        'Minimum carbon score of 60',
        'MSME registration and verification',
        'Positive carbon reduction trend',
        'Environmental compliance certificates',
        'Viable green project proposal'
      ]
    }
  },
  {
    bankName: 'HDFC Bank',
    bankCode: 'HDFC001',
    contact: {
      email: 'sustainable@hdfcbank.com',
      phone: '+91-22-66521000',
      address: {
        street: 'HDFC Bank House, Senapati Bapat Marg',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400013',
        country: 'India'
      }
    },
    greenLoanPolicy: {
      minCarbonScore: 65,
      maxLoanAmount: 100000000, // 10 crores
      minLoanAmount: 200000, // 2 lakhs
      interestRateRange: {
        min: 9.0,
        max: 13.5
      },
      tenureRange: {
        min: 18,
        max: 72
      },
      carbonScoreDiscounts: [
        {
          scoreRange: { min: 85, max: 100 },
          discountPercentage: 2.0
        },
        {
          scoreRange: { min: 75, max: 84 },
          discountPercentage: 1.5
        },
        {
          scoreRange: { min: 65, max: 74 },
          discountPercentage: 1.0
        }
      ],
      requiredDocuments: [
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (12 months)',
        'Carbon Assessment Report',
        'Detailed Project Report',
        'Financial Statements (2 years)',
        'Environmental Clearance'
      ],
      eligibilityCriteria: [
        'Minimum carbon score of 65',
        'MSME registration and verification',
        'Consistent carbon reduction over 12 months',
        'All environmental compliance certificates',
        'Detailed project feasibility study',
        'Minimum 2 years of business operations'
      ]
    }
  },
  {
    bankName: 'ICICI Bank',
    bankCode: 'ICICI001',
    contact: {
      email: 'greenfinance@icicibank.com',
      phone: '+91-22-26561414',
      address: {
        street: 'ICICI Bank Towers, Bandra Kurla Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400051',
        country: 'India'
      }
    },
    greenLoanPolicy: {
      minCarbonScore: 70,
      maxLoanAmount: 75000000, // 7.5 crores
      minLoanAmount: 150000, // 1.5 lakhs
      interestRateRange: {
        min: 8.0,
        max: 12.5
      },
      tenureRange: {
        min: 24,
        max: 84
      },
      carbonScoreDiscounts: [
        {
          scoreRange: { min: 90, max: 100 },
          discountPercentage: 2.5
        },
        {
          scoreRange: { min: 80, max: 89 },
          discountPercentage: 2.0
        },
        {
          scoreRange: { min: 70, max: 79 },
          discountPercentage: 1.5
        }
      ],
      requiredDocuments: [
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (12 months)',
        'Carbon Assessment Report',
        'Technical Project Report',
        'Financial Statements (3 years)',
        'Environmental Impact Assessment',
        'Energy Audit Report'
      ],
      eligibilityCriteria: [
        'Minimum carbon score of 70',
        'MSME registration and verification',
        'Proven track record of sustainability initiatives',
        'All environmental compliance certificates',
        'Third-party energy audit report',
        'Minimum 3 years of business operations',
        'Positive cash flow for last 2 years'
      ]
    }
  },
  {
    bankName: 'Axis Bank',
    bankCode: 'AXIS001',
    contact: {
      email: 'sustainability@axisbank.com',
      phone: '+91-22-2425-2525',
      address: {
        street: 'Axis Bank House, C-2, G-Block, Bandra Kurla Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400051',
        country: 'India'
      }
    },
    greenLoanPolicy: {
      minCarbonScore: 62,
      maxLoanAmount: 25000000, // 2.5 crores
      minLoanAmount: 100000, // 1 lakh
      interestRateRange: {
        min: 8.75,
        max: 11.5
      },
      tenureRange: {
        min: 12,
        max: 48
      },
      carbonScoreDiscounts: [
        {
          scoreRange: { min: 85, max: 100 },
          discountPercentage: 1.75
        },
        {
          scoreRange: { min: 75, max: 84 },
          discountPercentage: 1.25
        },
        {
          scoreRange: { min: 62, max: 74 },
          discountPercentage: 0.75
        }
      ],
      requiredDocuments: [
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (6 months)',
        'Carbon Assessment Report',
        'Project Proposal',
        'Financial Statements (1 year)',
        'Environmental Compliance Certificate'
      ],
      eligibilityCriteria: [
        'Minimum carbon score of 62',
        'MSME registration and verification',
        'Demonstrated commitment to sustainability',
        'Basic environmental compliance',
        'Viable green project proposal',
        'Minimum 1 year of business operations'
      ]
    }
  },
  {
    bankName: 'Kotak Mahindra Bank',
    bankCode: 'KOTAK001',
    contact: {
      email: 'greenbanking@kotak.com',
      phone: '+91-22-6600-6000',
      address: {
        street: 'Kotak Mahindra Bank Limited, 27BKC, Bandra Kurla Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400051',
        country: 'India'
      }
    },
    greenLoanPolicy: {
      minCarbonScore: 68,
      maxLoanAmount: 30000000, // 3 crores
      minLoanAmount: 250000, // 2.5 lakhs
      interestRateRange: {
        min: 9.25,
        max: 13.0
      },
      tenureRange: {
        min: 18,
        max: 60
      },
      carbonScoreDiscounts: [
        {
          scoreRange: { min: 88, max: 100 },
          discountPercentage: 2.25
        },
        {
          scoreRange: { min: 78, max: 87 },
          discountPercentage: 1.75
        },
        {
          scoreRange: { min: 68, max: 77 },
          discountPercentage: 1.25
        }
      ],
      requiredDocuments: [
        'MSME Registration Certificate',
        'GST Certificate',
        'PAN Card',
        'Bank Statements (9 months)',
        'Carbon Assessment Report',
        'Comprehensive Project Report',
        'Financial Statements (2 years)',
        'Environmental Clearance Certificate',
        'ISO 14001 Certification (if available)'
      ],
      eligibilityCriteria: [
        'Minimum carbon score of 68',
        'MSME registration and verification',
        'Strong sustainability performance',
        'All required environmental certificates',
        'Comprehensive project documentation',
        'Minimum 2 years of business operations',
        'Stable financial performance'
      ]
    }
  }
];

async function seedBanks() {
  try {
    // Connect to database
    await connectDB();
    console.log('Connected to database');

    // Clear existing banks
    await Bank.deleteMany({});
    console.log('Cleared existing banks');

    // Insert sample banks
    const createdBanks = await Bank.insertMany(sampleBanks);
    console.log(`Created ${createdBanks.length} banks`);

    // Display created banks
    createdBanks.forEach(bank => {
      console.log(`- ${bank.bankName} (${bank.bankCode})`);
    });

    console.log('Bank seeding completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding banks:', error);
    process.exit(1);
  }
}

// Run the seeding function
seedBanks();