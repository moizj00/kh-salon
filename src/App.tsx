import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  setActiveSessionUser,
  setAuthToken,
  signOutEverywhere,
  submitManagerApproval,
  syncRouteOrderApi,
} from "./lib/api";
import { deviceId } from "./lib/supabase";
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
import { KARACHI_DEFAULT_CENTER } from "./lib/karachi-geo";
import { registerServiceWorker } from "./lib/register-sw";
import { canManageCatalog, getSkuBrand } from "./lib/catalog";
import { filterOrderSkus } from "./lib/order-sku-search";
import { checkOrderIntakeStock, DEFAULT_LOW_STOCK_THRESHOLD } from "./lib/order-stock";
import {
  applyStoredRouteOrder,
  loadPreferredRouteOrder,
  optimizeRouteStops,
  savePreferredRouteOrder,
  type RouteOptimizationResult,
} from "./lib/route-optimizer";
import { SALON_SORT_OPTIONS, sortSalons, type SalonSortKey } from "./lib/salon-sort";
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
import { ProductCatalogDrawer } from "./components/product-catalog-drawer";
import { ProductThumbnail } from "./components/product-thumbnail";
import { PWAInstallButton } from "./components/pwa-install";
import { RepMonth } from "./components/rep-month";
import { SignaturePad, type SignatureCapturePayload } from "./components/signature-pad";
import { StorefrontView } from "./components/storefront";
import { SalonPortal } from "./components/salon-portal";
import { RepOperationsDrawer } from "./components/rep-operations-drawer";
import { ensureUuid } from "./lib/supabase-kiran";
import type {
  DeliveryOrderFull,
  RepMonthlyStats,
  SalonActivityPayload,
  SalonAreaOption,
  SalonWithApproval,
  UserProfile,
} from "./server/types";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Briefcase,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  History,
  List,
  LocateFixed,
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
  visitsCompleted: 0,
  visitsTarget: 50,
  cashCollectedPkr: 0,
  ordersCount: 0,
  monthLabel: "Target",
};

