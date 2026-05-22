import nodemailer from "nodemailer";
import { logger } from "./logger";

function getTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT ?? 587);

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

export async function sendMagicCode(email: string, code: string, purpose: string) {
  const subject =
    purpose === 'change_email' ? 'FlowMind — confirm your new email'
    : 'FlowMind — your sign-in code';

  const text = `Your FlowMind code is: ${code}\n\nIt expires in 15 minutes. Do not share it.`;
  const html = `<p>Your FlowMind code is: <strong style="font-size:1.4em;letter-spacing:0.15em">${code}</strong></p><p>Expires in 15 minutes. Do not share.</p>`;

  const transport = getTransport();
  if (!transport) {
    logger.warn({ email, code, purpose }, '[MAILER] SMTP not configured — magic code (dev only)');
    return;
  }

  await transport.sendMail({
    from: `"FlowMind" <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    text,
    html,
  });
}
