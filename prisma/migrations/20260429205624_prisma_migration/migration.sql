/*
  Warnings:

  - The primary key for the `Sessions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Made the column `sess` on table `Sessions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Sessions" DROP CONSTRAINT "Sessions_pkey",
ALTER COLUMN "sid" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "sess" SET NOT NULL,
ADD CONSTRAINT "Sessions_pkey" PRIMARY KEY ("sid");
