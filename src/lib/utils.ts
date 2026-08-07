/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ZONA_HORARIA } from "./constants"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * `x-forwarded-for` puede traer una cadena de proxies ("cliente, proxy1,
 * proxy2"); solo el primer valor es el cliente real. Sin esto, el rate limit
 * por IP se aplicaría sobre la cadena entera y sería trivial de eludir.
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  if (!ip || ip.trim() === "") return "unknown";
  const first = ip.split(",")[0]?.trim();
  return first || "unknown";
}

/** Formatea puntos con separador de miles, como los ve el cliente. */
export function formatearPuntos(puntos: number): string {
  return new Intl.NumberFormat("es-EC").format(puntos);
}

/** Formatea un monto en dólares (Ecuador usa USD). */
export function formatearMonto(monto: number | string): string {
  const valor = typeof monto === "string" ? Number(monto) : monto;
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(valor);
}

export function formatearFecha(fecha: Date | string): string {
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ZONA_HORARIA,
  }).format(new Date(fecha));
}

export function getEcuadorDate(dateInput: Date | string | number | null | undefined): Date {
  if (!dateInput) return new Date();
  const date = new Date(dateInput);
  const tzString = date.toLocaleString("en-US", { timeZone: "America/Guayaquil" });
  return new Date(tzString);
}

export function sanitizeString(val: string | null | undefined): string {
  if (!val) return "";
  let clean = val;
  let prev;
  do {
    prev = clean;
    clean = clean.replace(/<\/?[^>]+(>|$)/g, "");
  } while (clean !== prev);
  return clean.trim();
}

