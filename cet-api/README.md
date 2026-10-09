# CETNova API operations

## Persistent mock-test scheduling

Apply `../supabase/migrations/20261009_persistent_mock_test_scheduling.sql` to the
Supabase project before deploying the API or scheduler changes. The migration
adds the persisted schedule states and timestamps, supports expired attempts,
and makes result creation idempotent per attempt.

Deploy the `cet-portal-scheduler` Render background worker declared in
`../render.yaml` alongside the API. Configure `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` on the worker; the worker needs the service-role
key to process assignments and attempts. The worker scans persisted schedules
every 15 seconds, activates due `mock_tests` records, and processes assigned
schedule records. Due schedules are recovered after a worker restart or
temporary outage. Do not replace it with a web-process-only timer.

The student APIs independently enforce assignment start, expiry, and attempt
deadlines. The worker updates persisted state, closes active attempts, and
retries pending result evaluation. Schedule times are stored as UTC instants;
the selected IANA time zone is retained for display and input conversion.

There is no notification service wired into this project, so schedule
activation does not send student notifications.
