const express = require('express');
const controller = require('../controllers/featureGrantController');
const { authenticate, requirePermission } = require('../middlewares/auth');

const router = express.Router();
router.use(authenticate);

router.post('/internal/feature-grants', requirePermission('entitlements', 'admin'), controller.grant);
router.patch('/internal/feature-grants/:id/status', requirePermission('entitlements', 'admin'), controller.updateStatus);
router.post('/internal/quotas/consume', requirePermission('entitlements', 'write'), controller.consume);
router.post('/internal/quotas/release', requirePermission('entitlements', 'write'), controller.release);
router.get('/features/check', requirePermission('entitlements', 'read'), controller.check);

module.exports = router;
