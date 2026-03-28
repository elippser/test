import type { NextRequest } from "next/server";

/** Lectura cruda de un proveedor o del edge. */
export type GeoReading = {
  provider: string;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
};

export type GeoFromIp = {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Origen principal del resultado fusionado. */
  source: string;
  /** Todas las lecturas usadas (personal / depuración). */
  readings: GeoReading[];
  /** Zona horaria del navegador, si la envías en X-Client-Timezone. */
  clientTimezone: string | null;
};

const FETCH_MS = 6000;

function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("true-client-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    null
  );
}

function isPrivateOrLocalIp(ip: string): boolean {
  const v = ip.trim().replace(/^::ffff:/i, "");
  if (v === "127.0.0.1" || v === "::1" || v === "0.0.0.0") return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(v) || /^fd[0-9a-f]{2}:/i.test(v)) return true;
  if (/^fe80:/i.test(v)) return true;
  return false;
}

function modeString(values: (string | null | undefined)[]): string | null {
  const filtered = values.filter((v): v is string => Boolean(v));
  if (!filtered.length) return null;
  const counts = new Map<string, number>();
  for (const v of filtered) {
    const k = v.toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return best;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Peso para fusionar coordenadas: edge suele ser fiable en hosting gestionado. */
const PROVIDER_COORD_WEIGHT: Record<string, number> = {
  "vercel-edge": 2.5,
  cloudflare: 0,
  ipwho: 1.5,
  "ipapi.co": 1.2,
  geojs: 1,
};

function weightedLatLon(readings: GeoReading[], countryMode: string | null) {
  const withCoords = readings.filter(
    (r) =>
      r.lat != null &&
      r.lon != null &&
      Number.isFinite(r.lat) &&
      Number.isFinite(r.lon) &&
      (!countryMode ||
        !r.country ||
        r.country.toUpperCase() === countryMode),
  );
  if (!withCoords.length) return { latitude: null as number | null, longitude: null as number | null };

  let wSum = 0;
  let latSum = 0;
  let lonSum = 0;
  const lats: number[] = [];
  const lons: number[] = [];

  for (const r of withCoords) {
    const w = PROVIDER_COORD_WEIGHT[r.provider] ?? 1;
    wSum += w;
    latSum += r.lat! * w;
    lonSum += r.lon! * w;
    lats.push(r.lat!);
    lons.push(r.lon!);
  }

  const wLat = wSum > 0 ? latSum / wSum : null;
  const weightedLon = wSum > 0 ? lonSum / wSum : null;

  const medLat = median(lats);
  const medLon = median(lons);

  // Promedio entre mediana (robusto) y media ponderada (aprovecha edge).
  const latitude =
    wLat != null && medLat != null ? (wLat + medLat) / 2 : wLat ?? medLat;
  const longitude =
    weightedLon != null && medLon != null
      ? (weightedLon + medLon) / 2
      : weightedLon ?? medLon;

  return { latitude, longitude };
}

function mergeReadings(readings: GeoReading[]): Omit<GeoFromIp, "clientTimezone"> {
  const country = modeString(readings.map((r) => r.country));

  const { latitude, longitude } = weightedLatLon(readings, country);

  const priority = [
    "vercel-edge",
    "ipwho",
    "ipapi.co",
    "geojs",
    "cloudflare",
  ];
  let region: string | null = null;
  let city: string | null = null;
  for (const p of priority) {
    const r = readings.find((x) => x.provider === p);
    if (r?.region && !region) region = r.region;
  }
  for (const p of priority) {
    const r = readings.find((x) => x.provider === p);
    if (r?.city && !city) city = r.city;
  }
  if (!region) {
    region =
      readings.map((r) => r.region).find((x) => x && x.length > 0) ?? null;
  }
  if (!city) {
    const cities = readings.map((r) => r.city).filter(Boolean) as string[];
    city = cities.sort((a, b) => b.length - a.length)[0] ?? null;
  }

  const sources = [...new Set(readings.map((r) => r.provider))];
  const source =
    sources.length === 0
      ? "unknown"
      : sources.length === 1
        ? sources[0]!
        : `merged:${sources.join("+")}`;

  return {
    country,
    region,
    city,
    latitude,
    longitude,
    source,
    readings,
  };
}

async function fetchIpwho(ip: string): Promise<GeoReading | null> {
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      success?: boolean;
      country_code?: string;
      region?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
    };
    if (!j.success || !j.country_code) return null;
    return {
      provider: "ipwho",
      country: j.country_code,
      region: j.region ?? null,
      city: j.city ?? null,
      lat: typeof j.latitude === "number" ? j.latitude : null,
      lon: typeof j.longitude === "number" ? j.longitude : null,
    };
  } catch {
    return null;
  }
}

