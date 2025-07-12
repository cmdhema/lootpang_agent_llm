import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
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
    // URL 파라미터 파싱
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'sync'; // 기본값: sync
    console.log(`스케줄러 실행 시작 - Action: ${action}`);
    // 올바른 Authorization 헤더 사용
    const authHeaders = {
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sbGV4dHV0dHNpcWJ6ZWdlcnh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwNDIyNTYsImV4cCI6MjA2NTYxODI1Nn0.8MpnoFXKgqdckvQfJxhDkjO15T_IWJutKlnGaobURgI',
      'Content-Type': 'application/json'
    };
    const baseUrl = 'https://nllextuttsiqbzegerxt.supabase.co/functions/v1';
    if (action === 'sync') {
      // 1. 스마트 동기화 + AI 분석 실행
      console.log('스마트 동기화 + AI 분석 시작...');
      const syncResponse = await fetch(`${baseUrl}/smart-sync?quick=true&maxPages=5&skipAnalysis=false&maxCredentials=20`, {
        method: 'POST',
        headers: authHeaders
      });
      if (!syncResponse.ok) {
        const errorText = await syncResponse.text();
        throw new Error(`스마트 동기화 실패: ${syncResponse.status} ${syncResponse.statusText} - ${errorText}`);
      }
      const syncResult = await syncResponse.json();
      console.log('동기화 + 분석 결과:', syncResult);
      
      // AI 분석 결과 로깅
      if (syncResult.analysisStats) {
        console.log(`AI 분석 완료: ${syncResult.analysisStats.analyzed}개 분석`);
      } else if (syncResult.analysisError) {
        console.error('AI 분석 오류:', syncResult.analysisError);
      }
      return new Response(JSON.stringify({
        success: true,
        message: '동기화 완료',
        syncResult,
        timestamp: new Date().toISOString()
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else if (action === 'analysis') {
      // AI 분석만 실행 (동기화 없이)
      console.log('AI 분석 전용 모드 시작...');
      const analysisResponse = await fetch(`${baseUrl}/smart-sync?maxPages=1&skipAnalysis=false&maxCredentials=50&fromStart=false`, {
        method: 'POST',
        headers: authHeaders
      });
      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text();
        throw new Error(`AI 분석 실패: ${analysisResponse.status} ${analysisResponse.statusText} - ${errorText}`);
      }
      const analysisResult = await analysisResponse.json();
      console.log('AI 분석 결과:', analysisResult);
      return new Response(JSON.stringify({
        success: true,
        message: 'AI 분석 완료',
        syncStats: analysisResult.stats,
        analysisStats: analysisResult.analysisStats,
        analysisError: analysisResult.analysisError,
        timestamp: new Date().toISOString()
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: `지원하지 않는 액션: ${action}. 'sync' 또는 'analysis'를 사용하세요.`
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('스케줄러 실행 중 오류:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    });
  }
});
