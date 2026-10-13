import http.client
import json
import socket
import ssl
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
        diagnostics = server.configuration_diagnostics({**TEST_ENV, "EMAIL_SMTP_PASSWORD": ""})
        self.assertEqual(diagnostics, {"configured": False, "missing": ["EMAIL_SMTP_PASSWORD"]})

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

    @patch("server.smtplib.SMTP_SSL")
    def test_port_465_uses_implicit_tls(self, smtp_class):
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        payload = {
            "to": [{"email": "student@example.test"}],
            "subject": "Test subject",
            "htmlContent": "<p>Hello</p>",
            "textContent": "Hello",
        }
        server.send_email(payload, {**TEST_ENV, "EMAIL_SMTP_PORT": "465"})

        smtp_class.assert_called_once()
        smtp.login.assert_called_once_with("sender@example.test", "test-only-password")
        smtp.send_message.assert_called_once()
        smtp.starttls.assert_not_called()

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
        smtp_class.side_effect = ConnectionRefusedError("connection refused")
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
        self.assertEqual(raised.exception.category, "smtp_connection_refused")
        self.assertIn("no email was submitted", str(raised.exception))

    @patch("server.smtplib.SMTP")
    def test_smtp_dns_failure_is_reported_without_host_details(self, smtp_class):
        smtp_class.side_effect = socket.gaierror("sensitive DNS details")
        with self.assertRaises(server.EmailDeliveryError) as raised:
            server.send_email({
                "to": [{"email": "student@example.test"}],
                "subject": "Test",
                "htmlContent": "<p>Test</p>",
                "textContent": "Test",
            }, TEST_ENV)
        self.assertEqual(raised.exception.category, "smtp_dns")
        self.assertNotIn("sensitive DNS details", str(raised.exception))

    @patch("server.smtplib.SMTP")
    def test_smtp_timeout_is_classified_separately(self, smtp_class):
        smtp_class.side_effect = TimeoutError("socket timed out")
        with self.assertRaises(server.EmailDeliveryError) as raised:
            server.send_email({
                "to": [{"email": "student@example.test"}],
                "subject": "Test",
                "htmlContent": "<p>Test</p>",
                "textContent": "Test",
            }, TEST_ENV)
        self.assertEqual(raised.exception.category, "smtp_timeout")

    @patch("server.smtplib.SMTP")
    def test_smtp_tls_failure_is_classified_separately(self, smtp_class):
        smtp = MagicMock()
        smtp_class.return_value.__enter__.return_value = smtp
        smtp.starttls.side_effect = ssl.SSLError("private TLS diagnostics")
        with self.assertRaises(server.EmailDeliveryError) as raised:
            server.send_email({
                "to": [{"email": "student@example.test"}],
                "subject": "Test",
                "htmlContent": "<p>Test</p>",
                "textContent": "Test",
            }, TEST_ENV)
        self.assertEqual(raised.exception.category, "smtp_tls")
        self.assertNotIn("private TLS diagnostics", str(raised.exception))


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

    def _get(self, path, token=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port)
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        result = json.loads(response.read())
        connection.close()
        return response.status, result

    def test_health_endpoint_is_public_liveness_only(self):
        status, body = self._get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok"})

    def test_readiness_endpoint_requires_service_token(self):
        status, body = self._get("/ready")
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "Unauthorized.")

        status, body = self._get("/ready", TEST_ENV["PYTHON_EMAIL_SERVICE_TOKEN"])
        self.assertEqual(status, 200)
        self.assertTrue(body["configured"])
        self.assertEqual(body["missing"], [])


if __name__ == "__main__":
    unittest.main()
