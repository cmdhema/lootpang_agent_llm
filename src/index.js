const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const ethers = require('ethers');
require('dotenv').config();

const logger = require('./utils/logger');
const LLMAgent = require('./services/llmAgent');
const BlockchainService = require('./services/blockchainService');

const app = express();

// HTTPS 설정
let server;
const useHttps = process.env.USE_HTTPS === 'true';

if (useHttps) {
  // 인증서 파일 경로 확인
  const sslKeyPath = process.env.SSL_KEY_PATH;
  const sslCertPath = process.env.SSL_CERT_PATH;
  
  if (!sslKeyPath || !sslCertPath) {
    logger.error('HTTPS가 활성화되었지만 SSL_KEY_PATH 또는 SSL_CERT_PATH가 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    const privateKey = fs.readFileSync(path.resolve(sslKeyPath), 'utf8');
    const certificate = fs.readFileSync(path.resolve(sslCertPath), 'utf8');
    
    const credentials = { key: privateKey, cert: certificate };
    server = https.createServer(credentials, app);
    logger.info('HTTPS 서버로 시작됩니다.');
  } catch (error) {
    logger.error('SSL 인증서 로드 실패:', error.message);
    process.exit(1);
  }
} else {
  server = http.createServer(app);
  logger.info('HTTP 서버로 시작됩니다.');
}

// CORS 설정
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// 미들웨어 설정
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Trust proxy 설정 (rate limiting 전에 설정)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100개 요청
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(limiter);

// 서비스 초기화
const llmAgent = new LLMAgent();
const blockchainService = new BlockchainService();

// Quest 데이터 (메모리에 저장, 실제로는 DB 사용)
const questData = {
  'hackathon-temp': [
    {
      id: '1',
      projectName: 'KK',
      questName: 'Hold KK Token on BaseSepolia Network',
      description: 'Hold minimum 5 KK tokens in your wallet on Base Sepolia network',
      reward: { amount: 5, token: 'KK' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: process.env.BASESEPOLIA_KKCOIN_ADDRESS || '0x0000000000000000000000000000000000000000',
      network: 'basesepolia',
      minAmount: '5'
    },
    {
      id: '7',
      projectName: 'KK',
      questName: 'Hold KK Token on BaseSepolia Network #2',
      description: 'Hold minimum 30 KK tokens in your wallet on Base Sepolia network',
      reward: { amount: 30, token: 'KK' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: process.env.BASESEPOLIA_KKCOIN_ADDRESS || '0x0000000000000000000000000000000000000000',
      network: 'basesepolia',
      minAmount: '30'
    }
  ],
  'lootpang-curation': [
    {
      id: '2',
      projectName: 'Base Protocol',
      questName: 'Bridge ETH to Base Network',
      description: 'Bridge ETH from Ethereum mainnet to Base network',
      reward: { amount: 10, token: 'BASE' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'base',
      minAmount: '0.01'
    },
    {
      id: '3',
      projectName: 'Uniswap',
      questName: 'Provide Liquidity on Uniswap V3',
      description: 'Add liquidity to any pool on Uniswap V3',
      reward: { amount: 50, token: 'UNI' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '100'
    },
    {
      id: '4',
      projectName: 'Aave',
      questName: 'Supply Assets to Aave',
      description: 'Supply any asset to Aave lending protocol',
      reward: { amount: 25, token: 'AAVE' },
      isCompleted: true,
      canWithdraw: true,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '50'
    },
    {
      id: '5',
      projectName: 'Compound',
      questName: 'Borrow from Compound',
      description: 'Borrow any asset from Compound protocol',
      reward: { amount: 15, token: 'COMP' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '10'
    },
    {
      id: '6',
      projectName: 'Chainlink',
      questName: 'Use Chainlink Price Feeds',
      description: 'Interact with Chainlink price feed oracles',
      reward: { amount: 20, token: 'LINK' },
      isCompleted: false,
      canWithdraw: false,
      contractAddress: '0x0000000000000000000000000000000000000000',
      network: 'ethereum',
      minAmount: '25'
    }
  ]
};

// 기본 라우트
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Quest API Routes
app.get('/api/quests/:tab', (req, res) => {
  try {
    const { tab } = req.params;
    const quests = questData[tab] || [];
    
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
});

// Check Achievement API
app.post('/api/quest/:questId/check', async (req, res) => {
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

    // 퀘스트 찾기
    let quest = null;
    for (const tab in questData) {
      quest = questData[tab].find(q => q.id === questId);
      if (quest) break;
    }

    if (!quest) {
      return res.status(404).json({
        success: false,
        error: 'Quest not found'
      });
    }

    // 블록체인에서 토큰 잔액 확인
    const balance = await blockchainService.checkTokenBalance(
      walletAddress,
      quest.contractAddress,
      quest.network
    );

    const minAmount = parseFloat(quest.minAmount);
    const userBalance = parseFloat(balance);
    const isCompleted = userBalance >= minAmount;

    // 퀘스트 상태 업데이트
    quest.isCompleted = isCompleted;
    quest.canWithdraw = isCompleted;

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
});

// Claim Reward API
app.post('/api/quest/:questId/claim', async (req, res) => {
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

    // 퀘스트 찾기
    let quest = null;
    for (const tab in questData) {
      quest = questData[tab].find(q => q.id === questId);
      if (quest) break;
    }

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

    // Vault 컨트랙트에서 보상 지급
    const result = await blockchainService.claimQuestReward(
      walletAddress,
      quest.reward.amount,
      quest.reward.token
    );

    if (result.success) {
      // 보상 지급 완료 후 상태 업데이트
      quest.canWithdraw = false;
      
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
});

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  logger.info(`클라이언트 연결됨: ${socket.id}`);

  // 룸 참여
  socket.on('join', (roomId) => {
    socket.join(roomId);
    logger.info(`클라이언트 ${socket.id}가 룸 ${roomId}에 참여`);
  });

  // 메시지 처리
  socket.on('message', async (data) => {
    try {
      logger.info('메시지 수신:', data);
      
      const { text, roomId, userId } = data;
      logger.info('파싱된 데이터:', { text, roomId, userId });
      
      if (!text || !roomId) {
        socket.emit('error', { message: 'Message or room ID is missing.' });
        return;
      }

      // 클라이언트 세션에 사용자 정보 저장
      socket.userAddress = userId;
      logger.info('사용자 주소 저장:', socket.userAddress);

      // 사용자 담보 및 부채 정보 조회
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

      // LLM으로 메시지 분석 (상태 및 컨텍스트 포함)
      const analysis = await llmAgent.analyzeMessage(text, userId, userCollateral, userDebt);
      logger.info('LLM 분석 결과:', analysis);

      // 현재 사용자 세션 상태 로깅
      const currentSession = llmAgent.getUserSession(userId);
      logger.info('현재 사용자 세션:', {
        userId,
        state: currentSession.state,
        context: currentSession.context,
        conversationHistory: currentSession.conversationHistory.slice(-2)
      });

      // 상태 업데이트 (있는 경우)
      if (analysis.nextState) {
        logger.info(`상태 변경: ${currentSession.state} → ${analysis.nextState}`);
        llmAgent.updateUserSession(userId, { 
          state: analysis.nextState,
          context: analysis.context || {}
        });
      }

      // 액션별 처리
      await handleUserAction(analysis, userId, roomId, socket, data);

    } catch (error) {
      logger.error('메시지 처리 중 오류:', error);
      socket.emit('error', { message: 'An error occurred while processing the message.' });
    }
  });

  // 액션 처리 함수
  async function handleUserAction(analysis, userId, roomId, socket, originalData) {
    let response;

    switch (analysis.action) {
      case 'BORROW':
        response = await handleBorrowRequest(analysis, userId, roomId);
        break;
        

        
      case 'CHECK_LOAN_STATUS':
        response = await handleLoanStatusCheck(userId, originalData.text);
        break;
        
      case 'SIGNATURE':
        response = await handleSignatureSubmission(analysis, userId, originalData);
        break;
        
      case 'DEPOSIT':
        response = await handleDepositRequest(analysis, userId);
        break;
        
      case 'DEPOSIT_WITH_AMOUNT':
        response = await handleDepositWithAmount(analysis, userId);
        break;
        
      case 'DEPOSIT_COMPLETED':
        response = await handleDepositCompleted(analysis, userId);
        break;
        
      default:
        response = {
          id: `agent-${Date.now()}`,
          text: analysis.response || 'Sorry, I didn\'t understand. Please use the format "borrow [amount] [token]".\n\nAvailable commands:\n- "borrow [amount] [token]": Request a loan\n- "deposit": Collateral deposit guide\n- "status": Check loan status',
          isUser: false
        };
    }

    io.to(roomId).emit('messageBroadcast', response);
  }

  // 대출 요청 처리
  async function handleBorrowRequest(analysis, userId, roomId) {
    // 지갑 연결 확인
    if (!userId || userId === 'anonymous') {
      return {
        id: `agent-${Date.now()}`,
        text: 'To proceed with lending, please connect your wallet first. Click the "Connect Wallet" button to connect MetaMask.',
        isUser: false
      };
    }

    const { amount, token } = analysis.context || {};
    const loanAmount = parseFloat(amount || '3');
    const loanToken = token || 'kkcoin';

    // 담보 확인
    const userCollateral = await blockchainService.getUserCollateral(userId);
    const requiredCollateral = llmAgent.calculateRequiredCollateral(loanAmount, loanToken);
    
    logger.info(`Loan request analysis - Request: ${loanAmount} ${loanToken}, Current collateral: ${userCollateral} ETH, Required collateral: ${requiredCollateral} ETH`);

    if (parseFloat(userCollateral) < parseFloat(requiredCollateral)) {
      // 담보 부족 - 직접 deposit 안내
      const shortfall = (parseFloat(requiredCollateral) - parseFloat(userCollateral)).toFixed(4);
      const vaultAddress = process.env.SEPOLIA_VAULT_CONTRACT || 'N/A';
      
      llmAgent.updateUserSession(userId, { 
        state: 'AWAITING_DEPOSIT',
        context: { loanAmount, loanToken, requiredCollateral, depositAmount: shortfall }
      });

          return {
      id: `agent-${Date.now()}`,
      text: `❌ **Insufficient Collateral for Loan**\n\n🎯 **Loan Request:** ${loanAmount} ${loanToken.toUpperCase()}\n💰 **Your Current Collateral:** ${userCollateral} ETH\n📊 **Required Collateral:** ${requiredCollateral} ETH\n⚠️ **Shortfall:** ${shortfall} ETH\n\n📋 **To proceed with your loan, please deposit at least ${shortfall} ETH:**\n\n**Method: Direct Contract Call**\n1. 🦊 Open MetaMask\n2. 💸 Send **${shortfall} ETH** to: \`${vaultAddress}\`\n3. 📝 **Important:** Set the "Data" field to: \`0x6f758140\`\n4. ⛽ Use sufficient gas limit (e.g., 100,000)\n\n💡 **After depositing:**\n- Wait for transaction confirmation\n- Say "borrow ${loanAmount} ${loanToken}" again to retry\n\n🚀 `,
      isUser: false
    };
    }

    // 담보 충분 - 서명 진행
    try {
      const signatureData = await blockchainService.prepareLoanSignature(loanAmount, loanToken, userId);
      
      llmAgent.updateUserSession(userId, { 
        state: 'AWAITING_SIGNATURE',
        context: { loanAmount, loanToken }
      });

      return {
        id: `agent-${Date.now()}`,
        text: `✅ **Loan Approved!**\n\n🎯 **Loan Details:**\n- Amount: ${loanAmount} ${loanToken.toUpperCase()}\n- Your Collateral: ${userCollateral} ETH\n- Required Collateral: ${requiredCollateral} ETH\n- Collateral Ratio: ${((parseFloat(userCollateral) / parseFloat(requiredCollateral)) * 100).toFixed(1)}%\n\n🔐 **Please sign the transaction in MetaMask to proceed with your loan.**\n\n💡 Your collateral is safely held in the Vault contract during the loan period.`,
        isUser: false,
        action: 'AWAITING_SIGNATURE',
        dataToSign: signatureData
      };
    } catch (error) {
      logger.error('Signature preparation error:', error);
      return {
        id: `agent-${Date.now()}`,
        text: `Sorry, there was an error preparing your loan. Please try again later.\nError: ${error.message}`,
        isUser: false
      };
    }
  }



  // 대출 상태 확인 처리
  async function handleLoanStatusCheck(userId, originalMessage = '') {
    if (!userId || userId === 'anonymous') {
      return {
        id: `agent-${Date.now()}`,
        text: 'Please connect your wallet to check loan status.',
        isUser: false
      };
    }

    try {
      // 현재 사용자의 담보 및 부채 정보 조회
      const userCollateral = await blockchainService.getUserCollateral(userId);
      const userDebt = await blockchainService.getUserDebt(userId);
      
      // 담보 비율 계산 (1 KK Token = 0.01 ETH 담보 필요)
      const collateralRatio = 0.01; // 1 KK Token당 필요한 ETH
      const maxBorrowableKK = Math.floor(parseFloat(userCollateral) / collateralRatio);
      const availableBorrowKK = Math.max(0, maxBorrowableKK - parseFloat(userDebt));
      
      // 담보 활용률 계산
      const collateralUtilization = parseFloat(userCollateral) > 0 ? 
        ((parseFloat(userDebt) * collateralRatio) / parseFloat(userCollateral) * 100).toFixed(1) : 0;
      
      // 메시지에서 트랜잭션 해시 추출 시도
      const txHash = llmAgent.extractTransactionHash(originalMessage);
      logger.info(`Loan status check - User: ${userId}, Extracted TX: ${txHash}`);

      // 기본 대출 상태 확인
      const statusResult = await blockchainService.checkLoanStatus(userId, txHash);
      
      // 상세한 상태 메시지 구성
      let statusMessage = `📊 **Your Lending Status**\n\n`;
      
      // 현재 포지션 정보
      statusMessage += `💰 **Current Position:**\n`;
      statusMessage += `• Collateral: **${userCollateral} ETH**\n`;
      statusMessage += `• Current Debt: **${userDebt} KK Tokens**\n`;
      statusMessage += `• Collateral Utilization: **${collateralUtilization}%**\n\n`;
      
      // 대출 가능량 정보
      statusMessage += `🎯 **Borrowing Capacity:**\n`;
      statusMessage += `• Maximum Borrowable: **${maxBorrowableKK} KK Tokens**\n`;
      statusMessage += `• Available to Borrow: **${availableBorrowKK} KK Tokens**\n`;
      
      if (availableBorrowKK > 0) {
        statusMessage += `\n✅ **You can borrow up to ${availableBorrowKK} more KK Tokens!**\n`;
        statusMessage += `💡 Try: \`borrow ${Math.min(availableBorrowKK, 10)} kkcoin\``;
      } else if (parseFloat(userDebt) > 0) {
        statusMessage += `\n⚠️ **You've reached your borrowing limit.**\n`;
        statusMessage += `💡 Deposit more ETH to increase capacity.`;
      } else {
        statusMessage += `\n🚀 **Ready to start borrowing!**\n`;
        statusMessage += `💡 Try: \`borrow ${Math.min(maxBorrowableKK, 10)} kkcoin\``;
      }
      
      // 담보 추가 권장사항
      if (parseFloat(userCollateral) < 0.1) {
        statusMessage += `\n\n📈 **Recommendation:**\n`;
        statusMessage += `Consider depositing more ETH for larger borrowing capacity.\n`;
        statusMessage += `• Deposit 0.1 ETH → Borrow up to 10 KK Tokens\n`;
        statusMessage += `• Deposit 1.0 ETH → Borrow up to 100 KK Tokens`;
      }
      
      // 기존 상태 결과가 있으면 추가
      if (statusResult.message && statusResult.message !== `Current status:\n- Status: ${statusResult.status}`) {
        statusMessage += `\n\n🔍 **Transaction Status:**\n${statusResult.message}`;
      }
      
      return {
        id: `agent-${Date.now()}`,
        text: statusMessage,
        isUser: false
      };
      
    } catch (error) {
      logger.error('Loan status check error:', error);
      return {
        id: `agent-${Date.now()}`,
        text: `❌ **Error checking loan status.**\n\n🔍 **Details:**\n${error.message}\n\n🔄 **Please try:**\n1. Check your wallet connection\n2. Ensure you're on the correct network\n3. Try again in a moment`,
        isUser: false
      };
    }
  }

  // 서명 제출 처리
  async function handleSignatureSubmission(analysis, userId, originalData) {
    const result = await blockchainService.executeLoanWithSignature(
      originalData.text, 
      userId,
      originalData.signatureData
    );
    
    if (result.success) {
      llmAgent.updateUserSession(userId, { 
        state: 'LOAN_PROCESSING',
        context: { txHash: result.txHash }
      });
    } else {
      llmAgent.updateUserSession(userId, { state: 'IDLE' });
    }
    
    const responseText = result.success ? 
      (result.message || `✅ Loan processed successfully. Transaction hash: ${result.txHash}`) :
      `❌ Loan execution failed: ${result.error}`;
    
    return {
      id: `agent-${Date.now()}`,
      text: responseText,
      isUser: false
    };
  }

  // 담보 예치 요청 처리
  async function handleDepositRequest(analysis, userId) {
    if (!userId || userId === 'anonymous') {
      return {
        id: `agent-${Date.now()}`,
        text: 'Please connect your wallet to check deposit information.',
        isUser: false
      };
    }

    const currentCollateral = await blockchainService.getUserCollateral(userId);
    const vaultAddress = process.env.SEPOLIA_VAULT_CONTRACT || 'N/A';
    
    return {
      id: `agent-${Date.now()}`,
      text: `💰 **Current Collateral Status**\n\nYour current collateral: **${currentCollateral} ETH**\n\n📋 **How to deposit collateral:**\n\n**Method: Direct Transaction with Data**\n1. 🦊 Send ETH to: \`${vaultAddress}\`\n2. 📝 **Set Data field to:** \`0x6f758140\`\n3. ⛽ Use gas limit: 100,000+\n\n💡 **Important:** Don't just send ETH without calling the depositCollateral function!\n\n🚀 After depositing, you can request a loan by saying "borrow [amount] [token]".\n\n📝 Or specify an amount like "deposit 0.1 ETH" for detailed instructions.`,
      isUser: false
    };
  }

  // 구체적 금액으로 담보 예치 요청 처리
  async function handleDepositWithAmount(analysis, userId) {
    if (!userId || userId === 'anonymous') {
      return {
        id: `agent-${Date.now()}`,
        text: 'Please connect your wallet to deposit collateral.',
        isUser: false
      };
    }

    const { depositAmount } = analysis.context || {};
    const currentCollateral = await blockchainService.getUserCollateral(userId);
    
    logger.info(`Specific amount deposit request: ${userId}, Amount: ${depositAmount} ETH`);

    if (!depositAmount) {
      return {
        id: `agent-${Date.now()}`,
        text: 'I couldn\'t extract the deposit amount. Please specify like "deposit 0.1 ETH".',
        isUser: false
      };
    }

    // 예치 대기 상태로 변경
    llmAgent.updateUserSession(userId, { 
      state: 'AWAITING_DEPOSIT',
      context: { depositAmount, requestedAmount: depositAmount }
    });

    const vaultAddress = process.env.SEPOLIA_VAULT_CONTRACT || 'N/A';

    return {
      id: `agent-${Date.now()}`,
      text: `📋 **Deposit Instructions**\n\nYou want to deposit **${depositAmount} ETH** as collateral.\n\nYour current collateral: **${currentCollateral} ETH**\n\n**Method: Direct Transaction with Function Call**\n1. 🦊 Open MetaMask\n2. 💸 Send **${depositAmount} ETH** to: \`${vaultAddress}\`\n3. 📝 **Set Data field to:** \`0x6f758140\`\n4. ⛽ Use gas limit: 100,000+\n5. ✅ Confirm transaction\n\n💡 **After depositing:**\n- Wait for transaction confirmation\n- Say "I deposited" or "deposit completed" to continue\n\n⚠️ **Important:** Must call depositCollateral function, not just send ETH!`,
      isUser: false
    };
  }

  // 담보 예치 완료 처리
  async function handleDepositCompleted(analysis, userId) {
    if (!userId || userId === 'anonymous') {
      return {
        id: `agent-${Date.now()}`,
        text: 'Please connect your wallet to check your deposit.',
        isUser: false
      };
    }

    logger.info(`Deposit completion check: ${userId}`);

    // 현재 담보 잔액 확인
    const currentCollateral = await blockchainService.getUserCollateral(userId);
    const session = llmAgent.getUserSession(userId);
    const { loanAmount, loanToken, requiredCollateral } = session.context || {};

    // 상태를 IDLE로 리셋
    llmAgent.updateUserSession(userId, { 
      state: 'IDLE',
      context: {}
    });

    if (loanAmount && loanToken && requiredCollateral) {
      // 이전에 대출 요청이 있었다면 담보 확인 후 대출 진행
      if (parseFloat(currentCollateral) >= parseFloat(requiredCollateral)) {
        // 충분한 담보 - 대출 진행
        try {
          const signatureData = await blockchainService.prepareLoanSignature(loanAmount, loanToken, userId);
          
          llmAgent.updateUserSession(userId, { 
            state: 'AWAITING_SIGNATURE',
            context: { loanAmount, loanToken }
          });

          return {
            id: `agent-${Date.now()}`,
            text: `✅ Great! Your collateral is now ${currentCollateral} ETH, which is sufficient for ${loanAmount} ${loanToken}.\n\nPlease sign the transaction in MetaMask to proceed with your loan.`,
            isUser: false,
            action: 'AWAITING_SIGNATURE',
            dataToSign: signatureData
          };
        } catch (error) {
          logger.error('Loan signature preparation error:', error);
          return {
            id: `agent-${Date.now()}`,
            text: `✅ Deposit confirmed! Current collateral: ${currentCollateral} ETH\n\n❌ However, there was an error preparing your loan. Please try requesting the loan again.`,
            isUser: false
          };
        }
      } else {
        // 여전히 담보 부족
        const shortfall = (parseFloat(requiredCollateral) - parseFloat(currentCollateral)).toFixed(4);
        return {
          id: `agent-${Date.now()}`,
          text: `✅ Deposit confirmed! Current collateral: ${currentCollateral} ETH\n\n⚠️ You still need ${shortfall} ETH more to borrow ${loanAmount} ${loanToken}.\n\nPlease deposit more collateral or request a smaller loan amount.`,
          isUser: false
        };
      }
    } else {
      // 일반적인 예치 완료 확인
      return {
        id: `agent-${Date.now()}`,
        text: `✅ Deposit confirmed! Your current collateral: ${currentCollateral} ETH\n\n💡 You can now request a loan by saying "borrow [amount] [token]".`,
        isUser: false
      };
    }
  }



  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
const protocol = useHttps ? 'https' : 'http';

server.listen(PORT, () => {
  logger.info(`LootPang LLM Agent server is running on ${protocol}://localhost:${PORT}`);
});

// 에러 핸들링
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
}); 