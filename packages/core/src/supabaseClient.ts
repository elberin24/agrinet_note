import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// apps/web, apps/mobile 각각 자신의 환경변수 로딩 방식으로 config를 만들어 전달한다.
// options: 플랫폼별 auth 설정(예: React Native의 AsyncStorage 세션 저장)을 주입할 때 사용.
export function createSupabaseClient(
  config: SupabaseConfig,
  options?: SupabaseClientOptions<"public">
): SupabaseClient {
  if (!config.url || !config.anonKey) {
    throw new Error(
      "Supabase config missing: SUPABASE_URL / SUPABASE_ANON_KEY를 확인하세요."
    );
  }
  return createClient(config.url, config.anonKey, options);
}
