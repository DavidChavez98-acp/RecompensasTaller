CREATE TABLE "vehiculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"chasis" text NOT NULL,
	"placa" text,
	"marca" text,
	"modelo" text,
	"anio" integer,
	"color" text,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_por_id" uuid,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_actualizacion" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD COLUMN "vehiculo_id" uuid;--> statement-breakpoint
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_creado_por_id_users_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehiculos_chasis_uq" ON "vehiculos" USING btree ("chasis");--> statement-breakpoint
CREATE INDEX "vehiculos_cliente_id_idx" ON "vehiculos" USING btree ("cliente_id");--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_vehiculo_id_vehiculos_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "puntos_transacciones_vehiculo_fecha_idx" ON "puntos_transacciones" USING btree ("vehiculo_id","fecha_creacion" DESC NULLS LAST);