-- Add performance indexes for /users route optimization
-- These indexes significantly improve query performance without changing any functionality

-- Most critical: Composite index for leaves queries
-- Covers: WHERE user_id = X AND status IN (...) AND date_start/date_end BETWEEN ...
CREATE INDEX IF NOT EXISTS idx_leaves_user_status_dates ON leaves(user_id, status, date_start, date_end);

-- Date range queries with status filter (for OR conditions)
CREATE INDEX IF NOT EXISTS idx_leaves_date_start_status ON leaves(date_start, status);
CREATE INDEX IF NOT EXISTS idx_leaves_date_end_status ON leaves(date_end, status);

-- User allowance adjustments lookup
CREATE INDEX IF NOT EXISTS idx_user_allowance_user_year ON user_allowance_adjustment(user_id, year);

-- Active users filtering (end_date queries)
CREATE INDEX IF NOT EXISTS idx_users_end_date ON users(company_id, end_date);

-- Email lookups (user search)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Company and department filtering with lastname ordering
CREATE INDEX IF NOT EXISTS idx_users_company_dept ON users(company_id, department_id, lastname);