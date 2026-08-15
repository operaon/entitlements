const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FeatureGrant = sequelize.define('FeatureGrant', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  featureKey: {
    type: DataTypes.STRING(160),
    allowNull: false,
    validate: { notEmpty: true, len: [1, 160] },
  },
  kind: {
    type: DataTypes.ENUM('BOOLEAN', 'QUOTA'),
    allowNull: false,
  },
  unit: {
    type: DataTypes.STRING(64),
    allowNull: false,
    defaultValue: 'BOOLEAN',
  },
  limitValue: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 0 },
  },
  consumedValue: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  status: {
    type: DataTypes.ENUM('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED'),
    allowNull: false,
    defaultValue: 'ACTIVE',
  },
  sourceSystem: {
    type: DataTypes.STRING(80),
    allowNull: false,
  },
  sourceId: {
    type: DataTypes.STRING(160),
    allowNull: false,
  },
  startsAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
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
  tableName: 'feature_grants',
  timestamps: true,
  indexes: [
    { fields: ['tenantId', 'featureKey', 'status'] },
    { fields: ['tenantId', 'organizationId', 'featureKey'] },
    { fields: ['startsAt', 'expiresAt'] },
    { fields: ['tenantId', 'sourceSystem', 'sourceId', 'featureKey'], unique: true },
  ],
});

module.exports = FeatureGrant;
