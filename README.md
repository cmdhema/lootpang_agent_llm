# LootPang LLM Agent

LootPang 크로스체인 대출 시스템의 백엔드 AI 에이전트입니다.

## 기능

- 🤖 Google Gemini를 사용한 자연어 처리
- 🔗 WebSocket을 통한 실시간 통신
- 🌉 크로스체인 대출 처리 (Sepolia ↔ Base Sepolia)
- ✍️ EIP-712 서명 생성 및 처리
- 📊 블록체인 상태 조회

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 설정하세요:

```bash
cp env.example .env
```

### 3. 환경 변수 값 설정

- `GEMINI_API_KEY`: Google Gemini API 키
- `SEPOLIA_RPC_URL`: Sepolia RPC URL
- `BASESEPOLIA_RPC_URL`: Base Sepolia RPC URL
- `SEPOLIA_PRIVATE_KEY`: Sepolia 네트워크 개인키
- `BASESEPOLIA_PRIVATE_KEY`: Base Sepolia 네트워크 개인키
- 컨트랙트 주소들 (vault 폴더의 .env 파일 참조)

### 4. 서버 실행

```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

## API

### WebSocket 이벤트

#### 클라이언트 → 서버

- `join`: 룸 참여
- `message`: 메시지 전송

#### 서버 → 클라이언트

- `messageBroadcast`: 메시지 브로드캐스트
- `error`: 에러 메시지

### HTTP 엔드포인트

- `GET /health`: 서버 상태 확인

## 사용법

### 대출 요청

클라이언트에서 다음과 같은 메시지를 전송:

```
borrow 3 kkcoin
```

에이전트가 EIP-712 서명 데이터를 생성하여 응답합니다.

### 서명 처리

클라이언트에서 MetaMask 서명 후 서명 데이터를 전송하면, 에이전트가 크로스체인 대출을 실행합니다.

## 프로젝트 구조

```
src/
├── index.js              # 메인 서버 파일
├── services/
│   ├── llmAgent.js       # Google Gemini LLM 서비스
│   └── blockchainService.js # 블록체인 상호작용 서비스
└── utils/
    └── logger.js         # 로깅 유틸리티
```

## 개발

### 로그 확인

로그는 `logs/` 폴더에 저장됩니다:

- `logs/error.log`: 에러 로그
- `logs/combined.log`: 전체 로그

개발 모드에서는 콘솔에도 로그가 출력됩니다.

### 테스트

```bash
npm test
```

## 라이센스

MIT 