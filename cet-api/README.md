# CETNova API operations

## Permanent mock-test deletion

Apply `../supabase/migrations/20261010_delete_mock_test_and_results.sql` to the
Supabase project before deploying the API changes. Deleting a mock test then
permanently removes its schedules, attempts, and linked results in one
transaction.

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

## Python SMTP email

Apply `../supabase/migrations/20261011_brevo_email_notifications.sql` to the
Supabase project before deploying the API, followed by
`../supabase/migrations/20261012_account_setup_email_retry.sql` and
`../supabase/migrations/20261013_initial_temporary_password.sql`. The migrations
add the durable email outbox, idempotency keys, encrypted recoverable account
setup tokens, first-login temporary-password cleanup, and optional guardian
email and consent fields. The
`cet-portal-scheduler` worker processes persisted email retries. Both it and the
API call a separately deployed Python SMTP mailer over an authenticated HTTP
connection.

Set these backend-only environment variables in Render:

- On the API and scheduler: `PYTHON_EMAIL_SERVICE_URL`,
  `PYTHON_EMAIL_SERVICE_TOKEN`, `EMAIL_SENDER_EMAIL`, and `EMAIL_SENDER_NAME`.
- On the Python mailer: the same `PYTHON_EMAIL_SERVICE_TOKEN`,
  `EMAIL_SMTP_HOST` (`smtp.gmail.com`), `EMAIL_SMTP_PORT` (`587`),
  `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, and `EMAIL_SMTP_FROM`.
- `EMAIL_TOKEN_ENCRYPTION_KEY`: a random secret of at least 32 characters,
  identical on the API and scheduler, used to encrypt setup-link tokens and
  temporary passwords at rest.
- `FRONTEND_URL`: the deployed frontend origin, used for login and report links.
- `PUBLIC_API_URL`: the public API origin, used for expiring parent report links.

Do not put secrets in Vite variables, the frontend, or committed files. Use a
fresh, long random `PYTHON_EMAIL_SERVICE_TOKEN` on the mailer, API, and
scheduler. For Gmail, enable two-step verification and generate an app
password; use that app password for `EMAIL_SMTP_PASSWORD`, not the normal
account password. Rotate any app password that has been pasted into a chat or
other shared system.

For local development, copy `.env.example` to `.env`, configure the mailer
variables with local secrets, then run `python python-email-service/server.py`
from `cet-api` in one terminal and the Node API in another. The Python service
loads `cet-api/.env` for local runs and listens on `127.0.0.1` by default;
Render sets `EMAIL_SERVICE_HOST=0.0.0.0` so its proxy can reach the service.

Deploy the Python mailer from the included `render.yaml` alongside the API and
scheduler. Set the same service token in all three services. After deployment,
open **Admin → Settings → Notifications**, check the Python email service, and
send a test email to the signed-in administrator. SMTP acceptance means the
mail server accepted the message; it does not confirm delivery to the final
mailbox because SMTP has no delivery callback in this setup.

All transactional and application-rejection email uses this Python mailer.
Failed messages remain in the admin delivery log and can be retried. Uncertain
SMTP outcomes are not automatically resent to avoid accidental duplicates.

Run focused email checks from `cet-api` with:

```text
npm test -- test/python-email-service.test.js test/email-account-setup.test.js test/email-templates.test.js test/email-welcome-retry.test.js test/result-email-trigger.test.js
python -m unittest discover -s python-email-service -p "test_*.py"
```

If a welcome-email enqueue fails, the student's existing unexpired setup token
is retained encrypted in the database. The administrator can use **Resend setup
email** to enqueue the same link again; it does not clear an existing password,
create another account, or invalidate the valid token.

Result emails are generated from the saved backend result and are idempotent
per result; frontend result submissions also reuse a persisted submission key
when retried. On approval, students receive a randomly generated temporary password by email
and must change it after their first sign-in. The API stores only a password
hash and an AES-GCM encrypted copy; administrators can reveal it from the
student profile only until the first successful sign-in, when it is removed
from both the user record and any queued welcome email. The admin **Resend
setup email** action continues to send a single-use password setup link.
Students may add a guardian email and opt in
from their profile; parent emails remain disabled until an administrator
enables them. Parent report links expire after seven days.

API logs include the operation, HTTP status, and a sanitized message; they
never include credentials or setup tokens.

## Notes-to-questions AI

Notes question generation uses OpenAI chat completions. Set `OPENAI_API_KEY` as
a secret environment variable on the API service (and locally in
`cet-api/.env`). `NOTES_QUESTION_MODEL` is optional; it defaults to
`gpt-4o-mini`. Do not put provider keys in source code, frontend configuration,
or committed files. Other AI features may still use OpenRouter.
