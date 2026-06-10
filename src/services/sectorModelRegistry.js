const BASE_TRANSACTION_TYPES = {
  purchase: ['raw_materials', 'components', 'packaging'],
  sale: ['product_sales', 'service_billing'],
  expense: ['labor', 'rent', 'admin', 'marketing'],
  utility: ['electricity', 'water', 'fuel', 'gas'],
  maintenance: ['machinery_service', 'spares', 'lubricants'],
  compliance: ['waste_handling', 'pollution_control', 'safety'],
  transport: ['inbound_transport', 'outbound_transport', 'storage']
};

const BASE_LOCATION_WEIGHTAGES = {
  'north-india': { energy: 1.05, transport: 1.1, materials: 1.02, waste: 1.03, water: 1.02 },
  'south-india': { energy: 0.98, transport: 1.0, materials: 1.0, waste: 1.0, water: 1.01 },
  'east-india': { energy: 1.08, transport: 1.15, materials: 1.03, waste: 1.05, water: 1.03 },
  'west-india': { energy: 1.02, transport: 1.05, materials: 1.01, waste: 1.02, water: 1.01 },
  'northeast-india': { energy: 0.95, transport: 1.2, materials: 1.04, waste: 1.06, water: 1.03 },
  default: { energy: 1, transport: 1, materials: 1, waste: 1, water: 1 }
};

const SECTOR_LOCATION_SENSITIVITY = {
  manufacturing: { energy: 1.1, transport: 1.05, materials: 1.12, waste: 1.08, water: 1.05 },
  trading: { energy: 0.95, transport: 1.1, materials: 1.05, waste: 0.95, water: 0.95 },
  services: { energy: 0.9, transport: 0.95, materials: 0.85, waste: 0.9, water: 0.9 },
  export_import: { energy: 1.0, transport: 1.2, materials: 1.05, waste: 1.0, water: 1.0 },
  retail: { energy: 0.95, transport: 1.05, materials: 1.05, waste: 1.0, water: 0.95 },
  wholesale: { energy: 0.95, transport: 1.1, materials: 1.0, waste: 0.95, water: 0.95 },
  e_commerce: { energy: 1.0, transport: 1.15, materials: 1.08, waste: 1.05, water: 1.0 },
  consulting: { energy: 0.85, transport: 0.9, materials: 0.8, waste: 0.85, water: 0.85 },
  logistics: { energy: 1.05, transport: 1.25, materials: 1.0, waste: 1.0, water: 0.95 },
  agriculture: { energy: 0.95, transport: 1.0, materials: 1.0, waste: 0.95, water: 1.1 },
  handicrafts: { energy: 0.9, transport: 0.95, materials: 1.1, waste: 0.95, water: 0.95 },
  food_processing: { energy: 1.1, transport: 1.0, materials: 1.0, waste: 1.05, water: 1.1 },
  textiles: { energy: 1.1, transport: 1.0, materials: 1.1, waste: 1.05, water: 1.15 },
  electronics: { energy: 1.05, transport: 1.0, materials: 1.05, waste: 1.0, water: 0.95 },
  automotive: { energy: 1.1, transport: 1.05, materials: 1.15, waste: 1.05, water: 1.0 },
  construction: { energy: 1.05, transport: 1.1, materials: 1.2, waste: 1.1, water: 1.0 },
  healthcare: { energy: 1.0, transport: 1.0, materials: 1.05, waste: 1.1, water: 1.0 },
  education: { energy: 0.95, transport: 0.95, materials: 0.9, waste: 0.9, water: 0.95 },
  tourism: { energy: 1.0, transport: 1.1, materials: 0.95, waste: 1.0, water: 1.0 },
  other: { energy: 1, transport: 1, materials: 1, waste: 1, water: 1 }
};

const applyLocationSensitivity = (baseWeights, sensitivity) => {
  const adjusted = {};
  Object.entries(baseWeights).forEach(([region, weights]) => {
    adjusted[region] = {
      energy: weights.energy * (sensitivity.energy || 1),
      transport: weights.transport * (sensitivity.transport || 1),
      materials: weights.materials * (sensitivity.materials || 1),
      waste: weights.waste * (sensitivity.waste || 1),
      water: weights.water * (sensitivity.water || 1)
    };
  });
  return adjusted;
};

