-- 適用日: 2026-09-23
-- Preserve existing opt-ins as browser subscriptions; clients promote installed app contexts.
ALTER TABLE public.room_push_subscriptions
  ADD COLUMN delivery_channel text NOT NULL DEFAULT 'browser'
  CHECK (delivery_channel IN ('pwa', 'app', 'browser'));
