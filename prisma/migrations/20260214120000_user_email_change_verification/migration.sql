-- Pending email change: verification sent to new address before users.email is updated.
ALTER TABLE "users" ADD COLUMN "pending_email" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "email_change_token" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "email_change_expires" TIMESTAMPTZ(6);
