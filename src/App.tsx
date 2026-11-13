import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_ORDERS,
  INITIAL_ROUTE,
  INITIAL_SALONS,
  INITIAL_SKUS,
  type RouteStop,
  type SKU,
} from "./lib/data";
import {
  ApiError,
  fetchBootstrap,
  fetchSalonActivity,
  getAuthConfig,
  getAuthToken,
  getCurrentUser,
  resendDeliveryNotification,
  setAuthToken,
  submitManagerApproval,
} from "./lib/api";
import {
  discardItem,
  isOffline,
  listItems,
  retryItem,
  setSessionUserId,
  setSimulatedOffline,
  startSync,
  submit,
  subscribe,
  syncHistory,
  syncState,
  wipeLocalData,
} from "./lib/outbox";
import type { OutboxItem, SyncAttempt } from "./lib/outbox/types";
import { cachedRows } from "./lib/cache";
import { registerServiceWorker } from "./lib/register-sw";
import { when } from "./lib/time";
import { AuthGate } from "./components/auth-gate";
import {
  ConfirmBulkDeliveredModal,
  ConfirmDeliveredModal,
  DeliveryBulkBar,
  DeliveryQuickActionsMenu,
  DeliveryReceiptModal,
} from "./components/delivery-actions";
import { DeliveryMapView } from "./components/delivery-map-view";
import { ManagerDashboard } from "./components/manager-dashboard";
import { BottomNavigation, type TabKey } from "./components/navigation";
import { OutboxStatus } from "./components/outbox-status";
import { PWAInstallButton } from "./components/pwa-install";
import { RepMonth } from "./components/rep-month";
import { SignaturePad } from "./components/signature-pad";
import { StorefrontView } from "./components/storefront";
import type {
  DeliveryOrderFull,
  RepMonthlyStats,
  SalonActivityPayload,
  SalonWithApproval,
  UserProfile,
} from "./server/types";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  History,
  List,
  LogOut,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  WifiOff,
  X,
} from "lucide-react";

const DEFAULT_STATS: RepMonthlyStats = {
  visitsCompleted: 2,
  visitsTarget: 50,
  cashCollectedPkr: 50500,
  ordersCount: 3,
  monthLabel: "November 2026 Target",
};

