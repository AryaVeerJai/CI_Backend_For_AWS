const mongoose = require('mongoose');
const CarbonOffset = require('../models/CarbonOffset');
require('dotenv').config();

const sampleOffsets = [
  {
    name: "Solar Power Plant - Rajasthan",
    description: "Large-scale solar power generation facility in Rajasthan, India. This project generates clean electricity and reduces carbon emissions by replacing fossil fuel-based power generation.",
    type: "renewable_energy",
    pricePerTon: 2500,
    availableCredits: 5000,
    totalCredits: 5000,
    verifiedBy: "Gold Standard",
    verificationId: "GS-IND-2024-001",
    location: {
      country: "India",
      state: "Rajasthan",
      city: "Jodhpur",
      coordinates: {
        latitude: 26.2389,
        longitude: 73.0243
      }
    },
    co2Reduction: 25000,
    rating: 4.8,
    imageUrl: "https://example.com/solar-rajasthan.jpg",
    projectDetails: {
      startDate: new Date('2023-01-01'),
      endDate: new Date('2033-12-31'),
      projectSize: "large",
      technology: "Photovoltaic Solar Panels",
      methodology: "CDM Methodology AMS-I.D",
      additionalBenefits: [
        "Job creation for local communities",
        "Reduced air pollution",
        "Energy security improvement"
      ]
    },
    environmentalImpact: {
      biodiversity: "positive",
      waterConservation: true,
      soilHealth: "maintained",
      airQuality: "improved"
    },
    socialImpact: {
      jobsCreated: 150,
      communityBenefits: [
        "Local employment opportunities",
        "Community development programs",
        "Educational initiatives"
      ],
      localParticipation: "high"
    },
    financials: {
      totalInvestment: 500000000,
      fundingSource: "private",
      returnOnInvestment: 12.5
    },
    isActive: true,
    isVerified: true,
    verificationDate: new Date('2023-06-15'),
    verificationExpiry: new Date('2028-06-15'),
    tags: ["solar", "renewable", "india", "large-scale", "verified"]
  },
  {
    name: "Community Forest Restoration - Karnataka",
    description: "Community-driven forest restoration project in Karnataka. This initiative involves local communities in planting and maintaining native tree species to restore degraded forest areas.",
    type: "reforestation",
    pricePerTon: 1800,
    availableCredits: 2000,
    totalCredits: 2000,
    verifiedBy: "VCS (Verified Carbon Standard)",
    verificationId: "VCS-IND-2024-002",
    location: {
      country: "India",
      state: "Karnataka",
      city: "Mysore",
      coordinates: {
        latitude: 12.2958,
        longitude: 76.6394
      }
    },
    co2Reduction: 8000,
    rating: 4.6,
    imageUrl: "https://example.com/forest-karnataka.jpg",
    projectDetails: {
      startDate: new Date('2023-03-01'),
      endDate: new Date('2033-02-28'),
      projectSize: "medium",
      technology: "Native Species Reforestation",
      methodology: "VCS Methodology VM0007",
      additionalBenefits: [
        "Biodiversity conservation",
        "Soil erosion prevention",
        "Water cycle restoration"
      ]
    },
    environmentalImpact: {
      biodiversity: "positive",
      waterConservation: true,
      soilHealth: "improved",
      airQuality: "improved"
    },
    socialImpact: {
      jobsCreated: 75,
      communityBenefits: [
        "Sustainable livelihood opportunities",
        "Forest product collection rights",
        "Environmental education programs"
      ],
      localParticipation: "high"
    },
    financials: {
      totalInvestment: 25000000,
      fundingSource: "mixed",
      returnOnInvestment: 8.2
    },
    isActive: true,
    isVerified: true,
    verificationDate: new Date('2023-08-20'),
    verificationExpiry: new Date('2028-08-20'),
    tags: ["reforestation", "community", "biodiversity", "karnataka", "sustainable"]
  },
  {
    name: "Wind Energy Farm - Tamil Nadu",
    description: "Offshore wind energy project in Tamil Nadu. This project harnesses strong coastal winds to generate clean electricity, contributing to India's renewable energy targets.",
    type: "renewable_energy",
    pricePerTon: 2200,
    availableCredits: 3000,
    totalCredits: 3000,
    verifiedBy: "CDM (Clean Development Mechanism)",
    verificationId: "CDM-IND-2024-003",
    location: {
      country: "India",
      state: "Tamil Nadu",
      city: "Chennai",
      coordinates: {
        latitude: 13.0827,
        longitude: 80.2707
      }
    },
    co2Reduction: 15000,
    rating: 4.7,
    imageUrl: "https://example.com/wind-tamilnadu.jpg",
    projectDetails: {
      startDate: new Date('2023-06-01'),
      endDate: new Date('2033-05-31'),
      projectSize: "large",
      technology: "Offshore Wind Turbines",
      methodology: "CDM Methodology ACM0002",
      additionalBenefits: [
        "Marine ecosystem protection",
        "Fisheries enhancement",
        "Coastal protection"
      ]
    },
    environmentalImpact: {
      biodiversity: "neutral",
      waterConservation: false,
      soilHealth: "maintained",
      airQuality: "improved"
    },
    socialImpact: {
      jobsCreated: 120,
      communityBenefits: [
        "Marine tourism opportunities",
        "Technical skill development",
        "Infrastructure development"
      ],
      localParticipation: "medium"
    },
    financials: {
      totalInvestment: 750000000,
      fundingSource: "private",
      returnOnInvestment: 15.3
    },
    isActive: true,
    isVerified: true,
    verificationDate: new Date('2023-09-10'),
    verificationExpiry: new Date('2028-09-10'),
    tags: ["wind", "offshore", "renewable", "tamilnadu", "marine"]
  },
  {
    name: "Carbon Capture Facility - Gujarat",
    description: "Industrial carbon capture and storage facility in Gujarat. This project captures CO2 emissions from industrial processes and stores them safely underground.",
    type: "carbon_capture",
    pricePerTon: 4500,
    availableCredits: 1000,
    totalCredits: 1000,
    verifiedBy: "ISO 14064",
    verificationId: "ISO-IND-2024-004",
    location: {
      country: "India",
      state: "Gujarat",
      city: "Ahmedabad",
      coordinates: {
        latitude: 23.0225,
        longitude: 72.5714
      }
    },
    co2Reduction: 5000,
    rating: 4.9,
    imageUrl: "https://example.com/ccs-gujarat.jpg",
    projectDetails: {
      startDate: new Date('2023-09-01'),
      endDate: new Date('2033-08-31'),
      projectSize: "medium",
      technology: "Post-Combustion Carbon Capture",
      methodology: "ISO 14064-2:2019",
      additionalBenefits: [
        "Industrial process optimization",
        "Waste heat recovery",
        "Advanced monitoring systems"
      ]
    },
    environmentalImpact: {
      biodiversity: "neutral",
      waterConservation: false,
      soilHealth: "maintained",
      airQuality: "improved"
    },
    socialImpact: {
      jobsCreated: 60,
      communityBenefits: [
        "High-tech employment opportunities",
        "Research collaboration",
        "Technology transfer programs"
      ],
      localParticipation: "medium"
    },
    financials: {
      totalInvestment: 200000000,
      fundingSource: "private",
      returnOnInvestment: 18.7
    },
    isActive: true,
    isVerified: true,
    verificationDate: new Date('2023-11-15'),
    verificationExpiry: new Date('2028-11-15'),
    tags: ["carbon-capture", "industrial", "gujarat", "technology", "storage"]
  },
  {
    name: "Energy Efficiency Program - Maharashtra",
    description: "Comprehensive energy efficiency program for MSMEs in Maharashtra. This project helps small and medium enterprises reduce their energy consumption through technology upgrades and process improvements.",
    type: "energy_efficiency",
    pricePerTon: 1200,
    availableCredits: 4000,
    totalCredits: 4000,
    verifiedBy: "BEE (Bureau of Energy Efficiency)",
    verificationId: "BEE-IND-2024-005",
    location: {
      country: "India",
      state: "Maharashtra",
      city: "Pune",
      coordinates: {
        latitude: 18.5204,
        longitude: 73.8567
      }
    },
    co2Reduction: 12000,
    rating: 4.5,
    imageUrl: "https://example.com/efficiency-maharashtra.jpg",
    projectDetails: {
      startDate: new Date('2023-04-01'),
      endDate: new Date('2026-03-31'),
      projectSize: "medium",
      technology: "Smart Energy Management Systems",
      methodology: "IPCC Guidelines for National Greenhouse Gas Inventories",
      additionalBenefits: [
        "Cost savings for MSMEs",
        "Technology adoption support",
        "Capacity building programs"
      ]
    },
    environmentalImpact: {
      biodiversity: "neutral",
      waterConservation: false,
      soilHealth: "maintained",
      airQuality: "improved"
    },
    socialImpact: {
      jobsCreated: 200,
      communityBenefits: [
        "MSME competitiveness improvement",
        "Skill development programs",
        "Technology transfer initiatives"
      ],
      localParticipation: "high"
    },
    financials: {
      totalInvestment: 80000000,
      fundingSource: "mixed",
      returnOnInvestment: 22.1
    },
    isActive: true,
    isVerified: true,
    verificationDate: new Date('2023-07-01'),
    verificationExpiry: new Date('2028-07-01'),
    tags: ["efficiency", "msme", "maharashtra", "smart", "capacity-building"]
  },
  {
    name: "Biomass Power Plant - Punjab",
    description: "Biomass power generation facility using agricultural waste in Punjab. This project converts agricultural residues into clean electricity while providing additional income to farmers.",
    type: "renewable_energy",
    pricePerTon: 2000,
    availableCredits: 2500,
    totalCredits: 2500,
    verifiedBy: "Gold Standard",
    verificationId: "GS-IND-2024-006",
    location: {
      country: "India",
      state: "Punjab",
      city: "Ludhiana",
      coordinates: {
        latitude: 30.9010,
        longitude: 75.8573
      }
    },
    co2Reduction: 10000,
    rating: 4.4,
    imageUrl: "https://example.com/biomass-punjab.jpg",
    projectDetails: {
      startDate: new Date('2023-05-01'),
      endDate: new Date('2033-04-30'),
      projectSize: "medium",
      technology: "Biomass Gasification",
      methodology: "CDM Methodology AMS-I.C",
      additionalBenefits: [
        "Agricultural waste management",
        "Rural employment generation",
        "Soil fertility improvement"
      ]
    },
    environmentalImpact: {
      biodiversity: "positive",
      waterConservation: false,
      soilHealth: "improved",
      airQuality: "improved"
    },
    socialImpact: {
      jobsCreated: 100,
      communityBenefits: [
        "Farmer income diversification",
        "Rural infrastructure development",
        "Agricultural extension services"
      ],
      localParticipation: "high"
    },
    financials: {
      totalInvestment: 150000000,
      fundingSource: "mixed",
      returnOnInvestment: 14.8
    },
    isActive: true,
    isVerified: true,
    verificationDate: new Date('2023-08-01'),
    verificationExpiry: new Date('2028-08-01'),
    tags: ["biomass", "agricultural", "punjab", "rural", "waste-management"]
  }
];

const seedCarbonOffsets = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carbon-intelligence');
    console.log('Connected to MongoDB');

    // Clear existing offsets
    await CarbonOffset.deleteMany({});
    console.log('Cleared existing carbon offsets');

    // Insert sample offsets
    const insertedOffsets = await CarbonOffset.insertMany(sampleOffsets);
    console.log(`Inserted ${insertedOffsets.length} carbon offset options`);

    // Display summary
    console.log('\nCarbon Offset Options Summary:');
    insertedOffsets.forEach(offset => {
      console.log(`- ${offset.name}: ₹${offset.pricePerTon}/ton (${offset.availableCredits} tons available)`);
    });

    console.log('\nSeeding completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding carbon offsets:', error);
    process.exit(1);
  }
};

// Run the seeding function
seedCarbonOffsets();