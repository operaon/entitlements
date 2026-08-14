const { Op } = require('sequelize');
const {
  sequelize,
  Entitlement,
  EntitlementMovement,
  TenantEntitlementPolicy,
} = require('../models');
const {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} = require('../utils/errors');

const CREDIT_UNIT = 'SESSION';

const DEFAULT_POLICY = Object.freeze({
  cancellationWindowHours: 24,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  isActive: true,
});

const CONSUME_TYPES = new Set(['COMPLETE_CONSUME', 'LATE_CANCEL_CONSUME', 'NO_SHOW_CONSUME']);

const asInteger = (value, field) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${field} deve ser um inteiro maior ou igual a zero.`, 'INVALID_INTEGER');
  }
  return parsed;
};

const requireTenant = (context, tenantId) => {
  if (!context?.tenantId && !context?.isService) {
    throw new AuthorizationError('Tenant não informado no contexto autorizado.', 'TENANT_CONTEXT_MISSING');
  }
  if (tenantId && context?.tenantId && tenantId !== context.tenantId && !context.isService) {
    throw new AuthorizationError('Tenant fora do escopo autorizado.', 'TENANT_SCOPE_DENIED');
  }
  return tenantId || context?.tenantId || null;
};

const requireScope = (context, { tenantId, organizationId } = {}) => {
  const resolvedTenantId = requireTenant(context, tenantId);
  if (!resolvedTenantId) {
    throw new ValidationError('tenantId é obrigatório para esta operação.', 'TENANT_REQUIRED');
  }
  if (organizationId && !context?.isService) {
    const organizations = Array.isArray(context.organizationIds) ? context.organizationIds : [];
    if (!organizations.includes(organizationId)) {
      throw new AuthorizationError('Organização fora do escopo autorizado.', 'ORGANIZATION_SCOPE_DENIED');
    }
  }
  return { tenantId: resolvedTenantId, organizationId: organizationId || null };
};

const scopeWhere = ({ tenantId, organizationId }) => ({
  tenantId,
  ...(organizationId ? { organizationId } : {}),
});

const applyStatus = ({ availableCredits, reservedCredits, status }) => {
  if (status === 'CANCELLED') return 'CANCELLED';
  return Number(availableCredits) === 0 && Number(reservedCredits) === 0 ? 'EXHAUSTED' : 'ACTIVE';
};

const assertBalance = (entitlement) => {
  const total = Number(entitlement.totalCredits);
  const available = Number(entitlement.availableCredits);
  const reserved = Number(entitlement.reservedCredits);
  const consumed = Number(entitlement.consumedCredits);
  const voided = Number(entitlement.voidedCredits || 0);
  if ([total, available, reserved, consumed, voided].some((value) => !Number.isInteger(value) || value < 0)
    || total !== available + reserved + consumed + voided) {
    throw new ConflictError('Inconsistência detectada no saldo do entitlement.', 'ENTITLEMENT_BALANCE_INCONSISTENT');
  }
};

const serializeMovement = (movement) => {
  const json = movement.toJSON ? movement.toJSON() : movement;
  return {
    id: json.id,
    entitlementId: json.entitlementId,
    appointmentId: json.appointmentId || null,
    type: json.type,
    availableDelta: Number(json.availableDelta),
    reservedDelta: Number(json.reservedDelta),
    consumedDelta: Number(json.consumedDelta),
    voidedDelta: Number(json.voidedDelta || 0),
    idempotencyKey: json.idempotencyKey,
    eventId: json.eventId || null,
    correlationId: json.correlationId || null,
    sourceSystem: json.sourceSystem || null,
    sourceId: json.sourceId || null,
    reason: json.reason || null,
    performedByUserId: json.performedByUserId || null,
    occurredAt: json.occurredAt,
  };
};

const serializeEntitlement = (entitlement, { includeMovements = false } = {}) => {
  const json = entitlement.toJSON ? entitlement.toJSON() : entitlement;
  const result = {
    id: json.id,
    sourceSystem: json.sourceSystem,
    sourceId: json.sourceId,
    tenantId: json.tenantId,
    organizationId: json.organizationId || null,
    patientId: json.patientId,
    productId: json.productId || null,
    creditUnit: json.creditUnit || CREDIT_UNIT,
    status: json.status,
    totalCredits: Number(json.totalCredits),
    availableCredits: Number(json.availableCredits),
    reservedCredits: Number(json.reservedCredits),
    consumedCredits: Number(json.consumedCredits),
    voidedCredits: Number(json.voidedCredits || 0),
    expiresAt: json.expiresAt || null,
    metadata: json.metadata || {},
    issuedAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
  if (includeMovements) result.movements = (json.movements || []).map(serializeMovement);
  return result;
};

const assertNotExpired = (entitlement) => {
  if (entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() <= Date.now()) {
    throw new ConflictError('Entitlement expirado.', 'ENTITLEMENT_EXPIRED');
  }
};

const getExistingMovement = async (idempotencyKey, transaction) => EntitlementMovement.findOne({
  where: { idempotencyKey },
  transaction,
  lock: transaction.LOCK.UPDATE,
});

const resolveIdempotentResult = async (idempotencyKey, entitlementId, transaction) => {
  const movement = await getExistingMovement(idempotencyKey, transaction);
  if (!movement) return null;
  if (movement.entitlementId !== entitlementId) {
    throw new ConflictError('Idempotency-Key já foi usado por outro entitlement.', 'IDEMPOTENCY_KEY_REUSED');
  }
  const entitlement = await Entitlement.findByPk(entitlementId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!entitlement) throw new NotFoundError('Entitlement não encontrado.', 'ENTITLEMENT_NOT_FOUND');
  return { entitlement, movement, idempotent: true };
};

const createMovement = async ({ entitlement, transaction, event, ...payload }) => EntitlementMovement.create({
  entitlementId: entitlement.id,
  ...payload,
  eventId: event?.eventId || null,
  correlationId: event?.correlationId || null,
  sourceSystem: event?.sourceSystem || null,
  sourceId: event?.sourceId || null,
  occurredAt: payload.occurredAt || new Date(),
}, { transaction });

const issueEntitlement = async (payload, context) => {
  const scope = requireScope(context, payload);
  const totalCredits = asInteger(payload.totalCredits, 'totalCredits');
  const creditUnit = payload.creditUnit || CREDIT_UNIT;
  if (creditUnit !== CREDIT_UNIT) {
    throw new ValidationError(`Unidade de crédito não suportada: ${creditUnit}.`, 'CREDIT_UNIT_UNSUPPORTED');
  }
  if (totalCredits <= 0) throw new ValidationError('totalCredits deve ser maior que zero.', 'INVALID_CREDIT_AMOUNT');
  if (!payload.sourceSystem || !payload.sourceId || !payload.patientId) {
    throw new ValidationError('sourceSystem, sourceId e patientId são obrigatórios.', 'ISSUE_FIELDS_REQUIRED');
  }

  return sequelize.transaction(async (transaction) => {
    const existing = await Entitlement.findOne({
      where: { sourceSystem: payload.sourceSystem, sourceId: payload.sourceId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existing) {
      if (existing.tenantId !== scope.tenantId || existing.patientId !== payload.patientId
        || Number(existing.totalCredits) !== totalCredits
        || (existing.creditUnit || CREDIT_UNIT) !== creditUnit) {
        throw new ConflictError('A origem já está associada a um entitlement incompatível.', 'ISSUE_SOURCE_CONFLICT');
      }
      return { entitlement: existing, idempotent: true };
    }

    const entitlement = await Entitlement.create({
      sourceSystem: payload.sourceSystem,
      sourceId: payload.sourceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      patientId: payload.patientId,
      productId: payload.productId || null,
      creditUnit,
      totalCredits,
      availableCredits: totalCredits,
      reservedCredits: 0,
      consumedCredits: 0,
      voidedCredits: 0,
      status: 'ACTIVE',
      expiresAt: payload.expiresAt || null,
      metadata: payload.metadata || {},
    }, { transaction });
    await createMovement({
      entitlement,
      transaction,
      type: 'ISSUE',
      availableDelta: totalCredits,
      reservedDelta: 0,
      consumedDelta: 0,
      voidedDelta: 0,
      idempotencyKey: `issue:${payload.sourceSystem}:${payload.sourceId}`,
      reason: payload.reason || 'Entitlement emitido pela origem autorizada.',
      performedByUserId: context?.userId || null,
      event: payload.event,
    });
    return { entitlement, idempotent: false };
  });
};

const findScopedEntitlement = async (id, context, transaction, { lock = false } = {}) => {
  const scope = requireScope(context, {
    tenantId: context?.tenantId,
    organizationId: context?.organizationId,
  });
  const options = {
    where: { id, ...scopeWhere(scope) },
    transaction,
  };
  if (lock) options.lock = transaction.LOCK.UPDATE;
  const entitlement = await Entitlement.findOne(options);
  if (!entitlement) throw new NotFoundError('Entitlement não encontrado.', 'ENTITLEMENT_NOT_FOUND');
  return entitlement;
};

const assertReservationIsOpen = async (entitlement, appointmentId, transaction) => {
  if (!appointmentId) throw new ValidationError('appointmentId é obrigatório para esta operação.', 'APPOINTMENT_REQUIRED');
  const lastMovement = await EntitlementMovement.findOne({
    where: { entitlementId: entitlement.id, appointmentId },
    order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!lastMovement || lastMovement.type !== 'RESERVE') {
    throw new ConflictError('Não existe uma reserva de crédito ativa para este agendamento.', 'RESERVATION_NOT_OPEN');
  }
};

const assertNoOpenReservation = async (entitlement, appointmentId, transaction) => {
  if (!appointmentId) throw new ValidationError('appointmentId é obrigatório para reservar.', 'APPOINTMENT_REQUIRED');
  const lastMovement = await EntitlementMovement.findOne({
    where: { entitlementId: entitlement.id, appointmentId },
    order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (lastMovement?.type === 'RESERVE') {
    throw new ConflictError('Este agendamento já possui uma reserva ativa.', 'RESERVATION_ALREADY_OPEN');
  }
};

const mutateEntitlement = async ({ id, context, idempotencyKey, operation }) => {
  if (!idempotencyKey) throw new ValidationError('Idempotency-Key é obrigatório.', 'IDEMPOTENCY_KEY_REQUIRED');
  return sequelize.transaction(async (transaction) => {
    const entitlement = await findScopedEntitlement(id, context, transaction, { lock: true });
    const existing = await resolveIdempotentResult(idempotencyKey, entitlement.id, transaction);
    if (existing) return existing;
    assertBalance(entitlement);
    const result = await operation({ entitlement, transaction });
    assertBalance(result.entitlement || entitlement);
    return result;
  });
};

const reserveEntitlement = ({ id, context, idempotencyKey, appointmentId, event, reason }) => mutateEntitlement({
  id,
  context,
  idempotencyKey,
  operation: async ({ entitlement, transaction }) => {
    assertNotExpired(entitlement);
    await assertNoOpenReservation(entitlement, appointmentId, transaction);
    if (Number(entitlement.availableCredits) <= 0) {
      throw new ConflictError('Não há créditos disponíveis para reservar.', 'CREDITS_UNAVAILABLE');
    }
    const next = {
      availableCredits: Number(entitlement.availableCredits) - 1,
      reservedCredits: Number(entitlement.reservedCredits) + 1,
      consumedCredits: Number(entitlement.consumedCredits),
    };
    await entitlement.update({ ...next, status: applyStatus({ ...next, status: entitlement.status }) }, { transaction });
    const movement = await createMovement({
      entitlement,
      transaction,
      appointmentId,
      type: 'RESERVE',
      availableDelta: -1,
      reservedDelta: 1,
      consumedDelta: 0,
      voidedDelta: 0,
      idempotencyKey,
      reason: reason || 'Crédito reservado para agendamento.',
      performedByUserId: context?.userId || null,
      event,
    });
    return { entitlement, movement, idempotent: false };
  },
});

const releaseEntitlement = ({ id, context, idempotencyKey, appointmentId, event, reason }) => mutateEntitlement({
  id,
  context,
  idempotencyKey,
  operation: async ({ entitlement, transaction }) => {
    await assertReservationIsOpen(entitlement, appointmentId, transaction);
    if (Number(entitlement.reservedCredits) <= 0) {
      throw new ConflictError('Não há crédito reservado para devolver.', 'RESERVED_CREDITS_UNAVAILABLE');
    }
    const next = {
      availableCredits: Number(entitlement.availableCredits) + 1,
      reservedCredits: Number(entitlement.reservedCredits) - 1,
      consumedCredits: Number(entitlement.consumedCredits),
    };
    await entitlement.update({ ...next, status: applyStatus({ ...next, status: entitlement.status }) }, { transaction });
    const movement = await createMovement({
      entitlement,
      transaction,
      appointmentId,
      type: 'RELEASE',
      availableDelta: 1,
      reservedDelta: -1,
      consumedDelta: 0,
      voidedDelta: 0,
      idempotencyKey,
      reason: reason || 'Reserva de crédito liberada.',
      performedByUserId: context?.userId || null,
      event,
    });
    return { entitlement, movement, idempotent: false };
  },
});

const consumeEntitlement = ({ id, context, idempotencyKey, appointmentId, event, type, reason }) => mutateEntitlement({
  id,
  context,
  idempotencyKey,
  operation: async ({ entitlement, transaction }) => {
    if (!CONSUME_TYPES.has(type)) throw new ValidationError('Tipo de consumo inválido.', 'CONSUMPTION_TYPE_INVALID');
    await assertReservationIsOpen(entitlement, appointmentId, transaction);
    if (Number(entitlement.reservedCredits) <= 0) {
      throw new ConflictError('Não há crédito reservado para consumir.', 'RESERVED_CREDITS_UNAVAILABLE');
    }
    const next = {
      availableCredits: Number(entitlement.availableCredits),
      reservedCredits: Number(entitlement.reservedCredits) - 1,
      consumedCredits: Number(entitlement.consumedCredits) + 1,
    };
    await entitlement.update({ ...next, status: applyStatus({ ...next, status: entitlement.status }) }, { transaction });
    const movement = await createMovement({
      entitlement,
      transaction,
      appointmentId,
      type,
      availableDelta: 0,
      reservedDelta: -1,
      consumedDelta: 1,
      voidedDelta: 0,
      idempotencyKey,
      reason: reason || 'Crédito consumido pela conclusão do fluxo de sessão.',
      performedByUserId: context?.userId || null,
      event,
    });
    return { entitlement, movement, idempotent: false };
  },
});

const refundEntitlement = ({ id, context, idempotencyKey, appointmentId, event, reason }) => mutateEntitlement({
  id,
  context,
  idempotencyKey,
  operation: async ({ entitlement, transaction }) => {
    if (Number(entitlement.consumedCredits) <= 0) {
      throw new ConflictError('Não há crédito consumido para reembolsar.', 'CONSUMED_CREDITS_UNAVAILABLE');
    }
    const next = {
      availableCredits: Number(entitlement.availableCredits) + 1,
      reservedCredits: Number(entitlement.reservedCredits),
      consumedCredits: Number(entitlement.consumedCredits) - 1,
    };
    await entitlement.update({ ...next, status: applyStatus({ ...next, status: entitlement.status === 'CANCELLED' ? 'ACTIVE' : entitlement.status }) }, { transaction });
    const movement = await createMovement({
      entitlement,
      transaction,
      appointmentId: appointmentId || null,
      type: 'ADMIN_REFUND',
      availableDelta: 1,
      reservedDelta: 0,
      consumedDelta: -1,
      voidedDelta: 0,
      idempotencyKey,
      reason: reason || 'Reembolso administrativo de crédito.',
      performedByUserId: context?.userId || null,
      event,
    });
    return { entitlement, movement, idempotent: false };
  },
});

const voidEntitlement = ({ id, context, idempotencyKey, event, reason }) => mutateEntitlement({
  id,
  context,
  idempotencyKey,
  operation: async ({ entitlement, transaction }) => {
    const available = Number(entitlement.availableCredits);
    const reserved = Number(entitlement.reservedCredits);
    await entitlement.update({
      availableCredits: 0,
      reservedCredits: 0,
      consumedCredits: Number(entitlement.consumedCredits),
      voidedCredits: Number(entitlement.voidedCredits || 0) + available + reserved,
      status: 'CANCELLED',
    }, { transaction });
    const movement = await createMovement({
      entitlement,
      transaction,
      type: 'VOID',
      availableDelta: -available,
      reservedDelta: -reserved,
      consumedDelta: 0,
      voidedDelta: available + reserved,
      idempotencyKey,
      reason: reason || 'Entitlement anulado administrativamente.',
      performedByUserId: context?.userId || null,
      event,
    });
    return { entitlement, movement, idempotent: false };
  },
});

const getEntitlement = async (id, context) => {
  const entitlement = await findScopedEntitlement(id, context);
  return serializeEntitlement(entitlement);
};

const getEntitlementMovements = async (id, context, { limit = 100, offset = 0 } = {}) => {
  const entitlement = await findScopedEntitlement(id, context);
  const movements = await EntitlementMovement.findAll({
    where: { entitlementId: entitlement.id },
    order: [['occurredAt', 'DESC'], ['createdAt', 'DESC']],
    limit,
    offset,
  });
  return { entitlement: serializeEntitlement(entitlement), movements: movements.map(serializeMovement), limit, offset };
};

const getPatientStatement = async ({ patientId, tenantId, organizationId }, context, { limit = 100, offset = 0 } = {}) => {
  const scope = requireScope(context, { tenantId: tenantId || context?.tenantId, organizationId: organizationId || null });
  const where = { patientId, ...scopeWhere(scope) };
  const entitlements = await Entitlement.findAll({
    where,
    include: [{ model: EntitlementMovement, as: 'movements' }],
    order: [['createdAt', 'DESC'], [{ model: EntitlementMovement, as: 'movements' }, 'occurredAt', 'DESC']],
    limit,
    offset,
  });
  const credits = entitlements.map((entitlement) => serializeEntitlement(entitlement, { includeMovements: true }));
  const summary = credits.reduce((accumulator, credit) => ({
    totalCredits: accumulator.totalCredits + credit.totalCredits,
    availableCredits: accumulator.availableCredits + credit.availableCredits,
    reservedCredits: accumulator.reservedCredits + credit.reservedCredits,
    consumedCredits: accumulator.consumedCredits + credit.consumedCredits,
  }), { totalCredits: 0, availableCredits: 0, reservedCredits: 0, consumedCredits: 0 });
  return { patientId, tenantId: scope.tenantId, organizationId: scope.organizationId, summary, credits, limit, offset };
};

const policyScopeKey = ({ tenantId, organizationId }) => `${tenantId}:${organizationId || '*'}`;

const getPolicy = async ({ tenantId, organizationId }, context) => {
  const scope = requireScope(context, { tenantId: tenantId || context?.tenantId, organizationId });
  const keys = organizationId
    ? [policyScopeKey(scope), policyScopeKey({ tenantId: scope.tenantId, organizationId: null })]
    : [policyScopeKey(scope)];
  const policy = await TenantEntitlementPolicy.findOne({
    where: { scopeKey: { [Op.in]: keys }, isActive: true },
    order: [['organizationId', 'DESC']],
  });
  return policy ? policy.toJSON() : { tenantId: scope.tenantId, organizationId: scope.organizationId, scopeKey: policyScopeKey(scope), ...DEFAULT_POLICY };
};

const upsertPolicy = async (payload, context) => {
  const scope = requireScope(context, payload);
  const values = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeKey: policyScopeKey(scope),
    cancellationWindowHours: asInteger(payload.cancellationWindowHours ?? DEFAULT_POLICY.cancellationWindowHours, 'cancellationWindowHours'),
    lateCancellationConsumesCredit: payload.lateCancellationConsumesCredit ?? DEFAULT_POLICY.lateCancellationConsumesCredit,
    noShowConsumesCredit: payload.noShowConsumesCredit ?? DEFAULT_POLICY.noShowConsumesCredit,
    isActive: payload.isActive ?? true,
  };
  const [policy] = await TenantEntitlementPolicy.findOrCreate({
    where: { scopeKey: values.scopeKey },
    defaults: values,
  });
  if (policy.scopeKey === values.scopeKey) await policy.update(values);
  return policy.toJSON();
};

module.exports = {
  CREDIT_UNIT,
  DEFAULT_POLICY,
  requireScope,
  issueEntitlement,
  reserveEntitlement,
  releaseEntitlement,
  consumeEntitlement,
  refundEntitlement,
  voidEntitlement,
  getEntitlement,
  getEntitlementMovements,
  getPatientStatement,
  getPolicy,
  upsertPolicy,
  serializeEntitlement,
  serializeMovement,
};
