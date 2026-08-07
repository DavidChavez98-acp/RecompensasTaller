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
(Admin) y `asesor@grupopalacios.com.ec` / `Asesor2026` (Asesor, creado a mano
para probar el filtro por rol).

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
contable.

### Canjes

Aprobación **siempre humana** (Jefe de Taller o Admin), porque marketing no
siempre tiene stock y alguien debe confirmarlo contra bodega.

- Los **puntos se debitan al solicitar** (evita sobregiro con varios canjes en cola).
- El **stock se reserva al aprobar** (el número del sistema nunca miente).
- Quien aprueba **no** es quien entrega: el Asesor entrega con `codigo_entrega`.

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

### Campos declarados que v1 no usa

`sucursal_id`, `nivel_id`, `expira_en`, `secuencia` y el valor `'expiracion'`
del enum existen desde el día 1. Multi-sucursal, niveles y caducidad están fuera
del alcance de v1, pero encenderlos debe ser insertar filas y escribir un job.
`ALTER TYPE ... ADD VALUE` a posteriori además tiene restricciones de
transacción molestas.

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
| 7 · LOPDP + PWA (cuenta, offline, manifest, iconos) | Pendiente |
