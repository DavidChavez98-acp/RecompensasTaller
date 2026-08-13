/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Infraestructura de correo copiada de "solicitud credito": transporte SMTP
 * con reintentos acotados, y volcado a archivo en desarrollo cuando no hay
 * credenciales. Las plantillas sí son propias de este proyecto.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

const DATA_DIR = join(process.cwd(), ".data");
const EMAIL_LOG_FILE = join(DATA_DIR, "sent_emails.log");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} agotó el tiempo de espera (${ms}ms)`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// Reintentos con backoff para fallos SMTP transitorios. Nodemailer no acota
// sus timeouts por defecto, así que se fuerza un techo duro por intento con
// withTimeout(): el peor caso de sendEmail() queda en ~7s, para no acercarse
// al límite de duración de función del plan gratuito.
const SMTP_ATTEMPT_TIMEOUT_MS = 2000;
const SMTP_RETRY_DELAYS_MS = [250, 700];

export async function sendEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string }> {
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

  const hasSmtpConfig = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

  if (hasSmtpConfig) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer") as {
      createTransport: (config: Record<string, unknown>) => {
        sendMail: (opts: Record<string, unknown>) => Promise<void>;
      };
    };

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: SMTP_ATTEMPT_TIMEOUT_MS,
      greetingTimeout: SMTP_ATTEMPT_TIMEOUT_MS,
      socketTimeout: SMTP_ATTEMPT_TIMEOUT_MS,
    });

    let lastError: unknown;
    for (let attempt = 0; attempt <= SMTP_RETRY_DELAYS_MS.length; attempt++) {
      try {
        await withTimeout(
          transporter.sendMail({
            from: process.env.SMTP_FROM || `"Recompensas Taller" <${process.env.SMTP_USER}>`,
            to: recipients.join(", "),
            subject: payload.subject,
            html: payload.html,
            text: payload.text || payload.subject,
          }),
          SMTP_ATTEMPT_TIMEOUT_MS,
          "Envío SMTP"
        );

        console.log(`[MAIL] Correo enviado exitosamente a: ${recipients.join(", ")}${attempt > 0 ? ` (intento ${attempt + 1})` : ""}`);
        return { success: true };
      } catch (error) {
        lastError = error;
        const delay = SMTP_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          console.warn(`[MAIL] Intento ${attempt + 1} falló, reintentando en ${delay}ms...`);
          await sleep(delay);
        }
      }
    }

    console.error("[MAIL] Error al enviar correo mediante SMTP tras reintentos:", (lastError as Error)?.message);
    return { success: false, error: (lastError as Error)?.message || String(lastError) };
  }

  // Sin credenciales SMTP en desarrollo: se vuelca a archivo para poder leer
  // el código OTP sin montar un servidor de correo.
  if (process.env.NODE_ENV !== "production") {
    try {
      ensureDataDir();

      const logEntry = [
        "═".repeat(60),
        `CORREO SIMULADO — ${new Date().toISOString()}`,
        "═".repeat(60),
        `Para:    ${recipients.join(", ")}`,
        `Asunto:  ${payload.subject}`,
        "─".repeat(60),
        payload.text || "(Sin texto plano)",
        "═".repeat(60),
        "",
        "",
      ].join("\n");

      appendFileSync(EMAIL_LOG_FILE, logEntry, "utf-8");
      console.log(`[MAIL-DEV] Correo registrado en ${EMAIL_LOG_FILE} para: ${recipients.join(", ")}`);
      return { success: true };
    } catch (error) {
      console.error("[MAIL-DEV] Error al registrar correo en log:", error);
      return { success: false, error: (error as Error).message };
    }
  }

  console.warn("[MAIL] Advertencia: No se enviará correo en producción porque faltan credenciales SMTP.");
  return { success: false, error: "Credenciales SMTP no configuradas en el entorno." };
}

const BRAND_RED = "#C81E1E";

export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return "https://recompensas.grupopalacios.com.ec";
}

function renderEmailLayout(params: { title: string; subtitle: string; bodyHtml: string }): string {
  return `
    <div style="font-family:'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:${BRAND_RED};padding:20px 32px;">
        <h1 style="margin:0;color:#ffffff;font-size:19px;font-weight:700;">${params.title}</h1>
        <p style="margin:6px 0 0;color:#fecaca;font-size:13px;">${params.subtitle}</p>
      </div>
      <div style="padding:24px 32px;">
        ${params.bodyHtml}
      </div>
      <div style="padding:16px 32px;border-top:1px solid #f3f4f6;text-align:center;">
        <p style="margin:0;color:#9ca3af;font-size:11px;">Grupo Palacios · Taller de Servicio · Ambato, Ecuador</p>
      </div>
    </div>
  `;
}

/** Código de un solo uso para entrar a la app de recompensas. */
export async function sendOtpCode(params: {
  to: string;
  codigo: string;
  minutosVigencia: number;
}): Promise<{ success: boolean; error?: string }> {
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:14px;">Tu código para entrar a Recompensas Taller es:</p>
    <div style="text-align:center;margin:24px 0;">
      <span style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:700;color:#111827;background:#f3f4f6;padding:16px 24px;border-radius:10px;">${params.codigo}</span>
    </div>
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Vence en ${params.minutosVigencia} minutos y solo sirve una vez.</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Si no pediste este código, ignora este correo: nadie puede entrar a tu cuenta sin él.</p>
  `;

  return sendEmail({
    to: params.to,
    subject: `${params.codigo} es tu código de acceso`,
    html: renderEmailLayout({
      title: "Tu código de acceso",
      subtitle: "Recompensas Taller · Grupo Palacios",
      bodyHtml,
    }),
    text: `Tu código de acceso es ${params.codigo}. Vence en ${params.minutosVigencia} minutos.`,
  });
}

