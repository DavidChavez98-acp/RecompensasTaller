-- Developer: David Sebastian Chavez
-- Application: Recompensas Taller
--
-- Backfill: cada premio 'merchandising' existente recibe su artículo gemelo,
-- con el stock que ya tenía como saldo inicial del ledger de inventario.
--
-- El WITH hace INSERT y UPDATE en una sola sentencia: crea el artículo y
-- enlaza `premios.articulo_id` sin una ventana entre las dos escrituras.
--
-- El código se reutiliza literal (mismo `codigo` en premios y en articulos):
-- son namespaces UNIQUE distintos, no hay colisión, y así "GORRA" se
-- reconoce como el mismo objeto en las dos tablas sin inventar un mapeo.
WITH nuevos AS (
  INSERT INTO articulos (codigo, nombre, unidad, stock_cache, stock_minimo_alerta, activo, sucursal_id)
  SELECT codigo, nombre, 'unidad', COALESCE(stock, 0), stock_minimo_alerta, activo, sucursal_id
  FROM premios
  WHERE tipo = 'merchandising' AND articulo_id IS NULL
  RETURNING id, codigo
)
UPDATE premios
SET articulo_id = nuevos.id
FROM nuevos
WHERE premios.codigo = nuevos.codigo AND premios.tipo = 'merchandising';
--> statement-breakpoint

-- Un movimiento `ajuste_conteo` por cada artículo con stock inicial != 0, para
-- que el ledger explique de dónde salió ese número. Sin esta fila,
-- `recalcularStock()` vería SUM()=0 contra un stock_cache>0 y lo reportaría
-- como anomalía en el primer barrido nocturno — exactamente el problema que
-- este modelo existe para evitar.
--
-- Los de stock 0 se saltan a propósito: el CHECK de signo exige
-- `cantidad <> 0` en un ajuste_conteo, y un artículo que nace en cero no
-- necesita una fila que diga "se ajustó en cero".
INSERT INTO movimientos_inventario (articulo_id, motivo, cantidad, stock_posterior, motivo_texto)
SELECT id, 'ajuste_conteo', stock_cache, stock_cache, 'Saldo inicial migrado desde premios.stock'
FROM articulos
WHERE stock_cache <> 0
  AND id IN (
    SELECT articulo_id FROM premios WHERE articulo_id IS NOT NULL
  )
  AND id NOT IN (
    SELECT articulo_id FROM movimientos_inventario WHERE articulo_id IS NOT NULL
  );
--> statement-breakpoint

-- El CHECK viejo miraba `stock`; el nuevo mira `articulo_id`. Se reemplaza
-- ahora porque el código que crea premios (`crearPremio` en premios.ts) se
-- actualiza en el mismo cambio para crear siempre el artículo enlazado: el
-- invariante se sostiene sin ventana entre el DDL y el código que lo cumple.
ALTER TABLE premios DROP CONSTRAINT premios_stock_segun_tipo;
--> statement-breakpoint

ALTER TABLE premios ADD CONSTRAINT premios_articulo_segun_tipo
  CHECK ((tipo = 'merchandising' AND articulo_id IS NOT NULL) OR (tipo <> 'merchandising' AND articulo_id IS NULL));
