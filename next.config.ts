import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Evita que Turbopack use un lockfile de una carpeta padre (p. ej. el Escritorio).
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
