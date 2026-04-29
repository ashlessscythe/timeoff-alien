-- Align Sessions table with connect-pg-simple (sid, sess, expire)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Sessions' AND column_name = 'data'
  ) THEN
    ALTER TABLE "Sessions" RENAME COLUMN "data" TO "sess";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Sessions' AND column_name = 'expires'
  ) THEN
    ALTER TABLE "Sessions" RENAME COLUMN "expires" TO "expire";
  END IF;
END $$;

UPDATE "Sessions" SET "sess" = '{}'::jsonb WHERE "sess" IS NULL OR TRIM("sess"::text) = '';
UPDATE "Sessions" SET "expire" = NOW() WHERE "expire" IS NULL;

ALTER TABLE "Sessions" ALTER COLUMN "sess" TYPE JSONB USING "sess"::jsonb;
ALTER TABLE "Sessions" ALTER COLUMN "expire" SET NOT NULL;

ALTER TABLE "Sessions" DROP COLUMN IF EXISTS "createdAt";
ALTER TABLE "Sessions" DROP COLUMN IF EXISTS "updatedAt";
