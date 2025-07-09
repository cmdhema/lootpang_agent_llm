const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

// Supabase Edge Function에서 이 엔드포인트를 호출합니다.
// POST /api/notifications/quest
router.post('/quest', notificationController.sendQuestAlert);

module.exports = router;
