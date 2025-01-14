-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "payroll_close_time" INTEGER NOT NULL DEFAULT 10,
ALTER COLUMN "timezone" SET DEFAULT 'America/Denver';
