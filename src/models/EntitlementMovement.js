const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EntitlementMovement = sequelize.define('EntitlementMovement', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  entitlementId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  appointmentId: {
    type: DataTypes.UUID,
    allowNull: true,
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
  type: {
    type: DataTypes.ENUM(
      'ISSUE',
      'MIGRATED_OPENING_BALANCE',
      'RESERVE',
      'RELEASE',
      'COMPLETE_CONSUME',
      'LATE_CANCEL_CONSUME',
      'NO_SHOW_CONSUME',
      'ADMIN_REFUND',
      'VOID',
    ),
    allowNull: false,
  },
  availableDelta: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  reservedDelta: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  consumedDelta: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  voidedDelta: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  idempotencyKey: {
    type: DataTypes.STRING(220),
    allowNull: false,
    unique: true,
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
  tableName: 'entitlement_movements',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['entitlementId', 'occurredAt'] },
    { fields: ['appointmentId'] },
    { fields: ['type'] },
    { fields: ['idempotencyKey'], unique: true },
    { fields: ['eventId'], unique: true },
    { fields: ['correlationId'] },
  ],
});

module.exports = EntitlementMovement;
