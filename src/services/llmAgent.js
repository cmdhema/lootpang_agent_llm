const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

class LLMAgent {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY가 환경 변수에 설정되지 않았습니다.');
    }
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // 사용자별 대화 상태 관리
    this.userSessions = new Map();
  }

  // 사용자 세션 초기화 또는 가져오기
  getUserSession(userId) {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, {
        state: 'IDLE', // IDLE, CHECKING_COLLATERAL, AWAITING_DEPOSIT_CONFIRMATION, AWAITING_SIGNATURE, LOAN_PROCESSING
        context: {},
        conversationHistory: []
      });
    }
    return this.userSessions.get(userId);
  }

  // 사용자 세션 업데이트
  updateUserSession(userId, updates) {
    const session = this.getUserSession(userId);
    Object.assign(session, updates);
    this.userSessions.set(userId, session);
  }

  // 대화 히스토리에 메시지 추가
  addToHistory(userId, role, message) {
    const session = this.getUserSession(userId);
    session.conversationHistory.push({ role, message, timestamp: Date.now() });
    
    // 히스토리가 너무 길어지면 오래된 것부터 제거 (최대 20개 유지)
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }
  }

  async analyzeMessage(text, userId = 'anonymous', userCollateral = null, userDebt = null) {
    try {
      logger.info(`메시지 분석 시작: ${text}, 사용자: ${userId}`);
      
      const session = this.getUserSession(userId);
      this.addToHistory(userId, 'user', text);

      // 상태 기반 간단한 규칙 처리 (LLM 전에 먼저 확인)
      const quickAnalysis = this.quickStateBasedAnalysis(text, session);
      if (quickAnalysis) {
        logger.info('간단한 규칙으로 분석 완료:', quickAnalysis);
        this.addToHistory(userId, 'assistant', quickAnalysis.response);
        return quickAnalysis;
      }

      // LLM을 통한 상세 분석
      const analysis = await this.analyzeWithContext(text, session, userCollateral, userDebt);
      
      this.addToHistory(userId, 'assistant', analysis.response);
      return analysis;

    } catch (error) {
      logger.error('메시지 분석 중 오류:', error);
      return {
        action: 'ERROR',
        response: 'Sorry, I encountered an error while processing your message. Please try again.',
        confidence: 0
      };
    }
  }

  async analyzeWithContext(text, session, userCollateral, userDebt) {
    const prompt = this.buildContextualPrompt(text, session, userCollateral, userDebt);
    
    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      const analysisText = response.text();
      
      logger.info('Gemini 응답:', analysisText);
      
      // JSON 파싱 시도
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return analysis;
      }
      
      // JSON 파싱 실패 시 기본 응답
      return {
        action: 'GENERAL',
        response: analysisText,
        confidence: 0.5
      };
      
    } catch (error) {
      logger.error('Gemini API 오류:', error);
      throw error;
    }
  }

  buildContextualPrompt(text, session, userCollateral, userDebt) {
    const { state, context, conversationHistory } = session;
    
    // 대화 히스토리를 문자열로 변환
    const historyText = conversationHistory
      .slice(-5) // 최근 5개만 사용
      .map(h => `${h.role}: ${h.message}`)
      .join('\n');

    return `You are LootPang's cross-chain lending assistant. Analyze the user's message and respond appropriately.

CURRENT CONTEXT:
- User State: ${state}
- User Collateral (ETH): ${userCollateral || 'Unknown'} ETH
- User Debt (KKCoin): ${userDebt || 'Unknown'} KKCoin
- Previous Context: ${JSON.stringify(context)}

RECENT CONVERSATION:
${historyText}

CURRENT USER MESSAGE: "${text}"

IMPORTANT STATE-BASED RULES:
1. If User State is "AWAITING_DEPOSIT_CONFIRMATION" and user says "yes", "okay", "sure", "proceed" → ACTION: CONFIRM_DEPOSIT
2. If User State is "AWAITING_DEPOSIT_CONFIRMATION" and user says "no", "cancel", "not now" → ACTION: GENERAL (decline deposit)
3. If User State is "AWAITING_SIGNATURE" and message starts with "0x" → ACTION: SIGNATURE
4. If User State is "LOAN_PROCESSING" and user asks about status/completion → ACTION: CHECK_LOAN_STATUS
5. If user explicitly asks about loan status/completion → ACTION: CHECK_LOAN_STATUS
6. If user wants to borrow tokens → ACTION: BORROW
7. If user asks about deposit without being prompted → ACTION: DEPOSIT
8. If user says "deposit [amount] ETH" or "[amount] ETH deposit" → ACTION: DEPOSIT_WITH_AMOUNT (extract amount)
9. If User State is "AWAITING_DEPOSIT" and user says "deposited", "completed", "done" → ACTION: DEPOSIT_COMPLETED

AVAILABLE ACTIONS:
- BORROW: User wants to borrow tokens
- DEPOSIT: User asking about deposit process (general)
- DEPOSIT_WITH_AMOUNT: User wants to deposit specific ETH amount
- DEPOSIT_COMPLETED: User notifying deposit completion
- DEPOSIT_SIGNATURE: User providing deposit signature (0x...)
- CHECK_LOAN_STATUS: User asking about loan completion status
- CONFIRM_DEPOSIT: User confirming they want to deposit (only when state is AWAITING_DEPOSIT_CONFIRMATION)
- SIGNATURE: User providing loan signature (0x...)
- GENERAL: General conversation or unclear intent

AMOUNT EXTRACTION RULES:
- Look for patterns like: "deposit 0.1 ETH", "0.05 eth", "send 0.001 ETH", "예치 0.1 이더"
- Extract the numeric value and include it in context as "depositAmount"
- If user specifies amount, use DEPOSIT_WITH_AMOUNT action

BUSINESS RULES:
- Minimum collateral required: 0.01 ETH to borrow 3 KKCoin
- Collateral ratio: 1 ETH = 300 KKCoin borrowing power (150% collateralization)
- CCIP transactions take ~20 minutes to complete
- Users must deposit collateral on Sepolia network
- Loans are issued on Base Sepolia network

RESPONSE INSTRUCTIONS:
Based on the current state and user message, determine the appropriate action and response.

CRITICAL: Pay special attention to the User State:
- If state is "AWAITING_DEPOSIT_CONFIRMATION" and user gives positive response → CONFIRM_DEPOSIT
- If state is "AWAITING_SIGNATURE" and user provides signature → SIGNATURE
- If state is "LOAN_PROCESSING" and user asks about status → CHECK_LOAN_STATUS

Respond in JSON format:
{
  "action": "ACTION_NAME",
  "response": "Your helpful response to the user",
  "confidence": 0.9,
  "nextState": "NEW_STATE_IF_NEEDED",
  "context": {
    "amount": "extracted_amount_if_any",
    "token": "extracted_token_if_any",
    "requiredCollateral": "calculated_collateral_if_needed"
  }
}

Always be helpful, clear, and guide users through the lending process step by step.`;
  }

  // 담보 요구량 계산
  calculateRequiredCollateral(loanAmount, token = 'kkcoin') {
    // 1 ETH = 300 KKCoin 기준 (150% 담보비율)
    const kkcoinRate = 300;
    const collateralRatio = 1.5; // 150%
    
    if (token.toLowerCase() === 'kkcoin' || token.toLowerCase() === 'kk') {
      return (parseFloat(loanAmount) / kkcoinRate * collateralRatio).toFixed(4);
    }
    
    return "0.01"; // 기본값
  }

  // 메시지에서 트랜잭션 해시 추출
  extractTransactionHash(text) {
    // 0x로 시작하는 64자리 16진수 문자열 찾기
    const txHashRegex = /0x[a-fA-F0-9]{64}/g;
    const matches = text.match(txHashRegex);
    return matches ? matches[0] : null;
  }

  // 대출 상태 확인 의도 판단
  isLoanStatusInquiry(text) {
    const statusKeywords = [
      '완료', '됐나', '끝났나', '상태', 'status', 'complete', 'done', 'finished',
      '진행', 'progress', '처리', 'process', '확인', 'check'
    ];
    
    const loanKeywords = [
      '대출', 'loan', 'borrow', 'lending', '빌린', '차용'
    ];
    
    const textLower = text.toLowerCase();
    
    const hasStatusKeyword = statusKeywords.some(keyword => 
      textLower.includes(keyword.toLowerCase())
    );
    
    const hasLoanKeyword = loanKeywords.some(keyword => 
      textLower.includes(keyword.toLowerCase())
    );
    
    return hasStatusKeyword && (hasLoanKeyword || this.extractTransactionHash(text));
  }

  // 사용자 세션 정리
  clearUserSession(userId) {
    this.userSessions.delete(userId);
  }

  // 간단한 패턴 매칭 백업 메서드
  fallbackAnalysis(message) {
    const lowerMessage = message.toLowerCase();
    
    // 서명 데이터 감지
    if (message.startsWith('0x') && message.length > 100) {
      return {
        action: 'SIGNATURE',
        response: '서명을 처리하겠습니다.'
      };
    }
    
    // 대출 요청 감지
    const borrowPatterns = [
      /borrow\s+(\d+)\s*(\w*)/i,
      /lend\s+me\s+(\d+)\s*(\w*)/i,
      /빌려줘?\s*(\d+)\s*(\w*)/i,
      /대출\s*(\d+)\s*(\w*)/i
    ];
    
    for (const pattern of borrowPatterns) {
      const match = message.match(pattern);
      if (match) {
        return {
          action: 'BORROW',
          amount: match[1],
          token: match[2] || 'kkcoin',
          response: `${match[1]} ${match[2] || 'kkcoin'} 대출을 준비하겠습니다.`
        };
      }
    }
    
    return {
      action: 'GENERAL',
      response: '안녕하세요! 대출이 필요하시면 "borrow [금액] [토큰]" 형식으로 말씀해주세요.'
    };
  }

  // 메시지에서 ETH 금액 추출
  extractETHAmount(text) {
    // ETH 금액 패턴: "0.1 eth", "deposit 0.05", "0.001 ETH" 등
    const ethPatterns = [
      /(\d+\.?\d*)\s*eth/gi,
      /(\d+\.?\d*)\s*ETH/g,
      /deposit\s+(\d+\.?\d*)/gi,
      /(\d+\.?\d*)\s*이더/gi,
      /(\d+\.?\d*)\s*ether/gi
    ];
    
    for (const pattern of ethPatterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = match[1] || match[0].replace(/[^0-9.]/g, '');
        const numAmount = parseFloat(amount);
        if (!isNaN(numAmount) && numAmount > 0) {
          return numAmount.toString();
        }
      }
    }
    
    return null;
  }

  // 예치 의도 판단
  isDepositRequest(text) {
    const depositKeywords = [
      'deposit', '예치', '담보', 'collateral', '입금', 'send', 'transfer'
    ];
    
    const textLower = text.toLowerCase();
    return depositKeywords.some(keyword => textLower.includes(keyword));
  }

  // 상태 기반 간단한 규칙 분석
  quickStateBasedAnalysis(text, session) {
    const { state, context } = session;
    const textLower = text.toLowerCase().trim();
    
    // 1. 담보 예치 확인 대기 상태에서 긍정적 응답
    if (state === 'AWAITING_DEPOSIT_CONFIRMATION') {
      const positiveResponses = ['yes', 'y', 'ok', 'okay', 'sure', 'proceed', 'go ahead', '네', '예', '좋아', '진행'];
      const negativeResponses = ['no', 'n', 'cancel', 'not now', 'later', '아니', '아니요', '취소', '나중에'];
      
      if (positiveResponses.some(response => textLower === response || textLower.includes(response))) {
        return {
          action: 'CONFIRM_DEPOSIT',
          response: 'Great! I\'ll provide you with deposit instructions.',
          confidence: 0.95,
          nextState: 'AWAITING_DEPOSIT',
          context: context
        };
      }
      
      if (negativeResponses.some(response => textLower === response || textLower.includes(response))) {
        return {
          action: 'GENERAL',
          response: 'No problem! You can request a deposit later when you\'re ready. Just say "deposit" when you want to add collateral.',
          confidence: 0.95,
          nextState: 'IDLE',
          context: {}
        };
      }
    }
    
    // 2. 구체적인 ETH 금액이 포함된 예치 요청
    const ethAmount = this.extractETHAmount(text);
    if (ethAmount && this.isDepositRequest(text)) {
      return {
        action: 'DEPOSIT_WITH_AMOUNT',
        response: `You want to deposit ${ethAmount} ETH. Let me provide the deposit instructions.`,
        confidence: 0.9,
        nextState: 'AWAITING_DEPOSIT',
        context: {
          ...context,
          depositAmount: ethAmount
        }
      };
    }
    
    // 3. 서명 대기 상태에서 서명 데이터
    if (state === 'AWAITING_SIGNATURE' && text.startsWith('0x') && text.length > 50) {
      return {
        action: 'SIGNATURE',
        response: 'Processing your loan signature...',
        confidence: 0.95,
        context: context
      };
    }
    
    // 3.5. 담보 예치 서명 대기 상태에서 서명 데이터
    if (state === 'AWAITING_DEPOSIT_SIGNATURE' && text.startsWith('0x') && text.length > 50) {
      return {
        action: 'DEPOSIT_SIGNATURE',
        response: 'Processing your deposit signature...',
        confidence: 0.95,
        context: context
      };
    }
    
    // 4. 대출 처리 중 상태에서 상태 확인 질문
    if (state === 'LOAN_PROCESSING') {
      const statusKeywords = ['완료', '됐나', '끝났나', '상태', 'status', 'complete', 'done', 'finished', 'progress'];
      if (statusKeywords.some(keyword => textLower.includes(keyword))) {
        return {
          action: 'CHECK_LOAN_STATUS',
          response: 'Let me check your loan status...',
          confidence: 0.9,
          context: context
        };
      }
    }
    
    // 5. 예치 완료 알림
    if (state === 'AWAITING_DEPOSIT') {
      const depositCompleteKeywords = ['deposited', 'completed', 'done', 'sent', '완료', '예치했어', '보냈어', 'transferred'];
      if (depositCompleteKeywords.some(keyword => textLower.includes(keyword))) {
        return {
          action: 'DEPOSIT_COMPLETED',
          response: 'Let me check your collateral and proceed with your loan...',
          confidence: 0.9,
          context: context
        };
      }
    }
    
    // 6. 일반적인 대출 상태 확인 (트랜잭션 해시 포함)
    if (this.isLoanStatusInquiry(text)) {
      return {
        action: 'CHECK_LOAN_STATUS',
        response: 'Let me check your loan status...',
        confidence: 0.85,
        context: { txHash: this.extractTransactionHash(text) }
      };
    }
    
    return null; // 간단한 규칙으로 처리할 수 없음, LLM으로 넘김
  }
}

module.exports = LLMAgent; 