async function fetchIpapi(ip: string): Promise<GeoReading | null> {
  try {
    const res = await fetch(
      `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      {
        signal: AbortSignal.timeout(FETCH_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      error?: boolean;
      reason?: string;
      country_code?: string;
      region?: string;
      city?: string;
      latitude?: number | string;
      longitude?: number | string;
    };
    if (j.error) return null;
    const latN =
      j.latitude != null && j.latitude !== "" ? Number(j.latitude) : NaN;
    const lonN =
      j.longitude != null && j.longitude !== "" ? Number(j.longitude) : NaN;
    if (!j.country_code) return null;
    return {
      provider: "ipapi.co",
      country: j.country_code,
      region: j.region ?? null,
      city: j.city ?? null,
      lat: Number.isFinite(latN) ? latN : null,
      lon: Number.isFinite(lonN) ? lonN : null,
    };
  } catch {
    return null;
  }
}

async function fetchGeojs(ip: string): Promise<GeoReading | null> {
  try {
    const res = await fetch(
      `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`,
      { signal: AbortSignal.timeout(FETCH_MS), cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      country_code?: string;
      region?: string;
      city?: string;
      latitude?: string;
      longitude?: string;
    };
    const latN =
      j.latitude != null && j.latitude !== "" ? Number(j.latitude) : NaN;
    const lonN =
      j.longitude != null && j.longitude !== "" ? Number(j.longitude) : NaN;
    if (!j.country_code) return null;
    return {
      provider: "geojs",
      country: j.country_code,
      region: j.region ?? null,
      city: j.city ?? null,
      lat: Number.isFinite(latN) ? latN : null,
      lon: Number.isFinite(lonN) ? lonN : null,
    };
  } catch {
    return null;
  }
}

function readingFromVercel(headers: Headers): GeoReading | null {
  const country = headers.get("x-vercel-ip-country");
  if (!country) return null;
  const latH = headers.get("x-vercel-ip-latitude");
  const lonH = headers.get("x-vercel-ip-longitude");
  const latN = latH != null && latH !== "" ? Number(latH) : NaN;
  const lonN = lonH != null && lonH !== "" ? Number(lonH) : NaN;
  return {
    provider: "vercel-edge",
    country,
    region: headers.get("x-vercel-ip-region"),
    city: headers.get("x-vercel-ip-city"),
    lat: Number.isFinite(latN) ? latN : null,
    lon: Number.isFinite(lonN) ? lonN : null,
  };
}

function readingFromCloudflare(headers: Headers): GeoReading | null {
  const cf = headers.get("cf-ipcountry");
  if (!cf || cf === "XX" || cf === "T1") return null;
  return {
    provider: "cloudflare",
    country: cf,
    region: null,
    city: null,
    lat: null,
    lon: null,
  };
}

async function collectIpReadings(ip: string): Promise<GeoReading[]> {
  const results = await Promise.allSettled([
    fetchIpwho(ip),
    fetchIpapi(ip),
    fetchGeojs(ip),
  ]);
  const out: GeoReading[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}

/**
 * Ubicación aproximada sin permiso del navegador: edge (Vercel/Cloudflare) + varias GeoIP en paralelo,
 * fusionadas (mediana + media ponderada en coordenadas, país por consenso).
 */
export async function getGeoFromRequest(
  request: NextRequest | Request,
): Promise<GeoFromIp> {
  const headers = request.headers;
  const clientTimezone = headers.get("x-client-timezone");

  const readings: GeoReading[] = [];

  const v = readingFromVercel(headers);
  if (v) readings.push(v);

  const cf = readingFromCloudflare(headers);
  if (cf) readings.push(cf);

  const ip = getClientIp(headers);
  const canUseIp = ip && !isPrivateOrLocalIp(ip);

  if (canUseIp) {
    const ipReads = await collectIpReadings(ip);
    readings.push(...ipReads);
  }

  if (!readings.length) {
    return {
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      source: "unknown",
      readings: [],
      clientTimezone,
    };
  }

  const merged = mergeReadings(readings);
  return {
    ...merged,
    clientTimezone,
  };
}

export function isSafeHttpRedirectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
