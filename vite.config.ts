/// <reference types="node" />
import type { ProxyOptions } from "vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

type HeadersCarrier = { headers?: Record<string, string | string[] | undefined> };

function forwardBrowserHeaders(
  proxyReq: { setHeader(name: string, value: string): void },
  req: HeadersCarrier
) {
  const h = req.headers ?? {};
  const forward = ["user-agent", "accept", "accept-language"] as const;
  for (const name of forward) {
    const v = h[name];
    if (typeof v === "string" && v.length > 0) {
      proxyReq.setHeader(name, v);
    } else if (Array.isArray(v) && v[0]) {
      proxyReq.setHeader(name, v[0]);
    }
  }
  if (!h["user-agent"]) {
    proxyReq.setHeader(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AffineRankDashboard/1.0"
    );
  }
}

function apiProxy(proxyTarget: string): Record<string, ProxyOptions> {
  return {
    // www.affine.io scores (must be registered before the generic `/api` rule).
    "/affine-io": {
      target: "https://www.affine.io",
      changeOrigin: true,
      secure: true,
      rewrite: (path) => "/api/affine" + path.slice("/affine-io".length),
      configure(proxy) {
        proxy.on("proxyReq", (proxyReq, req) => {
          forwardBrowserHeaders(proxyReq, req);
        });
      },
    },
    "/api": {
      target: proxyTarget,
      changeOrigin: true,
      secure: true,
      configure(proxy) {
        proxy.on("proxyReq", (proxyReq, req) => {
          // Forward real browser headers so upstream WAF sees a normal client (TLS is still Node).
          forwardBrowserHeaders(proxyReq, req);
        });
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET || "https://api.affine.io";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      // Allow access via LAN IP / custom hostname (otherwise Vite returns 403).
      allowedHosts: true,
      proxy: apiProxy(proxyTarget),
    },
    preview: {
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: apiProxy(proxyTarget),
    },
  };
});
