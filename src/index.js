const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const LLMAgent = require('./services/llmAgent');
const BlockchainService = require('./services/blockchainService');
const initializeSocket = require('./services/socketService');
const apiRoutes = require('./routes');

const app = express();

// HTTPS 설정
let server;
const useHttps = process.env.NODE_ENV === 'production';

if (useHttps) {
  const sslKeyPath = process.env.SSL_KEY_PATH;
  const sslCertPath = process.env.SSL_CERT_PATH;
  
  if (!sslKeyPath || !sslCertPath) {
    console.error('오류: 프로덕션 모드(HTTPS)에서는 SSL_KEY_PATH와 SSL_CERT_PATH 환경 변수가 반드시 필요합니다.');
    console.error('로컬에서 테스트하려면 `npm run dev`를 사용하세요.');
    process.exit(1);
  }

  try {
    const privateKey = fs.readFileSync(path.resolve(sslKeyPath), 'utf8');
    const certificate = fs.readFileSync(path.resolve(sslCertPath), 'utf8');
    
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
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100개 요청
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 서비스 초기화
const llmAgent = new LLMAgent();
const blockchainService = new BlockchainService();

// API 라우트 설정
app.use('/api', apiRoutes);

// Socket.IO 초기화
initializeSocket(io, llmAgent, blockchainService);

// 서버 시작
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`${useHttps ? 'HTTPS' : 'HTTP'} 서버가 포트 ${PORT}에서 실행 중입니다.`);
}); 