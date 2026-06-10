const mongoose = require('mongoose');
const { API_CONNECTOR_IDS, SUPPORTED_IMPORT_PROVIDERS } = require('../services/connectors/accountingConnectorRegistry');

const ALL_CONNECTOR_PROVIDERS = [...new Set([...SUPPORTED_IMPORT_PROVIDERS, ...API_CONNECTOR_IDS])];

const msmeConnectorConnectionSchema = new mongoose.Schema({
  msmeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MSME',
    sparse: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    sparse: true,
    index: true
  },
  provider: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    enum: ALL_CONNECTOR_PROVIDERS
  },
  connectionType: {
    type: String,
    enum: ['api', 'import'],
    required: true
  },
  status: {
    type: String,
    enum: ['connected', 'disconnected', 'error'],
    default: 'connected'
  },
  encryptedCredentials: {
    type: String,
    default: null
  },
  publicMeta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastSyncAt: Date,
  lastSyncError: {
    type: String,
    default: null
  },
  connectedAt: {
    type: Date,
    default: Date.now
  },
  disconnectedAt: Date
}, {
  timestamps: true
});

msmeConnectorConnectionSchema.index(
  { msmeId: 1, provider: 1 },
  { unique: true, partialFilterExpression: { msmeId: { $type: 'objectId' } } }
);

msmeConnectorConnectionSchema.index(
  { organizationId: 1, provider: 1 },
  { unique: true, partialFilterExpression: { organizationId: { $type: 'objectId' } } }
);

module.exports = mongoose.model('MsmeConnectorConnection', msmeConnectorConnectionSchema);
