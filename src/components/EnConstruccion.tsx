/**
 * Developer: David Sebastian Chavez
 * LinkedIn: www.linkedin.com/in/dschavez0512
 * Application: Recompensas Taller
 *
 * Marcador honesto para las secciones que aún no existen.
 *
 * Regla heredada del proyecto hermano: la interfaz NO finge capacidades. Antes
 * que enseñar un catálogo vacío o un QR de mentira, se dice que la sección
 * todavía no está.
 */

import { Card, CardContent } from "@/components/ui/card";

export function EnConstruccion({
  titulo,
  descripcion,
}: {
  titulo: string;
  descripcion: string;
}) {
  return (
    <div className="space-y-5">
      <h1 className="t-titulo">{titulo}</h1>
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {descripcion}
        </CardContent>
      </Card>
    </div>
  );
}
