require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const sequelize = require('../src/config/database');
const { Entitlement, EntitlementMovement, TenantEntitlementPolicy } = require('../src/models');

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const patientA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entitlementSource = { sourceSystem: 'catalog', sourceId: 'order-1001' };

const tokenFor = ({ tenantId = tenantA, permissions = ['entitlements:read', 'entitlements:write', 'entitlements:admin'], roles = ['operator'] } = {}) => jwt.sign({
  sub: '99999999-9999-4999-8999-999999999999',
  tenantId,
  permissions,
  roles,
  tokenType: 'access',
  iss: env.jwt.issuer,
  aud: 'operaon-entitlements',
}, env.jwt.secret, { algorithm: env.jwt.algorithm, expiresIn: '10m' });

const auth = (token = tokenFor()) => ({
  Authorization: `Bearer ${token}`,
  'X-Service-Key': env.serviceApiKey,
});

const issue = async (overrides = {}, token) => request(app)
  .post('/api/internal/entitlements/issue')
  .set(auth(token))
  .send({
    ...entitlementSource,
    tenantId: tenantA,
    patientId: patientA,
    totalCredits: 5,
    ...overrides,
  });

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await TenantEntitlementPolicy.destroy({ where: {}, truncate: true, cascade: true, restartIdentity: true });
  await EntitlementMovement.destroy({ where: {}, truncate: true, cascade: true, restartIdentity: true });
  await Entitlement.destroy({ where: {}, truncate: true, cascade: true, restartIdentity: true });
});

afterAll(async () => sequelize.close());

test('emite de forma idempotente e grava somente um movimento ISSUE', async () => {
  const first = await issue();
  expect(first.status).toBe(201);
  expect(first.body.data.entitlement.availableCredits).toBe(5);
  expect(first.body.data.entitlement.creditUnit).toBe('SESSION');
  expect(first.body.data.idempotent).toBe(false);

  const replay = await issue();
  expect(replay.status).toBe(200);
  expect(replay.body.data.idempotent).toBe(true);
  expect(await EntitlementMovement.count()).toBe(1);
});

test('rejeita unidades temporais sem alterar o saldo do tenant', async () => {
  const response = await issue({ sourceId: 'order-unsupported-unit', creditUnit: 'MINUTE' });
  expect(response.status).toBe(422);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(await Entitlement.count()).toBe(0);
});

test('reserva, libera e consome uma unidade mantendo a invariância do saldo', async () => {
  const issued = await issue();
  const id = issued.body.data.entitlement.id;

  const reserved = await request(app).post(`/api/internal/entitlements/${id}/reserve`)
    .set(auth()).set('Idempotency-Key', 'reserve-1001').send({ appointmentId: '33333333-3333-4333-8333-333333333333' });
  expect(reserved.status).toBe(200);
  expect(reserved.body.data.entitlement.availableCredits).toBe(4);
  expect(reserved.body.data.entitlement.reservedCredits).toBe(1);

  const replay = await request(app).post(`/api/internal/entitlements/${id}/reserve`)
    .set(auth()).set('Idempotency-Key', 'reserve-1001').send({ appointmentId: '33333333-3333-4333-8333-333333333333' });
  expect(replay.status).toBe(200);
  expect(replay.body.data.idempotent).toBe(true);

  const consumed = await request(app).post(`/api/internal/entitlements/${id}/consume`)
    .set(auth()).set('Idempotency-Key', 'consume-1001').send({ appointmentId: '33333333-3333-4333-8333-333333333333', type: 'COMPLETE_CONSUME' });
  expect(consumed.status).toBe(200);
  expect(consumed.body.data.entitlement.availableCredits).toBe(4);
  expect(consumed.body.data.entitlement.reservedCredits).toBe(0);
  expect(consumed.body.data.entitlement.consumedCredits).toBe(1);
  expect(consumed.body.data.entitlement.totalCredits).toBe(5);
});

test('impede leitura e emissão fora do escopo do tenant', async () => {
  const issued = await issue();
  const id = issued.body.data.entitlement.id;

  const forbiddenRead = await request(app).get(`/api/entitlements/${id}`).set(auth(tokenFor({ tenantId: tenantB })));
  expect(forbiddenRead.status).toBe(404);

  const forbiddenIssue = await issue({ tenantId: tenantB, sourceId: 'order-other-tenant' });
  expect(forbiddenIssue.status).toBe(403);
  expect(forbiddenIssue.body.error.code).toBe('TENANT_SCOPE_DENIED');
  expect(await Entitlement.count()).toBe(1);
});

test('anula saldo não reservado sem confundir void com consumo', async () => {
  const issued = await issue();
  const id = issued.body.data.entitlement.id;
  const response = await request(app).post(`/api/internal/entitlements/${id}/void`)
    .set(auth()).set('Idempotency-Key', 'void-1001').send({ reason: 'cancelamento administrativo' });
  expect(response.status).toBe(200);
  expect(response.body.data.entitlement.status).toBe('CANCELLED');
  expect(response.body.data.entitlement.availableCredits).toBe(0);
  expect(response.body.data.entitlement.voidedCredits).toBe(5);
  expect(response.body.data.entitlement.consumedCredits).toBe(0);
});

test('nega leitura quando a permissão dinâmica não está presente', async () => {
  const issued = await issue();
  const response = await request(app).get(`/api/entitlements/${issued.body.data.entitlement.id}`)
    .set(auth(tokenFor({ permissions: ['entitlements:write'] })));
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('PERMISSION_DENIED');
});
