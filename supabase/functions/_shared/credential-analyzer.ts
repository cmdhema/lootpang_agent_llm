import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Credential AI 분석기
export class CredAnalyzer {
  private supabase: any;
  private geminiApiKey: string;
  
  stats = {
    totalCredentials: 0,
    analyzed: 0,
    feeRequired: 0,
    noFee: 0,
    onChain: 0,
    offChain: 0,
    snsOnly: 0,
    snsWithQuiz: 0,
    snsWithQuizSurvey: 0,
    complexQuest: 0,
    failed: 0,
    availableUnknown: 0,
    availableNo: 0,
    availableNow: 0,
    availableLater: 0
  };

  SNS_ONLY_CRED_TYPES = [
    'TWITTER_FOLLOW',
    'TWITTER_RT',
    'TWITTER_LIKE',
    'TWITTER_QUOTE',
    'DISCORD_MEMBER',
    'DISCORD_MESSAGE',
    'VISIT_LINK',
    'JOIN_TELEGRAM',
    'WATCH_YOUTUBE',
    'SPACE_USERS',
    'SPACE_FOLLOWER'
  ];

  ANALYSIS_TARGET_CRED_ID_TYPES = [
    'CSV',
    'API',
    'REST',
    'SUBGRAPH',
    'SURVEY',
    'GOOGLE_SHEET'
  ];

  ALWAYS_ONCHAIN_TYPES = [
    'GRAPHQL',
    'CONTRACT_QUERY'
  ];

  constructor(supabaseUrl: string, supabaseServiceRoleKey: string, geminiApiKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    this.geminiApiKey = geminiApiKey;
  }

  formatTimeForAnalysis(timestamp: any): string {
    if (!timestamp) return 'N/A';
    try {
      const timestampMs = typeof timestamp === 'number' ? timestamp * 1000 : timestamp;
      const date = new Date(timestampMs);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
    } catch {
      return 'N/A';
    }
  }

