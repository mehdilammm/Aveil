-- Every minute, pg_cron asks pg_net to POST /api/jobs/tick with the X-Jobs-Secret header.
-- The secret is read from Vault when the job runs, so it is never stored in cron.job.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'agentscope-jobs-tick';

select cron.schedule(
  'agentscope-jobs-tick',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://agentscope-peach.vercel.app/api/jobs/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Jobs-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