const mergeTransactionTypes = (base, extra = {}) => {
  const merged = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(extra || {})]);
  keys.forEach(key => {
    const baseList = base?.[key] || [];
    const extraList = extra?.[key] || [];
    merged[key] = Array.from(new Set([...baseList, ...extraList]));
  });
  return merged;
};

const OTHER_PLACEHOLDER_PARAMETERS = {
  process: 'other_process',
  machinery: 'other_machinery',
  rawMaterial: 'other_raw_material',
  output: 'other_output',
  location: 'other_location',
  parameter: 'other_parameter'
};

const withOtherPlaceholders = (model) => {
  const transactionTypes = model.transactionTypes || {};
  return {
    ...model,
    processes: Array.from(new Set([...(model.processes || []), OTHER_PLACEHOLDER_PARAMETERS.process])),
    machinery: Array.from(new Set([...(model.machinery || []), OTHER_PLACEHOLDER_PARAMETERS.machinery])),
    inputs: Array.from(new Set([...(model.inputs || []), OTHER_PLACEHOLDER_PARAMETERS.rawMaterial])),
    outputs: Array.from(new Set([...(model.outputs || []), OTHER_PLACEHOLDER_PARAMETERS.output])),
    transactionTypes: {
      ...transactionTypes,
      purchase: Array.from(new Set([...(transactionTypes.purchase || []), OTHER_PLACEHOLDER_PARAMETERS.rawMaterial])),
      expense: Array.from(new Set([...(transactionTypes.expense || []), OTHER_PLACEHOLDER_PARAMETERS.parameter])),
      utility: Array.from(new Set([...(transactionTypes.utility || []), OTHER_PLACEHOLDER_PARAMETERS.location])),
      maintenance: Array.from(new Set([...(transactionTypes.maintenance || []), OTHER_PLACEHOLDER_PARAMETERS.machinery])),
      transport: Array.from(new Set([...(transactionTypes.transport || []), OTHER_PLACEHOLDER_PARAMETERS.location])),
      compliance: Array.from(new Set([...(transactionTypes.compliance || []), OTHER_PLACEHOLDER_PARAMETERS.parameter]))
    },
    // Keep both names to avoid breaking existing consumers.
    placeholders: {
      location: OTHER_PLACEHOLDER_PARAMETERS.location,
      parameter: OTHER_PLACEHOLDER_PARAMETERS.parameter
    },
    otherPlaceholders: {
      ...OTHER_PLACEHOLDER_PARAMETERS
    }
  };
};

const buildSectorModel = ({
  key,
  label,
  processes = [],
  machinery = [],
  inputs = [],
  outputs = [],
  transactionTypes = {},
  locationSensitivity = {}
}) => withOtherPlaceholders({
  key,
  label,
  processes,
  machinery,
  inputs,
  outputs,
  transactionTypes: mergeTransactionTypes(BASE_TRANSACTION_TYPES, transactionTypes),
  locationWeightages: applyLocationSensitivity(
    BASE_LOCATION_WEIGHTAGES,
    locationSensitivity
  )
});

