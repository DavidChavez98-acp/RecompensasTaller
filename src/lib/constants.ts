/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

/** Zona horaria del concesionario. Vercel corre en UTC; Ecuador no tiene DST. */
export const ZONA_HORARIA = "America/Guayaquil";

/** Código de la sucursal sembrada en v1 (operación mono-sucursal). */
export const SUCURSAL_MATRIZ_CODIGO = "MATRIZ";

// ── QR de identidad ──────────────────────────────────────────────────────────

/** Duración de cada paso TOTP, en segundos. */
export const QR_PASO_SEGUNDOS = 60;
/**
 * Tolerancia de verificación, en pasos. ±2 ≈ 2 minutos: cubre el desfase de
 * reloj del teléfono y el tiempo entre que el cliente muestra la pantalla y el
 * asesor logra apuntar la cámara.
 */
export const QR_TOLERANCIA_PASOS = 2;
/** Prefijo de versión del token. Cambiarlo invalida todos los QR en circulación. */
export const QR_PREFIJO = "GP1";
/** Vigencia del ticket de acreditación que emite verificarQr(). */
export const TICKET_ACREDITACION_MINUTOS = 5;

// ── OTP ──────────────────────────────────────────────────────────────────────

export const OTP_LONGITUD = 6;
export const OTP_VIGENCIA_MINUTOS = 10;
export const OTP_MAX_INTENTOS = 5;
/**
 * Rate limit PERSISTENTE (contado en SQL sobre otp_codigos). El limitador en
 * memoria de rate-limit.ts no sobrevive entre instancias serverless, así que
 * este es el límite que de verdad manda.
 */
export const OTP_MAX_SOLICITUDES = 3;
export const OTP_VENTANA_MINUTOS = 15;

// ── Sesiones ─────────────────────────────────────────────────────────────────

/** El cliente entra ~3 veces al año: una sesión corta lo obligaría a pedir OTP siempre. */
export const SESION_CLIENTE_DIAS = 180;
export const SESION_INTERNA_HORAS = 12;

export const COOKIE_SESION_CLIENTE = "gp_cliente_sesion";
export const COOKIE_SESION_INTERNA = "gp_interno_sesion";

/**
 * Audiencias del JWT. Separadas a propósito y con secretos distintos: un token
 * de cliente no debe poder tocar /interno ni por accidente.
 */
export const AUD_CLIENTE = "cliente";
export const AUD_INTERNO = "interno";

// ── Canjes ───────────────────────────────────────────────────────────────────

/**
 * Alfabeto Crockford-base32 del código de entrega: sin I, L, O ni U, para que
 * nadie confunda 1/I ni 0/O dictándolo en el mostrador.
 */
export const ALFABETO_CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODIGO_ENTREGA_LONGITUD = 6;

// ── Retención ────────────────────────────────────────────────────────────────

export const RETENCION_QR_ESCANEOS_DIAS = 30;
export const RETENCION_OTP_DIAS = 7;
export const RETENCION_ERROR_LOG_DIAS = 90;

/** Versión vigente de la política de tratamiento de datos (LOPDP). */
export const POLITICA_VERSION = "2026-08-v1";
