const service = require('../services/featureGrantService');
const {
  grantSchema,
  featureQuerySchema,
  quotaMutationSchema,
  grantStatusSchema,
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

const headerIdempotency = (req) => parse(idempotencyKey, req.get('Idempotency-Key') || '');

const grant = async (req, res, next) => {
  try {
    const payload = parse(grantSchema, req.body);
    const result = await service.grantFeature(payload, contextForRequest(req));
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      data: {
        grant: service.serializeGrant(result.grant),
        movement: result.movement ? service.serializeMovement(result.movement) : null,
        idempotent: Boolean(result.idempotent),
      },
    });
  } catch (error) { return next(error); }
};

const check = async (req, res, next) => {
  try {
    const payload = parse(featureQuerySchema, {
      ...req.query,
      tenantId: req.query.tenantId || undefined,
      organizationId: req.query.organizationId || req.get('X-Organization-Id') || undefined,
    });
    const data = await service.checkFeature(payload, contextForRequest(req));
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const consume = async (req, res, next) => {
  try {
    const payload = parse(quotaMutationSchema, req.body);
    const data = await service.consumeQuota({
      ...payload,
      idempotencyKey: headerIdempotency(req),
    }, contextForRequest(req));
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const release = async (req, res, next) => {
  try {
    const payload = parse(quotaMutationSchema, req.body);
    const data = await service.releaseQuota({
      ...payload,
      idempotencyKey: headerIdempotency(req),
    }, contextForRequest(req));
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};

const updateStatus = async (req, res, next) => {
  try {
    const payload = parse(grantStatusSchema, req.body);
    const id = parse(uuid, req.params.id);
    const data = await service.updateGrantStatus(id, {
      ...payload,
      idempotencyKey: headerIdempotency(req),
    }, contextForRequest(req));
    return res.json({
      success: true,
      data: {
        grant: service.serializeGrant(data.grant),
        movement: service.serializeMovement(data.movement),
        idempotent: Boolean(data.idempotent),
      },
    });
  } catch (error) { return next(error); }
};

module.exports = { grant, check, consume, release, updateStatus };
