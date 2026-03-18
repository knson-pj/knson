-- 001_add_geocode_columns.sql
-- 지오코딩 관련 컬럼 추가
-- properties 테이블에 geocode_status, geocoded_at 컬럼이 없는 경우에만 추가

-- geocode_status: null | pending | ok | failed
ALTER TABLE properties ADD COLUMN IF NOT EXISTS geocode_status TEXT DEFAULT NULL;

-- 지오코딩 완료 시점
ALTER TABLE properties ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ DEFAULT NULL;

-- 향후 매물 평가 종합 스코어 (Phase 2+)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS eval_score NUMERIC(4,1) DEFAULT NULL;

-- 향후 최신 평가 시점 (Phase 2+)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS eval_updated_at TIMESTAMPTZ DEFAULT NULL;

-- 인덱스: 지오코딩 대기 건 빠르게 조회
CREATE INDEX IF NOT EXISTS idx_properties_geocode_status ON properties(geocode_status)
  WHERE geocode_status IS NOT NULL;

-- 인덱스: 좌표 없는 건 조회
CREATE INDEX IF NOT EXISTS idx_properties_no_coords ON properties(id)
  WHERE latitude IS NULL AND longitude IS NULL;

-- 기존 좌표가 있는데 geocode_status가 null인 건 → ok로 일괄 업데이트
UPDATE properties
  SET geocode_status = 'ok',
      geocoded_at = COALESCE(geocoded_at, now())
  WHERE latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND geocode_status IS NULL;

-- 좌표 없고 주소가 있는데 geocode_status가 null인 건 → pending으로 일괄 업데이트
UPDATE properties
  SET geocode_status = 'pending'
  WHERE latitude IS NULL
    AND address IS NOT NULL
    AND address != ''
    AND geocode_status IS NULL;
