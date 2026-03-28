import { NextResponse } from "next/server";
import { getGeoFromRequest } from "@/lib/geo-from-request";

export const runtime = "edge";

/** Devuelve la geo inferida por IP / edge (sin permiso del navegador). */
export async function GET(request: Request) {
  const geo = await getGeoFromRequest(request);
  return NextResponse.json(geo);
}
