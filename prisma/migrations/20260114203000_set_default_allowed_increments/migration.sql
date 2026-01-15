-- AlterTable
ALTER TABLE "departments" ALTER COLUMN "allowed_increments" SET DEFAULT '["full_day","half_day"]';

-- Update existing NULL values to default
UPDATE "departments" SET "allowed_increments" = '["full_day","half_day"]' WHERE "allowed_increments" IS NULL;
