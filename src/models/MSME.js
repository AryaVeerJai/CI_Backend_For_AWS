const mongoose = require('mongoose');

const msmeSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    sparse: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  companyType: {
    type: String,
    enum: ['micro', 'small', 'medium'],
    required: true
  },
  industry: {
    type: String,
    required: true
  },
  businessDomain: {
    type: String,
    required: true,
    enum: [
      'manufacturing',
      'trading',
      'services',
      'export_import',
      'retail',
      'wholesale',
      'e_commerce',
      'consulting',
      'logistics',
      'agriculture',
      'handicrafts',
      'food_processing',
      'textiles',
      'electronics',
      'automotive',
      'construction',
      'healthcare',
      'education',
      'tourism',
      'other'
    ]
  },
  establishmentYear: {
    type: Number,
    required: true
  },
  udyamRegistrationNumber: {
    type: String,
    required: true,
    uppercase: true,
    match: /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/
  },
  gstNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
  },
  panNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
  },
  contact: {
    email: {
      type: String,
      required: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: 'India'
      }
    }
  },
  manufacturingProfile: {
    msmeType: {
      type: String,
      trim: true
    },
    industrySector: {
      type: String,
      trim: true
    },
    nicCode: {
      type: String,
      trim: true
    },
    yearOfEstablishment: Number,
    locationCity: {
      type: String,
      trim: true
    },
    locationState: {
      type: String,
      trim: true
    },
    locationCountry: {
      type: String,
      trim: true
    },
    numberOfEmployees: Number,
    plantAreaSqft: Number,
    operationalDaysPerYear: Number,
    primaryEnergySource: {
      type: String,
      trim: true
    },
    backupEnergySource: {
      type: String,
      trim: true
    },
    mainFuelsUsed: [{
      type: String,
      trim: true
    }],
    waterSource: {
      type: String,
      trim: true
    },
    wasteManagementPractice: {
      type: String,
      trim: true
    },
    keyProducts: [{
      type: String,
      trim: true
    }],
    productionCapacityPerMonth: Number,
    productionCapacityUnit: {
      type: String,
      trim: true
    },
    supplyChainType: {
      type: String,
      trim: true
    },
    logisticsMode: {
      type: String,
      trim: true
    },
    certifications: [{
      type: String,
      trim: true
    }],
    esgMaturityLevel: {
      type: String,
      trim: true
    },
    digitalizationLevel: {
      type: String,
      trim: true
    },
    carbonAccountingPractice: {
      type: String,
      trim: true
    },
    regulatoryExposure: [{
      type: String,
      trim: true
    }],
    exportActivity: Boolean,
    clusterAssociation: {
      type: String,
      trim: true
    },
    beeSector: {
      type: String,
      trim: true
    },
    adeetieClusterId: {
      type: String,
      trim: true
    },
    powerConsumptionKwhPerMonth: Number,
    waterConsumptionKlPerMonth: Number,
    chemicalsConsumptionKgPerMonth: Number,
    wasteRecycledKgPerMonth: Number,
    wasteWaterKlPerMonth: Number,
    solarInstallationKw: Number,
    solarGenerationKwhPerMonth: Number,
    importedRawMaterialsKgPerMonth: Number,
    outputProductsKgPerMonth: Number,
    servicesDeliveredPerMonth: Number,
    complianceCertifications: [{
      type: String,
      trim: true
    }],
    iso14064Aligned: {
      type: Boolean,
      default: false
    },
    iso14067Aligned: {
      type: Boolean,
      default: false
    },
    ghgProtocolAligned: {
      type: Boolean,
      default: false
    },
    recalculationPolicy: {
      policyStatement: {
        type: String,
        trim: true,
        default: ''
      },
      triggers: [{
        type: String,
        trim: true
      }],
      lastUpdatedAt: Date
    },
    ghgOrganizationalBoundary: {
      consolidationApproach: {
        type: String,
        enum: ['operational_control', 'financial_control', 'equity_share'],
        default: 'operational_control'
      },
      reportingEntityDescription: {
        type: String,
        trim: true,
        default: ''
      },
      includedLegalEntities: [{
        name: { type: String, trim: true },
        relationshipType: { type: String, trim: true },
        consolidationBasis: { type: String, trim: true }
      }],
      jointVentureEmissionAllocation: {
        type: String,
        enum: ['proportional_equity', 'operational_share', 'not_applicable'],
        default: 'not_applicable'
      },
      franchisesOrOutsourcedOperationsTreatment: {
        type: String,
        trim: true,
        default: ''
      },
      nonControlledOperationsExcluded: {
        type: Boolean,
        default: true
      },
      organizationalBoundaryNotes: {
        type: String,
        trim: true,
        default: ''
      },
      lastReviewedAt: Date
    }
  },
  operations: {
    sites: [{
      name: {
        type: String,
        trim: true
      },
      city: {
        type: String,
        trim: true
      },
      state: {
        type: String,
        trim: true
      },
      country: {
        type: String,
        trim: true
      }
    }],
    vehicles: [{
      type: {
        type: String,
        trim: true
      },
      fuelType: {
        type: String,
        trim: true
      },
      ownership: {
        type: String,
        trim: true
      },
      count: {
        type: Number,
        min: 0,
        default: 1
      },
      monthlyDistanceKm: {
        type: Number,
        min: 0,
        default: 0
      }
    }],
    subsidiaries: [{
      name: {
        type: String,
        trim: true
      },
      controlModel: {
        type: String,
        trim: true
      }
    }],
    metrics: {
      powerConsumptionKwhPerMonth: Number,
      waterConsumptionKlPerMonth: Number,
      chemicalsConsumptionKgPerMonth: Number,
      fuelUsageLitersPerMonth: Number,
      recycledWasteKgPerMonth: Number,
      wasteWaterKlPerMonth: Number,
      solarInstallationKw: Number,
      solarGenerationKwhPerMonth: Number,
      importedRawMaterialsKgPerMonth: Number,
      outputProductsKgPerMonth: Number,
      servicesDeliveredPerMonth: Number,
      annualTurnoverInr: Number,
      complianceCertifications: [{
        type: String,
        trim: true
      }],
      iso14064Aligned: {
        type: Boolean,
        default: false
      },
      iso14067Aligned: {
        type: Boolean,
        default: false
      },
      ghgProtocolAligned: {
        type: Boolean,
        default: false
      }
    },
    operationsDataFeed: {
      selectedChemicalOptions: [{
        type: String,
        trim: true
      }],
      selectedWaterTreatmentOptions: [{
        type: String,
        trim: true
      }]
    },
    aiAgentRecommendations: {
      resourceUnderstandingAgents: [{
        type: String,
        trim: true
      }],
      carbonEmissionAgents: [{
        type: String,
        trim: true
      }]
    },
    ghgOperationalBoundary: {
      reportingPeriodType: {
        type: String,
        enum: ['calendar_year', 'financial_year'],
        default: 'financial_year'
      },
      reportingPeriodEndMonth: {
        type: Number,
        min: 1,
        max: 12,
        default: 3
      },
      baseYear: {
        type: Number,
        min: 1990,
        max: 2100
      },
      materialityThresholdPercent: {
        type: Number,
        min: 0,
        max: 25,
        default: 5
      },
      scope1StationaryCombustion: { type: Boolean, default: true },
      scope1MobileCombustion: { type: Boolean, default: true },
      scope1ProcessEmissions: { type: Boolean, default: true },
      scope1FugitiveEmissions: { type: Boolean, default: true },
      scope2LocationBased: { type: Boolean, default: true },
      scope2MarketBased: { type: Boolean, default: false },
      scope3CategoriesIncluded: [{
        type: Number,
        min: 1,
        max: 15
      }],
      scope3OutOfBoundarySummary: {
        type: String,
        trim: true,
        default: ''
      },
      biogenicCo2Approach: {
        type: String,
        enum: ['reported_separately', 'included_with_fossil', 'not_applicable'],
        default: 'reported_separately'
      },
      operationalBoundaryDefinitionSummary: {
        type: String,
        trim: true,
        default: ''
      },
      operationalBoundaryNotes: {
        type: String,
        trim: true,
        default: ''
      },
      lastReviewedAt: Date,
      boundaryAgentRunAt: Date
    }
  },
  business: {
    annualTurnover: {
      type: Number,
      required: true
    },
    numberOfEmployees: {
      type: Number,
      required: true
    },
    manufacturingUnits: {
      type: Number,
      required: true
    },
    primaryProducts: {
      type: String,
      required: true
    },
    solarPower: {
      installedCapacityKw: {
        type: Number,
        min: 0,
        default: 0
      },
      annualGenerationKwh: {
        type: Number,
        min: 0,
        default: 0
      },
      annualUsageKwh: {
        type: Number,
        min: 0,
        default: 0
      },
      netMeteringEnabled: {
        type: Boolean,
        default: false
      },
      lastUpdatedAt: Date
    },
    manufacturingWorkflow: {
      isLocked: {
        type: Boolean,
        default: false
      },
      lockedAt: Date,
      employees: [{
        name: {
          type: String,
          trim: true
        },
        phone: {
          type: String,
          trim: true
        },
        assignedUnitId: {
          type: String,
          trim: true
        },
        commuteMode: {
          type: String,
          enum: ['car_petrol', 'car_diesel', 'two_wheeler', 'bus', 'train', 'bike', 'walk_cycle', 'custom'],
          default: 'two_wheeler'
        },
        commuteDistanceKmPerDay: {
          type: Number,
          min: 0,
          default: 0
        },
        workingDaysPerMonth: {
          type: Number,
          min: 0,
          default: 22
        },
        customEmissionFactorKgPerKm: {
          type: Number,
          min: 0,
          default: 0
        }
      }],
      supplyChain: [{
        partnerName: {
          type: String,
          trim: true
        },
        partnerType: {
          type: String,
          enum: ['supplier', 'inbound_logistics', 'warehouse', 'distributor', 'customer_delivery', 'third_party_logistics', 'custom'],
          default: 'supplier'
        },
        assignedUnitId: {
          type: String,
          trim: true
        },
        transportMode: {
          type: String,
          enum: ['road_diesel', 'road_petrol', 'road_cng', 'rail', 'sea', 'air', 'electric_vehicle', 'custom'],
          default: 'road_diesel'
        },
        distanceKm: {
          type: Number,
          min: 0,
          default: 0
        },
        shipmentWeightKgPerMonth: {
          type: Number,
          min: 0,
          default: 0
        },
        tripsPerMonth: {
          type: Number,
          min: 0,
          default: 1
        },
        customEmissionFactorKgPerTonKm: {
          type: Number,
          min: 0,
          default: 0
        },
        notes: {
          type: String,
          default: ''
        }
      }],
      operationsData: {
        powerConsumptionKwhPerMonth: {
          type: Number,
          min: 0,
          default: 0
        },
        waterUsageKlPerMonth: {
          type: Number,
          min: 0,
          default: 0
        },
        chemicalsUsageKgPerMonth: {
          type: Number,
          min: 0,
          default: 0
        },
        fuelUsageLitersPerMonth: {
          type: Number,
          min: 0,
          default: 0
        },
        selectedChemicalOptions: [{
          type: String,
          trim: true
        }],
        selectedWaterTreatmentOptions: [{
          type: String,
          trim: true
        }],
        transportationVehicles: [{
          vehicleType: {
            type: String,
            trim: true
          },
          fuelType: {
            type: String,
            trim: true
          },
          ownership: {
            type: String,
            trim: true
          },
          count: {
            type: Number,
            min: 0,
            default: 1
          },
          monthlyDistanceKm: {
            type: Number,
            min: 0,
            default: 0
          }
        }]
      },
      units: [{
        unitId: {
          type: String,
          trim: true
        },
        name: {
          type: String,
          trim: true
        },
        location: {
          type: String,
          default: ''
        },
        products: [{
          type: String,
          trim: true
        }],
        processes: [{
          name: {
            type: String,
            trim: true
          },
          description: {
            type: String,
            default: ''
          },
          durationHours: {
            type: Number,
            min: 0,
            default: 1
          },
          cycleCountPerDay: {
            type: Number,
            min: 0,
            default: 1
          },
          machineries: [{
            name: {
              type: String,
              trim: true
            },
            quantity: {
              type: Number,
              min: 0,
              default: 1
            },
            powerRatingKw: {
              type: Number,
              min: 0,
              default: 0
            },
            fuelType: {
              type: String,
              enum: ['electricity', 'diesel', 'petrol', 'cng', 'lpg', 'coal', 'custom'],
              default: 'electricity'
            },
            fuelUsagePerHour: {
              type: Number,
              min: 0,
              default: 0
            },
            customEmissionFactor: {
              type: Number,
              min: 0,
              default: 0
            }
          }],
          rawMaterials: [{
            name: {
              type: String,
              trim: true
            },
            quantityKg: {
              type: Number,
              min: 0,
              default: 0
            },
            emissionFactorKgCO2PerKg: {
              type: Number,
              min: 0,
              default: 0
            },
            isPackagingMaterial: {
              type: Boolean,
              default: false
            }
          }]
        }]
      }],
      processes: [{
        name: {
          type: String,
          trim: true
        },
        description: {
          type: String,
          default: ''
        },
        durationHours: {
          type: Number,
          min: 0,
          default: 1
        },
        cycleCountPerDay: {
          type: Number,
          min: 0,
          default: 1
        },
        machineries: [{
          name: {
            type: String,
            trim: true
          },
          quantity: {
            type: Number,
            min: 0,
            default: 1
          },
          powerRatingKw: {
            type: Number,
            min: 0,
            default: 0
          },
          fuelType: {
            type: String,
            enum: ['electricity', 'diesel', 'petrol', 'cng', 'lpg', 'coal', 'custom'],
            default: 'electricity'
          },
          fuelUsagePerHour: {
            type: Number,
            min: 0,
            default: 0
          },
          customEmissionFactor: {
            type: Number,
            min: 0,
            default: 0
          }
        }],
        rawMaterials: [{
          name: {
            type: String,
            trim: true
          },
          quantityKg: {
            type: Number,
            min: 0,
            default: 0
          },
          emissionFactorKgCO2PerKg: {
            type: Number,
            min: 0,
            default: 0
          },
          isPackagingMaterial: {
            type: Boolean,
            default: false
          }
        }]
      }],
      latestEstimate: {
        totalCO2Emissions: {
          type: Number,
          default: 0
        },
        machineryEmissions: {
          type: Number,
          default: 0
        },
        rawMaterialEmissions: {
          type: Number,
          default: 0
        },
        packagingMaterialEmissions: {
          type: Number,
          default: 0
        },
        scope3Emissions: {
          type: Number,
          default: 0
        },
        commuteEmissions: {
          type: Number,
          default: 0
        },
        supplyChainEmissions: {
          type: Number,
          default: 0
        },
        valueChainEmissions: {
          upstream: {
            type: Number,
            default: 0
          },
          operations: {
            type: Number,
            default: 0
          },
          downstream: {
            type: Number,
            default: 0
          },
          support: {
            type: Number,
            default: 0
          },
          total: {
            type: Number,
            default: 0
          }
        }
      },
      lastEstimatedAt: Date
    }
  },
  indianCarbonMarket: {
    portalEntityId: {
      type: String,
      trim: true,
      default: ''
    },
    registeredOnPortal: {
      type: Boolean,
      default: false
    },
    lastPortalSyncAt: {
      type: Date,
      default: null
    }
  },
  environmentalCompliance: {
    hasEnvironmentalClearance: {
      type: Boolean,
      default: false
    },
    hasPollutionControlBoard: {
      type: Boolean,
      default: false
    },
    hasWasteManagement: {
      type: Boolean,
      default: false
    }
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'flagged', 'suspended'],
    default: 'pending',
    index: true
  },
  adminNotes: [{
    note: {
      type: String,
      trim: true,
      required: true
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  flaggedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  flaggedAt: Date,
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDate: Date,
  carbonScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  lastCarbonAssessment: Date,
  adeetieJourney: {
    stage: {
      type: String,
      enum: [
        'not_started',
        'eligibility_reviewed',
        'expression_of_interest',
        'igea_scheduled',
        'dpr_prepared',
        'loan_sanctioned',
        'implementation',
        'monitoring_verification',
        'subvention_claimed'
      ],
      default: 'not_started'
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    updatedAt: {
      type: Date,
      default: null
    }
  },
  sustainabilitySettings: {
    reductionTargetPct: {
      type: Number,
      min: 0,
      max: 40,
      default: 10
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
msmeSchema.index({ userId: 1 });
msmeSchema.index({ udyamRegistrationNumber: 1 });
msmeSchema.index({ gstNumber: 1 });
msmeSchema.index({ companyName: 'text' });

module.exports = mongoose.model('MSME', msmeSchema);