const sequelize = require('../config/database');
const Entitlement = require('./Entitlement');
const EntitlementMovement = require('./EntitlementMovement');
const TenantEntitlementPolicy = require('./TenantEntitlementPolicy');
const FeatureGrant = require('./FeatureGrant');
const FeatureGrantMovement = require('./FeatureGrantMovement');

Entitlement.hasMany(EntitlementMovement, {
  foreignKey: 'entitlementId',
  as: 'movements',
  onDelete: 'CASCADE',
});
EntitlementMovement.belongsTo(Entitlement, {
  foreignKey: 'entitlementId',
  as: 'entitlement',
  onDelete: 'CASCADE',
});

FeatureGrant.hasMany(FeatureGrantMovement, {
  foreignKey: 'grantId',
  as: 'movements',
  onDelete: 'CASCADE',
});
FeatureGrantMovement.belongsTo(FeatureGrant, {
  foreignKey: 'grantId',
  as: 'grant',
  onDelete: 'CASCADE',
});

module.exports = {
  sequelize,
  Entitlement,
  EntitlementMovement,
  TenantEntitlementPolicy,
  FeatureGrant,
  FeatureGrantMovement,
};
