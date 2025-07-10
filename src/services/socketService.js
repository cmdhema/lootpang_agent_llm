const logger = require('../utils/logger');
const ethers = require('ethers');

function initializeSocket(io, llmAgent, blockchainService) {
  io.on('connection', (socket) => {
    logger.info(`[Socket] 클라이언트 연결: ${socket.id}`);

    socket.on('join', (roomId) => {
      socket.join(roomId);
      logger.info(`[Socket] 룸 참여: 클라이언트 ${socket.id}가 룸 ${roomId}에 참여`);
    });

    socket.on('message', async (data) => {
      const { text, roomId, userId } = data;
      logger.info(`[Socket] 메시지 수신 (룸: ${roomId}): "${text}"`);

      try {
        if (!text || !roomId) {
          logger.warn(`[Socket] 잘못된 메시지 (text 또는 roomId 누락):`, data);
          socket.emit('error', { message: 'Message or room ID is missing.' });
          return;
        }

        socket.userAddress = userId;

        let userCollateral = null;
        let userDebt = null;

        if (userId && userId !== 'anonymous' && ethers.isAddress(userId)) {
          try {
            logger.info(`[Blockchain] 사용자(${userId}) 재정 상태 조회 시작`);
            userCollateral = await blockchainService.getUserCollateral(userId);
            userDebt = await blockchainService.getUserDebt(userId);
            logger.info(`[Blockchain] 사용자(${userId}) 재정 상태 - 담보: ${userCollateral}, 부채: ${userDebt}`);
          } catch (error) {
            logger.warn(`[Blockchain] 사용자(${userId}) 재정 상태 조회 실패:`, error.message);
          }
        }

        logger.info(`[LLM] 메시지 분석 시작: "${text}"`);
        const analysis = await llmAgent.analyzeMessage(text, userId, userCollateral, userDebt);
        logger.info(`[LLM] 메시지 분석 완료: ${analysis.response}`);

        if (analysis.action) {
          logger.info(`[Blockchain] 액션 처리 시작: ${analysis.action}`, analysis.params);
          const response = await blockchainService.handleAction(analysis, socket.userAddress);
          io.to(roomId).emit('response', response);
          logger.info(`[Blockchain] 액션 처리 완료`);
        } else {
          io.to(roomId).emit('response', { message: analysis.response });
        }
      } catch (error) {
        logger.error(`[Socket] 메시지 처리 중 오류 발생 (룸: ${roomId}):`, error);
        socket.emit('error', { message: 'An error occurred while processing your message.' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket] 클라이언트 연결 끊김: ${socket.id}`);
    });
  });
}

module.exports = initializeSocket;
