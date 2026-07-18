# 취재수첩 앱 — 기획서

## 1. 배경 및 목적

농업·축산·수산 등 전문 분야를 취재하는 기자를 위한 디지털 '취재수첩' 앱. 현재 기자들은 휴대폰으로 몰래 녹음 → 네이버 클로바노트로 텍스트 변환 → 기사 작성에 맞게 재가공하는 흐름을 수작업으로 이어붙이고 있으며, 다음과 같은 문제가 있다.

- 전문용어(농축수산 분야) 인식률이 낮음
- 변환된 텍스트가 기사 작성에 바로 쓰기 어려운 날것 그대로임
- 여러 취재원을 오래 관리하다 보면 히스토리가 흩어짐
- 기록의 보안(본인만 열람)이 보장되지 않음
- 휴대폰(현장)과 PC(사무실) 간 기록이 분절됨

## 2. MVP 목표 (Phase 1)

1. 모바일(iOS/Android)에서 녹음 → PC 웹에서도 동일 기록 조회/편집
2. 녹음 → STT 자동 변환 → 기사 재가공이 편한 편집형 텍스트로 저장
3. 백그라운드 녹음 지원 (단, OS 정책상 마이크 사용 표시는 숨길 수 없음 — §5 참조)
4. 기자별 계정 분리, 본인 기록만 열람 가능
5. Supabase 기반 클라우드 동기화로 어디서든 접속 가능

**Phase 1에서 제외**(Phase 2 이후):
- 전문용어 심화 보정(오인식 패턴 학습, 화자분리)
- 취재원 관리(CRM) — 프로필, 연락 이력, AI 기반 프로파일링

## 3. 시스템 아키텍처

```
┌─────────────────┐     ┌─────────────────┐
│  모바일 앱        │     │   PC 웹앱         │
│  (React Native/  │     │   (Next.js)      │
│   Expo)          │     │                  │
│  - 녹음           │     │  - 조회/편집       │
│  - 로컬 임시저장   │     │  - 검색           │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         └──────────┬─────────────┘
                     │
              ┌──────▼───────┐
              │   Supabase    │
              │  - Auth       │
              │  - Postgres   │
              │  - Storage    │
              │  - Edge Fn    │
              └──────┬────────┘
                     │  (업로드 완료 트리거)
              ┌──────▼────────┐
              │  Whisper API   │
              │ (전문용어 프롬프트)│
              └───────────────┘
```

### 기술 스택 상세

- **모바일**: Expo SDK 54 (React Native), 녹음은 `expo-audio` 사용 (구 expo-av는 deprecated → SDK 54에서 제거됨). iOS는 `UIBackgroundModes: audio`, Android는 마이크 타입 포그라운드 서비스(`FOREGROUND_SERVICE_MICROPHONE`)로 백그라운드 녹음 유지
- **PC 웹**: Next.js (App Router). 인증 연동 구현 시 `@supabase/ssr` 사용 권장 (서버 컴포넌트에서 세션 처리)
- **공유 패키지**: `packages/core` — Supabase 클라이언트 팩토리(플랫폼별 auth 옵션 주입 가능), 도메인 타입
- **모바일 세션 유지**: React Native에는 localStorage가 없으므로 AsyncStorage + URL polyfill로 Supabase 세션을 영속화

## 4. 데이터 흐름

1. 모바일에서 녹음 시작 → 로컬 파일로 임시 저장 (네트워크 없어도 녹음 가능)
2. 온라인 상태가 되면 Supabase Storage에 업로드 (재시도 큐 포함)
3. 업로드 완료 → Edge Function이 Whisper API 호출, 농축수산 전문용어 사전을 `initial_prompt`로 주입
4. 변환 텍스트를 `transcripts` 테이블에 저장, 원본 `notes`에 연결
5. 모바일/PC 어디서든 Supabase Realtime으로 동기화된 편집 가능 텍스트 확인

## 5. 리스크 및 제약사항

| 항목 | 내용 |
|---|---|
| 백그라운드 녹음의 은닉성 | iOS 14+/최근 Android는 마이크 사용 중 OS 레벨 표시(오렌지/초록 점 등)를 강제 표출하며 앱이 숨길 수 없음. 앱스토어 정책상 "몰래 녹음"을 표방하면 심사 반려 위험. → "상대방 은폐"가 아닌 "원탭으로 빠르게 켜고 화면을 오래 볼 필요 없는 미니멀 UI"로 방향 설정 |
| 법적 근거 | 한국 통신비밀보호법상 대화 당사자의 녹음은 적법. 다만 스토어 정책·OS 제약은 법적 문제와 별개 |
| STT 비용 | Whisper API는 분당 과금. 실사용량 기반으로 Phase 1 이후 재산정 필요 |
| 전문용어 보정 한계 | 프롬프트 주입만으로는 완벽하지 않음. Phase 2에서 오인식 패턴 수집 후 사전/후처리 고도화 |
| 네트워크 불안정 | 농어촌 등 현장은 네트워크가 불안정할 수 있어 로컬 저장 우선 설계 필수 |

## 6. 데이터 모델 (초안)

- `profiles(id, name, email, created_at)` — `auth.users` 참조
- `notes(id, user_id, title, memo, status, created_at, updated_at)`
- `recordings(id, note_id, user_id, storage_path, duration_sec, status, created_at)`
- `transcripts(id, recording_id, raw_text, edited_text, stt_engine, created_at)`
- 모든 테이블 `user_id` 기준 RLS 적용
- Phase 2: `sources`, `note_sources` 추가 예정

## 7. 로드맵

- **Phase 1 (MVP)**: 녹음, STT 변환, 동기화, 계정별 보안 — 본 문서의 범위
- **Phase 2**: 전문용어 심화 보정, 화자분리, 취재원 관리(CRM)
- **Phase 3 (검토)**: 기사 초안 자동 생성 지원, 팀/데스크 협업, 다국어

## 8. 다음 단계 (사용자가 직접 진행 필요)

1. [Supabase](https://supabase.com) 프로젝트 생성 → `supabase/schema.sql` 적용
2. [OpenAI](https://platform.openai.com) API 키 발급 (Whisper 사용)
3. `.env` 파일에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OPENAI_API_KEY` 설정
4. `apps/mobile`, `apps/web` 각각 의존성 설치 후 로컬 실행
