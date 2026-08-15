const express = require('express');
const entitlementRoutes = require('./entitlementRoutes');
const featureGrantRoutes = require('./featureGrantRoutes');

const router = express.Router();
router.use('/', entitlementRoutes);
router.use('/', featureGrantRoutes);

module.exports = router;
