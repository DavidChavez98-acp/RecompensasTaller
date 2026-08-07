/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Las tres pantallas del mostrador: escanear → confirmar al cliente → acreditar.
 */

"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import {
  acreditarPuntos,
  verificarCodigoTecleado,
  verificarQr,
  type ClienteEscaneado,
  type ServicioOpcion,
} from "@/actions/puntos";
import { buscarClientes, type ClienteResumen } from "@/actions/clientes";
import { EscanerQr } from "@/components/EscanerQr";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearMonto, formatearPuntos } from "@/lib/utils";

type Paso =
  | { nombre: "escanear" }
  | { nombre: "confirmar"; cliente: ClienteEscaneado }
  | {
      nombre: "hecho";
      cliente: ClienteEscaneado;
      puntos: number;
      saldoNuevo: number;
      explicacion: string;
      topeAplicado: boolean;
    };

export function AcreditarFlujo({ servicios }: { servicios: ServicioOpcion[] }) {
  const [paso, setPaso] = useState<Paso>({ nombre: "escanear" });
  const [error, setError] = useState<string | null>(null);
  const [pista, setPista] = useState<string | null>(null);
  const [procesando, iniciarTransicion] = useTransition();

  function onDetectado(texto: string) {
    setError(null);
    setPista(null);
    iniciarTransicion(async () => {
      const resultado = await verificarQr(texto);
      if (!resultado.ok) {
        setError(resultado.error);
        setPista(resultado.pista ?? null);
        return;
      }
      setPaso({ nombre: "confirmar", cliente: resultado.cliente });
    });
  }

  function onAcreditar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (paso.nombre !== "confirmar") return;

    const datos = new FormData(evento.currentTarget);
    const monto = Number(String(datos.get("monto") ?? "").replace(",", "."));
    const servicioId = String(datos.get("servicio_tipo_id") ?? "");
    const documento = String(datos.get("documento_referencia") ?? "");
    const cliente = paso.cliente;

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await acreditarPuntos({
        ticket: cliente.ticket,
        monto,
        servicio_tipo_id: servicioId,
        documento_referencia: documento,
      });

      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }

      setPaso({
        nombre: "hecho",
        cliente,
        puntos: resultado.puntosAcreditados,
        saldoNuevo: resultado.saldoNuevo,
        explicacion: resultado.explicacion,
        topeAplicado: resultado.topeAplicado,
      });
    });
  }

  function reiniciar() {
    setError(null);
    setPista(null);
    setPaso({ nombre: "escanear" });
  }

  // ── Resultado ──────────────────────────────────────────────────────────────
  if (paso.nombre === "hecho") {
    return (
      <Card>
        <CardContent className="py-8 space-y-4 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto text-success" />
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              +{formatearPuntos(paso.puntos)}
            </p>
            <p className="text-sm text-muted-foreground">puntos para {paso.cliente.nombres}</p>
          </div>

          <p className="text-sm">
            Nuevo saldo: <span className="font-medium">{formatearPuntos(paso.saldoNuevo)}</span>
          </p>

          {paso.topeAplicado && (
            <p className="text-sm text-warning">
              {paso.explicacion} Si el monto estaba mal, avisa al Jefe de Taller para revertirlo.
            </p>
          )}

          <Button onClick={reiniciar} className="w-full">
            Atender al siguiente
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Confirmar cliente y acreditar ──────────────────────────────────────────
  if (paso.nombre === "confirmar") {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-4 space-y-1">
            <p className="text-xs text-muted-foreground">Cliente escaneado</p>
            <p className="text-lg font-semibold">{paso.cliente.nombres}</p>
            <p className="text-sm text-muted-foreground">
              Saldo actual: {formatearPuntos(paso.cliente.saldo)} puntos
            </p>

            {!paso.cliente.verificado && (
              <p className="flex items-start gap-2 text-sm text-warning pt-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                Cuenta sin verificar. Pide la cédula física antes de acreditar.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <form onSubmit={onAcreditar} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="monto">Monto del servicio</Label>
                <Input
                  id="monto"
                  name="monto"
                  inputMode="decimal"
                  placeholder="150.00"
                  required
                  autoFocus
                  disabled={procesando}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="servicio_tipo_id">Tipo de servicio</Label>
                {/*
                  <select> nativo a propósito: el asesor lo usa cien veces al día
                  desde una tableta, y el selector del sistema es más rápido y
                  más fiable con guantes que un desplegable personalizado.
                */}
                <select
                  id="servicio_tipo_id"
                  name="servicio_tipo_id"
                  required
                  disabled={procesando}
                  defaultValue={servicios[0]?.id ?? ""}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base md:text-sm"
                >
                  {servicios.map((servicio) => (
                    <option key={servicio.id} value={servicio.id}>
                      {servicio.nombre}
                      {Number(servicio.multiplicador) !== 1
                        ? ` (×${Number(servicio.multiplicador)})`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="documento_referencia">Nº de orden o factura (opcional)</Label>
                <Input
                  id="documento_referencia"
                  name="documento_referencia"
                  maxLength={60}
                  disabled={procesando}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={reiniciar} disabled={procesando}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1" disabled={procesando}>
                  {procesando ? "Acreditando…" : "Acreditar puntos"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Escanear ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <EscanerQr onDetectado={onDetectado} pausado={procesando} />
        </CardContent>
      </Card>

      {procesando && <p className="text-sm text-muted-foreground text-center">Leyendo código…</p>}

      {error && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            {pista && <p className="text-sm text-muted-foreground">{pista}</p>}
            <Button variant="outline" onClick={reiniciar} className="w-full">
              Intentar de nuevo
            </Button>
          </CardContent>
        </Card>
      )}

      <CodigoTecleado
        onCliente={(cliente) => setPaso({ nombre: "confirmar", cliente })}
        onError={(mensaje) => {
          setError(mensaje);
          setPista(null);
        }}
      />
    </div>
  );
}

/**
 * Camino alterno para cuando la cámara no sirve: pantalla rota, permiso
 * denegado en iOS, lente sucia, o un iPad viejo. El asesor busca al cliente y
 * teclea los 8 caracteres que este ve bajo su QR.
 *
 * Pasa por exactamente la misma verificación HMAC y quema el mismo nonce: no es
 * una puerta trasera, es el mismo código por otro teclado.
 */
function CodigoTecleado({
  onCliente,
  onError,
}: {
  onCliente: (cliente: ClienteEscaneado) => void;
  onError: (mensaje: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState<ClienteResumen[]>([]);
  const [elegido, setElegido] = useState<ClienteResumen | null>(null);
  const [buscando, iniciarBusqueda] = useTransition();
  const [validando, iniciarValidacion] = useTransition();

  function buscar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const consulta = String(new FormData(evento.currentTarget).get("consulta") ?? "");
    iniciarBusqueda(async () => {
      setResultados(await buscarClientes(consulta));
    });
  }

  function validar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!elegido) return;
    const codigo = String(new FormData(evento.currentTarget).get("codigo") ?? "");

    iniciarValidacion(async () => {
      const resultado = await verificarCodigoTecleado(elegido.id, codigo);
      if (!resultado.ok) {
        onError(resultado.error);
        return;
      }
      onCliente(resultado.cliente);
    });
  }

  if (!abierto) {
    return (
      <Button variant="ghost" className="w-full" onClick={() => setAbierto(true)}>
        La cámara no funciona
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div>
          <p className="text-sm font-medium">Código dictado por el cliente</p>
          <p className="text-xs text-muted-foreground">
            Busca al cliente y teclea los 8 caracteres que aparecen bajo su QR.
          </p>
        </div>

        {!elegido ? (
          <>
            <form onSubmit={buscar} className="flex gap-2">
              <Input
                name="consulta"
                placeholder="Nombre o cédula"
                autoFocus
                disabled={buscando}
              />
              <Button type="submit" variant="outline" disabled={buscando}>
                {buscando ? "…" : "Buscar"}
              </Button>
            </form>

            {resultados.length > 0 && (
              <div className="space-y-1">
                {resultados.map((cliente) => (
                  <button
                    key={cliente.id}
                    type="button"
                    onClick={() => setElegido(cliente)}
                    className="w-full text-left px-3 py-2 border border-border hover:border-primary text-sm"
                  >
                    <span className="font-medium">{cliente.nombres}</span>
                    <span className="text-muted-foreground"> · {cliente.identificacion}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <form onSubmit={validar} className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{elegido.nombres}</span>
              <span className="text-muted-foreground"> · {elegido.identificacion}</span>
            </p>

            <Input
              name="codigo"
              placeholder="A1B2C3D4"
              maxLength={12}
              autoFocus
              required
              disabled={validando}
              className="text-center text-lg tracking-[0.3em] font-mono uppercase"
            />

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setElegido(null)} disabled={validando}>
                Cambiar
              </Button>
              <Button type="submit" className="flex-1" disabled={validando}>
                {validando ? "Validando…" : "Continuar"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Formateo reutilizado por el resumen del día. */
export function ResumenLinea({ monto, puntos }: { monto: string | null; puntos: number }) {
  return (
    <span className="text-sm tabular-nums">
      {monto ? formatearMonto(monto) : "—"} · +{formatearPuntos(puntos)}
    </span>
  );
}
