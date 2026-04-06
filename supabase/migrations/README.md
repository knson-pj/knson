# Supabase Baseline Migrations (2026-04-06)

이 ZIP은 **현재 메인 운영 Supabase 구조를 기준선으로 역정리한 baseline migration 세트**입니다.

## 목적
- 레포에 실제 기준선을 남기기
- 새 Supabase 환경에서 운영 구조를 최대한 동일하게 재현하기
- 프론트 / Vercel API / Supabase 간 구조 드리프트를 줄이기

## 적용 원칙
- **현재 운영 DB에는 이 baseline 세트를 다시 적용하지 않는 것을 권장**합니다.
- 이 세트는 **새 개발/테스트 환경 재현용** 또는 **레포 기준선 보존용**입니다.
- 운영 DB는 이미 더 앞선 상태일 수 있으므로, 적용 전 반드시 백업하세요.

## 이번 baseline의 의도적 정리 사항
1. 운영 DB에 존재하던 `properties_global_id_uq` + `uq_properties_global_id` 중복 unique 인덱스는
   **`uq_properties_global_id` 하나만 canonical로 채택**했습니다.
2. `property_activity_logs.property_id`와 `property_photos.property_id`는
   **운영 기준과 동일하게 `text` 유지**했습니다. `uuid` FK로 바꾸지 않았습니다.
3. `property-photos` 버킷은 생성하지만, **storage.objects 정책은 넣지 않았습니다.**
   현재 운영 export상 storage policy는 확인되지 않았고, 사진 처리는 서버/service-role 중심 구조로 해석했습니다.
4. `profiles_id_fkey`는 export 메타데이터상 존재가 확인되었지만 대상 스키마/테이블이 직접 포함되진 않았습니다.
   본 baseline에서는 **일반적인 Supabase 구성대로 `auth.users(id)` 참조 + `ON DELETE CASCADE`**로 복원했습니다.
   운영 DB와 정확히 동일한 FK action이 필요한 경우, 실제 constraint 정의를 한 번 더 확인해 미세 조정하세요.

## 권장 적용 순서
레포 내 `supabase/migrations` 폴더의 파일명 순서대로 적용합니다.

## 구성 파일
- `20260406_0000_extensions.sql`
- `20260406_0001_enums.sql`
- `20260406_0002_sequences.sql`
- `20260406_0003_tables.sql`
- `20260406_0004_indexes.sql`
- `20260406_0005_helper_functions.sql`
- `20260406_0006_business_functions.sql`
- `20260406_0007_triggers.sql`
- `20260406_0008_enable_rls.sql`
- `20260406_0009_policies_public.sql`
- `20260406_0010_storage_bucket.sql`

## 운영 기준에서 확인된 핵심
- enum: `source_type`, `submitter_type`
- sequence: `properties_general_seq`, `properties_realtor_seq`
- tables: `profiles`, `properties`, `property_activity_logs`, `property_photos`
- triggers/functions: 공개등록 번호 부여, identity key 동기화, staff 수정 제한, profile role guard, updated_at touch
- RLS: admin 전체 / staff 본인 담당 / public 제한 insert / photos는 서버 중심 구조