  async analyzeWithGemini(questName: string, questDescription: string, credentialName: string, credentialDescription: string, questStartTime: any, questEndTime: any) {
    try {
      const currentTime = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
      const formattedStartTime = this.formatTimeForAnalysis(questStartTime);
      const formattedEndTime = this.formatTimeForAnalysis(questEndTime);

      const prompt = `
Please analyze the following quest and credential information to determine fee requirements, on-chain status, and current availability.

**Quest Information:**
- Quest Name: ${questName || 'N/A'}
- Quest Description: ${questDescription || 'N/A'}
- Quest Start Time: ${formattedStartTime}
- Quest End Time: ${formattedEndTime}
- Current Time: ${currentTime}

**Credential Information:**
- Credential Name: ${credentialName || 'N/A'}
- Credential Description: ${credentialDescription || 'N/A'}

**Analysis Criteria:**

1. **Fee Requirement (fee):**
   - Set fee = 1 (fee required) if ANY of the following applies:
     * User must hold coins, tokens, NFTs or other assets to participate
     * Token swaps or transactions must be performed
     * Purchase of equipment, products, NFTs required for quest participation
     * Game item purchases, in-app payments, or purchase history verification needed
   - Set fee = 0 (no fee required) if:
     * Only gas fees are required for Galxe claim/transaction execution
     * No additional costs beyond standard blockchain gas fees
     * Free activities like social media interactions, surveys, or simple on-chain actions
   - Otherwise, set fee = 0 (no fee required)

2. **On-chain Status (onchain):**
   - Set onchain = 1 (on-chain) if ANY of the following applies:
     * Token swaps, transaction execution, coin/token/NFT holdings
     * Activities executed on blockchain
   - Otherwise, set onchain = 2 (off-chain)

3. **Current Availability (available):**
   IMPORTANT: Do not just check if quest status is "Active". You must comprehensively analyze quest and credential names/descriptions to determine actual participation availability.

   - Set available = -1 (unknown/insufficient info) if:
     * Quest timing information is unclear or missing
     * Credential requirements are too vague to determine availability
     * Cannot determine from the provided information

   - Set available = 0 (no longer available) if:
     * Quest has ended (end_time passed) or snapshot period has passed
     * Eligibility extraction is completed (e.g., snapshot taken before start_time)
     * Quest start time hasn't arrived yet
     * Quest/credential name or description mentions:
       - "snapshot" with dates that have already passed
       - "pre-quest snapshot" or "eligibility snapshot"
       - "holders as of [past date]"
       - "participants selected" or "selection completed"
       - "closed" or "ended" participation
       - Any indication that user eligibility was determined before quest start

   - Set available = 1 (currently available) if:
     * Quest is currently active AND user can participate immediately
     * Current time is between start_time and end_time
     * No snapshot requirements or snapshot is ongoing/future
     * Quest/credential allows real-time participation
     * User can perform required actions right now

   - Set available = 2 (available after actions) if:
     * Quest is active but requires time-delayed actions
     * User needs to complete prerequisite steps over time
     * Future snapshot dates mentioned
     * Participation possible after completing specific actions
     * Quest/credential mentions "after completing X" or "once you have Y"

**Response Format:**
Respond ONLY in the following JSON format:
{"fee": 0, "onchain": 2, "available": 1, "fee_reason": "Free SNS activities", "onchain_reason": "Off-chain web activities", "available_reason": "Currently active quest"}

fee must be 0 or 1, onchain must be 1 or 2, available must be -1, 0, 1, or 2.
Keep all reasoning within 30 characters each in English.
`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API 요청 실패: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // JSON 추출 및 파싱
      let jsonText = text.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      if (!jsonMatch) {
        const braceMatch = jsonText.match(/\{[^}]*\}/);
        if (braceMatch) {
          jsonText = braceMatch[0];
        }
      }

      try {
        const analysis = JSON.parse(jsonText);

        if (typeof analysis.fee !== 'number' || ![0, 1].includes(analysis.fee)) {
          throw new Error('Invalid fee value');
        }
        if (typeof analysis.onchain !== 'number' || ![1, 2].includes(analysis.onchain)) {
          throw new Error('Invalid onchain value');
        }
        if (typeof analysis.available !== 'number' || ![-1, 0, 1, 2].includes(analysis.available)) {
          throw new Error('Invalid available value');
        }

        const comments = {
          fee_reason: (analysis.fee_reason || '').substring(0, 30),
          onchain_reason: (analysis.onchain_reason || '').substring(0, 30),
          available_reason: (analysis.available_reason || '').substring(0, 30)
        };

        return {
          fee: analysis.fee,
          onchain: analysis.onchain,
          available: analysis.available,
          comments: comments
        };
      } catch (parseError) {
        console.warn('Gemini 응답 파싱 실패, 기본값 사용:', text);
        return {
          fee: -1,
          onchain: -1,
          available: -1,
          comments: null
        };
      }
    } catch (error) {
      console.error('Gemini API 호출 실패:', error);
      return {
        fee: -1,
        onchain: -1,
        available: -1,
        comments: null
      };
    }
  }

  analyzeSnsCategory(credTypes: string[]): number {
    if (!credTypes || credTypes.length === 0) return 4;

    const uniqueTypes = [...new Set(credTypes)];
    const snsOnlyTypes = uniqueTypes.filter(type => this.SNS_ONLY_CRED_TYPES.includes(type));
    const nonSnsTypes = uniqueTypes.filter(type => !this.SNS_ONLY_CRED_TYPES.includes(type));

    if (snsOnlyTypes.length === 0) return 4;
    if (nonSnsTypes.length === 0) return 1;

    const hasQuiz = nonSnsTypes.some(type => 
      type.toLowerCase().includes('quiz') || type.toLowerCase().includes('question')
    );
    const hasSurvey = nonSnsTypes.some(type => 
      type.toLowerCase().includes('survey') || type.toLowerCase().includes('form')
    );

    if (hasQuiz && hasSurvey) return 3;
    if (hasQuiz) return 2;
    return 4;
  }

  async analyzeCredential(credential: any, questInfo: any) {
    console.log('Credential 분석 id_type:', credential.id_type)
    if (!this.ANALYSIS_TARGET_CRED_ID_TYPES.includes(credential.id_type)) {
      return null;
    }

    if (this.ALWAYS_ONCHAIN_TYPES.includes(credential.cred_type)) {
      const analysis = await this.analyzeWithGemini(
        questInfo.name,
        questInfo.description,
        credential.name,
        credential.description,
        questInfo.start_time,
        questInfo.end_time
      );

      return {
        credential_id: credential.id,
        fee: analysis.fee,
        on_chain: 1, // GRAPHQL/CONTRACT_QUERY는 항상 on-chain
        now_available: analysis.available,
        only_sns: 4, // 기본값, 나중에 analyzeQuestSnsCategory로 업데이트됨
        comments: analysis.comments ? {
          ...analysis.comments,
          onchain_reason: 'GRAPHQL/CONTRACT_QUERY type'
        } : {
          fee_reason: '',
          onchain_reason: 'GRAPHQL/CONTRACT_QUERY type',
          available_reason: ''
        }
      };
    }

    const analysis = await this.analyzeWithGemini(
      questInfo.name,
      questInfo.description,
      credential.name,
      credential.description,
      questInfo.start_time,
      questInfo.end_time
    );

    return {
      credential_id: credential.id,
      fee: analysis.fee,
      on_chain: analysis.onchain,
      now_available: analysis.available,
      only_sns: 4, // 기본값, 나중에 analyzeQuestSnsCategory로 업데이트됨
      comments: analysis.comments
    };
  }

  async analyzeQuestSnsCategory(questId: string): Promise<number> {
    try {
      const { data: groups, error: groupError } = await this.supabase
        .from('credential_groups')
        .select('id')
        .eq('quest_id', questId);

      if (groupError || !groups) return 4;

      const groupIds = groups.map((g: any) => g.id);
      const { data: credentials, error: credError } = await this.supabase
        .from('credentials')
        .select('cred_type')
        .in('group_id', groupIds);

      if (credError || !credentials) return 4;

      const credTypes = credentials.map((c: any) => c.cred_type).filter(Boolean);
      return this.analyzeSnsCategory(credTypes);
    } catch (error) {
      console.error(`퀘스트 ${questId} SNS 카테고리 분석 오류:`, error);
      return 4;
    }
  }

  async saveAnalysisResult(analysisResult: any): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('cred_ai_anal')
        .upsert(analysisResult, {
          onConflict: 'credential_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`분석 결과 저장 실패 (credential_id: ${analysisResult.credential_id}):`, error);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`분석 결과 저장 중 예외 (credential_id: ${analysisResult.credential_id}):`, error);
      return false;
    }
  }

  async analyzeNewCredentials(maxCredentials: number = 50) {
    try {
      console.log('새로운 Credentials 분석 시작...');

      // 이미 분석된 credential_id 조회
      const { data: existingAnalyses, error: existingError } = await this.supabase
        .from('cred_ai_anal')
        .select('credential_id');

      if (existingError) {
        console.error('기존 분석 데이터 조회 실패:', existingError);
        return { success: false, error: existingError };
      }

      const existingCredentialIds = new Set(existingAnalyses?.map((item: any) => item.credential_id) || []);
      console.log(`이미 분석된 credentials: ${existingCredentialIds.size}개`);
      console.log(`분석 대상 타입: ${this.ANALYSIS_TARGET_CRED_ID_TYPES.join(', ')}`);

      // 분석 대상 credentials 조회 (특정 cred_type만, 이미 분석된 것 제외)
      const { data: allCredentials, error: credError } = await this.supabase
        .from('credentials')
        .select(`
          id,
          name,
          description,
          id_type,
          cred_type,
          group_id,
          credential_groups!inner (
            quest_id,
            quests!inner (
              id,
              name,
              description,
              start_time,
              end_time
            )
          )
        `)
        .in('id_type', this.ANALYSIS_TARGET_CRED_ID_TYPES)
        .order('id', { ascending: false })
        .limit(maxCredentials * 2); // 여유분 확보

      if (credError) {
        console.error('Credentials 조회 실패:', credError);
        return { success: false, error: credError };
      }

      console.log(`조회된 credentials: ${allCredentials?.length || 0}개`);

      if (!allCredentials || allCredentials.length === 0) {
        console.log('분석 대상 credentials가 없습니다.');
        return { success: true, stats: this.stats };
      }

      // 이미 분석된 credentials 필터링
      const credentials = allCredentials
        .filter((cred: any) => !existingCredentialIds.has(cred.id))
        .slice(0, maxCredentials); // 최대 개수 제한

      console.log(`필터링 후 분석할 credentials: ${credentials.length}개`);

      if (credentials.length === 0) {
        console.log('새로 분석할 credentials가 없습니다. 모든 분석이 완료되었습니다.');
        return { success: true, stats: this.stats };
      }

      console.log(`전체 대상: ${allCredentials.length}개, 새로 분석할 credentials: ${credentials.length}개`);
      this.stats.totalCredentials = credentials.length;

      // 각 credential 분석 및 즉시 저장
      for (const credential of credentials) {
        try {
          const questInfo = credential.credential_groups.quests;
          console.log(`분석 중: ${credential.name || credential.id} (${credential.cred_type})`);

          const analysisResult = await this.analyzeCredential(credential, questInfo);
          if (analysisResult) {
            // SNS 카테고리 분석 (퀘스트 단위)
            const snsCategory = await this.analyzeQuestSnsCategory(questInfo.id);
            analysisResult.only_sns = snsCategory;

            // 즉시 저장
            const saveSuccess = await this.saveAnalysisResult(analysisResult);
            if (saveSuccess) {
              this.stats.analyzed++;

              // 통계 업데이트
              if (analysisResult.fee === 1) this.stats.feeRequired++;
              else if (analysisResult.fee === 0) this.stats.noFee++;

              if (analysisResult.on_chain === 1) this.stats.onChain++;
              else if (analysisResult.on_chain === 2) this.stats.offChain++;

              switch (analysisResult.only_sns) {
                case 1: this.stats.snsOnly++; break;
                case 2: this.stats.snsWithQuiz++; break;
                case 3: this.stats.snsWithQuizSurvey++; break;
                case 4: this.stats.complexQuest++; break;
              }

              switch (analysisResult.now_available) {
                case -1: this.stats.availableUnknown++; break;
                case 0: this.stats.availableNo++; break;
                case 1: this.stats.availableNow++; break;
                case 2: this.stats.availableLater++; break;
              }

              console.log(`✅ 분석 완료: ${credential.name || credential.id}`);
            } else {
              this.stats.failed++;
              console.log(`❌ 저장 실패: ${credential.name || credential.id}`);
            }
          } else {
            console.log(`⏭️ 분석 대상 아님: ${credential.name || credential.id} (${credential.cred_type})`);
          }

          // API 호출 간격 조절 (Rate limiting)
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`Credential 분석 중 오류 (${credential.id}):`, error);
          this.stats.failed++;
        }
      }

      console.log('분석 완료! 최종 통계:', this.stats);
      return { success: true, stats: this.stats };
    } catch (error) {
      console.error('analyzeNewCredentials 실행 중 오류:', error);
      return { success: false, error: error };
    }
  }
}
