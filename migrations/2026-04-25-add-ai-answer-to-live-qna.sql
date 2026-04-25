-- Up
ALTER TABLE live_qna_questions
  ADD COLUMN IF NOT EXISTS ai_answer TEXT NULL,
  ADD COLUMN IF NOT EXISTS ai_answer_sources JSONB NULL,
  ADD COLUMN IF NOT EXISTS ai_answered_at TIMESTAMPTZ NULL;

-- Down
-- ALTER TABLE live_qna_questions
--   DROP COLUMN IF EXISTS ai_answer,
--   DROP COLUMN IF EXISTS ai_answer_sources,
--   DROP COLUMN IF EXISTS ai_answered_at;
