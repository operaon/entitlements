const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const sequelize = require('../src/config/database');
const { FeatureGrant, FeatureGrantMovement } = require('../src/models');

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

const tokenFor = ({ tenantId = tenantA, permissions = ['entitlements:read', 'entitlements:write', 'entitlements:admin'] } = {}) => jwt.sign({
  sub: '99999999-9999-4999-8999-999999999999',
  tenantId,
  permissions,
  roles: ['operator'],
  tokenType: 'access',
  iss: env.jwt.issuer,
  aud: 'operaon-entitlements',
}, env.jwt.secret, { algorithm: env.jwt.algorithm, expiresIn: '10m' });

const auth = (token = tokenFor()) => ({
  Authorization: `Bearer ${token}`,
  'X-Service-Key': env.serviceApiKey,
});

const grantQuota = async (overrides = {}, token) => request(app)
  .post('/api/internal/feature-grants')
  .set(auth(token))
  .send({
    tenantId: tenantA,
    featureKey: 'quota:professionals',
    kind: 'QUOTA',
    unit: 'PROFESSIONAL',
    limitValue: 2,
    sourceSystem: 'platform-catalog',
    sourceId: 'plan-foundation-tenant-a',
    ...overrides,
  });

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await FeatureGrantMovement.destroy({ where: {}, truncate: true, cascade: true, restartIdentity: true });
  await FeatureGrant.destroy({ where: {}, truncate: true, cascade: true, restartIdentity: true });
});

afterAll(async () => sequelize.close());

test('concede quota, consulta saldo e consome de forma idempotente', async () => {
  const issued = await grantQuota();
  expect(issued.status).toBe(201);
  expect(issued.body.data.grant.featureKey).toBe('quota:professionals');
  expect(issued.body.data.grant.remainingValue).toBe(2);

  const checked = await request(app)
    .get('/api/features/check')
    .query({ featureKey: 'quota:professionals' })
    .set(auth());
  expect(checked.status).toBe(200);
  expect(checked.body.data.enabled).toBe(true);
  expect(checked.body.data.remainingValue).toBe(2);

  const consumed = await request(app)
    .post('/api/internal/quotas/consume')
    .set(auth())
    .set('Idempotency-Key', 'professional-seat-001')
    .send({ featureKey: 'quota:professionals', quantity: 1 });
  expect(consumed.status).toBe(200);
  expect(consumed.body.data.idempotent).toBe(false);

  const replay = await request(app)
    .post('/api/internal/quotas/consume')
    .set(auth())
    .set('Idempotency-Key', 'professional-seat-001')
    .send({ featureKey: 'quota:professionals', quantity: 1 });
  expect(replay.status).toBe(200);
  expect(replay.body.data.idempotent).toBe(true);
  expect(await FeatureGrantMovement.count({ where: { type: 'CONSUME' } })).toBe(1);

  const after = await request(app)
    .get('/api/features/check')
    .query({ featureKey: 'quota:professionals' })
    .set(auth());
  expect(after.body.data.remainingValue).toBe(1);
});

test('impede consumo acima da quota e mantém o saldo', async () => {
  await grantQuota();
  const response = await request(app)
    .post('/api/internal/quotas/consume')
    .set(auth())
    .set('Idempotency-Key', 'professional-seat-over-limit')
    .send({ featureKey: 'quota:professionals', quantity: 3 });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('QUOTA_EXCEEDED');
  expect(await FeatureGrantMovement.count({ where: { type: 'CONSUME' } })).toBe(0);
});

test('mantém feature booleana ativa e exige permissão administrativa para concedê-la', async () => {
  const denied = await grantQuota({
    featureKey: 'module:branding',
    kind: 'BOOLEAN',
    unit: 'BOOLEAN',
    limitValue: undefined,
    sourceId: 'branding-enterprise-tenant-a',
  }, tokenFor({ permissions: ['entitlements:write'] }));
  expect(denied.status).toBe(403);

  const granted = await grantQuota({
    featureKey: 'module:branding',
    kind: 'BOOLEAN',
    unit: 'BOOLEAN',
    limitValue: undefined,
    sourceId: 'branding-enterprise-tenant-a',
  });
  expect(granted.status).toBe(201);

  const checked = await request(app)
    .get('/api/features/check')
    .query({ featureKey: 'module:branding' })
    .set(auth());
  expect(checked.status).toBe(200);
  expect(checked.body.data.enabled).toBe(true);
  expect(checked.body.data.kind).toBe('BOOLEAN');
});

test('impede acesso de outro tenant ao grant e ao saldo', async () => {
  await grantQuota();
  const response = await request(app)
    .get('/api/features/check')
    .query({ featureKey: 'quota:professionals' })
    .set(auth(tokenFor({ tenantId: tenantB })));
  expect(response.status).toBe(200);
  expect(response.body.data.enabled).toBe(false);
  expect(response.body.data.remainingValue).toBe(0);
});
