import React, { useEffect, useState } from "react";
import {
  INITIAL_ORDERS,
  INITIAL_ROUTE,
  INITIAL_SALONS,
  INITIAL_SKUS,
  type DeliveryOrder,
  type RouteStop,
  type SKU,
  type Salon,
} from "./lib/data";
import {
  discardItem,
  isOffline,
  listItems,
  retryItem,
  setSimulatedOffline,
  startSync,
  submit,
  subscribe,
  syncState,
  wipeLocalData,
} from "./lib/outbox";
import type { OutboxItem } from "./lib/outbox/types";
import { cachedRows } from "./lib/cache";
import { registerServiceWorker } from "./lib/register-sw";
import { when } from "./lib/time";
import { BottomNavigation, type TabKey } from "./components/navigation";
import { OutboxStatus } from "./components/outbox-status";
import { PWAInstallButton } from "./components/pwa-install";
import { RepMonth } from "./components/rep-month";
import { SignaturePad } from "./components/signature-pad";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Check,
  Clock,
  Coins,
  FileText,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  UserCheck,
  X,
} from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [outboxState, setOutboxState] = useState(syncState());
  const [salons, setSalons] = useState<Salon[]>(INITIAL_SALONS);
  const [route, setRoute] = useState<RouteStop[]>(INITIAL_ROUTE);
  const [orders, setOrders] = useState<DeliveryOrder[]>(INITIAL_ORDERS);
  const [skus, setSkus] = useState<SKU[]>(INITIAL_SKUS);

  // Rep day shift state
  const [dayOpen, setDayOpen] = useState(false);
  const [bagCount, setBagCount] = useState(24);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCheckOutModal, setShowCheckOutModal] = useState(false);

  // Selected salon for details
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);
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

  // Delivery order signing
  const [signingOrderId, setSigningOrderId] = useState<string | null>(null);

  // Feedback notifications / toasts
  const [toast, setToast] = useState<{ message: string; type: "ok" | "info" | "warn" } | null>(null);

  const showToast = (message: string, type: "ok" | "info" | "warn" = "ok") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // Register service worker and start sync cycle
  useEffect(() => {
    registerServiceWorker();
    const stopSync = startSync();

    const refreshOutbox = async () => {
      const all = await listItems();
      setItems(all);
      setOutboxState(syncState());
    };

    void refreshOutbox();
    const unsub = subscribe(() => {
      void refreshOutbox();
    });

    // Populate with cachedRows to demonstrate encrypted read cache (Task 7)
    void cachedRows("salons_list", async () => INITIAL_SALONS).then((res) => {
      setSalons(res.rows);
    });

    return () => {
      stopSync();
      unsub();
    };
  }, []);

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

    setDayOpen(true);
    setBagCount(count);

    if (res === "queued") {
      showToast(`Check-in saved on phone (Offline). Queue updated.`, "info");
    } else {
      showToast(`Day successfully opened with ${count} units counted.`, "ok");
    }
  };

  // 2. Check out Rep Day (Daily Close)
  const handleCheckOut = async (count: number) => {
    setShowCheckOutModal(false);
    const countId = `cnt-${Date.now()}`;
    await submit({
      id: countId,
      fn: "record_count",
      args: { p_id: countId, p_count: count, p_at_client: new Date().toISOString() },
      label: `Daily Close Bag Count (${count} units)`,
      salonId: null,
      capturedAt: new Date().toISOString(),
    });

    const closeId = `cls-${Date.now()}`;
    const res = await submit({
      id: closeId,
      fn: "rep_check_out",
      args: { p_id: closeId, p_at_client: new Date().toISOString() },
      label: `End Day Shift Check-Out`,
      salonId: null,
      capturedAt: new Date().toISOString(),
      dependsOn: { itemId: countId, argName: "p_count_id" },
    });

    setDayOpen(false);
    setBagCount(count);

    if (res === "queued") {
      showToast(`Daily close saved on phone (Offline). Will drain when online.`, "info");
    } else {
      showToast(`Day shift closed. Variance calculated and recorded.`, "ok");
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
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
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
    // Deduct locally for immediate UI responsiveness
    setSalons((prev) =>
      prev.map((s) =>
        s.id === currentSalon.id ? { ...s, outstanding_balance: Math.max(0, s.outstanding_balance - amount) } : s,
      ),
    );

    if (res === "queued") {
      showToast(`PKR ${amount.toLocaleString()} saved on this phone. Receipt generated after sync.`, "info");
    } else {
      showToast(`PKR ${amount.toLocaleString()} payment recorded. SMS receipt dispatched.`, "ok");
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
      showToast(`Order card saved on phone.`, "info");
    } else {
      showToast(`Order card sent to office.`, "ok");
    }
  };

  // 6. Create Prospect Salon
  const handleCreateSalon = async () => {
    if (!newSalonName.trim()) return;
    setShowNewSalonModal(false);
    const id = `sal-${Date.now()}`;
    const newRecord: Salon = {
      id,
      name: newSalonName,
      area: newSalonArea,
      address: `${newSalonArea}, Karachi`,
      phone: newSalonPhone || "0300-1234567",
      contact_person: newSalonContact || "Owner",
      stage: "prospect",
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
        p_name: newSalonName,
        p_area: newSalonArea,
        p_phone: newSalonPhone,
        p_contact: newSalonContact,
        p_at_client: new Date().toISOString(),
      },
      label: `New Prospect: ${newSalonName}`,
      salonId: id,
      capturedAt: new Date().toISOString(),
    });

    setNewSalonName("");
    setNewSalonPhone("");
    setNewSalonContact("");

    if (res === "queued") {
      showToast(`Prospect ${newRecord.name} saved on phone.`, "info");
    } else {
      showToast(`Prospect registered in Karachi roster.`, "ok");
    }
  };

  // 7. Complete Delivery with Attached Digital Signature (Dependent Mutation)
  const handleConfirmDeliverySignature = async (signatureDataUrl: string) => {
    if (!signingOrderId) return;
    const order = orders.find((o) => o.id === signingOrderId);
    if (!order) return;

    setSigningOrderId(null);

    // Parent item: rep_submit_delivery
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

    // Dependent child item: rep_attach_signature (waits for delivery submission)
    const sigId = `sig-${Date.now()}`;
    await submit({
      id: sigId,
      fn: "rep_attach_signature",
      args: {
        p_id: sigId,
        p_delivery_id: deliveryId,
        p_signature_data: signatureDataUrl.slice(0, 80) + "...[sealed]",
        p_at_client: new Date().toISOString(),
      },
      label: `Signature for ${order.order_number}`,
      salonId: order.salon_id,
      capturedAt: new Date().toISOString(),
      dependsOn: { itemId: deliveryId, argName: "p_delivery_id" },
    });

    // Update local orders
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id ? { ...o, status: "delivered", delivered_at: new Date().toISOString() } : o,
      ),
    );

    if (resDelivery === "queued") {
      showToast(`Delivery & Customer signature queued on phone.`, "info");
    } else {
      showToast(`Delivery confirmed with customer signature.`, "ok");
    }
  };

  // Filter salons
  const filteredSalons = salons.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(salonSearch.toLowerCase()) ||
      s.area.toLowerCase().includes(salonSearch.toLowerCase());
    const matchesFilter = salonFilter === "all" || s.stage === salonFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec] flex flex-col pb-20 selection:bg-[#7a2e4a]/20">
      {/* Top Header Contract */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#211d1b]/95 backdrop-blur-md border-b border-[#e6dfdb] dark:border-[#3a3330]">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#7a2e4a] flex items-center justify-center text-white font-bold text-sm shadow-xs">
              K
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight leading-tight flex items-center gap-1.5">
                <span>Kiran DMS</span>
                <span className="text-[10px] font-medium text-[#7a2e4a] dark:text-[#d77a9c] bg-[#7a2e4a]/10 dark:bg-[#7a2e4a]/30 px-1.5 py-0.2 rounded">
                  Rep PWA
                </span>
              </div>
              <div className="text-[10px] text-[#6b625e] dark:text-[#a59b96] leading-none">
                Karachi Central · Pilot Roster
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PWAInstallButton />
          </div>
        </div>

        {/* Outbox Status Banner */}
        <OutboxStatus />
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 max-w-sm w-11/12">
          <div
            className={`p-3 rounded-xl shadow-lg border text-xs font-medium flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 ${
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
              onClick={() => setToast(null)}
              className="p-1 hover:opacity-70 text-white/80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-md w-full mx-auto px-4 py-4 flex-1">
        {/* ================= TAB 1: TODAY ================= */}
        {activeTab === "today" && (
          <div className="space-y-4">
            {/* Shift Banner */}
            <div className="bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] rounded-2xl p-4 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                    Salaam, Rashid Khan
                  </h2>
                  <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                    Field Sales Rep · Phone: Approved
                  </div>
                </div>

                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 ${
                    dayOpen
                      ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                      : "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      dayOpen ? "bg-emerald-600 animate-pulse" : "bg-amber-600"
                    }`}
                  />
                  <span>{dayOpen ? "Shift Open" : "Day Not Started"}</span>
                </span>
              </div>

              {/* Day Actions */}
              <div className="pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330]">
                {!dayOpen ? (
                  <button
                    type="button"
                    onClick={() => setShowCheckInModal(true)}
                    className="w-full h-12 rounded-xl bg-[#7a2e4a] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs hover:opacity-95 active:scale-[0.99] transition"
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
                      className="px-3 py-2 rounded-xl border border-rose-300 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      End Day (Daily Close)
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Rep Monthly Target Card */}
            <RepMonth />

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setActiveTab("route")}
                className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
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
                className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
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
                className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
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
                className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-left hover:border-[#7a2e4a] transition-colors"
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
                  Karachi Central & South · {route.length} stops generated
                </p>
              </div>

              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300">
                Cycle: Week 2
              </span>
            </div>

            <div className="space-y-2.5">
              {route.map((stop) => (
                <div
                  key={stop.id}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#7a2e4a] text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                      {stop.stop_number}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                        {stop.salon_name}
                      </h4>
                      <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                        {stop.area}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] mt-1 text-[#6b625e] dark:text-[#a59b96]">
                        <span className="capitalize">
                          {stop.due_reason.replace("_", " ")}
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
                    className="px-3 py-2 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a] text-[#7a2e4a] dark:text-[#d77a9c]"
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>

            {/* Lost Demand Quick Capture (P1-17, Task 8) */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-300/40 text-xs space-y-2">
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
                  await submit({
                    id,
                    fn: "record_demand",
                    args: {
                      p_id: id,
                      p_sku_name: "Kiran Brazilian Keratin 1L",
                      p_qty: 2,
                      p_at_client: new Date().toISOString(),
                    },
                    label: `Lost Demand: 2x Keratin 1L`,
                    salonId: null,
                    capturedAt: new Date().toISOString(),
                  });
                  showToast("Lost demand captured for inventory planning.", "ok");
                }}
                className="w-full py-2 rounded-lg bg-amber-600 text-white font-medium text-xs hover:bg-amber-700"
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
              /* Salon Profile & Action View */
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setSelectedSalonId(null)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#7a2e4a] dark:text-[#d77a9c] hover:underline"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Salons Roster</span>
                </button>

                {/* Salon Header Card */}
                <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                        {currentSalon.name}
                      </h3>
                      <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                        {currentSalon.address}
                      </p>
                    </div>
                    <span className="text-xs uppercase font-bold px-2 py-0.5 rounded bg-[#7a2e4a]/10 text-[#7a2e4a] dark:text-[#d77a9c]">
                      {currentSalon.stage}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] grid grid-cols-2 gap-2 text-xs">
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
                </div>

                {/* Field Action Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowVisitModal(true)}
                    className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                  >
                    <UserCheck className="w-5 h-5 text-[#7a2e4a]" />
                    <span className="text-xs font-semibold">Log Visit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPaymentModal(true)}
                    className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                  >
                    <Coins className="w-5 h-5 text-emerald-600" />
                    <span className="text-xs font-semibold">Receive Cash</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCardModal(true)}
                    className="p-3 rounded-xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-center hover:border-[#7a2e4a] flex flex-col items-center justify-center gap-1.5"
                  >
                    <FileText className="w-5 h-5 text-indigo-600" />
                    <span className="text-xs font-semibold">Take Order</span>
                  </button>
                </div>

                {/* Past visit info */}
                <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] text-xs text-[#6b625e] dark:text-[#a59b96]">
                  Last visit: {currentSalon.last_visited_at ? when(currentSalon.last_visited_at) : "No visits logged yet."}
                </div>
              </div>
            ) : (
              /* Salons Roster List */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
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
                    className="px-3 py-1.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Prospect</span>
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-[#6b625e]" />
                  <input
                    type="text"
                    placeholder="Search salon name or area..."
                    value={salonSearch}
                    onChange={(e) => setSalonSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]"
                  />
                </div>

                {/* Filter segments */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
                  {(["all", "vip", "regular", "trial", "prospect"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setSalonFilter(st)}
                      className={`px-3 py-1 rounded-lg capitalize whitespace-nowrap transition-colors ${
                        salonFilter === st
                          ? "bg-[#7a2e4a] text-white font-semibold"
                          : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e]"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {/* List Items */}
                <div className="space-y-2">
                  {filteredSalons.map((salon) => (
                    <div
                      key={salon.id}
                      onClick={() => setSelectedSalonId(salon.id)}
                      className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs cursor-pointer hover:border-[#7a2e4a] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                            {salon.name}
                          </h4>
                          <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                            {salon.area}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-black/5 dark:bg-white/5">
                          {salon.stage}
                        </span>
                      </div>

                      <div className="mt-2 pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex items-center justify-between text-xs">
                        <span className="text-[#6b625e] dark:text-[#a59b96]">
                          {salon.contact_person}
                        </span>
                        {salon.outstanding_balance > 0 ? (
                          <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                            Due: PKR {salon.outstanding_balance.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-emerald-600 font-semibold">Cleared</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 4: ORDERS & DELIVERIES ================= */}
        {activeTab === "orders" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                  Deliveries & Signature (P1-31)
                </h2>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                  Deliver goods with customer signed digital acknowledgement
                </p>
              </div>
            </div>

            {signingOrderId ? (
              /* Signature Drawing Pad */
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                    Customer Signature
                  </h3>
                  <button
                    type="button"
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
            ) : (
              /* Orders List */
              <div className="space-y-3">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[11px] font-mono text-[#6b625e]">
                          {order.order_number}
                        </span>
                        <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                          {order.salon_name}
                        </h4>
                      </div>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          order.status === "delivered"
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                            : "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200"
                        }`}
                      >
                        {order.status === "delivered" ? "Delivered" : "Pending Delivery"}
                      </span>
                    </div>

                    <div className="text-xs space-y-1 bg-[#faf7f5] dark:bg-[#171413] p-2.5 rounded-xl border border-[#e6dfdb]/60 dark:border-[#3a3330]">
                      {order.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>
                            {it.qty}x {it.sku_name}
                          </span>
                          <span className="tabular-nums font-medium">
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
                          <Check className="w-4 h-4" />
                          <span>Delivered {when(order.delivered_at || "")} with signed acknowledgement.</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 5: OUTBOX INSPECTOR ================= */}
        {activeTab === "outbox" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                  Offline Outbox Queue
                </h2>
                <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                  AES-GCM encrypted IndexedDB store (P1-09)
                </p>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (confirm("Wipe phone outbox queue and local session?")) {
                    await wipeLocalData();
                    setItems([]);
                    showToast("Outbox queue wiped.", "warn");
                  }
                }}
                className="px-2.5 py-1 text-xs text-rose-600 border border-rose-200 dark:border-rose-900 rounded-lg hover:bg-rose-50"
              >
                Wipe Local
              </button>
            </div>

            {/* Offline Simulation Control Card */}
            <div className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs">Simulated Network Disconnect</div>
                  <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                    Toggle to test offline queueing without disabling actual device Wi-Fi
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isOffline()}
                  onChange={(e) => setSimulatedOffline(e.target.checked)}
                  className="w-5 h-5 accent-[#7a2e4a] cursor-pointer"
                />
              </div>

              {/* Quick Test Action Enqueuers */}
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
                  className="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 font-medium hover:bg-black/10"
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
                  className="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 font-medium hover:bg-black/10"
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
                  className="px-2.5 py-1.5 rounded-lg text-rose-700 bg-rose-50 dark:bg-rose-950/40 font-medium"
                >
                  + Test Refusal
                </button>
              </div>
            </div>

            {/* Queue Item List */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6b625e]">
                Queue Items ({items.length})
              </h3>

              {items.length === 0 ? (
                <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e]">
                  Outbox is clear. All captured actions have drained and synced to the database.
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-[#1d1a19] dark:text-[#f2eeec]">
                        <span>#{item.seq}</span>
                        <span>{item.label}</span>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          item.state === "pending"
                            ? "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200"
                            : "bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200"
                        }`}
                      >
                        {item.state}
                      </span>
                    </div>

                    <div className="font-mono text-[10px] text-[#6b625e] dark:text-[#a59b96] truncate">
                      RPC: app.{item.fn}() · Captured: {when(item.capturedAt)}
                    </div>

                    {item.error && (
                      <div className="text-rose-600 bg-rose-50 dark:bg-rose-950/30 p-2 rounded text-[11px]">
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
                        className="px-2 py-1 text-rose-600 hover:underline disabled:opacity-40"
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        onClick={() => retryItem(item.id)}
                        disabled={outboxState.transmittingIds?.includes(item.id)}
                        className="px-2.5 py-1 bg-[#7a2e4a] text-white rounded font-medium disabled:opacity-40 flex items-center gap-1"
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
          </div>
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
              <label className="block text-xs font-semibold mb-1">Total Units Counted:</label>
              <input
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
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCheckIn(bagCount)}
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
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
              <label className="block text-xs font-semibold mb-1">Leftover Units Counted:</label>
              <input
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
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCheckOut(bagCount)}
                className="flex-1 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
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
              <label className="block text-xs font-semibold mb-1">Visit Notes / Discussion:</label>
              <textarea
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
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogVisit}
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
              >
                Save Visit (Offline)
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
              Salon: <strong>{currentSalon.name}</strong> (Due: PKR {currentSalon.outstanding_balance.toLocaleString()})
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">Cash Amount (PKR):</label>
              <input
                type="number"
                placeholder="e.g. 15000"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full p-2.5 text-base font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg">
              Saved on this phone; official SMS receipt dispatched automatically once synced with office.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRecordPayment}
                className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
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
            <div>
              <label className="block text-xs font-semibold mb-1">Select Product SKU:</label>
              <select
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
              <label className="block text-xs font-semibold mb-1">Quantity:</label>
              <input
                type="number"
                min="1"
                value={cardQty}
                onChange={(e) => setCardQty(Math.max(1, Number(e.target.value)))}
                className="w-full p-2 text-sm font-bold tabular-nums rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCardModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCard}
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
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
              <label className="block text-xs font-semibold mb-1">Salon Name:</label>
              <input
                type="text"
                placeholder="e.g. Elegance Hair Lounge"
                value={newSalonName}
                onChange={(e) => setNewSalonName(e.target.value)}
                className="w-full p-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Area / Karachi Zone:</label>
              <input
                type="text"
                value={newSalonArea}
                onChange={(e) => setNewSalonArea(e.target.value)}
                className="w-full p-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Contact Person & Phone:</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Owner name"
                  value={newSalonContact}
                  onChange={(e) => setNewSalonContact(e.target.value)}
                  className="w-full p-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
                <input
                  type="text"
                  placeholder="0300-..."
                  value={newSalonPhone}
                  onChange={(e) => setNewSalonPhone(e.target.value)}
                  className="w-full p-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewSalonModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSalon}
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
              >
                Save Prospect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Navigation Anchor */}
      <BottomNavigation
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingCount={pendingItems.length}
      />
    </div>
  );
}
