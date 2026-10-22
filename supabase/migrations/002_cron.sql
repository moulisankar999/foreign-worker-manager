-- Daily phone alerts at 08:00 Malaysia time (00:00 UTC).
-- The shared secret lives in Supabase Vault as 'fwm_cron_secret' (created separately, never committed).
select cron.unschedule('fwm-daily-alerts') where exists (select 1 from cron.job where jobname = 'fwm-daily-alerts');
select cron.schedule('fwm-daily-alerts', '0 0 * * *', $$
  select net.http_post(
    url := 'https://gnepquxtwkyffjmoydnv.supabase.co/functions/v1/daily-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
