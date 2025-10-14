-- CreateTable
CREATE TABLE "SequelizeMeta" (
    "name" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "Sessions" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "expires" DATETIME,
    "data" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "attribute" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "at" DATETIME NOT NULL,
    "company_id" INTEGER,
    "by_user_id" INTEGER,
    CONSTRAINT "audit_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bank_holidays" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "company_id" INTEGER NOT NULL,
    CONSTRAINT "bank_holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "comments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "company_id" INTEGER NOT NULL,
    "by_user_id" INTEGER NOT NULL,
    CONSTRAINT "comments_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "companies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "start_of_new_year" INTEGER NOT NULL,
    "share_all_absences" BOOLEAN NOT NULL DEFAULT false,
    "is_team_view_hidden" BOOLEAN NOT NULL DEFAULT false,
    "ldap_auth_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ldap_auth_config" TEXT,
    "date_format" TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
    "company_wide_message" TEXT,
    "company_wide_message_text_color" TEXT DEFAULT '#000000',
    "company_wide_message_bg_color" TEXT DEFAULT '#000000',
    "mode" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT DEFAULT 'America/Denver',
    "integration_api_enabled" BOOLEAN NOT NULL DEFAULT false,
    "integration_api_token" TEXT,
    "carry_over" INTEGER DEFAULT 0,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "last_name_first" BOOLEAN NOT NULL DEFAULT false,
    "payroll_close_time" INTEGER NOT NULL DEFAULT 10,
    "first_day_of_week" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "department_supervisors" (
    "created_at" DATETIME NOT NULL,
    "department_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    PRIMARY KEY ("department_id", "user_id"),
    CONSTRAINT "department_supervisors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "department_supervisors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "departments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "allowance" REAL NOT NULL DEFAULT 20,
    "personal" REAL NOT NULL DEFAULT 5,
    "include_public_holidays" BOOLEAN NOT NULL DEFAULT true,
    "is_accrued_allowance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "company_id" INTEGER NOT NULL,
    "manager_id" INTEGER,
    CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_audits" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    CONSTRAINT "email_audits_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#ffffff',
    "use_allowance" BOOLEAN NOT NULL DEFAULT true,
    "use_personal" BOOLEAN NOT NULL DEFAULT false,
    "limit" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "company_id" INTEGER NOT NULL,
    "manager_only" BOOLEAN NOT NULL DEFAULT false,
    "is_special" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "leave_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" INTEGER NOT NULL,
    "employee_comment" TEXT,
    "approver_comment" TEXT,
    "decided_at" DATETIME,
    "date_start" DATETIME NOT NULL,
    "day_part_start" INTEGER NOT NULL DEFAULT 1,
    "date_end" DATETIME NOT NULL,
    "day_part_end" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "user_id" INTEGER NOT NULL,
    "approver_id" INTEGER,
    "leave_type_id" INTEGER NOT NULL,
    CONSTRAINT "leaves_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "leaves_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "leaves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "monday" INTEGER NOT NULL DEFAULT 1,
    "tuesday" INTEGER NOT NULL DEFAULT 1,
    "wednesday" INTEGER NOT NULL DEFAULT 1,
    "thursday" INTEGER NOT NULL DEFAULT 1,
    "friday" INTEGER NOT NULL DEFAULT 1,
    "saturday" INTEGER NOT NULL DEFAULT 2,
    "sunday" INTEGER NOT NULL DEFAULT 2,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "company_id" INTEGER,
    "user_id" INTEGER,
    CONSTRAINT "schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_allowance_adjustment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "year" INTEGER NOT NULL DEFAULT 2024,
    "adjustment" REAL NOT NULL DEFAULT 0,
    "personal_adjustment" REAL NOT NULL DEFAULT 0,
    "carried_over_allowance" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL,
    "user_id" INTEGER NOT NULL,
    CONSTRAINT "user_allowance_adjustment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_feeds" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "feed_token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "user_id" INTEGER NOT NULL,
    CONSTRAINT "user_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "slack_username" TEXT DEFAULT '',
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastname" TEXT NOT NULL,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "manager" BOOLEAN NOT NULL DEFAULT false,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "reset_password_token" TEXT,
    "reset_password_expires" DATETIME,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "company_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,
    CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    CONSTRAINT "user_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

-- CreateIndex
CREATE INDEX "user_messages_company_id" ON "user_messages"("company_id");

-- CreateIndex
CREATE INDEX "user_messages_user_id" ON "user_messages"("user_id");
