const express = require('express');
const router = express.Router();
const questRoutes = require('./questRoutes');
const notificationRoutes = require('./notificationRoutes');

router.use('/quests', questRoutes);
router.use('/notifications', notificationRoutes);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
