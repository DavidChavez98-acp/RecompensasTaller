-- Developer: David Sebastian Chavez
-- Application: Recompensas Taller
--
-- Reestructura de roles: separa el dominio de taller (puntos, canjes) del
-- dominio de marketing (inventario), a pedido explícito del dueño del
-- producto — "esta parte no debería estar tan dirigida a talleres porque la
-- manejaría directamente marketing".
--
-- Las dos RENAME VALUE son no-destructivas: Postgres solo cambia la etiqueta,
-- las filas existentes con role='Asesor' o role='Marketing' se leen con el
-- nombre nuevo automáticamente, sin necesitar un UPDATE.
--
-- A mano y no con `drizzle-kit generate`: el diff automático de un enum con
-- valores renombrados tiende a intentar recrear el tipo entero (DROP+CREATE),
-- lo que fallaría contra la columna `users.role` que ya lo usa.
ALTER TYPE "user_role" RENAME VALUE 'Asesor' TO 'Asesor de Servicio';
--> statement-breakpoint
ALTER TYPE "user_role" RENAME VALUE 'Marketing' TO 'Jefe de Marketing';
--> statement-breakpoint
ALTER TYPE "user_role" ADD VALUE 'Asesor Comercial';
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'Asesor de Servicio';
