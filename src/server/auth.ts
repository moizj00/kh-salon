import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import type { UserProfile, UserRole } from "./types.ts";

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
}

const DEMO_USERS: Record<string, UserProfile> = {
  "demo-rep-token": {
    id: "rep-karachi-pilot-01",
    email: "rashid.khan@kirancompany.pk",
    fullName: "Rashid Khan",
    role: "rep",
    territory: "Karachi Central",
    monthlyVisitTarget: 50,
  },
  "demo-manager-token": {
    id: "mgr-karachi-hq-01",
    email: "office.manager@kirancompany.pk",
    fullName: "Tariq Mahmood (Office Manager)",
    role: "manager",
    territory: "Karachi HQ",
    monthlyVisitTarget: 50,
  },
};

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim());
}

function getManagerEmails(): Set<string> {
  return new Set(
    (process.env.MANAGER_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function buildGoogleOAuthUrl(redirectUri: string): Promise<string> {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error("Supabase auth is not configured on the server.");
  }

  const supabase = createClient(url, anonKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUri,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    throw new Error(error?.message ?? "Could not generate Google OAuth URL.");
  }
  return data.url;
}

export async function resolveUserFromToken(token: string): Promise<UserProfile | null> {
  if (DEMO_USERS[token]) {
    return DEMO_USERS[token];
  }
  if (!isSupabaseAuthConfigured()) {
    return null;
  }

  const url = process.env.SUPABASE_URL!.trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!.trim();
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  const sbUser = data.user;
  const email = (sbUser.email ?? "").toLowerCase();
  const fullName =
    (sbUser.user_metadata?.full_name as string | undefined) ||
    (sbUser.user_metadata?.name as string | undefined) ||
    email.split("@")[0] ||
    "Field Rep";

  // Ensure rep_profiles row exists in Supabase when service role is available
  let role: UserRole = getManagerEmails().has(email) ? "manager" : "rep";
  let territory = "Karachi Central";
  let monthlyVisitTarget = 50;

  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    const { data: existingProfile } = await supabase
      .from("rep_profiles")
      .select("*")
      .eq("id", sbUser.id)
      .maybeSingle();

    if (existingProfile) {
      role = (existingProfile.role as UserRole) ?? role;
      territory = String(existingProfile.territory ?? territory);
      monthlyVisitTarget = Number(existingProfile.monthly_visit_target ?? monthlyVisitTarget);
    } else {
      await supabase.from("rep_profiles").upsert({
        id: sbUser.id,
        email,
        full_name: fullName,
        role,
        territory,
        monthly_visit_target: monthlyVisitTarget,
      });
    }
  }

  return {
    id: sbUser.id,
    email,
    fullName,
    role,
    territory,
    monthlyVisitTarget,
  };
}

export function issueDemoSession(role: UserRole): { token: string; user: UserProfile } {
  const token = role === "manager" ? "demo-manager-token" : "demo-rep-token";
  return { token, user: DEMO_USERS[token] };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Sign in required to sync with Kiran DMS." });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  const user = await resolveUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Session expired. Please sign in with Google again." });
    return;
  }
  req.user = user;
  next();
}
