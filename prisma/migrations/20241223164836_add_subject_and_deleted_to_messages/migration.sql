-- First add columns with default values
ALTER TABLE "user_messages"
ADD COLUMN "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "subject" VARCHAR(255) NOT NULL DEFAULT 'No Subject',
ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Update existing messages to use first part of message as subject
UPDATE "user_messages"
SET "subject" = CASE
    WHEN length(message) <= 50 THEN message
    ELSE left(message, 47) || '...'
END
WHERE "subject" = 'No Subject';

-- Remove the default constraint from subject column
ALTER TABLE "user_messages" ALTER COLUMN "subject" DROP DEFAULT;
