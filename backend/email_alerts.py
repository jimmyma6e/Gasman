"""Sends price alert emails via Gmail SMTP (an App Password, not your
regular Gmail password — generate one at myaccount.google.com/apppasswords).

Configure via env vars on the deploy host:
  SMTP_USER          — the Gmail address to send from (also the envelope
                        sender Gmail actually validates against)
  SMTP_APP_PASSWORD  — the 16-character App Password
  ALERT_FROM_EMAIL   — optional, defaults to SMTP_USER. Gmail rejects a
                        From address that isn't the authenticated account
                        or a verified "Send mail as" alias on it (Gmail
                        Settings → Accounts → Send mail as) — set this only
                        to an address you've verified there.
  ALERT_FROM_NAME    — optional display name shown instead of the raw
                        address (e.g. "GASMAN Alerts"), no Gmail-side setup
                        needed since the underlying address is unchanged.

Sending is a no-op (logged, not an error) when unconfigured, so the rest of
the alert feature — creating/listing/evaluating alerts — works even before
SMTP is set up.
"""

import logging
import os
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_APP_PASSWORD = os.environ.get("SMTP_APP_PASSWORD")
ALERT_FROM_EMAIL = os.environ.get("ALERT_FROM_EMAIL") or SMTP_USER
ALERT_FROM_NAME = os.environ.get("ALERT_FROM_NAME", "GASMAN Alerts")


def send_alert_email(to_email: str, subject: str, body: str) -> bool:
    if not SMTP_USER or not SMTP_APP_PASSWORD:
        logger.warning("send_alert_email: SMTP_USER/SMTP_APP_PASSWORD not configured — skipping send to %s", to_email)
        return False

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = formataddr((ALERT_FROM_NAME, ALERT_FROM_EMAIL))
    msg["To"] = to_email

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_APP_PASSWORD)
            server.sendmail(ALERT_FROM_EMAIL, [to_email], msg.as_string())
        return True
    except Exception:
        logger.exception("send_alert_email: failed to send to %s", to_email)
        return False
