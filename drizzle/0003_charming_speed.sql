CREATE TYPE "public"."motivo_inventario" AS ENUM('ingreso_compra', 'ingreso_devolucion', 'ajuste_conteo', 'salida_canje', 'salida_entrega_vehiculo', 'salida_evento', 'salida_merma', 'salida_interna');--> statement-breakpoint
CREATE TABLE "articulos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"unidad" text DEFAULT 'unidad' NOT NULL,
	"stock_cache" integer DEFAULT 0 NOT NULL,
	"stock_cache_actualizado" timestamp with time zone,
	"stock_minimo_alerta" integer,
	"costo_unitario" numeric(10, 2),
	"imagen_url" text,
	"activo" boolean DEFAULT true NOT NULL,
	"sucursal_id" uuid,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_actualizacion" timestamp with time zone,
	CONSTRAINT "articulos_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "articulos_stock_no_negativo" CHECK ("articulos"."stock_cache" >= 0)
);
--> statement-breakpoint
CREATE TABLE "movimientos_inventario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secuencia" bigserial NOT NULL,
	"articulo_id" uuid NOT NULL,
	"motivo" "motivo_inventario" NOT NULL,
	"cantidad" integer NOT NULL,
	"stock_posterior" integer NOT NULL,
	"canje_id" uuid,
	"vehiculo_id" uuid,
	"evento" text,
	"motivo_texto" text,
	"documento_referencia" text,
	"costo_unitario" numeric(10, 2),
	"creado_por_id" uuid,
	"creado_por_nombre" text,
	"creado_por_rol" text,
	"sucursal_id" uuid,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimientos_inventario_signo_segun_motivo" CHECK ((starts_with("movimientos_inventario"."motivo"::text, 'ingreso_') AND "movimientos_inventario"."cantidad" > 0)
       OR (starts_with("movimientos_inventario"."motivo"::text, 'salida_')  AND "movimientos_inventario"."cantidad" < 0)
       OR ("movimientos_inventario"."motivo" = 'ajuste_conteo' AND "movimientos_inventario"."cantidad" <> 0)),
	CONSTRAINT "movimientos_inventario_motivo_texto_obligatorio" CHECK ("movimientos_inventario"."motivo" NOT IN ('ajuste_conteo', 'salida_merma')
       OR ("movimientos_inventario"."motivo_texto" IS NOT NULL AND length(trim("movimientos_inventario"."motivo_texto")) >= 5))
);
--> statement-breakpoint
ALTER TABLE "premios" ADD COLUMN "articulo_id" uuid;--> statement-breakpoint
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_articulo_id_articulos_id_fk" FOREIGN KEY ("articulo_id") REFERENCES "public"."articulos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_canje_id_canjes_id_fk" FOREIGN KEY ("canje_id") REFERENCES "public"."canjes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_vehiculo_id_vehiculos_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_creado_por_id_users_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articulos_activo_nombre_idx" ON "articulos" USING btree ("activo","nombre");--> statement-breakpoint
CREATE INDEX "movimientos_inventario_articulo_fecha_idx" ON "movimientos_inventario" USING btree ("articulo_id","fecha_creacion" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "movimientos_inventario_evento_idx" ON "movimientos_inventario" USING btree ("evento") WHERE evento IS NOT NULL;--> statement-breakpoint
CREATE INDEX "movimientos_inventario_motivo_fecha_idx" ON "movimientos_inventario" USING btree ("motivo","fecha_creacion");--> statement-breakpoint
CREATE UNIQUE INDEX "movimientos_inventario_canje_uq" ON "movimientos_inventario" USING btree ("canje_id") WHERE canje_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "premios" ADD CONSTRAINT "premios_articulo_id_articulos_id_fk" FOREIGN KEY ("articulo_id") REFERENCES "public"."articulos"("id") ON DELETE no action ON UPDATE no action;