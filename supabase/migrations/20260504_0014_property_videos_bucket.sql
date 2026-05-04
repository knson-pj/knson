-- =============================================================================
-- knson 동영상 기능 — property-videos Storage 버킷 (2026-05-04)
-- =============================================================================
--
-- 비공개 버킷. 단일 파일 100MB, mp4/webm/quicktime 만 허용.
-- 클라이언트가 prepare 단계에서 발급받은 signed upload URL 로 직접 PUT.
-- 조회는 백엔드 API 가 1시간 signed URL 을 발급해 전달.
--
-- 사진 버킷(property-photos) 과 분리한 이유:
--   1) file_size_limit 을 100MB 로 올리면 사진도 같이 100MB 허용되어 보안 약화.
--   2) MIME 화이트리스트가 다름 (이미지 vs 비디오).
--   3) 향후 비디오 전용 정책(공개 변경 등) 자유롭게 적용 가능.
-- =============================================================================


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-videos',
  'property-videos',
  false,                       -- private (signed URL 로만 접근)
  104857600,                   -- 100 MB = 100 * 1024 * 1024
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime'          -- iOS Safari 가 .mov 로 녹화
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- =============================================================================
-- 적용 검증
-- =============================================================================
-- select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets
--   where id = 'property-videos';
-- → public = false, file_size_limit = 104857600,
--   allowed_mime_types = {video/mp4, video/webm, video/quicktime}


-- =============================================================================
-- 롤백
-- =============================================================================
-- 주의: 버킷에 객체가 들어있으면 먼저 비워야 함.
-- delete from storage.buckets where id = 'property-videos';

-- =============================================================================
-- END
-- =============================================================================
