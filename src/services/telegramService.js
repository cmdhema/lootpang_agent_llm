const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class TelegramService {
  constructor() {
    this.bot = null;
    this.botToken = null;
    this.chatId = null;

    try {
      const configPath = path.join(process.cwd(), 'telegram', 'channels_config.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        this.botToken = config.notificationChannel?.token;
        this.chatId = config.notificationChannel?.id;

        if (this.botToken && this.chatId) {
          this.bot = new TelegramBot(this.botToken, { polling: false });
          logger.info('텔레그램 서비스가 설정 파일 기반으로 초기화되었습니다.');
        } else {
          logger.warn('channels_config.json 파일에 notificationChannel의 token 또는 id가 없습니다. 텔레그램 서비스가 비활성화됩니다.');
        }
      } else {
        logger.warn('channels_config.json 파일을 찾을 수 없습니다. 텔레그램 서비스가 비활성화됩니다.');
      }
    } catch (error) {
      logger.error('텔레그램 설정 파일을 읽는 중 오류가 발생했습니다:', error);
    }
  }

  /**
   * Supabase에서 받은 퀘스트 데이터를 텔레그램 메시지 형식으로 변환합니다.
   * @param {object} questData - Edge Function에서 전달된 퀘스트 데이터
   * @returns {string} - 마크다운 형식의 메시지 문자열
   */
  formatQuestMessage(questData) {
    if (!questData) {
      return '알림을 보낼 퀘스트 정보가 없습니다.';
    }

    const message = `
🚀 **새로운 추천 퀘스트 알림** 🚀

✨ **퀘스트**: ${questData.name}
🏢 **프로젝트**: ${questData.space_alias}

🔹 **퀘스트 유형**: ${questData.type}
🔹 **분배 방식**: ${questData.distribution_type}
🔹 **가스 종류**: ${questData.gas_type || 'N/A'}

📈 **경쟁률 정보**:
  - **총 인원**: ${questData.cap > 0 ? `${questData.cap}명` : '무제한'}
  - **현재 참여자**: ${questData.participants_count}명
  - **예상 당첨 확률**: ${questData.win_rate_percent ? `${questData.win_rate_percent}%` : '계산 불가'}

💬 **AI 분석 코멘트**:
_${questData.comments}_

🔗 **퀘스트 바로가기**:
https://app.lootpang.life/quest/${questData.quest_id}
    `.trim();

    return message;
  }

  /**
   * 포맷된 메시지를 텔레그램으로 전송합니다.
   * @param {object} questData - Edge Function에서 전달된 퀘스트 데이터
   */
  async sendQuestNotification(questData) {
    if (!this.bot) {
      const errorMessage = '텔레그램 봇이 초기화되지 않았습니다. 메시지를 보낼 수 없습니다.';
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const message = this.formatQuestMessage(questData);
    
    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      logger.info(`텔레그램 알림이 채팅 ID로 전송되었습니다: ${this.chatId}`);
    } catch (error) {
      logger.error('텔레그램 메시지 전송에 실패했습니다:', error.message);
      throw error;
    }
  }
}

// 싱글턴 인스턴스로 내보내기
module.exports = new TelegramService();
