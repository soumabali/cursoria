/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

/**
 * Security headers with a per-request CSP nonce.
 *
 * These live here rather than next.config.ts because the deployed vinext
 * build does not apply Next.js `headers()` - setting them there alone left
 * production with none of them (verified: all five were absent live).
 *
 * How the nonce is applied: we put `'nonce-<value>'` on the CSP of the
 * *incoming* request. vinext's renderer reads the nonce back out of the
 * request headers and stamps the same value onto the bootstrap and font
 * <script>/<style> tags it emits, so header and tags always agree. This
 * lets us drop 'unsafe-inline' for scripts entirely, replaced with
 * 'strict-dynamic' (which propagates trust to scripts the bootstrap
 * loads).
 *
 * `style-src` also drops 'unsafe-inline', which means inline style
 * ATTRIBUTES are blocked too (style-src-attr). Any `style="..."` on an
 * element is silently discarded - the attribute stays in the DOM but the
 * declaration never applies, so the element falls back to CSS. That is why
 * the chart bar height is a generated `bar-N` class rather than an inline
 * height, and why every element-level style was migrated to globals.css.
 * Note style-element nonces are unrelated: a nonce can authorise <style>
 * but never a style attribute.
 */
const CSP_TEMPLATE = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
  ].join("; ");

/** Headers that do not depend on the nonce, so they are constant. */
const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Mirror the policy onto the response, preserving headers the app set. */
function withSecurityHeaders(response: Response, nonce: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    // Do not clobber a header the app already set deliberately.
    if (!headers.has(key)) headers.set(key, value);
  }
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", CSP_TEMPLATE(nonce));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const nonce = newNonce();

    // Hand the renderer the nonce on the request it reads headers from.
    const inbound = new Request(request, { headers: new Headers(request.headers) });
    inbound.headers.set("Content-Security-Policy", CSP_TEMPLATE(nonce));

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return withSecurityHeaders(
        await handleImageOptimization(inbound, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths),
        nonce
      );
    }

    return withSecurityHeaders(await handler.fetch(inbound, env, ctx), nonce);
  },
};

export default worker;