const SECTOR_MODELS = {
  manufacturing: buildSectorModel({
    key: 'manufacturing',
    label: 'Manufacturing',
    processes: ['assembly', 'fabrication', 'finishing', 'quality_control', 'material_preparation', 'machining', 'coating', 'packaging', 'inspection'],
    machinery: ['cnc_machines', 'boilers', 'compressors', 'generators', 'conveyors', 'furnaces', 'chillers', 'pumps'],
    inputs: ['metals', 'plastics', 'chemicals', 'packaging'],
    outputs: ['finished_goods', 'byproducts'],
    transactionTypes: {
      purchase: ['raw_metals', 'chemicals', 'packaging', 'spare_parts'],
      utility: ['steam', 'industrial_water', 'diesel'],
      maintenance: ['machinery_repair', 'calibration'],
      compliance: ['waste_treatment', 'emission_control', 'safety_audits'],
      transport: ['inbound_freight', 'outbound_freight']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.manufacturing
  }),
  trading: buildSectorModel({
    key: 'trading',
    label: 'Trading',
    processes: ['procurement', 'inventory_management', 'distribution', 'stock_reconciliation', 'order_fulfillment', 'returns_processing'],
    machinery: ['forklifts', 'scanners', 'warehouse_racks', 'barcode_printers', 'weighing_scales', 'pallet_jacks'],
    inputs: ['inventory_goods', 'packaging'],
    outputs: ['resold_goods'],
    transactionTypes: {
      purchase: ['inventory_stock', 'bulk_goods', 'packaging'],
      sale: ['resale', 'bulk_orders'],
      transport: ['inbound_logistics', 'outbound_logistics'],
      expense: ['warehouse_rent', 'brokerage', 'insurance']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.trading
  }),
  services: buildSectorModel({
    key: 'services',
    label: 'Services',
    processes: ['service_delivery', 'client_support', 'billing', 'client_onboarding', 'project_delivery', 'service_quality_review'],
    machinery: ['workstations', 'servers', 'office_equipment', 'networking_gear', 'backup_power'],
    inputs: ['software_licenses', 'office_supplies'],
    outputs: ['service_hours'],
    transactionTypes: {
      purchase: ['software', 'subscriptions', 'office_supplies'],
      sale: ['service_fees', 'retainers'],
      expense: ['payroll', 'rent', 'travel'],
      utility: ['internet', 'electricity']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.services
  }),
  export_import: buildSectorModel({
    key: 'export_import',
    label: 'Export/Import',
    processes: ['customs_clearance', 'international_shipping', 'documentation', 'port_handling', 'freight_forwarding', 'insurance_processing'],
    machinery: ['containers', 'tracking_devices', 'forklifts', 'container_handlers'],
    inputs: ['export_goods', 'packing_material'],
    outputs: ['exported_goods'],
    transactionTypes: {
      purchase: ['export_goods', 'packing_material'],
      sale: ['export_orders', 'import_distribution'],
      transport: ['ocean_freight', 'air_freight', 'customs_transport'],
      compliance: ['customs_duty', 'export_license']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.export_import
  }),
  retail: buildSectorModel({
    key: 'retail',
    label: 'Retail',
    processes: ['store_operations', 'inventory_replenishment', 'point_of_sale', 'merchandising', 'pricing', 'returns_management'],
    machinery: ['pos_systems', 'refrigeration', 'lighting', 'cctv_systems', 'weighing_scales'],
    inputs: ['inventory_goods', 'packaging'],
    outputs: ['retail_sales'],
    transactionTypes: {
      purchase: ['store_inventory', 'packaging', 'display_materials'],
      sale: ['pos_sales', 'online_orders'],
      expense: ['store_rent', 'staffing', 'marketing'],
      utility: ['electricity', 'water']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.retail
  }),
  wholesale: buildSectorModel({
    key: 'wholesale',
    label: 'Wholesale',
    processes: ['bulk_ordering', 'warehouse_handling', 'distribution', 'bulk_packing', 'demand_planning'],
    machinery: ['pallet_jacks', 'forklifts', 'inventory_scanners', 'dock_levelers', 'pallet_wrappers'],
    inputs: ['bulk_inventory', 'packaging'],
    outputs: ['wholesale_shipments'],
    transactionTypes: {
      purchase: ['bulk_inventory', 'packaging'],
      sale: ['bulk_orders', 'channel_sales'],
      transport: ['bulk_freight', 'warehouse_transfer'],
      expense: ['storage_rent', 'brokerage']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.wholesale
  }),
  e_commerce: buildSectorModel({
    key: 'e_commerce',
    label: 'E-Commerce',
    processes: ['order_fulfillment', 'last_mile_delivery', 'returns_processing', 'inventory_sync', 'order_routing', 'returns_sorting'],
    machinery: ['sorting_conveyors', 'packing_machines', 'servers', 'label_printers', 'barcode_scanners'],
    inputs: ['inventory_goods', 'packaging', 'labels'],
    outputs: ['delivered_orders'],
    transactionTypes: {
      purchase: ['inventory', 'packaging', 'shipping_labels'],
      sale: ['online_orders', 'marketplace_payouts'],
      transport: ['last_mile', 'reverse_logistics'],
      utility: ['electricity', 'cloud_services']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.e_commerce
  }),
  consulting: buildSectorModel({
    key: 'consulting',
    label: 'Consulting',
    processes: ['project_delivery', 'research', 'client_management', 'proposal_development', 'workshop_delivery'],
    machinery: ['laptops', 'collaboration_tools', 'presentation_tools'],
    inputs: ['software', 'travel'],
    outputs: ['reports', 'advisory_services'],
    transactionTypes: {
      purchase: ['software_licenses', 'research_tools'],
      sale: ['consulting_fees', 'project_billing'],
      expense: ['travel', 'training', 'subscriptions'],
      utility: ['internet', 'electricity']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.consulting
  }),
  logistics: buildSectorModel({
    key: 'logistics',
    label: 'Logistics',
    processes: ['fleet_operations', 'warehouse_management', 'route_planning', 'cross_docking', 'line_haul', 'fleet_maintenance', 'last_mile_delivery'],
    machinery: ['trucks', 'forklifts', 'gps_units', 'trailers', 'loading_docks'],
    inputs: ['fuel', 'spare_parts'],
    outputs: ['logistics_services'],
    transactionTypes: {
      purchase: ['diesel', 'spare_parts', 'tires'],
      sale: ['transport_services', 'warehousing_fees'],
      maintenance: ['fleet_maintenance', 'vehicle_repair'],
      compliance: ['emissions_testing', 'safety_inspection'],
      transport: ['toll_charges', 'route_fees']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.logistics
  }),
  agriculture: buildSectorModel({
    key: 'agriculture',
    label: 'Agriculture',
    processes: ['irrigation', 'harvesting', 'storage', 'soil_preparation', 'fertigation', 'crop_protection', 'sorting_grading'],
    machinery: ['tractors', 'pumps', 'sprayers', 'harvesters', 'drip_irrigation', 'seed_drills'],
    inputs: ['seeds', 'fertilizer', 'pesticides'],
    outputs: ['produce', 'byproducts'],
    transactionTypes: {
      purchase: ['seeds', 'fertilizer', 'pesticides', 'feed'],
      sale: ['crop_sales', 'produce_sales'],
      utility: ['water', 'electricity', 'diesel'],
      maintenance: ['equipment_service', 'spare_parts']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.agriculture
  }),
  handicrafts: buildSectorModel({
    key: 'handicrafts',
    label: 'Handicrafts',
    processes: ['handcrafting', 'dyeing', 'finishing', 'polishing', 'quality_check', 'customization'],
    machinery: ['looms', 'hand_tools', 'hand_looms', 'drying_racks'],
    inputs: ['yarn', 'dyes', 'wood'],
    outputs: ['handmade_goods'],
    transactionTypes: {
      purchase: ['raw_materials', 'dyes', 'packaging'],
      sale: ['artisan_goods', 'custom_orders'],
      utility: ['electricity', 'water'],
      expense: ['workshop_rent', 'labor']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.handicrafts
  }),
  food_processing: buildSectorModel({
    key: 'food_processing',
    label: 'Food Processing',
    processes: ['processing', 'cold_storage', 'packaging', 'cleaning', 'sorting', 'blending', 'quality_testing'],
    machinery: ['boilers', 'chillers', 'mixers', 'pasteurizers', 'packers'],
    inputs: ['raw_agri', 'packaging', 'additives'],
    outputs: ['processed_food'],
    transactionTypes: {
      purchase: ['raw_agri', 'packaging', 'additives'],
      utility: ['water', 'electricity', 'steam'],
      compliance: ['food_safety_tests', 'waste_management'],
      transport: ['cold_chain_logistics']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.food_processing
  }),
  textiles: buildSectorModel({
    key: 'textiles',
    label: 'Textiles',
    processes: ['spinning', 'weaving', 'dyeing', 'finishing', 'bleaching', 'printing', 'stitching'],
    machinery: ['looms', 'dyeing_machines', 'boilers', 'steamers', 'calenders'],
    inputs: ['cotton', 'yarn', 'dyes'],
    outputs: ['fabric', 'garments'],
    transactionTypes: {
      purchase: ['cotton', 'yarn', 'dyes', 'chemicals'],
      utility: ['water', 'steam', 'electricity'],
      compliance: ['effluent_treatment', 'waste_handling'],
      maintenance: ['loom_service', 'spare_parts']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.textiles
  }),
  electronics: buildSectorModel({
    key: 'electronics',
    label: 'Electronics',
    processes: ['pcb_assembly', 'testing', 'packaging', 'pcb_testing', 'cleaning', 'burn_in'],
    machinery: ['smt_lines', 'soldering_units', 'test_rigs', 'reflow_ovens', 'inspection_scanners'],
    inputs: ['components', 'solder', 'chemicals'],
    outputs: ['electronics'],
    transactionTypes: {
      purchase: ['components', 'solder', 'chemicals'],
      utility: ['electricity', 'cleanroom'],
      compliance: ['e_waste_disposal'],
      maintenance: ['equipment_calibration']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.electronics
  }),
  automotive: buildSectorModel({
    key: 'automotive',
    label: 'Automotive',
    processes: ['stamping', 'assembly', 'painting', 'heat_treatment', 'subassembly'],
    machinery: ['presses', 'paint_booths', 'welders', 'paint_lines', 'robotic_welders'],
    inputs: ['metals', 'paint', 'components'],
    outputs: ['auto_parts'],
    transactionTypes: {
      purchase: ['steel', 'components', 'paint', 'chemicals'],
      utility: ['electricity', 'gas'],
      compliance: ['emissions_control', 'waste_handling'],
      maintenance: ['equipment_service']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.automotive
  }),
  construction: buildSectorModel({
    key: 'construction',
    label: 'Construction',
    processes: ['site_preparation', 'construction', 'finishing', 'earthwork', 'formwork', 'curing'],
    machinery: ['excavators', 'mixers', 'cranes', 'concrete_pumps', 'backhoes'],
    inputs: ['cement', 'steel', 'aggregates'],
    outputs: ['buildings'],
    transactionTypes: {
      purchase: ['cement', 'steel', 'aggregates', 'tools'],
      transport: ['site_logistics', 'material_haul'],
      utility: ['diesel', 'water'],
      compliance: ['waste_disposal', 'permits']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.construction
  }),
  healthcare: buildSectorModel({
    key: 'healthcare',
    label: 'Healthcare',
    processes: ['patient_care', 'diagnostics', 'sterilization', 'waste_segregation', 'pharmacy_operations'],
    machinery: ['medical_devices', 'sterilizers', 'incinerators', 'autoclaves'],
    inputs: ['medical_supplies', 'chemicals'],
    outputs: ['health_services'],
    transactionTypes: {
      purchase: ['medical_supplies', 'pharma', 'chemicals'],
      utility: ['electricity', 'water'],
      compliance: ['bio_waste_disposal', 'licensing'],
      expense: ['staffing', 'facility_rent']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.healthcare
  }),
  education: buildSectorModel({
    key: 'education',
    label: 'Education',
    processes: ['teaching', 'facility_management', 'lab_operations', 'facility_cleaning'],
    machinery: ['computers', 'lab_equipment', 'projectors', 'it_servers'],
    inputs: ['books', 'stationery'],
    outputs: ['education_services'],
    transactionTypes: {
      purchase: ['books', 'lab_supplies', 'software'],
      sale: ['tuition', 'training_fees'],
      utility: ['electricity', 'internet'],
      expense: ['staffing', 'facility_maintenance']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.education
  }),
  tourism: buildSectorModel({
    key: 'tourism',
    label: 'Tourism',
    processes: ['hospitality', 'travel_services', 'event_management', 'housekeeping', 'food_service', 'laundry'],
    machinery: ['kitchen_equipment', 'vehicles', 'laundry_machines', 'water_heaters', 'kitchen_ovens'],
    inputs: ['food', 'linens', 'fuel'],
    outputs: ['tourism_services'],
    transactionTypes: {
      purchase: ['food_supplies', 'linens', 'fuel'],
      sale: ['booking_revenue', 'package_fees'],
      utility: ['electricity', 'water'],
      transport: ['guest_transport', 'tour_services'],
      compliance: ['waste_management']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.tourism
  }),
  other: buildSectorModel({
    key: 'other',
    label: 'Other',
    processes: ['operations', 'fulfillment', 'administration', 'procurement'],
    machinery: ['general_equipment', 'office_equipment', 'utility_backup'],
    inputs: ['misc_inputs'],
    outputs: ['misc_outputs'],
    transactionTypes: {
      purchase: ['general_inputs', 'supplies'],
      sale: ['general_sales'],
      expense: ['overheads', 'services']
    },
    locationSensitivity: SECTOR_LOCATION_SENSITIVITY.other
  })
};

const getSectorModel = (sectorKey) => {
  if (!sectorKey) return SECTOR_MODELS.other;
  return SECTOR_MODELS[sectorKey] || SECTOR_MODELS.other;
};

module.exports = {
  BASE_TRANSACTION_TYPES,
  BASE_LOCATION_WEIGHTAGES,
  SECTOR_LOCATION_SENSITIVITY,
  OTHER_PLACEHOLDER_PARAMETERS,
  SECTOR_MODELS,
  getSectorModel
};
