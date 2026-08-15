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
  cambiarEstadoUsuario,
  cambiarRolUsuario,
  crearUsuario,
  reenviarInvitacion,
  type UsuarioListado,
} from "@/actions/usuarios";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearFecha } from "@/lib/utils";
import type { RolInterno } from "@/lib/authz";

const ROLES: RolInterno[] = [
  "Admin",
  "Jefe de Taller",
  "Asesor de Servicio",
  "Jefe de Marketing",
  "Asesor Comercial",
];

export function UsuariosClient({
  usuarios,
  sesionUserId,
}: {
  usuarios: UsuarioListado[];
  sesionUserId: string;
}) {
  const router = useRouter();
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function manejarCreado(avisoCorreo?: string) {
    setCreando(false);
    setAviso(avisoCorreo ?? null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {aviso && (
        <Card>
          <CardContent className="py-3 flex items-start justify-between gap-3">
            <p className="text-sm">{aviso}</p>
            <Button variant="ghost" size="sm" onClick={() => setAviso(null)}>
              Cerrar
            </Button>
          </CardContent>
        </Card>
      )}

      {creando ? (
        <FormularioUsuario onCerrar={() => setCreando(false)} onCreado={manejarCreado} />
      ) : (
        <Button onClick={() => setCreando(true)}>
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </Button>
      )}

      {usuarios.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Todavía no hay personal registrado.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {usuarios.map((usuario) => (
            <FilaUsuario key={usuario.id} usuario={usuario} esUno={usuario.id === sesionUserId} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioUsuario({
  onCerrar,
  onCreado,
}: {
  onCerrar: () => void;
  onCreado: (avisoCorreo?: string) => void;
}) {
  const [role, setRole] = useState<RolInterno>("Asesor de Servicio");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const nombre = String(datos.get("nombre") ?? "");
    const identificacion = String(datos.get("identificacion") ?? "").trim();

    setError(null);
    iniciarTransicion(async () => {
      const resultado = await crearUsuario({
        email: String(datos.get("email") ?? ""),
        nombre,
        role,
        identificacion: identificacion || undefined,
      });
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      onCreado(
        resultado.correoEnviado
          ? undefined
          : `Se creó la cuenta de ${nombre}, pero el correo de invitación no se pudo enviar${
              resultado.errorCorreo ? ` (${resultado.errorCorreo})` : ""
            }. Usa "Reenviar invitación" en su fila cuando quieras intentarlo de nuevo.`
      );
    });
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              name="nombre"
              placeholder="Nombre completo"
              required
              autoFocus
              disabled={pendiente}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="nombre@grupopalacios.com.ec"
              required
              disabled={pendiente}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="role">Rol</Label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as RolInterno)}
              disabled={pendiente}
              className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base md:text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="identificacion">Cédula (opcional)</Label>
            <Input
              id="identificacion"
              name="identificacion"
              placeholder="Solo si acredita puntos"
              disabled={pendiente}
            />
            <p className="t-micro text-muted-foreground">
              Necesaria para Asesor de Servicio y Jefe de Taller: es lo que bloquea que un asesor se
              acredite puntos a sí mismo.
            </p>
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
              {pendiente ? "Creando…" : "Crear usuario"}
            </Button>
          </div>

          <p className="t-micro text-muted-foreground">
            Se le enviará un correo con un enlace para definir su contraseña, vigente 48 horas.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function FilaUsuario({ usuario, esUno }: { usuario: UsuarioListado; esUno: boolean }) {
  const router = useRouter();

  const [role, setRole] = useState<RolInterno>(usuario.role);
  const [errorRol, setErrorRol] = useState<string | null>(null);
  const [guardandoRol, iniciarGuardadoRol] = useTransition();

  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [cambiandoEstado, iniciarCambioEstado] = useTransition();

  const [errorReenvio, setErrorReenvio] = useState<string | null>(null);
  const [reenviado, setReenviado] = useState(false);
  const [reenviando, iniciarReenvio] = useTransition();

  const rolCambiado = role !== usuario.role;

  function guardarRol() {
    setErrorRol(null);
    iniciarGuardadoRol(async () => {
      const resultado = await cambiarRolUsuario({ userId: usuario.id, role });
      if (!resultado.ok) {
        setErrorRol(resultado.error ?? "No se pudo cambiar el rol.");
        setRole(usuario.role);
        return;
      }
      router.refresh();
    });
  }

  function cambiarEstado(activo: boolean) {
    setErrorEstado(null);
    iniciarCambioEstado(async () => {
      const resultado = await cambiarEstadoUsuario({ userId: usuario.id, activo });
      if (!resultado.ok) {
        setErrorEstado(resultado.error ?? "No se pudo actualizar el estado.");
        setConfirmandoBaja(false);
        return;
      }
      setConfirmandoBaja(false);
      router.refresh();
    });
  }

  function reenviar() {
    setErrorReenvio(null);
    iniciarReenvio(async () => {
      const resultado = await reenviarInvitacion(usuario.id);
      if (!resultado.ok) {
        setErrorReenvio(resultado.error ?? "No se pudo reenviar la invitación.");
        return;
      }
      setReenviado(true);
    });
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{usuario.nombre}</p>
            {esUno && <Badge variant="outline">Tú</Badge>}
            {!usuario.activo && <Badge variant="destructive">Desactivado</Badge>}
            {!usuario.tieneAcceso && <Badge variant="secondary">Invitación pendiente</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{usuario.email ?? "sin correo"}</p>
          <p className="t-micro text-muted-foreground">
            {usuario.ultimoAcceso
              ? `Último acceso ${formatearFecha(usuario.ultimoAcceso)}`
              : "Nunca inició sesión"}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`rol-${usuario.id}`} className="t-etiqueta text-muted-foreground">
              Rol
            </Label>
            <select
              id={`rol-${usuario.id}`}
              value={role}
              onChange={(e) => setRole(e.target.value as RolInterno)}
              disabled={guardandoRol}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {rolCambiado && (
            <Button size="sm" onClick={guardarRol} disabled={guardandoRol}>
              {guardandoRol ? "Guardando…" : "Guardar rol"}
            </Button>
          )}

          {!usuario.tieneAcceso && usuario.activo && (
            <Button
              variant="outline"
              size="sm"
              onClick={reenviar}
              disabled={reenviando || reenviado}
            >
              {reenviando ? "Enviando…" : reenviado ? "Invitación reenviada" : "Reenviar invitación"}
            </Button>
          )}

          {usuario.activo ? (
            confirmandoBaja ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">¿Desactivar a {usuario.nombre}?</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmandoBaja(false)}
                  disabled={cambiandoEstado}
                >
                  No
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => cambiarEstado(false)}
                  disabled={cambiandoEstado}
                >
                  {cambiandoEstado ? "Desactivando…" : "Sí, desactivar"}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmandoBaja(true)}
                disabled={esUno}
                title={esUno ? "No puedes desactivar tu propia cuenta" : undefined}
              >
                Desactivar
              </Button>
            )
          ) : (
            <Button variant="outline" size="sm" onClick={() => cambiarEstado(true)} disabled={cambiandoEstado}>
              {cambiandoEstado ? "Activando…" : "Activar"}
            </Button>
          )}
        </div>

        {esUno && (
          <p className="t-micro text-muted-foreground">
            No puedes quitarte tu propio rol de Admin ni desactivar tu propia cuenta — pide a otro
            Admin que lo haga.
          </p>
        )}

        {errorRol && (
          <p role="alert" className="text-sm text-destructive">
            {errorRol}
          </p>
        )}
        {errorEstado && (
          <p role="alert" className="text-sm text-destructive">
            {errorEstado}
          </p>
        )}
        {errorReenvio && (
          <p role="alert" className="text-sm text-destructive">
            {errorReenvio}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
