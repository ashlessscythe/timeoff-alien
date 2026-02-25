-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "minimum_notice_by_leave_type" TEXT;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "minimum_days_notice" INTEGER NOT NULL DEFAULT 0;
