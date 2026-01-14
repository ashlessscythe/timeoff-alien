-- DropIndex
DROP INDEX "idx_leaves_date_end_status";

-- DropIndex
DROP INDEX "idx_leaves_date_start_status";

-- DropIndex
DROP INDEX "idx_leaves_user_status_dates";

-- DropIndex
DROP INDEX "idx_user_allowance_user_year";

-- DropIndex
DROP INDEX "idx_users_company_dept";

-- DropIndex
DROP INDEX "idx_users_email";

-- DropIndex
DROP INDEX "idx_users_end_date";

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "allowed_increments" TEXT,
ADD COLUMN     "shift_hours" TEXT,
ADD COLUMN     "shifts" TEXT;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "allowed_increments" TEXT;

-- AlterTable
ALTER TABLE "leaves" ADD COLUMN     "time_end" VARCHAR(8),
ADD COLUMN     "time_start" VARCHAR(8);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "shift_hours" TEXT,
ADD COLUMN     "shifts" TEXT;
