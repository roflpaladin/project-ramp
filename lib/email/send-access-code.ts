import nodemailer from "nodemailer";

// Sends the buyer's 4-digit portal access code via the Supabase project's
// SMTP relay (Auth -> SMTP settings in the dashboard), not a Supabase-specific
// email API -- Supabase has no endpoint for sending arbitrary transactional
// email, so we talk to the same SMTP server directly with nodemailer.
export async function sendAccessCodeEmail({
  to,
  code,
}: {
  to: string;
  code: string;
}): Promise<{ ok: boolean }> {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !password || !from) {
    console.error("[send-access-code] SMTP env vars are not fully configured; cannot send.");
    return { ok: false };
  }

  try {
    const transport = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass: password },
    });

    await transport.sendMail({
      from,
      to,
      subject: "Your deal room access code",
      text: `Your access code is ${code}. It expires in 15 minutes.`,
      html: `<p>Your access code is <strong>${code}</strong>. It expires in 15 minutes.</p>`,
    });

    return { ok: true };
  } catch (error) {
    console.error("[send-access-code] failed to send email:", error);
    return { ok: false };
  }
}
