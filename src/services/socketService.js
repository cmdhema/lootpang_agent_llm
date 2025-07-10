const logger = require('../utils/logger');
const ethers = require('ethers');

function initializeSocket(io, llmAgent, blockchainService) {
  io.on('connection', (socket) => {
    logger.info(`클라이언트 연결됨: ${socket.id}`);

    socket.on('join', (roomId) => {
      socket.join(roomId);
      logger.info(`클라이언트 ${socket.id}가 룸 ${roomId}에 참여`);
    });

    socket.on('message', async (data) => {
      try {
        logger.info('메시지 수신:', data);
        
        const { text, roomId, userId } = data;
        logger.info('파싱된 데이터:', { text, roomId, userId });
        
        if (!text || !roomId) {
          socket.emit('error', { message: 'Message or room ID is missing.' });
          return;
        }

        socket.userAddress = userId;
        logger.info('사용자 주소 저장:', socket.userAddress);

        let userCollateral = null;
        let userDebt = null;
        
        if (userId && userId !== 'anonymous' && ethers.isAddress(userId)) {
          try {
            userCollateral = await blockchainService.getUserCollateral(userId);
            userDebt = await blockchainService.getUserDebt(userId);
            logger.info(`사용자 재정 상태 - 담보: ${userCollateral} ETH, 부채: ${userDebt} KKCoin`);
          } catch (error) {
            logger.warn('사용자 재정 상태 조회 실패:', error.message);
          }
        }

        const analysis = await llmAgent.analyzeMessage(text, userId, userCollateral, userDebt);
        logger.info('LLM 분석 결과:', analysis);

        const currentSession = llmAgent.getUserSession(userId);
        logger.info('현재 사용자 세션:', {
          userId,
          state: currentSession.state,
          context: currentSession.context,
          conversationHistory: currentSession.conversationHistory.slice(-2)
        });

        io.to(roomId).emit('response', { ...analysis, userId });

      } catch (error) {
        logger.error('메시지 처리 오류:', error);
        socket.emit('error', { message: 'Error processing message', details: error.message });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`클라이언트 연결 해제: ${socket.id}`);
    });
  });
}

module.exports = initializeSocket;
