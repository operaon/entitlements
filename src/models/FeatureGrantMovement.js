const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FeatureGrantMovement = sequelize.define('FeatureGrantMovement', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  grantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  featureKey: {
    type: DataTypes.STRING(160),
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('ISSUE', 'CONSUME', 'RELEASE', 'ADJUST', 'REVOKE'),
    allowNull: false,
  },
  quantityDelta: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  idempotencyKey: {
    type: DataTypes.STRING(220),
    allowNull: false,
  },
  eventId: {
    type: DataTypes.STRING(220),
    allowNull: true,
  },
  correlationId: {
    type: DataTypes.STRING(220),
    allowNull: true,
  },
  sourceSystem: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  sourceId: {
    type: DataTypes.STRING(160),
    allowNull: true,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  performedByUserId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  occurredAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'feature_grant_movements',
  timestamps: true,
  indexes: [
    { fields: ['grantId', 'occurredAt'] },
    { fields: ['tenantId', 'featureKey', 'occurredAt'] },
    { fields: ['tenantId', 'idempotencyKey'], unique: true },
    { fields: ['eventId'] },
  ],
});

module.exports = FeatureGrantMovement;
