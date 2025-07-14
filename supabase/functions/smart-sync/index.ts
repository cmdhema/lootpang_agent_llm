import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { CredAnalyzer } from "../_shared/credential-analyzer.ts";

// 환경 변수
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

// Supabase 클라이언트 (service role key 사용)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Galxe API 설정
const GALXE_API_URL = 'https://graphigo.prd.galaxy.eco/query';
const GALXE_API_HEADERS = {
  'Content-Type': 'application/json'
};

// 동기화 설정
const DEFAULT_PAGE_SIZE = 50;

// Rate limiting
class RateLimiter {
  private requestTimes5min: number[] = [];
  private requestTimes60min: number[] = [];
  private readonly limit5min = 1500;
  private readonly limit60min = 10000;

  canMakeRequest(): boolean {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const sixtyMinAgo = now - 60 * 60 * 1000;
    
    // 윈도우 정리
    this.requestTimes5min = this.requestTimes5min.filter(time => time > fiveMinAgo);
    this.requestTimes60min = this.requestTimes60min.filter(time => time > sixtyMinAgo);
    
    return this.requestTimes5min.length < this.limit5min && 
           this.requestTimes60min.length < this.limit60min;
  }

  recordRequest(): void {
    const now = Date.now();
    this.requestTimes5min.push(now);
    this.requestTimes60min.push(now);
  }

  async waitForNextRequest(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 200));
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
  private rateLimiter = new RateLimiter();

  async fetchLatestQuests(pageSize: number = DEFAULT_PAGE_SIZE) {
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
        after: null,
        collection: false,
        rewardTypes: [
          "NFT",
          "TOKEN",
          "CUSTOM",
          "AIRDROP"
        ],
        listType: "Newest",
        statuses: [
          "Active",
          "NotStarted"
        ],
        credSources: [
          "TWITTER_RT",
          "TWITTER_LIKE",
          "TWITTER_SPACE",
          "TWITTER_QUOTE",
          "TWITTER_FOLLOW",
          "TWITTER_BULLISH",
          "TWITTER_FOLLOWED_BY",
          "TWITTER_TWEETS_LIKE",
          "TWITTER_TWEETS_RETWEET",
          "DISCORD_MEMBER",
          "DISCORD_MESSAGE",
          "DISCORD_AMA",
          "API",
          "VISIT_LINK",
          "JOIN_TELEGRAM",
          "QUIZ",
          "WATCH_YOUTUBE",
          "WALLET_BALANCE",
          "SPACE_USERS",
          "SPACE_POINT",
          "SPACE_FOLLOWER",
          "SPACE_PARTICIPATION",
          "TELEGRAM_MINI_APP",
          "REST",
          "CSV"
        ]
      }
    };

    try {
      const response = await fetch(GALXE_API_URL, {
        method: 'POST',
        headers: GALXE_API_HEADERS,
        body: JSON.stringify({ query, variables })
      });

      this.rateLimiter.recordRequest();

      if (!response.ok) {
        throw new Error(`Galxe API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        throw new Error(`Galxe API GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data;
    } catch (error) {
      console.error('Galxe API 요청 실패:', error);
      throw error;
    }
  }

  async waitForNextRequest(): Promise<void> {
    await this.rateLimiter.waitForNextRequest();
  }
}

