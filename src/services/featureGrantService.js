const { Op } = require('sequelize');
const {
  sequelize,
  FeatureGrant,
  FeatureGrantMovement,
} = require('../models');
const {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} = require('../utils/errors');

const ACTIVE_STATUSES = ['ACTIVE'];
const RELEASABLE_STATUSES = ['ACTIVE', 'SUSPENDED'];

const asInteger = (value, field, { min = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ValidationError(`${field} deve ser um inteiro maior ou igual a ${min}.`, 'INVALID_INTEGER');
  }
  return parsed;
};

const requireScope = (context, payload = {}) => {
  const tenantId = payload.tenantId || context?.tenantId;
  if (!tenantId) throw new ValidationError('tenantId é obrigatório para esta operação.', 'TENANT_REQUIRED');
  if (context?.tenantId && tenantId !== context.tenantId && !context.isService) {
    throw new AuthorizationError('Tenant fora do escopo autorizado.', 'TENANT_SCOPE_DENIED');
  }
  const organizationId = payload.organizationId || context?.organizationId || null;
  if (organizationId && !context?.isService) {
    const organizationIds = Array.isArray(context.organizationIds) ? context.organizationIds : [];
    if (!organizationIds.includes(organizationId)) {
      throw new AuthorizationError('Organização fora do escopo autorizado.', 'ORGANIZATION_SCOPE_DENIED');
    }
  }
  return { tenantId, organizationId };
};

const normalizeFeatureKey = (value) => {
  const key = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9:._-]{0,159}$/.test(key)) {
    throw new ValidationError('featureKey possui formato inválido.', 'FEATURE_KEY_INVALID');
  }
  return key;
};

const normalizeDates = ({ startsAt, expiresAt }) => {
  const start = startsAt ? new Date(startsAt) : new Date();
  const end = expiresAt ? new Date(expiresAt) : null;
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) {
    throw new ValidationError('Janela de vigência inválida.', 'EFFECTIVE_WINDOW_INVALID');
  }
  if (end && end <= start) {
    throw new ValidationError('expiresAt deve ser posterior a startsAt.', 'EFFECTIVE_WINDOW_INVALID');
  }
  return { startsAt: start, expiresAt: end };
};

const effectiveWhere = ({ tenantId, organizationId, featureKey, statuses = ACTIVE_STATUSES, now = new Date() }) => ({
  tenantId,
  featureKey,
  status: { [Op.in]: statuses },
  [Op.and]: [
    { startsAt: { [Op.lte]: now } },
    { [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }] },
    ...(organizationId ? [{ [Op.or]: [{ organizationId: null }, { organizationId }] }] : [{ organizationId: null }]),
  ],
});

