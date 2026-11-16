import "dotenv/config";
import express from "express";
import path from "node:path";
import { buildGoogleOAuthUrl, isSupabaseAuthConfigured } from "./src/server/auth.ts";

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: "2mb" }));

  // Public health & client config discovery (public URL + anon key only, never service_role)
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      mode: "supabase",
      authConfigured: isSupabaseAuthConfigured(),
    });
  });

  app.get("/api/auth/config", (_req, res) => {
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
    const supabaseAnonKey = (
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ""
    ).trim();
    res.json({
      authConfigured: isSupabaseAuthConfigured(),
      supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
      supabaseUrl,
      supabaseAnonKey,
    });
  });

  app.get("/api/maps/config", (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
    res.json({ apiKey });
  });

  // Google Sign-In URL builder via Supabase Auth
  app.get("/api/auth/google-url", async (req, res) => {
    try {
      const originParam = typeof req.query.origin === "string" ? req.query.origin : "";
      const baseUrl = (process.env.APP_URL || originParam || `http://localhost:${port}`).replace(
        /\/+$/,
        "",
      );
      const redirectUri = `${baseUrl}/auth/callback`;
      const url = await buildGoogleOAuthUrl(redirectUri);
      res.json({ url, redirectUri });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not initialize Google Sign-In.";
      res.status(400).json({ error: msg });
    }
  });

  // OAuth callback handler (supports both PKCE ?code= redirects and #access_token implicit fragments)
  app.get(["/auth/callback", "/auth/callback/"], (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Kiran DMS Sign-In</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #faf7f5; color: #1d1a19; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: #fff; border: 1px solid #e6dfdb; border-radius: 16px; padding: 24px; max-width: 380px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="card">
      <p id="status">Completing Kiran DMS Sign-In...</p>
    </div>
    <script>
      (function() {
        var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        var query = new URLSearchParams(window.location.search);
        var code = query.get('code');
        var accessToken = hash.get('access_token');
        var refreshToken = hash.get('refresh_token');
        var errorDesc = hash.get('error_description') || query.get('error_description') || query.get('error');

        if (window.opener && !window.opener.closed) {
          if (code) {
            window.opener.postMessage({ type: 'KIRAN_OAUTH_CODE', code: code }, window.location.origin);
            window.close();
            return;
          }
          if (accessToken) {
            window.opener.postMessage({
              type: 'KIRAN_OAUTH_SUCCESS',
              accessToken: accessToken,
              refreshToken: refreshToken || ''
            }, window.location.origin);
            window.close();
            return;
          }
          if (errorDesc) {
            window.opener.postMessage({
              type: 'KIRAN_OAUTH_ERROR',
              error: errorDesc
            }, window.location.origin);
            document.getElementById('status').textContent = 'Sign-in error: ' + errorDesc;
            return;
          }
        }

        if (code) {
          window.location.replace('/?code=' + encodeURIComponent(code));
          return;
        }
        if (accessToken) {
          window.location.replace('/' + window.location.hash);
          return;
        }
        if (errorDesc) {
          window.location.replace('/?auth_error=' + encodeURIComponent(errorDesc));
          return;
        }
        document.getElementById('status').textContent = 'No authentication response received. Please return to Kiran DMS and try again.';
      })();
    </script>
  </body>
</html>`);
  });

  // Mount Vite middleware in dev, or static dist in production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(
      `Kiran DMS server listening on http://0.0.0.0:${port} (Supabase Auth ${isSupabaseAuthConfigured() ? "ready" : "awaiting configuration"})`,
    );
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
