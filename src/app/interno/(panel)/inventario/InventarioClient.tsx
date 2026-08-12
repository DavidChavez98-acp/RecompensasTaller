/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  crearArticulo,
  listarMovimientosArticulo,
  registrarIngreso,
  registrarSalida,
  type ArticuloResumen,
  type MovimientoArticulo,
} from "@/actions/inventario";
import { buscarVehiculoPorChasis, type VehiculoConCliente } from "@/actions/vehiculos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearFecha } from "@/lib/utils";

const ETIQUETA_MOTIVO: Record<string, string> = {
  ingreso_compra: "Ingreso",
  ingreso_devolucion: "Devolución",
  ajuste_conteo: "Ajuste de conteo",
  salida_canje: "Canje",
  salida_entrega_vehiculo: "Entrega de vehículo",
  salida_evento: "Feria / evento",
  salida_merma: "Merma",
  salida_interna: "Uso interno",
};

export function InventarioClient({
  articulos,
  puedeGestionar,
  puedeSalida,
}: {
  articulos: ArticuloResumen[];
  puedeGestionar: boolean;
  puedeSalida: boolean;
}) {
  const [creando, setCreando] = useState(false);

  return (
    <div className="space-y-4">
      {puedeGestionar &&
        (creando ? (
          <FormularioArticulo onCerrar={() => setCreando(false)} />
        ) : (
          <Button variant="outline" onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" />
            Nuevo artículo
          </Button>
        ))}

      {articulos.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            El inventario está vacío.{" "}
            {puedeGestionar ? "Da de alta el primer artículo." : "Todavía no hay nada que sacar."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {articulos.map((articulo) => (
            <ArticuloFila
              key={articulo.id}
              articulo={articulo}
              puedeGestionar={puedeGestionar}
              puedeSalida={puedeSalida}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioArticulo({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const stockMinimoAlerta = String(datos.get("stock_minimo_alerta") ?? "").trim();

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await crearArticulo({
        codigo: String(datos.get("codigo") ?? "").toUpperCase(),
        nombre: String(datos.get("nombre") ?? ""),
        descripcion: String(datos.get("descripcion") ?? ""),
        unidad: String(datos.get("unidad") ?? ""),
        stock_minimo_alerta: stockMinimoAlerta === "" ? null : Number(stockMinimoAlerta),
      });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo crear el artículo.");
        return;
      }
      onCerrar();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={enviar} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo"
                name="codigo"
                placeholder="BANNER"
                required
                autoFocus
                disabled={pendiente}
                className="uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="unidad">Unidad</Label>
              <Input id="unidad" name="unidad" placeholder="unidad" disabled={pendiente} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              name="nombre"
              placeholder="Roll-up institucional"
              required
              disabled={pendiente}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Input id="descripcion" name="descripcion" disabled={pendiente} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="stock_minimo_alerta">Avisar cuando queden (opcional)</Label>
            <Input
              id="stock_minimo_alerta"
              name="stock_minimo_alerta"
              type="number"
              min={0}
              disabled={pendiente}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCerrar} disabled={pendiente}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Crear artículo"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ArticuloFila({
  articulo,
  puedeGestionar,
  puedeSalida,
}: {
  articulo: ArticuloResumen;
  puedeGestionar: boolean;
  puedeSalida: boolean;
}) {
  const [accion, setAccion] = useState<"ninguna" | "ingreso" | "salida" | "historial">("ninguna");
  const [historial, setHistorial] = useState<MovimientoArticulo[] | null>(null);
  const [cargandoHistorial, iniciarCargaHistorial] = useTransition();

  const agotado = articulo.stock <= 0;
  const bajo =
    !agotado && articulo.stockMinimoAlerta !== null && articulo.stock <= articulo.stockMinimoAlerta;

  function alternarHistorial() {
    if (accion === "historial") {
      setAccion("ninguna");
      return;
    }
    setAccion("historial");
    if (historial === null) {
      iniciarCargaHistorial(async () => {
        setHistorial(await listarMovimientosArticulo(articulo.id));
      });
    }
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">{articulo.nombre}</p>
              {agotado && <Badge variant="destructive">Agotado</Badge>}
              {bajo && <Badge variant="secondary">Stock bajo</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {articulo.codigo} · {articulo.stock} en bodega ({articulo.unidad})
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={alternarHistorial}>
            {accion === "historial" ? "Ocultar historial" : "Ver historial"}
          </Button>
          {puedeGestionar && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAccion(accion === "ingreso" ? "ninguna" : "ingreso")}
            >
              Ingreso
            </Button>
          )}
          {puedeSalida && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAccion(accion === "salida" ? "ninguna" : "salida")}
            >
              Salida
            </Button>
          )}
        </div>

        {accion === "historial" && (
          <div className="border-t border-border pt-3 space-y-1">
            {cargandoHistorial && <p className="text-xs text-muted-foreground">Cargando…</p>}
            {!cargandoHistorial && historial?.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin movimientos todavía.</p>
            )}
            {historial?.map((mov) => (
              <div key={mov.id} className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p>
                    {ETIQUETA_MOTIVO[mov.motivo] ?? mov.motivo}
                    {mov.evento ? ` · ${mov.evento}` : ""}
                  </p>
                  <p className="t-micro text-muted-foreground">
                    {formatearFecha(mov.fecha)}
                    {mov.actor ? ` · ${mov.actor}` : ""}
                    {mov.motivoTexto ? ` · ${mov.motivoTexto}` : ""}
                  </p>
                </div>
                <p className="text-sm font-medium tabular-nums shrink-0">
                  {mov.cantidad >= 0 ? "+" : "−"}
                  {Math.abs(mov.cantidad)}
                </p>
              </div>
            ))}
          </div>
        )}

        {accion === "ingreso" && (
          <FormularioIngreso articulo={articulo} onCerrar={() => setAccion("ninguna")} />
        )}
        {accion === "salida" && (
          <FormularioSalida articulo={articulo} onCerrar={() => setAccion("ninguna")} />
        )}
      </CardContent>
    </Card>
  );
}

function FormularioIngreso({
  articulo,
  onCerrar,
}: {
  articulo: ArticuloResumen;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState<"ingreso_compra" | "ingreso_devolucion">("ingreso_compra");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const costo = String(datos.get("costo_unitario") ?? "").trim();

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await registrarIngreso({
        articulo_id: articulo.id,
        motivo,
        cantidad: Number(datos.get("cantidad")),
        costo_unitario: costo === "" ? undefined : Number(costo),
        documento_referencia: String(datos.get("documento_referencia") ?? ""),
        evento: motivo === "ingreso_devolucion" ? String(datos.get("evento") ?? "") : undefined,
      });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo registrar el ingreso.");
        return;
      }
      onCerrar();
      router.refresh();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1">
        <Label htmlFor={`motivo-ingreso-${articulo.id}`}>Motivo</Label>
        <select
          id={`motivo-ingreso-${articulo.id}`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value as typeof motivo)}
          disabled={pendiente}
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base md:text-sm"
        >
          <option value="ingreso_compra">Recepción de mercadería</option>
          <option value="ingreso_devolucion">Devolución de feria o evento</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`cantidad-ingreso-${articulo.id}`}>Cantidad</Label>
          <Input
            id={`cantidad-ingreso-${articulo.id}`}
            name="cantidad"
            type="number"
            min={1}
            required
            autoFocus
            disabled={pendiente}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`costo-${articulo.id}`}>Costo unitario (opcional)</Label>
          <Input
            id={`costo-${articulo.id}`}
            name="costo_unitario"
            inputMode="decimal"
            disabled={pendiente}
          />
        </div>
      </div>

      {motivo === "ingreso_compra" ? (
        <div className="space-y-1">
          <Label htmlFor={`documento-${articulo.id}`}>Nº de factura (opcional)</Label>
          <Input id={`documento-${articulo.id}`} name="documento_referencia" disabled={pendiente} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`evento-ingreso-${articulo.id}`}>Feria o evento</Label>
          <Input
            id={`evento-ingreso-${articulo.id}`}
            name="evento"
            placeholder="Igual al nombre que usaste al sacarlo"
            required
            disabled={pendiente}
          />
          <p className="t-micro text-muted-foreground">
            Usa el MISMO nombre con el que registraste la salida — es lo que enlaza las dos filas
            y cierra la feria en el reporte.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCerrar} disabled={pendiente}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Registrar ingreso"}
        </Button>
      </div>
    </form>
  );
}

