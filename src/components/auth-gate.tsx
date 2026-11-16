import React, { useCallback, useEffect, useState } from "react";
import { Building2, KeyRound, Mail, ShieldCheck, ShoppingBag, User } from "lucide-react";
import {
  applySalonSignup,
  fetchSalonLoginStatus,
  getCurrentUser,
  setActiveSessionUser,
  setAuthToken,
  signOutEverywhere,
} from "../lib/api";
import {
  enrollSupabaseTotp,
  exchangeSupabaseAuthCode,
  getSupabaseClient,
  getSupabaseMfaStatus,
  signInWithSupabaseEmailOtp,
  signInWithSupabaseGoogle,
  signInWithSupabasePassword,
  verifySupabaseEmailOtp,
  verifySupabaseTotpCode,
} from "../lib/supabase";
import type { SalonLoginStatus, SalonType, UserProfile } from "../server/types";

interface AuthGateProps {
  authConfigured: boolean;
  onAuthenticated: (user: UserProfile, token: string) => void;
  onSalonAuthenticated?: (status: SalonLoginStatus, token: string) => void;
  onOpenStorefront?: () => void;
}

const SALON_TYPE_OPTIONS: Array<{ value: SalonType; label: string }> = [
  { value: "ladies_parlor", label: "Ladies Parlor" },
  { value: "unisex", label: "Unisex Salon" },
  { value: "hair_studio", label: "Hair Studio" },
  { value: "mens_salon", label: "Men's Salon" },
  { value: "bridal_studio", label: "Bridal Studio" },
  { value: "barber", label: "Barber Shop" },
  { value: "spa_wellness", label: "Spa & Wellness" },
  { value: "home_parlor", label: "Home Parlor" },
  { value: "academy", label: "Beauty Academy" },
  { value: "other", label: "Other Salon" },
];

