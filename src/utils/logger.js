const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'lootpang-llm-agent' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// 모든 환경에서 콘솔에 로그를 출력하도록 설정합니다.
// 단, 프로덕션 환경에서는 색상 코드 없이 간단한 포맷으로 출력하고,
// 개발 환경에서는 색상을 포함하여 가독성을 높입니다.
logger.add(new winston.transports.Console({
  format: winston.format.combine(
    process.env.NODE_ENV === 'production' 
      ? winston.format.uncolorize() 
      : winston.format.colorize(),
    winston.format.simple()
  )
}));

module.exports = logger; 