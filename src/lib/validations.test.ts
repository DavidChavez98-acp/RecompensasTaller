/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Ejecutar: pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acreditarPuntosSchema,
  ajustarStockSchema,
  chasisSchema,
  emailSchema,
  entregarCanjeSchema,
  identificacionSchema,
  premioSchema,
  reglaPuntosSchema,
  registroClienteSchema,
  solicitarCanjeSchema,
  solicitarOtpSchema,
  telefonoSchema,
  validateCedula,
  validateCellphone,
  validateRuc,
} from "./validations";
import { ALFABETO_CODIGO, CODIGO_ENTREGA_LONGITUD } from "./constants";

// UUID v4 de verdad: Zod 4 comprueba los nibbles de versión y variante, así que
// un "11111111-2222-..." de relleno no pasa (y esconder eso haría que estas
// pruebas dijeran menos de lo que parecen).
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTRO_UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

test("validateCedula acepta cédulas ecuatorianas válidas", () => {
  assert.equal(validateCedula("1710034065"), true);
  assert.equal(validateCedula("0926687856"), true);
});

test("validateCedula rechaza dígito verificador incorrecto", () => {
  assert.equal(validateCedula("1710034066"), false);
});

test("validateCedula rechaza longitud y provincia inválidas", () => {
  assert.equal(validateCedula("171003406"), false, "9 dígitos");
  assert.equal(validateCedula("17100340650"), false, "11 dígitos");
  assert.equal(validateCedula("9910034065"), false, "provincia 99");
  assert.equal(validateCedula("abcdefghij"), false, "no numérica");
});

test("validateRuc acepta persona natural y sociedad", () => {
  assert.equal(validateRuc("1710034065001"), true, "natural: cédula + 001");
  assert.equal(validateRuc("1791234567001"), true, "sociedad privada: tercer dígito 9");
});

test("validateRuc rechaza establecimiento 000", () => {
  assert.equal(validateRuc("1710034065000"), false);
});

test("validateCellphone acepta formato local y con código de país", () => {
  assert.equal(validateCellphone("0987654321"), true);
  assert.equal(validateCellphone("593987654321"), true);
});

test("validateCellphone rechaza fijos y longitudes malas", () => {
  assert.equal(validateCellphone("032845678"), false, "convencional");
  assert.equal(validateCellphone("098765432"), false, "9 dígitos");
  assert.equal(validateCellphone("09876543210"), false, "11 dígitos");
});

// El CHECK de Postgres (premios_stock_segun_tipo) es la defensa dura; este
// esquema lo replica en el borde para dar un mensaje entendible en la UI en
// vez de un error de base de datos.
test("premioSchema exige stock al merchandising", () => {
  const base = {
    codigo: "GORRA",
    nombre: "Gorra institucional",
    descripcion: "",
    costo_puntos: 500,
    stock_minimo_alerta: 5,
    activo: true,
  };

  assert.equal(
    premioSchema.safeParse({ ...base, tipo: "merchandising", stock: 12 }).success,
    true
  );
  assert.equal(
    premioSchema.safeParse({ ...base, tipo: "merchandising", stock: null }).success,
    false,
    "merchandising sin stock sería un premio infinito por descuido"
  );
});

test("premioSchema rechaza stock en un servicio", () => {
  const base = {
    codigo: "ACEITE",
    nombre: "Cambio de aceite",
    descripcion: "",
    costo_puntos: 20000,
    stock_minimo_alerta: null,
    activo: true,
  };

  assert.equal(premioSchema.safeParse({ ...base, tipo: "servicio", stock: null }).success, true);
  assert.equal(
    premioSchema.safeParse({ ...base, tipo: "servicio", stock: 10 }).success,
    false,
    "un servicio con stock sería inventario fantasma"
  );
});

test("premioSchema exige un código en mayúsculas sin espacios", () => {
  // El código se usa como identificador estable del catálogo; permitir
  // "Gorra Roja" y "GORRA_ROJA" para el mismo premio invita al duplicado.
  const base = {
    nombre: "Gorra institucional",
    descripcion: "",
    tipo: "merchandising" as const,
    costo_puntos: 500,
    stock: 10,
    stock_minimo_alerta: 5,
    activo: true,
  };

  assert.equal(premioSchema.safeParse({ ...base, codigo: "GORRA_ROJA-01" }).success, true);
  assert.equal(premioSchema.safeParse({ ...base, codigo: "gorra" }).success, false, "minúsculas");
  assert.equal(premioSchema.safeParse({ ...base, codigo: "GORRA ROJA" }).success, false, "espacio");
  assert.equal(premioSchema.safeParse({ ...base, codigo: "G" }).success, false, "1 carácter");
});

