require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const fs = require('fs');
const path = require('path');

// 환경 변수 설정
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION_STRING = process.env.TELEGRAM_SESSION || '';

// 설정 파일 로드 함수
function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'channels_config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        console.log('✅ 설정 파일 로드 성공');
        return config;
    } catch (error) {
        console.error('❌ 설정 파일 로드 실패:', error.message);
        console.log('💡 channels_config.json 파일이 존재하는지 확인하세요.');
        process.exit(1);
    }
}

// 설정 파일 저장 함수
function saveConfig(config) {
    try {
        const configPath = path.join(__dirname, 'channels_config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log('✅ 설정 파일 저장 완료');
    } catch (error) {
        console.error('❌ 설정 파일 저장 실패:', error.message);
    }
}

// 설정 로드
const CONFIG = loadConfig();
const TARGET_CHANNELS = CONFIG.targetChannels;
const MY_NOTIFICATION_CHANNEL = CONFIG.notificationChannel;
const KEYWORDS = CONFIG.keywords;
const SETTINGS = CONFIG.settings;

if (!API_ID || !API_HASH) {
    console.error('❌ TELEGRAM_API_ID와 TELEGRAM_API_HASH를 .env 파일에 설정해주세요.');
    console.log('📱 https://my.telegram.org/apps 에서 API 키를 발급받으세요.');
    process.exit(1);
}

console.log('🚀 텔레그램 사용자 클라이언트 시작 중...');
console.log(`📊 모니터링 대상 채널 수: ${TARGET_CHANNELS.length}개`);
console.log(`🔍 키워드 수: ${KEYWORDS.length}개`);
console.log(`⚙️ 설정: 키워드필터=${SETTINGS.enableKeywordFilter}, 포워딩=${SETTINGS.enableForwarding}, 전체로그=${SETTINGS.logAllMessages}`);

// 채널 추가 헬퍼 함수 (JSON 파일에 저장)
function addChannel(username, id, name) {
    const newChannel = {
        username: username,
        id: id,
        name: name
    };
    
    TARGET_CHANNELS.push(newChannel);
    CONFIG.targetChannels = TARGET_CHANNELS;
    saveConfig(CONFIG);
    
    console.log(`➕ 채널 추가됨: ${name} (@${username})`);
}

// 채널 제거 헬퍼 함수 (JSON 파일에서도 제거)
function removeChannel(username) {
    const index = TARGET_CHANNELS.findIndex(ch => ch.username === username);
    if (index > -1) {
        const removed = TARGET_CHANNELS.splice(index, 1)[0];
        CONFIG.targetChannels = TARGET_CHANNELS;
        saveConfig(CONFIG);
        
        console.log(`➖ 채널 제거됨: ${removed.name} (@${removed.username})`);
        return true;
    }
    return false;
}

// 설정 업데이트 헬퍼 함수
function updateSettings(newSettings) {
    CONFIG.settings = { ...CONFIG.settings, ...newSettings };
    saveConfig(CONFIG);
    console.log('⚙️ 설정 업데이트됨');
}

// 키워드 추가/제거 함수
function addKeyword(keyword) {
    if (!KEYWORDS.includes(keyword)) {
        KEYWORDS.push(keyword);
        CONFIG.keywords = KEYWORDS;
        saveConfig(CONFIG);
        console.log(`🔍 키워드 추가됨: "${keyword}"`);
    }
}

function removeKeyword(keyword) {
    const index = KEYWORDS.indexOf(keyword);
    if (index > -1) {
        KEYWORDS.splice(index, 1);
        CONFIG.keywords = KEYWORDS;
        saveConfig(CONFIG);
        console.log(`🗑️ 키워드 제거됨: "${keyword}"`);
        return true;
    }
    return false;
}

// 알림 메시지 전송 함수
async function sendNotification(originalMessage, messageText, sourceChannel) {
    try {
        const messageDate = new Date(originalMessage.date * 1000);
        
        // 알림 메시지 포맷 생성
        const notificationText = `
🚨 **New Forwarded Airdrop Message!**

📺 **Origin Channel**: ${sourceChannel.name} (@${sourceChannel.username})

📝 **Contents**:
${messageText}
        `.trim();

        // 채널로 전송 (MY_NOTIFICATION_CHANNEL 사용)
        if (MY_NOTIFICATION_CHANNEL) {
            await client.sendMessage(MY_NOTIFICATION_CHANNEL.username, {
                message: notificationText,
                parseMode: 'md'  // 마크다운 형식
            });
            console.log(`✅ 알림 전송 완료: ${MY_NOTIFICATION_CHANNEL.name}`);
        }
        
        // 개인 메시지로 전송 (MY_USER_ID 사용 - 주석 해제 시)
        // if (MY_USER_ID) {
        //     await client.sendMessage(MY_USER_ID, {
        //         message: notificationText,
        //         parseMode: 'md'
        //     });
        //     console.log(`✅ 개인 메시지 전송 완료`);
        // }

    } catch (error) {
        console.error('❌ 알림 전송 실패:', error.message);
    }
}

// 원본 메시지 포워드 함수 (선택사항)
async function forwardMessage(originalMessage, sourceChannel) {
    try {
        // 채널로 포워드
        if (MY_NOTIFICATION_CHANNEL) {
            await client.forwardMessages(MY_NOTIFICATION_CHANNEL.username, {
                messages: [originalMessage.id],
                fromPeer: sourceChannel.username
            });
            console.log(`✅ 메시지 포워드 완료: ${MY_NOTIFICATION_CHANNEL.name}`);
        }
        
        // 개인으로 포워드 (주석 해제 시)
        // if (MY_USER_ID) {
        //     await client.forwardMessages(MY_USER_ID, {
        //         messages: [originalMessage.id],
        //         fromPeer: sourceChannel.username
        //     });
        //     console.log(`✅ 개인 메시지 포워드 완료`);
        // }

    } catch (error) {
        console.error('❌ 메시지 포워드 실패:', error.message);
    }
}

// 세션 문자열이 있으면 사용, 없으면 새 세션 생성
let stringSession;
if (SESSION_STRING && SESSION_STRING.trim()) {
    console.log('💾 기존 세션 사용 중...');
    stringSession = new StringSession(SESSION_STRING);
} else {
    console.log('🆕 새 세션 생성 중...');
    stringSession = new StringSession();
}

const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
});

