-- Migration: Add rewards and subscription system
-- Date: 2026-04-25

-- ─────────────────────────────────────────────
-- 1. Add subscriptionTier to users table
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tier_enum') THEN
    CREATE TYPE plan_tier_enum AS ENUM ('free', 'basic', 'pro', 'max');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "subscriptionTier" plan_tier_enum NOT NULL DEFAULT 'free';

-- ─────────────────────────────────────────────
-- 2. subscription_plans
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan_name_enum') THEN
    CREATE TYPE subscription_plan_name_enum AS ENUM ('free', 'basic', 'pro', 'max');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            subscription_plan_name_enum NOT NULL UNIQUE,
  "displayName"   VARCHAR NOT NULL,
  "priceMonthly"  NUMERIC NOT NULL,
  currency        VARCHAR NOT NULL DEFAULT 'PKR',
  "lsVariantId"   VARCHAR,
  features        TEXT NOT NULL,
  "roomLimit"     INTEGER NOT NULL,
  "noteLimit"     INTEGER NOT NULL,
  "hasLectureSummary" BOOLEAN NOT NULL DEFAULT FALSE,
  "hasFocusTracker"   BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────────
-- 3. user_subscriptions
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
    CREATE TYPE subscription_status_enum AS ENUM ('active', 'cancelled', 'expired', 'past_due', 'trialing');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"                    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  "planId"                    UUID NOT NULL REFERENCES subscription_plans(id),
  status                      subscription_status_enum NOT NULL DEFAULT 'active',
  "lsSubscriptionId"          VARCHAR UNIQUE,
  "lsCustomerId"              VARCHAR,
  "currentPeriodStart"        TIMESTAMP,
  "currentPeriodEnd"          TIMESTAMP,
  "cancelAtPeriodEnd"         BOOLEAN NOT NULL DEFAULT FALSE,
  "appliedDiscountPercentage" INTEGER NOT NULL DEFAULT 0,
  "createdAt"                 TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"                 TIMESTAMP NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 4. payment_records
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
    CREATE TYPE payment_status_enum AS ENUM ('paid', 'failed', 'refunded');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "subscriptionId" UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  "amountPkr"      NUMERIC NOT NULL,
  status           payment_status_enum NOT NULL,
  "lsOrderId"      VARCHAR,
  "invoiceUrl"     VARCHAR,
  "paidAt"         TIMESTAMP,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 5. badges
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'badge_tier_enum') THEN
    CREATE TYPE badge_tier_enum AS ENUM ('daily', 'weekly', 'monthly');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS badges (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR NOT NULL UNIQUE,
  description          TEXT NOT NULL,
  icon                 VARCHAR NOT NULL,
  tier                 badge_tier_enum NOT NULL,
  "discountPercentage" INTEGER NOT NULL,
  "isActive"           BOOLEAN NOT NULL DEFAULT TRUE
);

-- ─────────────────────────────────────────────
-- 6. user_badges
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_badges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "badgeId"         UUID NOT NULL REFERENCES badges(id),
  "earnedAt"        TIMESTAMP NOT NULL,
  "lsDiscountCode"  VARCHAR,
  "isRedeemed"      BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 7. user_streaks
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_streaks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "currentStreak"     INTEGER NOT NULL DEFAULT 0,
  "longestStreak"     INTEGER NOT NULL DEFAULT 0,
  "lastActivityDate"  DATE,
  "updatedAt"         TIMESTAMP NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 8. user_challenge_progress
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_type_enum') THEN
    CREATE TYPE challenge_type_enum AS ENUM ('daily', 'weekly', 'monthly');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_challenge_progress (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "challengeType"    challenge_type_enum NOT NULL,
  "periodStart"      DATE NOT NULL,
  "currentCount"     INTEGER NOT NULL DEFAULT 0,
  "isCompleted"      BOOLEAN NOT NULL DEFAULT FALSE,
  "completedAt"      TIMESTAMP,
  "consecutiveCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"        TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE ("userId", "challengeType", "periodStart")
);

CREATE INDEX IF NOT EXISTS idx_user_challenge_progress_user ON user_challenge_progress ("userId");
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions ("userId");
CREATE INDEX IF NOT EXISTS idx_payment_records_user ON payment_records ("userId");
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges ("userId");
CREATE INDEX IF NOT EXISTS idx_user_streaks_user ON user_streaks ("userId");

-- ─────────────────────────────────────────────
-- 9. Seed: subscription_plans
-- ─────────────────────────────────────────────
INSERT INTO subscription_plans (name, "displayName", "priceMonthly", currency, features, "roomLimit", "noteLimit", "hasLectureSummary", "hasFocusTracker", "isActive")
VALUES
  ('free',  'Free',    0,   'PKR', '["2 rooms","5 notes","Basic calendar","Community support"]',      2,  5,  false, false, true),
  ('basic', 'Basic',   100, 'PKR', '["5 rooms","10 notes","Full calendar","Email support"]',           5,  10, false, false, true),
  ('pro',   'Pro',     200, 'PKR', '["10 rooms","20 notes","Lecture summary","Focus tracker","Priority support"]', 10, 20, true, true, true),
  ('max',   'Max',     500, 'PKR', '["50 rooms","Unlimited notes","Lecture summary","Focus tracker","Dedicated support"]', 50, -1, true, true, true)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- 10. Seed: badges
-- ─────────────────────────────────────────────
INSERT INTO badges (name, description, icon, tier, "discountPercentage", "isActive")
VALUES
  ('Daily Champion',  'Complete the daily challenge for 7 consecutive days',    'flame',   'daily',   10, true),
  ('Weekly Scholar',  'Complete the weekly challenge for 4 consecutive weeks',   'book-open', 'weekly', 20, true),
  ('Monthly Master',  'Complete the monthly challenge in a calendar month',      'trophy',  'monthly', 30, true)
ON CONFLICT (name) DO NOTHING;
