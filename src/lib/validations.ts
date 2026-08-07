/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Los tres validadores de documento ecuatoriano vienen literales del proyecto
 * "solicitud credito" — están probados en producción, no los reescribas.
 */

import { z } from "zod";

export const validateCedula = (cedula: string) => {
  if (!/^\d{10}$/.test(cedula)) return false;

  const code = parseInt(cedula.substring(0, 2), 10);
  if ((code <= 0 || code > 24) && code !== 30) return false;

  const digits = cedula.split('').map(Number);
  const verifier = digits.pop();

  if (verifier === undefined) return false;

  const calculated = digits.reduce((previous, current, index) => {
    return previous - ((current * (2 - index % 2)) % 9) - (current === 9 ? 9 : 0);
  }, 1000) % 10;

  return calculated === verifier;
};

export const validateRuc = (ruc: string) => {
  if (!/^\d{13}$/.test(ruc)) return false;

  const code = parseInt(ruc.substring(0, 2), 10);
  if ((code <= 0 || code > 24) && code !== 30) return false;

  const last3Digits = parseInt(ruc.substring(10, 13), 10);
  if (last3Digits <= 0) return false;

  const thirdDigit = parseInt(ruc.substring(2, 3), 10);
  if (thirdDigit < 6) {
    return validateCedula(ruc.substring(0, 10));
  }

  return thirdDigit === 6 || thirdDigit === 9;
};

export const validateCellphone = (phoneNumber: string) => {
  if (!/^\d+$/.test(phoneNumber)) return false;

  if (phoneNumber.startsWith('593')) {

    return phoneNumber.length === 12 && phoneNumber.substring(3, 4) === '9';
  } else {

    return phoneNumber.length === 10 && phoneNumber.startsWith('09');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Esquemas Zod del dominio de recompensas
// ─────────────────────────────────────────────────────────────────────────────

export const identificacionSchema = z
  .string()
  .trim()
  .max(13, "Identificación demasiado larga")
  .refine((val) => validateCedula(val) || validateRuc(val), {
    message: "Cédula o RUC inválido",
  });

export const emailSchema = z.string().trim().toLowerCase().email("Correo electrónico inválido");

export const telefonoSchema = z
  .string()
  .trim()
  .refine(validateCellphone, { message: "Número de celular inválido" });

/** Paso 1 del login: el cliente escribe su cédula y pide el código. */
export const solicitarOtpSchema = z.object({
  identificacion: identificacionSchema,
});

/**
 * Paso 2 del login: solo el código.
 *
 * La cédula NO se pide aquí a propósito: en ese punto ya viaja en la cookie de
 * flujo firmada por el servidor. Meterla en este esquema obligaría a que el
 * cliente la reenvíe (o a inventar un valor de relleno que el validador de
 * cédula rechazaría, produciendo un "código inválido" que no tiene nada que ver
 * con el código).
 */
export const codigoOtpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "El código son 6 dígitos");

/** Auto-registro del cliente nuevo. */
export const registroClienteSchema = z.object({
  identificacion: identificacionSchema,
  nombres: z.string().trim().min(3, "Escribe tu nombre completo").max(120),
  email: emailSchema,
  telefono: telefonoSchema.optional().or(z.literal("")),
  consentimiento: z.literal(true, {
    message: "Debes aceptar la política de tratamiento de datos",
  }),
});

/**
 * Acreditación de puntos por parte del asesor. El `ticket` viene de
 * `verificarQr()` y prueba que este asesor escaneó a este cliente hace menos
 * de 5 minutos.
 */
export const acreditarPuntosSchema = z.object({
  ticket: z.string().min(1),
  monto: z
    .number({ message: "Escribe el monto del servicio" })
    .positive("El monto debe ser mayor a cero")
    .max(999999.99, "Monto fuera de rango"),
  servicio_tipo_id: z.string().uuid("Selecciona el tipo de servicio"),
  documento_referencia: z.string().trim().max(60).optional().or(z.literal("")),
});

/** Solicitud de canje desde la PWA del cliente. */
export const solicitarCanjeSchema = z.object({
  premio_id: z.string().uuid(),
  // Generado en el cliente al montar el formulario: un doble tap manda la
  // misma clave y devuelve el canje ya creado en vez de crear otro.
  idempotency_key: z.string().uuid(),
});

/** Entrega del premio en el mostrador. */
export const entregarCanjeSchema = z.object({
  canje_id: z.string().uuid(),
  codigo_entrega: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-HJ-NP-TV-Z]{6}$/, "El código de entrega son 6 caracteres"),
});

/** Alta o edición de un premio del catálogo. */
export const premioSchema = z
  .object({
    codigo: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/, "Solo mayúsculas, números, guion y guion bajo"),
    nombre: z.string().trim().min(3).max(120),
    descripcion: z.string().trim().max(500).optional().or(z.literal("")),
    tipo: z.enum(["merchandising", "servicio", "descuento"]),
    costo_puntos: z.number().int().positive("El costo debe ser mayor a cero"),
    stock: z.number().int().min(0, "El stock no puede ser negativo").nullable(),
    stock_minimo_alerta: z.number().int().min(0).nullable(),
    activo: z.boolean(),
  })
  .refine((p) => p.tipo !== "merchandising" || p.stock !== null, {
    message: "El merchandising necesita un stock; los servicios no",
    path: ["stock"],
  })
  .refine((p) => p.tipo === "merchandising" || p.stock === null, {
    message: "Un servicio no lleva stock: se presta, no se agota",
    path: ["stock"],
  });

/** Ajuste manual de inventario, siempre con motivo (queda en auditoría). */
export const ajustarStockSchema = z.object({
  premio_id: z.string().uuid(),
  cantidad: z.number().int().refine((n) => n !== 0, "El ajuste no puede ser cero"),
  motivo: z.string().trim().min(5, "Explica el motivo del ajuste").max(200),
});

/** Regla de puntos: se inserta una fila nueva, nunca se hace UPDATE. */
export const reglaPuntosSchema = z.object({
  nombre: z.string().trim().min(3).max(120),
  monto_base: z.number().positive("El monto base debe ser mayor a cero"),
  puntos_por_base: z.number().int().positive("Los puntos deben ser mayor a cero"),
  redondeo: z.enum(["abajo", "cercano"]),
  monto_minimo: z.number().min(0),
  puntos_maximos_transaccion: z.number().int().positive().nullable(),
});

export type SolicitarOtpInput = z.infer<typeof solicitarOtpSchema>;
export type RegistroClienteInput = z.infer<typeof registroClienteSchema>;
export type AcreditarPuntosInput = z.infer<typeof acreditarPuntosSchema>;
export type SolicitarCanjeInput = z.infer<typeof solicitarCanjeSchema>;
export type PremioInput = z.infer<typeof premioSchema>;
export type ReglaPuntosInput = z.infer<typeof reglaPuntosSchema>;
