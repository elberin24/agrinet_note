import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createSupabaseClient } from "@chwijae/core";

const extra = Constants.expoConfig?.extra ?? {};

export const supabase = createSupabaseClient(
  {
    url: extra.supabaseUrl ?? "",
    anonKey: extra.supabaseAnonKey ?? "",
  },
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // 모바일에는 브라우저 리다이렉트 URL이 없으므로 비활성화
      detectSessionInUrl: false,
    },
  }
);
