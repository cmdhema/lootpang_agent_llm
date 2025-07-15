const telegramService = require('../services/telegramService');
const logger = require('../utils/logger');

class NotificationController {
  constructor() {
    this.sendQuestAlert = this.sendQuestAlert.bind(this);
  }
  /**
   * 알림 전송 여부를 결정하는 내부 메서드입니다.
   * @param {object} questData - 퀘스트 데이터
   * @returns {boolean} - 전송해야 하면 true, 아니면 false
   * @private
   */
  _shouldSendNotification(questData) {
    logger.info(questData);
    // type이 'Oat'인 경우 알림을 보내지 않음
    if (questData.type === 'Oat') {
      logger.info(`알림 전송 건너뜀 (Oat 조건): ${questData.id}`);
      return false;
    }

    // is_sns_only가 false일 때, 비용이 들거나 온체인 활동이 필요한 복합 퀘스트는 알림을 보내지 않음
    if (!questData.is_sns_only && questData.credentials && questData.credentials.length > 0) {
      const hasCostOrOnChain = questData.credentials.some(cred => 
        cred.analysis && (cred.analysis.fee === 1 || cred.analysis.on_chain === 1)
      );

      if (hasCostOrOnChain) {
        logger.info(`알림 전송 건너뜀 (비용/온체인 조건): ${questData.id}`);
        return false;
      }
    }

    // rewards 배열에서 reward_type이 'LOYALTYPOINTS'만 있는 경우 알림을 보내지 않음
    if (questData.rewards && questData.rewards.length > 0) {
      const allRewardsAreLoyaltyPoints = questData.rewards.every(reward => 
        reward.reward_type === 'LOYALTYPOINTS'
      );

      if (allRewardsAreLoyaltyPoints) {
        logger.info(`알림 전송 건너뜀 (LOYALTYPOINTS만 있음): ${questData.id}`);
        return false;
      }
    }
    
    return true;
  }
  /**
   * 텔레그램으로 퀘스트 알림을 보냅니다.
   * Edge Function으로부터 호출됩니다.
   * @param {object} req - Express 요청 객체
   * @param {object} res - Express 응답 객체
   */
  async sendQuestAlert(req, res) {
    const questData = req.body;

    if (!questData || Object.keys(questData).length === 0) {
      logger.warn('알림 컨트롤러: 빈 요청 본문을 받았습니다.');
      return res.status(400).json({ success: false, message: '요청 본문에 퀘스트 데이터가 없습니다.' });
    }

    try {
      logger.info('텔레그램 알림 요청 수신:', { questId: questData.id });

      if (this._shouldSendNotification(questData)) {
        await telegramService.sendQuestNotification(questData);
        res.status(200).json({ success: true, message: '텔레그램 알림이 성공적으로 전송되었습니다.' });
      } else {
        res.status(200).json({ success: true, message: '조건에 해당하여 알림을 전송하지 않았습니다.' });
      }
    } catch (error) {
      logger.error('텔레그램 알림 전송 중 오류 발생:', error);
      res.status(500).json({ success: false, message: '내부 서버 오류: 텔레그램 알림을 보내지 못했습니다.' });
    }
  }
}

module.exports = new NotificationController();
