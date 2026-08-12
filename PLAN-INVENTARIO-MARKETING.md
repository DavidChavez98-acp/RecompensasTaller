# Hito 7 · Inventario de marketing

> Plan acordado el 8 de agosto de 2026. Decisiones tomadas con el dueño del
> producto; las cuatro que definen el diseño están al final, en "Decisiones".

El concesionario quiere que esta app deje de ser solo el programa de puntos y
pase a ser **el inventario de marketing del grupo**. Marketing registra lo que
tiene, registra lo que saca —para entregas de vehículo, para ferias, para
mermas— y las salidas del taller (los canjes) descuentan del mismo stock, no de
un número aparte.

---

## 1 · El problema con el modelo actual

Hoy `premios.stock` es el dueño del inventario. Eso funcionaba mientras el
único camino de salida era el canje. Ya no lo es:

```
                    ┌─ canje aprobado en el taller
   una gorra ───────┼─ obsequio al entregar un vehículo
   en bodega        ├─ feria / activación
                    ├─ merma (daño, robo)
                    └─ uso interno
```

Un premio es una **oferta del catálogo**: tiene costo en puntos, imagen, orden,
visibilidad. Un artículo es una **cosa física en bodega**: tiene unidades, costo
unitario y un umbral de reposición. No son lo mismo, y hoy están fundidos en una
sola fila.

Consecuencias concretas de dejarlo así:

- Un banner o un roll-up no se puede registrar: no es canjeable, así que no
  puede ser un `premio`, así que no existe para el sistema.
- Si la misma gorra se ofrece como premio y además se regala en entregas, hay
  que llevar dos contadores y conciliarlos a mano.
- `premios.stock` no tiene historial: se sabe que hay 12, no por qué hay 12.

## 2 · El modelo nuevo

**Es el mismo patrón que ya está probado en los puntos**, y esa es la razón
principal para elegirlo: el razonamiento de `AGENTS.md` sobre el ledger de
puntos aplica palabra por palabra al inventario.

```
articulos                       movimientos_inventario  (APPEND-ONLY)
─────────                       ──────────────────────
id                              id
codigo          UNIQUE          articulo_id      FK
nombre                          motivo           enum
unidad                          cantidad         CON SIGNO
stock_cache     ← denormaliza   stock_posterior  ← del RETURNING, no de JS
stock_minimo_alerta             canje_id         FK nullable
costo_unitario                  vehiculo_id      FK nullable
activo                          evento           text nullable
                                motivo_texto     obligatorio en ajuste/merma
      ▲                         costo_unitario   snapshot
      │                         creado_por_*
      └──────── SUM() ───────── fecha_creacion
```

`premios.articulo_id` — FK nullable. Un premio de tipo `merchandising` **debe**
apuntar a un artículo; uno de tipo `servicio` **no debe** (un cambio de aceite
no se agota). Es la misma invariante que hoy expresa el CHECK
`premios_stock_segun_tipo`, mudada de casa: en vez de "merchandising exige
`stock` NOT NULL" pasa a "merchandising exige `articulo_id` NOT NULL".

`premios.stock` desaparece. Su valor se migra a `articulos.stock_cache`.

### Motivos de movimiento

```ts
motivoInventarioEnum = pgEnum("motivo_inventario", [
  "ingreso_compra",           // +  recepción de mercadería del proveedor
  "ingreso_devolucion",       // +  lo que volvió de una feria
  "ajuste_conteo",            // ±  corrección tras conteo físico
  "salida_canje",             // −  canje aprobado en el taller
  "salida_entrega_vehiculo",  // −  obsequio al entregar un carro
  "salida_evento",            // −  feria, activación, patrocinio
  "salida_merma",             // −  daño, robo, vencimiento
  "salida_interna",           // −  uso del propio concesionario
]);
```

El enum va **completo desde el día 1**, incluidos los motivos que v1 no vaya a
usar. `ALTER TYPE ... ADD VALUE` a posteriori tiene restricciones de transacción
molestas — la misma razón por la que `tipo_transaccion` ya trae `'expiracion'`.

### Por qué append-only, otra vez

Un inventario de marketing es un activo de la empresa igual que los puntos son
un pasivo. "¿Por qué hay 12 gorras y no 40?" tiene que responderse con filas.
Mismo trigger `BEFORE UPDATE OR DELETE` que en `puntos_transacciones`, misma
regla: **para corregir se inserta `ajuste_conteo`, nunca se edita una fila**.

### Concurrencia: el mismo UPDATE condicional

Ahora hay más de un canal descontando del mismo artículo a la vez — un canje
aprobándose mientras un asesor registra una entrega de vehículo. La primitiva no
cambia:

