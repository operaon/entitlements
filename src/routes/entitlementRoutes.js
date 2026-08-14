const express = require('express');
const controller = require('../controllers/entitlementController');
const { authenticate, requirePermission } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate);

router.post('/internal/entitlements/issue', requirePermission('entitlements', 'write'), controller.issue);
router.post('/internal/entitlements/:id/reserve', requirePermission('entitlements', 'write'), controller.reserve);
router.post('/internal/entitlements/:id/release', requirePermission('entitlements', 'write'), controller.release);
router.post('/internal/entitlements/:id/consume', requirePermission('entitlements', 'write'), controller.consume);
router.post('/internal/entitlements/:id/refund', requirePermission('entitlements', 'admin'), controller.refund);
router.post('/internal/entitlements/:id/void', requirePermission('entitlements', 'admin'), controller.voidEntitlement);

router.get('/entitlements/patients/:patientId/statement', requirePermission('entitlements', 'read'), controller.statement);
router.get('/entitlements/:id/movements', requirePermission('entitlements', 'read'), controller.movements);
router.get('/entitlements/:id', requirePermission('entitlements', 'read'), controller.get);
router.get('/entitlements/policy', requirePermission('entitlements', 'read'), controller.getPolicy);
router.put('/entitlements/policy', requirePermission('entitlements', 'admin'), controller.upsertPolicy);

module.exports = router;
