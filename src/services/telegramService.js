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

    const formatDt = (ts) => {
      if (!ts) return 'N/A';
      const date = new Date(ts * 1000);
      const y = date.getFullYear().toString().slice(-2);
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      const d = date.getDate().toString().padStart(2, '0');
      const h = date.getHours().toString().padStart(2, '0');
      const min = date.getMinutes().toString().padStart(2, '0');
      return `${y}-${m}-${d} ${h}:${min}`;
    };

    const startDate = formatDt(questData.start_time);
    const endDate = formatDt(questData.end_time);

    const message = `
🚀 **새로운 추천 퀘스트 알림** 🚀

🏢 **프로젝트**: ${questData.space.name}
✨ **퀘스트**: ${questData.name}
${questData.reward_name ? `🔹 **보상**: ${questData.reward_name}` : ''}
${questData.nft_contract_address ? `🔹 **보상**: NFT` : ''}
${questData.user_token_amount > 0 && questData.token_decimal != null ? `🎁 **인당 보상**: $${Number(questData.user_token_amount) / Math.pow(10, Number(questData.token_decimal))} ${questData.token_symbol || ''}` : ''}
${questData.cap > 0 ? `🔹 **총 인원**: ${questData.cap}명` : '🔹 **총 인원**: 무제한'}

🔹 **분배 방식**: ${questData.distribution_type}
🔹 **가스비 필요**: ${questData.gas_type === 'Gas' ? 'Y' : 'N'}
🔹 **체인**: ${questData.chain}

🔹 **기간**: ${startDate} ~ ${endDate}

🔹 **추천 사유**: ${questData.is_sns_only ? 'SNS 참여' : 'SNS 참여 및 비용이 없는 복합 퀘스트'}

🔗 **퀘스트 바로가기**:
https://app.galxe.com/quest/${questData.space.alias}/${questData.id}
    `.trim();

    return message;
  }

  /**
   * 포맷된 메시지를 텔레그램으로 전송합니다.
   * @param {object} questData - Edge Function에서 전달된 퀘스트 데이터
   */
  async sendQuestNotification(questData) {
    if (!this.bot) {
      logger.warn('텔레그램 봇이 초기화되지 않아 알림을 보낼 수 없습니다.');
      return;
    }

    const message = this.formatQuestMessage(questData);
    
    try {
      logger.info(`[Telegram] 퀘스트 알림 발송 시작: ${questData.name}`);
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'Markdown' });
      logger.info(`[Telegram] 퀘스트 알림 발송 성공: ${questData.name}`);
    } catch (error) {
      logger.error(`[Telegram] 퀘스트 알림 발송 실패: ${questData.name}`, error.message);
    }
  }
}

// 싱글턴 인스턴스로 내보내기
module.exports = new TelegramService();