```sql
UPDATE articulos
   SET stock_cache = stock_cache + $cantidad,
       stock_cache_actualizado = now()
 WHERE id = $articulo AND stock_cache + $cantidad >= 0
RETURNING stock_cache;
```

Con `$cantidad` negativa el `WHERE` exige existencias. Postgres reevalúa la
condición contra la versión nueva de la fila al desbloquearse (EvalPlanQual), así
que la segunda transacción devuelve 0 filas. `stock_posterior` sale del
`RETURNING`, nunca de una resta en JavaScript.

Vive en `src/lib/inventario.ts`, con `import "server-only"`, junto a `saldo.ts`
y por el mismo motivo: **una prueba de concurrencia tiene que poder llamar a la
misma función que llama producción**, y una Server Action necesita cookies y no
se puede invocar desde un script.

`UNIQUE` parcial en `(canje_id) WHERE canje_id IS NOT NULL`: un canje descuenta
como máximo una vez, por constraint, no por lógica.

## 3 · Autorización configurable

Decisión del dueño: Marketing y Asesor pueden registrar salidas por entrega de
vehículo, **pero el Admin debe poder activar o desactivar eso desde
configuración**.

Esto rompe el patrón de `authz.ts`, donde los predicados son funciones puras. Se
hace igual, con tres candados:

1. **Solo ensancha dentro de un conjunto cerrado.** La configuración decide si
   el Asesor entra o no. Admin, Marketing y Jefe de Taller están fijos en código.
   Ningún valor de configuración puede conceder algo que el código no contemple.
2. **Solo el Admin la cambia**, y cada cambio pasa por `logAdminAction`.
3. **La comprobación sigue siendo del servidor.** La configuración es un
   parámetro del predicado, no un sustituto: cada Server Action llama a
   `await puedeRegistrarSalida(sesion, motivo)` antes de tocar la base. El menú
   sigue siendo cosmético (ver `AGENTS.md`, "la navegación NO es la defensa").

El predicado pasa a ser `async` porque lee `settings`. Es el primero del archivo
que lo es; hay que revisar que ningún llamador lo invoque sin `await` — un
`Promise` es *truthy* y saltarse el `await` abriría el permiso a todo el mundo
en silencio. Vale la pena una prueba dedicada a exactamente eso.

## 4 · Ferias: salida y reingreso sueltos

Decisión del dueño. Sacar 50 gorras a una feria y volver con 12 son **dos
movimientos independientes**: `salida_evento −50` e `ingreso_devolucion +12`,
ambos con el mismo texto en `evento`.

Es lo más simple que puede funcionar y no inventa una máquina de estados que
alguien tendría que cerrar. El riesgo asumido —que nadie registre el reingreso y
el stock quede bajo para siempre— se mitiga con un reporte, no con schema:

> **Ferias sin cerrar** — eventos con `salida_evento` y ningún
> `ingreso_devolucion` después de N días. Sale en `/interno/reportes` y en el
> correo del Admin.

## 5 · Pantallas

| Ruta | Quién | Qué |
|---|---|---|
| `/interno/inventario` | Admin, Marketing | Lista de artículos con stock, badge de stock bajo, buscador |
| `/interno/inventario/[id]` | Admin, Marketing | Ficha: datos, stock actual, **historial completo de movimientos** |
| `/interno/inventario/nuevo` | Admin, Marketing | Alta de artículo |
| Ingreso de mercadería | Admin, Marketing | Cantidad + costo unitario + referencia de factura |
| Salida | según configuración | Motivo, cantidad, y campo contextual: evento (feria), chasis (entrega de vehículo), texto obligatorio (merma/ajuste) |
| `/interno/configuracion` | Admin | Quién puede registrar salidas, umbrales de alerta, días para "feria sin cerrar" |

La salida por **entrega de vehículo** engancha con el trabajo de vehículos que
ya está en la base: `movimientos_inventario.vehiculo_id` apunta a `vehiculos`, y
la pantalla busca el vehículo por chasis con `buscarVehiculoPorChasis`, que ya
existe. Queda cerrado el círculo que pidió el Jefe de Taller: el chasis
identifica al carro, y por el chasis se ve tanto el historial de servicios como
lo que se le obsequió.

## 6 · Migración de los premios existentes

Purament aditiva salvo el `DROP COLUMN` final, y en ese orden:

1. `CREATE TABLE articulos`, `CREATE TABLE movimientos_inventario`, enum, trigger.
2. `ALTER TABLE premios ADD COLUMN articulo_id uuid REFERENCES articulos(id)`.
3. **Backfill en SQL**: por cada premio `merchandising`, crear un artículo con
   su nombre y código, `stock_cache` = el `stock` actual, y apuntar
   `premios.articulo_id` al artículo nuevo.