export default function App() {
  // Authentication & Workspace Mode
  const [authReady, setAuthReady] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [salonSessionActive, setSalonSessionActive] = useState(false);
  const [showPublicStorefront, setShowPublicStorefront] = useState(false);
  const [showRepOpsDrawer, setShowRepOpsDrawer] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"rep" | "manager">("rep");

  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [historyItems, setHistoryItems] = useState<SyncAttempt[]>([]);
  const [outboxState, setOutboxState] = useState(syncState());
  const [salons, setSalons] = useState<SalonWithApproval[]>([]);
  const [route, setRoute] = useState<RouteStop[]>([]);
  const [routeOptimization, setRouteOptimization] = useState<RouteOptimizationResult | null>(null);
  const [optimizingRoute, setOptimizingRoute] = useState(false);
  const [orders, setOrders] = useState<DeliveryOrderFull[]>([]);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<RepMonthlyStats>(DEFAULT_STATS);

  // Rep day shift state (one-tap check-in / check-out, no sample bag counts)
  const [dayOpen, setDayOpen] = useState(false);
  const [areas, setAreas] = useState<SalonAreaOption[]>([]);
  const [newSalonAreaId, setNewSalonAreaId] = useState("");

  // Selected salon for details & live activity
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);
  const [salonActivity, setSalonActivity] = useState<SalonActivityPayload | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [salonSearch, setSalonSearch] = useState("");
  const [salonFilter, setSalonFilter] = useState<"all" | "regular" | "vip" | "trial" | "prospect">("all");
  const [salonSort, setSalonSort] = useState<SalonSortKey>("name_asc");

  // Sub-dialogs
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitNotes, setVisitNotes] = useState("");
  const [showCardModal, setShowCardModal] = useState(false);
  const [showCatalogDrawer, setShowCatalogDrawer] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState(INITIAL_SKUS[0]?.id || "");
  const [skuSearchQuery, setSkuSearchQuery] = useState("");
  const [cardQty, setCardQty] = useState(2);
  const [cardNotes, setCardNotes] = useState("");
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
        setRoute(applyStoredRouteOrder(boot.route, loadPreferredRouteOrder()));
        setSkus(boot.skus);
        setOrders(boot.orders);
        setDayOpen(Boolean(boot.activeShift));
        setMonthlyStats(boot.stats);
        if (boot.areas && boot.areas.length > 0) {
          setAreas(boot.areas);
          setNewSalonAreaId((prev) => prev || boot.areas![0]!.id);
          setNewSalonArea((prev) => prev || boot.areas![0]!.name);
        }
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
      let supabaseReady = false;
      try {
        const cfg = await getAuthConfig();
        supabaseReady = Boolean(cfg.supabaseConfigured);
        if (mounted) setAuthConfigured(cfg.authConfigured);
      } catch {
        // Ignore offline config fetch error
      }

      const token = getAuthToken();
      if (token || supabaseReady) {
        try {
          const { user: current } = await getCurrentUser();
          if (mounted && !current.mfaRequired) {
            setUser(current);
            setSessionUserId(current.id);
            setWorkspaceMode(canManageCatalog(current.role) ? "manager" : "rep");
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

  const filteredCardSkus = useMemo(
    () => filterOrderSkus(skus, skuSearchQuery),
    [skus, skuSearchQuery],
  );

  useEffect(() => {
    if (!showCardModal || filteredCardSkus.length === 0) return;
    if (!filteredCardSkus.some((k) => k.id === selectedSkuId)) {
      setSelectedSkuId(filteredCardSkus[0]!.id);
    }
  }, [showCardModal, filteredCardSkus, selectedSkuId]);

  const handleAuthenticated = (authedUser: UserProfile) => {
    setUser(authedUser);
    setSessionUserId(authedUser.id);
    setWorkspaceMode(canManageCatalog(authedUser.role) ? "manager" : "rep");
  };

  const handleSignOut = () => {
    void signOutEverywhere();
    setActiveSessionUser(null);
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
    if (salonSessionActive) {
      return <SalonPortal onSignOut={() => setSalonSessionActive(false)} showToast={showToast} />;
    }
    if (showPublicStorefront) {
      return (
        <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] p-4 max-w-6xl mx-auto">
          <StorefrontView
            onBack={() => setShowPublicStorefront(false)}
            onOpenSalonPortal={() => {
              setShowPublicStorefront(false);
            }}
            showToast={showToast}
          />
        </div>
      );
    }
    return (
      <AuthGate
        authConfigured={authConfigured}
        onAuthenticated={handleAuthenticated}
        onSalonAuthenticated={() => setSalonSessionActive(true)}
        onOpenStorefront={() => setShowPublicStorefront(true)}
      />
    );
  }

  const pendingItems = items.filter((i) => i.state === "pending");
  const currentSalon = salons.find((s) => s.id === selectedSalonId) || null;

  // 1. Check in Rep Day (one-tap check-in, no bag stock counts)
  const handleCheckIn = async () => {
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
          { enableHighAccuracy: false, timeout: 2500, maximumAge: 60000 },
        );
      });
    }

    const id = `chk-${Date.now()}`;
    const res = await submit({
      id,
      fn: "rep_check_in",
      args: {
        p_id: id,
        p_counted: [],
        p_lat: gps?.lat ?? null,
        p_lng: gps?.lng ?? null,
        p_at_client: new Date().toISOString(),
      },
      label: "Day Check-In",
      salonId: null,
      capturedAt: new Date().toISOString(),
    });

    if (res !== "rejected") {
      setDayOpen(true);
    }

    if (res === "queued") {
      showToast("Check-in saved on phone (Offline). Queue updated.", "info");
    } else if (res === "rejected") {
      showToast("Check-in rejected by server. Review Outbox.", "warn");
    } else {
      showToast("Day shift opened.", "ok");
      void refreshBootstrap();
    }
  };

  // 2. Check out Rep Day (Daily Close)
  const handleCheckOut = async () => {
    const closeId = `cls-${Date.now()}`;
    const res = await submit({
      id: closeId,
      fn: "rep_check_out",
      args: {
        p_id: closeId,
        p_at_client: new Date().toISOString(),
      },
      label: "End Day Shift Check-Out",
      salonId: null,
      capturedAt: new Date().toISOString(),
    });

    if (res !== "rejected") {
      setDayOpen(false);
    }

    if (res === "queued") {
      showToast("Daily close saved on phone (Offline). Will drain when online.", "info");
    } else if (res === "rejected") {
      showToast("Daily close rejected by server. Review Outbox.", "warn");
    } else {
      showToast("Day shift closed and recorded.", "ok");
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

  const handleSuggestOptimizedRoute = () => {
    const pendingCount = route.filter((s) => s.status === "pending").length;
    if (pendingCount === 0) {
      showToast("All scheduled stops are already visited.", "info");
      return;
    }

    setOptimizingRoute(true);
    const runWithOrigin = (
      origin: { lat: number; lng: number },
      originSource: "gps" | "depot_fallback",
      originLabel: string,
    ) => {
      const proposal = optimizeRouteStops({
        route,
        salons,
        origin,
        originSource,
        originLabel,
      });
      setRouteOptimization(proposal);
      setOptimizingRoute(false);
      if (!proposal.hasChanges) {
        showToast("Current stop order is already the shortest path.", "info");
      }
    };

    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(5));
          const lng = Number(pos.coords.longitude.toFixed(5));
          runWithOrigin(
            { lat, lng },
            "gps",
            `Current GPS (${lat.toFixed(3)}, ${lng.toFixed(3)})`,
          );
        },
        () => {
          runWithOrigin(
            KARACHI_DEFAULT_CENTER,
            "depot_fallback",
            "Karachi Central Hub (GPS unavailable)",
          );
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 },
      );
    } else {
      runWithOrigin(
        KARACHI_DEFAULT_CENTER,
        "depot_fallback",
        "Karachi Central Hub (GPS unavailable)",
      );
    }
  };

  const handleApplyOptimizedRoute = () => {
    if (!routeOptimization) return;
    setRoute(routeOptimization.optimizedRoute);
    savePreferredRouteOrder(routeOptimization.optimizedRoute);
    void syncRouteOrderApi(routeOptimization.optimizedRoute.map((s) => s.id)).catch(() => undefined);
    const saved = routeOptimization.savedKm;
    const count = routeOptimization.pendingLegs.length;
    setRouteOptimization(null);
    showToast(
      saved > 0
        ? `Route updated · Saves ${saved.toFixed(1)} km across ${count} pending stops.`
        : `Optimized sequence applied across ${count} pending stops.`,
      "ok",
    );
  };

  // 5. Create Order Intake Card
  const handleCreateCard = async () => {
    if (!currentSalon) return;
    const sku = skus.find((k) => k.id === selectedSkuId);
    if (!sku) return;

    const trimmedNotes = cardNotes.trim();
    setShowCardModal(false);
    setCardNotes("");
    setSkuSearchQuery("");
    const id = `crd-${Date.now()}`;
    const res = await submit({
      id,
      fn: "rep_create_card",
      args: {
        p_id: id,
        p_salon_id: currentSalon.id,
        p_sku_id: sku.id,
        p_sku_name: sku.name,
        p_qty: cardQty,
        p_total: sku.price * cardQty,
        p_notes: trimmedNotes || null,
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
    const selectedArea = areas.find((a) => a.id === newSalonAreaId);
    const areaLabel = selectedArea?.name || newSalonArea.trim() || "Karachi";
    const newId = ensureUuid();
    const newRecord: SalonWithApproval = {
      id: newId,
      name: newSalonName.trim(),
      area: areaLabel,
      address: `${areaLabel}, Karachi`,
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
      id: newId,
      fn: "create_salon",
      args: {
        p_id: newId,
        p_name: newRecord.name,
        p_type: "unisex",
        p_area: newRecord.area,
        p_area_id: newSalonAreaId || undefined,
        p_phone: newRecord.phone,
        p_contact: newRecord.contact_person,
        p_at_client: new Date().toISOString(),
      },
      label: `New Prospect: ${newRecord.name}`,
      salonId: newId,
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
  const handleConfirmDeliverySignature = async (payload: SignatureCapturePayload) => {
    if (!signingOrderId) return;
    const order = orders.find((o) => o.id === signingOrderId);
    if (!order) return;

    setSigningOrderId(null);

    const deliveryId = ensureUuid();
    const resDelivery = await submit({
      id: deliveryId,
      fn: "rep_submit_delivery",
      args: {
        p_client_id: deliveryId,
        p_order_id: ensureUuid(order.id),
        p_salon_id: ensureUuid(order.salon_id),
        p_received_by_name: payload.signatoryName,
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

    const sigId = ensureUuid();
    const resSig = await submit({
      id: sigId,
      fn: "rep_attach_signature",
      args: {
        p_client_id: sigId,
        p_submission_id: deliveryId,
        p_outcome: payload.outcome,
        p_name: payload.signatoryName,
        p_designation: payload.designation,
        p_png_base64: payload.dataUrl,
        p_note: payload.note || null,
        p_at_client: new Date().toISOString(),
      },
      label: `Signature for ${order.order_number} (${payload.outcome})`,
      salonId: order.salon_id,
      capturedAt: new Date().toISOString(),
      dependsOn: { itemId: deliveryId, argName: "p_submission_id" },
    });

    if (resSig !== "rejected") {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                status: "delivered",
                delivered_at: new Date().toISOString(),
                signature_data: payload.dataUrl || payload.outcome,
              }
            : o,
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
  const sortedSalons = sortSalons(filteredSalons, salonSort);

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
            {canManageCatalog(user.role) && (
              <button
                type="button"
                onClick={() => setWorkspaceMode(workspaceMode === "rep" ? "manager" : "rep")}
                className="px-3 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] whitespace-nowrap"
              >
                <Briefcase className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>{workspaceMode === "rep" ? "Office Manager" : "Field Rep"}</span>
              </button>
            )}

            {workspaceMode === "rep" && (
              <button
                type="button"
                onClick={() => setShowRepOpsDrawer(true)}
                className="px-3 py-1.5 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1.5 hover:border-[#7a2e4a] whitespace-nowrap"
              >
                <Package className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Bag &amp; Commission</span>
              </button>
            )}

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
        {(user.deviceStatus === "pending" || user.deviceStatus === "revoked") && (
          <div
            role="status"
            className="mb-4 p-3.5 rounded-2xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2"
          >
            <div className="space-y-0.5 min-w-0">
              <div className="font-bold">
                {user.deviceStatus === "revoked"
                  ? "Device Access Revoked"
                  : "Browser Device Pending Manager Approval"}
              </div>
              <div className="text-[11px] opacity-90">
                Device ID <span className="font-mono">{deviceId()}</span> must be approved by an Office Manager or Owner in Supabase before protected writes sync.
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { user: refreshed } = await getCurrentUser();
                  setUser(refreshed);
                  void refreshBootstrap();
                  showToast("Device status refreshed.", "info");
                } catch {
                  showToast("Could not refresh device status.", "warn");
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-900 text-white text-xs font-semibold shrink-0"
            >
              Refresh Status
            </button>
          </div>
        )}

        {workspaceMode === "manager" && canManageCatalog(user.role) ? (
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
                          onClick={handleCheckIn}
                          className="w-full h-12 rounded-xl bg-[#7a2e4a] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs hover:opacity-95 transition"
                        >
                          <CalendarCheck className="w-4 h-4" />
                          <span>Check In &amp; Start Day</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>Shift Open · Active Today</span>
                          </div>
                          <button
                            type="button"
                            onClick={handleCheckOut}
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                      Today's Scheduled Route
                    </h2>
                    <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      Karachi Central &amp; South · {route.length} stops · Week 2 Cycle
                    </p>
                  </div>

                  <button
                    type="button"
                    data-testid="optimize-route-btn"
                    onClick={handleSuggestOptimizedRoute}
                    disabled={optimizingRoute}
                    className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:opacity-95 disabled:opacity-60"
                  >
                    <LocateFixed className={`w-3.5 h-3.5 ${optimizingRoute ? "animate-pulse" : ""}`} />
                    <span>{optimizingRoute ? "Locating..." : "Optimize Route (GPS)"}</span>
                  </button>
                </div>

                {routeOptimization && (
                  <div
                    role="region"
                    aria-label="Suggested shortest-path route"
                    data-testid="route-optimization-suggestion"
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#7a2e4a]/40 dark:border-[#d77a9c]/40 shadow-xs space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec] flex items-center gap-1.5">
                          <LocateFixed className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c] shrink-0" />
                          <span>
                            {routeOptimization.hasChanges
                              ? "Suggested Shortest-Path Sequence"
                              : "Current Route Is Already Optimal"}
                          </span>
                        </div>
                        <p className="text-xs text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                          From {routeOptimization.originLabel} ·{" "}
                          {routeOptimization.hasChanges ? (
                            <>
                              Current {routeOptimization.originalPendingDistanceKm.toFixed(1)} km{" "}
                              <span aria-hidden="true">→</span>{" "}
                              <strong className="text-emerald-700 dark:text-emerald-400">
                                {routeOptimization.optimizedPendingDistanceKm.toFixed(1)} km
                              </strong>
                              {routeOptimization.savedKm > 0 && (
                                <> · Saves {routeOptimization.savedKm.toFixed(1)} km ({routeOptimization.savedPct}%)</>
                              )}
                            </>
                          ) : (
                            <>Total pending distance: {routeOptimization.optimizedPendingDistanceKm.toFixed(1)} km</>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setRouteOptimization(null)}
                          className="px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] whitespace-nowrap shrink-0"
                        >
                          Dismiss
                        </button>
                        {routeOptimization.hasChanges && (
                          <button
                            type="button"
                            data-testid="apply-optimized-route-btn"
                            onClick={handleApplyOptimizedRoute}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Apply Optimized Order</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      {routeOptimization.pendingLegs.map((leg, idx) => (
                        <li
                          key={leg.stop.id}
                          className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] flex items-start gap-2"
                        >
                          <span className="w-5 h-5 rounded-full bg-[#7a2e4a] text-white font-bold text-[11px] flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#1d1a19] dark:text-[#f2eeec] truncate">
                              {leg.stop.salon_name}
                            </div>
                            <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] tabular-nums">
                              +{leg.legDistanceKm.toFixed(1)} km · Total {leg.cumulativeDistanceKm.toFixed(1)} km
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="todays-route-stops-list">
                  {route.map((stop) => (
                    <div
                      key={stop.id}
                      data-route-stop-id={stop.id}
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

                        {/* Field Action Buttons (Zero in-app payment collection) */}
                        <div className="grid grid-cols-2 gap-2 pt-2">
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
                            onClick={() => {
                              setSkuSearchQuery("");
                              setShowCardModal(true);
                            }}
                            className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                          >
                            <FileText className="w-5 h-5 text-indigo-600" />
                            <span className="text-xs font-semibold">Take Order</span>
                          </button>
                        </div>

                        <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/80 dark:border-[#3a3330] text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          No in-app payment collection. Off-app Bank-to-Bank and Cash-to-Cash settlements are noted and marked paid exclusively by Office Manager or Owner.
                        </div>
                      </div>

                      {/* Live Activity History */}
                      <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm">Salon Ledger &amp; Visits</h4>
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
                            No synced visits, verified settlements, or order cards for this salon yet.
                          </div>
                        ) : (
                          <div className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330] text-xs max-h-64 overflow-y-auto">
                            {salonActivity.payments.map((p) => {
                              const isBank = p.method === "bank_transfer" || p.method === "bank";
                              return (
                                <div key={p.id} className="py-2 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        className={`font-semibold ${
                                          p.reversed
                                            ? "text-rose-700 dark:text-rose-400"
                                            : "text-emerald-700 dark:text-emerald-400"
                                        }`}
                                      >
                                        {isBank ? "Bank-to-Bank Settlement" : "Cash-to-Cash Settlement"}
                                      </span>
                                      {p.receiptNumber && (
                                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330]">
                                          {p.receiptNumber}
                                        </span>
                                      )}
                                      {p.reversed && (
                                        <span className="text-[10px] font-bold uppercase text-rose-700 dark:text-rose-300">
                                          Reversed
                                        </span>
                                      )}
                                    </div>
                                    {(p.bankName || p.bankReference) && (
                                      <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                        {[p.bankName, p.bankReference].filter(Boolean).join(" · ")}
                                      </div>
                                    )}
                                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                      {when(p.capturedAt)}
                                      {p.recordedByName ? ` · Approved by ${p.recordedByName}` : ""}
                                    </div>
                                  </div>
                                  <span
                                    className={`font-bold tabular-nums shrink-0 ${
                                      p.reversed ? "line-through text-rose-600/70" : ""
                                    }`}
                                  >
                                    PKR {p.amount.toLocaleString()}
                                  </span>
                                </div>
                              );
                            })}
                            {salonActivity.orderCards.map((c) => (
                              <div key={c.id} className="py-2 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold">
                                    Order Card: {c.qty}x {c.skuName}
                                  </div>
                                  {c.notes && (
                                    <div className="text-[11px] text-[#7a2e4a] dark:text-[#d77a9c] mt-0.5">
                                      Note: {c.notes}
                                    </div>
                                  )}
                                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                    {when(c.capturedAt)} · {c.status.replace("_", " ")}
                                  </div>
                                </div>
                                <span className="font-bold tabular-nums shrink-0">
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

                                      {order.notes && (
                                        <div className="text-[11px] text-[#7a2e4a] dark:text-[#d77a9c] truncate">
                                          Note: {order.notes}
                                        </div>
                                      )}

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
                          className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative shrink-0">
                          <ArrowUpDown className="w-3.5 h-3.5 absolute left-3 top-3 text-[#6b625e] pointer-events-none" />
                          <select
                            aria-label="Sort salons by"
                            value={salonSort}
                            onChange={(e) => setSalonSort(e.target.value as SalonSortKey)}
                            className="min-h-[40px] pl-8 pr-3 py-2 text-xs font-medium rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b] text-[#1d1a19] dark:text-[#f2eeec]"
                          >
                            {SALON_SORT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                Sort: {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs">
                          {(["all", "vip", "regular", "trial", "prospect"] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setSalonFilter(st)}
                              className={`min-h-[38px] px-3 py-1.5 rounded-lg capitalize whitespace-nowrap transition-colors ${
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
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {sortedSalons.map((salon) => (
                        <button
                          key={salon.id}
                          type="button"
                          onClick={() => setSelectedSalonId(salon.id)}
                          className="w-full text-left p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs hover:border-[#7a2e4a] transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                                {salon.name}
                              </h4>
                              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                                {salon.area} · {salon.last_visited_at ? `Visited ${when(salon.last_visited_at)}` : "Never visited"}
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

            {/* ================= TAB 3.5: PUBLIC SHOWCASE (khsalon.com) ================= */}
            {activeTab === "shop" && (
              <StorefrontView
                onOpenSalonOrderModal={(prodName) => {
                  if (salons.length === 0) {
                    showToast("No active salons loaded yet. Register or import salons first.", "warn");
                    return;
                  }
                  const targetSalon = selectedSalonId || salons[0]!.id;
                  setSelectedSalonId(targetSalon);
                  const matchedSku = skus.find(
                    (k) =>
                      prodName.toLowerCase().includes(k.category.toLowerCase()) ||
                      k.name.toLowerCase().includes(prodName.split(" ")[0]!.toLowerCase()),
                  );
                  if (matchedSku) setSelectedSkuId(matchedSku.id);
                  setSkuSearchQuery("");
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

                  const isManager = canManageCatalog(user.role);
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
                                  <span className="tabular-nums">Map View ({filteredOrders.length})</span>
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
                          orders={filteredOrders}
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
                                  {order.notes && (
                                    <div className="pt-1.5 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                                      <span className="font-semibold text-[#1d1a19] dark:text-[#f2eeec]">
                                        Note:
                                      </span>{" "}
                                      {order.notes}
                                    </div>
                                  )}
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
                      disabled={salons.length === 0}
                      onClick={async () => {
                        const targetSalon = currentSalon || salons[0];
                        if (!targetSalon) {
                          showToast("No salon available to enqueue visit.", "warn");
                          return;
                        }
                        const id = `tst-${Date.now()}`;
                        await submit({
                          id,
                          fn: "log_visit",
                          args: { p_id: id, p_salon_id: targetSalon.id, p_notes: "Sample field visit" },
                          label: `Test Visit: ${targetSalon.name}`,
                          salonId: targetSalon.id,
                          capturedAt: new Date().toISOString(),
                        });
                        showToast(`Queued test visit for ${targetSalon.name}.`, "ok");
                      }}
                      className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 font-medium hover:bg-black/10 disabled:opacity-40"
                    >
                      + Enqueue Visit
                    </button>

                    <button
                      type="button"
                      disabled={salons.length === 0}
                      onClick={async () => {
                        const targetSalon = currentSalon || salons[0];
                        if (!targetSalon) {
                          showToast("No salon available to enqueue note.", "warn");
                          return;
                        }
                        const id = `note-${Date.now()}`;
                        await submit({
                          id,
                          fn: "add_salon_note",
                          args: {
                            p_id: id,
                            p_salon_id: targetSalon.id,
                            p_notes: "Salon owner requested follow-up catalog list.",
                            p_body: "Salon owner requested follow-up catalog list.",
                          },
                          label: `Test Note: ${targetSalon.name}`,
                          salonId: targetSalon.id,
                          capturedAt: new Date().toISOString(),
                        });
                        showToast(`Queued test note for ${targetSalon.name}.`, "ok");
                      }}
                      className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 font-medium hover:bg-black/10 disabled:opacity-40"
                    >
                      + Enqueue Salon Note
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const id = `ref-${Date.now()}`;
                        await submit({
                          id,
                          fn: "rep_check_in",
                          args: {
                            p_id: id,
                            p_fail: true,
                          },
                          label: "Invalid RPC Refusal Test",
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

      {/* 5. Order Intake Card Modal */}
      {showCardModal && currentSalon && (() => {
        const activeSelectedSkuId = filteredCardSkus.some((k) => k.id === selectedSkuId)
          ? selectedSkuId
          : (filteredCardSkus[0]?.id ?? "");
        const stockCheck = activeSelectedSkuId
          ? checkOrderIntakeStock(skus, activeSelectedSkuId, cardQty)
          : {
              selectedSku: null,
              availableStock: 0,
              exceedsStock: false,
              shortfall: 0,
              unitLabel: "Units",
              lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
              isOutOfStock: false,
              isLowStock: false,
              isBelowThreshold: false,
            };
        const selectedSku = stockCheck.selectedSku;
        const estimatedTotalPkr = selectedSku ? selectedSku.price * cardQty : 0;

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-intake-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3
                    id="order-intake-modal-title"
                    className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]"
                  >
                    Create Order Intake Card
                  </h3>
                  <p className="text-xs text-[#6b625e] dark:text-[#a59b96] mt-0.5">
                    For: <strong>{currentSalon.name}</strong>
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="open-catalog-drawer-btn"
                  onClick={() => setShowCatalogDrawer(true)}
                  className="px-3 py-1.5 rounded-xl border border-[#7a2e4a]/40 bg-[#7a2e4a]/5 text-[#7a2e4a] dark:text-[#d77a9c] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#7a2e4a]/10 whitespace-nowrap shrink-0"
                >
                  <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Browse Catalog</span>
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor="order-sku-search" className="block text-xs font-semibold">
                      Search Products:
                    </label>
                    <span
                      data-testid="order-sku-match-count"
                      className="text-[11px] text-[#6b625e] dark:text-[#a59b96] tabular-nums"
                    >
                      {filteredCardSkus.length} of {skus.length} shown
                    </span>
                  </div>
                  <div className="relative">
                    <Search
                      className="w-3.5 h-3.5 text-[#6b625e] dark:text-[#a59b96] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="order-sku-search"
                      type="text"
                      placeholder="Find Lumex, Mocheqi Musk, volume (e.g. 500ml), or category..."
                      value={skuSearchQuery}
                      onChange={(e) => {
                        const nextQuery = e.target.value;
                        setSkuSearchQuery(nextQuery);
                        const nextMatches = filterOrderSkus(skus, nextQuery);
                        if (
                          nextMatches.length > 0 &&
                          !nextMatches.some((k) => k.id === selectedSkuId)
                        ) {
                          setSelectedSkuId(nextMatches[0]!.id);
                        }
                      }}
                      className="w-full pl-8 pr-8 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] focus:outline-none focus:ring-2 focus:ring-[#7a2e4a]/25"
                    />
                    {skuSearchQuery && (
                      <button
                        type="button"
                        aria-label="Clear product search"
                        onClick={() => setSkuSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[#6b625e] hover:text-[#1d1a19] dark:text-[#a59b96] dark:hover:text-[#f2eeec]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span id="order-sku-label" className="block text-xs font-semibold">
                      Select Product SKU:
                    </span>
                    {selectedSku && (
                      <span className="text-[11px] font-medium text-[#7a2e4a] dark:text-[#d77a9c] truncate max-w-[190px]">
                        {getSkuBrand(selectedSku)} · {selectedSku.volume_size ?? selectedSku.unit}
                      </span>
                    )}
                  </div>

                  {filteredCardSkus.length > 0 && (
                    <div
                      id="order-sku"
                      role="listbox"
                      aria-labelledby="order-sku-label"
                      data-testid="order-sku-listbox"
                      className="max-h-52 overflow-y-auto rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] p-1.5 space-y-1.5"
                    >
                      {filteredCardSkus.map((k) => {
                        const qty = Math.max(0, Number(k.bag_qty ?? 0));
                        const isSelected = k.id === activeSelectedSkuId;
                        const isOut = qty === 0;
                        const isLow = qty > 0 && qty < DEFAULT_LOW_STOCK_THRESHOLD;
                        const brand = getSkuBrand(k);
                        const volume = k.volume_size ?? k.unit;
                        return (
                          <button
                            key={k.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-testid={`order-sku-option-${k.id}`}
                            onClick={() => setSelectedSkuId(k.id)}
                            className={`w-full text-left p-2 rounded-xl border transition-colors flex items-center gap-2.5 ${
                              isSelected
                                ? "border-[#7a2e4a] bg-white dark:bg-[#211d1b] ring-1 ring-[#7a2e4a]/25"
                                : "border-transparent bg-white/75 dark:bg-[#211d1b]/65 hover:border-[#e6dfdb] dark:hover:border-[#3a3330]"
                            }`}
                          >
                            <ProductThumbnail sku={k} className="w-11 h-11 rounded-lg" />

                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-xs text-[#1d1a19] dark:text-[#f2eeec] truncate">
                                {k.name}
                              </div>
                              <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96] truncate">
                                {brand} · {volume} · {k.category}
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] tabular-nums">
                                <span
                                  className={
                                    isOut
                                      ? "font-semibold text-rose-700 dark:text-rose-300"
                                      : isLow
                                        ? "font-semibold text-amber-700 dark:text-amber-300"
                                        : "text-[#6b625e] dark:text-[#a59b96]"
                                  }
                                >
                                  {isOut
                                    ? "Out of stock"
                                    : isLow
                                      ? `${qty} in stock · Low stock`
                                      : `${qty} in stock`}
                                </span>
                                <span className="font-bold text-[#7a2e4a] dark:text-[#d77a9c]">
                                  PKR {k.price.toLocaleString()}
                                </span>
                              </div>
                            </div>

                            {isSelected && (
                              <Check
                                className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c] shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {filteredCardSkus.length === 0 && (
                    <div
                      data-testid="order-sku-empty"
                      className="mt-2 px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs text-[#6b625e] dark:text-[#a59b96] flex items-center justify-between gap-2"
                    >
                      <span>No products match "{skuSearchQuery.trim()}".</span>
                      <button
                        type="button"
                        onClick={() => setSkuSearchQuery("")}
                        className="font-semibold text-[#7a2e4a] dark:text-[#d77a9c] whitespace-nowrap shrink-0"
                      >
                        Clear filter
                      </button>
                    </div>
                  )}
                  {selectedSku && stockCheck.isBelowThreshold && (
                    <div
                      role="status"
                      data-testid="order-low-stock-indicator"
                      className={`mt-2 px-3 py-2 rounded-xl border text-xs flex items-start gap-2 ${
                        stockCheck.isOutOfStock
                          ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200"
                          : "border-amber-300 dark:border-amber-700/70 bg-amber-50/80 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      <AlertTriangle
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          stockCheck.isOutOfStock
                            ? "text-rose-700 dark:text-rose-300"
                            : "text-amber-700 dark:text-amber-300"
                        }`}
                      />
                      <div className="min-w-0 leading-snug">
                        <span className="font-semibold">
                          {stockCheck.isOutOfStock ? "Out of Stock" : "Low Stock"}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">
                          {stockCheck.isOutOfStock
                            ? `0 ${stockCheck.unitLabel} in stock (below ${stockCheck.lowStockThreshold}-unit threshold)`
                            : `Only ${stockCheck.availableStock} ${stockCheck.unitLabel} left (below ${stockCheck.lowStockThreshold}-unit threshold)`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label htmlFor="order-qty" className="block text-xs font-semibold">
                    Quantity:
                  </label>
                  {selectedSku && (
                    <span
                      data-testid="order-stock-indicator"
                      className={`text-[11px] tabular-nums ${
                        stockCheck.isOutOfStock
                          ? "font-semibold text-rose-700 dark:text-rose-300"
                          : stockCheck.exceedsStock || stockCheck.isLowStock
                            ? "font-semibold text-amber-700 dark:text-amber-300"
                            : "text-[#6b625e] dark:text-[#a59b96]"
                      }`}
                    >
                      In stock: {stockCheck.availableStock} {stockCheck.unitLabel}
                    </span>
                  )}
                </div>
                <input
                  id="order-qty"
                  type="number"
                  min={1}
                  aria-invalid={stockCheck.exceedsStock}
                  value={cardQty}
                  onChange={(e) => setCardQty(Math.max(1, Number(e.target.value)))}
                  className={`w-full p-2.5 text-sm font-bold tabular-nums rounded-xl border transition-colors focus:outline-none focus:ring-2 ${
                    stockCheck.exceedsStock
                      ? "border-amber-500 dark:border-amber-400 bg-amber-50/70 dark:bg-amber-950/35 text-amber-700 dark:text-amber-300 focus:ring-amber-500/35"
                      : "border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] focus:ring-[#7a2e4a]/25"
                  }`}
                />
                {stockCheck.exceedsStock && (
                  <div
                    role="alert"
                    data-testid="order-stock-warning"
                    className="mt-2 p-2.5 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
                    <span>
                      {stockCheck.availableStock === 0
                        ? "Out of stock in warehouse inventory. Backorder fulfillment will be required upon office approval."
                        : `Requested quantity (${cardQty}) exceeds current stock (${stockCheck.availableStock} ${stockCheck.unitLabel} available — short by ${stockCheck.shortfall}).`}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="order-notes" className="block text-xs font-semibold mb-1">
                  Delivery Instructions / Notes (Optional):
                </label>
                <textarea
                  id="order-notes"
                  rows={3}
                  placeholder="Special delivery timing, stylist contact, or salon owner requests..."
                  value={cardNotes}
                  onChange={(e) => setCardNotes(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>
              {selectedSku && (
                <div className="flex items-center justify-between text-xs pt-1 border-t border-[#e6dfdb]/70 dark:border-[#3a3330]">
                  <span className="text-[#6b625e] dark:text-[#a59b96]">Estimated Order Total</span>
                  <span className="font-bold text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                    PKR {estimatedTotalPkr.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowCardModal(false);
                    setCardNotes("");
                    setSkuSearchQuery("");
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedSku || filteredCardSkus.length === 0}
                  onClick={handleCreateCard}
                  className="flex-1 py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50"
                >
                  Create Card
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
              {areas.length > 0 ? (
                <select
                  id="new-salon-area"
                  value={newSalonAreaId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setNewSalonAreaId(nextId);
                    const found = areas.find((a) => a.id === nextId);
                    if (found) setNewSalonArea(found.name);
                  }}
                  className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.territoryName ? ` (${a.territoryName})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="new-salon-area"
                  type="text"
                  value={newSalonArea}
                  onChange={(e) => setNewSalonArea(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              )}
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

      {/* Lumex & Mocheqi Musk Product Catalog Browse Drawer (launched from Take Order) */}
      <ProductCatalogDrawer
        isOpen={showCatalogDrawer}
        onClose={() => setShowCatalogDrawer(false)}
        skus={skus}
        selectedSkuId={selectedSkuId}
        onSelectSkuForOrder={(sku) => {
          setSelectedSkuId(sku.id);
          setSkuSearchQuery("");
          setShowCatalogDrawer(false);
          showToast(`Selected ${sku.name} for Order Intake.`, "ok");
          requestAnimationFrame(() => {
            document
              .querySelector(`[data-testid="order-sku-option-${sku.id}"]`)
              ?.scrollIntoView({ block: "nearest" });
          });
        }}
        userRole={user.role}
        onCatalogUpdated={async (savedSku) => {
          await refreshBootstrap();
          setSelectedSkuId(savedSku.id);
        }}
        showToast={showToast}
      />

      {/* Field Rep Operations Drawer (Bag, Blind Count, Commission) */}
      <RepOperationsDrawer
        isOpen={showRepOpsDrawer}
        onClose={() => setShowRepOpsDrawer(false)}
        skus={skus}
        showToast={showToast}
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
