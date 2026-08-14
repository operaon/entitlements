'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const hasTable = async (tableName) => queryInterface.tableExists(tableName);

    if (!(await hasTable('entitlements'))) {
      await queryInterface.createTable('entitlements', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        sourceSystem: { type: Sequelize.STRING(80), allowNull: false },
        sourceId: { type: Sequelize.STRING(160), allowNull: false },
        tenantId: { type: Sequelize.UUID, allowNull: false },
        organizationId: { type: Sequelize.UUID, allowNull: true },
        patientId: { type: Sequelize.UUID, allowNull: false },
        productId: { type: Sequelize.UUID, allowNull: true },
        totalCredits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        availableCredits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        reservedCredits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        consumedCredits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        voidedCredits: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        status: {
          type: Sequelize.ENUM('ACTIVE', 'EXHAUSTED', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'ACTIVE',
        },
        expiresAt: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      });
    }

    if (!(await hasTable('entitlement_movements'))) {
      await queryInterface.createTable('entitlement_movements', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        entitlementId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'entitlements', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        appointmentId: { type: Sequelize.UUID, allowNull: true },
        type: {
          type: Sequelize.ENUM(
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
        availableDelta: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        reservedDelta: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        consumedDelta: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        voidedDelta: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        idempotencyKey: { type: Sequelize.STRING(220), allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: true },
        performedByUserId: { type: Sequelize.UUID, allowNull: true },
        occurredAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      });
    }

    if (!(await hasTable('tenant_entitlement_policies'))) {
      await queryInterface.createTable('tenant_entitlement_policies', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        tenantId: { type: Sequelize.UUID, allowNull: false },
        organizationId: { type: Sequelize.UUID, allowNull: true },
        scopeKey: { type: Sequelize.STRING(220), allowNull: false },
        cancellationWindowHours: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 24 },
        lateCancellationConsumesCredit: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        noShowConsumesCredit: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      });
    }

    await queryInterface.addIndex('entitlements', ['sourceSystem', 'sourceId'], { unique: true, name: 'entitlements_source_system_source_id_unique' }).catch(() => {});
    await queryInterface.addIndex('entitlements', ['tenantId', 'patientId'], { name: 'entitlements_tenant_patient_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlements', ['tenantId', 'organizationId', 'patientId'], { name: 'entitlements_tenant_org_patient_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlements', ['status'], { name: 'entitlements_status_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlements', ['expiresAt'], { name: 'entitlements_expires_at_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlement_movements', ['entitlementId', 'occurredAt'], { name: 'entitlement_movements_entitlement_occurred_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlement_movements', ['appointmentId'], { name: 'entitlement_movements_appointment_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlement_movements', ['type'], { name: 'entitlement_movements_type_idx' }).catch(() => {});
    await queryInterface.addIndex('entitlement_movements', ['idempotencyKey'], { unique: true, name: 'entitlement_movements_idempotency_unique' }).catch(() => {});
    await queryInterface.addIndex('tenant_entitlement_policies', ['tenantId', 'organizationId'], { name: 'tenant_entitlement_policies_tenant_org_idx' }).catch(() => {});
    await queryInterface.addIndex('tenant_entitlement_policies', ['scopeKey'], { unique: true, name: 'tenant_entitlement_policies_scope_key_unique' }).catch(() => {});
    await queryInterface.addIndex('tenant_entitlement_policies', ['isActive'], { name: 'tenant_entitlement_policies_active_idx' }).catch(() => {});
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tenant_entitlement_policies').catch(() => {});
    await queryInterface.dropTable('entitlement_movements').catch(() => {});
    await queryInterface.dropTable('entitlements').catch(() => {});
  },
};
