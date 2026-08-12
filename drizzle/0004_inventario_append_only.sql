-- Developer: David Sebastian Chavez
-- Application: Recompensas Taller
--
-- El ledger de inventario es evidencia contable por el motivo simétrico al de
-- puntos: si el programa de fidelización es un PASIVO de la empresa, el
-- inventario de marketing es un ACTIVO. "¿Por qué hay 12 gorras y no 40?" se
-- responde con filas, no con "porque el número dice 12".
--
-- Corregir un faltante o un sobrante se hace INSERTANDO una fila
-- 'ajuste_conteo' con su motivo, nunca editando o borrando la original.
--
-- Igual que en 0001: esto no se deja como convención. Un UPDATE "para cuadrar
-- el stock" tiene que chocar contra un error de base de datos.
--
-- Se reutiliza a propósito una función NUEVA en vez de `ledger_solo_insercion`:
-- el mensaje de error tiene que decirle al desarrollador qué inserta en su
-- lugar, y "inserte un 'reverso' o 'ajuste'" no aplica aquí.

CREATE OR REPLACE FUNCTION inventario_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'movimientos_inventario es append-only: para corregir, inserte una fila con motivo ''ajuste_conteo'' y su motivo_texto.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS movimientos_inventario_append_only ON movimientos_inventario;
--> statement-breakpoint

CREATE TRIGGER movimientos_inventario_append_only
  BEFORE UPDATE OR DELETE ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION inventario_solo_insercion();
