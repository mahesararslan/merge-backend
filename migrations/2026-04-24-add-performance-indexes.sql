-- ============================================================================
-- Performance indexes for hot-path queries identified in frontend API analysis.
--
-- Apply to PRODUCTION (Neon) manually. DEV already has synchronize: true,
-- so the matching @Index decorators in entities auto-create these on boot.
--
-- HOW TO RUN:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f 2026-04-24-add-performance-indexes.sql
--
-- SAFETY NOTES:
--   - Uses CREATE INDEX CONCURRENTLY: does NOT lock the table for writes.
--     Reads/writes continue during index build. Takes longer than a regular
--     CREATE INDEX but is safe on a live DB.
--   - Uses IF NOT EXISTS: script is idempotent, safe to re-run.
--   - CONCURRENTLY cannot run inside a transaction. Do NOT wrap in BEGIN/COMMIT.
--     Run each statement individually; if one fails, re-run the whole file.
--   - If a CONCURRENTLY build fails midway, Postgres leaves an INVALID index.
--     Drop it with:  DROP INDEX CONCURRENTLY IF EXISTS <name>;  then re-run.
--   - Column identifiers are double-quoted because TypeORM generates camelCase
--     column names (e.g. "ownerId"); unquoted Postgres folds them to lowercase.
-- ============================================================================

-- --- notes ---------------------------------------------------------------
-- Dashboard calls /notes/recent/created and /notes/recent/updated on every load.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_note_owner_created
    ON notes ("ownerId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_note_owner_updated
    ON notes ("ownerId", "updatedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_note_owner_folder
    ON notes ("ownerId", "folderId");

-- --- rooms ---------------------------------------------------------------
-- findAll(): filters isPublic=true ORDER BY createdAt DESC (public room listing).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_public_created
    ON rooms ("isPublic", "createdAt" DESC);

-- findUserRooms(): filters by admin.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_admin
    ON rooms ("adminId");

-- --- room_tags (join table) ---------------------------------------------
-- Dashboard /room/feed joins room.tags and filters tags.name IN (...).
-- TypeORM's composite PK indexes (roomId, tagId); reverse lookup by tagId
-- is not covered.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_room_tags_tag
    ON room_tags ("tagId");

-- --- announcements -------------------------------------------------------
-- /announcements lists by room + isPublished ORDER BY createdAt DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_announcement_room_published_created
    ON announcements ("roomId", "isPublished", "createdAt" DESC);

-- --- live_qna_questions --------------------------------------------------
-- listQuestions() filters (room_id, session_id) ORDER BY votes_count DESC,
-- created_at ASC. This entity uses explicit snake_case column names.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_live_qna_question_room_session_votes_created
    ON live_qna_questions (room_id, session_id, votes_count DESC, created_at ASC);

-- --- assignment_attempts -------------------------------------------------
-- Instructor "needs grading" filter: EXISTS ... WHERE assignmentId = :id
-- AND score IS NULL.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assign_attempt_assignment_score
    ON assignment_attempts ("assignmentId", "score");

-- --- files ---------------------------------------------------------------
-- Personal file timeline: filter uploader, sort by createdAt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_uploader_created
    ON files ("uploaderId", "createdAt" DESC);

-- ============================================================================
-- Verification: after running, check that all indexes are VALID (not INVALID).
--
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE indexname LIKE 'idx_%'
--   ORDER BY tablename, indexname;
--
--   SELECT c.relname AS index_name, i.indisvalid, i.indisready
--   FROM pg_index i
--   JOIN pg_class c ON c.oid = i.indexrelid
--   WHERE c.relname LIKE 'idx_%'
--   ORDER BY c.relname;
--
-- Any row with indisvalid=false is a failed CONCURRENTLY build — drop and retry.
-- ============================================================================
