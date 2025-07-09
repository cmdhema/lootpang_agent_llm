const express = require('express');
const router = express.Router();
const questController = require('../controllers/questController');

// Quest API Routes
router.get('/:tab', questController.getQuests);
router.post('/:questId/check', questController.checkQuestAchievement);
router.post('/:questId/claim', questController.claimQuestReward);

module.exports = router;
