const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Entitlement = sequelize.define('Entitlement', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  sourceSystem: {
    type: DataTypes.STRING(80),
    allowNull: false,
  },
  sourceId: {
    type: DataTypes.STRING(160),
    allowNull: false,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  patientId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  totalCredits: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  availableCredits: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  reservedCredits: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  consumedCredits: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  voidedCredits: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'EXHAUSTED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'ACTIVE',
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
}, {
  tableName: 'entitlements',
  timestamps: true,
  indexes: [
    { fields: ['sourceSystem', 'sourceId'], unique: true },
    { fields: ['tenantId', 'patientId'] },
    { fields: ['tenantId', 'organizationId', 'patientId'] },
    { fields: ['status'] },
    { fields: ['expiresAt'] },
  ],
});

module.exports = Entitlement;
