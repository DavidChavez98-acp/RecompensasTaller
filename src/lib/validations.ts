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

/**
 * Chasis (VIN). No se exige el estándar ISO 3779 completo (17 caracteres, sin
 * I/O/Q) a propósito: vehículos anteriores a 1981 y algunas motos que pasan
 * por el taller traen chasis más cortos, y el Jefe de Taller transcribe lo que
 * está estampado en la carrocería, no lo que un validador estricto esperaría.
 * Se normaliza a mayúsculas sin espacios ni guiones y se exige un mínimo que
 * descarte errores de tecleo obvios.
 */
export const chasisSchema = z
  .string()
  .trim()
  .transform((val) => val.toUpperCase().replace(/[\s-]/g, ""))
  .refine((val) => /^[A-Z0-9]{5,17}$/.test(val), {
    message: "El chasis debe tener entre 5 y 17 caracteres alfanuméricos",
  });

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
  // Opcional: no todo cliente tiene un vehículo cargado todavía. El asesor
  // puede acreditar sin él y añadirlo después.
  vehiculo_id: z.string().uuid().optional().or(z.literal("")),
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
    /*
     * Crockford-base32: sin I, L, O ni U. El rango `J-N` de la versión
     * anterior dejaba pasar la L, que el generador NUNCA produce
     * (`ALFABETO_CODIGO` en constants.ts). Un código con L se colaba hasta la
     * consulta y moría con "ese código no coincide" en vez de con un error de
     * formato. Hay que enumerar J y K sueltas para excluir la L del rango.
     */
    .regex(/^[0-9A-HJKMNP-TV-Z]{6}$/, "El código de entrega son 6 caracteres"),
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

/**
 * Alta de un artículo de inventario de marketing SIN premio asociado — un
 * roll-up, un tríptico, un esfero: cosas que existen en bodega y nunca son
 * canjeables. `crearPremio` sigue siendo el camino para un merchandising que
 * SÍ es canjeable (crea el artículo enlazado en la misma transacción).
 */
export const articuloSchema = z.object({
  codigo: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/, "Solo mayúsculas, números, guion y guion bajo"),
  nombre: z.string().trim().min(3).max(120),
  descripcion: z.string().trim().max(500).optional().or(z.literal("")),
  unidad: z.string().trim().min(1).max(30).optional().or(z.literal("")),
  stock_minimo_alerta: z.number().int().min(0).nullable(),
});

/**
 * Ingreso de mercadería: siempre positivo. Dos motivos posibles:
 * `ingreso_compra` (recepción del proveedor, con factura opcional) o
 * `ingreso_devolucion` (lo que volvió de una feria, con el MISMO texto de
 * `evento` que llevó la `salida_evento` original — es lo que enlaza las dos
 * filas y permite detectar una feria sin cerrar).
 */
export const ingresoInventarioSchema = z
  .object({
    articulo_id: z.string().uuid(),
    motivo: z.enum(["ingreso_compra", "ingreso_devolucion"]).default("ingreso_compra"),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
    costo_unitario: z.number().nonnegative().optional(),
    documento_referencia: z.string().trim().max(60).optional().or(z.literal("")),
    evento: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .refine((i) => i.motivo !== "ingreso_devolucion" || i.evento, {
    message: "Escribe el nombre de la feria o el evento que devuelve esto",
    path: ["evento"],
  });

/**
 * Salida de inventario: feria, entrega de vehículo, merma o uso interno.
 * `salida_canje` NO está aquí a propósito — esa la dispara `aprobarCanjeAtomico`
 * por su cuenta, nunca este formulario.
 */
export const salidaInventarioSchema = z
  .object({
    articulo_id: z.string().uuid(),
    motivo: z.enum(["salida_entrega_vehiculo", "salida_evento", "salida_merma", "salida_interna"]),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
    evento: z.string().trim().max(120).optional().or(z.literal("")),
    vehiculo_id: z.string().uuid().optional().or(z.literal("")),
    motivo_texto: z.string().trim().max(300).optional().or(z.literal("")),
  })
  .refine((s) => s.motivo !== "salida_evento" || s.evento, {
    message: "Escribe el nombre de la feria o el evento",
    path: ["evento"],
  })
  .refine((s) => s.motivo !== "salida_entrega_vehiculo" || s.vehiculo_id, {
    message: "Busca el vehículo por chasis",
    path: ["vehiculo_id"],
  })
  .refine(
    (s) => s.motivo !== "salida_merma" || (s.motivo_texto && s.motivo_texto.trim().length >= 5),
    { message: "Explica qué pasó (mínimo 5 caracteres)", path: ["motivo_texto"] }
  );

/** Regla de puntos: se inserta una fila nueva, nunca se hace UPDATE. */
export const reglaPuntosSchema = z.object({
  nombre: z.string().trim().min(3).max(120),
  monto_base: z.number().positive("El monto base debe ser mayor a cero"),
  puntos_por_base: z.number().int().positive("Los puntos deben ser mayor a cero"),
  redondeo: z.enum(["abajo", "cercano"]),
  monto_minimo: z.number().min(0),
  puntos_maximos_transaccion: z.number().int().positive().nullable(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Personal interno (/interno/usuarios)
// ─────────────────────────────────────────────────────────────────────────────

/** Los 5 valores de `user_role`, en el mismo orden que el enum de Postgres. */
export const rolInternoSchema = z.enum([
  "Admin",
  "Jefe de Taller",
  "Asesor de Servicio",
  "Jefe de Marketing",
  "Asesor Comercial",
]);

/**
 * Alta de un usuario interno. La cédula es OPCIONAL: solo importa de verdad
 * para roles que acreditan puntos (Asesor de Servicio, Jefe de Taller), donde
 * bloquea que un asesor se acredite puntos a sí mismo comparando contra
 * `clientes.identificacion_idx`. No se fuerza obligatoria para los cinco
 * roles por igual.
 */
export const crearUsuarioSchema = z.object({
  email: emailSchema,
  nombre: z.string().trim().min(3, "Escribe el nombre completo").max(120),
  role: rolInternoSchema,
  identificacion: identificacionSchema.optional().or(z.literal("")),
});

export const cambiarRolUsuarioSchema = z.object({
  userId: z.string().uuid(),
  role: rolInternoSchema,
});

export const cambiarEstadoUsuarioSchema = z.object({
  userId: z.string().uuid(),
  activo: z.boolean(),
});

/** bcrypt trunca en 72 bytes: el máximo evita una contraseña que se recorte en silencio. */
export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña es demasiado larga");

/** Paso final de la invitación: el token firmado ES la prueba de autorización. */
export const definirPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export type SolicitarOtpInput = z.infer<typeof solicitarOtpSchema>;
export type RegistroClienteInput = z.infer<typeof registroClienteSchema>;
export type AcreditarPuntosInput = z.infer<typeof acreditarPuntosSchema>;
export type SolicitarCanjeInput = z.infer<typeof solicitarCanjeSchema>;
export type PremioInput = z.infer<typeof premioSchema>;
export type ReglaPuntosInput = z.infer<typeof reglaPuntosSchema>;
export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;
export type CambiarRolUsuarioInput = z.infer<typeof cambiarRolUsuarioSchema>;
export type CambiarEstadoUsuarioInput = z.infer<typeof cambiarEstadoUsuarioSchema>;
export type DefinirPasswordInput = z.infer<typeof definirPasswordSchema>;
