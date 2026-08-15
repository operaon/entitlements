'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const hasTable = async (tableName) => queryInterface.tableExists(tableName);

    if (!(await hasTable('feature_grants'))) {
      await queryInterface.createTable('feature_grants', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        tenantId: { type: Sequelize.UUID, allowNull: false },
        organizationId: { type: Sequelize.UUID, allowNull: true },
        featureKey: { type: Sequelize.STRING(160), allowNull: false },
        kind: { type: Sequelize.ENUM('BOOLEAN', 'QUOTA'), allowNull: false },
        unit: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'BOOLEAN' },
        limitValue: { type: Sequelize.INTEGER, allowNull: true },
        consumedValue: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        status: {
          type: Sequelize.ENUM('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED'),
          allowNull: false,
          defaultValue: 'ACTIVE',
        },
        sourceSystem: { type: Sequelize.STRING(80), allowNull: false },
        sourceId: { type: Sequelize.STRING(160), allowNull: false },
        startsAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        expiresAt: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      });
    }

    if (!(await hasTable('feature_grant_movements'))) {
      await queryInterface.createTable('feature_grant_movements', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        grantId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'feature_grants', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        tenantId: { type: Sequelize.UUID, allowNull: false },
        featureKey: { type: Sequelize.STRING(160), allowNull: false },
        type: {
          type: Sequelize.ENUM('ISSUE', 'CONSUME', 'RELEASE', 'ADJUST', 'REVOKE'),
          allowNull: false,
        },
        quantityDelta: { type: Sequelize.INTEGER, allowNull: false },
        idempotencyKey: { type: Sequelize.STRING(220), allowNull: false },
        eventId: { type: Sequelize.STRING(220), allowNull: true },
        correlationId: { type: Sequelize.STRING(220), allowNull: true },
        sourceSystem: { type: Sequelize.STRING(80), allowNull: true },
        sourceId: { type: Sequelize.STRING(160), allowNull: true },
        reason: { type: Sequelize.TEXT, allowNull: true },
        performedByUserId: { type: Sequelize.UUID, allowNull: true },
        occurredAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      });
    }

    await queryInterface.addIndex('feature_grants', ['tenantId', 'featureKey', 'status'], { name: 'feature_grants_tenant_feature_status_idx' }).catch(() => {});
    await queryInterface.addIndex('feature_grants', ['tenantId', 'organizationId', 'featureKey'], { name: 'feature_grants_tenant_org_feature_idx' }).catch(() => {});
    await queryInterface.addIndex('feature_grants', ['startsAt', 'expiresAt'], { name: 'feature_grants_effective_window_idx' }).catch(() => {});
    await queryInterface.addIndex('feature_grants', ['tenantId', 'sourceSystem', 'sourceId', 'featureKey'], { unique: true, name: 'feature_grants_tenant_source_feature_unique' }).catch(() => {});
    await queryInterface.addIndex('feature_grant_movements', ['grantId', 'occurredAt'], { name: 'feature_grant_movements_grant_occurred_idx' }).catch(() => {});
    await queryInterface.addIndex('feature_grant_movements', ['tenantId', 'featureKey', 'occurredAt'], { name: 'feature_grant_movements_tenant_feature_occurred_idx' }).catch(() => {});
    await queryInterface.addIndex('feature_grant_movements', ['tenantId', 'idempotencyKey'], { unique: true, name: 'feature_grant_movements_tenant_idempotency_unique' }).catch(() => {});
    await queryInterface.addIndex('feature_grant_movements', ['eventId'], { name: 'feature_grant_movements_event_idx' }).catch(() => {});
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('feature_grant_movements').catch(() => {});
    await queryInterface.dropTable('feature_grants').catch(() => {});
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_feature_grants_kind"').catch(() => {});
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_feature_grants_status"').catch(() => {});
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_feature_grant_movements_type"').catch(() => {});
  },
};
