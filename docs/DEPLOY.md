# 배포 가이드

## 1. GitHub (코드 저장소 — 다른 PC에서 개발하려면 필수)

1. https://github.com 가입/로그인
2. 우측 상단 **+ → New repository**
   - Repository name: `chwijae-sucheop`
   - **Private** 선택 (코드 비공개)
   - README 등 추가 옵션은 모두 체크 해제 → **Create repository**
3. 이 PC 터미널에서 (프로젝트 폴더 `F:\Cluade`에서):
   ```
   git remote add origin https://github.com/<내아이디>/chwijae-sucheop.git
   git push -u origin main
   ```
   (처음 푸시할 때 GitHub 로그인 창이 뜨면 브라우저로 인증)

이후 다른 PC에서 개발하려면: `git clone` → `npm install` → `apps/web/.env.example`을 `.env.local`로 복사해 Supabase URL/키 입력.

## 2. Vercel (PC 웹 호스팅)

1. https://vercel.com — **GitHub 계정으로 가입**
2. **Add New → Project** → `chwijae-sucheop` 저장소 **Import**
3. 설정 화면에서:
   - **Root Directory**: `apps/web` (Edit 눌러서 선택 — 중요!)
   - **Environment Variables** 두 개 추가:
     - `NEXT_PUBLIC_SUPABASE_URL` = `https://dbijwoooltszomachtmn.supabase.co`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (anon 키)
4. **Deploy** → 몇 분 후 `https://chwijae-sucheop.vercel.app` 같은 주소 발급
5. 이후 GitHub에 푸시할 때마다 자동 재배포됨

## 3. Android APK (폰 설치 파일)

Expo의 빌드 서비스(EAS)를 사용. 무료 플랜으로 충분(월 빌드 횟수 제한 있음).

1. https://expo.dev 가입
2. 터미널에서:
   ```
   cd F:\Cluade\apps\mobile
   npx eas-cli login          ← expo.dev 계정으로 로그인
   npx eas-cli build -p android --profile preview
   ```
   - 처음 실행 시 "프로젝트 생성할까요?" → Yes
   - "Android keystore 생성할까요?" → Yes (자동 관리)
3. 빌드는 Expo 서버에서 진행 (10~20분). 완료되면 터미널과 expo.dev 대시보드에 **APK 다운로드 링크**가 뜸
4. 링크를 폰으로 열어 APK 다운로드 → 설치 ("출처를 알 수 없는 앱" 허용 필요)
5. 동료에게도 같은 링크를 공유하면 설치 가능

> iOS는 Apple 개발자 계정(연 $99)이 필요해서 보류. 아이폰 사용 동료는 당분간 Expo Go 방식 또는 웹 사용.

## 주의

- `.env.local`(Supabase 키)은 git에 올라가지 않음(.gitignore) — 새 PC에서는 직접 만들어야 함
- Edge Function(transcribe)은 Supabase 대시보드에서 관리되므로 배포와 무관하게 계속 작동
- 출시 전 체크리스트: Supabase 이메일 확인(Confirm email) 다시 켜기