export default function App() {
  // Authentication & Workspace Mode
  const [authReady, setAuthReady] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"rep" | "manager">("rep");

  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [historyItems, setHistoryItems] = useState<SyncAttempt[]>([]);
  const [outboxState, setOutboxState] = useState(syncState());
  const [salons, setSalons] = useState<SalonWithApproval[]>(INITIAL_SALONS);
  const [route, setRoute] = useState<RouteStop[]>(INITIAL_ROUTE);
  const [orders, setOrders] = useState<DeliveryOrderFull[]>(INITIAL_ORDERS);
  const [skus, setSkus] = useState<SKU[]>(INITIAL_SKUS);
  const [monthlyStats, setMonthlyStats] = useState<RepMonthlyStats>(DEFAULT_STATS);

  // Rep day shift state
  const [dayOpen, setDayOpen] = useState(false);
  const [bagCount, setBagCount] = useState(24);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCheckOutModal, setShowCheckOutModal] = useState(false);

  // Selected salon for details & live activity
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);
  const [salonActivity, setSalonActivity] = useState<SalonActivityPayload | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [salonSearch, setSalonSearch] = useState("");
  const [salonFilter, setSalonFilter] = useState<"all" | "regular" | "vip" | "trial" | "prospect">("all");

  // Sub-dialogs
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitNotes, setVisitNotes] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [showCardModal, setShowCardModal] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState(INITIAL_SKUS[0]?.id || "");
  const [cardQty, setCardQty] = useState(2);
  const [showNewSalonModal, setShowNewSalonModal] = useState(false);
  const [newSalonName, setNewSalonName] = useState("");
  const [newSalonArea, setNewSalonArea] = useState("Clifton, Karachi");
  const [newSalonPhone, setNewSalonPhone] = useState("");
  const [newSalonContact, setNewSalonContact] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);

  // Delivery order signing, search, filtering & Quick Actions
  const [signingOrderId, setSigningOrderId] = useState<string | null>(null);
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "pending_delivery" | "delivered">("all");
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [bulkConfirmOrders, setBulkConfirmOrders] = useState<DeliveryOrderFull[]>([]);
  const [markingBulkDelivered, setMarkingBulkDelivered] = useState(false);
  const [openActionMenuOrderId, setOpenActionMenuOrderId] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<DeliveryOrderFull | null>(null);
  const [confirmDeliverOrder, setConfirmDeliverOrder] = useState<DeliveryOrderFull | null>(null);
  const [markingDelivered, setMarkingDelivered] = useState(false);
  const [notifyingOrderId, setNotifyingOrderId] = useState<string | null>(null);
  const [deliveryViewMode, setDeliveryViewMode] = useState<"list" | "map">("list");
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  // Feedback notifications / toasts
  const [toast, setToast] = useState<{ message: string; type: "ok" | "info" | "warn" } | null>(null);
  const lastSyncRef = useRef<number | null>(null);

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener("gmp-quota-exceeded", handleQuotaExceeded);
    return () => window.removeEventListener("gmp-quota-exceeded", handleQuotaExceeded);
  }, []);

  const showToast = useCallback((message: string, type: "ok" | "info" | "warn" = "ok") => {
    setToast({ message, type });
    window.setTimeout(() => {
      setToast(null);
    }, 4500);
  }, []);

  const refreshBootstrap = useCallback(async () => {
    if (!getAuthToken() || isOffline()) return;
    try {
      const res = await cachedRows("bootstrap_salons", async () => {
        const boot = await fetchBootstrap();
        setRoute(boot.route);
        setSkus(boot.skus);
        setOrders(boot.orders);
        setDayOpen(Boolean(boot.activeShift));
        setBagCount(boot.currentBagCount);
        setMonthlyStats(boot.stats);
        return boot.salons;
      });
      setSalons(res.rows);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        showToast(err.message, "warn");
      }
    }
  }, [showToast]);

  const loadSalonActivity = useCallback(async (salonId: string) => {
    if (!getAuthToken() || isOffline()) {
      setSalonActivity(null);
      return;
    }
    setLoadingActivity(true);
    try {
      const activity = await fetchSalonActivity(salonId);
      setSalonActivity(activity);
    } catch {
      setSalonActivity(null);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  // Initialize auth & service worker
  useEffect(() => {
    registerServiceWorker();
    let mounted = true;

    const init = async () => {
      try {
        const cfg = await getAuthConfig();
        if (mounted) setAuthConfigured(cfg.authConfigured);
      } catch {
        // Ignore offline config fetch error
      }

      const token = getAuthToken();
      if (token) {
        try {
          const { user: current } = await getCurrentUser();
          if (mounted) {
            setUser(current);
            setSessionUserId(current.id);
            setWorkspaceMode(current.role === "manager" ? "manager" : "rep");
          }
        } catch {
          setAuthToken(null);
        }
      }
      if (mounted) setAuthReady(true);
    };

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  // Start outbox sync cycle once authenticated
  useEffect(() => {
    if (!user) return;
    void refreshBootstrap();
    const stopSync = startSync();

    const refreshOutbox = async () => {
      try {
        const [all, hist] = await Promise.all([listItems(), syncHistory()]);
        const nextState = syncState();
        setItems(all);
        setHistoryItems(hist);
        setOutboxState(nextState);

        if (nextState.lastSyncAt && nextState.lastSyncAt !== lastSyncRef.current) {
          lastSyncRef.current = nextState.lastSyncAt;
          void refreshBootstrap();
        }
      } catch (err) {
        console.error("Outbox refresh failed", err);
      }
    };

    void refreshOutbox();
    const unsub = subscribe(() => {
      void refreshOutbox();
    });

    return () => {
      stopSync();
      unsub();
    };
  }, [user, refreshBootstrap]);

  // Load salon activity whenever a salon is selected
  useEffect(() => {
    if (selectedSalonId && user) {
      void loadSalonActivity(selectedSalonId);
    } else {
      setSalonActivity(null);
    }
  }, [selectedSalonId, user, loadSalonActivity]);

  const handleAuthenticated = (authedUser: UserProfile) => {
    setUser(authedUser);
    setSessionUserId(authedUser.id);
    setWorkspaceMode(authedUser.role === "manager" ? "manager" : "rep");
  };

  const handleSignOut = () => {
    setAuthToken(null);
    setUser(null);
    setSelectedSalonId(null);
    setWorkspaceMode("rep");
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] flex items-center justify-center p-4">
        <div className="text-xs font-medium text-[#6b625e] dark:text-[#a59b96]">
          Loading Kiran DMS...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate authConfigured={authConfigured} onAuthenticated={handleAuthenticated} />;
  }

  const pendingItems = items.filter((i) => i.state === "pending");
  const currentSalon = salons.find((s) => s.id === selectedSalonId) || null;

  // 1. Check in Rep Day
  const handleCheckIn = async (count: number) => {
    setShowCheckInModal(false);
    const id = `chk-${Date.now()}`;
    const res = await submit({
      id,
      fn: "rep_check_in",
      args: { p_id: id, p_bag_count: count, p_at_client: new Date().toISOString() },
      label: `Day Check-In (${count} units in bag)`,
      salonId: null,
      capturedAt: new Date().toISOString(),
    });

    if (res !== "rejected") {
      setDayOpen(true);
      setBagCount(count);
    }

    if (res === "queued") {
      showToast("Check-in saved on phone (Offline). Queue updated.", "info");
    } else if (res === "rejected") {
      showToast("Check-in rejected by server. Review Outbox.", "warn");
    } else {
      showToast(`Day opened with ${count} units counted.`, "ok");
      void refreshBootstrap();
    }
  };

  // 2. Check out Rep Day (Daily Close)
  const handleCheckOut = async (count: number) => {
    setShowCheckOutModal(false);
    const countId = `cnt-${Date.now()}`;
    const countRes = await submit({
      id: countId,
      fn: "record_count",
      args: { p_id: countId, p_count: count, p_at_client: new Date().toISOString() },
      label: `Daily Close Bag Count (${count} units)`,
      salonId: null,
      capturedAt: new Date().toISOString(),
    });

    if (countRes === "rejected") {
      showToast("Bag count was rejected by server. Review Outbox.", "warn");
      return;
    }

    const closeId = `cls-${Date.now()}`;
    const res = await submit({
      id: closeId,
      fn: "rep_check_out",
      args: {
        p_id: closeId,
        p_count_id: countId,
        p_count: count,
        p_at_client: new Date().toISOString(),
      },
      label: "End Day Shift Check-Out",
      salonId: null,
      capturedAt: new Date().toISOString(),
      dependsOn: { itemId: countId, argName: "p_count_id" },
    });

    if (res !== "rejected") {
      setDayOpen(false);
      setBagCount(count);
    }

    if (res === "queued") {
      showToast("Daily close saved on phone (Offline). Will drain when online.", "info");
    } else if (res === "rejected") {
      showToast("Daily close rejected by server. Review Outbox.", "warn");
    } else {
      showToast("Day shift closed. Variance calculated and recorded.", "ok");
      void refreshBootstrap();
    }
  };

  // 3. Log Visit & Note (with GPS Evidence Capture)
  const handleLogVisit = async () => {
    if (!currentSalon) return;
    setShowVisitModal(false);

    let gps: { lat: number; lng: number } | null = null;
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      gps = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({
              lat: Number(p.coords.latitude.toFixed(6)),
              lng: Number(p.coords.longitude.toFixed(6)),
            }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 },
        );
      });
    }

    const id = `vst-${Date.now()}`;
    const res = await submit({
      id,
      fn: "log_visit",
      args: {
        p_id: id,
        p_salon_id: currentSalon.id,
        p_notes: visitNotes,
        p_lat: gps?.lat ?? null,
        p_lng: gps?.lng ?? null,
        p_at_client: new Date().toISOString(),
      },
      label: `Visit: ${currentSalon.name}${gps ? " (GPS Captured)" : ""}`,
      salonId: currentSalon.id,
      capturedAt: new Date().toISOString(),
    });

    setVisitNotes("");
    const gpsMsg = gps ? " (GPS evidence attached)" : "";
    if (res === "queued") {
      showToast(`Visit for ${currentSalon.name} saved on phone${gpsMsg}.`, "info");
    } else {
      showToast(`Visit logged${gpsMsg} and synced to server.`, "ok");
      void refreshBootstrap();
      void loadSalonActivity(currentSalon.id);
    }
  };

  // 4. Record Cash Payment
  const handleRecordPayment = async () => {
    if (!currentSalon || !paymentAmount) return;
    const amount = Number(paymentAmount);
    if (isNaN(amount) || amount <= 0) return;

    setShowPaymentModal(false);
    const id = `pay-${Date.now()}`;
    const res = await submit({
      id,
      fn: "rep_record_payment",
      args: {
        p_id: id,
        p_salon_id: currentSalon.id,
        p_amount: amount,
        p_method: "cash",
        p_at_client: new Date().toISOString(),
      },
      label: `Cash: PKR ${amount.toLocaleString()} from ${currentSalon.name}`,
      salonId: currentSalon.id,
      capturedAt: new Date().toISOString(),
    });

    setPaymentAmount("");
    setSalons((prev) =>
      prev.map((s) =>
        s.id === currentSalon.id ? { ...s, outstanding_balance: Math.max(0, s.outstanding_balance - amount) } : s,
      ),
    );

    if (res === "queued") {
      showToast(`PKR ${amount.toLocaleString()} saved on this phone. Receipt generated after sync.`, "info");
    } else {
      showToast(`PKR ${amount.toLocaleString()} payment recorded and synced.`, "ok");
      void refreshBootstrap();
      void loadSalonActivity(currentSalon.id);
    }
  };

  // 5. Create Order Intake Card
  const handleCreateCard = async () => {
    if (!currentSalon) return;
    const sku = skus.find((k) => k.id === selectedSkuId);
    if (!sku) return;

    setShowCardModal(false);
    const id = `crd-${Date.now()}`;
    const res = await submit({
      id,
      fn: "rep_create_card",
      args: {
        p_id: id,
        p_salon_id: currentSalon.id,
        p_sku_id: sku.id,
        p_qty: cardQty,
        p_total: sku.price * cardQty,
        p_at_client: new Date().toISOString(),
      },
      label: `Order Card: ${cardQty}x ${sku.name} for ${currentSalon.name}`,
      salonId: currentSalon.id,
      capturedAt: new Date().toISOString(),
    });

    if (res === "queued") {
      showToast("Order card saved on phone.", "info");
    } else {
      showToast("Order card sent to Office Manager for dispatch approval.", "ok");
      void refreshBootstrap();
      void loadSalonActivity(currentSalon.id);
    }
  };

  // 6. Create Prospect Salon
  const handleCreateSalon = async () => {
    if (!newSalonName.trim()) return;
    setShowNewSalonModal(false);
    const id = `sal-${Date.now()}`;
    const newRecord: SalonWithApproval = {
      id,
      name: newSalonName.trim(),
      area: newSalonArea.trim() || "Karachi",
      address: `${newSalonArea.trim() || "Karachi"}, Karachi`,
      phone: newSalonPhone.trim() || "0300-1234567",
      contact_person: newSalonContact.trim() || "Owner",
      stage: "prospect",
      approval_status: "pending_review",
      outstanding_balance: 0,
      credit_limit: 25000,
      last_visited_at: new Date().toISOString(),
      notes_count: 0,
      open_cards_count: 0,
    };

    setSalons([newRecord, ...salons]);
    const res = await submit({
      id,
      fn: "create_salon",
      args: {
        p_id: id,
        p_name: newRecord.name,
        p_area: newRecord.area,
        p_phone: newRecord.phone,
        p_contact: newRecord.contact_person,
        p_at_client: new Date().toISOString(),
      },
      label: `New Prospect: ${newRecord.name}`,
      salonId: id,
      capturedAt: new Date().toISOString(),
    });

    setNewSalonName("");
    setNewSalonPhone("");
    setNewSalonContact("");

    if (res === "queued") {
      showToast(`Prospect ${newRecord.name} saved on phone.`, "info");
    } else {
      showToast("Prospect registered and queued for Office approval.", "ok");
      void refreshBootstrap();
    }
  };

  // 7. Complete Delivery with Attached Digital Signature (Dependent Mutation)
  const handleConfirmDeliverySignature = async (signatureDataUrl: string) => {
    if (!signingOrderId) return;
    const order = orders.find((o) => o.id === signingOrderId);
    if (!order) return;

    setSigningOrderId(null);

    const deliveryId = `del-${Date.now()}`;
    const resDelivery = await submit({
      id: deliveryId,
      fn: "rep_submit_delivery",
      args: {
        p_id: deliveryId,
        p_order_id: order.id,
        p_salon_id: order.salon_id,
        p_total: order.total_amount,
        p_at_client: new Date().toISOString(),
      },
      label: `Delivery: ${order.order_number} to ${order.salon_name}`,
      salonId: order.salon_id,
      capturedAt: new Date().toISOString(),
    });

    if (resDelivery === "rejected") {
      showToast("Delivery submission was rejected. Review Outbox.", "warn");
      return;
    }

    const sigId = `sig-${Date.now()}`;
    const resSig = await submit({
      id: sigId,
      fn: "rep_attach_signature",
      args: {
        p_id: sigId,
        p_delivery_id: deliveryId,
        p_signature_data: signatureDataUrl.slice(0, 120) + "...[sealed]",
        p_at_client: new Date().toISOString(),
      },
      label: `Signature for ${order.order_number}`,
      salonId: order.salon_id,
      capturedAt: new Date().toISOString(),
      dependsOn: { itemId: deliveryId, argName: "p_delivery_id" },
    });

    if (resSig !== "rejected") {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: "delivered", delivered_at: new Date().toISOString() } : o,
        ),
      );
    }

    if (resDelivery === "queued" || resSig === "queued") {
      showToast("Delivery & Customer signature queued on phone.", "info");
    } else if (resSig === "rejected") {
      showToast("Signature attachment rejected. Review Outbox.", "warn");
    } else {
      showToast("Delivery confirmed with customer signature.", "ok");
      void refreshBootstrap();
    }
  };

  const handleResendDeliveryNotification = async (order: DeliveryOrderFull) => {
    setNotifyingOrderId(order.id);
    try {
      const res = await resendDeliveryNotification(order.id);
      showToast(res.message, "ok");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Could not resend order notification.",
        "warn",
      );
    } finally {
      setNotifyingOrderId(null);
    }
  };

  const handleConfirmMarkDelivered = async (order: DeliveryOrderFull) => {
    setMarkingDelivered(true);
    try {
      const res = await submitManagerApproval({
        action: "mark_delivery_delivered",
        id: order.id,
      });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, status: "delivered", delivered_at: new Date().toISOString() } : o,
        ),
      );
      setSelectedDeliveryIds((prev) => prev.filter((id) => id !== order.id));
      setConfirmDeliverOrder(null);
      showToast(res.message, "ok");
      void refreshBootstrap();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update delivery status.",
        "warn",
      );
    } finally {
      setMarkingDelivered(false);
    }
  };

  const handleConfirmBulkMarkDelivered = async (targetOrders: DeliveryOrderFull[]) => {
    const ids = targetOrders.map((o) => o.id);
    if (ids.length === 0) return;
    setMarkingBulkDelivered(true);
    try {
      const res = await submitManagerApproval({
        action: "mark_deliveries_delivered",
        ids,
      });
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) => (idSet.has(o.id) ? { ...o, status: "delivered", delivered_at: now } : o)),
      );
      setSelectedDeliveryIds((prev) => prev.filter((id) => !idSet.has(id)));
      setBulkConfirmOrders([]);
      showToast(res.message, "ok");
      void refreshBootstrap();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update selected delivery orders.",
        "warn",
      );
    } finally {
      setMarkingBulkDelivered(false);
    }
  };

  const filteredSalons = salons.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(salonSearch.toLowerCase()) ||
      s.area.toLowerCase().includes(salonSearch.toLowerCase());
    const matchesFilter = salonFilter === "all" || s.stage === salonFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div
      className={`min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] flex flex-col selection:bg-[#7a2e4a]/20 ${
        workspaceMode === "rep" ? "pb-20" : "pb-8"
      }`}
    >
      {/* Google Maps Demo Quota Warning Banner */}
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{" "}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{" "}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Bar Contract (single compact row) */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#211d1b]/95 backdrop-blur-md border-b border-[#e6dfdb] dark:border-[#3a3330]">
        <div className="max-w-md md:max-w-5xl mx-auto px-4 h-13 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[#7a2e4a] flex items-center justify-center text-white font-bold text-sm shadow-xs">
              K
            </div>
            <span className="font-bold text-sm tracking-tight whitespace-nowrap">Kiran DMS</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setWorkspaceMode(workspaceMode === "rep" ? "manager" : "rep")}
              className="px-3 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] whitespace-nowrap"
            >
              <Briefcase className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
              <span>{workspaceMode === "rep" ? "Office Manager" : "Field Rep"}</span>
            </button>

            <PWAInstallButton />

            <button
              type="button"
              aria-label="Sign out"
              onClick={handleSignOut}
              className="p-2 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-white"
              title={`Signed in as ${user.fullName}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Outbox Status Banner (shown in Field Rep mode) */}
        {workspaceMode === "rep" && <OutboxStatus />}
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 max-w-sm w-11/12">
          <div
            className={`p-3 rounded-xl shadow-lg border text-xs font-medium flex items-center gap-2.5 ${
              toast.type === "ok"
                ? "bg-emerald-900 text-white border-emerald-800"
                : toast.type === "warn"
                  ? "bg-rose-900 text-white border-rose-800"
                  : "bg-[#7a2e4a] text-white border-[#5a1e34]"
            }`}
          >
            <Check className="w-4 h-4 shrink-0 text-emerald-300" />
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className="p-1 hover:opacity-70 text-white/80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-md md:max-w-5xl w-full mx-auto px-4 py-5 flex-1">
        {workspaceMode === "manager" ? (
          <ManagerDashboard
            showToast={showToast}
            userRole={user.role}
            onApprovedChange={() => {
              void refreshBootstrap();
            }}
          />
        ) : (
          <>
            {/* ================= TAB 1: TODAY ================= */}
            {activeTab === "today" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                  {/* Shift Banner */}
                  <div className="bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-4 shadow-xs flex flex-col justify-between gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                          Salaam, {user.fullName}
                        </h2>
                        <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                          {user.territory} · {user.email}
                        </div>
                      </div>

                      <span
                        className={`text-xs font-semibold shrink-0 ${
                          dayOpen
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {dayOpen ? "Shift Open" : "Day Not Started"}
                      </span>
                    </div>

                    <div className="pt-3 border-t border-[#e6dfdb]/60 dark:border-[#3a3330]">
                      {!dayOpen ? (
                        <button
                          type="button"
                          onClick={() => setShowCheckInModal(true)}
                          className="w-full h-12 rounded-xl bg-[#7a2e4a] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs hover:opacity-95 transition"
                        >
                          <CalendarCheck className="w-4 h-4" />
                          <span>Check In & Count Bag Stock</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs">
                            <span className="text-[#6b625e] dark:text-[#a59b96]">Current Bag:</span>{" "}
                            <strong className="text-sm tabular-nums text-[#1d1a19] dark:text-[#f2eeec]">
                              {bagCount} units
                            </strong>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowCheckOutModal(true)}
                            className="px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          >
                            End Day (Daily Close)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Rep Monthly Target Card */}
                  <RepMonth stats={monthlyStats} />
                </div>

                {/* Quick Actions Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab("route")}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center mb-2">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">Today's Route</div>
                    <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      {route.filter((r) => r.status === "pending").length} stops remaining
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("orders")}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 flex items-center justify-center mb-2">
                      <Package className="w-4 h-4" />
                    </div>
                    <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">Deliveries</div>
                    <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      {orders.filter((o) => o.status === "pending_delivery").length} awaiting signature
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowNewSalonModal(true)}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mb-2">
                      <Plus className="w-4 h-4" />
                    </div>
                    <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">New Prospect</div>
                    <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">Add salon offline</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("outbox")}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 flex items-center justify-center mb-2">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">Outbox Queue</div>
                    <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      {pendingItems.length} items waiting
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ================= TAB 2: ROUTE ================= */}
            {activeTab === "route" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                      Today's Scheduled Route
                    </h2>
                    <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      Karachi Central & South · {route.length} stops · Week 2 Cycle
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {route.map((stop) => (
                    <div
                      key={stop.id}
                      className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full bg-[#7a2e4a] text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                          {stop.stop_number}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                            {stop.salon_name}
                          </h4>
                          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">{stop.area}</p>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] mt-1 text-[#6b625e] dark:text-[#a59b96]">
                            <span className="capitalize">{stop.due_reason.replace("_", " ")}</span>
                            <span>·</span>
                            <span
                              className={
                                stop.status === "visited"
                                  ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                                  : ""
                              }
                            >
                              {stop.status === "visited" ? "Visited" : "Pending"}
                            </span>
                            {stop.balance > 0 && (
                              <>
                                <span>·</span>
                                <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                                  Due: PKR {stop.balance.toLocaleString()}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSalonId(stop.salon_id);
                          setActiveTab("salons");
                        }}
                        className="px-3.5 py-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c] shrink-0"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>

                {/* Lost Demand Quick Capture */}
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-300/40 text-xs space-y-2">
                  <div className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Customer Asked for Unstocked Item? (Lost Demand)</span>
                  </div>
                  <p className="text-[#6b625e] dark:text-[#a59b96]">
                    Tap below to record missed product requests directly to the demand ledger.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      const id = `dem-${Date.now()}`;
                      const res = await submit({
                        id,
                        fn: "record_demand",
                        args: {
                          p_id: id,
                          p_sku_name: "Kiran Brazilian Keratin 1L",
                          p_qty: 2,
                          p_at_client: new Date().toISOString(),
                        },
                        label: "Lost Demand: 2x Keratin 1L",
                        salonId: null,
                        capturedAt: new Date().toISOString(),
                      });
                      showToast(
                        res === "queued"
                          ? "Lost demand queued offline."
                          : "Lost demand captured for inventory planning.",
                        "ok",
                      );
                    }}
                    className="w-full md:w-auto px-4 py-2.5 rounded-xl bg-amber-600 text-white font-semibold text-xs hover:bg-amber-700"
                  >
                    Log 2x Keratin 1L Request
                  </button>
                </div>
              </div>
            )}

            {/* ================= TAB 3: SALONS (ROSTER & DETAIL) ================= */}
            {activeTab === "salons" && (
              <div className="space-y-4">
                {selectedSalonId && currentSalon ? (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setSelectedSalonId(null)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:underline"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Salons Roster</span>
                    </button>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Salon Header Card */}
                      <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                              {currentSalon.name}
                            </h3>
                            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                              {currentSalon.address}
                            </p>
                          </div>
                          <span className="text-xs font-bold uppercase text-[#7a2e4a] dark:text-[#d77a9c] shrink-0">
                            {currentSalon.stage}
                          </span>
                        </div>

                        <div className="pt-2.5 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-[#6b625e] dark:text-[#a59b96]">Contact:</span>{" "}
                            <strong>{currentSalon.contact_person}</strong>
                          </div>
                          <div>
                            <span className="text-[#6b625e] dark:text-[#a59b96]">Phone:</span>{" "}
                            <a
                              href={`tel:${currentSalon.phone}`}
                              className="text-[#7a2e4a] dark:text-[#d77a9c] font-medium"
                            >
                              {currentSalon.phone}
                            </a>
                          </div>
                          <div>
                            <span className="text-[#6b625e] dark:text-[#a59b96]">Balance Due:</span>{" "}
                            <strong className="text-rose-600 dark:text-rose-400 tabular-nums">
                              PKR {currentSalon.outstanding_balance.toLocaleString()}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[#6b625e] dark:text-[#a59b96]">Credit Limit:</span>{" "}
                            <strong className="tabular-nums">
                              PKR {currentSalon.credit_limit.toLocaleString()}
                            </strong>
                          </div>
                        </div>

                        {/* Field Action Buttons */}
                        <div className="grid grid-cols-3 gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setShowVisitModal(true)}
                            className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                          >
                            <UserCheck className="w-5 h-5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                            <span className="text-xs font-semibold">Log Visit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowPaymentModal(true)}
                            className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                          >
                            <Coins className="w-5 h-5 text-emerald-600" />
                            <span className="text-xs font-semibold">Receive Cash</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowCardModal(true)}
                            className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                          >
                            <FileText className="w-5 h-5 text-indigo-600" />
                            <span className="text-xs font-semibold">Take Order</span>
                          </button>
                        </div>
                      </div>

                      {/* Live Activity History */}
                      <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm">Salon Ledger & Visits</h4>
                          <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                            Last visit: {currentSalon.last_visited_at ? when(currentSalon.last_visited_at) : "None"}
                          </span>
                        </div>

                        {loadingActivity ? (
                          <div className="py-6 text-center text-xs text-[#6b625e]">Loading history...</div>
                        ) : !salonActivity ||
                          (salonActivity.visits.length === 0 &&
                            salonActivity.payments.length === 0 &&
                            salonActivity.orderCards.length === 0) ? (
                          <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                            No synced visits, payments, or order cards for this salon yet.
                          </div>
                        ) : (
                          <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs max-h-64 overflow-y-auto">
                            {salonActivity.payments.map((p) => (
                              <div key={p.id} className="py-2 flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    Cash Payment
                                  </div>
                                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                    {when(p.capturedAt)}
                                  </div>
                                </div>
                                <span className="font-bold tabular-nums">
                                  PKR {p.amount.toLocaleString()}
                                </span>
                              </div>
                            ))}
                            {salonActivity.orderCards.map((c) => (
                              <div key={c.id} className="py-2 flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-semibold">
                                    Order Card: {c.qty}x {c.skuName}
                                  </div>
                                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                    {when(c.capturedAt)} · {c.status.replace("_", " ")}
                                  </div>
                                </div>
                                <span className="font-bold tabular-nums">
                                  PKR {c.totalAmount.toLocaleString()}
                                </span>
                              </div>
                            ))}
                            {salonActivity.visits.map((v) => (
                              <div key={v.id} className="py-2 space-y-0.5">
                                <div className="font-semibold">
                                  Field Visit {v.lat !== null ? `(${v.lat}, ${v.lng})` : ""}
                                </div>
                                {v.notes && (
                                  <p className="text-[#6b625e] dark:text-[#a59b96]">{v.notes}</p>
                                )}
                                <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                  {when(v.capturedAt)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Recent Confirmed Orders (Last 5) */}
                    {(() => {
                      const recentConfirmedOrders = (
                        salonActivity
                          ? salonActivity.recentOrders
                          : orders.filter((o) => o.salon_id === currentSalon.id)
                      ).slice(0, 5);

                      return (
                        <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Package className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                              <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                                Recent Orders
                              </h4>
                            </div>
                            <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                              Last 5 confirmed orders
                            </span>
                          </div>

                          {loadingActivity ? (
                            <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                              Loading recent orders...
                            </div>
                          ) : recentConfirmedOrders.length === 0 ? (
                            <div className="py-6 text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                              No confirmed orders for this salon yet.
                            </div>
                          ) : (
                            <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs">
                              {recentConfirmedOrders.map((order) => {
                                const timestamp = order.delivered_at || order.created_at;
                                return (
                                  <div
                                    key={order.id}
                                    className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                  >
                                    <div className="space-y-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono text-[11px] font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
                                          {order.order_number}
                                        </span>
                                        <span
                                          className={`text-[11px] font-semibold ${
                                            order.status === "delivered"
                                              ? "text-emerald-700 dark:text-emerald-400"
                                              : "text-amber-700 dark:text-amber-300"
                                          }`}
                                        >
                                          {order.status === "delivered" ? "Delivered" : "Confirmed · Pending Delivery"}
                                        </span>
                                      </div>

                                      <div className="text-[#6b625e] dark:text-[#a59b96] truncate">
                                        {order.items.map((it) => `${it.qty}x ${it.sku_name}`).join(" · ")}
                                      </div>

                                      {timestamp && (
                                        <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                          {order.status === "delivered" ? "Delivered" : "Confirmed"} {when(timestamp)}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                                      <span className="font-bold text-xs tabular-nums text-[#7a2e4a] dark:text-[#d77a9c]">
                                        PKR {order.total_amount.toLocaleString()}
                                      </span>
                                      {order.status === "pending_delivery" && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveTab("orders");
                                            setSigningOrderId(order.id);
                                          }}
                                          className="px-2.5 py-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-[11px] font-semibold hover:border-[#7a2e4a]"
                                        >
                                          Deliver
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                          Salons Roster
                        </h2>
                        <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                          {filteredSalons.length} salons in Karachi territory
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowNewSalonModal(true)}
                        className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>New Prospect</span>
                      </button>
                    </div>

                    <div className="flex flex-col md:flex-row gap-2.5 md:items-center md:justify-between">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-[#6b625e]" />
                        <input
                          type="text"
                          aria-label="Search salons"
                          placeholder="Search salon name or area..."
                          value={salonSearch}
                          onChange={(e) => setSalonSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs">
                        {(["all", "vip", "regular", "trial", "prospect"] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setSalonFilter(st)}
                            className={`px-3 py-1.5 rounded-lg capitalize whitespace-nowrap transition-colors ${
                              salonFilter === st
                                ? "bg-[#7a2e4a] text-white font-semibold"
                                : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {filteredSalons.map((salon) => (
                        <button
                          key={salon.id}
                          type="button"
                          onClick={() => setSelectedSalonId(salon.id)}
                          className="w-full text-left p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs hover:border-[#7a2e4a] transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                                {salon.name}
                              </h4>
                              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                                {salon.area}
                              </p>
                            </div>
                            <span className="text-[11px] font-bold uppercase text-[#7a2e4a] dark:text-[#d77a9c] shrink-0">
                              {salon.stage}
                            </span>
                          </div>

                          <div className="mt-2.5 pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex items-center justify-between text-xs">
                            <span className="text-[#6b625e] dark:text-[#a59b96]">
                              {salon.contact_person}
                            </span>
                            {salon.outstanding_balance > 0 ? (
                              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                                Due: PKR {salon.outstanding_balance.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                Cleared
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ================= TAB 3.5: PUBLIC SHOP (khsalon.com) ================= */}
            {activeTab === "shop" && (
              <StorefrontView
                onOpenSalonOrderModal={(prodName) => {
                  const targetSalon = salons[0]?.id || "sal-clifton-01";
                  setSelectedSalonId(targetSalon);
                  const matchedSku = skus.find((k) =>
                    prodName.toLowerCase().includes(k.category.toLowerCase()) ||
                    k.name.toLowerCase().includes(prodName.split(" ")[0].toLowerCase()),
                  );
                  if (matchedSku) setSelectedSkuId(matchedSku.id);
                  setShowCardModal(true);
                }}
                showToast={showToast}
              />
            )}

            {/* ================= TAB 4: ORDERS & DELIVERIES ================= */}
            {activeTab === "orders" && (
              <div className="space-y-4">
                {(() => {
                  const query = deliverySearch.trim().toLowerCase();
                  const searchedOrders = query
                    ? orders.filter(
                        (o) =>
                          o.order_number.toLowerCase().includes(query) ||
                          o.id.toLowerCase().includes(query) ||
                          o.salon_name.toLowerCase().includes(query),
                      )
                    : orders;

                  const allCount = searchedOrders.length;
                  const pendingCount = searchedOrders.filter(
                    (o) => o.status === "pending_delivery",
                  ).length;
                  const deliveredCount = searchedOrders.filter(
                    (o) => o.status === "delivered",
                  ).length;
                  const filteredOrders =
                    deliveryFilter === "all"
                      ? searchedOrders
                      : searchedOrders.filter((o) => o.status === deliveryFilter);

                  const isManager = user.role === "manager";
                  const visiblePendingOrders = filteredOrders.filter(
                    (o) => o.status === "pending_delivery",
                  );
                  const visiblePendingIds = visiblePendingOrders.map((o) => o.id);
                  const pendingOrderIdSet = new Set(
                    orders.filter((o) => o.status === "pending_delivery").map((o) => o.id),
                  );
                  const activeSelectedIds = selectedDeliveryIds.filter((id) =>
                    pendingOrderIdSet.has(id),
                  );
                  const activeSelectedSet = new Set(activeSelectedIds);
                  const allVisiblePendingSelected =
                    visiblePendingIds.length > 0 &&
                    visiblePendingIds.every((id) => activeSelectedSet.has(id));
                  const someVisiblePendingSelected = visiblePendingIds.some((id) =>
                    activeSelectedSet.has(id),
                  );

                  const toggleSelectOrder = (orderId: string) => {
                    setSelectedDeliveryIds((prev) =>
                      prev.includes(orderId)
                        ? prev.filter((id) => id !== orderId)
                        : [...prev, orderId],
                    );
                  };

                  const toggleSelectAllVisiblePending = () => {
                    if (visiblePendingIds.length === 0) return;
                    if (allVisiblePendingSelected) {
                      const visibleSet = new Set(visiblePendingIds);
                      setSelectedDeliveryIds((prev) => prev.filter((id) => !visibleSet.has(id)));
                    } else {
                      setSelectedDeliveryIds((prev) =>
                        Array.from(new Set([...prev, ...visiblePendingIds])),
                      );
                    }
                  };

                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                            Deliveries & Customer Signatures
                          </h2>
                          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                            Deliver goods with customer-signed digital acknowledgement
                          </p>
                        </div>

                        {!signingOrderId && (
                          <div className="flex flex-wrap items-center gap-2">
                            {deliveryViewMode === "list" && (
                              <div
                                role="group"
                                aria-label="Filter delivery orders by status"
                                className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#f1eae6] dark:bg-[#2a2523] border border-[#e6dfdb] dark:border-[#3a3330]"
                              >
                                {(
                                  [
                                    { id: "all", label: `All (${allCount})` },
                                    { id: "pending_delivery", label: `Pending (${pendingCount})` },
                                    { id: "delivered", label: `Delivered (${deliveredCount})` },
                                  ] as const
                                ).map((opt) => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    aria-pressed={deliveryFilter === opt.id}
                                    onClick={() => setDeliveryFilter(opt.id)}
                                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors tabular-nums ${
                                      deliveryFilter === opt.id
                                        ? "bg-white dark:bg-[#171413] text-[#7a2e4a] dark:text-[#d77a9c] shadow-xs"
                                        : "text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}

                            <button
                              type="button"
                              aria-pressed={deliveryViewMode === "map"}
                              onClick={() =>
                                setDeliveryViewMode((prev) => (prev === "list" ? "map" : "list"))
                              }
                              className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                                deliveryViewMode === "map"
                                  ? "bg-[#7a2e4a] text-white border-[#7a2e4a]"
                                  : "bg-white dark:bg-[#211d1b] border-[#e6dfdb] dark:border-[#3a3330] text-[#1d1a19] dark:text-[#f2eeec] hover:border-[#7a2e4a]"
                              }`}
                            >
                              {deliveryViewMode === "map" ? (
                                <>
                                  <List className="w-3.5 h-3.5" />
                                  <span>List View</span>
                                </>
                              ) : (
                                <>
                                  <MapPin className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                                  <span className="tabular-nums">Map View ({pendingCount})</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {!signingOrderId && (
                        <div className="space-y-2.5">
                          <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-3 text-[#6b625e]" />
                            <input
                              type="text"
                              aria-label="Search deliveries"
                              placeholder="Search order ID or salon name..."
                              value={deliverySearch}
                              onChange={(e) => setDeliverySearch(e.target.value)}
                              className="w-full min-h-[40px] pl-9 pr-9 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b] text-[#1d1a19] dark:text-[#f2eeec]"
                            />
                            {deliverySearch && (
                              <button
                                type="button"
                                aria-label="Clear delivery search"
                                onClick={() => setDeliverySearch("")}
                                className="absolute right-2 top-1.5 p-1.5 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-white"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {isManager && deliveryViewMode === "list" && (
                            <DeliveryBulkBar
                              checkboxId="rep-deliveries-select-all"
                              visiblePendingCount={visiblePendingIds.length}
                              selectedCount={activeSelectedIds.length}
                              allVisiblePendingSelected={allVisiblePendingSelected}
                              someVisiblePendingSelected={someVisiblePendingSelected}
                              onToggleSelectAll={toggleSelectAllVisiblePending}
                              onMarkSelectedDelivered={() =>
                                setBulkConfirmOrders(
                                  orders.filter(
                                    (o) =>
                                      o.status === "pending_delivery" &&
                                      activeSelectedSet.has(o.id),
                                  ),
                                )
                              }
                            />
                          )}
                        </div>
                      )}

                      {signingOrderId ? (
                        <div className="max-w-lg p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                              Customer Signature
                            </h3>
                            <button
                              type="button"
                              aria-label="Cancel signature"
                              onClick={() => setSigningOrderId(null)}
                              className="p-1 text-[#6b625e]"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {(() => {
                            const ord = orders.find((o) => o.id === signingOrderId);
                            return ord ? (
                              <SignaturePad
                                salonName={ord.salon_name}
                                onCapture={handleConfirmDeliverySignature}
                              />
                            ) : null;
                          })()}
                        </div>
                      ) : deliveryViewMode === "map" ? (
                        <DeliveryMapView
                          orders={searchedOrders}
                          salons={salons}
                          onSelectDeliver={(orderId) => {
                            setDeliveryViewMode("list");
                            setSigningOrderId(orderId);
                          }}
                          onViewReceipt={(o) => setReceiptOrder(o)}
                          onSwitchToList={() => setDeliveryViewMode("list")}
                        />
                      ) : filteredOrders.length === 0 ? (
                        <div className="p-8 rounded-2xl bg-white dark:bg-[#211d1b] border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center space-y-2.5">
                          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                            {query
                              ? `No delivery orders matching "${deliverySearch.trim()}".`
                              : deliveryFilter === "delivered"
                                ? "No delivered orders yet."
                                : deliveryFilter === "pending_delivery"
                                  ? "No pending delivery orders."
                                  : "No delivery orders available."}
                          </p>
                          <div className="flex items-center justify-center gap-2">
                            {query && (
                              <button
                                type="button"
                                onClick={() => setDeliverySearch("")}
                                className="px-3.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a]"
                              >
                                Clear Search
                              </button>
                            )}
                            {deliveryFilter !== "all" && (
                              <button
                                type="button"
                                onClick={() => setDeliveryFilter("all")}
                                className="px-3.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a]"
                              >
                                Show All Orders
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {filteredOrders.map((order) => {
                            const isPending = order.status === "pending_delivery";
                            const isSelected = isPending && activeSelectedSet.has(order.id);
                            return (
                              <div
                                key={order.id}
                                className={`p-4 rounded-2xl bg-white dark:bg-[#211d1b] border shadow-xs space-y-2.5 flex flex-col justify-between transition-colors ${
                                  isSelected
                                    ? "border-[#7a2e4a] dark:border-[#d77a9c]"
                                    : "border-[#e6dfdb] dark:border-[#3a3330]"
                                }`}
                              >
                                <div className="space-y-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2 min-w-0">
                                      {isManager && isPending && (
                                        <label
                                          aria-label={`Select order ${order.order_number}`}
                                          className="min-h-[36px] min-w-[28px] -ml-1 flex items-center justify-center cursor-pointer shrink-0"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelectOrder(order.id)}
                                            className="w-4 h-4 rounded accent-[#7a2e4a] cursor-pointer"
                                          />
                                        </label>
                                      )}
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-[11px] font-mono text-[#6b625e] dark:text-[#a59b96]">
                                            {order.order_number}
                                          </span>
                                          <span
                                            className={`text-xs font-semibold shrink-0 ${
                                              order.status === "delivered"
                                                ? "text-emerald-700 dark:text-emerald-400"
                                                : "text-amber-700 dark:text-amber-300"
                                            }`}
                                          >
                                            {order.status === "delivered"
                                              ? "Delivered"
                                              : "Pending Delivery"}
                                          </span>
                                        </div>
                                        <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] mt-0.5 truncate">
                                          {order.salon_name}
                                        </h4>
                                      </div>
                                    </div>

                                    <DeliveryQuickActionsMenu
                                      order={order}
                                      isOpen={openActionMenuOrderId === order.id}
                                      onToggle={() =>
                                        setOpenActionMenuOrderId((prev) =>
                                          prev === order.id ? null : order.id,
                                        )
                                      }
                                      onClose={() => setOpenActionMenuOrderId(null)}
                                      onViewReceipt={(o) => setReceiptOrder(o)}
                                      onResendNotification={handleResendDeliveryNotification}
                                      onRequestMarkDelivered={(o) => setConfirmDeliverOrder(o)}
                                      canMarkDelivered={isManager}
                                      isNotifying={notifyingOrderId === order.id}
                                    />
                                  </div>

                                <div className="text-xs space-y-1 bg-[#faf7f5] dark:bg-[#171413] p-3 rounded-xl border border-[#e6dfdb]/60 dark:border-[#3a3330]">
                                  {order.items.map((it, idx) => (
                                    <div key={idx} className="flex justify-between gap-2">
                                      <span>
                                        {it.qty}x {it.sku_name}
                                      </span>
                                      <span className="tabular-nums font-medium shrink-0">
                                        PKR {(it.qty * it.price).toLocaleString()}
                                      </span>
                                    </div>
                                  ))}
                                  <div className="pt-1.5 border-t border-[#e6dfdb] dark:border-[#3a3330] flex justify-between font-bold">
                                    <span>Invoice Total</span>
                                    <span className="text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                                      PKR {order.total_amount.toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="pt-1">
                                {order.status === "pending_delivery" ? (
                                  <button
                                    type="button"
                                    onClick={() => setSigningOrderId(order.id)}
                                    className="w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs hover:opacity-95"
                                  >
                                    <ShieldCheck className="w-4 h-4" />
                                    <span>Deliver & Capture Salon Signature</span>
                                  </button>
                                ) : (
                                  <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                    <Check className="w-4 h-4 shrink-0" />
                                    <span>
                                      Delivered {when(order.delivered_at || "")}{" "}
                                      {order.signature_data
                                        ? "with signed acknowledgement."
                                        : "confirmed by Owner / Manager."}
                                    </span>
                                  </div>
                                )}
                              </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* ================= TAB 5: OUTBOX INSPECTOR ================= */}
            {activeTab === "outbox" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                      Offline Outbox Queue
                    </h2>
                    <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      AES-GCM encrypted IndexedDB queue synced to backend RPCs
                    </p>
                  </div>

                  {confirmWipe ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={async () => {
                          await wipeLocalData();
                          setItems([]);
                          setHistoryItems([]);
                          setConfirmWipe(false);
                          showToast("Outbox queue wiped.", "warn");
                        }}
                        className="px-2.5 py-1.5 bg-rose-600 text-white rounded-lg font-semibold"
                      >
                        Confirm Wipe
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmWipe(false)}
                        className="px-2.5 py-1.5 border border-[#e6dfdb] dark:border-[#3a3330] rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmWipe(true)}
                      className="px-3 py-1.5 text-xs text-rose-600 border border-rose-200 dark:border-rose-900 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      Wipe Local
                    </button>
                  )}
                </div>

                {/* Offline Simulation Control Card */}
                <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label htmlFor="sim-offline-toggle" className="font-bold text-xs cursor-pointer">
                        Simulated Network Disconnect
                      </label>
                      <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                        Toggle to test offline queueing without disabling actual device Wi-Fi
                      </div>
                    </div>
                    <input
                      id="sim-offline-toggle"
                      type="checkbox"
                      checked={isOffline()}
                      onChange={(e) => setSimulatedOffline(e.target.checked)}
                      className="w-5 h-5 accent-[#7a2e4a] cursor-pointer"
                    />
                  </div>

                  <div className="pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={async () => {
                        const id = `tst-${Date.now()}`;
                        await submit({
                          id,
                          fn: "log_visit",
                          args: { p_id: id, p_salon_id: "sal-clifton-01", p_notes: "Sample field visit" },
                          label: "Test Field Visit",
                          salonId: "sal-clifton-01",
                          capturedAt: new Date().toISOString(),
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 font-medium hover:bg-black/10"
                    >
                      + Enqueue Visit
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const id = `tst-pay-${Date.now()}`;
                        await submit({
                          id,
                          fn: "rep_record_payment",
                          args: { p_id: id, p_salon_id: "sal-dha-02", p_amount: 5000 },
                          label: "Test Payment PKR 5,000",
                          salonId: "sal-dha-02",
                          capturedAt: new Date().toISOString(),
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 font-medium hover:bg-black/10"
                    >
                      + Enqueue Cash PKR 5k
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const id = `ref-${Date.now()}`;
                        await submit({
                          id,
                          fn: "rep_check_in",
                          args: { p_id: id, p_bag_count: -1, p_fail: true },
                          label: "Invalid Bag Count (Triggers Refusal)",
                          salonId: null,
                          capturedAt: new Date().toISOString(),
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg text-rose-700 bg-rose-50 dark:bg-rose-950/40 font-medium"
                    >
                      + Test Refusal
                    </button>
                  </div>
                </div>

                {/* Queue Item List */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#6b625e] dark:text-[#a59b96]">
                    Queue Items ({items.length})
                  </h3>

                  {items.length === 0 ? (
                    <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                      Outbox is clear. All captured actions have drained and synced to the database.
                    </div>
                  ) : (
                    items.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-bold text-[#1d1a19] dark:text-[#f2eeec]">
                            <span className="tabular-nums">#{item.seq}</span>
                            <span>{item.label}</span>
                          </div>
                          <span
                            className={`text-xs font-semibold uppercase ${
                              item.state === "pending"
                                ? "text-amber-700 dark:text-amber-300"
                                : "text-rose-700 dark:text-rose-400"
                            }`}
                          >
                            {item.state}
                          </span>
                        </div>

                        <div className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96] truncate">
                          RPC: {item.fn} · Captured: {when(item.capturedAt)}
                        </div>

                        {item.error && (
                          <div className="text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 p-2 rounded text-[11px]">
                            {item.error}
                          </div>
                        )}

                        {outboxState.transmittingIds?.includes(item.id) && (
                          <div className="space-y-1 py-1">
                            <div className="flex items-center justify-between text-[10px] font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                              <span className="flex items-center gap-1">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Transmitting to server...
                              </span>
                              <span>{outboxState.activeProgress?.[item.id] ?? 50}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#e6dfdb] dark:bg-[#3a3330] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#7a2e4a] dark:bg-[#d77a9c] transition-all duration-300 ease-out"
                                style={{ width: `${outboxState.activeProgress?.[item.id] ?? 50}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="pt-1 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => discardItem(item.id)}
                            disabled={outboxState.transmittingIds?.includes(item.id)}
                            className="px-2.5 py-1 text-rose-600 hover:underline disabled:opacity-40"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            onClick={() => retryItem(item.id)}
                            disabled={outboxState.transmittingIds?.includes(item.id)}
                            className="px-3 py-1 bg-[#7a2e4a] text-white rounded-lg font-medium disabled:opacity-40 flex items-center gap-1"
                          >
                            {outboxState.transmittingIds?.includes(item.id) ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Transmitting...</span>
                              </>
                            ) : (
                              <span>Retry</span>
                            )}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Transmission History */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-[#6b625e] dark:text-[#a59b96]">
                      <History className="w-3.5 h-3.5" />
                      <span>Recent Transmission History ({historyItems.length})</span>
                    </div>
                    <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                      Last 50 transmission attempts
                    </span>
                  </div>

                  {historyItems.length === 0 ? (
                    <div className="p-6 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                      No transmission attempts recorded yet. Queued actions record their latency, server acknowledgment, and error states here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {historyItems.map((attempt) => (
                        <div
                          key={attempt.id}
                          className="p-3 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec] truncate">
                              {attempt.label}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                attempt.result === "sent"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : attempt.result === "offline"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                  : attempt.result === "auth"
                                  ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                              }`}
                            >
                              {attempt.result} · {attempt.durationMs}ms
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                            <span className="font-mono">RPC: {attempt.fn}</span>
                            <span>{when(new Date(attempt.at).toISOString())}</span>
                          </div>

                          {attempt.message && (
                            <div className="p-2 rounded-lg bg-black/5 dark:bg-white/5 font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96] break-all">
                              {attempt.message}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ================= MODALS ================= */}

      {/* 1. Check-In Modal */}
      {showCheckInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
              Morning Bag Stock Count
            </h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Count physical retail tubes, serums and shampoos in your shoulder bag before starting salon visits.
            </p>
            <div>
              <label htmlFor="checkin-bag-count" className="block text-xs font-semibold mb-1">
                Total Units Counted:
              </label>
              <input
                id="checkin-bag-count"
                type="number"
                value={bagCount}
                onChange={(e) => setBagCount(Number(e.target.value))}
                className="w-full p-2.5 text-base font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCheckInModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCheckIn(bagCount)}
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
              >
                Confirm Check-In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Check-Out Modal (Daily Close) */}
      {showCheckOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
              Evening Bag Count & Daily Close
            </h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Count remaining unsold units in bag. Variance against deliveries and sales will be calculated automatically.
            </p>
            <div>
              <label htmlFor="checkout-bag-count" className="block text-xs font-semibold mb-1">
                Leftover Units Counted:
              </label>
              <input
                id="checkout-bag-count"
                type="number"
                value={bagCount}
                onChange={(e) => setBagCount(Number(e.target.value))}
                className="w-full p-2.5 text-base font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCheckOutModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCheckOut(bagCount)}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Close Day
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Log Visit Modal */}
      {showVisitModal && currentSalon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
              Log Visit: {currentSalon.name}
            </h3>
            <div>
              <label htmlFor="visit-notes" className="block text-xs font-semibold mb-1">
                Visit Notes / Discussion:
              </label>
              <textarea
                id="visit-notes"
                rows={3}
                placeholder="Discussed keratin smoothing promo, owner interested in 500ml jars..."
                value={visitNotes}
                onChange={(e) => setVisitNotes(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowVisitModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogVisit}
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
              >
                Save Visit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Payment Modal */}
      {showPaymentModal && currentSalon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
              Collect Cash Payment
            </h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Salon: <strong>{currentSalon.name}</strong> (Due: PKR{" "}
              {currentSalon.outstanding_balance.toLocaleString()})
            </p>
            <div>
              <label htmlFor="cash-amount" className="block text-xs font-semibold mb-1">
                Cash Amount (PKR):
              </label>
              <input
                id="cash-amount"
                type="number"
                min={1}
                placeholder="e.g. 15000"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full p-2.5 text-base font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl">
              Saved on this phone; official ledger receipt recorded automatically once synced.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecordPayment}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                Accept PKR Cash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Order Intake Card Modal */}
      {showCardModal && currentSalon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
              Create Order Intake Card
            </h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              For: <strong>{currentSalon.name}</strong>
            </p>
            <div>
              <label htmlFor="order-sku" className="block text-xs font-semibold mb-1">
                Select Product SKU:
              </label>
              <select
                id="order-sku"
                value={selectedSkuId}
                onChange={(e) => setSelectedSkuId(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                {skus.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} (PKR {k.price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="order-qty" className="block text-xs font-semibold mb-1">
                Quantity:
              </label>
              <input
                id="order-qty"
                type="number"
                min={1}
                value={cardQty}
                onChange={(e) => setCardQty(Math.max(1, Number(e.target.value)))}
                className="w-full p-2.5 text-sm font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCardModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCard}
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
              >
                Create Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. New Prospect Salon Modal */}
      {showNewSalonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
            <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
              Register New Salon Prospect
            </h3>
            <div>
              <label htmlFor="new-salon-name" className="block text-xs font-semibold mb-1">
                Salon Name:
              </label>
              <input
                id="new-salon-name"
                type="text"
                placeholder="e.g. Elegance Hair Lounge"
                value={newSalonName}
                onChange={(e) => setNewSalonName(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div>
              <label htmlFor="new-salon-area" className="block text-xs font-semibold mb-1">
                Area / Karachi Zone:
              </label>
              <input
                id="new-salon-area"
                type="text"
                value={newSalonArea}
                onChange={(e) => setNewSalonArea(e.target.value)}
                className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Contact Person & Phone:</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  aria-label="Contact person"
                  placeholder="Owner name"
                  value={newSalonContact}
                  onChange={(e) => setNewSalonContact(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
                <input
                  type="text"
                  aria-label="Phone number"
                  placeholder="0300-..."
                  value={newSalonPhone}
                  onChange={(e) => setNewSalonPhone(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewSalonModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSalon}
                className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
              >
                Save Prospect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Receipt Modal & Owner/Manager Delivered Confirmation Modal */}
      <DeliveryReceiptModal
        order={receiptOrder}
        salon={receiptOrder ? salons.find((s) => s.id === receiptOrder.salon_id) ?? null : null}
        onClose={() => setReceiptOrder(null)}
      />

      <ConfirmDeliveredModal
        order={confirmDeliverOrder}
        isSubmitting={markingDelivered}
        onCancel={() => setConfirmDeliverOrder(null)}
        onConfirm={handleConfirmMarkDelivered}
      />

      <ConfirmBulkDeliveredModal
        orders={bulkConfirmOrders}
        isSubmitting={markingBulkDelivered}
        onCancel={() => setBulkConfirmOrders([])}
        onConfirm={handleConfirmBulkMarkDelivered}
      />

      {/* Fixed Bottom Navigation Anchor (Field Rep mode) */}
      {workspaceMode === "rep" && (
        <BottomNavigation
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          pendingCount={pendingItems.length}
        />
      )}
    </div>
  );
}
