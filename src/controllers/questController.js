const questModel = require('../models/questModel');
const blockchainService = require('../services/blockchainService');
const logger = require('../utils/logger');

const bcService = new blockchainService();

const getQuests = (req, res) => {
  try {
    const { tab } = req.params;
    const quests = questModel.findByTab(tab);
    
    logger.info(`Quest 리스트 요청: ${tab}, 개수: ${quests.length}`);
    res.json({
      success: true,
      data: quests
    });
  } catch (error) {
    logger.error('Quest 리스트 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch quests'
    });
  }
};

const checkQuestAchievement = async (req, res) => {
  try {
    const { questId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }

    logger.info(`Quest 달성 확인 요청: ${questId}, 지갑: ${walletAddress}`);

    const quest = questModel.findById(questId);

    if (!quest) {
      return res.status(404).json({
        success: false,
        error: 'Quest not found'
      });
    }

    const balance = await bcService.checkTokenBalance(
      walletAddress,
      quest.contractAddress,
      quest.network
    );

    const minAmount = parseFloat(quest.minAmount);
    const userBalance = parseFloat(balance);
    const isCompleted = userBalance >= minAmount;

    questModel.update(questId, { isCompleted, canWithdraw: isCompleted });

    logger.info(`Quest 확인 결과: ${questId}, 잔액: ${balance}, 달성: ${isCompleted}`);

    res.json({
      success: true,
      data: {
        questId,
        isCompleted,
        canWithdraw: isCompleted,
        userBalance: balance,
        minRequired: quest.minAmount,
        message: isCompleted 
          ? `Congratulations! You have ${balance} ${quest.reward.token} tokens. Quest completed!`
          : `You need at least ${quest.minAmount} ${quest.reward.token} tokens. Current balance: ${balance}`
      }
    });

  } catch (error) {
    logger.error('Quest 확인 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check quest achievement',
      details: error.message
    });
  }
};

const claimQuestReward = async (req, res) => {
  try {
    const { questId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required'
      });
    }

    logger.info(`보상 지급 요청: ${questId}, 지갑: ${walletAddress}`);

    const quest = questModel.findById(questId);

    if (!quest) {
      return res.status(404).json({
        success: false,
        error: 'Quest not found'
      });
    }

    if (!quest.isCompleted || !quest.canWithdraw) {
      return res.status(400).json({
        success: false,
        error: 'Quest not completed or reward already claimed'
      });
    }

    const result = await bcService.claimQuestReward(
      walletAddress,
      quest.reward.amount,
      quest.reward.token
    );

    if (result.success) {
      questModel.update(questId, { canWithdraw: false });
      
      logger.info(`보상 지급 완료: ${questId}, TX: ${result.txHash}`);

      res.json({
        success: true,
        data: {
          questId,
          txHash: result.txHash,
          amount: quest.reward.amount,
          token: quest.reward.token,
          message: `Successfully claimed ${quest.reward.amount} ${quest.reward.token} tokens!`
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to claim reward',
        details: result.error
      });
    }

  } catch (error) {
    logger.error('보상 지급 오류:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to claim reward',
      details: error.message
    });
  }
};

module.exports = {
  getQuests,
  checkQuestAchievement,
  claimQuestReward,
};