const MOTIVOS_SALIDA = [
  { value: "salida_entrega_vehiculo", label: "Entrega de vehículo" },
  { value: "salida_evento", label: "Feria o evento" },
  { value: "salida_merma", label: "Merma" },
  { value: "salida_interna", label: "Uso interno" },
] as const;

type MotivoSalida = (typeof MOTIVOS_SALIDA)[number]["value"];

function FormularioSalida({
  articulo,
  onCerrar,
}: {
  articulo: ArticuloResumen;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState<MotivoSalida>("salida_entrega_vehiculo");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  // ── Búsqueda de vehículo por chasis (solo para "Entrega de vehículo") ──
  const [chasis, setChasis] = useState("");
  const [vehiculo, setVehiculo] = useState<VehiculoConCliente | null>(null);
  const [buscandoVehiculo, iniciarBusquedaVehiculo] = useTransition();
  const [errorVehiculo, setErrorVehiculo] = useState<string | null>(null);

  function buscarVehiculo() {
    setErrorVehiculo(null);
    iniciarBusquedaVehiculo(async () => {
      const encontrado = await buscarVehiculoPorChasis(chasis);
      if (!encontrado) {
        setVehiculo(null);
        setErrorVehiculo("No se encontró ningún vehículo con ese chasis.");
        return;
      }
      setVehiculo(encontrado);
    });
  }

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await registrarSalida({
        articulo_id: articulo.id,
        motivo,
        cantidad: Number(datos.get("cantidad")),
        evento: motivo === "salida_evento" ? String(datos.get("evento") ?? "") : undefined,
        vehiculo_id: motivo === "salida_entrega_vehiculo" ? (vehiculo?.id ?? "") : undefined,
        motivo_texto:
          motivo === "salida_merma" || motivo === "salida_interna"
            ? String(datos.get("motivo_texto") ?? "")
            : undefined,
      });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo registrar la salida.");
        return;
      }
      onCerrar();
      router.refresh();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1">
        <Label htmlFor={`motivo-${articulo.id}`}>Motivo</Label>
        <select
          id={`motivo-${articulo.id}`}
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value as MotivoSalida);
            setVehiculo(null);
            setErrorVehiculo(null);
          }}
          disabled={pendiente}
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base md:text-sm"
        >
          {MOTIVOS_SALIDA.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`cantidad-salida-${articulo.id}`}>Cantidad</Label>
        <Input
          id={`cantidad-salida-${articulo.id}`}
          name="cantidad"
          type="number"
          min={1}
          max={articulo.stock}
          required
          disabled={pendiente}
        />
        <p className="t-micro text-muted-foreground">Quedan {articulo.stock} en bodega.</p>
      </div>

      {motivo === "salida_evento" && (
        <div className="space-y-1">
          <Label htmlFor={`evento-${articulo.id}`}>Feria o evento</Label>
          <Input
            id={`evento-${articulo.id}`}
            name="evento"
            placeholder="Feria Automotriz Quito 2026"
            required
            disabled={pendiente}
          />
        </div>
      )}

      {motivo === "salida_entrega_vehiculo" && (
        <div className="space-y-2">
          <Label htmlFor={`chasis-${articulo.id}`}>Chasis del vehículo</Label>
          {vehiculo ? (
            <div className="flex items-center justify-between gap-2 border border-border px-3 py-2">
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {[vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ") || vehiculo.chasis}
                </p>
                <p className="text-muted-foreground">de {vehiculo.clienteNombres}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setVehiculo(null);
                  setChasis("");
                }}
                disabled={pendiente}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id={`chasis-${articulo.id}`}
                value={chasis}
                onChange={(e) => setChasis(e.target.value)}
                placeholder="Número de chasis"
                disabled={buscandoVehiculo || pendiente}
                className="font-mono uppercase"
              />
              <Button
                type="button"
                variant="outline"
                disabled={buscandoVehiculo || pendiente || chasis.trim().length < 5}
                onClick={buscarVehiculo}
              >
                {buscandoVehiculo ? "…" : "Buscar"}
              </Button>
            </div>
          )}
          {errorVehiculo && (
            <p role="alert" className="text-sm text-destructive">
              {errorVehiculo}
            </p>
          )}
        </div>
      )}

      {(motivo === "salida_merma" || motivo === "salida_interna") && (
        <div className="space-y-1">
          <Label htmlFor={`motivo-texto-${articulo.id}`}>
            {motivo === "salida_merma" ? "Qué pasó" : "Motivo (opcional)"}
          </Label>
          <Input
            id={`motivo-texto-${articulo.id}`}
            name="motivo_texto"
            placeholder={motivo === "salida_merma" ? "Se dañó en bodega" : "Uso interno del taller"}
            required={motivo === "salida_merma"}
            disabled={pendiente}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCerrar} disabled={pendiente}>
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pendiente || (motivo === "salida_entrega_vehiculo" && !vehiculo)}
        >
          {pendiente ? "Guardando…" : "Registrar salida"}
        </Button>
      </div>
    </form>
  );
}
