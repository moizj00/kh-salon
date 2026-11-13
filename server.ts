import "dotenv/config";
import express from "express";
import path from "node:path";
import type { OutboxFn } from "./src/lib/outbox/types.ts";
import {
  buildGoogleOAuthUrl,
  isSupabaseAuthConfigured,
  issueDemoSession,
  requireAuth,
  resolveUserFromToken,
  type AuthenticatedRequest,
} from "./src/server/auth.ts";
import { getRepository, isSupabaseConfigured } from "./src/server/store.ts";
import { RpcError, type ManagerApprovalAction, type UserRole } from "./src/server/types.ts";

const VALID_RPCS = new Set<OutboxFn>([
  "rep_check_in",
  "record_count",
  "rep_check_out",
  "log_visit",
  "add_salon_note",
  "create_salon",
  "rep_create_card",
  "rep_record_payment",
  "record_demand",
  "rep_submit_delivery",
  "rep_attach_signature",
]);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const repo = getRepository();

  app.use(express.json({ limit: "5mb" }));

  // Health & config discovery (public, no secrets exposed)
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      mode: isSupabaseConfigured() ? "supabase" : "demo",
      authConfigured: isSupabaseAuthConfigured(),
    });
  });

  app.get("/api/auth/config", (_req, res) => {
    res.json({
      authConfigured: isSupabaseAuthConfigured(),
      supabaseConfigured: isSupabaseConfigured(),
    });
  });

  // Google Sign-In via Supabase OAuth popup
  app.get("/api/auth/google-url", async (req, res) => {
    try {
      const originParam = typeof req.query.origin === "string" ? req.query.origin : "";
      const baseUrl = (process.env.APP_URL || originParam || `http://localhost:${port}`).replace(/\/+$/, "");
      const redirectUri = `${baseUrl}/auth/callback`;
      const url = await buildGoogleOAuthUrl(redirectUri);
      res.json({ url, redirectUri });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not initialize Google Sign-In.";
      res.status(400).json({ error: msg });
    }
  });

  // OAuth popup callback handler (handles both implicit hash tokens and query errors)
  app.get(["/auth/callback", "/auth/callback/"], (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Kiran DMS Sign-In</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #faf7f5; color: #1d1a19; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: #fff; border: 1px solid #e6dfdb; border-radius: 16px; padding: 24px; max-width: 360px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="card">
      <p id="status">Completing Google Sign-In...</p>
    </div>
    <script>
      (function() {
        var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        var query = new URLSearchParams(window.location.search);
        var accessToken = hash.get('access_token');
        var refreshToken = hash.get('refresh_token');
        var errorDesc = hash.get('error_description') || query.get('error_description') || query.get('error');

        if (window.opener) {
          if (accessToken) {
            window.opener.postMessage({
              type: 'KIRAN_OAUTH_SUCCESS',
              accessToken: accessToken,
              refreshToken: refreshToken || ''
            }, '*');
            window.close();
            return;
          }
          if (errorDesc) {
            window.opener.postMessage({
              type: 'KIRAN_OAUTH_ERROR',
              error: errorDesc
            }, '*');
            document.getElementById('status').textContent = 'Sign-in error: ' + errorDesc;
            return;
          }
        }
        document.getElementById('status').textContent = accessToken
          ? 'Signed in! You may close this window and return to Kiran DMS.'
          : 'No session token received. Please try signing in again.';
      })();
    </script>
  </body>
</html>`);
  });

  // Quick test session helper (useful for evaluation & offline testing)
  app.post("/api/auth/demo", (req, res) => {
    const role: UserRole = req.body?.role === "manager" ? "manager" : "rep";
    const session = issueDemoSession(role);
    res.json(session);
  });

  app.get("/api/auth/me", async (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    const user = await resolveUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    res.json({ user, authMode: isSupabaseAuthConfigured() ? "supabase" : "demo" });
  });

  // Protected Field Rep & Ledger Routes
  app.get("/api/bootstrap", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const payload = await repo.getBootstrap(req.user!);
      res.json(payload);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : "Failed to load workspace." });
    }
  });

  app.post("/api/rpc/:fn", requireAuth, async (req: AuthenticatedRequest, res) => {
    const fn = req.params.fn as OutboxFn;
    if (!VALID_RPCS.has(fn)) {
      res.status(400).json({ error: `Unsupported RPC function: ${fn}`, code: "42883" });
      return;
    }

    try {
      const args = (req.body?.args ?? req.body ?? {}) as Record<string, unknown>;
      const result = await repo.executeRpc(req.user!, fn, args);
      res.json(result);
    } catch (err) {
      if (err instanceof RpcError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : "RPC execution failed.",
        code: "XX000",
      });
    }
  });

  app.get("/api/salons/:id/activity", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const activity = await repo.getSalonActivity(req.params.id);
      res.json(activity);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : "Failed to load salon history." });
    }
  });

  app.post("/api/salons/bulk-import", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const items = req.body?.salons as Array<{
        name: string;
        area?: string;
        phone?: string;
        contact?: string;
        creditLimit?: number;
      }>;
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: "No salon rows provided for bulk import." });
        return;
      }
      const createdCount = await repo.bulkImportSalons(items, req.user!.id);
      res.json({
        success: true,
        count: createdCount,
        message: `Successfully imported ${createdCount} salons into ledger.`,
      });
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : "Bulk import failed." });
    }
  });

  // Public Storefront Checkout (khsalon.com)
  app.post("/api/shop/orders", async (req, res) => {
    try {
      const order = await repo.createShopOrder(req.body);
      res.status(201).json(order);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : "Order submission failed." });
    }
  });

  app.get("/api/shop/orders", requireAuth, async (_req, res) => {
    try {
      const orders = await repo.listShopOrders();
      res.json({ orders });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load shop orders." });
    }
  });

  // Delivery Notification Dispatch
  app.post("/api/deliveries/:id/notify", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const outcome = await repo.notifyDelivery(req.params.id);
      res.json(outcome);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : "Failed to resend notification." });
    }
  });

  // Office Manager Overview & Approvals
  app.get("/api/manager/overview", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const overview = await repo.getManagerOverview(req.user!);
      res.json(overview);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : "Failed to load manager overview." });
    }
  });

  app.post("/api/manager/approvals", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const action = req.body as ManagerApprovalAction;
      if (!action || typeof action.action !== "string") {
        res.status(400).json({ error: "Invalid approval payload." });
        return;
      }
      if (action.action === "mark_deliveries_delivered") {
        if (!Array.isArray(action.ids) || action.ids.length === 0) {
          res.status(400).json({ error: "Please select at least one pending delivery order." });
          return;
        }
      } else if (typeof action.id !== "string") {
        res.status(400).json({ error: "Invalid approval payload." });
        return;
      }
      if (
        (action.action === "mark_delivery_delivered" || action.action === "mark_deliveries_delivered") &&
        req.user?.role !== "manager"
      ) {
        res.status(403).json({
          error: "Only an Owner or Office Manager can mark delivery orders as delivered directly.",
        });
        return;
      }
      const outcome = await repo.handleManagerApproval(action);
      res.json(outcome);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : "Approval failed." });
    }
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
    console.log(`Kiran DMS server listening on http://0.0.0.0:${port} (${isSupabaseConfigured() ? "Supabase" : "Local Store"})`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