// 데이터베이스 클라이언트
class DatabaseClient {
  private stats = {
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

  async saveCompleteQuest(quest: any): Promise<boolean> {
    try {
      // 1. Space 저장
      if (quest.space) {
        await this.saveSpace(quest.space);
      }

      // 2. Quest 저장
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

      const { error: questError } = await supabase
        .from('quests')
        .upsert(questData, { onConflict: 'id' });

      if (questError) {
        console.error(`퀘스트 ${quest.id} 저장 오류:`, questError);
        this.stats.questsErrors++;
        this.stats.totalErrors++;
        return false;
      }

      this.stats.questsSaved++;
      this.stats.totalSaved++;

      // 3. Credential Groups 저장
      if (quest.credentialGroups && quest.credentialGroups.length > 0) {
        for (const group of quest.credentialGroups) {
          await this.saveCredentialGroup(quest.id, group);
        }
      }

      return true;
    } catch (error) {
      console.error(`퀘스트 ${quest.id} 처리 중 오류:`, error);
      this.stats.totalErrors++;
      return false;
    }
  }

  private async saveSpace(spaceData: any): Promise<boolean> {
    try {
      const space = {
        id: spaceData.id,
        name: spaceData.name || null,
        is_verified: spaceData.isVerified || false,
        invitation_code: spaceData.invitationCode || null,
        tge_status: spaceData.tgeInfo?.status || null,
        alias: spaceData.alias || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('spaces')
        .upsert(space, { onConflict: 'id' });

      if (error) {
        console.error(`스페이스 ${spaceData.id} 저장 오류:`, error);
        this.stats.spacesErrors++;
        return false;
      }

      this.stats.spacesSaved++;
      return true;
    } catch (error) {
      console.error(`스페이스 ${spaceData.id} 처리 중 오류:`, error);
      this.stats.spacesErrors++;
      return false;
    }
  }

  private async saveCredentialGroup(questId: string, group: any): Promise<void> {
    try {
      const groupData = {
        id: group.id,
        quest_id: questId,
        name: group.name || null,
        condition_relation: group.conditionRelation || null,
        created_at: new Date().toISOString()
      };

      const { error: groupError } = await supabase
        .from('credential_groups')
        .upsert(groupData, { onConflict: 'id' });

      if (groupError) {
        console.error(`크레덴셜 그룹 ${group.id} 저장 오류:`, groupError);
        this.stats.credentialGroupsErrors++;
        return;
      }

      this.stats.credentialGroupsSaved++;

      // Credentials 저장
      if (group.credentials && group.credentials.length > 0) {
        for (const cred of group.credentials) {
          await this.saveCredential(group.id, cred);
        }
      }

      // Rewards 저장
      if (group.rewards && group.rewards.length > 0) {
        await this.saveRewards(group.id, group.rewards);
      }
    } catch (error) {
      console.error(`크레덴셜 그룹 ${group.id} 처리 중 오류:`, error);
      this.stats.credentialGroupsErrors++;
    }
  }

  private async saveCredential(groupId: string, cred: any): Promise<void> {
    try {
      const credData = {
        group_id: groupId,
        name: cred.name || null,
        description: cred.description || null,
        cred_type: cred.credType || null,
        id_type: cred.credSource || null,  // credentials 테이블에는 cred_source가 아닌 id_type 사용
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('credentials')
        .insert(credData);

      if (error) {
        console.error(`크레덴셜 저장 오류:`, error);
        this.stats.credentialsErrors++;
        return;
      }

      this.stats.credentialsSaved++;
    } catch (error) {
      console.error(`크레덴셜 처리 중 오류:`, error);
      this.stats.credentialsErrors++;
    }
  }

  private async saveRewards(groupId: string, rewards: any[]): Promise<void> {
    try {
      const rewardData = rewards.map(reward => ({
        group_id: groupId,
        expression: reward.expression || null,
        eligible: reward.eligible || false,
        reward_count: reward.rewardCount || 0,
        reward_type: reward.rewardType || null,
        reward_val: reward.rewardVal || null,
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('rewards')
        .insert(rewardData);

      if (error) {
        console.error(`리워드 저장 오류:`, error);
        this.stats.rewardsErrors++;
        return;
      }

      this.stats.rewardsSaved += rewards.length;
    } catch (error) {
      console.error(`리워드 처리 중 오류:`, error);
      this.stats.rewardsErrors++;
    }
  }

  getStats() {
    return this.stats;
  }
}

// 스마트 동기화 클래스 (cursor 제거 버전)
class SmartSyncer {
  apiClient = new GalxeApiClient();
  dbClient = new DatabaseClient();
  credAnalyzer = new CredAnalyzer(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    Deno.env.get('GEMINI_API_KEY')!
  );
  pageSize = DEFAULT_PAGE_SIZE;
  existingQuestIds = new Set();
  cacheLoaded = false;
  syncStats = {
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
        const { data, error } = await supabase
          .from('quests')
          .select('id')
          .range(from, from + batchSize - 1);
        
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

  async runSync(options: {
    pageSize?: number;
    skipAnalysis?: boolean;
    maxCredentials?: number;
  } = {}) {
    console.log('스마트 동기화를 시작합니다...');
    this.syncStats.startTime = new Date();
    
    try {
      await this.loadExistingQuestIds();
      
      console.log('최신 퀘스트 조회 중...');
      const pageSize = options.pageSize || this.pageSize;
      const response = await this.apiClient.fetchLatestQuests(pageSize);
      
      if (!response || !response.data || !response.data.campaigns) {
        throw new Error('잘못된 API 응답');
      }
      
      const campaigns = response.data.campaigns;
      const quests = campaigns.list || [];
      const apiTotalCount = campaigns.totalCount || 0;
      const dbTotalCount = this.existingQuestIds.size;
      
      console.log(`퀘스트 개수 비교:`);
      console.log(`API 총 개수: ${apiTotalCount}`);
      console.log(`DB 현재 개수: ${dbTotalCount}`);
      console.log(`조회된 퀘스트: ${quests.length}개`);
      
      this.syncStats.totalQuests = quests.length;
      
      // 퀘스트 처리
      const processResult = await this.processQuests(quests);
      this.syncStats.newQuests = processResult.saved;
      this.syncStats.skippedQuests = processResult.skipped;
      this.syncStats.errors = processResult.errors;
      
      // AI 분석 수행 (옵션에 따라)
      if (!options.skipAnalysis && processResult.saved > 0) {
        console.log('🤖 새로운 Credentials AI 분석 시작...');
        try {
          const maxCredentials = options.maxCredentials || 50;
          const analysisResult = await this.credAnalyzer.analyzeNewCredentials(maxCredentials);
          
          if (analysisResult.success && analysisResult.stats) {
            console.log(`✅ AI 분석 완료: ${analysisResult.stats.analyzed}개 분석`);
            (this.syncStats as any).analysisStats = analysisResult.stats;
          } else {
            console.error('❌ AI 분석 실패:', analysisResult.error);
            (this.syncStats as any).analysisError = analysisResult.error;
          }
        } catch (error) {
          console.error('❌ AI 분석 오류:', error);
          (this.syncStats as any).analysisError = error instanceof Error ? error.message : String(error);
        }
      }
      
      this.syncStats.endTime = new Date();
      
      return {
        success: true,
        stats: this.syncStats,
        dbStats: this.dbClient.getStats()
      };
    } catch (error) {
      console.error('동기화 실패:', error);
      this.syncStats.endTime = new Date();
      this.syncStats.errors++;
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stats: this.syncStats
      };
    }
  }

  async processQuests(quests) {
    let saved = 0;
    let skipped = 0;
    let errors = 0;
    
    console.log(`${quests.length}개 퀘스트 처리 중...`);
    
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
serve(async (req) => {
  try {
    // CORS 헤더
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // OPTIONS 요청 처리
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // POST 요청만 허용
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 요청 본문 파싱
    const body = await req.json().catch(() => ({}));
    const options = {
      pageSize: body.pageSize || DEFAULT_PAGE_SIZE,
      skipAnalysis: body.skipAnalysis || false,
      maxCredentials: body.maxCredentials || 50
    };

    console.log('Smart Sync 시작:', options);

    // 동기화 실행
    const syncer = new SmartSyncer();
    const result = await syncer.runSync(options);

    console.log('Smart Sync 완료:', result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Smart Sync 오류:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500, 
        headers: { 
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
