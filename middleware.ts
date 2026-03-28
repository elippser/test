import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getGeoFromRequest,
  isSafeHttpRedirectUrl,
} from "./lib/geo-from-request";

/**
 * Redirección por país sin GPS ni diálogos del navegador.
 *
 * Define en .env.local (JSON en una línea):
 * GEO_REDIRECT_MAP={"ES":"https://tu-sitio.es","MX":"https://tu-sitio.mx","default":"https://global.example.com"}
 *
 * Claves: código ISO 3166-1 alpha-2 (mayúsculas en el mapa; se compara en mayúsculas).
 * Opcional: "default" o "*" para el resto de países detectados.
 * Si la variable no existe o el JSON es inválido, no se redirige.
 */
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const mapRaw = process.env.GEO_REDIRECT_MAP;
  if (!mapRaw?.trim()) {
    return NextResponse.next();
  }

  let redirectMap: Record<string, string>;
  try {
    redirectMap = JSON.parse(mapRaw) as Record<string, string>;
  } catch {
    return NextResponse.next();
  }

  const geo = await getGeoFromRequest(request);
  const code = (geo.country || "").toUpperCase();
  const target =
    (code && redirectMap[code]) ||
    redirectMap.default ||
    redirectMap["*"];

  if (!target || typeof target !== "string" || !isSafeHttpRedirectUrl(target)) {
    return NextResponse.next();
  }

  try {
    if (new URL(target).origin === request.nextUrl.origin) {
      return NextResponse.next();
    }
  } catch {
    return NextResponse.next();
  }

  return NextResponse.redirect(target, 307);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
