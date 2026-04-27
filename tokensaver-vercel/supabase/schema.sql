-- ============================================================================
-- TokenSaver Supabase Schema
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================================================
-- 1. USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
    compressions_today INT DEFAULT 0,
    compressions_total INT DEFAULT 0,
    tokens_saved_total INT DEFAULT 0,
    last_reset_date DATE DEFAULT current_date,
    stripe_customer_id TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- ============================================================================
-- 2. USAGE_LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('compress', 'continue', 'summarize', 'split')),
    original_tokens INT NOT NULL,
    compressed_tokens INT NOT NULL,
    tokens_saved INT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('claude', 'chatgpt', 'vscode')),
    created_at TIMESTAMP DEFAULT now()
);

-- ============================================================================
-- 3. SUBSCRIPTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('pro_monthly', 'pro_yearly', 'team')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'lapsed')),
    current_period_end TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- ============================================================================
-- 4. INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON public.usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON public.usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) - ENABLE
-- ============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. RLS POLICIES - USERS TABLE
-- ============================================================================
-- Users can read only their own data
CREATE POLICY "Users can read own data"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

-- Users can update only their own data
CREATE POLICY "Users can update own data"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

-- Authenticated users can insert
CREATE POLICY "Authenticated users can insert"
    ON public.users FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 7. RLS POLICIES - USAGE_LOGS TABLE
-- ============================================================================
-- Users can read only their own usage logs
CREATE POLICY "Users can read own usage logs"
    ON public.usage_logs FOR SELECT
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE auth.uid() = id
        )
    );

-- Users can insert their own usage logs
CREATE POLICY "Users can insert own usage logs"
    ON public.usage_logs FOR INSERT
    WITH CHECK (
        user_id IN (
            SELECT id FROM public.users WHERE auth.uid() = id
        )
    );

-- ============================================================================
-- 8. RLS POLICIES - SUBSCRIPTIONS TABLE
-- ============================================================================
-- Users can read only their own subscriptions
CREATE POLICY "Users can read own subscriptions"
    ON public.subscriptions FOR SELECT
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE auth.uid() = id
        )
    );

-- Users can insert their own subscriptions
CREATE POLICY "Users can insert own subscriptions"
    ON public.subscriptions FOR INSERT
    WITH CHECK (
        user_id IN (
            SELECT id FROM public.users WHERE auth.uid() = id
        )
    );

-- Users can update their own subscriptions
CREATE POLICY "Users can update own subscriptions"
    ON public.subscriptions FOR UPDATE
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE auth.uid() = id
        )
    );

-- ============================================================================
-- 9. HELPER FUNCTION FOR UPDATING UPDATED_AT
-- ============================================================================
-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at columns
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 10. FUNCTION FOR DAILY RESET OF COMPRESSIONS
-- ============================================================================
-- Create a function that resets compressions_today to 0 for users whose last_reset_date is not today
CREATE OR REPLACE FUNCTION public.reset_daily_compressions()
RETURNS void AS $$
BEGIN
    UPDATE public.users
    SET compressions_today = 0,
        last_reset_date = current_date
    WHERE last_reset_date < current_date;
END;
$$ LANGUAGE plpgsql;

-- Schedule the reset function to run daily at midnight UTC
-- This creates a cron job that executes the reset function every day at 00:00 UTC
-- Uncomment this line after verifying pg_cron is enabled:
-- SELECT cron.schedule('reset-daily-compressions', '0 0 * * *', 'SELECT public.reset_daily_compressions()');

-- ============================================================================
-- 11. TABLE COMMENTS FOR DOCUMENTATION
-- ============================================================================
COMMENT ON TABLE public.users IS 'Stores user account information and usage statistics';
COMMENT ON TABLE public.usage_logs IS 'Logs of every compression/split/summarize/continue action';
COMMENT ON TABLE public.subscriptions IS 'Stripe subscription information for users';

COMMENT ON COLUMN public.users.plan IS 'User subscription tier: free, pro, or team';
COMMENT ON COLUMN public.users.compressions_today IS 'Number of compressions performed today (resets daily)';
COMMENT ON COLUMN public.users.compressions_total IS 'Total lifetime compressions';
COMMENT ON COLUMN public.users.tokens_saved_total IS 'Total tokens saved across all compressions';
COMMENT ON COLUMN public.usage_logs.action IS 'Type of action: compress, continue, summarize, or split';
COMMENT ON COLUMN public.usage_logs.platform IS 'Platform where action was performed: claude, chatgpt, or vscode';
COMMENT ON COLUMN public.subscriptions.status IS 'Current subscription status: active, cancelled, or lapsed';