const serializeGrant = (grant) => {
  const data = grant.toJSON ? grant.toJSON() : grant;
  const limitValue = data.limitValue === null || data.limitValue === undefined ? null : Number(data.limitValue);
  const consumedValue = Number(data.consumedValue || 0);
  return {
    id: data.id,
    tenantId: data.tenantId,
    organizationId: data.organizationId || null,
    featureKey: data.featureKey,
    kind: data.kind,
    unit: data.unit,
    limitValue,
    consumedValue,
    remainingValue: limitValue === null ? null : Math.max(limitValue - consumedValue, 0),
    status: data.status,
    sourceSystem: data.sourceSystem,
    sourceId: data.sourceId,
    startsAt: data.startsAt,
    expiresAt: data.expiresAt || null,
    metadata: data.metadata || {},
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const serializeMovement = (movement) => {
  const data = movement.toJSON ? movement.toJSON() : movement;
  return {
    id: data.id,
    grantId: data.grantId,
    tenantId: data.tenantId,
    featureKey: data.featureKey,
    type: data.type,
    quantityDelta: Number(data.quantityDelta),
    idempotencyKey: data.idempotencyKey,
    eventId: data.eventId || null,
    correlationId: data.correlationId || null,
    sourceSystem: data.sourceSystem || null,
    sourceId: data.sourceId || null,
    reason: data.reason || null,
    occurredAt: data.occurredAt,
  };
};

const assertGrantPayload = (payload) => {
  const featureKey = normalizeFeatureKey(payload.featureKey);
  const kind = payload.kind || (payload.limitValue === undefined ? 'BOOLEAN' : 'QUOTA');
  if (!['BOOLEAN', 'QUOTA'].includes(kind)) {
    throw new ValidationError('kind deve ser BOOLEAN ou QUOTA.', 'GRANT_KIND_INVALID');
  }
  if (!payload.sourceSystem || !payload.sourceId) {
    throw new ValidationError('sourceSystem e sourceId são obrigatórios.', 'GRANT_SOURCE_REQUIRED');
  }
  if (kind === 'BOOLEAN' && payload.limitValue !== undefined && payload.limitValue !== null) {
    throw new ValidationError('Grants BOOLEAN não aceitam limitValue.', 'BOOLEAN_LIMIT_NOT_ALLOWED');
  }
  if (kind === 'QUOTA') {
    asInteger(payload.limitValue, 'limitValue', { min: 1 });
  }
  const unit = String(payload.unit || (kind === 'BOOLEAN' ? 'BOOLEAN' : 'UNIT')).trim();
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,63}$/.test(unit)) {
    throw new ValidationError('unit possui formato inválido.', 'GRANT_UNIT_INVALID');
  }
  const dates = normalizeDates(payload);
  return { featureKey, kind, unit, dates };
};

const findIdempotentMovement = async (tenantId, idempotencyKey, transaction) => {
  const movement = await FeatureGrantMovement.findOne({
    where: {
      tenantId,
      [Op.or]: [
        { idempotencyKey },
        { idempotencyKey: { [Op.like]: `${idempotencyKey}:grant:%` } },
      ],
    },
    order: [['createdAt', 'ASC']],
    transaction,
  });
  if (!movement) return null;
  const movements = await FeatureGrantMovement.findAll({
    where: {
      tenantId,
      [Op.or]: [
        { idempotencyKey },
        { idempotencyKey: { [Op.like]: `${idempotencyKey}:grant:%` } },
      ],
    },
    order: [['createdAt', 'ASC']],
    transaction,
  });
  return { movement, movements, idempotent: true };
};

const createMovement = async ({ grant, transaction, type, quantityDelta, idempotencyKey, payload, context }) => FeatureGrantMovement.create({
  grantId: grant.id,
  tenantId: grant.tenantId,
  featureKey: grant.featureKey,
  type,
  quantityDelta,
  idempotencyKey,
  eventId: payload.event?.eventId || null,
  correlationId: payload.event?.correlationId || null,
  sourceSystem: payload.sourceSystem || payload.event?.sourceSystem || null,
  sourceId: payload.sourceId || payload.event?.sourceId || null,
  reason: payload.reason || null,
  performedByUserId: context?.userId || null,
  occurredAt: payload.occurredAt || new Date(),
}, { transaction });

