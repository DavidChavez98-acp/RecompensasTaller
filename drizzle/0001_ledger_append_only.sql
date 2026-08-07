-- Developer: David Sebastian Chavez
-- Application: Recompensas Taller
--
-- El ledger de puntos es evidencia contable: un programa de fidelización es un
-- pasivo de la empresa. Corregir un error se hace INSERTANDO una fila de tipo
-- 'reverso', nunca modificando o borrando la original.
--
-- Esto NO se deja como convención que alguien tenga que recordar. Un
-- desarrollador con prisa, un script de mantenimiento o un agente de IA
-- ejecutando un UPDATE "para arreglar un saldo" tienen que chocar contra un
-- error de base de datos, no contra un comentario.

CREATE OR REPLACE FUNCTION ledger_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'puntos_transacciones es append-only: para corregir, inserte una fila de tipo ''reverso'' o ''ajuste''.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS puntos_transacciones_append_only ON puntos_transacciones;
--> statement-breakpoint

CREATE TRIGGER puntos_transacciones_append_only
  BEFORE UPDATE OR DELETE ON puntos_transacciones
  FOR EACH ROW EXECUTE FUNCTION ledger_solo_insercion();
