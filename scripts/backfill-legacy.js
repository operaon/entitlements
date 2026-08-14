require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');
const env = require('../src/config/env');
const { sequelize, Entitlement, EntitlementMovement, TenantEntitlementPolicy } = require('../src/models');

const legacy = env.legacyDatabase.url
  ? new Sequelize(env.legacyDatabase.url, { dialect: 'postgres', logging: false })
  : new Sequelize(env.legacyDatabase.name, env.legacyDatabase.user, env.legacyDatabase.password, {
    dialect: 'postgres', host: env.legacyDatabase.host, port: env.legacyDatabase.port, logging: false,
  });

const hasTable = async (tableName) => {
  const rows = await legacy.query('SELECT to_regclass(:tableName) AS relation', {
    replacements: { tableName }, type: QueryTypes.SELECT,
  });
  return Boolean(rows[0]?.relation);
};

const pick = (row, ...keys) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null);
const uuid = (value) => (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null);
const scopeOf = (row) => ({
  tenantId: uuid(pick(row, 'tenantId', 'tenant_id')),
  organizationId: uuid(pick(row, 'organizationId', 'organization_id')),
});

const main = async () => {
  const writeEnabled = env.backfillWriteEnabled;
  const summary = {
    dryRun: !writeEnabled,
    entitlements: { candidates: 0, written: 0, skipped: 0, missing: false },
    movements: { candidates: 0, written: 0, skipped: 0, missing: false },
    policies: { candidates: 0, written: 0, skipped: 0, missing: false },
  };
  if (writeEnabled) {
    await sequelize.authenticate();
    console.warn('BACKFILL_WRITE_ENABLED=true: execução somente-aditiva habilitada; nenhuma tabela legada será alterada.');
  } else {
    console.log('Dry-run padrão: nenhuma escrita será realizada. Defina BACKFILL_WRITE_ENABLED=true somente após aprovação operacional.');
  }

  const tableState = {};
  for (const table of ['session_credits', 'session_credit_movements', 'tenant_cancellation_policies']) {
    tableState[table] = await hasTable(table);
  }
  summary.entitlements.missing = !tableState.session_credits;
  summary.movements.missing = !tableState.session_credit_movements;
  summary.policies.missing = !tableState.tenant_cancellation_policies;

  if (tableState.session_credits) {
    const rows = await legacy.query('SELECT * FROM "session_credits"', { type: QueryTypes.SELECT });
    for (const row of rows) {
      summary.entitlements.candidates += 1;
      const scope = scopeOf(row);
      const patientId = uuid(pick(row, 'patientId', 'patient_id'));
      if (!scope.tenantId || !patientId || !row.id) { summary.entitlements.skipped += 1; continue; }
      if (!writeEnabled) continue;
      const [, created] = await Entitlement.findOrCreate({
        where: { sourceSystem: 'legacy-api', sourceId: String(row.id) },
        defaults: {
          sourceSystem: 'legacy-api', sourceId: String(row.id), ...scope, patientId,
          productId: uuid(pick(row, 'saleItemId', 'sale_item_id')),
          totalCredits: Number(pick(row, 'totalCredits', 'total_credits') || 0),
          availableCredits: Number(pick(row, 'availableCredits', 'available_credits') || 0),
          reservedCredits: Number(pick(row, 'reservedCredits', 'reserved_credits') || 0),
          consumedCredits: Number(pick(row, 'consumedCredits', 'consumed_credits') || 0),
          status: pick(row, 'status') || 'ACTIVE',
          expiresAt: pick(row, 'expiresAt', 'expires_at') || null,
          metadata: { migratedFrom: 'session_credits', legacyId: row.id },
        },
      });
      if (created) summary.entitlements.written += 1; else summary.entitlements.skipped += 1;
    }
  }

  if (tableState.session_credit_movements) {
    const rows = await legacy.query('SELECT * FROM "session_credit_movements"', { type: QueryTypes.SELECT });
    for (const row of rows) {
      summary.movements.candidates += 1;
      const legacyCreditId = pick(row, 'sessionCreditId', 'session_credit_id');
      if (!legacyCreditId || !row.id) { summary.movements.skipped += 1; continue; }
      const entitlement = await Entitlement.findOne({ where: { sourceSystem: 'legacy-api', sourceId: String(legacyCreditId) } });
      if (!entitlement) { summary.movements.skipped += 1; continue; }
      if (!writeEnabled) continue;
      const [, created] = await EntitlementMovement.findOrCreate({
        where: { idempotencyKey: `legacy-movement:${row.id}` },
        defaults: {
          entitlementId: entitlement.id,
          appointmentId: uuid(pick(row, 'appointmentId', 'appointment_id')),
          type: pick(row, 'type') || 'MIGRATED_OPENING_BALANCE',
          availableDelta: Number(pick(row, 'availableDelta', 'available_delta') || 0),
          reservedDelta: Number(pick(row, 'reservedDelta', 'reserved_delta') || 0),
          consumedDelta: Number(pick(row, 'consumedDelta', 'consumed_delta') || 0),
          idempotencyKey: `legacy-movement:${row.id}`,
          reason: pick(row, 'reason') || 'Movimento migrado do ledger legado.',
          performedByUserId: uuid(pick(row, 'performedByUserId', 'performed_by_user_id')),
          occurredAt: pick(row, 'occurredAt', 'occurred_at', 'createdAt', 'created_at') || new Date(),
        },
      });
      if (created) summary.movements.written += 1; else summary.movements.skipped += 1;
    }
  }

  if (tableState.tenant_cancellation_policies) {
    const rows = await legacy.query('SELECT * FROM "tenant_cancellation_policies"', { type: QueryTypes.SELECT });
    for (const row of rows) {
      summary.policies.candidates += 1;
      const scope = scopeOf(row);
      if (!scope.tenantId) { summary.policies.skipped += 1; continue; }
      if (!writeEnabled) continue;
      const scopeKey = `${scope.tenantId}:${scope.organizationId || '*'}`;
      const [, created] = await TenantEntitlementPolicy.findOrCreate({
        where: { scopeKey },
        defaults: {
          ...scope, scopeKey,
          cancellationWindowHours: Number(pick(row, 'cancellationWindowHours', 'cancellation_window_hours') || 24),
          lateCancellationConsumesCredit: pick(row, 'lateCancellationConsumesCredit', 'late_cancellation_consumes_credit') !== false,
          noShowConsumesCredit: pick(row, 'noShowConsumesCredit', 'no_show_consumes_credit') !== false,
          isActive: pick(row, 'isActive', 'is_active') !== false,
        },
      });
      if (created) summary.policies.written += 1; else summary.policies.skipped += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await legacy.close();
  if (writeEnabled) await sequelize.close();
};

main().catch(async (error) => {
  console.error(error);
  await legacy.close().catch(() => {});
  await sequelize.close().catch(() => {});
  process.exit(1);
});