test("premioSchema rechaza un premio gratis o de costo negativo", () => {
  const base = {
    codigo: "GORRA",
    nombre: "Gorra institucional",
    descripcion: "",
    tipo: "merchandising" as const,
    stock: 10,
    stock_minimo_alerta: 5,
    activo: true,
  };

  assert.equal(premioSchema.safeParse({ ...base, costo_puntos: 0 }).success, false, "costo cero");
  assert.equal(premioSchema.safeParse({ ...base, costo_puntos: -100 }).success, false);
  assert.equal(premioSchema.safeParse({ ...base, costo_puntos: 1.5 }).success, false, "no entero");
  assert.equal(premioSchema.safeParse({ ...base, stock: -1 }).success, false, "stock negativo");
});

// ─────────────────────────────────────────────────────────────────────────────
// Chasis (VIN)
//
// A propósito NO se exige el ISO 3779 completo: por el taller pasan vehículos
// anteriores a 1981 y motos con chasis más cortos, y el Jefe de Taller
// transcribe lo que está estampado en la carrocería.
// ─────────────────────────────────────────────────────────────────────────────

test("chasisSchema normaliza a mayúsculas y quita espacios y guiones", () => {
  // El chasis se dicta y se teclea con separadores para no perder el sitio;
  // sin normalizar, el mismo vehículo entraría dos veces en la base.
  assert.equal(chasisSchema.parse("3n1ab7ap7fy123456"), "3N1AB7AP7FY123456");
  assert.equal(chasisSchema.parse("  3n1ab7ap7fy123456  "), "3N1AB7AP7FY123456");
  assert.equal(chasisSchema.parse("3N1AB7AP-7FY-123456"), "3N1AB7AP7FY123456");
  assert.equal(chasisSchema.parse("3N1 AB7 AP7 FY1 23456"), "3N1AB7AP7FY123456");
  assert.equal(
    chasisSchema.parse(" 3n1 ab7ap-7fy 123456 "),
    "3N1AB7AP7FY123456",
    "espacios y guiones mezclados"
  );
});

test("chasisSchema acepta desde 5 hasta 17 caracteres alfanuméricos", () => {
  assert.equal(chasisSchema.parse("AB123"), "AB123", "5: el mínimo, para una moto vieja");
  assert.equal(chasisSchema.parse("1HGCM82633A004352"), "1HGCM82633A004352", "17: el VIN estándar");
  assert.equal(chasisSchema.safeParse("A1B2C3D4E5F6G7H8").success, true, "16");
});

test("chasisSchema rechaza lo que es un error de tecleo obvio", () => {
  assert.equal(chasisSchema.safeParse("AB12").success, false, "4 caracteres");
  assert.equal(chasisSchema.safeParse("1HGCM82633A0043521").success, false, "18 caracteres");
  assert.equal(chasisSchema.safeParse("").success, false, "vacío");
  assert.equal(chasisSchema.safeParse("   ").success, false, "solo espacios");
  assert.equal(chasisSchema.safeParse("-----").success, false, "solo separadores: queda vacío");
});

test("chasisSchema rechaza símbolos que no sobreviven a la normalización", () => {
  // Solo se limpian espacios y guiones; cualquier otro símbolo tiene que
  // rebotar en vez de colarse en la columna.
  for (const malo of ["3N1AB7AP*FY123", "3N1AB7AP/FY123", "3N1AB7AP.FY123", "3N1AB7AP#FY12"]) {
    assert.equal(chasisSchema.safeParse(malo).success, false, `debería rechazar ${malo}`);
  }
});

test("chasisSchema mide DESPUÉS de normalizar, no antes", () => {
  // "AB-1-2-3" son 8 caracteres tecleados pero 5 reales. Si la longitud se
  // midiera antes de quitar los guiones, este chasis válido se rechazaría.
  assert.equal(chasisSchema.parse("AB-1-2-3"), "AB123");
  assert.equal(
    chasisSchema.safeParse("1HGCM82633A004352-1").success,
    false,
    "y al revés: 18 reales no pasan por venir con guion"
  );
});

