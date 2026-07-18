# 취재수첩

기자를 위한 취재 기록 앱. 모바일에서 녹음 → 자동 텍스트 변환 → PC에서도 동기화된 편집.

기획 상세는 [docs/PLANNING.md](docs/PLANNING.md) 참고.

## 프로젝트 구조

```
apps/
  mobile/   React Native(Expo) 앱 — 녹음 담당
  web/      Next.js 웹앱 — 조회/편집 담당
packages/
  core/     공유 타입, Supabase 클라이언트
supabase/
  schema.sql  DB 스키마 + RLS 정책
docs/
  PLANNING.md 기획서
```

## 시작하기

### 0. 사전 준비 (직접 진행 필요)

1. [Node.js](https://nodejs.org) (LTS) 설치
2. [Supabase](https://supabase.com) 프로젝트 생성 후 SQL Editor에서 `supabase/schema.sql` 실행
3. [OpenAI](https://platform.openai.com) API 키 발급 (Whisper STT용, Phase 1 후반 작업에서 사용)

### 1. 의존성 설치

```bash
npm install
# Expo SDK와 네이티브 패키지 버전을 정확히 맞춤 (최초 1회 및 SDK 업그레이드 때마다)
cd apps/mobile && npx expo install --fix && cd ../..
```

> 모바일 앱은 Expo SDK 54 + `expo-audio` 기준입니다. Expo Go 앱은 최신 SDK만 지원하므로,
> 시간이 지나 SDK 버전이 안 맞으면 `npx expo install --fix`로 올려서 맞추세요.

### 2. 환경변수 설정

```bash
cp apps/web/.env.example apps/web/.env.local
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 채우기
```

모바일은 `apps/mobile/app.json`의 `expo.extra.supabaseUrl` / `supabaseAnonKey`를 채우거나, EAS 빌드 시 환경변수로 주입하세요.

### 3. 로컬 실행

```bash
npm run dev:web      # http://localhost:3000
npm run dev:mobile   # Expo 개발 서버 (Expo Go 앱으로 QR 스캔)
```

## 현재 상태

Phase 1 MVP 스캐폴딩 단계. 로그인, 녹음, 업로드, STT 파이프라인은 아직 구현 전이며 `docs/PLANNING.md`의 로드맵을 따라 진행합니다.
