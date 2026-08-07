/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * ── Convención de nombres ──
 * Infraestructura en inglés (`users`, `settings`, `error_log`) porque se copia
 * literal del proyecto hermano; dominio en español (`clientes`, `canjes`,
 * `puntos_transacciones`).
 *
 * ── Campos declarados hoy que v1 NO usa ──
 * `sucursal_id`, `nivel_id`, `expira_en`, `secuencia` y el valor 'expiracion'
 * del enum existen desde el día 1 A PROPÓSITO. Multi-sucursal, niveles y
 * caducidad de puntos están fuera del alcance de v1, pero encenderlos después
 * debe ser insertar filas y escribir un job — no una migración destructiva
 * sobre una tabla con datos contables. Añadir un valor a un enum de Postgres
 * a posteriori (`ALTER TYPE ... ADD VALUE`) además tiene restricciones de
 * transacción molestas. Declararlos ahora cuesta cero.
 *
 * ── Zona horaria ──
 * Todo `timestamp` lleva `withTimezone: true`. Vercel corre en UTC y Ecuador
 * es UTC-5 sin horario de verano: los reportes "del día" tienen que usar
 * `date_trunc('day', fecha AT TIME ZONE 'America/Guayaquil')`, y eso necesita
 * timestamptz. El proyecto hermano usa timestamps ingenuos; aquí no.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  pgEnum,
  numeric,
  integer,
  bigserial,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Enumeraciones
// ─────────────────────────────────────────────────────────────────────────────

/** "Marketing" se declara ahora aunque v1 no lo asigne: ver nota de cabecera. */
export const userRoleEnum = pgEnum("user_role", [
  "Admin",
  "Jefe de Taller",
  "Asesor",
  "Marketing",
]);

export const tipoTransaccionEnum = pgEnum("tipo_transaccion", [
  "acreditacion",
  "canje",
  "reverso",
  "ajuste",
  "expiracion",
]);

export const tipoPremioEnum = pgEnum("tipo_premio", [
  "merchandising",
  "servicio",
  "descuento",
]);

export const estadoCanjeEnum = pgEnum("estado_canje", [
  "solicitado",
  "aprobado",
  "entregado",
  "rechazado",
  "cancelado",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Infraestructura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Existe desde el día 1 con UNA fila sembrada ("Matriz"). Crear la tabla ahora
 * es lo que hace aditivo el multi-sucursal: añadir *filas* a una tabla que ya
 * existe no obliga a backfill; añadir una tabla nueva con una FK que hay que
 * rellenar, sí.
 */
export const sucursales = pgTable("sucursales", {
  id: uuid("id").defaultRandom().primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  direccion: text("direccion"),
  activo: boolean("activo").default(true).notNull(),
  fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
});

/** Personal interno del taller. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").unique(),
    nombre: text("nombre").notNull(),
    role: userRoleEnum("role").default("Asesor").notNull(),
    sucursal_id: uuid("sucursal_id").references(() => sucursales.id),
    /**
     * Índice ciego de la cédula del empleado. No es decorativo: es lo que
     * permite bloquear que un asesor se acredite puntos a sí mismo comparando
     * contra `clientes.identificacion_idx` sin descifrar nada.
     */
    identificacion_idx: text("identificacion_idx"),
    password_hash: text("password_hash"),
    /** Desactivar a un usuario revoca sus sesiones vivas (se verifica en cada request). */
    activo: boolean("activo").default(true).notNull(),
    notif_canje_solicitado: boolean("notif_canje_solicitado").default(true).notNull(),
    notif_stock_bajo: boolean("notif_stock_bajo").default(true).notNull(),
    notif_resumen_diario: boolean("notif_resumen_diario").default(false).notNull(),
    ultimo_acceso: timestamp("ultimo_acceso", { withTimezone: true }),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("users_identificacion_idx_idx").on(t.identificacion_idx),
    index("users_sucursal_idx").on(t.sucursal_id),
  ]
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  fecha_actualizacion: timestamp("fecha_actualizacion", { withTimezone: true }).defaultNow().notNull(),
});

