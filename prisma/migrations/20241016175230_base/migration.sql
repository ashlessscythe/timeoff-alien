-- CreateEnum
CREATE TYPE "enum_user_feeds_type" AS ENUM ('calendar', 'wallchart', 'teamview', 'company');

-- CreateTable
CREATE TABLE "SequelizeMeta" (
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Sessions" (
    "sid" VARCHAR(36) NOT NULL,
    "expires" TIMESTAMPTZ(6),
    "data" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "audit" (
    "id" SERIAL NOT NULL,
    "entity_type" VARCHAR(255) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "attribute" VARCHAR(255) NOT NULL,
    "old_value" VARCHAR(255),
    "new_value" VARCHAR(255),
    "at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER,
    "by_user_id" INTEGER,

    CONSTRAINT "audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_holidays" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER NOT NULL,

    CONSTRAINT "bank_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "entity_type" VARCHAR(255) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "by_user_id" INTEGER NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "country" VARCHAR(255) NOT NULL,
    "start_of_new_year" INTEGER NOT NULL,
    "share_all_absences" BOOLEAN NOT NULL DEFAULT false,
    "is_team_view_hidden" BOOLEAN NOT NULL DEFAULT false,
    "ldap_auth_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ldap_auth_config" TEXT,
    "date_format" VARCHAR(255) NOT NULL DEFAULT 'YYYY-MM-DD',
    "company_wide_message" TEXT,
    "mode" INTEGER NOT NULL DEFAULT 1,
    "timezone" VARCHAR(255) DEFAULT 'Europe/London',
    "integration_api_enabled" BOOLEAN NOT NULL DEFAULT false,
    "integration_api_token" UUID,
    "carry_over" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_name_first" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_supervisors" (
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "department_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "department_supervisors_pkey" PRIMARY KEY ("department_id","user_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "allowance" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "personal" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "include_public_holidays" BOOLEAN NOT NULL DEFAULT true,
    "is_accrued_allowance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "manager_id" INTEGER,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_audits" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "email_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(255) NOT NULL DEFAULT '#ffffff',
    "use_allowance" BOOLEAN NOT NULL DEFAULT true,
    "use_personal" BOOLEAN NOT NULL DEFAULT false,
    "limit" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "manager_only" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" SERIAL NOT NULL,
    "status" INTEGER NOT NULL,
    "employee_comment" TEXT,
    "approver_comment" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "date_start" TIMESTAMPTZ(6) NOT NULL,
    "day_part_start" INTEGER NOT NULL DEFAULT 1,
    "date_end" TIMESTAMPTZ(6) NOT NULL,
    "day_part_end" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "approver_id" INTEGER,
    "leave_type_id" INTEGER NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "monday" INTEGER NOT NULL DEFAULT 1,
    "tuesday" INTEGER NOT NULL DEFAULT 1,
    "wednesday" INTEGER NOT NULL DEFAULT 1,
    "thursday" INTEGER NOT NULL DEFAULT 1,
    "friday" INTEGER NOT NULL DEFAULT 1,
    "saturday" INTEGER NOT NULL DEFAULT 2,
    "sunday" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER,
    "user_id" INTEGER,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_allowance_adjustment" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 2024,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carried_over_allowance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "user_allowance_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_feeds" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "feed_token" VARCHAR(255) NOT NULL,
    "type" "enum_user_feeds_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "user_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "slack_username" VARCHAR(255) DEFAULT '',
    "password" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "lastname" VARCHAR(255) NOT NULL,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "manager" BOOLEAN NOT NULL DEFAULT false,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "company_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_holidays_company_id" ON "bank_holidays"("company_id");

-- CreateIndex
CREATE INDEX "companies_id" ON "companies"("id");

-- CreateIndex
CREATE INDEX "department_supervisors_department_id" ON "department_supervisors"("department_id");

-- CreateIndex
CREATE INDEX "department_supervisors_user_id" ON "department_supervisors"("user_id");

-- CreateIndex
CREATE INDEX "departments_company_id" ON "departments"("company_id");

-- CreateIndex
CREATE INDEX "departments_id" ON "departments"("id");

-- CreateIndex
CREATE INDEX "email_audits_created_at" ON "email_audits"("created_at");

-- CreateIndex
CREATE INDEX "email_audits_user_id" ON "email_audits"("user_id");

-- CreateIndex
CREATE INDEX "leaves_approver_id" ON "leaves"("approver_id");

-- CreateIndex
CREATE INDEX "leaves_leave_type_id" ON "leaves"("leave_type_id");

-- CreateIndex
CREATE INDEX "leaves_user_id" ON "leaves"("user_id");

-- CreateIndex
CREATE INDEX "schedules_company_id" ON "schedules"("company_id");

-- CreateIndex
CREATE INDEX "schedules_user_id" ON "schedules"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_allowance_adjustment_user_id_year" ON "user_allowance_adjustment"("user_id", "year");

-- CreateIndex
CREATE INDEX "users_company_id" ON "users"("company_id");

-- CreateIndex
CREATE INDEX "users_department_id" ON "users"("department_id");

-- CreateIndex
CREATE INDEX "users_lastname" ON "users"("lastname");

-- AddForeignKey
ALTER TABLE "audit" ADD CONSTRAINT "audit_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit" ADD CONSTRAINT "audit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_holidays" ADD CONSTRAINT "bank_holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_supervisors" ADD CONSTRAINT "department_supervisors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_supervisors" ADD CONSTRAINT "department_supervisors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_audits" ADD CONSTRAINT "email_audits_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_audits" ADD CONSTRAINT "email_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_allowance_adjustment" ADD CONSTRAINT "user_allowance_adjustment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feeds" ADD CONSTRAINT "user_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
