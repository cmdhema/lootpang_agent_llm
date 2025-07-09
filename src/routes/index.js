const express = require('express');
const router = express.Router();
const questRoutes = require('./questRoutes');

router.use('/quests', questRoutes);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
