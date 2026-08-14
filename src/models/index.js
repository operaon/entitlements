const sequelize = require('../config/database');
const Entitlement = require('./Entitlement');
const EntitlementMovement = require('./EntitlementMovement');
const TenantEntitlementPolicy = require('./TenantEntitlementPolicy');

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

module.exports = {
  sequelize,
  Entitlement,
  EntitlementMovement,
  TenantEntitlementPolicy,
};
