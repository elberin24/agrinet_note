-- 취재수첩 앱 — Supabase 스키마 (Phase 1 MVP)
-- Supabase SQL Editor에서 실행하세요.

-- 1. profiles: auth.users를 확장하는 프로필 테이블
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- 신규 가입 시 profiles 행 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. notes: 취재수첩 항목
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  memo text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "notes_all_own"
  on public.notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists notes_user_id_idx on public.notes (user_id);

-- notes.updated_at 자동 갱신 (동기화 정렬 기준이므로 앱 코드에 의존하지 않게 DB에서 보장)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- 3. recordings: 녹음 파일 메타데이터
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  duration_sec integer,
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'transcribing', 'done', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.recordings enable row level security;

create policy "recordings_all_own"
  on public.recordings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists recordings_note_id_idx on public.recordings (note_id);

-- 4. transcripts: STT 변환 결과
create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  raw_text text,
  edited_text text,
  words jsonb, -- whisper-1 단어별 타임스탬프 [{word, start, end}] — 재생-텍스트 동기화용
  stt_engine text not null default 'whisper',
  created_at timestamptz not null default now()
);

alter table public.transcripts enable row level security;

-- transcripts는 user_id가 없으므로 recordings를 통해 소유권 확인
create policy "transcripts_select_own"
  on public.transcripts for select
  using (
    exists (
      select 1 from public.recordings r
      where r.id = transcripts.recording_id and r.user_id = auth.uid()
    )
  );

create policy "transcripts_insert_own"
  on public.transcripts for insert
  with check (
    exists (
      select 1 from public.recordings r
      where r.id = transcripts.recording_id and r.user_id = auth.uid()
    )
  );

create policy "transcripts_update_own"
  on public.transcripts for update
  using (
    exists (
      select 1 from public.recordings r
      where r.id = transcripts.recording_id and r.user_id = auth.uid()
    )
  );

create policy "transcripts_delete_own"
  on public.transcripts for delete
  using (
    exists (
      select 1 from public.recordings r
      where r.id = transcripts.recording_id and r.user_id = auth.uid()
    )
  );

-- 5. Storage: 오디오 파일용 private 버킷
-- 경로 규칙: recordings/{user_id}/{recording_id}.m4a — 첫 번째 폴더명이 본인 uid여야 접근 가능
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy "storage_recordings_own"
  on storage.objects for all
  using (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'recordings' and auth.uid()::text = (storage.foldername(name))[1]);

-- Phase 2 예정 (지금은 생성하지 않음): sources, note_sources
