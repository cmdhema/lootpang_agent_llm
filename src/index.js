console.log('--- Lootpang Agent 서버 스크립트 시작 ---');
console.log(`현재 시간: ${new Date().toISOString()}`);
console.log(`Node.js 버전: ${process.version}`);
console.log(`현재 작업 디렉토리: ${process.cwd()}`);
console.log(`실행 환경(NODE_ENV): ${process.env.NODE_ENV}`);

console.log('[디버그] 1. 기본 모듈 require 시작');
require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
console.log('[디버그] 1. 기본 모듈 require 완료');

console.log('[디버그] 2. 커스텀 모듈 require 시작');
const logger = require('./utils/logger');
const LLMAgent = require('./services/llmAgent');
const BlockchainService = require('./services/blockchainService');
const initializeSocket = require('./services/socketService');
const apiRoutes = require('./routes');
console.log('[디버그] 2. 커스텀 모듈 require 완료');

console.log('[디버그] 3. Express 앱 생성');
const app = express();

// HTTPS 설정
let server;
const useHttps = process.env.NODE_ENV === 'production';
console.log(`[디버그] 4. 서버 생성 시작 (HTTPS: ${useHttps})`);

if (useHttps) {
  const sslKeyPath = process.env.SSL_KEY_PATH;
  const sslCertPath = process.env.SSL_CERT_PATH;
  
  if (!sslKeyPath || !sslCertPath) {
    console.error('오류: 프로덕션 모드(HTTPS)에서는 SSL_KEY_PATH와 SSL_CERT_PATH 환경 변수가 반드시 필요합니다.');
    process.exit(1);
  }

  try {
    console.log('[디버그] SSL 인증서 파일 읽기 시도...');
    const privateKey = fs.readFileSync(path.resolve(sslKeyPath), 'utf8');
    const certificate = fs.readFileSync(path.resolve(sslCertPath), 'utf8');
    console.log('[디버그] SSL 인증서 파일 읽기 성공.');
    
    const credentials = { key: privateKey, cert: certificate };
    server = https.createServer(credentials, app);
    logger.info('HTTPS 서버로 시작됩니다.');
  } catch (error) {
    console.error('오류: SSL 인증서 파일을 읽는 데 실패했습니다. 경로를 확인하세요:', error.message);
    process.exit(1);
  }
} else {
  server = http.createServer(app);
  logger.info('HTTP 서버로 시작됩니다.');
}
console.log('[디버그] 4. 서버 생성 완료');

console.log('[디버그] 5. Socket.IO 생성 및 CORS 설정 시작');
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});
console.log('[디버그] 5. Socket.IO 생성 및 CORS 설정 완료');

console.log('[디버그] 6. 미들웨어 설정 시작');
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100개 요청
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
console.log('[디버그] 6. 미들웨어 설정 완료');

console.log('[디버그] 7. 서비스 초기화 시작');
const llmAgent = new LLMAgent();
const blockchainService = new BlockchainService();
console.log('[디버그] 7. 서비스 초기화 완료');

console.log('[디버그] 8. API 라우트 설정 시작');
app.use('/api', apiRoutes);
console.log('[디버그] 8. API 라우트 설정 완료');

console.log('[디버그] 9. Socket.IO 초기화 시작');
initializeSocket(io, llmAgent, blockchainService);
console.log('[디버그] 9. Socket.IO 초기화 완료');

// 서버 시작
const PORT = process.env.PORT || 4000;
console.log(`[디버그] 10. 서버 리스닝 시작 (Port: ${PORT})`);
server.listen(PORT, () => {
  console.log(`[디버그] 서버가 성공적으로 포트 ${PORT}에서 리스닝을 시작했습니다.`);
  logger.info(`${useHttps ? 'HTTPS' : 'HTTP'} 서버가 포트 ${PORT}에서 실행 중입니다.`);
}); 