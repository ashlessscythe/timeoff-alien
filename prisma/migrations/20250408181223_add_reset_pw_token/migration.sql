-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reset_password_expires" TIMESTAMPTZ(6),
ADD COLUMN     "reset_password_token" VARCHAR(255);
