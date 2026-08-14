const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TenantEntitlementPolicy = sequelize.define('TenantEntitlementPolicy', {
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
  scopeKey: {
    type: DataTypes.STRING(220),
    allowNull: false,
    unique: true,
  },
  cancellationWindowHours: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 24,
    validate: { min: 0 },
  },
  lateCancellationConsumesCredit: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  noShowConsumesCredit: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'tenant_entitlement_policies',
  timestamps: true,
  indexes: [
    { fields: ['tenantId', 'organizationId'] },
    { fields: ['scopeKey'], unique: true },
    { fields: ['isActive'] },
  ],
});

module.exports = TenantEntitlementPolicy;
