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

- On `cet-portal-api` and `cet-portal-scheduler`: `PYTHON_EMAIL_SERVICE_URL`
  (Python mailer base URL, without `/health` or `/send`),
  `PYTHON_EMAIL_SERVICE_TOKEN` (same value as on the mailer),
  `EMAIL_SENDER_EMAIL`, `EMAIL_SENDER_NAME`, and the same stable
  `EMAIL_TOKEN_ENCRYPTION_KEY` (at least 32 characters). Only Node API and
  scheduler use the encryption key; it protects setup tokens and temporary
  passwords with AES-256-GCM.
- On `cet-portal-python-mailer`: the same `PYTHON_EMAIL_SERVICE_TOKEN`,
  `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USERNAME`,
  `EMAIL_SMTP_PASSWORD`, and `EMAIL_SMTP_FROM`. For Gmail use host
  `smtp.gmail.com`, port `587` (STARTTLS) or `465` (implicit TLS), and an
  app password. `render.yaml` sets `EMAIL_SERVICE_HOST=0.0.0.0`; Render
  supplies `PORT`.
- On the API: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
  `FRONTEND_URL`, and other API variables listed in `render.yaml`.
- On the scheduler: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `FRONTEND_URL`/`CLIENT_URL`, and `PUBLIC_API_URL` for parent report links.
- On Vercel, set the public `VITE_API_URL` to the Node API origin if it differs
  from the default in `src/lib/api.ts`. Never place backend tokens, encryption
  keys, SMTP passwords, or Supabase service-role credentials in Vite variables.

`EMAIL_SERVICE_URL` is not used in this repository; the existing name is
`PYTHON_EMAIL_SERVICE_URL`. SMTP configuration comes from environment
variables, not Supabase. Supabase stores delivery/outbox state in
`email_notifications`, setup-token hashes and encrypted token copies in
`account_setup_tokens`, and email feature toggles in `system_settings`.

Do not put secrets in Vite variables, the frontend, or committed files. Use a
fresh, long random `PYTHON_EMAIL_SERVICE_TOKEN` on the mailer, API, and
scheduler. For Gmail, enable two-step verification and generate an app
password; use that app password for `EMAIL_SMTP_PASSWORD`, not the normal
account password. Rotate any app password that has been pasted into a chat or
other shared system. In Render's environment editor, enter values only (do
not include `.env` quote marks); paste Gmail's app password without grouping
spaces.

For local development, copy `.env.example` to `.env`, configure the mailer
variables with local secrets, then run `python python-email-service/server.py`
from `cet-api` in one terminal and the Node API in another. The Python service
loads `cet-api/.env` for local runs and listens on `127.0.0.1` by default;
Render sets `EMAIL_SERVICE_HOST=0.0.0.0` so its proxy can reach the service.

Deploy the Python mailer from the included `render.yaml` alongside the API and
scheduler. Set the same service token in all three services. The public
`GET /health` endpoint checks liveness only. Authenticated `GET /ready` reports
whether required SMTP configuration values are present; it does not connect
to SMTP. In **Admin → Settings → Notifications**, use **Check Python email
service** for liveness/configuration, then **Send test email to my admin
address** to attempt a real send. The test recipient is the email address on
the signed-in administrator's `users` profile; a missing or invalid profile
email stops the send.

Pre-submission SMTP failures mean no email was sent. Mailer logs distinguish
DNS, refused connection, timeout, TLS, authentication, and SMTP response
failures without logging credentials or message content. If the Render plan
or network cannot establish outbound SMTP, use a transactional provider's
HTTPS API through a deliberate implementation change rather than retrying
blocked SMTP indefinitely. SMTP acceptance is not final mailbox delivery.

Keep `EMAIL_TOKEN_ENCRYPTION_KEY` stable. If the original key is available,
restore it on API and scheduler to recover existing ciphertext. If it is lost,
an authorized admin can use **Resend setup email** and explicitly confirm the
reset prompt; this invalidates only that student's unrecoverable active setup
token and issues a new link. No user or unrelated row is deleted. Temporary
passwords encrypted under a lost key cannot be recovered; reset the password
through the authorized account workflow.

All transactional and application-rejection email uses this Python mailer.
Failed messages remain in the admin delivery log and can be retried. Uncertain
SMTP outcomes are not automatically resent to avoid accidental duplicates.

Run focused email checks from `cet-api` with:

```text
npm test -- test/python-email-service.test.js test/email-account-setup.test.js test/email-templates.test.js test/email-welcome-retry.test.js test/result-email-trigger.test.js
python -m unittest discover -s python-email-service -p "test_*.py"
```

The Python mailer uses only the standard library; this repository does not
have a Python `requirements.txt`. Keep production secrets out of `.env.example`
and Git. Rotate any credentials exposed in chat or logs. Rotate the encryption
key only with an explicit plan for existing encrypted records.

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
