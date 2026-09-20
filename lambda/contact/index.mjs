import { Resend } from "resend";

// Standalone Lambda handler for the contact form. Ported from the old Astro SSR
// route (src/pages/api/contact.ts). Invoked via a Lambda Function URL that sits
// behind CloudFront at /api/contact, so the browser still POSTs same-origin.
//
// RESEND_API_KEY is set as a Lambda environment variable - it never ships in the
// static bundle.

const TO = "bharatesh@bharatwebcrafts.com";
// Sender lives on a verified *subdomain* in Resend (keeps sending reputation
// isolated from the root domain). Add `send.bharatwebcrafts.com` in Resend and
// match this address to it. The display name ("Bharat Web Crafts") is what the
// recipient sees.
const FROM = "Bharat Web Crafts <contact@send.bharatwebcrafts.com>";

export const handler = async (event) => {
  // Function URL uses payload format 2.0: method lives under requestContext.http.
  const method = event?.requestContext?.http?.method ?? "";
  if (method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let email, query;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    const body = JSON.parse(raw);
    email = (body.email ?? "").toString().trim();
    query = (body.query ?? "").toString().trim();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (!email || !query) {
    return json({ error: "Please fill in both fields." }, 400);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ error: "Email service is not configured." }, 500);
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: [TO],
    replyTo: email,
    subject: `New query at bharat web crafts from ${email}`,
    text: `${query}\n\nFrom: ${email}`,
    html: emailHtml(email, query),
  });

  if (error) {
    return json(
      { error: "Could not send right now. Please try again later." },
      502,
    );
  }

  return json({ ok: true, id: data?.id }, 200);
};

function json(data, status) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

// Escape user input before inlining it into the email HTML.
function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailHtml(email, query) {
  const safeEmail = escapeHtml(email);
  const safeQuery = escapeHtml(query).replace(/\n/g, "<br />");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr>
        <td style="background:#020617;padding:24px 28px;">
          <p style="margin:0;color:#60a5fa;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Bharat Web Crafts</p>
          <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;font-weight:600;">User Query</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="margin:0 0 6px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">From</p>
          <p style="margin:0 0 24px;font-size:15px;">
            <a href="mailto:${safeEmail}" style="color:#2563eb;text-decoration:none;">${safeEmail}</a>
          </p>
          <p style="margin:0 0 6px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Message</p>
          <div style="margin:0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;font-size:15px;line-height:1.6;">${safeQuery}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px;">
          <a href="mailto:${safeEmail}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:10px;">Reply</a>
        </td>
      </tr>
    </table>
    <p style="max-width:560px;margin:16px auto 0;color:#94a3b8;font-size:12px;text-align:center;">Sent from the contact form on bharatwebcrafts.com</p>
  </body>
</html>`;
}