async function startMonitoring() {
    try {
        console.log('🔐 텔레그램에 로그인 중...');
        
        await client.start({
            phoneNumber: async () => await input.text('전화번호를 입력하세요 (+8210xxxxxxxx): '),
            password: async () => await input.text('2단계 인증 비밀번호 (있는 경우): '),
            phoneCode: async () => await input.text('인증 코드를 입력하세요: '),
            onError: (err) => console.error('❌ 로그인 오류:', err),
        });

        console.log('✅ 로그인 성공!');
        
        // 세션 문자열 저장 (다음번엔 로그인 불필요)
        console.log('💾 세션 문자열 (다음번 사용을 위해 .env에 저장하세요):');
        console.log('TELEGRAM_SESSION=' + client.session.save());
        
        // 모든 타겟 채널 정보 가져오기
        console.log(`\n📺 모니터링할 채널 정보:`);
        for (const channelInfo of TARGET_CHANNELS) {
            try {
                const channel = await client.getEntity(channelInfo.username);
                console.log(`✅ ${channelInfo.name}: ${channel.title} (ID: ${channel.id})`);
                // 실제 채널 ID 업데이트 (필요한 경우)
                channelInfo.actualId = channel.id; 
            } catch (error) {
                console.error(`❌ ${channelInfo.name} 정보 가져오기 실패:`, error.message);
            }
        }
        
        // 알림 채널 정보 확인
        console.log(`\n🔔 알림 채널 정보:`);
        try {
            if (MY_NOTIFICATION_CHANNEL) {
                const notificationChannel = await client.getEntity(MY_NOTIFICATION_CHANNEL.username);
                console.log(`✅ ${MY_NOTIFICATION_CHANNEL.name}: ${notificationChannel.title} (ID: ${notificationChannel.id})`);
            }
            // if (MY_USER_ID) {
            //     const user = await client.getEntity(MY_USER_ID);
            //     console.log(`✅ 개인 메시지: ${user.firstName} ${user.lastName || ''} (ID: ${user.id})`);
            // }
        } catch (error) {
            console.error(`❌ 알림 채널 정보 가져오기 실패:`, error.message);
            console.log(`⚠️ 알림 기능이 작동하지 않을 수 있습니다. 설정을 확인하세요.`);
        }
        
        // 실시간 메시지 감지
        console.log('👂 새로운 메시지 감지 시작...');
        
        // NewMessage 이벤트 핸들러 등록 (여러 채널 지원)
        async function handleNewMessage(event) {
            try {
                const message = event.message;
                const messageText = message.message || '[미디어 메시지]';
                const messageDate = new Date(message.date * 1000);
                
                // 채널 ID 확인
                const peerId = message.peerId;
                let channelId = null;
                
                if (peerId && peerId.channelId) {
                    // 채널 ID를 Bot API 형식으로 변환
                    channelId = -1000000000000 - peerId.channelId;
                }
                
                // 모니터링 대상 채널인지 확인
                const targetChannel = TARGET_CHANNELS.find(ch => ch.id === channelId);
                
                if (targetChannel) {
                    console.log(`\n🆕 새로운 메시지 감지! [${targetChannel.name}]`);
                    console.log(`📺 채널: ${targetChannel.name} (${targetChannel.username})`);
                    console.log(`⏰ 시간: ${messageDate.toLocaleString()}`);
                    console.log(`📝 내용: ${messageText.substring(0, 200)}${messageText.length > 200 ? '...' : ''}`);
                    console.log(`🔗 메시지 ID: ${message.id}`);
                    console.log(`🆔 채널 ID: ${channelId}`);
                    
                    // 미디어 타입 확인
                    if (message.media) {
                        console.log(`📎 미디어 타입: ${message.media.className}`);
                    }
                    
                    // 여기에 메시지 처리 로직 추가
                    await processMessage(message, messageText, targetChannel);
                } else {
                    // 모니터링 대상이 아닌 채널의 메시지는 간단히 로그만
                    console.log(`📨 다른 채널 메시지: ${channelId}`);
                }
            } catch (error) {
                console.error('❌ 이벤트 처리 오류:', error);
            }
        }
        
        // NewMessage 이벤트 핸들러 등록
        client.addEventHandler(handleNewMessage, new NewMessage({}));
        
        console.log('✅ 모니터링 시작됨. Ctrl+C로 종료하세요.');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error);
        process.exit(1);
    }
}