const grantFeature = async (payload, context = {}) => {
  const scope = requireScope(context, payload);
  const normalized = assertGrantPayload(payload);

  return sequelize.transaction(async (transaction) => {
    const existing = await FeatureGrant.findOne({
      where: {
        tenantId: scope.tenantId,
        sourceSystem: payload.sourceSystem,
        sourceId: payload.sourceId,
        featureKey: normalized.featureKey,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existing) {
      const same = existing.tenantId === scope.tenantId
        && (existing.organizationId || null) === scope.organizationId
        && existing.kind === normalized.kind
        && existing.unit === normalized.unit
        && Number(existing.limitValue || 0) === Number(payload.limitValue || 0);
      if (!same) throw new ConflictError('A origem já está associada a um grant incompatível.', 'GRANT_SOURCE_CONFLICT');
      return { grant: existing, movement: null, idempotent: true };
    }

    const grant = await FeatureGrant.create({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      featureKey: normalized.featureKey,
      kind: normalized.kind,
      unit: normalized.unit,
      limitValue: normalized.kind === 'QUOTA' ? Number(payload.limitValue) : null,
      consumedValue: 0,
      status: 'ACTIVE',
      sourceSystem: payload.sourceSystem,
      sourceId: payload.sourceId,
      startsAt: normalized.dates.startsAt,
      expiresAt: normalized.dates.expiresAt,
      metadata: payload.metadata || {},
    }, { transaction });

    const movement = await createMovement({
      grant,
      transaction,
      type: 'ISSUE',
      quantityDelta: 0,
      idempotencyKey: `grant:${payload.sourceSystem}:${payload.sourceId}:${normalized.featureKey}`,
      payload: { ...payload, reason: payload.reason || 'Feature ou quota concedido.' },
      context,
    });
    return { grant, movement, idempotent: false };
  });
};

const findEffectiveGrants = async ({ tenantId, organizationId, featureKey, transaction, lock = false, statuses = ACTIVE_STATUSES }) => {
  const options = {
    where: effectiveWhere({ tenantId, organizationId, featureKey, statuses }),
    order: [['organizationId', 'DESC'], ['expiresAt', 'ASC'], ['createdAt', 'ASC']],
    transaction,
  };
  if (lock) options.lock = transaction.LOCK.UPDATE;
  return FeatureGrant.findAll(options);
};

const checkFeature = async (payload, context = {}) => {
  const scope = requireScope(context, payload);
  const featureKey = normalizeFeatureKey(payload.featureKey);
  const grants = await findEffectiveGrants({ ...scope, featureKey });
  const booleanGrants = grants.filter((grant) => grant.kind === 'BOOLEAN');
  const quotaGrants = grants.filter((grant) => grant.kind === 'QUOTA');
  if (booleanGrants.length > 0) {
    return {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      featureKey,
      enabled: true,
      kind: 'BOOLEAN',
      grants: booleanGrants.map(serializeGrant),
    };
  }
  const limitValue = quotaGrants.reduce((sum, grant) => sum + Number(grant.limitValue || 0), 0);
  const consumedValue = quotaGrants.reduce((sum, grant) => sum + Number(grant.consumedValue || 0), 0);
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    featureKey,
    enabled: quotaGrants.length > 0 && limitValue > consumedValue,
    kind: quotaGrants.length > 0 ? 'QUOTA' : null,
    unit: quotaGrants[0]?.unit || null,
    limitValue,
    consumedValue,
    remainingValue: Math.max(limitValue - consumedValue, 0),
    grants: quotaGrants.map(serializeGrant),
  };
};

const consumeQuota = async (payload, context = {}) => {
  const scope = requireScope(context, payload);
  const featureKey = normalizeFeatureKey(payload.featureKey);
  const quantity = asInteger(payload.quantity, 'quantity', { min: 1 });
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!idempotencyKey) throw new ValidationError('idempotencyKey é obrigatório.', 'IDEMPOTENCY_KEY_REQUIRED');

  return sequelize.transaction(async (transaction) => {
    const existing = await findIdempotentMovement(scope.tenantId, idempotencyKey, transaction);
    if (existing) {
      const grants = await FeatureGrant.findAll({ where: { id: existing.movements.map((item) => item.grantId) }, transaction });
      return {
        featureKey,
        quantity,
        idempotent: true,
        movements: existing.movements.map(serializeMovement),
        grants: grants.map(serializeGrant),
      };
    }

    const grants = (await findEffectiveGrants({ ...scope, featureKey, transaction, lock: true }))
      .filter((grant) => grant.kind === 'QUOTA' && Number(grant.limitValue || 0) > Number(grant.consumedValue || 0));
    const remaining = grants.reduce((sum, grant) => sum + Number(grant.limitValue) - Number(grant.consumedValue), 0);
    if (remaining < quantity) {
      throw new ConflictError('Quota insuficiente para esta operação.', 'QUOTA_EXCEEDED', { featureKey, requested: quantity, remaining });
    }

    let pending = quantity;
    const movements = [];
    for (const grant of grants) {
      if (pending <= 0) break;
      const available = Number(grant.limitValue) - Number(grant.consumedValue);
      const allocated = Math.min(available, pending);
      await grant.update({ consumedValue: Number(grant.consumedValue) + allocated }, { transaction });
      const movement = await createMovement({
        grant,
        transaction,
        type: 'CONSUME',
        quantityDelta: allocated,
        idempotencyKey: movements.length === 0 ? idempotencyKey : `${idempotencyKey}:grant:${grant.id}`,
        payload,
        context,
      });
      movements.push(movement);
      pending -= allocated;
    }

    return {
      featureKey,
      quantity,
      idempotent: false,
      movements: movements.map(serializeMovement),
      grants: grants.map(serializeGrant),
    };
  });
};

