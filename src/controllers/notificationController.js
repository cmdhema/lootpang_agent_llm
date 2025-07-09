const telegramService = require('../services/telegramService');
const logger = require('../utils/logger');

class NotificationController {
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
      logger.info('텔레그램 알림 요청 수신:', { questId: questData.quest_id });
      await telegramService.sendQuestNotification(questData);
      res.status(200).json({ success: true, message: '텔레그램 알림이 성공적으로 요청되었습니다.' });
    } catch (error) {
      logger.error('텔레그램 알림 전송 중 오류 발생:', error.message);
      res.status(500).json({ success: false, message: '내부 서버 오류: 텔레그램 알림을 보내지 못했습니다.' });
    }
  }
}

module.exports = new NotificationController();
