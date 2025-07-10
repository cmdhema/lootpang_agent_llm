const logger = require('../utils/logger');
const ethers = require('ethers');

function initializeSocket(io, llmAgent, blockchainService) {
  console.log('[디버그] 소켓 서비스 초기화 시작...');
  console.log('[디버그] Socket.IO 서버 인스턴스가 생성되었습니다.');

  io.on('connection', (socket) => {
    console.log(`[디버그] 새 클라이언트 연결 이벤트 발생: ${socket.id}`);
    logger.info(`클라이언트 연결됨: ${socket.id}`);

    socket.on('join', (roomId) => {
      console.log(`[디버그] 클라이언트 ${socket.id}로부터 join 요청 수신: ${roomId}`);
      socket.join(roomId);
      logger.info(`클라이언트 ${socket.id}가 룸 ${roomId}에 참여`);
      console.log(`[디버그] 클라이언트 ${socket.id}를 룸 ${roomId}에 성공적으로 참여시켰습니다.`);
    });

    socket.on('message', async (data) => {
      console.log(`[디버그] 클라이언트 ${socket.id}로부터 메시지 수신`);
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
