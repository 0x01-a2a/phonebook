-- Manual migration: add claim email verification columns
-- Run if db:push fails: psql $DATABASE_URL -f packages/database/migrations/manual_claim_email.sql

ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_email_code VARCHAR(10);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_email_code_expires TIMESTAMP;