4. Un `movimientos_inventario` de `ajuste_conteo` por cada artículo creado, con
   `motivo_texto = 'Saldo inicial migrado desde premios.stock'`. Sin esto el
   ledger arrancaría sin explicar de dónde salió el stock inicial, que es
   justamente lo que este modelo viene a arreglar.
5. Reemplazar el CHECK `premios_stock_segun_tipo` por su equivalente sobre
   `articulo_id`.
6. `ALTER TABLE premios DROP COLUMN stock, DROP COLUMN stock_minimo_alerta`.

El paso 6 va en una **migración aparte**, aplicada después de verificar en
producción que el backfill quedó bien. `AGENTS.md` es explícito: las migraciones
son evidencia contable y no se aplican en el build.

`aprobarCanje` deja de descontar `premios.stock` y pasa a llamar a
`aplicarMovimientoInventario({ motivo: "salida_canje", cantidad: -1, canje_id })`.
`scripts/prueba-canjes.ts` —que hoy prueba la carrera por la última unidad—
tiene que apuntar a la tabla nueva, o dejará de probar nada.

---

## 7 · Plan de agentes

Cada agente termina con `pnpm build` verde, `pnpm lint` limpio y sus pruebas
pasando. Entre agentes corre `cavecrew-reviewer` sobre el diff.

| # | Agente | Entrega | Depende de |
|---|---|---|---|
| **A** | **Esquema y primitiva atómica** | Enum, `articulos`, `movimientos_inventario`, trigger append-only, migración de backfill, `src/lib/inventario.ts` | — (bloquea a todos) |
| **B** | **Reconexión del catálogo** | `premios.articulo_id`, `aprobarCanje` descontando del artículo, CHECK nuevo, `prueba-canjes.ts` actualizado, migración del `DROP COLUMN` | A |
| **C** | **Pantallas de inventario** | `/interno/inventario` completo: lista, ficha con historial, alta, ingreso, salidas | A |
| **D** | **Autorización configurable** | `puedeRegistrarSalida` async, `/interno/configuracion`, auditoría de cada cambio | A |
| **E** | **Reportes** | Valorización del inventario, ferias sin cerrar, consumo por canal, alerta de stock bajo por correo | A, B |
| **F** | **Pruebas de concurrencia** | Carrera por la última unidad **entre canales distintos** (canje vs entrega de vehículo simultáneos), doble descuento del mismo canje, `await` faltante en el predicado async | A, B, D |

**C y D pueden correr en paralelo** en cuanto A termine. E y F cierran.

A lo hago yo, no un agente: `AGENTS.md` lista `src/db/schema.ts` como el archivo
más caro de equivocar del proyecto, y el backfill toca datos que ya existen.

---

## 8 · Pruebas

Unitarias (`pnpm test`, sin base):

- Cálculo de signo por motivo: que `salida_*` nunca produzca cantidad positiva
  y `ingreso_*` nunca negativa. Es la clase de error que un ledger con signo
  hace silencioso.
- `puedeRegistrarSalida` — matriz rol × motivo × configuración, incluida la
  combinación prohibida y el caso del `await` omitido.

Integración contra Postgres real (`pnpm test:inventario`, nuevo):

- 10 salidas simultáneas sobre un artículo con una sola unidad → exactamente 1
  éxito, 9 rechazos, `stock_cache = 0`, **nunca negativo**, y 1 sola fila de
  movimiento.
- Canje y entrega de vehículo compitiendo por la última unidad → gana uno solo.
- El mismo `canje_id` intentando descontar dos veces → el UNIQUE parcial lo corta.
- Trigger append-only: `UPDATE` y `DELETE` sobre `movimientos_inventario` fallan.
- Backfill: stock migrado == `SUM(cantidad)` del ledger para cada artículo.

---

## Decisiones

| Tema | Decisión | Consecuencia asumida |
|---|---|---|
| Ferias | Salida y reingreso como movimientos sueltos | Si nadie registra el reingreso, el stock queda bajo. Se mitiga con el reporte de "ferias sin cerrar", no con schema |
| Alcance | Inventario completo, no solo lo canjeable | `articulos` existe por sí sola; un banner es artículo y nunca premio |
| Quién saca | Marketing y Asesor, **configurable por el Admin** | El predicado deja de ser puro y pasa a leer `settings`; se vuelve `async` |
| Momento | Antes del hito 7 (LOPDP + PWA) | Se toca el catálogo de premios una sola vez, en vez de dos |
