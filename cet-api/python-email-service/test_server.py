import http.client
import json
import unittest
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import MagicMock, patch

import server


TEST_ENV = {
    "EMAIL_SMTP_HOST": "smtp.example.test",
    "EMAIL_SMTP_PORT": "587",
    "EMAIL_SMTP_USERNAME": "sender@example.test",
    "EMAIL_SMTP_PASSWORD": "test-only-password",
    "EMAIL_SMTP_FROM": "sender@example.test",
    "EMAIL_SENDER_NAME": "CETNova",
    "PYTHON_EMAIL_SERVICE_TOKEN": "test-only-token",
}


class MailerTests(unittest.TestCase):
    def test_local_mailer_ignores_node_api_port(self):
        self.assertEqual(server.local_service_port({"PORT": "5000"}), 8000)
        self.assertEqual(server.local_service_port({"PORT": "5000", "EMAIL_SERVICE_PORT": "8001"}), 8001)

    def test_render_mailer_uses_platform_port(self):
        self.assertEqual(
            server.local_service_port({"PORT": "12000", "EMAIL_SERVICE_HOST": "0.0.0.0"}),
            12000,
        )

    def test_configuration_requires_a_password_and_service_token(self):
        self.assertTrue(server.is_configured(TEST_ENV))
        self.assertFalse(server.is_configured({**TEST_ENV, "EMAIL_SMTP_PASSWORD": ""}))
        self.assertFalse(server.is_configured({**TEST_ENV, "PYTHON_EMAIL_SERVICE_TOKEN": ""}))

    @patch("server.smtplib.SMTP")
    def test_sends_text_and_html_over_starttls(self, smtp_class):
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        payload = {
            "to": [{"email": "student@example.test", "name": "Student"}],
            "subject": "Test subject",
            "htmlContent": "<p>Hello</p>",
            "textContent": "Hello",
        }

        result = server.send_email(payload, TEST_ENV)

        smtp_class.assert_called_once_with("smtp.example.test", 587, timeout=20)
        smtp.starttls.assert_called_once()
        smtp.login.assert_called_once_with("sender@example.test", "test-only-password")
        smtp.send_message.assert_called_once()
        self.assertTrue(result["messageId"].startswith("<"))
        self.assertTrue(result["messageId"].endswith(">"))

    def test_rejects_bad_addresses_and_header_injection(self):
        with self.assertRaises(server.EmailDeliveryError):
            server.send_email(
                {
                    "to": [{"email": "not-an-email"}],
                    "subject": "Hello",
                    "htmlContent": "<p>Hello</p>",
                    "textContent": "Hello",
                },
                TEST_ENV,
            )
        with self.assertRaises(server.EmailDeliveryError):
            server.send_email(
                {
                    "to": [{"email": "student@example.test"}],
                    "subject": "Hello\r\nBcc: victim@example.test",
                    "htmlContent": "<p>Hello</p>",
                    "textContent": "Hello",
                },
                TEST_ENV,
            )

    @patch("server.smtplib.SMTP")
    def test_smtp_authentication_error_does_not_include_server_details(self, smtp_class):
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        smtp.login.side_effect = server.smtplib.SMTPAuthenticationError(535, b"secret provider detail")
        payload = {
            "to": [{"email": "student@example.test"}],
            "subject": "Test subject",
            "htmlContent": "<p>Hello</p>",
            "textContent": "Hello",
        }

        with self.assertRaises(server.EmailDeliveryError) as raised:
            server.send_email(payload, TEST_ENV)

        self.assertIn("authentication failed", str(raised.exception))
        self.assertNotIn("secret provider detail", str(raised.exception))

    @patch("server.smtplib.SMTP")
    def test_temporary_recipient_rejection_is_retryable(self, smtp_class):
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        smtp.send_message.side_effect = server.smtplib.SMTPRecipientsRefused(
            {"student@example.test": (450, b"temporary")}
        )
        payload = {
            "to": [{"email": "student@example.test"}],
            "subject": "Test subject",
            "htmlContent": "<p>Hello</p>",
            "textContent": "Hello",
        }

        with self.assertRaises(server.EmailDeliveryError) as raised:
            server.send_email(payload, TEST_ENV)

        self.assertTrue(raised.exception.retryable)
        self.assertEqual(raised.exception.status_code, 503)

    @patch("server.smtplib.SMTP")
    def test_smtp_connection_failure_before_send_is_retryable(self, smtp_class):
        smtp_class.side_effect = OSError("connection refused")
        payload = {
            "to": [{"email": "student@example.test"}],
            "subject": "Test subject",
            "htmlContent": "<p>Hello</p>",
            "textContent": "Hello",
        }

        with self.assertRaises(server.EmailDeliveryError) as raised:
            server.send_email(payload, TEST_ENV)

        self.assertTrue(raised.exception.retryable)
        self.assertFalse(raised.exception.uncertain)
        self.assertIn("no email was submitted", str(raised.exception))


class MailerEndpointTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(server.os.environ, TEST_ENV)
        self.environment.start()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.MailerHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.environment.stop()

    def _get_health(self, token=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port)
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        connection.request("GET", "/health", headers=headers)
        response = connection.getresponse()
        result = json.loads(response.read())
        connection.close()
        return response.status, result

    def test_health_endpoint_requires_service_token(self):
        status, body = self._get_health()
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "Unauthorized.")

        status, body = self._get_health(TEST_ENV["PYTHON_EMAIL_SERVICE_TOKEN"])
        self.assertEqual(status, 200)
        self.assertTrue(body["configured"])


if __name__ == "__main__":
    unittest.main()
