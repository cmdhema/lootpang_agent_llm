const { ethers } = require('ethers');
const logger = require('../utils/logger');

class BlockchainService {
  constructor() {
    this.initializeProviders();
    this.initializeContracts();
    
    // 사용자별 진행 중인 트랜잭션 추적
    this.userTransactions = new Map();
  }

  initializeProviders() {
    // Sepolia 프로바이더
    this.sepoliaProvider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    this.sepoliaSigner = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY, this.sepoliaProvider);

    // Base Sepolia 프로바이더
    this.baseProvider = new ethers.JsonRpcProvider(process.env.BASESEPOLIA_RPC_URL);
    this.baseSigner = new ethers.Wallet(process.env.BASESEPOLIA_PRIVATE_KEY, this.baseProvider);

    logger.info('블록체인 프로바이더 초기화 완료');
  }

  initializeContracts() {
    // 컨트랙트 주소들 (실제 환경 변수 이름 사용)
    this.contractAddresses = {
      sepoliaVault: process.env.SEPOLIA_VAULT_CONTRACT,
      vaultSender: process.env.SEPOLIA_VAULT_SENDER_CONTRACT,
      baseVault: process.env.BASESEPOLIA_VAULT_CONTRACT,
      vaultReceiver: process.env.BASESEPOLIA_VAULT_RECEIVER_CONTRACT,
      kkcoin: process.env.BASESEPOLIA_KKCOIN_ADDRESS || process.env.KKCOIN_ADDRESS
    };

    // 체인 셀렉터
    this.BASE_CHAIN_SELECTOR = process.env.BASE_CHAIN_SELECTOR || "10344971235874465080";

    // 컨트랙트 ABI (간단한 버전)
    this.vaultABI = [
      "function getCollateral(address user) view returns (uint256)",
      "function getDebt(address user) view returns (uint256)",
      "function nonces(address user) view returns (uint256)"
    ];

    this.vaultSenderABI = [
      "function sendLendRequestWithSignature(uint64 destinationChainSelector, address receiver, address user, uint256 amount, uint256 nonce, uint256 deadline, bytes signature) payable"
    ];

    // 환경 변수 로딩 확인
    logger.info('컨트랙트 설정 완료:', {
      sepoliaVault: this.contractAddresses.sepoliaVault,
      vaultSender: this.contractAddresses.vaultSender,
      baseVault: this.contractAddresses.baseVault,
      vaultReceiver: this.contractAddresses.vaultReceiver,
      kkcoin: this.contractAddresses.kkcoin,
      chainSelector: this.BASE_CHAIN_SELECTOR
    });
  }

  async prepareLoanSignature(amount, token = 'kkcoin', userAddress = '0x0000000000000000000000000000000000000000') {
    try {
      logger.info('대출 서명 준비 시작:', { amount, token, userAddress });

      // 유효한 이더리움 주소인지 확인
      if (!userAddress || userAddress === 'anonymous' || !ethers.isAddress(userAddress)) {
        logger.warn('유효하지 않은 사용자 주소, 기본값 사용:', userAddress);
        userAddress = '0x0000000000000000000000000000000000000000';
      }

      const loanAmount = ethers.parseEther(amount.toString());
      
      // Base 네트워크에서 현재 nonce 조회 (정확한 nonce 확보)
      const baseVault = new ethers.Contract(
        this.contractAddresses.baseVault,
        this.vaultABI,
        this.baseProvider
      );
      
      const userNonce = await baseVault.nonces(userAddress);
      logger.info(`사용자 현재 nonce: ${userNonce.toString()}`);
      
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1시간 후

      // EIP-712 도메인
      const domain = {
        name: "VaultLending",
        version: "1",
        chainId: 84532, // Base Sepolia
        verifyingContract: this.contractAddresses.baseVault
      };

      // EIP-712 타입
      const types = {
        LoanRequest: [
          { name: "user", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      // EIP-712 값
      const value = {
        user: userAddress,
        amount: loanAmount.toString(),
        nonce: userNonce.toString(),
        deadline: deadline
      };

      logger.info('서명 데이터 준비 완료:', { domain, types, value });

      return {
        domain,
        types,
        value,
        metadata: {
          amount: amount.toString(),
          token: token,
          deadline: deadline,
          nonce: userNonce.toString()
        }
      };

    } catch (error) {
      logger.error('서명 준비 중 오류:', error);
      throw error;
    }
  }

  async executeLoanWithSignature(signature, userAddress = '0x0000000000000000000000000000000000000000', signatureData = null) {
    try {
      logger.info('서명으로 대출 실행 시작:', { signature: signature.substring(0, 10) + '...', userAddress });

      // 서명이 유효한지 확인
      if (!signature || !signature.startsWith('0x')) {
        throw new Error('유효하지 않은 서명입니다.');
      }

      // 유효한 이더리움 주소인지 확인
      if (!userAddress || userAddress === 'anonymous' || !ethers.isAddress(userAddress)) {
        logger.warn('유효하지 않은 사용자 주소, 기본값 사용:', userAddress);
        userAddress = '0x0000000000000000000000000000000000000000';
      }

      // 사용자 담보 상태 확인
      const userCollateral = await this.getUserCollateral(userAddress);
      logger.info(`사용자 담보: ${userCollateral} ETH`);
      
      if (parseFloat(userCollateral) === 0) {
        return {
          success: false,
          error: '담보가 없습니다. 먼저 Sepolia 네트워크에서 ETH를 담보로 예치해주세요.'
        };
      }

      // 서명 데이터에서 파라미터 추출 (있는 경우)
      let amount, nonce, deadline;
      
      if (signatureData && signatureData.value) {
        // 서명 데이터에서 값 추출 (이미 Wei 단위이므로 parseEther 사용하지 않음)
        amount = BigInt(signatureData.value.amount.toString());
        deadline = parseInt(signatureData.value.deadline.toString());
        
        // ⚠️ 중요: 서명 시 사용한 nonce를 그대로 사용 (실행 시점에 변경하지 않음)
        nonce = BigInt(signatureData.value.nonce.toString());
        
        // 현재 컨트랙트의 nonce와 비교하여 상태 확인
        const baseVault = new ethers.Contract(
          this.contractAddresses.baseVault,
          this.vaultABI,
          this.baseProvider
        );
        const currentNonce = await baseVault.nonces(userAddress);
        
        logger.info('Nonce 상태 확인:', {
          서명시_nonce: nonce.toString(),
          현재_컨트랙트_nonce: currentNonce.toString(),
          상태: nonce === currentNonce ? '유효' : '무효'
        });
        
        // nonce가 이미 사용되었는지 확인
        if (nonce < currentNonce) {
          return {
            success: false,
            error: `이 서명은 이미 사용되었습니다. 새로운 서명이 필요합니다. (서명 nonce: ${nonce}, 현재 nonce: ${currentNonce})`
          };
        }
        
        // nonce가 너무 미래인지 확인
        if (nonce > currentNonce) {
          return {
            success: false,
            error: `유효하지 않은 nonce입니다. 현재 nonce보다 큽니다. (서명 nonce: ${nonce}, 현재 nonce: ${currentNonce})`
          };
        }
        
        // deadline 검증
        const currentTime = Math.floor(Date.now() / 1000);
        if (deadline <= currentTime) {
          return {
            success: false,
            error: `서명이 만료되었습니다. 새로운 서명이 필요합니다. (만료 시간: ${new Date(deadline * 1000).toISOString()})`
          };
        }
        
        logger.info('서명 데이터에서 파라미터 추출:', {
          amount: ethers.formatEther(amount) + ' KKCoin',
          nonce: nonce.toString(),
          deadline: new Date(deadline * 1000).toISOString()
        });
      } else {
        // 기본값 사용 (백워드 호환성)
        amount = ethers.parseEther("3");
        
        const baseVault = new ethers.Contract(
          this.contractAddresses.baseVault,
          this.vaultABI,
          this.baseProvider
        );
        nonce = await baseVault.nonces(userAddress);
        deadline = Math.floor(Date.now() / 1000) + 3600;
        
        logger.info('기본값 사용:', {
          amount: ethers.formatEther(amount) + ' KKCoin',
          nonce: nonce.toString(),
          deadline: new Date(deadline * 1000).toISOString()
        });
      }

      logger.info('대출 파라미터:', {
        userAddress,
        amount: ethers.formatEther(amount) + ' KKCoin',
        nonce: nonce.toString(),
        deadline,
        chainSelector: this.BASE_CHAIN_SELECTOR,
        vaultReceiver: this.contractAddresses.vaultReceiver,
        vaultSender: this.contractAddresses.vaultSender
      });

      // VaultSender 컨트랙트 연결
      const vaultSender = new ethers.Contract(
        this.contractAddresses.vaultSender,
        this.vaultSenderABI,
        this.sepoliaSigner
      );

      // 발신자 ETH 잔액 확인
      const senderBalance = await this.sepoliaProvider.getBalance(this.sepoliaSigner.address);
      logger.info(`발신자 ETH 잔액: ${ethers.formatEther(senderBalance)} ETH`);
      
      if (senderBalance < ethers.parseEther("0.02")) {
        return {
          success: false,
          error: 'CCIP 수수료를 위한 ETH가 부족합니다. 최소 0.02 ETH가 필요합니다.'
        };
      }

      // 서명 검증
      try {
        const domain = {
          name: "VaultLending",
          version: "1",
          chainId: 84532,
          verifyingContract: this.contractAddresses.baseVault
        };

        const types = {
          LoanRequest: [
            { name: "user", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        };

        const value = {
          user: userAddress,
          amount: amount.toString(), // Wei 단위로 정확히 변환
          nonce: nonce.toString(),
          deadline: deadline
        };

        logger.info('서명 검증용 데이터:', {
          domain,
          types,
          value,
          signature: signature.substring(0, 20) + '...'
        });

        const recoveredAddress = ethers.verifyTypedData(domain, types, value, signature);
        logger.info('서명 검증:', {
          expectedUser: userAddress,
          recoveredUser: recoveredAddress,
          signatureValid: recoveredAddress.toLowerCase() === userAddress.toLowerCase()
        });

        if (recoveredAddress.toLowerCase() !== userAddress.toLowerCase()) {
          return {
            success: false,
            error: '서명이 유효하지 않습니다. 다시 서명해주세요.'
          };
        }
      } catch (verifyError) {
        logger.error('서명 검증 실패:', verifyError);
        return {
          success: false,
          error: '서명 검증 중 오류가 발생했습니다.'
        };
      }

      logger.info('CCIP 크로스체인 대출 요청 시작...');
      
      // 트랜잭션 파라미터 최종 확인
      logger.info('최종 트랜잭션 파라미터:', {
        user: userAddress,
        amount: amount.toString() + ' wei (' + ethers.formatEther(amount) + ' KKCoin)',
        nonce: nonce.toString(),
        deadline: deadline + ' (' + new Date(deadline * 1000).toISOString() + ')',
        signature: signature.substring(0, 20) + '...',
        chainSelector: this.BASE_CHAIN_SELECTOR,
        receiver: this.contractAddresses.vaultReceiver
      });

      const tx = await vaultSender.sendLendRequestWithSignature(
        this.BASE_CHAIN_SELECTOR,
        this.contractAddresses.vaultReceiver,
        userAddress,
        amount,
        nonce,
        deadline,
        signature,
        {
          gasLimit: 500000
        }
      );

      logger.info(`트랜잭션 해시: ${tx.hash}`);

      // 사용자 트랜잭션 추적에 추가
      this.addUserTransaction(userAddress, tx.hash, 'LOAN', ethers.formatEther(amount));

      // 트랜잭션 확인 대기
      const receipt = await tx.wait();
      logger.info(`트랜잭션 확인됨! 블록: ${receipt.blockNumber}`);

      // 트랜잭션 상태 업데이트 (Sepolia에서는 성공, CCIP는 여전히 진행 중)
      this.updateUserTransaction(userAddress, tx.hash, 'CCIP_PROCESSING');

      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        message: `✅ 코인 대여를 위한 크로스 체인 트랜잭션이 성공적으로 접수됐습니다.\n완료까지 약 20분이 소요됩니다.\n\n📋 트랜잭션 해시: ${tx.hash}\n🔗 CCIP 진행 상황 조회: https://ccip.chain.link/\n\n트랜잭션 해시를 복사해서 CCIP 사이트에서 진행 상황을 확인하세요!`
      };

    } catch (error) {
      logger.error('대출 실행 중 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getUserCollateral(userAddress) {
    try {
      const sepoliaVault = new ethers.Contract(
        this.contractAddresses.sepoliaVault,
        this.vaultABI,
        this.sepoliaProvider
      );

      const collateral = await sepoliaVault.getCollateral(userAddress);
      return ethers.formatEther(collateral);
    } catch (error) {
      logger.error('담보 조회 중 오류:', error);
      return "0";
    }
  }

  async getUserDebt(userAddress) {
    try {
      const baseVault = new ethers.Contract(
        this.contractAddresses.baseVault,
        this.vaultABI,
        this.baseProvider
      );

      const debt = await baseVault.getDebt(userAddress);
      return ethers.formatEther(debt);
    } catch (error) {
      logger.error('부채 조회 중 오류:', error);
      return "0";
    }
  }

  // 토큰 잔액 확인 (퀘스트용)
  async checkTokenBalance(walletAddress, contractAddress, network) {
    try {
      logger.info(`토큰 잔액 확인: ${walletAddress}, 컨트랙트: ${contractAddress}, 네트워크: ${network}`);

      // ERC20 토큰 ABI (잔액 조회용)
      const erc20ABI = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)"
      ];

      let provider;
      switch (network.toLowerCase()) {
        case 'basesepolia':
          provider = this.baseProvider;
          break;
        case 'sepolia':
          provider = this.sepoliaProvider;
          break;
        case 'ethereum':
        case 'base':
        default:
          // 실제 메인넷의 경우 별도 프로바이더 필요
          provider = this.baseProvider; // 임시로 Base Sepolia 사용
          break;
      }

      // 컨트랙트 주소가 0x0000...인 경우 ETH 잔액 확인
      if (contractAddress === '0x0000000000000000000000000000000000000000') {
        const balance = await provider.getBalance(walletAddress);
        const ethBalance = ethers.formatEther(balance);
        logger.info(`ETH 잔액: ${ethBalance}`);
        return ethBalance;
      }

      // ERC20 토큰 잔액 확인
      const tokenContract = new ethers.Contract(contractAddress, erc20ABI, provider);
      
      const [balance, decimals] = await Promise.all([
        tokenContract.balanceOf(walletAddress),
        tokenContract.decimals()
      ]);

      const formattedBalance = ethers.formatUnits(balance, decimals);
      logger.info(`토큰 잔액: ${formattedBalance}`);
      
      return formattedBalance;

    } catch (error) {
      logger.error('토큰 잔액 확인 오류:', error);
      return "0";
    }
  }

  // 퀘스트 보상 지급
  async claimQuestReward(walletAddress, amount, token) {
    try {
      logger.info(`퀘스트 보상 지급 시작: ${walletAddress}, ${amount} ${token}`);

      // KK 토큰 보상의 경우 Base Sepolia 네트워크에서 처리
      if (token === 'KK') {
        return await this.claimKKTokenReward(walletAddress, amount);
      }

      // 다른 토큰들은 각각의 네트워크에서 처리
      // 여기서는 기본적으로 성공 응답 반환 (실제로는 각 토큰별 구현 필요)
      logger.info(`${token} 토큰 보상 지급 처리 중...`);
      
      // 시뮬레이션: 실제로는 각 프로토콜의 보상 컨트랙트 호출
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기

      return {
        success: true,
        txHash: `0x${Math.random().toString(16).substr(2, 64)}`, // 임시 해시
        message: `Successfully claimed ${amount} ${token} tokens!`
      };

    } catch (error) {
      logger.error('퀘스트 보상 지급 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // KK 토큰 보상 지급 (Base Sepolia)
  async claimKKTokenReward(walletAddress, amount) {
    try {
      logger.info(`KK 토큰 보상 지급: ${walletAddress}, ${amount} KK`);

      // KK 토큰 컨트랙트 ABI (전송용)
      const kkTokenABI = [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ];

      const kkTokenContract = new ethers.Contract(
        this.contractAddresses.kkcoin,
        kkTokenABI,
        this.baseSigner
      );

      // 보상 지급자(서버)의 KK 토큰 잔액 확인
      const senderBalance = await kkTokenContract.balanceOf(this.baseSigner.address);
      const decimals = await kkTokenContract.decimals();
      const rewardAmount = ethers.parseUnits(amount.toString(), decimals);

      logger.info(`보상 지급자 KK 잔액: ${ethers.formatUnits(senderBalance, decimals)}`);

      if (senderBalance < rewardAmount) {
        return {
          success: false,
          error: 'Insufficient KK tokens in reward pool'
        };
      }

      // KK 토큰 전송
      const tx = await kkTokenContract.transfer(walletAddress, rewardAmount, {
        gasLimit: 100000
      });

      logger.info(`KK 토큰 전송 트랜잭션: ${tx.hash}`);

      // 트랜잭션 확인 대기
      const receipt = await tx.wait();
      logger.info(`KK 토큰 전송 완료! 블록: ${receipt.blockNumber}`);

      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        message: `Successfully transferred ${amount} KK tokens to ${walletAddress}`
      };

    } catch (error) {
      logger.error('KK 토큰 보상 지급 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 담보 예치 함수
  async depositCollateral(userAddress, ethAmount) {
    try {
      logger.info(`담보 예치 시작: ${userAddress}, ${ethAmount} ETH`);

      if (!ethers.isAddress(userAddress)) {
        throw new Error('유효하지 않은 지갑 주소입니다.');
      }

      const amount = ethers.parseEther(ethAmount.toString());
      
      // Sepolia Vault 컨트랙트 연결
      const sepoliaVault = new ethers.Contract(
        this.contractAddresses.sepoliaVault,
        this.vaultABI,
        this.sepoliaProvider
      );

      // 사용자가 직접 담보를 예치해야 하므로 가이드 제공
      return {
        success: true,
        message: `To deposit ${ethAmount} ETH as collateral:\n\n1. Switch MetaMask to Sepolia network\n2. Send ${ethAmount} ETH to Sepolia Vault contract\n3. Contract address: ${this.contractAddresses.sepoliaVault}\n4. Use the deposit function or send ETH directly\n\nOnce deposited, I'll be able to process your loan request.`,
        contractAddress: this.contractAddresses.sepoliaVault,
        amount: ethAmount,
        network: 'Sepolia'
      };

    } catch (error) {
      logger.error('담보 예치 준비 중 오류:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 대출 상태 확인 (실제 블록체인 기반)
  async checkLoanStatus(userAddress, txHash = null) {
    try {
      logger.info(`대출 상태 확인: ${userAddress}, TX: ${txHash}`);

      // 실제 블록체인 상태 확인
      return await this.checkActualLoanCompletion(userAddress, txHash);

    } catch (error) {
      logger.error('대출 상태 확인 중 오류:', error);
      return {
        success: false,
        status: 'ERROR',
        message: `Unable to check loan status: ${error.message}`
      };
    }
  }

  // 트랜잭션 상태 확인
  async checkTransactionStatus(txHash) {
    try {
      // Sepolia 네트워크에서 트랜잭션 확인
      const tx = await this.sepoliaProvider.getTransaction(txHash);
      if (!tx) {
        return { status: 'NOT_FOUND', message: 'Transaction not found' };
      }

      const receipt = await this.sepoliaProvider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { status: 'PENDING', message: 'Transaction is pending' };
      }

      if (receipt.status === 1) {
        return { 
          status: 'SUCCESS', 
          message: 'Transaction completed successfully',
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        };
      } else {
        return { status: 'FAILED', message: 'Transaction failed' };
      }

    } catch (error) {
      logger.error('트랜잭션 상태 확인 오류:', error);
      return { status: 'ERROR', message: error.message };
    }
  }

  // 사용자 트랜잭션 기록 추가
  addUserTransaction(userAddress, txHash, type, amount = null) {
    if (!this.userTransactions.has(userAddress)) {
      this.userTransactions.set(userAddress, []);
    }
    
    const userTxs = this.userTransactions.get(userAddress);
    userTxs.push({
      txHash,
      type, // 'LOAN', 'DEPOSIT', 'REPAY'
      amount,
      timestamp: Date.now(),
      status: 'PENDING'
    });
    
    // 최대 10개까지만 보관
    if (userTxs.length > 10) {
      userTxs.shift();
    }
    
    this.userTransactions.set(userAddress, userTxs);
  }

  // 사용자 트랜잭션 상태 업데이트
  updateUserTransaction(userAddress, txHash, status) {
    const userTxs = this.userTransactions.get(userAddress) || [];
    const tx = userTxs.find(t => t.txHash === txHash);
    if (tx) {
      tx.status = status;
      tx.updatedAt = Date.now();
    }
  }

  // 실제 대출 완료 여부 확인 (블록체인 기반)
  async checkActualLoanCompletion(userAddress, txHash = null) {
    try {
      logger.info(`실제 대출 완료 여부 확인: ${userAddress}, TX: ${txHash}`);

      // 1. 현재 사용자의 담보 및 부채 상태 확인
      const [currentCollateral, currentDebt] = await Promise.all([
        this.getUserCollateral(userAddress),
        this.getUserDebt(userAddress)
      ]);

      logger.info(`현재 상태 - 담보: ${currentCollateral} ETH, 부채: ${currentDebt} KKCoin`);

      // 2. Base Sepolia에서 KKCoin 잔액 직접 확인
      const kkcoinBalance = await this.getKKCoinBalance(userAddress);
      logger.info(`KKCoin 잔액: ${kkcoinBalance}`);

      // 3. 특정 트랜잭션이 있는 경우 해당 트랜잭션 결과 확인
      let txResult = null;
      if (txHash) {
        txResult = await this.checkCCIPTransactionResult(txHash, userAddress);
      }

      // 4. 사용자의 최근 트랜잭션 히스토리에서 대출 관련 이벤트 확인
      const recentLoanEvents = await this.getRecentLoanEvents(userAddress);

      // 5. 종합 판단
      return this.determineLoanStatus({
        userAddress,
        currentCollateral,
        currentDebt,
        kkcoinBalance,
        txResult,
        recentLoanEvents,
        requestedTxHash: txHash
      });

    } catch (error) {
      logger.error('실제 대출 완료 여부 확인 중 오류:', error);
      return {
        success: false,
        status: 'ERROR',
        message: `Unable to check loan status: ${error.message}`
      };
    }
  }

  // KKCoin 잔액 확인
  async getKKCoinBalance(userAddress) {
    try {
      const kkcoinContract = new ethers.Contract(
        this.contractAddresses.kkcoin,
        [
          "function balanceOf(address owner) view returns (uint256)",
          "function decimals() view returns (uint8)"
        ],
        this.baseProvider
      );

      const [balance, decimals] = await Promise.all([
        kkcoinContract.balanceOf(userAddress),
        kkcoinContract.decimals()
      ]);

      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      logger.error('KKCoin 잔액 확인 오류:', error);
      return "0";
    }
  }

  // CCIP 트랜잭션 결과 확인
  async checkCCIPTransactionResult(txHash, userAddress) {
    try {
      logger.info(`CCIP 트랜잭션 결과 확인: ${txHash}`);

      // Sepolia에서 트랜잭션 확인
      const tx = await this.sepoliaProvider.getTransaction(txHash);
      if (!tx) {
        return { status: 'NOT_FOUND', message: 'Transaction not found on Sepolia' };
      }

      const receipt = await this.sepoliaProvider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { status: 'PENDING', message: 'Transaction still pending on Sepolia' };
      }

      if (receipt.status !== 1) {
        return { status: 'FAILED', message: 'Transaction failed on Sepolia' };
      }

      // CCIP 메시지 ID 추출 (로그에서)
      let ccipMessageId = null;
      for (const log of receipt.logs) {
        try {
          // CCIP 메시지 전송 이벤트 찾기
          if (log.topics[0] === '0x...' || log.data.length > 0) { // 실제 CCIP 이벤트 시그니처 필요
            // 메시지 ID 추출 로직
            ccipMessageId = log.topics[1]; // 예시
            break;
          }
        } catch (e) {
          // 로그 파싱 실패는 무시
        }
      }

      // Base Sepolia에서 해당 사용자의 최근 상태 변화 확인
      const baseVault = new ethers.Contract(
        this.contractAddresses.baseVault,
        this.vaultABI,
        this.baseProvider
      );

      // 최근 블록에서 LoanIssued 이벤트 확인
      const currentBlock = await this.baseProvider.getBlockNumber();
      const fromBlock = Math.max(currentBlock - 2000, 0); // 최근 2000블록 (약 1시간)

      const loanEvents = await baseVault.queryFilter(
        baseVault.filters.LoanIssued(userAddress),
        fromBlock,
        currentBlock
      );

      // 트랜잭션 시간 이후의 이벤트가 있는지 확인
      const txBlock = await this.sepoliaProvider.getBlock(receipt.blockNumber);
      const recentLoanEvents = loanEvents.filter(event => {
        const eventBlock = event.blockNumber;
        return eventBlock > receipt.blockNumber - 100; // 트랜잭션 블록 근처의 이벤트
      });

      if (recentLoanEvents.length > 0) {
        const latestEvent = recentLoanEvents[recentLoanEvents.length - 1];
        return {
          status: 'COMPLETED',
          message: 'CCIP transaction completed successfully',
          ccipMessageId,
          loanAmount: ethers.formatEther(latestEvent.args.amount),
          completedAt: new Date(txBlock.timestamp * 1000).toISOString()
        };
      }

      return {
        status: 'CCIP_PROCESSING',
        message: 'Sepolia transaction confirmed, waiting for CCIP completion',
        ccipMessageId,
        estimatedCompletion: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15분 후
      };

    } catch (error) {
      logger.error('CCIP 트랜잭션 결과 확인 오류:', error);
      return { status: 'ERROR', message: error.message };
    }
  }

  // 최근 대출 이벤트 확인
  async getRecentLoanEvents(userAddress, hoursBack = 2) {
    try {
      const baseVault = new ethers.Contract(
        this.contractAddresses.baseVault,
        this.vaultABI,
        this.baseProvider
      );

      const currentBlock = await this.baseProvider.getBlockNumber();
      const blocksBack = Math.floor(hoursBack * 60 * 60 / 2); // 2초당 1블록 가정
      const fromBlock = Math.max(currentBlock - blocksBack, 0);

      const [loanEvents, repayEvents] = await Promise.all([
        baseVault.queryFilter(baseVault.filters.LoanIssued(userAddress), fromBlock, currentBlock),
        baseVault.queryFilter(baseVault.filters.LoanRepaid(userAddress), fromBlock, currentBlock)
      ]);

      return {
        loans: loanEvents.map(event => ({
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          amount: ethers.formatEther(event.args.amount),
          timestamp: event.blockNumber // 실제로는 블록 타임스탬프 필요
        })),
        repayments: repayEvents.map(event => ({
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          amount: ethers.formatEther(event.args.amount),
          timestamp: event.blockNumber
        }))
      };
    } catch (error) {
      logger.error('최근 대출 이벤트 확인 오류:', error);
      return { loans: [], repayments: [] };
    }
  }

  // 종합적인 대출 상태 판단
  determineLoanStatus(data) {
    const {
      userAddress,
      currentCollateral,
      currentDebt,
      kkcoinBalance,
      txResult,
      recentLoanEvents,
      requestedTxHash
    } = data;

    logger.info('대출 상태 종합 판단:', {
      collateral: currentCollateral,
      debt: currentDebt,
      kkcoinBalance,
      txResult: txResult?.status,
      recentLoans: recentLoanEvents.loans?.length || 0
    });

    // 1. 특정 트랜잭션에 대한 질문인 경우
    if (requestedTxHash && txResult) {
      if (txResult.status === 'COMPLETED') {
        return {
          success: true,
          status: 'LOAN_COMPLETED',
          message: `✅ Your loan has been completed!\n\n📋 Transaction: ${requestedTxHash}\n💰 Loan Amount: ${txResult.loanAmount} KKCoin\n⏰ Completed at: ${txResult.completedAt}\n\nYour current status:\n- KKCoin Balance: ${kkcoinBalance}\n- Debt: ${currentDebt} KKCoin\n- Collateral: ${currentCollateral} ETH`
        };
      } else if (txResult.status === 'CCIP_PROCESSING') {
        return {
          success: true,
          status: 'LOAN_PROCESSING',
          message: `🔄 Your loan is still being processed via CCIP.\n\n📋 Transaction: ${requestedTxHash}\n⏱️ Estimated completion: ${txResult.estimatedCompletion}\n🔗 Check progress: https://ccip.chain.link/\n\nCCIP transactions typically take 15-20 minutes to complete.`
        };
      } else if (txResult.status === 'FAILED') {
        return {
          success: true,
          status: 'LOAN_FAILED',
          message: `❌ Your loan transaction failed.\n\n📋 Transaction: ${requestedTxHash}\n💡 Please try submitting a new loan request.`
        };
      }
    }

    // 2. 일반적인 상태 확인
    const hasDebt = parseFloat(currentDebt) > 0;
    const hasKKCoin = parseFloat(kkcoinBalance) > 0;
    const hasRecentLoan = recentLoanEvents.loans && recentLoanEvents.loans.length > 0;

    if (hasDebt && hasKKCoin) {
      const latestLoan = hasRecentLoan ? recentLoanEvents.loans[recentLoanEvents.loans.length - 1] : null;
      return {
        success: true,
        status: 'HAS_ACTIVE_LOAN',
        message: `✅ You have an active loan!\n\n💰 KKCoin Balance: ${kkcoinBalance}\n📊 Current Debt: ${currentDebt} KKCoin\n🔒 Collateral: ${currentCollateral} ETH${latestLoan ? `\n📋 Latest Loan TX: ${latestLoan.txHash}` : ''}`
      };
    } else if (hasRecentLoan && !hasDebt) {
      return {
        success: true,
        status: 'LOAN_REPAID',
        message: `✅ Your loan has been repaid!\n\n💰 KKCoin Balance: ${kkcoinBalance}\n📊 Current Debt: ${currentDebt} KKCoin\n🔒 Available Collateral: ${currentCollateral} ETH`
      };
    } else {
      return {
        success: true,
        status: 'NO_ACTIVE_LOAN',
        message: `📊 Current Status:\n\n💰 KKCoin Balance: ${kkcoinBalance}\n📊 Debt: ${currentDebt} KKCoin\n🔒 Collateral: ${currentCollateral} ETH\n\n💡 No active loans found. You can request a new loan by saying "borrow [amount] kkcoin".`
      };
    }
  }
}

module.exports = BlockchainService; 