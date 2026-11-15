import React, { useCallback, useEffect, useState } from "react";
import { ArrowRight, Briefcase, KeyRound, Mail, ShieldCheck, UserCheck } from "lucide-react";
import {
  getCurrentUser,
  setActiveSessionUser,
  setAuthMode,
  setAuthToken,
  signInDemo,
  signOutEverywhere,
} from "../lib/api";
import {
  enrollSupabaseTotp,
  getSupabaseClient,
  getSupabaseMfaStatus,
  signInWithSupabaseEmailOtp,
  signInWithSupabaseGoogle,
  verifySupabaseEmailOtp,
  verifySupabaseTotpCode,
} from "../lib/supabase";
import type { UserProfile, UserRole } from "../server/types";

interface AuthGateProps {
  authConfigured: boolean;
  onAuthenticated: (user: UserProfile, token: string) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ authConfigured, onAuthenticated }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmailOtp, setShowEmailOtp] = useState(false);
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // AAL2 TOTP MFA state (required by Supabase SQL for owner/manager)
  const [mfaChallengeUser, setMfaChallengeUser] = useState<UserProfile | null>(null);
  const [mfaPendingToken, setMfaPendingToken] = useState<string>("");
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const completeOrChallengeMfa = useCallback(
    async (user: UserProfile, token: string) => {
      if (user.mfaRequired) {
        setMfaChallengeUser(user);
        setMfaPendingToken(token);
        setMfaEnrollment(null);
        setTotpCode("");
        const status = await getSupabaseMfaStatus();
        setMfaFactorId(status.totpFactorId);
        return;
      }
      setMfaChallengeUser(null);
      setActiveSessionUser(user);
      onAuthenticated(user, token);
    },
    [onAuthenticated],
  );

  useEffect(() => {
    let active = true;
    let unsubAuth: (() => void) | null = null;

    const handleSupabaseSession = async () => {
      try {
        const client = await getSupabaseClient();
        if (!client || !active) return;

        const { data: sessionData } = await client.auth.getSession();
        if (sessionData.session?.access_token && active) {
          setAuthMode("supabase");
          setAuthToken(sessionData.session.access_token);
          const { user } = await getCurrentUser();
          if (active) {
            await completeOrChallengeMfa(user, sessionData.session.access_token);
          }
          return;
        }

        const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token && active) {
            setAuthMode("supabase");
            setAuthToken(session.access_token);
            void getCurrentUser()
              .then(async ({ user }) => {
                if (active) {
                  await completeOrChallengeMfa(user, session.access_token);
                  setLoading(false);
                }
              })
              .catch((err) => {
                if (active) {
                  setLoading(false);
                  setError(err instanceof Error ? err.message : "Could not load Supabase profile.");
                }
              });
          }
        });
        unsubAuth = () => sub.subscription.unsubscribe();
      } catch {
        // Ignore if Supabase is not configured yet
      }
    };

    void handleSupabaseSession();

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

      if (event.data?.type === "LUMEX_OAUTH_ERROR" || event.data?.type === "KIRAN_OAUTH_ERROR") {
        setLoading(false);
        setError(String(event.data.error || "Google Sign-In failed."));
        return;
      }

      if (
        (event.data?.type === "LUMEX_OAUTH_SUCCESS" || event.data?.type === "KIRAN_OAUTH_SUCCESS") &&
        event.data.accessToken
      ) {
        const token = String(event.data.accessToken);
        setAuthMode("supabase");
        setAuthToken(token);
        void getCurrentUser()
          .then(async ({ user }) => {
            await completeOrChallengeMfa(user, token);
            setLoading(false);
          })
          .catch((err) => {
            setLoading(false);
            setAuthToken(null);
            setAuthMode(null);
            setError(err instanceof Error ? err.message : "Could not complete sign-in.");
          });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      active = false;
      unsubAuth?.();
      window.removeEventListener("message", handleMessage);
    };
  }, [completeOrChallengeMfa]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const url = await signInWithSupabaseGoogle(window.location.origin);
      window.location.assign(url);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unable to start Google Sign-In.");
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithSupabaseEmailOtp(email);
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifySupabaseEmailOtp(email, otpCode);
      setAuthMode("supabase");
      const { user } = await getCurrentUser();
      const client = await getSupabaseClient();
      const sessionToken = (await client?.auth.getSession())?.data.session?.access_token || "";
      setAuthToken(sessionToken);
      await completeOrChallengeMfa(user, sessionToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong or expired verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartMfaEnrollment = async () => {
    setError(null);
    setLoading(true);
    try {
      const enrolled = await enrollSupabaseTotp();
      setMfaEnrollment(enrolled);
      setMfaFactorId(enrolled.factorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start authenticator setup.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetFactorId = mfaEnrollment?.factorId || mfaFactorId;
    if (!targetFactorId) return;
    setError(null);
    setLoading(true);
    try {
      await verifySupabaseTotpCode(targetFactorId, totpCode);
      const client = await getSupabaseClient();
      const refreshedToken =
        (await client?.auth.getSession())?.data.session?.access_token || mfaPendingToken;
      setAuthToken(refreshedToken);
      const { user: refreshedUser } = await getCurrentUser();
      setMfaChallengeUser(null);
      setMfaEnrollment(null);
      setActiveSessionUser(refreshedUser);
      onAuthenticated(refreshedUser, refreshedToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid 6-digit authenticator code.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelMfa = async () => {
    setError(null);
    setMfaChallengeUser(null);
    setMfaEnrollment(null);
    setTotpCode("");
    await signOutEverywhere();
  };

  const handleDemoSignIn = async (role: UserRole) => {
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await signInDemo(role);
      setAuthMode("demo");
      setAuthToken(token);
      setActiveSessionUser(user);
      onAuthenticated(user, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open demo workspace.");
    } finally {
      setLoading(false);
    }
  };

  if (mfaChallengeUser) {
    return (
      <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#7a2e4a] text-white flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight">Two-Factor Security Check (AAL2)</h1>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                {mfaChallengeUser.fullName} · {mfaChallengeUser.role.toUpperCase()}
              </p>
            </div>
          </div>

          <p className="text-xs text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
            Office Manager and Owner permissions require an authenticator code before recording settlements, reversing receipts, or approving orders.
          </p>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200"
            >
              {error}
            </div>
          )}

          {!mfaFactorId && !mfaEnrollment ? (
            <div className="space-y-3">
              <button
                type="button"
                disabled={loading}
                onClick={handleStartMfaEnrollment}
                className="w-full h-11 px-4 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold hover:opacity-95 disabled:opacity-50"
              >
                {loading ? "Preparing Authenticator..." : "Set Up Authenticator App (TOTP)"}
              </button>
              <button
                type="button"
                onClick={() => void handleCancelMfa()}
                className="w-full h-10 px-4 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <form onSubmit={handleVerifyMfa} className="space-y-3">
              {mfaEnrollment && (
                <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] space-y-2 text-center">
                  <div className="text-[11px] font-semibold text-[#6b625e] dark:text-[#a59b96]">
                    Scan QR code with Google Authenticator or Authy
                  </div>
                  <img
                    src={mfaEnrollment.qrCode}
                    alt="Authenticator QR Code"
                    className="w-36 h-36 mx-auto rounded-lg bg-white p-1.5"
                  />
                  <div className="text-[11px] font-mono break-all text-[#6b625e] dark:text-[#a59b96]">
                    Secret: {mfaEnrollment.secret}
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="totp-mfa-code" className="block text-xs font-semibold mb-1">
                  6-Digit Authenticator Code
                </label>
                <input
                  id="totp-mfa-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full px-3 py-2.5 text-base font-mono font-bold tracking-widest rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCancelMfa()}
                  className="px-4 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
                >
                  Sign Out
                </button>
                <button
                  type="submit"
                  disabled={loading || totpCode.length < 6}
                  className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {loading ? "Verifying..." : "Verify & Continue"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#7a2e4a] text-white font-bold text-lg flex items-center justify-center shrink-0">
            L
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight leading-tight">Lumex DMS</h1>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Karachi Field Sales · Lumex & Mocheqi Musk
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <h2 className="font-bold text-base">Sign in to sync your territory</h2>
          <p className="text-xs text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
            Authenticate with Supabase to sync your offline outbox queue, salon credit balances, delivery signatures, and monthly targets.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200"
          >
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

          {authConfigured && !showEmailOtp && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setShowEmailOtp(true)}
              className="w-full h-10 px-4 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs font-semibold flex items-center justify-center gap-2 hover:border-[#7a2e4a] transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
              <span>Sign in with Email Code</span>
            </button>
          )}

          {authConfigured && showEmailOtp && (
            <div className="p-3.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] space-y-2.5">
              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="space-y-2">
                  <label htmlFor="otp-email" className="block text-xs font-semibold">
                    Work Email Address
                  </label>
                  <input
                    id="otp-email"
                    type="email"
                    required
                    placeholder="rep@kirancompany.pk"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEmailOtp(false)}
                      className="px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
                    >
                      {loading ? "Sending..." : "Send 6-Digit Code"}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-2">
                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                    Enter the 6-digit code sent to <strong>{email}</strong>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-3 py-2 text-sm font-mono font-bold tracking-widest rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOtpSent(false);
                        setOtpCode("");
                      }}
                      className="px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium"
                    >
                      Change Email
                    </button>
                    <button
                      type="submit"
                      disabled={loading || otpCode.length < 6}
                      className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
                    >
                      {loading ? "Verifying..." : "Verify Code"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

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