export const AuthGate: React.FC<AuthGateProps> = ({
  authConfigured,
  onAuthenticated,
  onSalonAuthenticated,
  onOpenStorefront,
}) => {
  const [entryMode, setEntryMode] = useState<"staff" | "salon">("staff");
  const [staffMethod, setStaffMethod] = useState<"password" | "otp">("password");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Staff Email / Password & OTP
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // Salon Partner OTP & Self-Signup State
  const [salonEmail, setSalonEmail] = useState("");
  const [salonOtpCode, setSalonOtpCode] = useState("");
  const [salonOtpSent, setSalonOtpSent] = useState(false);
  const [salonPendingStatus, setSalonPendingStatus] = useState<SalonLoginStatus | null>(null);
  const [showSalonApply, setShowSalonApply] = useState(false);
  const [applySalonName, setApplySalonName] = useState("");
  const [applyContactName, setApplyContactName] = useState("");
  const [applySalonType, setApplySalonType] = useState<SalonType>("ladies_parlor");
  const [applyAddress, setApplyAddress] = useState("");

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

  const routeActiveSession = useCallback(
    async (token: string) => {
      try {
        const { user } = await getCurrentUser();
        await completeOrChallengeMfa(user, token);
        return;
      } catch (staffErr) {
        const salonStatus = await fetchSalonLoginStatus();
        if (salonStatus?.membershipStatus === "active" && onSalonAuthenticated) {
          onSalonAuthenticated(salonStatus, token);
          return;
        }
        if (salonStatus?.membershipStatus) {
          setEntryMode("salon");
          setSalonPendingStatus(salonStatus);
          setShowSalonApply(false);
          return;
        }
        throw staffErr;
      }
    },
    [completeOrChallengeMfa, onSalonAuthenticated],
  );

  useEffect(() => {
    let active = true;
    let unsubAuth: (() => void) | null = null;

    const handleSupabaseSession = async () => {
      try {
        const client = await getSupabaseClient();
        if (!client || !active) return;

        // Handle PKCE OAuth ?code= callback on root URL if redirected back here
        if (typeof window !== "undefined") {
          const searchParams = new URLSearchParams(window.location.search);
          const pkceCode = searchParams.get("code");
          if (pkceCode) {
            setLoading(true);
            try {
              const token = await exchangeSupabaseAuthCode(pkceCode);
              window.history.replaceState({}, document.title, window.location.pathname);
              if (token && active) {
                setAuthToken(token);
                await routeActiveSession(token);
                setLoading(false);
                return;
              }
            } catch (err) {
              if (active) {
                setLoading(false);
                setError(err instanceof Error ? err.message : "Google Sign-In verification failed.");
              }
            }
          }
        }

        const { data: sessionData } = await client.auth.getSession();
        if (sessionData.session?.access_token && active) {
          setAuthToken(sessionData.session.access_token);
          await routeActiveSession(sessionData.session.access_token);
          return;
        }

        const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
          if (session?.access_token && active) {
            setAuthToken(session.access_token);
            void routeActiveSession(session.access_token)
              .then(() => {
                if (active) setLoading(false);
              })
              .catch((err) => {
                if (active) {
                  setLoading(false);
                  setError(err instanceof Error ? err.message : "Could not verify Supabase session.");
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

      if (event.data?.type === "KIRAN_OAUTH_ERROR" || event.data?.type === "LUMEX_OAUTH_ERROR") {
        setLoading(false);
        setError(String(event.data.error || "Google Sign-In failed."));
        return;
      }

      if (
        (event.data?.type === "KIRAN_OAUTH_SUCCESS" || event.data?.type === "LUMEX_OAUTH_SUCCESS") &&
        event.data.accessToken
      ) {
        const token = String(event.data.accessToken);
        setAuthToken(token);
        void routeActiveSession(token)
          .then(() => setLoading(false))
          .catch((err) => {
            setLoading(false);
            setAuthToken(null);
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
  }, [routeActiveSession]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const url = await signInWithSupabaseGoogle(window.location.origin);
      window.location.assign(url);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unable to start Google Sign-In.");
    }
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const token = await signInWithSupabasePassword(email, password);
      if (token) {
        setAuthToken(token);
        await routeActiveSession(token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendStaffOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      await signInWithSupabaseEmailOtp(email, false);
      setOtpSent(true);
      setInfoMsg("6-digit verification code sent to your staff email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyStaffOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = await verifySupabaseEmailOtp(email, otpCode);
      setAuthToken(token);
      await routeActiveSession(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong or expired verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendSalonOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      await signInWithSupabaseEmailOtp(salonEmail, true);
      setSalonOtpSent(true);
      setInfoMsg("Verification code sent. Enter the 6-digit code from your email inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send Salon Portal verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySalonOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = await verifySupabaseEmailOtp(salonEmail, salonOtpCode);
      setAuthToken(token);
      const status = await fetchSalonLoginStatus();
      if (status?.membershipStatus === "active" && onSalonAuthenticated) {
        onSalonAuthenticated(status, token);
        return;
      }
      if (status?.membershipStatus) {
        setSalonPendingStatus(status);
        setShowSalonApply(false);
      } else {
        setSalonPendingStatus(null);
        setShowSalonApply(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong or expired verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitSalonApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await applySalonSignup({
        salonName: applySalonName,
        contactName: applyContactName,
        type: applySalonType,
        address: applyAddress,
      });
      setShowSalonApply(false);
      setSalonPendingStatus({
        membershipStatus: "applied",
        salonName: applySalonName.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit salon portal application.");
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

  const handleResetSignOut = async () => {
    setError(null);
    setInfoMsg(null);
    setMfaChallengeUser(null);
    setMfaEnrollment(null);
    setSalonPendingStatus(null);
    setShowSalonApply(false);
    setSalonOtpSent(false);
    setOtpSent(false);
    setTotpCode("");
    await signOutEverywhere();
  };

  if (mfaChallengeUser) {
    return (
      <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-6 space-y-5">
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
            Office Manager and Owner permissions require an authenticator verification code before recording settlements, approving deliveries, or managing catalog prices.
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
                onClick={() => void handleResetSignOut()}
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
                  onClick={() => void handleResetSignOut()}
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
      <div className="w-full max-w-md bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-6 space-y-5">
        {/* Brand Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#7a2e4a] text-white font-bold text-lg flex items-center justify-center shrink-0">
              K
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight leading-tight">Kiran DMS</h1>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Kiran Company Distribution · Karachi
              </p>
            </div>
          </div>

          {onOpenStorefront && (
            <button
              type="button"
              onClick={onOpenStorefront}
              className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:border-[#7a2e4a] flex items-center gap-1.5 shrink-0"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Product Catalog</span>
            </button>
          )}
        </div>

        {/* Portal Switcher: Staff vs Salon Partner */}
        <div
          role="tablist"
          aria-label="Account portal selection"
          className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === "staff"}
            onClick={() => {
              setEntryMode("staff");
              setError(null);
              setInfoMsg(null);
            }}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              entryMode === "staff"
                ? "bg-white dark:bg-[#211d1b] text-[#7a2e4a] dark:text-[#d77a9c] border border-[#e6dfdb] dark:border-[#3a3330]"
                : "text-[#6b625e] dark:text-[#a59b96]"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Staff Sign-In</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === "salon"}
            onClick={() => {
              setEntryMode("salon");
              setError(null);
              setInfoMsg(null);
            }}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              entryMode === "salon"
                ? "bg-white dark:bg-[#211d1b] text-[#7a2e4a] dark:text-[#d77a9c] border border-[#e6dfdb] dark:border-[#3a3330]"
                : "text-[#6b625e] dark:text-[#a59b96]"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Salon Portal</span>
          </button>
        </div>

        {!authConfigured && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200"
          >
            Supabase credentials are not configured in runtime environment variables (`SUPABASE_URL` / `SUPABASE_ANON_KEY`).
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200"
          >
            {error}
          </div>
        )}

        {infoMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
            {infoMsg}
          </div>
        )}

        {/* STAFF AUTHENTICATION */}
        {entryMode === "staff" && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="font-bold text-sm">Field Rep, Manager &amp; Owner Access</h2>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Sign in with your authorized Kiran Company Supabase account.
              </p>
            </div>

            <button
              type="button"
              disabled={loading || !authConfigured}
              onClick={handleGoogleSignIn}
              className="w-full h-11 px-4 rounded-xl bg-[#7a2e4a] text-white font-semibold text-xs flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-45 transition-opacity"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{loading ? "Connecting..." : "Continue with Google"}</span>
            </button>

            <div className="flex items-center gap-2">
              <div className="h-px bg-[#e6dfdb] dark:bg-[#3a3330] flex-1" />
              <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96] uppercase font-medium">
                or email sign-in
              </span>
              <div className="h-px bg-[#e6dfdb] dark:bg-[#3a3330] flex-1" />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStaffMethod("password");
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg font-medium border ${
                  staffMethod === "password"
                    ? "border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c]"
                    : "border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e]"
                }`}
              >
                Email &amp; Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setStaffMethod("otp");
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg font-medium border ${
                  staffMethod === "otp"
                    ? "border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c]"
                    : "border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e]"
                }`}
              >
                Email Code (OTP)
              </button>
            </div>

            {staffMethod === "password" ? (
              <form onSubmit={handlePasswordSignIn} className="space-y-3">
                <div>
                  <label htmlFor="staff-email" className="block text-xs font-semibold mb-1">
                    Work Email
                  </label>
                  <input
                    id="staff-email"
                    type="email"
                    required
                    placeholder="name@kirancompany.pk"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <div>
                  <label htmlFor="staff-password" className="block text-xs font-semibold mb-1">
                    Password
                  </label>
                  <input
                    id="staff-password"
                    type="password"
                    required
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !authConfigured}
                  className="w-full h-10 rounded-xl border border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c] text-xs font-semibold hover:bg-[#7a2e4a] hover:text-white transition-colors disabled:opacity-45"
                >
                  {loading ? "Signing In..." : "Sign In"}
                </button>
              </form>
            ) : !otpSent ? (
              <form onSubmit={handleSendStaffOtp} className="space-y-2.5">
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
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
                <button
                  type="submit"
                  disabled={loading || !authConfigured}
                  className="w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-45"
                >
                  {loading ? "Sending..." : "Send 6-Digit Code"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyStaffOtp} className="space-y-2.5">
                <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                  Enter code sent to <strong>{email}</strong>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full px-3 py-2 text-sm font-mono font-bold tracking-widest rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
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

        {/* SALON PARTNER PORTAL AUTHENTICATION (Email OTP Proof Required) */}
        {entryMode === "salon" && (
          <div className="space-y-4">
            {salonPendingStatus && salonPendingStatus.membershipStatus !== "active" ? (
              <div className="p-4 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] space-y-3">
                <div className="text-sm font-bold">
                  {salonPendingStatus.salonName || "Salon Partner Account"}
                </div>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96] leading-relaxed">
                  {salonPendingStatus.membershipStatus === "applied"
                    ? "Your salon partner application is awaiting Office Manager approval. You will gain catalog and order-request access once approved."
                    : salonPendingStatus.membershipStatus === "application_rejected"
                      ? "This salon portal application was declined by the office."
                      : `Salon membership status is currently: ${salonPendingStatus.membershipStatus}. Contact Kiran Company office for assistance.`}
                </p>
                <button
                  type="button"
                  onClick={() => void handleResetSignOut()}
                  className="px-4 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
                >
                  Sign Out
                </button>
              </div>
            ) : showSalonApply ? (
              <form onSubmit={handleSubmitSalonApplication} className="space-y-3">
                <div>
                  <h2 className="font-bold text-sm">Salon Partner Registration</h2>
                  <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                    Email verified for <strong>{salonEmail}</strong>. Submit your salon details for Office approval.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Salon Business Name</label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="e.g., Studio Nine Clifton"
                    value={applySalonName}
                    onChange={(e) => setApplySalonName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Contact Name</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      placeholder="Manager / Owner"
                      value={applyContactName}
                      onChange={(e) => setApplyContactName(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Salon Type</label>
                    <select
                      value={applySalonType}
                      onChange={(e) => setApplySalonType(e.target.value as SalonType)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                    >
                      {SALON_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Salon Address</label>
                  <input
                    type="text"
                    required
                    minLength={5}
                    maxLength={300}
                    placeholder="Street, block, and Karachi area"
                    value={applyAddress}
                    onChange={(e) => setApplyAddress(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleResetSignOut()}
                    className="px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {loading ? "Submitting..." : "Submit Partner Application"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="space-y-1">
                  <h2 className="font-bold text-sm">Verified Salon Partner Portal</h2>
                  <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                    Sign in with a 6-digit emailed verification code to access your salon pricing, order requests, official orders, and invoices. New salons can apply after verifying their email.
                  </p>
                </div>

                {!salonOtpSent ? (
                  <form onSubmit={handleSendSalonOtp} className="space-y-2.5">
                    <label htmlFor="salon-otp-email" className="block text-xs font-semibold">
                      Salon Business Email
                    </label>
                    <input
                      id="salon-otp-email"
                      type="email"
                      required
                      placeholder="owner@yoursalon.pk"
                      value={salonEmail}
                      onChange={(e) => setSalonEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                    />
                    <button
                      type="submit"
                      disabled={loading || !authConfigured}
                      className="w-full h-11 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-45"
                    >
                      <Mail className="w-4 h-4" />
                      <span>{loading ? "Sending Code..." : "Send Salon Verification Code"}</span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifySalonOtp} className="space-y-2.5">
                    <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      Enter the 6-digit code emailed to <strong>{salonEmail}</strong>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      placeholder="123456"
                      value={salonOtpCode}
                      onChange={(e) => setSalonOtpCode(e.target.value.replace(/\D/g, ""))}
                      className="w-full px-3 py-2 text-sm font-mono font-bold tracking-widest rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSalonOtpSent(false);
                          setSalonOtpCode("");
                        }}
                        className="px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium"
                      >
                        Change Email
                      </button>
                      <button
                        type="submit"
                        disabled={loading || salonOtpCode.length < 6}
                        className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {loading ? "Verifying..." : "Verify & Enter Salon Portal"}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
