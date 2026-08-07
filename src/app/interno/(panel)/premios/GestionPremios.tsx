/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { actualizarPremio, ajustarStock, crearPremio, type PremioAdmin } from "@/actions/premios";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearPuntos } from "@/lib/utils";
import type { TipoPremio } from "@/db/schema";

export function GestionPremios({ premios }: { premios: PremioAdmin[] }) {
  const [creando, setCreando] = useState(false);

  return (
    <div className="space-y-4">
      {creando ? (
        <FormularioPremio onCerrar={() => setCreando(false)} />
      ) : (
        <Button onClick={() => setCreando(true)}>
          <Plus className="h-4 w-4" />
          Nuevo premio
        </Button>
      )}

      {premios.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            El catálogo está vacío. Crea el primer premio para que los clientes puedan canjear.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {premios.map((premio) => (
            <FilaPremio key={premio.id} premio={premio} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaPremio({ premio }: { premio: PremioAdmin }) {
  const [ajustando, setAjustando] = useState(false);
  const [editando, setEditando] = useState(false);

  const agotado = premio.stock !== null && premio.stock <= 0;
  const bajo =
    premio.stock !== null &&
    premio.stockMinimoAlerta !== null &&
    premio.stock > 0 &&
    premio.stock <= premio.stockMinimoAlerta;

  if (editando) {
    return <FormularioPremio premio={premio} onCerrar={() => setEditando(false)} />;
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">{premio.nombre}</p>
              <Badge variant="outline">{premio.tipo}</Badge>
              {!premio.activo && <Badge variant="secondary">Oculto</Badge>}
              {agotado && <Badge variant="destructive">Agotado</Badge>}
              {bajo && <Badge variant="secondary">Stock bajo</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {premio.codigo} · {formatearPuntos(premio.costoPuntos)} pts ·{" "}
              {premio.stock === null ? "sin límite" : `${premio.stock} en bodega`}
            </p>
          </div>
        </div>

        {ajustando ? (
          <FormularioStock premio={premio} onCerrar={() => setAjustando(false)} />
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
              Editar
            </Button>
            {premio.stock !== null && (
              <Button variant="outline" size="sm" onClick={() => setAjustando(true)}>
                Ajustar inventario
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * El stock NO se edita desde el formulario general: cada movimiento manual
 * exige motivo y queda en auditoría. Poder "corregir" el número sin explicar
 * por qué haría inútil el registro.
 */
function FormularioStock({ premio, onCerrar }: { premio: PremioAdmin; onCerrar: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const cantidad = Number(datos.get("cantidad"));
    const motivo = String(datos.get("motivo") ?? "");

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await ajustarStock({ premio_id: premio.id, cantidad, motivo });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo ajustar.");
        return;
      }
      onCerrar();
      router.refresh();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-3 border-t border-border pt-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`cantidad-${premio.id}`}>Cantidad (+ o −)</Label>
          <Input
            id={`cantidad-${premio.id}`}
            name="cantidad"
            type="number"
            placeholder="12"
            required
            disabled={pendiente}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`motivo-${premio.id}`}>Motivo</Label>
          <Input
            id={`motivo-${premio.id}`}
            name="motivo"
            placeholder="Recepción de mercadería"
            minLength={5}
            required
            disabled={pendiente}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Quedan {premio.stock} unidades. Usa negativo para descontar merma o corregir un conteo.
      </p>

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
          {pendiente ? "Guardando…" : "Ajustar"}
        </Button>
      </div>
    </form>
  );
}

function FormularioPremio({ premio, onCerrar }: { premio?: PremioAdmin; onCerrar: () => void }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoPremio>(premio?.tipo ?? "merchandising");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  const esMerchandising = tipo === "merchandising";

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);

    const entrada = {
      codigo: String(datos.get("codigo") ?? "").toUpperCase(),
      nombre: String(datos.get("nombre") ?? ""),
      descripcion: String(datos.get("descripcion") ?? ""),
      tipo,
      costo_puntos: Number(datos.get("costo_puntos")),
      // Un servicio NO lleva stock y un merchandising SÍ: el CHECK de Postgres
      // lo exige, y el esquema Zod lo repite para dar un mensaje entendible.
      stock: esMerchandising ? Number(datos.get("stock")) : null,
      stock_minimo_alerta: esMerchandising ? Number(datos.get("stock_minimo_alerta")) : null,
      activo: datos.get("activo") === "on",
    };

    setError(null);
    iniciarTransicion(async () => {
      const resultado = premio
        ? await actualizarPremio(premio.id, entrada)
        : await crearPremio(entrada);

      if (!resultado.ok) {
        setError(resultado.error ?? "No se pudo guardar.");
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
                defaultValue={premio?.codigo}
                placeholder="GORRA"
                required
                disabled={pendiente}
                className="uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="costo_puntos">Costo en puntos</Label>
              <Input
                id="costo_puntos"
                name="costo_puntos"
                type="number"
                min={1}
                defaultValue={premio?.costoPuntos}
                required
                disabled={pendiente}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              name="nombre"
              defaultValue={premio?.nombre}
              placeholder="Gorra institucional"
              required
              disabled={pendiente}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Input
              id="descripcion"
              name="descripcion"
              defaultValue={premio?.descripcion ?? ""}
              disabled={pendiente}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="tipo">Tipo</Label>
            <select
              id="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoPremio)}
              disabled={pendiente || !!premio}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
            >
              <option value="merchandising">Merchandising (unidades contadas)</option>
              <option value="servicio">Servicio del taller (sin límite)</option>
            </select>
            {premio && (
              <p className="text-xs text-muted-foreground">
                El tipo no se cambia después de crear el premio: cambiaría el significado del
                inventario ya registrado.
              </p>
            )}
          </div>

          {esMerchandising && !premio && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="stock">Unidades iniciales</Label>
                <Input
                  id="stock"
                  name="stock"
                  type="number"
                  min={0}
                  defaultValue={0}
                  required
                  disabled={pendiente}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="stock_minimo_alerta">Avisar cuando queden</Label>
                <Input
                  id="stock_minimo_alerta"
                  name="stock_minimo_alerta"
                  type="number"
                  min={0}
                  defaultValue={3}
                  disabled={pendiente}
                />
              </div>
            </div>
          )}

          {esMerchandising && premio && (
            <div className="space-y-1">
              <Label htmlFor="stock_minimo_alerta">Avisar cuando queden</Label>
              <Input
                id="stock_minimo_alerta"
                name="stock_minimo_alerta"
                type="number"
                min={0}
                defaultValue={premio.stockMinimoAlerta ?? 3}
                disabled={pendiente}
              />
              <p className="text-xs text-muted-foreground">
                El inventario se ajusta aparte, con motivo.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="activo"
              defaultChecked={premio?.activo ?? true}
              disabled={pendiente}
            />
            Visible en el catálogo del cliente
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCerrar} disabled={pendiente}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={pendiente}>
              {pendiente ? "Guardando…" : premio ? "Guardar cambios" : "Crear premio"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