/** Invitación al personal interno para establecer su contraseña. */
export async function sendPasswordSetupInvite(params: {
  to: string;
  nombre: string;
  url: string;
}): Promise<{ success: boolean; error?: string }> {
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:14px;">Hola ${params.nombre}, se creó tu acceso al panel del taller.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${params.url}" style="display:inline-block;background:${BRAND_RED};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Establecer mi contraseña</a>
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px;">El enlace vence en 48 horas.</p>
  `;

  return sendEmail({
    to: params.to,
    subject: "Acceso al panel de Recompensas Taller",
    html: renderEmailLayout({
      title: "Configura tu contraseña",
      subtitle: "Panel interno · Grupo Palacios",
      bodyHtml,
    }),
    text: `Establece tu contraseña aquí: ${params.url}`,
  });
}

/**
 * Confirmación de baja LOPDP. Se envía al correo QUE TENÍA el cliente antes de
 * anonimizarlo — después del UPDATE ese campo ya es NULL, así que el llamador
 * tiene que capturarlo antes.
 */
export async function sendAccountDeletionConfirmation(params: {
  to: string;
  nombre: string;
}): Promise<{ success: boolean; error?: string }> {
  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:14px;">Hola ${params.nombre}, confirmamos que eliminamos tu cuenta de Recompensas Taller.</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px;">Borramos tus datos personales (nombres, cédula, correo y teléfono). Por ser un registro contable del programa, conservamos de forma anónima tu historial de puntos y canjes, sin ningún dato que te identifique.</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Si no pediste esta eliminación, acércate al taller de inmediato.</p>
  `;

  return sendEmail({
    to: params.to,
    subject: "Confirmamos la eliminación de tu cuenta",
    html: renderEmailLayout({
      title: "Cuenta eliminada",
      subtitle: "Recompensas Taller · Grupo Palacios",
      bodyHtml,
    }),
    text: `Confirmamos que eliminamos tu cuenta de Recompensas Taller. Borramos tus datos personales; el historial de puntos se conserva de forma anónima por ser un registro contable.`,
  });
}
