import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { CredAnalyzer } from "../_shared/credential-analyzer.ts";
// 환경 변수
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GALXE_ACCESS_TOKEN = Deno.env.get('GALXE_ACCESS_TOKEN');
// Supabase 클라이언트 (service role key 사용)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// Galxe API 설정
const GALXE_API_URL = 'https://graphigo.prd.galaxy.eco/query';
const GALXE_API_HEADERS = {
  'Content-Type': 'application/json',
  "access-token": GALXE_ACCESS_TOKEN
};
// Rate limiting
class RateLimiter {
  requestTimes5min = [];
  requestTimes60min = [];
  limit5min = 1500;
  limit60min = 10000;
  canMakeRequest() {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const sixtyMinAgo = now - 60 * 60 * 1000;
    // 5분 윈도우 정리
    this.requestTimes5min = this.requestTimes5min.filter((time)=>time > fiveMinAgo);
    // 60분 윈도우 정리  
    this.requestTimes60min = this.requestTimes60min.filter((time)=>time > sixtyMinAgo);
    return this.requestTimes5min.length < this.limit5min && this.requestTimes60min.length < this.limit60min;
  }
  recordRequest() {
    const now = Date.now();
    this.requestTimes5min.push(now);
    this.requestTimes60min.push(now);
  }
  async waitForNextRequest() {
    await new Promise((resolve)=>setTimeout(resolve, 200));
  }
  getStatus() {
    return {
      requestCount5min: this.requestTimes5min.length,
      requestCount60min: this.requestTimes60min.length,
      limit5min: this.limit5min,
      limit60min: this.limit60min
    };
  }
}
// Galxe API 클라이언트
class GalxeApiClient {
  rateLimiter = new RateLimiter();
  async makeRequest(cursor = null, pageSize = 50) {
    if (!this.rateLimiter.canMakeRequest()) {
      throw new Error('Rate limit exceeded');
    }
    const query = `
      query Quests($input: ListCampaignInput!) {
    campaigns(input: $input) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      list {
        space {
          id
          name
          isVerified
          invitationCode
          tgeInfo {
            status
          }
          alias
        }
        id
        numberID
        name
        description
        type
        status
        chain
        rewardType
        rewardInfo {
          token {
            tokenSymbol
            tokenAddress
            raffleContractAddress
            tokenRewardContract
          }
        }
        tokenReward {
          tokenAddress
          userTokenAmount
          hasDeposited
          withdrawnTokenAmount
          tokenSymbol
          raffleContractAddress
          tokenDecimal
        }
        tokenRewardContract {
          address
          chain
        }
        rewardName
        nftCore {
          contractAddress
        }
        thumbnail
        startTime
        endTime
        claimEndTime
        gasType
        cap
        blacklistCountryCodes
        forgeConfig {
          minNFTCount
          maxNFTCount
          requiredNFTs {
            nft {
              name
            }
            count
          }
        }
        distributionType
        participants {
          participantsCount
        }
        isSequencial
        airdrop {
          name
          contractAddress
          rewardType
          rewardAmount
          rewardInfo {
            token {
              symbol
              address
              symbol
            }
            custom {
              name
              icon
            }
            earndrop {
              alias
            }
          }
        }
        useCred
        creator
        info
        referralCode
        credentialGroups {
          id
          name
          credentials {
            name
            description
            credType
            credSource
          }
          conditionRelation
          rewards {
            expression
            eligible
            rewardCount
            rewardType
            rewardVal
          }
        }
      }
    }
  }
    `;
    const variables = {
      input: {
        first: pageSize,
        after: cursor,
        forAdmin: false,
        searchString: ""
      }
    };
    const response = await fetch(GALXE_API_URL, {
      method: 'POST',
      headers: GALXE_API_HEADERS,
      body: JSON.stringify({
        query,
        variables
      })
    });
    this.rateLimiter.recordRequest();
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }
    return data;
  }
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }
  async waitForNextRequest() {
    await this.rateLimiter.waitForNextRequest();
  }
}
// 데이터베이스 클라이언트
class DatabaseClient {
  stats = {
    totalSaved: 0,
    totalErrors: 0,
    questsSaved: 0,
    questsErrors: 0,
    credentialGroupsSaved: 0,
    credentialGroupsErrors: 0,
    credentialsSaved: 0,
    credentialsErrors: 0,
    spacesSaved: 0,
    spacesErrors: 0,
    rewardsSaved: 0,
    rewardsErrors: 0
  };
  async saveCompleteQuest(quest) {
    try {
      console.log(`🔍 퀘스트 저장 시작: ${quest.id} - ${quest.name}`);
      
      // 퀘스트 구조 분석
      console.log(`📊 퀘스트 ${quest.id} 구조 분석:`);
      console.log(`- credentialGroups 존재: ${!!quest.credentialGroups}`);
      console.log(`- credentialGroups 타입: ${Array.isArray(quest.credentialGroups) ? 'array' : typeof quest.credentialGroups}`);
      console.log(`- credentialGroups 길이: ${quest.credentialGroups?.length || 0}`);
      if (quest.credentialGroups?.length > 0) {
        console.log(`- 첫번째 group 구조:`, JSON.stringify(quest.credentialGroups[0], null, 2));
      }
      
      // 1. 퀘스트 저장
      const questData = {
        id: quest.id,
        number_id: quest.numberID || null,
        name: quest.name || null,
        description: quest.description || null,
        type: quest.type || null,
        status: quest.status || null,
        chain: quest.chain || null,
        reward_type: quest.rewardType || null,
        start_time: quest.startTime || null,
        end_time: quest.endTime || null,
        claim_end_time: quest.claimEndTime || null,
        cap: quest.cap || 0,
        participants_count: quest.participants?.participantsCount || 0,
        gas_type: quest.gasType || null,
        distribution_type: quest.distributionType || null,
        token_symbol: quest.tokenReward?.tokenSymbol || null,
        token_address: quest.tokenReward?.tokenAddress || null,
        user_token_amount: quest.tokenReward?.userTokenAmount || null,
        has_deposited: quest.tokenReward?.hasDeposited || false,
        raffle_contract_address: quest.tokenReward?.raffleContractAddress || null,
        token_reward_contract_address: quest.tokenRewardContract?.address || null,
        token_reward_contract_chain: quest.tokenRewardContract?.chain || null,
        token_decimal: quest.tokenReward?.tokenDecimal || null,
        nft_contract_address: quest.nftReward?.contractAddress || null,
        reward_name: quest.rewardName || null,
        thumbnail: quest.thumbnail || null,
        is_sequential: quest.isSequencial || false,
        use_cred: quest.useCred || false,
        creator: quest.creator || null,
        info: quest.info || null,
        referral_code: quest.referralCode || null,
        space_id: quest.space?.id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      console.log(`📝 퀘스트 데이터 준비 완료, DB 저장 시도...`);
      
      const { error: questError } = await supabase.from('quests').upsert(questData, {
        onConflict: 'id'
      });
      if (questError) {
        console.error(`❌ Quest 저장 실패 (${quest.id}):`, questError);
        console.error(`❌ 오류 코드:`, questError.code);
        console.error(`❌ 오류 메시지:`, questError.message);
        console.error(`❌ 오류 상세:`, questError.details);
        this.stats.questsErrors++;
        return false;
      }
      console.log(`✅ Quest 저장 성공: ${quest.id}`);
      this.stats.questsSaved++;
      
      // 2. Credential Groups 저장
      console.log(`📝 Credential Groups 저장 시작: ${quest.credentialGroups?.length || 0}개`);
      if (quest.credentialGroups && quest.credentialGroups.length > 0) {
        for (const group of quest.credentialGroups){
          console.log(`📝 Group 저장 시도: ${group.id} - ${group.name || 'unnamed'}`);
          const groupData = {
            id: group.id,
            quest_id: quest.id,
            name: group.name || null,
            condition_relation: group.conditionRelation || 'ALL',
            created_at: new Date().toISOString()
          };
          console.log(`📝 Group 데이터:`, JSON.stringify(groupData, null, 2));
          const { error: groupError } = await supabase.from('credential_groups').upsert(groupData, {
            onConflict: 'id'
          });
          if (groupError) {
            console.error(`❌ Credential Group 저장 실패 (${group.id}):`, groupError);
            this.stats.credentialGroupsErrors++;
            continue;
          }
          console.log(`✅ Credential Group 저장 성공: ${group.id}`);
          this.stats.credentialGroupsSaved++;
          
          // 2.5. Rewards 저장 (그룹 저장 후)
          if (group.rewards && group.rewards.length > 0) {
            await this.saveRewards(group.id, group.rewards);
          }
          
          // 3. Credentials 저장
          if (group.credentials) {
            for (const credential of group.credentials){
              const credentialData = {
                group_id: group.id,
                name: credential.name || null,
                description: credential.description || null,
                id_type: credential.type || null,
                cred_type: credential.credType || null,
                requirement: credential.requirement || false,
                created_at: new Date().toISOString()
              };
              const { error: credError } = await supabase.from('credentials').insert(credentialData);
              if (credError) {
                console.error('Credential 저장 실패:', credError);
                this.stats.credentialsErrors++;
                continue;
              }
              this.stats.credentialsSaved++;
            }
          }
        }
      }
      this.stats.totalSaved++;
      return true;
    } catch (error) {
      console.error('퀘스트 저장 중 예외:', error);
      this.stats.totalErrors++;
      return false;
    }
  }
  async saveSpace(spaceData: any) {
    try {
      const space = {
        id: spaceData.id,
        name: spaceData.name,
        is_verified: spaceData.isVerified || false,
        invitation_code: spaceData.invitationCode || null,
        tge_status: spaceData.tgeInfo?.status || 'UnSpecified',
        alias: spaceData.alias || spaceData.id // alias가 없으면 id 사용
      };

      const { error } = await supabase
        .from('spaces')
        .upsert(space, { onConflict: 'id' });

      if (error) {
        console.error('❌ Space 저장 오류:', error);
        this.stats.spacesErrors++;
        return false;
      }

      this.stats.spacesSaved++;
      return true;
    } catch (error) {
      console.error('❌ Space 저장 중 오류:', error);
      this.stats.spacesErrors++;
      return false;
    }
  }

  async saveRewards(groupId: string, rewards: any[]) {
    try {
      // 기존 rewards 삭제 후 새로 삽입 (중복 방지)
      await supabase
        .from('rewards')
        .delete()
        .eq('group_id', groupId);

      for (const reward of rewards) {
        const rewardData = {
          group_id: groupId,
          expression: reward.expression || null,
          eligible: reward.eligible || false,
          reward_count: reward.rewardCount || 0,
          reward_type: reward.rewardType || 'UNKNOWN',
          reward_val: reward.rewardVal || null
        };

        const { error } = await supabase
          .from('rewards')
          .insert(rewardData);

        if (error) {
          console.error('❌ Reward 저장 오류:', error);
          this.stats.rewardsErrors++;
          continue;
        }

        this.stats.rewardsSaved++;
      }

      return true;
    } catch (error) {
      console.error('❌ Rewards 저장 중 오류:', error);
      this.stats.rewardsErrors++;
      return false;
    }
  }

  getStats() {
    return {
      ...this.stats
    };
  }
}
// 커서 관리자
class CursorManager {
  async getLastCursor() {
    try {
      const { data, error } = await supabase.from('sync_cursors').select('cursor').order('created_at', {
        ascending: false
      }).limit(1).single();
      if (error || !data) return null;
      return data.cursor;
    } catch  {
      return null;
    }
  }
  async saveCursor(cursor: string, stats: any = {}) {
    try {
      const cursorData = {
        sync_type: 'smart-sync',
        cursor: cursor,
        last_sync_at: new Date().toISOString(),
        total_synced: stats.totalSaved || 0,
        total_errors: stats.totalErrors || 0,
        sync_stats: stats,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('sync_cursors')
        .insert(cursorData);

      if (error) {
        throw error;
      }

      console.log(`✅ 커서 저장 완료: ${cursor}`);
      return true;
    } catch (error) {
      console.error('❌ 커서 저장 오류:', error);
      return false;
    }
  }
}
// 스마트 증분 동기화 클래스
class SmartIncrementalSyncer {
  apiClient = new GalxeApiClient();
  dbClient = new DatabaseClient();
  cursorManager = new CursorManager();
  credAnalyzer = new CredAnalyzer(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    Deno.env.get('GEMINI_API_KEY')!
  );
  pageSize = 50;
  maxPages = 10;
  errorThreshold = 10;
  existingQuestIds = new Set();
  cacheLoaded = false;
  syncStats = {
    totalPages: 0,
    totalQuests: 0,
    newQuests: 0,
    skippedQuests: 0,
    errors: 0,
    startTime: new Date(),
    endTime: new Date()
  };
  async loadExistingQuestIds() {
    if (this.cacheLoaded) return;
    console.log('기존 퀘스트 ID 캐시 로딩 중...');
    try {
      let allIds = [];
      let from = 0;
      const batchSize = 1000;
      while(true){
        const { data, error } = await supabase.from('quests').select('id').range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allIds = allIds.concat(data.map((q)=>q.id));
        from += batchSize;
        console.log(`${allIds.length}개 ID 로드됨...`);
        if (data.length < batchSize) break;
      }
      this.existingQuestIds = new Set(allIds);
      this.cacheLoaded = true;
      console.log(`총 ${this.existingQuestIds.size}개 기존 퀘스트 ID 캐시 완료`);
    } catch (error) {
      console.error('기존 퀘스트 ID 로딩 실패:', error);
      this.existingQuestIds = new Set();
      this.cacheLoaded = true;
    }
  }
  isQuestExists(questId) {
    return this.existingQuestIds.has(questId);
  }
  async runSmartIncrementalSync(options: {
    maxPages?: number;
    pageSize?: number;
    fromStart?: boolean;
    skipAnalysis?: boolean;
    maxCredentials?: number;
    quick?: boolean;
    saveInterval?: number;
  } = {}) {
    console.log('스마트 증분 동기화를 시작합니다...');
    this.syncStats.startTime = new Date();
    try {
      await this.loadExistingQuestIds();
      console.log('API 총 퀘스트 개수 확인 중...');
      const firstPageResponse = await this.apiClient.makeRequest(null, 1);
      const apiTotalCount = firstPageResponse?.data?.campaigns?.totalCount || 0;
      const dbTotalCount = this.existingQuestIds.size;
      console.log(`퀘스트 개수 비교:`);
      console.log(`API 총 개수: ${apiTotalCount}`);
      console.log(`DB 현재 개수: ${dbTotalCount}`);
      console.log(`예상 신규 개수: ${Math.max(0, apiTotalCount - dbTotalCount)}`);
      let lastCursor = null;
      if (!options.fromStart) {
        lastCursor = await this.cursorManager.getLastCursor();
      }
      console.log(`시작 커서: ${lastCursor || '처음부터'}`);
      const result = await this.syncFromCursorSmart(lastCursor, options);
      
      // AI 분석 수행 (옵션에 따라)
      if (!options.skipAnalysis && result.success) {
        console.log('🤖 새로운 Credentials AI 분석 시작...');
        try {
          const maxCredentials = options.maxCredentials || 50;
          const analysisResult = await this.credAnalyzer.analyzeNewCredentials(maxCredentials);
          
          if (analysisResult.success && analysisResult.stats) {
            console.log(`✅ AI 분석 완료: ${analysisResult.stats.analyzed}개 분석`);
            (result as any).analysisStats = analysisResult.stats;
          } else {
            console.error('❌ AI 분석 실패:', analysisResult.error);
            (result as any).analysisError = analysisResult.error;
          }
        } catch (error) {
          console.error('❌ AI 분석 오류:', error);
          (result as any).analysisError = error instanceof Error ? error.message : String(error);
        }
      }
      
      this.syncStats.endTime = new Date();
      return result;
    } catch (error) {
      console.error('스마트 증분 동기화 실패:', error);
      this.syncStats.endTime = new Date();
      this.syncStats.errors++;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: this.syncStats
      };
    }
  }
  async syncFromCursorSmart(startCursor = null, options: {
    maxPages?: number;
    saveInterval?: number;
  } = {}) {
    let currentCursor = startCursor;
    let hasNextPage = true;
    let pageCount = 0;
    let consecutiveErrors = 0;
    let lastValidCursor = startCursor;
    let consecutiveSkips = 0;
    const maxPages = options.maxPages || this.maxPages;
    const saveInterval = options.saveInterval || 5;
    const maxConsecutiveSkips = 30;
    console.log(`페이지 크기: ${this.pageSize}, 최대 페이지: ${maxPages}`);
    console.log(`기존 퀘스트 ${this.existingQuestIds.size}개는 건너뜁니다.`);
    while(hasNextPage && pageCount < maxPages){
      try {
        console.log(`페이지 ${pageCount + 1} 동기화 중... (커서: ${currentCursor || 'null'})`);
        const response = await this.apiClient.makeRequest(currentCursor, this.pageSize);
        if (!response || !response.data || !response.data.campaigns) {
          throw new Error('잘못된 API 응답');
        }
        const campaigns = response.data.campaigns;
        const pageInfo = campaigns.pageInfo;
        const quests = campaigns.list || [];
        console.log(`${quests.length}개 퀘스트 조회됨`);
        if (quests.length > 0) {
          const processResult = await this.processQuestsSmart(quests);
          this.syncStats.newQuests += processResult.saved;
          this.syncStats.skippedQuests += processResult.skipped;
          this.syncStats.errors += processResult.errors;
          if (processResult.saved === 0 && processResult.skipped === quests.length) {
            consecutiveSkips++;
            console.log(`페이지 전체 스킵됨 (연속 ${consecutiveSkips}회)`);
            const adaptiveMaxSkips = pageCount <= 10 ? 50 : maxConsecutiveSkips;
            if (consecutiveSkips >= adaptiveMaxSkips) {
              console.log(`연속 ${consecutiveSkips}회 스킵. 이미 동기화된 영역에 도달한 것 같습니다.`);
              break;
            }
          } else {
            consecutiveSkips = 0;
          }
        }
        pageCount++;
        this.syncStats.totalPages = pageCount;
        this.syncStats.totalQuests += quests.length;
        hasNextPage = pageInfo.hasNextPage;
        currentCursor = pageInfo.endCursor;
        if (currentCursor) {
          lastValidCursor = currentCursor;
        }
        if (pageCount % saveInterval === 0 && lastValidCursor) {
          console.log(`중간 커서 저장 중... (페이지 ${pageCount})`);
          await this.cursorManager.saveCursor(lastValidCursor, {
            ...this.dbClient.getStats(),
            syncProgress: `${pageCount}/${maxPages} 페이지`,
            newQuests: this.syncStats.newQuests,
            skippedQuests: this.syncStats.skippedQuests
          });
        }
        await this.apiClient.waitForNextRequest();
        consecutiveErrors = 0;
      } catch (error) {
        console.error(`페이지 ${pageCount + 1} 동기화 오류:`, error);
        consecutiveErrors++;
        this.syncStats.errors++;
        if (consecutiveErrors >= this.errorThreshold) {
          console.error(`연속 오류 ${consecutiveErrors}회 발생. 동기화를 중단합니다.`);
          break;
        }
        console.log('3초 후 재시도...');
        await new Promise((resolve)=>setTimeout(resolve, 3000));
      }
    }
    if (lastValidCursor && lastValidCursor !== startCursor) {
      console.log('최종 커서 저장 중...');
      await this.cursorManager.saveCursor(lastValidCursor, {
        ...this.dbClient.getStats(),
        syncCompleted: true,
        totalPages: pageCount,
        newQuests: this.syncStats.newQuests,
        skippedQuests: this.syncStats.skippedQuests
      });
    }
    return {
      success: consecutiveErrors < this.errorThreshold,
      totalPages: pageCount,
      lastCursor: lastValidCursor,
      stats: this.syncStats,
      dbStats: this.dbClient.getStats()
    };
  }
  async processQuestsSmart(quests) {
    let saved = 0;
    let skipped = 0;
    let errors = 0;
    console.log(`${quests.length}개 퀘스트 스마트 처리 중...`);
    const newQuests = [];
    const existingQuests = [];
    for (const quest of quests){
      if (this.isQuestExists(quest.id)) {
        existingQuests.push(quest);
      } else {
        newQuests.push(quest);
      }
    }
    if (newQuests.length > 0) {
      console.log(`새로운 퀘스트 ${newQuests.length}개 발견:`);
      newQuests.forEach((quest, index)=>{
        console.log(`${index + 1}. ${quest.name} (ID: ${quest.id})`);
      });
    }
    if (existingQuests.length > 0) {
      console.log(`기존 퀘스트 ${existingQuests.length}개 스킵`);
    }
    // 새로운 퀘스트들 처리
    for (const quest of newQuests) {
      try {
        const success = await this.dbClient.saveCompleteQuest(quest);
        if (success) {
          saved++;
          this.existingQuestIds.add(quest.id);
        } else {
          errors++;
        }
      } catch (error) {
        console.error(`퀘스트 ${quest.id} 처리 오류:`, error);
        errors++;
      }
    }
    skipped = existingQuests.length;
    console.log(`처리 완료: ${saved}개 저장, ${skipped}개 스킵, ${errors}개 오류`);
    return {
      saved,
      skipped,
      errors
    };
  }
}
// Edge Function 핸들러
serve(async (req)=>{
  try {
    // CORS 헤더
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    };
    // OPTIONS 요청 처리
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: corsHeaders
      });
    }
    // GET/POST 요청 처리
    const url = new URL(req.url);
    const searchParams = url.searchParams;
    // 요청 파라미터 파싱
    const options = {
      maxPages: parseInt(searchParams.get('maxPages') || '10'),
      pageSize: parseInt(searchParams.get('pageSize') || '50'),
      fromStart: searchParams.get('fromStart') === 'true' || !searchParams.get('useCursor'),
      skipAnalysis: searchParams.get('skipAnalysis') === 'true' || searchParams.get('enableAI') === 'false',
      maxCredentials: parseInt(searchParams.get('maxCredentials') || '50'),
      quick: searchParams.get('quick') === 'true'
    };
    // 빠른 실행 모드 설정
    if (options.quick) {
      options.maxPages = Math.min(options.maxPages, 5);
    }
    console.log('Galxe 퀘스트 스마트 증분 동기화 시작');
    console.log(`최대 페이지: ${options.maxPages}개, 페이지 크기: ${options.pageSize}개`);
    console.log(`처음부터 시작: ${options.fromStart}`);
    console.log(`분석 건너뛰기: ${options.skipAnalysis}`);
    const syncer = new SmartIncrementalSyncer();
    const result = await syncer.runSmartIncrementalSync(options);
    if (result.success) {
      const response = {
        success: true,
        message: '스마트 동기화가 성공적으로 완료되었습니다!',
        stats: {
          newQuests: result.stats.newQuests,
          totalPages: result.stats.totalPages,
          totalQuests: result.stats.totalQuests,
          skippedQuests: result.stats.skippedQuests,
          errors: result.stats.errors,
          duration: result.stats.endTime.getTime() - result.stats.startTime.getTime()
        },
        dbStats: result.dbStats,
        skipAnalysis: options.skipAnalysis,
        ...(result as any).analysisStats && { analysisStats: (result as any).analysisStats },
        ...(result as any).analysisError && { analysisError: (result as any).analysisError }
      };
      return new Response(JSON.stringify(response), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: result.error,
        stats: result.stats
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
  } catch (error) {
    console.error('Edge Function 실행 중 오류:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