const releaseQuota = async (payload, context = {}) => {
  const scope = requireScope(context, payload);
  const featureKey = normalizeFeatureKey(payload.featureKey);
  const quantity = asInteger(payload.quantity, 'quantity', { min: 1 });
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!idempotencyKey) throw new ValidationError('idempotencyKey é obrigatório.', 'IDEMPOTENCY_KEY_REQUIRED');

  return sequelize.transaction(async (transaction) => {
    const existing = await findIdempotentMovement(scope.tenantId, idempotencyKey, transaction);
    if (existing) return { featureKey, quantity, idempotent: true, movements: existing.movements.map(serializeMovement) };

    const grants = (await findEffectiveGrants({ ...scope, featureKey, transaction, lock: true, statuses: RELEASABLE_STATUSES }))
      .filter((grant) => grant.kind === 'QUOTA' && Number(grant.consumedValue || 0) > 0)
      .sort((a, b) => Number(b.consumedValue) - Number(a.consumedValue));
    const consumed = grants.reduce((sum, grant) => sum + Number(grant.consumedValue), 0);
    if (consumed < quantity) {
      throw new ConflictError('Consumo insuficiente para esta liberação.', 'QUOTA_RELEASE_EXCEEDED', { featureKey, requested: quantity, consumed });
    }

    let pending = quantity;
    const movements = [];
    for (const grant of grants) {
      if (pending <= 0) break;
      const released = Math.min(Number(grant.consumedValue), pending);
      await grant.update({ consumedValue: Number(grant.consumedValue) - released }, { transaction });
      const movement = await createMovement({
        grant,
        transaction,
        type: 'RELEASE',
        quantityDelta: -released,
        idempotencyKey: movements.length === 0 ? idempotencyKey : `${idempotencyKey}:grant:${grant.id}`,
        payload,
        context,
      });
      movements.push(movement);
      pending -= released;
    }
    return { featureKey, quantity, idempotent: false, movements: movements.map(serializeMovement) };
  });
};

const updateGrantStatus = async (id, payload, context = {}) => {
  const scope = requireScope(context, payload);
  const status = payload.status;
  if (!['ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED'].includes(status)) {
    throw new ValidationError('status de grant inválido.', 'GRANT_STATUS_INVALID');
  }
  return sequelize.transaction(async (transaction) => {
    const grant = await FeatureGrant.findOne({ where: { id, tenantId: scope.tenantId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!grant) throw new NotFoundError('Grant não encontrado.', 'GRANT_NOT_FOUND');
    if (scope.organizationId && grant.organizationId && grant.organizationId !== scope.organizationId && !context.isService) {
      throw new AuthorizationError('Grant fora do escopo autorizado.', 'ORGANIZATION_SCOPE_DENIED');
    }
    await grant.update({ status }, { transaction });
    const movement = await createMovement({
      grant,
      transaction,
      type: status === 'REVOKED' ? 'REVOKE' : 'ADJUST',
      quantityDelta: 0,
      idempotencyKey: payload.idempotencyKey || `status:${grant.id}:${status}:${Date.now()}`,
      payload: { ...payload, reason: payload.reason || `Grant alterado para ${status}.` },
      context,
    });
    return { grant, movement, idempotent: false };
  });
};

module.exports = {
  grantFeature,
  checkFeature,
  consumeQuota,
  releaseQuota,
  updateGrantStatus,
  serializeGrant,
  serializeMovement,
};
