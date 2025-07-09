import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

console.log('Edge Function "notify-on-new-quest" is up and running!');

serve(async (req) => {
  try {
    // 1. Supabase 클라이언트 생성
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. 웹훅 페이로드에서 새로 생성된 퀘스트 ID 추출
    const payload = await req.json();
    const newQuestId = payload.record.id;
    console.log(`Webhook received for new quest: ${newQuestId}`);

    // 3. 데이터베이스 함수(RPC)를 호출하여 상세 정보 조회
    const { data: questDetails, error: rpcError } = await supabaseClient
      .rpc('get_quest_details_for_notification', { quest_id_param: newQuestId })
      .single(); // 단일 객체 반환 기대

    if (rpcError) {
      throw new Error(`데이터베이스 RPC 호출 오류: ${rpcError.message}`);
    }

    // 4. 조회된 데이터가 없으면 알림 없이 종료
    if (!questDetails) {
      console.log(`알림 조건에 맞는 퀘스트 정보를 찾지 못했습니다 (Quest ID: ${newQuestId}). 알림을 건너뜁니다.`);
      return new Response(
        JSON.stringify({ message: '알림 조건 불일치, 알림을 건너뜁니다.' }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log('퀘스트 상세 정보 조회 성공:', questDetails);

    // 5. Node.js API를 호출하여 텔레그램 알림 요청
    const nodeApiUrl = Deno.env.get('NODE_API_URL');
    if (!nodeApiUrl) {
      throw new Error('NODE_API_URL 환경 변수가 설정되지 않았습니다.');
    }

    const apiResponse = await fetch(`${nodeApiUrl}/api/notifications/quest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questDetails),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      throw new Error(`Node.js API 호출 실패 (상태: ${apiResponse.status}): ${errorBody}`);
    }

    console.log('Node.js API 호출 성공.');

    // 6. 성공 응답 반환
    return new Response(
      JSON.stringify({ success: true, message: '알림이 성공적으로 요청되었습니다.' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Edge Function 처리 중 오류 발생:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
