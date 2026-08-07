CREATE TYPE "public"."estado_canje" AS ENUM('solicitado', 'aprobado', 'entregado', 'rechazado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."tipo_premio" AS ENUM('merchandising', 'servicio', 'descuento');--> statement-breakpoint
CREATE TYPE "public"."tipo_transaccion" AS ENUM('acreditacion', 'canje', 'reverso', 'ajuste', 'expiracion');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('Admin', 'Jefe de Taller', 'Asesor', 'Marketing');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"actor_nombre" text NOT NULL,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"detalle" jsonb,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canje_historial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canje_id" uuid NOT NULL,
	"estado_anterior" "estado_canje",
	"estado_nuevo" "estado_canje" NOT NULL,
	"comentario" text,
	"actor_tipo" text NOT NULL,
	"actor_id" uuid,
	"actor_nombre" text NOT NULL,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canjes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"premio_id" uuid NOT NULL,
	"premio_nombre" text NOT NULL,
	"costo_puntos" integer NOT NULL,
	"estado" "estado_canje" DEFAULT 'solicitado' NOT NULL,
	"codigo_entrega" text,
	"idempotency_key" uuid,
	"solicitado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"aprobado_en" timestamp with time zone,
	"aprobado_por_id" uuid,
	"entregado_en" timestamp with time zone,
	"entregado_por_id" uuid,
	"cerrado_en" timestamp with time zone,
	"cerrado_por_id" uuid,
	"motivo_cierre" text,
	"sucursal_id" uuid,
	"fecha_actualizacion" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cliente_dispositivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"secreto" text NOT NULL,
	"algoritmo" text DEFAULT 'hmac-sha256' NOT NULL,
	"etiqueta" text,
	"ultima_actividad" timestamp with time zone,
	"revocado_en" timestamp with time zone,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identificacion" text NOT NULL,
	"identificacion_idx" text NOT NULL,
	"nombres" text NOT NULL,
	"email" text,
	"email_idx" text,
	"telefono" text,
	"saldo_cache" integer DEFAULT 0 NOT NULL,
	"saldo_cache_actualizado" timestamp with time zone,
	"verificado" boolean DEFAULT false NOT NULL,
	"verificado_por_id" uuid,
	"verificado_en" timestamp with time zone,
	"consentimiento_aceptado" boolean DEFAULT false NOT NULL,
	"politica_version" text,
	"consentimiento_ip" text,
	"consentimiento_user_agent" text,
	"consentimiento_en" timestamp with time zone,
	"origen" text DEFAULT 'auto-registro' NOT NULL,
	"sucursal_id" uuid,
	"nivel_id" uuid,
	"activo" boolean DEFAULT true NOT NULL,
	"anonimizado_en" timestamp with time zone,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_actualizacion" timestamp with time zone,
	CONSTRAINT "clientes_saldo_no_negativo" CHECK ("clientes"."saldo_cache" >= 0)
);
--> statement-breakpoint
CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contexto" text NOT NULL,
	"mensaje" text NOT NULL,
	"detalle" jsonb,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niveles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"puntos_minimos" integer NOT NULL,
	"multiplicador" numeric(6, 3) DEFAULT '1.000' NOT NULL,
	"beneficios" jsonb,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "niveles_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "otp_codigos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identificacion_idx" text NOT NULL,
	"cliente_id" uuid,
	"codigo_hash" text NOT NULL,
	"canal" text DEFAULT 'email' NOT NULL,
	"destino_masked" text,
	"intentos" integer DEFAULT 0 NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"consumido_en" timestamp with time zone,
	"motivo_cierre" text,
	"ip_solicitante" text,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"tipo" "tipo_premio" DEFAULT 'merchandising' NOT NULL,
	"costo_puntos" integer NOT NULL,
	"imagen_url" text,
	"stock" integer,
	"stock_minimo_alerta" integer,
	"activo" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"visible_desde" timestamp with time zone,
	"visible_hasta" timestamp with time zone,
	"sucursal_id" uuid,
	"nivel_minimo_id" uuid,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	"fecha_actualizacion" timestamp with time zone,
	CONSTRAINT "premios_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "premios_costo_positivo" CHECK ("premios"."costo_puntos" > 0),
	CONSTRAINT "premios_stock_no_negativo" CHECK ("premios"."stock" IS NULL OR "premios"."stock" >= 0),
	CONSTRAINT "premios_stock_segun_tipo" CHECK (("premios"."tipo" = 'merchandising' AND "premios"."stock" IS NOT NULL) OR ("premios"."tipo" <> 'merchandising' AND "premios"."stock" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "puntos_transacciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secuencia" bigserial NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" "tipo_transaccion" NOT NULL,
	"puntos" integer NOT NULL,
	"saldo_posterior" integer NOT NULL,
	"monto_gastado" numeric(10, 2),
	"servicio_tipo_id" uuid,
	"multiplicador_aplicado" numeric(6, 3),
	"regla_id" uuid,
	"escaneo_id" uuid,
	"canje_id" uuid,
	"reversa_de_id" uuid,
	"motivo" text,
	"documento_referencia" text,
	"fuente" text DEFAULT 'manual' NOT NULL,
	"orden_externa_id" text,
	"payload_externo" jsonb,
	"creado_por_id" uuid,
	"creado_por_nombre" text,
	"creado_por_rol" text,
	"sucursal_id" uuid,
	"ip" text,
	"user_agent" text,
	"expira_en" timestamp with time zone,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_escaneos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispositivo_id" uuid NOT NULL,
	"paso" integer NOT NULL,
	"usuario_id" uuid NOT NULL,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reglas_puntos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"monto_base" numeric(10, 2) NOT NULL,
	"puntos_por_base" integer NOT NULL,
	"redondeo" text DEFAULT 'abajo' NOT NULL,
	"monto_minimo" numeric(10, 2) DEFAULT '0' NOT NULL,
	"puntos_maximos_transaccion" integer,
	"vigente_desde" timestamp with time zone DEFAULT now() NOT NULL,
	"vigente_hasta" timestamp with time zone,
	"sucursal_id" uuid,
	"creado_por_id" uuid,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servicios_tipo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"multiplicador" numeric(6, 3) DEFAULT '1.000' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"codigo_externo" text,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servicios_tipo_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "sesiones_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"user_agent" text,
	"ip" text,
	"ultima_actividad" timestamp with time zone DEFAULT now() NOT NULL,
	"revocada_en" timestamp with time zone,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"fecha_actualizacion" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sucursales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"direccion" text,
	"activo" boolean DEFAULT true NOT NULL,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sucursales_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"nombre" text NOT NULL,
	"role" "user_role" DEFAULT 'Asesor' NOT NULL,
	"sucursal_id" uuid,
	"identificacion_idx" text,
	"password_hash" text,
	"activo" boolean DEFAULT true NOT NULL,
	"notif_canje_solicitado" boolean DEFAULT true NOT NULL,
	"notif_stock_bajo" boolean DEFAULT true NOT NULL,
	"notif_resumen_diario" boolean DEFAULT false NOT NULL,
	"ultimo_acceso" timestamp with time zone,
	"fecha_creacion" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "canje_historial" ADD CONSTRAINT "canje_historial_canje_id_canjes_id_fk" FOREIGN KEY ("canje_id") REFERENCES "public"."canjes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canjes" ADD CONSTRAINT "canjes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canjes" ADD CONSTRAINT "canjes_premio_id_premios_id_fk" FOREIGN KEY ("premio_id") REFERENCES "public"."premios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canjes" ADD CONSTRAINT "canjes_aprobado_por_id_users_id_fk" FOREIGN KEY ("aprobado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canjes" ADD CONSTRAINT "canjes_entregado_por_id_users_id_fk" FOREIGN KEY ("entregado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canjes" ADD CONSTRAINT "canjes_cerrado_por_id_users_id_fk" FOREIGN KEY ("cerrado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canjes" ADD CONSTRAINT "canjes_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_dispositivos" ADD CONSTRAINT "cliente_dispositivos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_verificado_por_id_users_id_fk" FOREIGN KEY ("verificado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_nivel_id_niveles_id_fk" FOREIGN KEY ("nivel_id") REFERENCES "public"."niveles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codigos" ADD CONSTRAINT "otp_codigos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premios" ADD CONSTRAINT "premios_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "premios" ADD CONSTRAINT "premios_nivel_minimo_id_niveles_id_fk" FOREIGN KEY ("nivel_minimo_id") REFERENCES "public"."niveles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_servicio_tipo_id_servicios_tipo_id_fk" FOREIGN KEY ("servicio_tipo_id") REFERENCES "public"."servicios_tipo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_regla_id_reglas_puntos_id_fk" FOREIGN KEY ("regla_id") REFERENCES "public"."reglas_puntos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_escaneo_id_qr_escaneos_id_fk" FOREIGN KEY ("escaneo_id") REFERENCES "public"."qr_escaneos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_canje_id_canjes_id_fk" FOREIGN KEY ("canje_id") REFERENCES "public"."canjes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_creado_por_id_users_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puntos_transacciones" ADD CONSTRAINT "puntos_transacciones_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_escaneos" ADD CONSTRAINT "qr_escaneos_dispositivo_id_cliente_dispositivos_id_fk" FOREIGN KEY ("dispositivo_id") REFERENCES "public"."cliente_dispositivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_escaneos" ADD CONSTRAINT "qr_escaneos_usuario_id_users_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglas_puntos" ADD CONSTRAINT "reglas_puntos_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglas_puntos" ADD CONSTRAINT "reglas_puntos_creado_por_id_users_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones_cliente" ADD CONSTRAINT "sesiones_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sucursal_id_sucursales_id_fk" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_fecha_idx" ON "admin_audit_log" USING btree ("fecha_creacion");--> statement-breakpoint
CREATE INDEX "admin_audit_log_entidad_idx" ON "admin_audit_log" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "canje_historial_canje_id_idx" ON "canje_historial" USING btree ("canje_id");--> statement-breakpoint
CREATE INDEX "canjes_estado_solicitado_idx" ON "canjes" USING btree ("estado","solicitado_en");--> statement-breakpoint
CREATE INDEX "canjes_cliente_fecha_idx" ON "canjes" USING btree ("cliente_id","solicitado_en" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "canjes_idempotency_uq" ON "canjes" USING btree ("cliente_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cliente_dispositivos_cliente_id_idx" ON "cliente_dispositivos" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clientes_identificacion_idx_uq" ON "clientes" USING btree ("identificacion_idx");--> statement-breakpoint
CREATE INDEX "clientes_email_idx_idx" ON "clientes" USING btree ("email_idx");--> statement-breakpoint
CREATE INDEX "clientes_nombres_idx" ON "clientes" USING btree ("nombres");--> statement-breakpoint
CREATE INDEX "error_log_fecha_idx" ON "error_log" USING btree ("fecha_creacion");--> statement-breakpoint
CREATE INDEX "otp_codigos_identificacion_fecha_idx" ON "otp_codigos" USING btree ("identificacion_idx","fecha_creacion");--> statement-breakpoint
CREATE INDEX "premios_activo_orden_idx" ON "premios" USING btree ("activo","orden");--> statement-breakpoint
CREATE INDEX "puntos_transacciones_cliente_fecha_idx" ON "puntos_transacciones" USING btree ("cliente_id","fecha_creacion" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "puntos_transacciones_escaneo_uq" ON "puntos_transacciones" USING btree ("escaneo_id") WHERE escaneo_id IS NOT NULL AND tipo = 'acreditacion';--> statement-breakpoint
CREATE UNIQUE INDEX "puntos_transacciones_canje_debito_uq" ON "puntos_transacciones" USING btree ("canje_id") WHERE canje_id IS NOT NULL AND tipo = 'canje';--> statement-breakpoint
CREATE UNIQUE INDEX "puntos_transacciones_canje_reverso_uq" ON "puntos_transacciones" USING btree ("canje_id") WHERE canje_id IS NOT NULL AND tipo = 'reverso';--> statement-breakpoint
CREATE UNIQUE INDEX "puntos_transacciones_reversa_uq" ON "puntos_transacciones" USING btree ("reversa_de_id") WHERE reversa_de_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "puntos_transacciones_orden_externa_uq" ON "puntos_transacciones" USING btree ("fuente","orden_externa_id") WHERE orden_externa_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "puntos_transacciones_creado_por_fecha_idx" ON "puntos_transacciones" USING btree ("creado_por_id","fecha_creacion");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_escaneos_dispositivo_paso_uq" ON "qr_escaneos" USING btree ("dispositivo_id","paso");--> statement-breakpoint
CREATE INDEX "qr_escaneos_fecha_idx" ON "qr_escaneos" USING btree ("fecha_creacion");--> statement-breakpoint
CREATE INDEX "reglas_puntos_vigencia_idx" ON "reglas_puntos" USING btree ("vigente_desde","vigente_hasta");--> statement-breakpoint
CREATE INDEX "sesiones_cliente_cliente_id_idx" ON "sesiones_cliente" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "users_identificacion_idx_idx" ON "users" USING btree ("identificacion_idx");--> statement-breakpoint
CREATE INDEX "users_sucursal_idx" ON "users" USING btree ("sucursal_id");