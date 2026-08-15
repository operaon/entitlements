const { z } = require('zod');

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const sourceId = z.string().trim().min(1).max(160);
const sourceSystem = z.string().trim().min(1).max(80);
const idempotencyKey = z.string().trim().min(1).max(220);
const creditUnit = z.literal('SESSION');
const featureKey = z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{0,159}$/, 'featureKey inválida');
const grantUnit = z.string().trim().regex(/^[A-Z0-9][A-Z0-9_.-]{0,63}$/, 'unit inválida');
const date = z.coerce.date();
const integrationEvent = z.object({
  eventId: idempotencyKey,
  correlationId: idempotencyKey.optional(),
  sourceSystem,
  sourceId: sourceId.optional(),
}).strict();

const issueSchema = z.object({
  tenantId: uuid,
  organizationId: nullableUuid,
  patientId: uuid,
  productId: nullableUuid,
  sourceSystem,
  sourceId,
  totalCredits: z.coerce.number().int().min(1).max(100000),
  creditUnit: creditUnit.default('SESSION'),
  expiresAt: date.nullable().optional(),
  metadata: z.record(z.any()).optional(),
  event: integrationEvent.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const mutationSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: nullableUuid,
  appointmentId: nullableUuid,
  event: integrationEvent.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const consumeSchema = mutationSchema.extend({
  type: z.enum(['COMPLETE_CONSUME', 'LATE_CANCEL_CONSUME', 'NO_SHOW_CONSUME']),
});

const statementSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  patientId: uuid,
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();

const policySchema = z.object({
  tenantId: uuid,
  organizationId: nullableUuid,
  cancellationWindowHours: z.coerce.number().int().min(0).max(8760).default(24),
  lateCancellationConsumesCredit: z.boolean().default(true),
  noShowConsumesCredit: z.boolean().default(true),
  isActive: z.boolean().default(true),
}).strict();

const grantSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: nullableUuid,
  featureKey,
  kind: z.enum(['BOOLEAN', 'QUOTA']).optional(),
  unit: grantUnit.optional(),
  limitValue: z.coerce.number().int().min(1).max(1000000000).optional(),
  sourceSystem,
  sourceId,
  startsAt: date.optional(),
  expiresAt: date.nullable().optional(),
  metadata: z.record(z.any()).optional(),
  event: integrationEvent.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const featureQuerySchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  featureKey,
}).strict();

const quotaMutationSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  featureKey,
  quantity: z.coerce.number().int().min(1).max(1000000000),
  sourceSystem: sourceSystem.optional(),
  sourceId: sourceId.optional(),
  event: integrationEvent.optional(),
  occurredAt: date.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

const grantStatusSchema = z.object({
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED']),
  event: integrationEvent.optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

module.exports = {
  uuid,
  idempotencyKey,
  creditUnit,
  featureKey,
  grantUnit,
  issueSchema,
  mutationSchema,
  consumeSchema,
  statementSchema,
  policySchema,
  grantSchema,
  featureQuerySchema,
  quotaMutationSchema,
  grantStatusSchema,
};