test("chasisSchema da un mensaje entendible para el Jefe de Taller", () => {
  const resultado = chasisSchema.safeParse("AB12");
  assert.equal(resultado.success, false);
  if (!resultado.success) {
    assert.match(resultado.error.issues[0]!.message, /entre 5 y 17/);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Identificación, correo y teléfono
// ─────────────────────────────────────────────────────────────────────────────

test("identificacionSchema acepta cédula y RUC, y nada más", () => {
  assert.equal(identificacionSchema.safeParse("1710034065").success, true, "cédula");
  assert.equal(identificacionSchema.safeParse("1710034065001").success, true, "RUC");
  assert.equal(identificacionSchema.safeParse("1710034066").success, false, "verificador malo");
  assert.equal(identificacionSchema.safeParse("").success, false);
  assert.equal(identificacionSchema.safeParse("17100340650011").success, false, "14 dígitos");
});

test("identificacionSchema recorta espacios antes de validar", () => {
  // El cliente copia y pega la cédula desde otra app y arrastra un espacio.
  assert.equal(identificacionSchema.safeParse("  1710034065  ").success, true);
});

test("solicitarOtpSchema reutiliza la validación de identificación", () => {
  assert.equal(solicitarOtpSchema.safeParse({ identificacion: "1710034065" }).success, true);
  assert.equal(solicitarOtpSchema.safeParse({ identificacion: "0000000000" }).success, false);
});

test("emailSchema normaliza a minúsculas (el índice ciego depende de ello)", () => {
  // Sin esta normalización, "Cliente@X.com" y "cliente@x.com" darían índices
  // ciegos distintos y el duplicado entraría a la base.
  assert.equal(emailSchema.parse("  Cliente@Example.COM "), "cliente@example.com");
  assert.equal(emailSchema.safeParse("sin-arroba").success, false);
  assert.equal(emailSchema.safeParse("dos@@example.com").success, false);
  assert.equal(emailSchema.safeParse("").success, false);
});

test("telefonoSchema acepta celular ecuatoriano y rechaza el convencional", () => {
  assert.equal(telefonoSchema.safeParse("0987654321").success, true);
  assert.equal(telefonoSchema.safeParse(" 0987654321 ").success, true, "recorta");
  assert.equal(telefonoSchema.safeParse("593987654321").success, true, "con código de país");
  assert.equal(telefonoSchema.safeParse("032845678").success, false, "fijo de Ambato");
});

// ─────────────────────────────────────────────────────────────────────────────
// Registro del cliente
// ─────────────────────────────────────────────────────────────────────────────

const REGISTRO_VALIDO = {
  identificacion: "1710034065",
  nombres: "Cliente de Prueba",
  email: "cliente@example.com",
  telefono: "0987654321",
  consentimiento: true as const,
};

test("registroClienteSchema acepta un alta completa", () => {
  assert.equal(registroClienteSchema.safeParse(REGISTRO_VALIDO).success, true);
});

test("registroClienteSchema EXIGE el consentimiento LOPDP", () => {
  // No basta con que el campo llegue: tiene que ser `true`. Un `false` es una
  // negativa expresa y no se puede tratar como "no marcó todavía".
  assert.equal(
    registroClienteSchema.safeParse({ ...REGISTRO_VALIDO, consentimiento: false }).success,
    false
  );
  assert.equal(
    registroClienteSchema.safeParse({ ...REGISTRO_VALIDO, consentimiento: "true" }).success,
    false,
    "la cadena 'true' no es un consentimiento"
  );

  const sinCampo: Record<string, unknown> = { ...REGISTRO_VALIDO };
  delete sinCampo.consentimiento;
  assert.equal(registroClienteSchema.safeParse(sinCampo).success, false);
});

test("registroClienteSchema deja el teléfono opcional pero no el correo", () => {
  // El correo es el destino del OTP: sin él no hay forma de entrar.
  assert.equal(
    registroClienteSchema.safeParse({ ...REGISTRO_VALIDO, telefono: "" }).success,
    true,
    "sin teléfono se puede acumular puntos igual"
  );
  const sinTelefono = { ...REGISTRO_VALIDO } as Partial<typeof REGISTRO_VALIDO>;
  delete sinTelefono.telefono;
  assert.equal(registroClienteSchema.safeParse(sinTelefono).success, true);
  assert.equal(
    registroClienteSchema.safeParse({ ...REGISTRO_VALIDO, email: "" }).success,
    false
  );
});

test("registroClienteSchema exige un nombre de verdad", () => {
  assert.equal(registroClienteSchema.safeParse({ ...REGISTRO_VALIDO, nombres: "Al" }).success, false);
  assert.equal(
    registroClienteSchema.safeParse({ ...REGISTRO_VALIDO, nombres: "A".repeat(121) }).success,
    false,
    "121 caracteres no caben en la columna"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Acreditación
// ─────────────────────────────────────────────────────────────────────────────

const ACREDITACION_VALIDA = {
  ticket: "un-ticket-firmado",
  monto: 150.5,
  servicio_tipo_id: UUID,
  documento_referencia: "FAC-001-2026",
  vehiculo_id: OTRO_UUID,
};

test("acreditarPuntosSchema acepta una acreditación normal del mostrador", () => {
  assert.equal(acreditarPuntosSchema.safeParse(ACREDITACION_VALIDA).success, true);
});

test("acreditarPuntosSchema exige el ticket del escaneo", () => {
  // Sin ticket no hay prueba de que este asesor escaneó a este cliente hace
  // menos de 5 minutos: sería acreditar a dedo.
  assert.equal(acreditarPuntosSchema.safeParse({ ...ACREDITACION_VALIDA, ticket: "" }).success, false);
});

test("acreditarPuntosSchema rechaza montos imposibles", () => {
  for (const monto of [0, -1, -0.01, 1_000_000]) {
    assert.equal(
      acreditarPuntosSchema.safeParse({ ...ACREDITACION_VALIDA, monto }).success,
      false,
      `monto ${monto}`
    );
  }
  assert.equal(
    acreditarPuntosSchema.safeParse({ ...ACREDITACION_VALIDA, monto: "150" }).success,
    false,
    "el monto llega como número, no como texto del formulario"
  );
});

test("acreditarPuntosSchema deja opcionales el vehículo y el documento", () => {
  // No todo cliente tiene un vehículo cargado todavía; el asesor acredita
  // igual y lo añade después.
  assert.equal(
    acreditarPuntosSchema.safeParse({
      ticket: "t",
      monto: 100,
      servicio_tipo_id: UUID,
      documento_referencia: "",
      vehiculo_id: "",
    }).success,
    true
  );
  assert.equal(
    acreditarPuntosSchema.safeParse({ ticket: "t", monto: 100, servicio_tipo_id: UUID }).success,
    true
  );
});

test("acreditarPuntosSchema exige que el tipo de servicio sea un UUID", () => {
  assert.equal(
    acreditarPuntosSchema.safeParse({ ...ACREDITACION_VALIDA, servicio_tipo_id: "mecanica" }).success,
    false
  );
  assert.equal(
    acreditarPuntosSchema.safeParse({ ...ACREDITACION_VALIDA, vehiculo_id: "no-uuid" }).success,
    false
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Canjes
// ─────────────────────────────────────────────────────────────────────────────

test("solicitarCanjeSchema exige la clave de idempotencia", () => {
  // Es lo que convierte un doble toque en el mismo canje en vez de dos.
  assert.equal(
    solicitarCanjeSchema.safeParse({ premio_id: UUID, idempotency_key: OTRO_UUID }).success,
    true
  );
  assert.equal(solicitarCanjeSchema.safeParse({ premio_id: UUID }).success, false);
  assert.equal(
    solicitarCanjeSchema.safeParse({ premio_id: UUID, idempotency_key: "123" }).success,
    false,
    "tiene que ser un UUID, no un contador del cliente"
  );
});

test("entregarCanjeSchema normaliza a mayúsculas el código dictado", () => {
  const resultado = entregarCanjeSchema.parse({ canje_id: UUID, codigo_entrega: " a1b2c3 " });
  assert.equal(resultado.codigo_entrega, "A1B2C3");
});

test("entregarCanjeSchema exige 6 caracteres exactos", () => {
  for (const codigo of ["A1B2C", "A1B2C3D", "", "A1B2C!"]) {
    assert.equal(
      entregarCanjeSchema.safeParse({ canje_id: UUID, codigo_entrega: codigo }).success,
      false,
      `debería rechazar "${codigo}"`
    );
  }
  assert.equal(CODIGO_ENTREGA_LONGITUD, 6, "si cambia la longitud, cambia el patrón");
});

test("entregarCanjeSchema rechaza los caracteres que el generador nunca produce", () => {
  // I, O y U no están en el alfabeto Crockford del código de entrega.
  for (const letra of ["I", "O", "U"]) {
    assert.equal(
      entregarCanjeSchema.safeParse({ canje_id: UUID, codigo_entrega: `A1B2C${letra}` }).success,
      false,
      `${letra} no existe en el alfabeto`
    );
  }
});

/*
 * Regresión: `entregarCanjeSchema` aceptaba la letra L, que
 * `generarCodigoEntrega` NUNCA emite porque no está en ALFABETO_CODIGO.
 *
 * El patrón era /^[0-9A-HJ-NP-TV-Z]{6}$/ y el rango J-N incluye la L. El
 * alfabeto Crockford del proyecto excluye I, L, O y U precisamente porque el
 * asesor DICTA el código en el mostrador: quien escuche "ele" y quien escuche
 * "uno" acaba tecleando cosas distintas.
 *
 * Consecuencia que tenía: un código con L pasaba la validación, llegaba al
 * WHERE y no casaba con ninguna fila, así que el asesor recibía "El código no
 * coincide" en vez del error de formato que le habría dicho que confundió la
 * L con un 1.
 */
test("entregarCanjeSchema rechaza también la L", () => {
  assert.ok(!ALFABETO_CODIGO.includes("L"), "L no está en el alfabeto del generador");
  assert.equal(
    entregarCanjeSchema.safeParse({ canje_id: UUID, codigo_entrega: "A1B2CL" }).success,
    false
  );
});

test("el alfabeto del código de entrega no tiene confundibles", () => {
  for (const letra of ["I", "L", "O", "U"]) {
    assert.ok(!ALFABETO_CODIGO.includes(letra), `${letra} no debería estar en el alfabeto`);
  }
  assert.equal(ALFABETO_CODIGO.length, 32, "Crockford-base32");
  assert.equal(new Set(ALFABETO_CODIGO).size, 32, "sin repetidos");
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventario y reglas
// ─────────────────────────────────────────────────────────────────────────────

test("ajustarStockSchema exige un motivo escrito (queda en auditoría)", () => {
  assert.equal(
    ajustarStockSchema.safeParse({ premio_id: UUID, cantidad: -3, motivo: "Rotura en bodega" })
      .success,
    true
  );
  assert.equal(
    ajustarStockSchema.safeParse({ premio_id: UUID, cantidad: -3, motivo: "ok" }).success,
    false,
    "un motivo de 2 letras no explica nada al auditor"
  );
});

test("ajustarStockSchema rechaza el ajuste de cero", () => {
  // Un ajuste de 0 escribiría una fila de auditoría que no dice nada.
  assert.equal(
    ajustarStockSchema.safeParse({ premio_id: UUID, cantidad: 0, motivo: "Recuento anual" }).success,
    false
  );
  assert.equal(
    ajustarStockSchema.safeParse({ premio_id: UUID, cantidad: 2.5, motivo: "Recuento anual" })
      .success,
    false,
    "media gorra no existe"
  );
});

const REGLA_VALIDA = {
  nombre: "1 punto por cada $10",
  monto_base: 10,
  puntos_por_base: 1,
  redondeo: "abajo" as const,
  monto_minimo: 0,
  puntos_maximos_transaccion: 5000,
};

test("reglaPuntosSchema acepta la regla sembrada", () => {
  assert.equal(reglaPuntosSchema.safeParse(REGLA_VALIDA).success, true);
});

test("reglaPuntosSchema impide publicar una regla que divide por cero", () => {
  // `calcularPuntos` ya se defiende, pero dejar entrar la regla haría que el
  // taller acumulara cero puntos en silencio hasta que alguien reclame.
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, monto_base: 0 }).success, false);
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, monto_base: -10 }).success, false);
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, puntos_por_base: 0 }).success, false);
});

test("reglaPuntosSchema permite quitar el tope pero no ponerlo en cero", () => {
  assert.equal(
    reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, puntos_maximos_transaccion: null }).success,
    true,
    "null es 'sin tope'"
  );
  assert.equal(
    reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, puntos_maximos_transaccion: 0 }).success,
    false,
    "tope 0 sería 'nadie acumula nunca'"
  );
});

test("reglaPuntosSchema acepta monto mínimo cero pero no negativo", () => {
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, monto_minimo: 0 }).success, true);
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, monto_minimo: 25.5 }).success, true);
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, monto_minimo: -1 }).success, false);
});

test("reglaPuntosSchema solo admite los dos redondeos declarados", () => {
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, redondeo: "cercano" }).success, true);
  assert.equal(reglaPuntosSchema.safeParse({ ...REGLA_VALIDA, redondeo: "arriba" }).success, false);
});