export const errorLog = pgTable(
  "error_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contexto: text("contexto").notNull(),
    mensaje: text("mensaje").notNull(),
    detalle: jsonb("detalle"),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("error_log_fecha_idx").on(t.fecha_creacion)]
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor_id: uuid("actor_id"),
    actor_email: text("actor_email"),
    actor_nombre: text("actor_nombre").notNull(),
    accion: text("accion").notNull(),
    entidad: text("entidad").notNull(),
    entidad_id: text("entidad_id"),
    detalle: jsonb("detalle"),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("admin_audit_log_fecha_idx").on(t.fecha_creacion),
    index("admin_audit_log_entidad_idx").on(t.entidad, t.entidad_id),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Niveles (tabla creada vacía en v1 — ver nota de cabecera)
// ─────────────────────────────────────────────────────────────────────────────

export const niveles = pgTable("niveles", {
  id: uuid("id").defaultRandom().primaryKey(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  puntos_minimos: integer("puntos_minimos").notNull(),
  multiplicador: numeric("multiplicador", { precision: 6, scale: 3 }).default("1.000").notNull(),
  beneficios: jsonb("beneficios"),
  orden: integer("orden").default(0).notNull(),
  activo: boolean("activo").default(true).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Clientes
// ─────────────────────────────────────────────────────────────────────────────

export const clientes = pgTable(
  "clientes",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** AES-256-GCM en reposo. NUNCA se filtra por esta columna. */
    identificacion: text("identificacion").notNull(),
    /**
     * Índice ciego HMAC-SHA256. El login por cédula y la búsqueda del asesor
     * filtran por aquí. El UNIQUE de abajo es lo que garantiza "un cliente por
     * cédula" — la columna real, cifrada con IV aleatorio, no puede hacerlo.
     */
    identificacion_idx: text("identificacion_idx").notNull(),
    nombres: text("nombres").notNull(),
    /** Cifrado; se descifra solo para enviar el OTP. */
    email: text("email"),
    /** Índice ciego del email: detectar duplicados sin descifrar la tabla entera. */
    email_idx: text("email_idx"),
    telefono: text("telefono"),

    /**
     * Saldo cacheado. NO es la fuente de verdad — el ledger lo es. Es una
     * denormalización que se actualiza en la MISMA transacción que la fila del
     * ledger, para que el home del cliente y las listas del panel no disparen
     * un SUM() por fila (eso es lo que mata el free tier de Neon, no una
     * consulta cara suelta).
     *
     * El CHECK es la última línea de defensa: aunque toda la lógica de
     * aplicación esté mal, Postgres rechaza un saldo negativo.
     */
    saldo_cache: integer("saldo_cache").default(0).notNull(),
    saldo_cache_actualizado: timestamp("saldo_cache_actualizado", { withTimezone: true }),

    /** El asesor cotejó la cédula física en el mostrador. */
    verificado: boolean("verificado").default(false).notNull(),
    verificado_por_id: uuid("verificado_por_id").references(() => users.id),
    verificado_en: timestamp("verificado_en", { withTimezone: true }),

    consentimiento_aceptado: boolean("consentimiento_aceptado").default(false).notNull(),
    politica_version: text("politica_version"),
    consentimiento_ip: text("consentimiento_ip"),
    consentimiento_user_agent: text("consentimiento_user_agent"),
    consentimiento_en: timestamp("consentimiento_en", { withTimezone: true }),

    origen: text("origen").default("auto-registro").notNull(), // 'padron' | 'auto-registro' | 'mostrador'
    sucursal_id: uuid("sucursal_id").references(() => sucursales.id),
    nivel_id: uuid("nivel_id").references(() => niveles.id),
    activo: boolean("activo").default(true).notNull(),
    /** Baja LOPDP: se anonimiza al cliente SIN borrar el ledger (es contable). */
    anonimizado_en: timestamp("anonimizado_en", { withTimezone: true }),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
    fecha_actualizacion: timestamp("fecha_actualizacion", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("clientes_identificacion_idx_uq").on(t.identificacion_idx),
    index("clientes_email_idx_idx").on(t.email_idx),
    // El asesor busca por nombre cuando la cámara falla y el código tecleado
    // tampoco funciona.
    index("clientes_nombres_idx").on(t.nombres),
    check("clientes_saldo_no_negativo", sql`${t.saldo_cache} >= 0`),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Dispositivos y anti-replay del QR
// ─────────────────────────────────────────────────────────────────────────────

export const clienteDispositivos = pgTable(
  "cliente_dispositivos",
  {
    /** Este id es el {dispositivoId} que viaja dentro del token del QR. */
    id: uuid("id").defaultRandom().primaryKey(),
    cliente_id: uuid("cliente_id")
      .references(() => clientes.id)
      .notNull(),
    /**
     * Secreto HMAC de 32 bytes, cifrado con encryptField() (AES-256-GCM). Un
     * volcado de Neon sin PII_ENCRYPTION_KEY no permite forjar QRs.
     */
    secreto: text("secreto").notNull(),
    /** Punto de extensión a 'ecdsa-p256' sin rediseño ni romper dispositivos viejos. */
    algoritmo: text("algoritmo").default("hmac-sha256").notNull(),
    etiqueta: text("etiqueta"), // "iPhone · Safari"
    ultima_actividad: timestamp("ultima_actividad", { withTimezone: true }),
    revocado_en: timestamp("revocado_en", { withTimezone: true }),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("cliente_dispositivos_cliente_id_idx").on(t.cliente_id)]
);

/**
 * Un escaneo consumido. El UNIQUE (dispositivo_id, paso) es EL constraint que
 * mata el replay: una foto del QR ajeno sirve como mucho dos minutos, y una
 * sola vez. Sin esto, todo lo demás del esquema criptográfico es decorativo.
 */
export const qrEscaneos = pgTable(
  "qr_escaneos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dispositivo_id: uuid("dispositivo_id")
      .references(() => clienteDispositivos.id)
      .notNull(),
    paso: integer("paso").notNull(),
    usuario_id: uuid("usuario_id")
      .references(() => users.id)
      .notNull(),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("qr_escaneos_dispositivo_paso_uq").on(t.dispositivo_id, t.paso),
    index("qr_escaneos_fecha_idx").on(t.fecha_creacion), // poda a 30 días
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// OTP y sesión del cliente
// ─────────────────────────────────────────────────────────────────────────────

export const otpCodigos = pgTable(
  "otp_codigos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Nunca la cédula en claro, ni siquiera aquí. */
    identificacion_idx: text("identificacion_idx").notNull(),
    cliente_id: uuid("cliente_id").references(() => clientes.id),
    codigo_hash: text("codigo_hash").notNull(), // bcryptjs
    canal: text("canal").default("email").notNull(), // 'email' | 'whatsapp'
    destino_masked: text("destino_masked"), // "da****@gmail.com" para la UI
    intentos: integer("intentos").default(0).notNull(),
    expira_en: timestamp("expira_en", { withTimezone: true }).notNull(),
    consumido_en: timestamp("consumido_en", { withTimezone: true }),
    motivo_cierre: text("motivo_cierre"), // 'usado' | 'reemplazado' | 'agotado'
    ip_solicitante: text("ip_solicitante"),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    /**
     * Sirve a dos consultas: buscar el código vigente, y CONTAR cuántos OTP se
     * pidieron en los últimos 15 minutos. Ese conteo es el rate limit
     * persistente — el limitador en memoria de rate-limit.ts no sobrevive
     * entre instancias serverless y no puede darlo.
     */
    index("otp_codigos_identificacion_fecha_idx").on(t.identificacion_idx, t.fecha_creacion),
  ]
);

export const sesionesCliente = pgTable(
  "sesiones_cliente",
  {
    /** Viaja como claim `sid` dentro del JWT, para poder revocar sin rotar la clave. */
    id: uuid("id").defaultRandom().primaryKey(),
    cliente_id: uuid("cliente_id")
      .references(() => clientes.id)
      .notNull(),
    user_agent: text("user_agent"),
    ip: text("ip"),
    ultima_actividad: timestamp("ultima_actividad", { withTimezone: true }).defaultNow().notNull(),
    revocada_en: timestamp("revocada_en", { withTimezone: true }),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sesiones_cliente_cliente_id_idx").on(t.cliente_id)]
);

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de puntos
// ─────────────────────────────────────────────────────────────────────────────

export const serviciosTipo = pgTable("servicios_tipo", {
  id: uuid("id").defaultRandom().primaryKey(),
  codigo: text("codigo").notNull().unique(), // 'MANT_5000', 'COLISION'
  nombre: text("nombre").notNull(),
  multiplicador: numeric("multiplicador", { precision: 6, scale: 3 }).default("1.000").notNull(),
  activo: boolean("activo").default(true).notNull(),
  orden: integer("orden").default(0).notNull(),
  /** Mapeo futuro a Odoo/DMS sin tocar el modelo. */
  codigo_externo: text("codigo_externo"),
  fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Versionada: NUNCA se hace UPDATE. Editar una regla es insertar una fila
 * nueva y cerrar la anterior con `vigente_hasta`. El ledger guarda `regla_id`,
 * así que una acreditación de marzo sigue siendo explicable en diciembre
 * aunque la regla haya cambiado tres veces desde entonces.
 *
 * Se descartó guardar esto en `settings` (clave/valor, como el hermano)
 * precisamente porque se sobrescribe y se perdería esa trazabilidad.
 */
export const reglasPuntos = pgTable(
  "reglas_puntos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nombre: text("nombre").notNull(), // "Regla general 2026"
    monto_base: numeric("monto_base", { precision: 10, scale: 2 }).notNull(), // la "$Y"
    puntos_por_base: integer("puntos_por_base").notNull(), // la "X"
    redondeo: text("redondeo").default("abajo").notNull(), // 'abajo' | 'cercano'
    monto_minimo: numeric("monto_minimo", { precision: 10, scale: 2 }).default("0").notNull(),
    /** Tope antifraude por transacción. NULL = sin tope. */
    puntos_maximos_transaccion: integer("puntos_maximos_transaccion"),
    vigente_desde: timestamp("vigente_desde", { withTimezone: true }).defaultNow().notNull(),
    vigente_hasta: timestamp("vigente_hasta", { withTimezone: true }),
    sucursal_id: uuid("sucursal_id").references(() => sucursales.id), // NULL = todas
    creado_por_id: uuid("creado_por_id").references(() => users.id),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reglas_puntos_vigencia_idx").on(t.vigente_desde, t.vigente_hasta)]
);

// ─────────────────────────────────────────────────────────────────────────────
// Premios y canjes
// ─────────────────────────────────────────────────────────────────────────────

export const premios = pgTable(
  "premios",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codigo: text("codigo").notNull().unique(),
    nombre: text("nombre").notNull(),
    descripcion: text("descripcion"),
    /**
     * merchandising = unidades contadas que repone marketing (gorra, tomatodo).
     * servicio      = no se agota, lo presta el taller (cambio de aceite).
     * descuento     = declarado, sin uso en v1.
     */
    tipo: tipoPremioEnum("tipo").default("merchandising").notNull(),
    costo_puntos: integer("costo_puntos").notNull(),
    imagen_url: text("imagen_url"),
    /** NULL = ilimitado (servicios). Entero = unidades reales en bodega. */
    stock: integer("stock"),
    /** Umbral de aviso por correo al Admin. NULL = sin aviso. */
    stock_minimo_alerta: integer("stock_minimo_alerta"),
    activo: boolean("activo").default(true).notNull(),
    orden: integer("orden").default(0).notNull(),
    visible_desde: timestamp("visible_desde", { withTimezone: true }),
    visible_hasta: timestamp("visible_hasta", { withTimezone: true }),
    sucursal_id: uuid("sucursal_id").references(() => sucursales.id),
    nivel_minimo_id: uuid("nivel_minimo_id").references(() => niveles.id),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
    fecha_actualizacion: timestamp("fecha_actualizacion", { withTimezone: true }),
  },
  (t) => [
    index("premios_activo_orden_idx").on(t.activo, t.orden),
    check("premios_costo_positivo", sql`${t.costo_puntos} > 0`),
    check("premios_stock_no_negativo", sql`${t.stock} IS NULL OR ${t.stock} >= 0`),
    // Un merchandising sin stock declarado sería un premio infinito por
    // descuido; un servicio con stock sería inventario fantasma.
    check(
      "premios_stock_segun_tipo",
      sql`(${t.tipo} = 'merchandising' AND ${t.stock} IS NOT NULL) OR (${t.tipo} <> 'merchandising' AND ${t.stock} IS NULL)`
    ),
  ]
);

export const canjes = pgTable(
  "canjes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cliente_id: uuid("cliente_id")
      .references(() => clientes.id)
      .notNull(),
    premio_id: uuid("premio_id")
      .references(() => premios.id)
      .notNull(),
    /** Snapshots: si mañana el admin baja el precio, este canje sigue diciendo lo que costó. */
    premio_nombre: text("premio_nombre").notNull(),
    costo_puntos: integer("costo_puntos").notNull(),

    estado: estadoCanjeEnum("estado").default("solicitado").notNull(),
    /**
     * 6 caracteres Crockford-base32. Solo se muestra en la PWA del cliente al
     * aprobarse, y el asesor lo teclea al entregar: prueba de que el cliente
     * está presente en el mostrador.
     */
    codigo_entrega: text("codigo_entrega"),
    /** Doble tap del cliente manda la misma clave y devuelve el canje ya creado. */
    idempotency_key: uuid("idempotency_key"),

    solicitado_en: timestamp("solicitado_en", { withTimezone: true }).defaultNow().notNull(),
    aprobado_en: timestamp("aprobado_en", { withTimezone: true }),
    aprobado_por_id: uuid("aprobado_por_id").references(() => users.id),
    entregado_en: timestamp("entregado_en", { withTimezone: true }),
    entregado_por_id: uuid("entregado_por_id").references(() => users.id),
    cerrado_en: timestamp("cerrado_en", { withTimezone: true }),
    cerrado_por_id: uuid("cerrado_por_id").references(() => users.id),
    motivo_cierre: text("motivo_cierre"),

    sucursal_id: uuid("sucursal_id").references(() => sucursales.id),
    fecha_actualizacion: timestamp("fecha_actualizacion", { withTimezone: true }),
  },
  (t) => [
    index("canjes_estado_solicitado_idx").on(t.estado, t.solicitado_en), // cola del taller
    index("canjes_cliente_fecha_idx").on(t.cliente_id, t.solicitado_en.desc()),
    uniqueIndex("canjes_idempotency_uq")
      .on(t.cliente_id, t.idempotency_key)
      .where(sql`idempotency_key IS NOT NULL`),
  ]
);

export const canjeHistorial = pgTable(
  "canje_historial",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canje_id: uuid("canje_id")
      .references(() => canjes.id)
      .notNull(),
    estado_anterior: estadoCanjeEnum("estado_anterior"),
    estado_nuevo: estadoCanjeEnum("estado_nuevo").notNull(),
    comentario: text("comentario"),
    actor_tipo: text("actor_tipo").notNull(), // 'cliente' | 'usuario' | 'sistema'
    actor_id: uuid("actor_id"),
    actor_nombre: text("actor_nombre").notNull(),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("canje_historial_canje_id_idx").on(t.canje_id)]
);

// ─────────────────────────────────────────────────────────────────────────────
// El ledger — corazón del sistema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * APPEND-ONLY. La inmutabilidad no es una convención que haya que recordar:
 * un trigger de Postgres (drizzle/0001_ledger_append_only.sql) hace RAISE
 * EXCEPTION en cualquier UPDATE o DELETE. Corregir un error es INSERTAR una
 * fila de tipo 'reverso', nunca modificar la original.
 *
 * Por qué ledger y no un campo `puntos` mutable en `clientes`:
 *  1. Un programa de fidelización es un pasivo contable de la empresa. "¿Por
 *     qué este cliente tiene 4.200 puntos?" se responde con filas.
 *  2. Reversibilidad honesta: queda constancia de que hubo un error, de quién
 *     lo cometió y de quién lo corrigió.
 *  3. Habilita niveles y caducidad sin migrar datos: "puntos de por vida" es
 *     SUM(puntos) WHERE puntos > 0, "saldo actual" es SUM(puntos). Un contador
 *     mutable no puede responder ambas — al canjear perdería el acumulado.
 *  4. La detección de fraude (concentración asesor-cliente) es una consulta
 *     sobre esta tabla. Sin ledger, no existe.
 */
export const puntosTransacciones = pgTable(
  "puntos_transacciones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * Orden total determinista. Desempata transacciones del mismo milisegundo
     * y es lo que necesitará el consumo FIFO cuando entre la caducidad.
     */
    secuencia: bigserial("secuencia", { mode: "number" }).notNull(),

    cliente_id: uuid("cliente_id")
      .references(() => clientes.id)
      .notNull(),
    tipo: tipoTransaccionEnum("tipo").notNull(),
    /**
     * CON SIGNO. Positivo entra, negativo sale. El saldo es un SUM(), no un
     * CASE/WHEN sobre el tipo: un solo campo, una sola operación.
     */
    puntos: integer("puntos").notNull(),
    /**
     * Saldo resultante tras aplicar esta fila. Derivado, solo para auditoría:
     * se escribe con el RETURNING del UPDATE condicional, así que es correcto
     * incluso bajo concurrencia y permite verificar la cadena completa.
     */
    saldo_posterior: integer("saldo_posterior").notNull(),

    // ── Cómo se calcularon los puntos (snapshot inmutable) ──
    monto_gastado: numeric("monto_gastado", { precision: 10, scale: 2 }),
    servicio_tipo_id: uuid("servicio_tipo_id").references(() => serviciosTipo.id),
    multiplicador_aplicado: numeric("multiplicador_aplicado", { precision: 6, scale: 3 }),
    regla_id: uuid("regla_id").references(() => reglasPuntos.id),

    // ── Trazabilidad ──
    escaneo_id: uuid("escaneo_id").references(() => qrEscaneos.id),
    canje_id: uuid("canje_id").references(() => canjes.id),
    /** Self-FK lógica: apunta a la fila que esta revierte. */
    reversa_de_id: uuid("reversa_de_id"),
    motivo: text("motivo"),
    documento_referencia: text("documento_referencia"), // Nº de orden de trabajo / factura

    // ── Punto de extensión Odoo/DMS (v2) ──
    fuente: text("fuente").default("manual").notNull(), // 'manual' | 'odoo' | 'dms'
    orden_externa_id: text("orden_externa_id"),
    payload_externo: jsonb("payload_externo"),

    // ── Actor (denormalizado a propósito: el nombre debe sobrevivir aunque
    //    el empleado se dé de baja y su fila cambie) ──
    creado_por_id: uuid("creado_por_id").references(() => users.id),
    creado_por_nombre: text("creado_por_nombre"),
    creado_por_rol: text("creado_por_rol"),
    sucursal_id: uuid("sucursal_id").references(() => sucursales.id),
    ip: text("ip"),
    user_agent: text("user_agent"),

    /** Caducidad futura. Hoy siempre NULL. */
    expira_en: timestamp("expira_en", { withTimezone: true }),
    fecha_creacion: timestamp("fecha_creacion", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Historial del cliente y lectura de la última fila: el índice que se usa
    // en el 90% de las consultas.
    index("puntos_transacciones_cliente_fecha_idx").on(t.cliente_id, t.fecha_creacion.desc()),

    // Un escaneo produce como máximo UNA acreditación. Estructural, no por
    // lógica de aplicación: ni un doble submit ni un reintento de red pueden
    // duplicar puntos.
    uniqueIndex("puntos_transacciones_escaneo_uq")
      .on(t.escaneo_id)
      .where(sql`escaneo_id IS NOT NULL AND tipo = 'acreditacion'`),

    // Un canje produce como máximo UN débito...
    uniqueIndex("puntos_transacciones_canje_debito_uq")
      .on(t.canje_id)
      .where(sql`canje_id IS NOT NULL AND tipo = 'canje'`),
    // ...y como máximo UNA devolución.
    uniqueIndex("puntos_transacciones_canje_reverso_uq")
      .on(t.canje_id)
      .where(sql`canje_id IS NOT NULL AND tipo = 'reverso'`),

    // Una transacción se revierte una sola vez.
    uniqueIndex("puntos_transacciones_reversa_uq")
      .on(t.reversa_de_id)
      .where(sql`reversa_de_id IS NOT NULL`),

    // Idempotencia para la futura integración: reprocesar la misma orden de
    // Odoo no duplica puntos, sin escribir una línea de lógica de dedup.
    uniqueIndex("puntos_transacciones_orden_externa_uq")
      .on(t.fuente, t.orden_externa_id)
      .where(sql`orden_externa_id IS NOT NULL`),

    // Reportes diarios y detección de anomalías por asesor.
    index("puntos_transacciones_creado_por_fecha_idx").on(t.creado_por_id, t.fecha_creacion),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Tipos inferidos
// ─────────────────────────────────────────────────────────────────────────────

export type Usuario = typeof users.$inferSelect;
export type Cliente = typeof clientes.$inferSelect;
export type ClienteDispositivo = typeof clienteDispositivos.$inferSelect;
export type ServicioTipo = typeof serviciosTipo.$inferSelect;
export type ReglaPuntos = typeof reglasPuntos.$inferSelect;
export type Premio = typeof premios.$inferSelect;
export type Canje = typeof canjes.$inferSelect;
export type PuntosTransaccion = typeof puntosTransacciones.$inferSelect;
export type EstadoCanje = (typeof estadoCanjeEnum.enumValues)[number];
export type TipoPremio = (typeof tipoPremioEnum.enumValues)[number];
export type TipoTransaccion = (typeof tipoTransaccionEnum.enumValues)[number];
export type RolUsuario = (typeof userRoleEnum.enumValues)[number];
