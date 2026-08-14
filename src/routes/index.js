const express = require('express');
const entitlementRoutes = require('./entitlementRoutes');

const router = express.Router();
router.use('/', entitlementRoutes);

module.exports = router;
