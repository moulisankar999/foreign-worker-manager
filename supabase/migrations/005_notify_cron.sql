-- 005: schedules for notifications (needs pg_cron + pg_net and vault secrets 'fwm_functions_url', 'fwm_cron_secret').
-- Every 5 minutes: queue time-based reminders (expiry, overdue approvals/proof/passports, digest) and run the dispatcher.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('fwm-notify-sweep', 'fwm-notify-dispatch');
select cron.schedule('fwm-notify-sweep', '*/5 * * * *', $$select public.notify_sweep()$$);
select cron.schedule('fwm-notify-dispatch', '2-59/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_functions_url') || '/notify-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_cron_secret')),
    body := '{"source":"cron"}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from public.notification_deliveries where status = 'queued' and next_attempt_at <= now())
    and exists (select 1 from vault.decrypted_secrets where name = 'fwm_functions_url')
$$);
select jobname, schedule from cron.job where jobname like 'fwm-notify%';
