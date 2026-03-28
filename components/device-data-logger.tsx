"use client";

import { useEffect } from "react";

type HighEntropyHint =
  | "architecture"
  | "bitness"
  | "brands"
  | "fullVersionList"
  | "mobile"
  | "model"
  | "platform"
  | "platformVersion"
  | "uaFullVersion"
  | "wow64";

/** Subset of Client Hints API used for high-entropy collection. */
type UserAgentDataBrands = { brand: string; version: string };
interface NavigatorUserAgentData {
  brands: UserAgentDataBrands[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues: (
    hints: HighEntropyHint[],
  ) => Promise<Record<string, unknown>>;
}

async function collectDevicePayload(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const win = typeof window !== "undefined" ? window : null;
  const doc = typeof document !== "undefined" ? document : null;

  if (nav) {
    out.userAgent = nav.userAgent;
    out.language = nav.language;
    out.languages = nav.languages ? [...nav.languages] : undefined;
    out.platform = nav.platform;
    out.cookieEnabled = nav.cookieEnabled;
    out.onLine = nav.onLine;
    out.hardwareConcurrency = nav.hardwareConcurrency;
    out.maxTouchPoints = nav.maxTouchPoints;
    out.vendor = nav.vendor;
    const dm = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
    if (dm != null) out.deviceMemoryGB = dm;

    const uaData = (nav as Navigator & {
      userAgentData?: NavigatorUserAgentData;
    }).userAgentData;
    if (uaData) {
      try {
        const hints: HighEntropyHint[] = [
          "architecture",
          "bitness",
          "brands",
          "fullVersionList",
          "mobile",
          "model",
          "platform",
          "platformVersion",
          "uaFullVersion",
          "wow64",
        ];
        out.userAgentData = {
          brands: uaData.brands,
          mobile: uaData.mobile,
          platform: uaData.platform,
          highEntropy: await uaData.getHighEntropyValues(hints),
        };
      } catch (e) {
        out.userAgentDataError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  if (typeof screen !== "undefined") {
    out.screen = {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      orientationType: screen.orientation?.type,
      orientationAngle: screen.orientation?.angle,
    };
  }

  if (win && doc) {
    out.viewport = {
      innerWidth: win.innerWidth,
      innerHeight: win.innerHeight,
      outerWidth: win.outerWidth,
      outerHeight: win.outerHeight,
      devicePixelRatio: win.devicePixelRatio,
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    };
    out.location = {
      href: win.location.href,
      origin: win.location.origin,
      pathname: win.location.pathname,
      search: win.location.search,
      hash: win.location.hash,
      host: win.location.host,
    };
    out.referrer = doc.referrer || null;
    out.documentVisibilityState = doc.visibilityState;
    out.touchSupport = "ontouchstart" in win;
  }

  try {
    const intl = Intl.DateTimeFormat().resolvedOptions();
    out.intl = {
      timeZone: intl.timeZone,
      locale: intl.locale,
      calendar: intl.calendar,
      numberingSystem: intl.numberingSystem,
    };
  } catch (e) {
    out.intlError = e instanceof Error ? e.message : String(e);
  }
  out.dateTimezoneOffsetMinutes = -new Date().getTimezoneOffset();
  out.dateISO = new Date().toISOString();

  const conn = (
    nav as Navigator & {
      connection?: {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
        saveData?: boolean;
        type?: string;
      };
    }
  )?.connection;
  if (conn) {
    out.networkConnection = {
      effectiveType: conn.effectiveType,
      downlinkMbps: conn.downlink,
      rttMs: conn.rtt,
      saveData: conn.saveData,
      type: conn.type,
    };
  }

  if (nav?.storage?.estimate) {
    try {
      const est = await nav.storage.estimate();
      out.storageEstimate = {
        usage: est.usage,
        quota: est.quota,
      };
    } catch (e) {
      out.storageEstimateError = e instanceof Error ? e.message : String(e);
    }
  }

  const perf = win?.performance;
  if (perf) {
    out.performanceNavigation = {
      type: perf.navigation?.type,
      redirectCount: perf.navigation?.redirectCount,
    };
    const mem = (perf as Performance & { memory?: Record<string, number> })
      .memory;
    if (mem) out.performanceMemory = { ...mem };
    try {
      const entries = perf.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      const navEntry = entries[0];
      if (navEntry) {
        out.navigationTiming = {
          domContentLoadedEventEnd: navEntry.domContentLoadedEventEnd,
          loadEventEnd: navEntry.loadEventEnd,
          domInteractive: navEntry.domInteractive,
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (nav?.mediaDevices?.enumerateDevices) {
    try {
      const devices = await nav.mediaDevices.enumerateDevices();
      const byKind: Record<string, number> = {};
      for (const d of devices) {
        byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
      }
      out.mediaDevices = {
        total: devices.length,
        byKind,
        hasLabels: devices.some((d) => Boolean(d.label)),
      };
    } catch (e) {
      out.mediaDevicesError = e instanceof Error ? e.message : String(e);
    }
  }

  if (nav?.permissions?.query) {
    const names = [
      "geolocation",
      "notifications",
      "camera",
      "microphone",
      "clipboard-read",
      "clipboard-write",
    ] as const;
    out.permissionStates = {};
    for (const name of names) {
      try {
        const status = await nav.permissions.query({ name: name as PermissionName });
        (out.permissionStates as Record<string, string>)[name] = status.state;
      } catch {
        (out.permissionStates as Record<string, string>)[name] = "unsupported";
      }
    }
  }

  try {
    const canvas = doc?.createElement("canvas");
    if (canvas) {
      const gl =
        canvas.getContext("webgl") ??
        canvas.getContext("experimental-webgl");
      if (gl && "getExtension" in gl) {
        const webgl = gl as WebGLRenderingContext;
        const dbg = webgl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          out.webgl = {
            vendor: webgl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
            renderer: webgl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
          };
        }
        out.webglVersion = webgl.getParameter(webgl.VERSION);
        out.webglShadingLanguage = webgl.getParameter(
          webgl.SHADING_LANGUAGE_VERSION,
        );
      }
    }
  } catch (e) {
    out.webglError = e instanceof Error ? e.message : String(e);
  }

  if (win?.matchMedia) {
    out.mediaPreferences = {
      prefersColorScheme: win.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : win.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "no-preference",
      prefersReducedMotion: win.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      prefersContrast: win.matchMedia("(prefers-contrast: more)").matches
        ? "more"
        : win.matchMedia("(prefers-contrast: less)").matches
          ? "less"
          : "no-preference",
    };
  }

  // GPS omitido: getCurrentPosition dispara el diálogo de permiso del navegador.
  // La ubicación “sin preguntar” solo es posible vía IP en el servidor, no en el cliente.

  return out;
}

export function DeviceDataLogger() {
  useEffect(() => {
    void (async () => {
      const payload = await collectDevicePayload();
      console.log("[device]", payload);

      let serverGeo: unknown = null;
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch("/api/geo", {
          cache: "no-store",
          headers: { "X-Client-Timezone": tz },
        });
        if (res.ok) {
          serverGeo = await res.json();
        } else {
          const body = await res.text();
          serverGeo = {
            error: "HTTP",
            status: res.status,
            body: body.slice(0, 500),
          };
        }
      } catch (e) {
        serverGeo = {
          error: "fetch /api/geo failed",
          message: e instanceof Error ? e.message : String(e),
        };
      }
      console.log("[geo]", serverGeo);
    })();
  }, []);

  return null;
}
