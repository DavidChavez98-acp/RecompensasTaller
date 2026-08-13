# Recompensas Taller — Grupo Palacios

Programa de fidelización del **taller de servicio**: el cliente acumula puntos por
mantenimientos y reparaciones, y los canjea por merchandising o por servicios.

* **Lead Developer:** David Sebastian Chavez Lemache
* **LinkedIn:** [dschavez0512](https://www.linkedin.com/in/dschavez0512)
* **Proyecto hermano:** `../solicitud credito` — mismo stack, mismas librerías, misma paleta. Ténlo abierto al implementar.

---

## Stack

Next.js 16 App Router (`--webpack` explícito) · React 19 · TailwindCSS v4 + shadcn/ui
(estilo `base-nova`) · Drizzle ORM + Neon Postgres · Server Actions para toda
mutación · Zod · jose · bcryptjs · Nodemailer · `@ducanh2912/next-pwa` · Vercel.

UI **100% en español**. Estilo corporativo sobrio, sin glassmorphism: rojo
institucional `#C81E1E` solo en marca, acción primaria y estados críticos;
radios 0–2px; bordes 1px; sin gradientes ni sombras decorativas.

### Nunca hagas esto

1. **No añadas `turbopack: {}` a `next.config.ts`.** Silenciaría el error de
   `@ducanh2912/next-pwa`, pero el service worker dejaría de generarse sin
   avisar. `dev` y `build` llevan `--webpack` a propósito.
2. **No cambies el driver a `neon-http` ni a `drizzle-orm/vercel-postgres`.**
   El transporte HTTP no soporta `db.transaction()`, y el débito de puntos +
   el INSERT del ledger + el decremento de stock tienen que ser atómicos.
   `src/db/index.ts` elige driver por la cadena de conexión: `pg` sobre TCP
   para `localhost`, Pool WebSocket de Neon para la nube. Los dos soportan
   transacciones.
3. **No hagas UPDATE ni DELETE sobre `puntos_transacciones`.** Un trigger de
   Postgres lo rechaza. Para corregir, inserta una fila `reverso` o `ajuste`.
4. **No corras `drizzle-kit push` contra producción.** Las migraciones son
   archivos generados y se aplican con `pnpm db:migrate`, fuera del build.

---

## Comandos

```bash
pnpm dev              # desarrollo (webpack, PWA desactivada)
pnpm build            # compila. NO toca la base de datos
pnpm db:generate      # genera migración desde src/db/schema.ts
pnpm db:migrate       # aplica migraciones (explícito, nunca en el build)
pnpm db:seed          # siembra idempotente
pnpm test             # tsx --test (unitarias, sin base de datos)
pnpm test:concurrencia # escrituras simultáneas contra Postgres REAL
pnpm test:ciclo-qr    # ciclo del QR con el secreto cifrado en la base
pnpm test:canjes      # doble gasto y carrera por la última unidad de stock
pnpm test:mantenimiento # poda, throttle global y detección de deriva del saldo
pnpm test:inventario  # carrera por la última unidad entre canje y entrega de vehículo
```

Las dos últimas necesitan base de datos y `--conditions=react-server` (por
`server-only`). Cubren lo que un mock nunca podría: cómo resuelve Postgres dos
escrituras simultáneas sobre la misma fila, y el descifrado real del secreto.

Sin credenciales SMTP en desarrollo, los correos (incluido el código OTP) se
escriben en `.data/sent_emails.log`.

### Postgres local

Instalado con Homebrew (`postgresql@17`), base `recompensas_taller`. Los
binarios son keg-only:

```bash
export PATH="/usr/local/opt/postgresql@17/bin:$PATH"
```

```bash
brew services start postgresql@17
```

```bash
brew services stop postgresql@17
```

Empezar de cero:

```bash
dropdb recompensas_taller && createdb recompensas_taller && pnpm db:migrate && pnpm db:seed
```

Cuentas sembradas en desarrollo: `admin@grupopalacios.com.ec` / `Taller2026`
(Admin, único creado por `pnpm db:seed`). Las demás se crean a mano para
probar el filtro por rol — `asesor@grupopalacios.com.ec` / `Asesor2026`
(Asesor de Servicio), `jefe@grupopalacios.com.ec` / `TallerJefe2026` (Jefe de
Taller), `marketing@grupopalacios.com.ec` / `Marketing2026` (Jefe de
Marketing) y `comercial@grupopalacios.com.ec` / `Comercial2026` (Asesor
Comercial).

---

## Convenciones

**Nombres de tabla:** infraestructura en inglés (`users`, `settings`,
`error_log`, `admin_audit_log`) porque se copia literal del hermano; dominio en
español (`clientes`, `canjes`, `puntos_transacciones`).

**Divergencias deliberadas frente al hermano**, no las "corrijas":

| | Aquí | Hermano | Por qué |
|---|---|---|---|
| Timestamps | `timestamptz` | ingenuo | Reportes por día en `America/Guayaquil`; Vercel corre en UTC |
| Migraciones | generadas + `db:migrate` | `push` en el build | El ledger es evidencia contable; un `push` accidental es irreversible |
| Driver | Pool WebSocket de Neon | HTTP de `@vercel/postgres` | Transacciones interactivas |
| Iconos PWA | `maskable` en archivo aparte | `"any maskable"` juntos | Android recorta y amplía el icono compartido |
| Auth mock | no existe | `ENABLE_MOCK_AUTH` | Concede Admin sin contraseña; aquí protege un pasivo contable |

---

## Arquitectura

### El ledger es la fuente de verdad

`puntos_transacciones` es **append-only** (trigger en
`drizzle/0001_ledger_append_only.sql`). `puntos` va **con signo**, así que el
saldo es un `SUM()`, no un `CASE/WHEN`.

`clientes.saldo_cache` es una **denormalización**, no la verdad: se actualiza en
la misma transacción que el ledger para que las listas no disparen un `SUM()`
por fila. Lo que agota el free tier de Neon son los N+1, no una consulta cara
suelta. `recalcularSaldo()` verifica y auto-sana.

### Doble gasto: un solo `UPDATE` condicional

`SELECT` → comprobar en JS → `INSERT` **no es seguro** en READ COMMITTED, y un
CTE de una sola sentencia tampoco (lee del mismo snapshot). La primitiva
correcta:

```sql
UPDATE clientes SET saldo_cache = saldo_cache - $costo
 WHERE id = $cliente AND saldo_cache >= $costo
RETURNING saldo_cache;
```

Postgres reevalúa el `WHERE` contra la versión nueva de la fila al desbloquearse
(EvalPlanQual), así que la segunda transacción devuelve 0 filas = saldo
insuficiente. Mismo patrón para `premios.stock` y para cada transición de estado
de `canjes`.

### QR de identidad

El QR **identifica al cliente, no es un cupón**, y no contiene PII. TOTP-like
HMAC-SHA256 con el secreto del dispositivo cifrado en reposo; se genera **sin
red** porque el teléfono del cliente puede estar sin datos en el mostrador.

`verificarQr()` quema el nonce (`UNIQUE (dispositivo_id, paso)`) y emite un
ticket de 5 minutos; `acreditarPuntos()` consume el ticket. Un escaneo produce
como máximo una acreditación **por constraint**, no por lógica de aplicación.

### PII y LOPDP

Cédula, email, teléfono y el secreto del dispositivo van cifrados con
AES-256-GCM (`src/lib/pii-crypto.ts`), con índices ciegos HMAC para poder
filtrar sin descifrar. El descifrado ocurre **una vez, en el borde de lectura**:
si añades una consulta directa que esquive los helpers, descifra ahí también.

La baja LOPDP **anonimiza al cliente sin borrar el ledger** — es registro
contable. `anonimizarMiCuenta()` (`src/actions/lopdp.ts`) bloquea la baja si
hay un canje `solicitado` o `aprobado` sin resolver (puntos ya debitados o
stock ya reservado quedarían huérfanos), nunca toca `identificacion_idx`
(`solicitarCodigoOtp` depende de que siga intacto para responder "Acércate al
taller" en vez de tratar la cédula como nueva), y envía un correo de
confirmación antes de perder el email descifrado.

**Aplazamiento consciente, no laguna**: hoy no hay ninguna pantalla en
`/interno` para reactivar a un cliente ya anonimizado que vuelve al taller.
El código ya deja la puerta abierta (el mensaje de login se lo dice al
cliente), pero nadie del staff puede revertir `anonimizado_en`. Fuera de
alcance del hito 8 porque ese hito es cliente-facing; si hace falta,
es una pantalla nueva en la ficha del cliente con su propio predicado.

### Canjes

Aprobación **siempre humana** (Jefe de Taller o Admin), porque marketing no
siempre tiene stock y alguien debe confirmarlo contra bodega.

- Los **puntos se debitan al solicitar** (evita sobregiro con varios canjes en cola).
- El **stock se reserva al aprobar** (el número del sistema nunca miente).
- Quien aprueba **no** es quien entrega: el Asesor de Servicio entrega con `codigo_entrega`.

Consecuencia asumida: si queda una gorra y dos clientes la piden, ambos pagan
puntos, uno se aprueba y al otro se le devuelven automáticamente. El mensaje de
rechazo tiene que decirlo con claridad, no ser un error genérico.

### El mantenimiento corre sin cron, con throttle en base

`ejecutarMantenimiento()` se dispara con `after()` desde el layout del panel
interno: no añade latencia a la respuesta, y en un taller donde el personal
entra a diario se ejecuta a diario sin infraestructura extra.

El throttle vive en una fila de `settings`, **no en memoria**: en serverless
cada instancia tiene su propia memoria y el barrido correría decenas de veces
al día. La marca se toma con un UPDATE condicional, así que dos instancias
simultáneas no lo repiten.

La poda de `qr_escaneos` excluye los que el ledger referencia. Un DELETE a
secas chocaría contra la clave foránea, y perder la trazabilidad de una
acreditación es peor que gastar unos kilobytes.

### Reglas versionadas, multiplicadores en sitio

`reglas_puntos` **nunca** recibe un UPDATE: publicar una regla inserta una fila
nueva y cierra la anterior con `vigente_hasta`, todo en una transacción (si
fueran dos pasos, una acreditación en medio vería dos reglas vigentes o
ninguna). El ledger guarda `regla_id`, así que "¿por qué a este cliente le
dieron 15 puntos?" tiene respuesta meses después.

`servicios_tipo.multiplicador` sí se edita en sitio, porque el ledger guarda
`multiplicador_aplicado` como copia en el momento de la acreditación. La
trazabilidad ya está garantizada por ese snapshot.

### Las pruebas de concurrencia deben llamar al MISMO código

`scripts/prueba-canjes.ts` reimplementaba el `INSERT` del canje en vez de usar
`crearCanjeIdempotente`, y por eso pasó en verde mientras producción reventaba
con un `ON CONFLICT` roto. Si una prueba reimplementa la operación, prueba la
reimplementación.

Por eso la parte atómica vive en `src/lib/canje-operaciones.ts` y
`src/lib/saldo.ts`, no dentro de las Server Actions: una Server Action necesita
cookies y no se puede invocar desde un script.

### ON CONFLICT contra índices parciales

Varios índices únicos del esquema son PARCIALES (`WHERE … IS NOT NULL`).
Postgres solo los usa para inferir el conflicto si la sentencia repite ese mismo
predicado. Sin él responde **42P10**, "no unique or exclusion constraint
matching the ON CONFLICT specification".

En Drizzle 0.45 el predicado va en `where` dentro de `onConflictDoNothing`
(no existe `targetWhere`), y se emite como `ON CONFLICT (...) WHERE ... DO NOTHING`.

### Drizzle envuelve los errores de Postgres

Un fallo de consulta llega como `DrizzleQueryError` cuyo `.message` solo dice
`Failed query: insert into…`. **El motivo real vive en la cadena de `cause`.**

Nunca inspecciones errores de base de datos por texto del mensaje. Usa el código
SQLSTATE recorriendo `cause` (ver `esViolacionDeUnicidad` en `src/lib/saldo.ts`):
el código no cambia con el idioma del servidor ni con la versión de Drizzle.
Este archivo tuvo exactamente ese bug — comparaba con `includes("duplicate key")`
y los duplicados salían como excepción sin controlar en vez de un mensaje
entendible para el asesor.

### Toda exportación de un archivo "use server" es un endpoint público

Cualquier función exportada desde un módulo con `"use server"` se puede invocar
desde el navegador con los argumentos que sea. `obtenerSecretoDispositivo` vivió
un rato en `src/actions/dispositivos.ts` y eso habría permitido a cualquiera
pedir el secreto de un dispositivo ajeno y forjar sus códigos QR.

Mismo bug, segunda vez: `createPasswordSetupToken` vivió en `auth-interno.ts`
sin consumidor todavía (esperando el hito "Usuarios"), pero ya era invocable
sin sesión — cualquiera podía pedir un JWT de 48h para tomar cualquier cuenta.
Una auditoría de seguridad lo encontró antes de que alguien conectara el
consumidor. Ahora vive en `src/lib/password-setup.server.ts`.

Tercera vez: `avisarStockBajo` vivía en `premios.ts` sin comprobar sesión —
solo mandaba un correo, pero cualquiera podía invocarla directo con el id de
un premio agotado y spamear a todo Admin cuantas veces quisiera. Ahora vive en
`src/lib/stock-alertas.server.ts`. Ninguna de las tres veces fue una función
que alguien olvidó proteger a propósito: fue la costumbre de escribir un
helper reutilizable dentro del mismo archivo "use server" que ya estaba
abierto, sin pensar que ESE archivo entero es superficie pública.

Lo que no deba ser invocable va en un módulo normal con `import "server-only"`
(ver `src/lib/qr-token.server.ts` y `src/lib/saldo.ts`).

### Base UI no es Radix

shadcn está configurado con el estilo `base-nova`, que usa **Base UI**, no Radix:

- No hay `asChild`. Se usa `render={<Link href="…" />}`, y al renderizar un `<a>`
  hay que añadir `nativeButton={false}` o Base UI avisa de que rompe la
  accesibilidad del formulario.
- `Input` guarda su valor en estado interno. Asignar `input.value` por
  JavaScript no lo actualiza; hay que pasar por el setter nativo de
  `HTMLInputElement` y disparar un evento `input`. Importa al escribir pruebas
  automatizadas, no al usuario real.
- `Label` trae `flex items-center`. En un consentimiento con enlaces dentro hay
  que forzar `block` o el texto se reparte en columnas.

### Autorización: la navegación NO es la defensa

`src/app/interno/(panel)/layout.tsx` oculta los enlaces que el rol no puede
usar, pero eso es **cosmético**: cualquiera que escriba la URL a mano llega a la
página. Cada página y cada Server Action de `/interno` tiene que llamar por su
cuenta al predicado que le corresponda (`puedeAprobarCanje`, `puedeGestionarPremios`,
`puedeGestionarReglas`, …) y cortar antes de tocar la base.

Hoy no hay agujero porque esas páginas todavía no existen. En el momento en que
se cree la primera, la comprobación va dentro, no en el menú.

### Cinco roles, dos dominios que no se cruzan

`Asesor` se renombró a **Asesor de Servicio** y `Marketing` a **Jefe de
Marketing** (`ALTER TYPE ... RENAME VALUE`, no destructivo: las filas
existentes se leen con el nombre nuevo sin tocar datos). Se sumó **Asesor
Comercial**. Decisión explícita del dueño del producto, no una limpieza de
nombres: taller y marketing son mundos separados.

- **Taller** (Jefe de Taller, Asesor de Servicio): puntos, canjes, clientes.
  `puedeAcreditarPuntos`, `puedeAprobarCanje`, `puedeEntregarCanje`,
  `puedeRevertirPuntos`, `puedeVerReportes`.
- **Marketing** (Jefe de Marketing, Asesor Comercial): inventario.
  `puedeGestionarPremios`, `puedeGestionarInventario`,
  `puedeRegistrarSalidaInventario`.

El taller **no** tiene ninguno de los tres predicados de marketing — ni para
consultar stock. "Esta parte no debería estar tan dirigida a talleres porque
la manejaría directamente marketing, que es lo que sabe lo que tiene
físicamente" — cita textual del dueño. El único punto de contacto entre los
dos dominios es `aprobarCanjeAtomico`, que descuenta el artículo por su cuenta
sin que el Jefe de Taller necesite ningún permiso de inventario.

`puedeGestionarInventario` (alta de artículos, ingresos, ajustes) y
`puedeRegistrarSalidaInventario` (solo salidas: entrega de vehículo, feria)
son predicados DISTINTOS aunque hoy los tenga el mismo rol (Jefe de
Marketing) además de Admin: el Asesor Comercial solo tiene el segundo,
angosto a propósito — puede sacar mercadería y dejar constancia de por qué,
pero no dar de alta artículos ni tocar el resto del inventario.

`/interno/inventario` (`src/actions/inventario.ts`) es la pantalla que usa
esos dos predicados. Distinto de `crearPremio` (en `premios.ts`): ese sigue
siendo el camino para un merchandising CANJEABLE, que crea su artículo
enlazado en la misma transacción. `crearArticulo` aquí es para lo que nunca
es canjeable — un roll-up, un tríptico — artículo sin premio. La salida por
`salida_entrega_vehiculo` revalida el `vehiculo_id` contra la base aunque
venga de buscar por chasis en la misma pantalla: un id inventado no debe
poder colarse en el ledger como si fuera una entrega real.

### Vehículos: el chasis es la segunda identidad

El Jefe de Taller no busca por cédula, busca por carro. `vehiculos` cuelga de
`clientes` (varios por cliente) y el chasis es único. **No va cifrado**, a
diferencia de cédula/email/teléfono: no es PII de la persona, es un dato del
vehículo, y cifrarlo impediría la búsqueda exacta que el mostrador necesita.

El historial "qué se le hizo a este chasis" **no es una tabla nueva**: es
`puntos_transacciones.vehiculo_id`, nullable, sobre el ledger que ya existía.
Lo que se acredita ahí —servicio, monto, fecha, puntos— ya era exactamente lo
que hacía falta, agrupado por auto en vez de por cliente.

El chasis se normaliza a mayúsculas sin espacios ni guiones (`chasisSchema`).
No se exige el VIN de 17 caracteres de la ISO 3779: por el taller pasan motos
y vehículos anteriores a 1981 con chasis más cortos.

### El inventario de marketing es el gemelo del ledger de puntos

Si el programa de fidelización es un **pasivo**, el inventario de marketing es
un **activo**, y necesita las mismas garantías. Por eso `articulos` +
`movimientos_inventario` replican exactamente `clientes` + `puntos_transacciones`:
ledger append-only con trigger, `cantidad` con signo, `stock_cache`
denormalizado, `stock_posterior` del `RETURNING`, y el mismo `UPDATE`
condicional para la concurrencia. Ver `PLAN-INVENTARIO-MARKETING.md`.

**`premios.stock` está deprecado y ya NO se escribe en ningún camino de
producción.** El stock pertenece al ARTÍCULO, no al premio: la misma gorra
sale por canje, por entrega de vehículo, por feria y por merma. Un premio es
una oferta del catálogo; un artículo es una cosa en bodega. Un roll-up es
artículo y nunca premio.

El backfill (`drizzle/0005_backfill_articulos.sql`) ya corrió: cada
merchandising existente tiene su artículo gemelo, con un `ajuste_conteo`
inicial que explica de dónde salió el stock. El CHECK
`premios_articulo_segun_tipo` reemplazó al viejo `premios_stock_segun_tipo` —
un merchandising SIEMPRE tiene `articulo_id`, nunca `stock`. La columna
`stock` sobrevive solo hasta que se verifique en producción; el `DROP COLUMN`
va en una migración aparte.

`crearPremio` crea el artículo enlazado en la MISMA transacción que el premio
(un merchandising sin artículo violaría el CHECK al instante). `actualizarPremio`
rechaza cambiar `tipo` después de creado — el formulario ya lo deshabilita,
pero la Server Action lo vuelve a comprobar, porque el formulario nunca es la
defensa. `ajustarStock` y `avisarStockBajo` leen y escriben el artículo, no
`premios.stock`.

**Patrón para escrituras que comparten atomicidad con otra tabla**:
`aplicarMovimientoInventario` (en `src/lib/inventario.ts`) abre su propia
transacción, pero `aplicarMovimientoInventarioEnTx` es el mismo núcleo SIN
transacción propia, para poder anidarlo dentro de la transacción de otra
operación. `aprobarCanjeAtomico` (en `canje-operaciones.ts`) lo usa así: el
cambio de estado del canje y el descuento del artículo tienen que ser todo o
nada, y Postgres no da esa garantía si `db.transaction()` se anida dentro de
otro `db.transaction()` sin `SAVEPOINT` explícito. Cuando una escritura NO
comparte atomicidad con nada más (`devolverStock`, un ingreso de mercadería),
se usa el wrapper público, no el núcleo con `db` pasado como si fuera un `tx`.

Dos CHECK que no son decorativos:

- **El signo debe coincidir con el prefijo del motivo** (`ingreso_*` positivo,
  `salida_*` negativo, `ajuste_conteo` cualquiera menos cero). Sin esta regla un
  error de signo es una entrada silenciosa que solo aparece en el conteo físico,
  meses después.
- Se usa `starts_with(motivo::text, …)` y **no `LIKE`**: `motivo` es un enum y
  `LIKE` no opera sobre enums sin cast (42883), pero sobre todo porque en `LIKE`
  el `_` es comodín de un carácter y `'ingreso_%'` casaría también con
  `'ingresoX…'`.

### Campos declarados que v1 no usa

`sucursal_id`, `nivel_id`, `expira_en`, `secuencia` y el valor `'expiracion'`
del enum existen desde el día 1. Multi-sucursal, niveles y caducidad están fuera
del alcance de v1, pero encenderlos debe ser insertar filas y escribir un job.
`ALTER TYPE ... ADD VALUE` a posteriori además tiene restricciones de
transacción molestas.

### Los activos de marca, y qué es cada archivo

El isotipo de Grupo Palacios **es un velocímetro**: disco negro, sector rojo
arriba, aguja, sobre un zócalo de tablero. No es un escudo ni un monograma. Es
un gráfico que MIDE, y esta app existe para mostrar una medida — de ahí que el
avance hacia el siguiente premio se dibuje y no solo se escriba.

| Archivo | Qué es | Dónde va |
|---|---|---|
| `logo-gp-isotipo.svg` | El instrumento solo | Favicon, estados vacíos, centro del QR |
| `logo-gp-horizontal.svg` | Lockup horizontal, para fondo claro | Cabecera de la PWA, pantallas de acceso |
| `logo-gp-horizontal-blanco.svg` | Igual pero blanco, **conservando el rojo** | Cabecera oscura del panel interno |
| `logo-gp-vertical.svg` | Lockup apilado: instrumento + logotipo | Marca grande. **Nunca de favicon**: a 16px el logotipo es una mancha |

El logotipo son CONTORNOS, no texto, y su tipografía **no es IBM Plex**.
Componer "Grupo Palacios" con la fuente del sistema produce el logo de otra
empresa. El tagline "desde 1978" sí se puede poner como línea aparte en IBM
Plex (11px, versalitas, `tracking: 0.14em`, apagado, **nunca en rojo**): un
tagline en otra tipografía es normal, un logotipo en otra tipografía está roto.

Falta pedir al diseñador: el lockup vertical **con** el tagline.

### La escala tipográfica es la identidad disponible

Sin gradientes, sin sombras y con el rojo restringido a marca / acción / crítico,
la tipografía es casi lo único que queda para no parecer shadcn por defecto.
Las utilidades `.t-*` de `globals.css` son el sistema; `.t-seccion` (versalitas)
es la que más rinde. **Un `<h2>` nunca debe ser más pequeño ni más pálido que el
cuerpo que encabeza** — lo fue durante seis hitos.

Regla del dato numérico: la unidad siempre un escalón por debajo de la cifra y
apagada ("1.250" grande + "pts" pequeño). El subrayado rojo de 2px marca la cifra
protagonista, **una por pantalla**.

### "No hay nada dinámico" casi nunca significa animaciones

Cuando el dueño lo dijo, la app ya tenía microinteracción razonable (la cuenta
atrás del QR, transiciones de 200ms). Lo que faltaba eran DATOS: el panel
interno no ejecutaba ni una consulta mientras `getResumenGeneral()` calculaba
ocho métricas encerradas tras `puedeVerReportes`, y el home del cliente mostraba
un número que solo cambia tres veces al año.

Antes de añadir movimiento, comprobar que la pantalla tiene algo que mostrar.

---

## Estado

| Hito | Estado |
|---|---|
| 1 · Cimientos (schema, migraciones, seed, auth interno, panel) | **Hecho** |
| 2 · Identidad del cliente (cédula + OTP, sesión 180 días, LOPDP) | **Hecho** |
| 3 · Bucle núcleo (QR, escáner, ledger, acreditación) | **Hecho** |
| 4 · Configuración (reglas versionadas, multiplicadores) | **Hecho** |
| 5 · Canjes e inventario | **Hecho** |
| 6 · Control (reportes, antifraude, recálculo nocturno) | **Hecho** |
| 7 · Inventario de marketing (artículos, ledger, salidas, reportes) | **Hecho** |
| 8 · LOPDP + PWA (cuenta, offline, iconos) | **Hecho** |
