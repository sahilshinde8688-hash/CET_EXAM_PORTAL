"""
CET Prep Pro - Email Service (Python + FastAPI)
Sends approval/rejection emails with MHT-CET credentials
"""
import smtplib
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import make_msgid, formatdate
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="CET Email Service")

SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", 587))
SMTP_USER     = os.getenv("SMTP_USER")   # your Gmail address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")  # Gmail App Password


def send_email(to: str, subject: str, html_body: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"CET Prep Pro <{SMTP_USER}>"
    msg["To"]      = to
    msg["Message-ID"] = make_msgid()
    msg["Date"]    = formatdate(localtime=True)
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, to, msg.as_string())


# ── Models ────────────────────────────────────────
class ApprovalPayload(BaseModel):
    name:     str
    email:    str
    branch:   str
    mhcetId:  str
    password: str

class RejectionPayload(BaseModel):
    name:   str
    email:  str
    reason: str


# ── Approval Email ────────────────────────────────
@app.post("/send-approval")
async def send_approval(data: ApprovalPayload):
    subject = f"🎉 Welcome to CET Prep Pro — Your MHT-CET Credentials"
    html = f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family: 'Public Sans', Arial, sans-serif; background:#f8f9fa; margin:0; padding:20px;">
      <div style="max-width:560px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#005bbf,#5644d0); padding:36px 32px; text-align:center;">
          <h1 style="color:#fff; margin:0; font-size:24px; font-weight:700;">CET Prep Pro</h1>
          <p style="color:rgba(255,255,255,0.8); margin:8px 0 0; font-size:14px;">Student Portal — Account Approved</p>
        </div>

        <!-- Body -->
        <div style="padding:32px;">
          <p style="font-size:16px; color:#191c1d; margin-bottom:8px;">Hi <strong>{data.name}</strong>,</p>
          <p style="font-size:15px; color:#414754; line-height:1.6;">
            Great news! Your registration has been <strong style="color:#15803d;">approved</strong> by the admin team.
            You can now log in to CET Prep Pro using the credentials below.
          </p>

          <!-- Credentials Box -->
          <div style="background:#f3f4f5; border:1px solid #c1c6d6; border-radius:12px; padding:24px; margin:24px 0;">
            <p style="margin:0 0 6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#727785;">Your Login Credentials</p>
            <table style="width:100%; border-collapse:collapse;">
              <tr>
                <td style="padding:10px 0; font-size:14px; color:#727785; width:140px;">MHT-CET ID</td>
                <td style="padding:10px 0; font-size:18px; font-weight:800; color:#005bbf; letter-spacing:0.05em;">{data.mhcetId}</td>
              </tr>
              <tr style="border-top:1px solid #e1e3e4;">
                <td style="padding:10px 0; font-size:14px; color:#727785;">Password</td>
                <td style="padding:10px 0; font-size:18px; font-weight:800; color:#191c1d; font-family:monospace;">{data.password}</td>
              </tr>
              <tr style="border-top:1px solid #e1e3e4;">
                <td style="padding:10px 0; font-size:14px; color:#727785;">Branch</td>
                <td style="padding:10px 0; font-size:15px; font-weight:600; color:#191c1d;">{data.branch}</td>
              </tr>
            </table>
          </div>

          <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:10px; padding:14px 16px; margin-bottom:24px;">
            <p style="margin:0; font-size:13px; color:#92400e;">
              ⚠️ <strong>Important:</strong> Please change your password after your first login. Keep these credentials safe and do not share them.
            </p>
          </div>

          <a href="http://localhost:5173" style="display:inline-block; background:#005bbf; color:#fff; padding:14px 28px; border-radius:10px; font-size:14px; font-weight:700; text-decoration:none;">
            Login to CET Prep Pro →
          </a>
        </div>

        <!-- Footer -->
        <div style="background:#f8f9fa; padding:20px 32px; border-top:1px solid #e1e3e4; text-align:center;">
          <p style="margin:0; font-size:12px; color:#727785;">© 2024 CET Prep Pro. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
    """
    try:
        send_email(data.email, subject, html)
        return {"message": f"Approval email sent to {data.email}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Rejection Email ───────────────────────────────
@app.post("/send-rejection")
async def send_rejection(data: RejectionPayload):
    subject = "Update on your CET Prep Pro Registration"
    html = f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; background:#f8f9fa; margin:0; padding:20px;">
      <div style="max-width:560px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="background:#191c1d; padding:32px; text-align:center;">
          <h1 style="color:#fff; margin:0; font-size:22px;">CET Prep Pro</h1>
        </div>
        <div style="padding:32px;">
          <p style="font-size:16px; color:#191c1d;">Hi <strong>{data.name}</strong>,</p>
          <p style="font-size:15px; color:#414754; line-height:1.6;">
            We regret to inform you that your registration could not be approved at this time.
          </p>
          <div style="background:#fee2e2; border:1px solid #fca5a5; border-radius:10px; padding:16px; margin:20px 0;">
            <p style="margin:0; font-size:14px; color:#991b1b;"><strong>Reason:</strong> {data.reason}</p>
          </div>
          <p style="font-size:14px; color:#414754;">
            If you believe this is an error, please contact our support team.
          </p>
        </div>
        <div style="background:#f8f9fa; padding:16px 32px; border-top:1px solid #e1e3e4; text-align:center;">
          <p style="margin:0; font-size:12px; color:#727785;">© 2024 CET Prep Pro. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
    """
    try:
        send_email(data.email, subject, html)
        return {"message": f"Rejection email sent to {data.email}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "Email service running ✅"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("email_service:app", host="0.0.0.0", port=8000, reload=True)
