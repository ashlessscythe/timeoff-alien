-- AlterTable
ALTER TABLE "companies" ADD COLUMN "leave_types_sort" VARCHAR(32) NOT NULL DEFAULT 'name_desc';

UPDATE "companies" SET "leave_types_sort" = 'name_desc';
