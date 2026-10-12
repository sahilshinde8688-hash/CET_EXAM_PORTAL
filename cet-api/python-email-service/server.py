import hmac
import json
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class EmailDeliveryError(Exception):
    def __init__(self, message, *, retryable=False, uncertain=False, status_code=502):
        super().__init__(message)
        self.retryable = retryable
        self.uncertain = uncertain
        self.status_code = status_code


def load_local_environment():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def mailer_configuration(environ=None):
    values = os.environ if environ is None else environ
    try:
        port = int(values.get("EMAIL_SMTP_PORT", "587"))
    except ValueError:
        port = 0
    return {
        "host": values.get("EMAIL_SMTP_HOST", "").strip(),
        "port": port,
        "username": values.get("EMAIL_SMTP_USERNAME", "").strip(),
        "password": values.get("EMAIL_SMTP_PASSWORD", ""),
        "sender": values.get("EMAIL_SMTP_FROM", "").strip()
        or values.get("EMAIL_SMTP_USERNAME", "").strip(),
        "sender_name": values.get("EMAIL_SENDER_NAME", "CETNova").strip() or "CETNova",
        "service_token": values.get("PYTHON_EMAIL_SERVICE_TOKEN", ""),
    }


def is_configured(environ=None):
    config = mailer_configuration(environ)
    return bool(
        config["host"]
        and 1 <= config["port"] <= 65535
        and EMAIL_PATTERN.fullmatch(config["username"])
        and config["password"]
        and EMAIL_PATTERN.fullmatch(config["sender"])
        and config["service_token"]
    )


def local_service_port(environ=None):
    values = os.environ if environ is None else environ
    host = values.get("EMAIL_SERVICE_HOST", "127.0.0.1")
    service_port = values.get("EMAIL_SERVICE_PORT")
    render_port = values.get("PORT") if host == "0.0.0.0" else None
    return int(service_port or render_port or "8000")


def send_email(payload, environ=None):
    config = mailer_configuration(environ)
    if not is_configured(environ):
        raise EmailDeliveryError("Python mailer SMTP configuration is incomplete.", status_code=503)
    if not isinstance(payload, dict):
        raise EmailDeliveryError("Email payload must be an object.", status_code=400)

    recipients = payload.get("to")
    if (
        not isinstance(recipients, list)
        or not recipients
        or any(
            not isinstance(recipient, dict)
            or not isinstance(recipient.get("email"), str)
            or not EMAIL_PATTERN.fullmatch(recipient["email"])
            for recipient in recipients
        )
    ):
        raise EmailDeliveryError("The notification recipient address is invalid.", status_code=400)

    subject = payload.get("subject")
    html_content = payload.get("htmlContent")
    text_content = payload.get("textContent")
    if (
        not isinstance(subject, str)
        or not subject.strip()
        or "\r" in subject
        or "\n" in subject
        or not isinstance(html_content, str)
        or not isinstance(text_content, str)
    ):
        raise EmailDeliveryError("Email subject and message content are required.", status_code=400)

    message = EmailMessage()
    message["Subject"] = subject.strip()
    sender_name = config["sender_name"].replace("\r", " ").replace("\n", " ")
    message["From"] = formataddr((sender_name, config["sender"]))
    message["To"] = ", ".join(
        formataddr(
            (
                str(recipient.get("name") or "").replace("\r", " ").replace("\n", " "),
                recipient["email"],
            )
        )
        for recipient in recipients
    )
    message["Message-ID"] = make_msgid()
    message.set_content(text_content)
    message.add_alternative(html_content, subtype="html")

    send_started = False
    try:
        context = ssl.create_default_context()
        if config["port"] == 465:
            with smtplib.SMTP_SSL(config["host"], config["port"], timeout=20, context=context) as smtp:
                smtp.login(config["username"], config["password"])
                send_started = True
                smtp.send_message(message)
        else:
            with smtplib.SMTP(config["host"], config["port"], timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
                smtp.login(config["username"], config["password"])
                send_started = True
                smtp.send_message(message)
    except smtplib.SMTPAuthenticationError as error:
        raise EmailDeliveryError(
            "SMTP authentication failed. Check the mailer username and app password.",
            status_code=502,
        ) from error
    except smtplib.SMTPRecipientsRefused as error:
        retryable = any(
            400 <= int(response[0]) < 500
            for response in error.recipients.values()
            if isinstance(response, tuple) and response
        )
        raise EmailDeliveryError(
            "The SMTP server rejected the recipient.",
            retryable=retryable,
            status_code=503 if retryable else 502,
        ) from error
    except smtplib.SMTPResponseException as error:
        retryable = 400 <= error.smtp_code < 500
        raise EmailDeliveryError(
            "The SMTP server rejected the email.",
            retryable=retryable,
            status_code=503 if retryable else 502,
        ) from error
    except (TimeoutError, OSError, smtplib.SMTPServerDisconnected) as error:
        if not send_started:
            raise EmailDeliveryError(
                "Could not connect to the SMTP server before sending; no email was submitted.",
                retryable=True,
                status_code=503,
            ) from error
        raise EmailDeliveryError(
            "The SMTP connection closed during sending; delivery status is unknown.",
            uncertain=True,
            status_code=502,
        ) from error
    except smtplib.SMTPException as error:
        raise EmailDeliveryError(
            "The SMTP server could not process the email.",
            status_code=502,
        ) from error

    return {"messageId": message["Message-ID"]}


class MailerHandler(BaseHTTPRequestHandler):
    server_version = "CETNovaPythonMailer/1.0"

    def _authorized(self):
        token = mailer_configuration()["service_token"]
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {token}" if token else ""
        return bool(expected) and hmac.compare_digest(supplied, expected)

    def _respond(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path != "/health":
            self._respond(404, {"error": "Not found."})
            return
        if not self._authorized():
            self._respond(401, {"error": "Unauthorized."})
            return
        configured = is_configured()
        self._respond(
            200 if configured else 503,
            {
                "status": "ok" if configured else "not_configured",
                "configured": configured,
            },
        )

    def do_POST(self):
        if urlparse(self.path).path != "/send":
            self._respond(404, {"error": "Not found."})
            return
        if not self._authorized():
            self._respond(401, {"error": "Unauthorized."})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._respond(400, {"error": "Invalid content length."})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self._respond(413, {"error": "Email request size is invalid."})
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
            result = send_email(payload)
            self._respond(202, result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._respond(400, {"error": "Request body must contain valid JSON."})
        except EmailDeliveryError as error:
            print(
                "[python-mailer] Email send failed: "
                f"status={error.status_code} retryable={error.retryable} "
                f"uncertain={error.uncertain} detail={error}"
            )
            self._respond(
                error.status_code,
                {
                    "error": str(error),
                    "retryable": error.retryable,
                    "uncertain": error.uncertain,
                },
            )

    def log_message(self, format_string, *args):
        print(f"[python-mailer] {self.address_string()} {format_string % args}")


def main():
    load_local_environment()
    host = os.environ.get("EMAIL_SERVICE_HOST", "127.0.0.1")
    port = local_service_port()
    server = ThreadingHTTPServer((host, port), MailerHandler)
    print(f"[python-mailer] Listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
