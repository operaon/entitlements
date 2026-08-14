const service = require('../services/entitlementService');
const {
  issueSchema,
  mutationSchema,
  consumeSchema,
  statementSchema,
  policySchema,
  uuid,
  idempotencyKey,
} = require('../validators');
const { ValidationError } = require('../utils/errors');

const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError('Dados de entrada inválidos.', 'VALIDATION_ERROR', result.error.flatten());
  }
  return result.data;
};

const contextForRequest = (req) => ({
  ...(req.context || {}),
  organizationId: req.context?.organizationId || req.get('X-Organization-Id') || null,
});

const idempotency = (req) => {
  const value = req.get('Idempotency-Key');
  return parse(idempotencyKey, value || '');
};

const sendMutation = (res, result, statusCode = 200) => res.status(statusCode).json({
  success: true,
  data: {
    entitlement: service.serializeEntitlement(result.entitlement),
    movement: result.movement ? service.serializeMovement(result.movement) : null,
    idempotent: Boolean(result.idempotent),
  },
});

const issue = async (req, res, next) => {
  try {
    const payload = parse(issueSchema, req.body);
    const result = await service.issueEntitlement(payload, contextForRequest(req));
    return sendMutation(res, result, result.idempotent ? 200 : 201);
  } catch (error) { return next(error); }
};

const reserve = async (req, res, next) => {
  try {
    const payload = parse(mutationSchema, req.body);
    const result = await service.reserveEntitlement({
      ...payload,
      id: parse(uuid, req.params.id),
      context: contextForRequest(req),
      idempotencyKey: idempotency(req),
      event: payload.event,
    });
    return sendMutation(res, result);
  } catch (error) { return next(error); }
};

const release = async (req, res, next) => {
  try {
    const payload = parse(mutationSchema, req.body);
    const result = await service.releaseEntitlement({
      ...payload,
      id: parse(uuid, req.params.id),
      context: contextForRequest(req),
      idempotencyKey: idempotency(req),
      event: payload.event,
    });
    return sendMutation(res, result);
  } catch (error) { return next(error); }
};

const consume = async (req, res, next) => {
  try {
    const payload = parse(consumeSchema, req.body);
    const result = await service.consumeEntitlement({
      ...payload,
      id: parse(uuid, req.params.id),
      context: contextForRequest(req),
      idempotencyKey: idempotency(req),
      event: payload.event,
    });
    return sendMutation(res, result);
  } catch (error) { return next(error); }
};

const refund = async (req, res, next) => {
  try {
    const payload = parse(mutationSchema, req.body);
    const result = await service.refundEntitlement({
      ...payload,
      id: parse(uuid, req.params.id),
      context: contextForRequest(req),
      idempotencyKey: idempotency(req),
      event: payload.event,
    });
    return sendMutation(res, result);
  } catch (error) { return next(error); }
};

const voidEntitlement = async (req, res, next) => {
  try {
    const payload = parse(mutationSchema, req.body);
    const result = await service.voidEntitlement({
      ...payload,
      id: parse(uuid, req.params.id),
      context: contextForRequest(req),
      idempotencyKey: idempotency(req),
      event: payload.event,
    });
    return sendMutation(res, result);
  } catch (error) { return next(error); }
};

const get = async (req, res, next) => {
  try {
    const id = parse(uuid, req.params.id);
    const data = await service.getEntitlement(id, contextForRequest(req));
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const movements = async (req, res, next) => {
  try {
    const id = parse(uuid, req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const data = await service.getEntitlementMovements(id, contextForRequest(req), { limit, offset });
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const statement = async (req, res, next) => {
  try {
    const payload = parse(statementSchema, { ...req.query, patientId: req.params.patientId });
    const data = await service.getPatientStatement(payload, contextForRequest(req), payload);
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const getPolicy = async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId || req.context?.tenantId;
    const organizationId = req.query.organizationId || req.get('X-Organization-Id') || null;
    const data = await service.getPolicy({ tenantId, organizationId }, contextForRequest(req));
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const upsertPolicy = async (req, res, next) => {
  try {
    const payload = parse(policySchema, req.body);
    const data = await service.upsertPolicy(payload, contextForRequest(req));
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

module.exports = {
  issue,
  reserve,
  release,
  consume,
  refund,
  voidEntitlement,
  get,
  movements,
  statement,
  getPolicy,
  upsertPolicy,
};