// 메시지에서 URL 추출 함수
function extractUrls(text, entities = []) {
    const urls = [];
    
    // entities에서 URL 추출 (텔레그램 메시지 엔티티 사용)
    if (entities && entities.length > 0) {
        for (const entity of entities) {
            if (entity.type === 'url' || entity.type === 'text_link') {
                const url = entity.type === 'url' 
                    ? text.substring(entity.offset, entity.offset + entity.length)
                    : entity.url;
                urls.push(url);
            }
        }
    }
    
    // 정규식으로도 한 번 더 체크 (엔티티로 감지되지 않은 URL이 있을 수 있음)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex) || [];
    
    // 중복 제거
    return [...new Set([...urls, ...matches])];
}

async function processMessage(message, messageText, channelInfo) {
    try {
        // 메시지 분석 및 처리 로직
        console.log(`🔄 메시지 처리 중... [${channelInfo.name}]`);
        
        // JSON 파일에서 로드한 키워드로 감지
        const hasKeyword = SETTINGS.enableKeywordFilter ? 
            KEYWORDS.some(keyword => 
                messageText.toLowerCase().includes(keyword.toLowerCase())
            ) : true; // 키워드 필터가 비활성화되면 모든 메시지 처리
        
        if (hasKeyword) {
            if (SETTINGS.enableKeywordFilter) {
                const detectedKeywords = KEYWORDS.filter(k => 
                    messageText.toLowerCase().includes(k.toLowerCase())
                );
                console.log(`🎯 키워드 감지됨! [${channelInfo.name}]`);
                console.log(`📍 감지된 키워드: ${detectedKeywords.join(', ')}`);
            } else {
                console.log(`📢 모든 메시지 처리 모드 [${channelInfo.name}]`);
            }
            
            // 채널별 다른 처리 로직 적용 가능
            switch (channelInfo.username) {
                case 'airdropinspector':
                    console.log('🔍 Airdrop Inspector 채널 특별 처리');
                    break;
                case 'AirdropDetective':
                    console.log('🕵️ Airdrop Detective 채널 특별 처리');
                    break;
                case 'Airdrop':
                    console.log('🎁 Airdrop 채널 특별 처리');
                    break;
                default:
                    console.log('🔄 일반 처리');
                    break;
            }
            
            // 링크 추출 및 처리
            const entities = message.entities || [];
            const urls = extractUrls(messageText, entities);
            
            if (urls.length > 0) {
                console.log(`🔗 발견된 링크: ${urls.join(', ')}`);
                
                // 링크만 별도로 전송
                const linkMessage = `🔗 *링크*:\n${urls.join('\n')}`;
                await sendNotification({ ...message, text: linkMessage }, linkMessage, channelInfo);
                
                // 원본 메시지에서 링크 제거 (선택사항)
                // let cleanText = messageText;
                // urls.forEach(url => {
                //     cleanText = cleanText.replace(url, '').trim();
                // });
                // messageText = cleanText;
            }
            
            // 🚨 알림 전송 실행 (원본 메시지)
            await sendNotification(message, messageText, channelInfo);
            
            // 📤 원본 메시지 포워드 (설정에 따라)
            if (SETTINGS.enableForwarding) {
                await forwardMessage(message, channelInfo);
            }
            
            // 여기에 추가 처리 로직 (저장, 웹훅 호출 등)
            // 예: 데이터베이스 저장, 웹훅 호출, 파일 저장 등
        } else if (SETTINGS.logAllMessages) {
            console.log(`📝 키워드 미감지 메시지 [${channelInfo.name}]: ${messageText.substring(0, 50)}...`);
        }
        
    } catch (error) {
        console.error('❌ 메시지 처리 오류:', error);
    }
}

// 종료 처리
process.on('SIGINT', async () => {
    console.log('\n🛑 프로그램 종료 중...');
    try {
        await client.disconnect();
        console.log('✅ 연결 종료됨');
    } catch (error) {
        console.error('❌ 종료 오류:', error);
    }
    process.exit(0);
});

// 시작
startMonitoring().catch(console.error); 