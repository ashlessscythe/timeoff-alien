/*
  Warnings:

  - You are about to drop the column `company_wide_message_color` on the `companies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "companies" DROP COLUMN "company_wide_message_color",
ADD COLUMN     "company_wide_message_bg_color" VARCHAR(7) DEFAULT '#000000',
ADD COLUMN     "company_wide_message_text_color" VARCHAR(7) DEFAULT '#000000';
