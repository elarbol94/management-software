import "server-only";

import nodemailer from "nodemailer";
import { z } from "zod";

export class MailConfigurationError extends Error {}

export async function sendMail(message: { to: string; subject: string; text: string }) {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  if (!host || !from || !z.email().safeParse(from).success ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      Boolean(username) !== Boolean(password)) {
    throw new MailConfigurationError("Configure SMTP_HOST, SMTP_FROM, SMTP_PORT and SMTP credentials.");
  }

  const transport = nodemailer.createTransport({
    host, port, secure,
    requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
    ...(username && password ? { auth: { user: username, pass: password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const result = await transport.sendMail({ from, ...message });
  if (result.accepted.length !== 1 || result.rejected.length > 0) {
    throw new Error("SMTP server rejected the invitation.");
  }
}
