import React, { useEffect, useState } from "react";
import { ArrowRight, Briefcase, ShieldCheck, UserCheck } from "lucide-react";
import { getGoogleOAuthUrl, setAuthToken, signInDemo } from "../lib/api";
import type { UserProfile, UserRole } from "../server/types";

interface AuthGateProps {
  authConfigured: boolean;
  onAuthenticated: (user: UserProfile, token: string) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ authConfigured, onAuthenticated }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || "";
      if (
        origin &&
        !origin.endsWith(".run.app") &&
        !origin.includes("localhost") &&
        !origin.includes("127.0.0.1")
      ) {
        return;
      }

      if (event.data?.type === "KIRAN_OAUTH_ERROR") {
        setLoading(false);
        setError(String(event.data.error || "Google Sign-In failed."));
        return;
      }

      if (event.data?.type === "KIRAN_OAUTH_SUCCESS" && event.data.accessToken) {
        const token = String(event.data.accessToken);
        setAuthToken(token);
        void fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(async (res) => {
            if (!res.ok) throw new Error("Failed to verify user profile.");
            return (await res.json()) as { user: UserProfile };
          })
          .then(({ user }) => {
            setLoading(false);
            onAuthenticated(user, token);
          })
          .catch((err) => {
            setLoading(false);
            setAuthToken(null);
            setError(err instanceof Error ? err.message : "Could not complete sign-in.");
          });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onAuthenticated]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { url } = await getGoogleOAuthUrl();
      const popup = window.open(url, "kiran_google_oauth", "width=520,height=640");
      if (!popup) {
        setLoading(false);
        setError("Popup was blocked by your browser. Please allow popups and try again.");
      }
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unable to start Google Sign-In.");
    }
  };

  const handleDemoSignIn = async (role: UserRole) => {
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await signInDemo(role);
      setAuthToken(token);
      onAuthenticated(user, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open demo workspace.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#7a2e4a] text-white font-bold text-lg flex items-center justify-center shrink-0">
            K
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight leading-tight">Kiran DMS</h1>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Karachi Field Sales · KH Enterprises
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <h2 className="font-bold text-base">Sign in to sync your territory</h2>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
            Authenticate to sync your offline outbox queue, salon credit balances, delivery signatures, and monthly targets.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={loading || !authConfigured}
            onClick={handleGoogleSignIn}
            className="w-full h-12 px-4 rounded-xl bg-[#7a2e4a] text-white font-semibold text-sm flex items-center justify-center gap-2.5 hover:opacity-95 disabled:opacity-45 transition-opacity"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{loading ? "Connecting..." : "Continue with Google"}</span>
          </button>

          <div className="pt-3 border-t border-[#e6dfdb] dark:border-[#3a3330] space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="h-px bg-[#e6dfdb] dark:bg-[#3a3330] flex-1" />
              <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96] uppercase font-medium tracking-wider">
                Or quick test sign-in
              </span>
              <div className="h-px bg-[#e6dfdb] dark:bg-[#3a3330] flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoSignIn("rep")}
                className="h-11 px-3 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs font-semibold flex items-center justify-center gap-2 hover:border-[#7a2e4a] transition-colors"
              >
                <UserCheck className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Field Rep Workspace</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#6b625e]" />
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemoSignIn("manager")}
                className="h-11 px-3 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs font-semibold flex items-center justify-center gap-2 hover:border-[#7a2e4a] transition-colors"
              >
                <Briefcase className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Office Manager</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#6b625e]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
