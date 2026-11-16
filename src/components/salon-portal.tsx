import React, { useCallback, useEffect, useState } from "react";
import {
  cancelSalonRequest,
  fetchSalonCatalogue,
  fetchSalonInvoiceDocument,
  fetchSalonMe,
  fetchSalonMyAccount,
  fetchSalonMyInvoices,
  fetchSalonMyOrders,
  fetchSalonMyRequests,
  signOutEverywhere,
  submitSalonRequest,
} from "../lib/api";
import type {
  SalonAccountSummary,
  SalonCatalogueItem,
  SalonInvoiceRow,
  SalonPortalOrder,
  SalonPortalProfile,
  SalonPortalRequest,
} from "../server/types";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  LogOut,
  Package,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Store,
  Trash2,
  X,
} from "lucide-react";

interface SalonPortalProps {
  onSignOut: () => void;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}

type SalonPortalTab = "account" | "catalogue" | "requests" | "orders" | "invoices";

export const SalonPortal: React.FC<SalonPortalProps> = ({ onSignOut, showToast }) => {
  const [activeTab, setActiveTab] = useState<SalonPortalTab>("catalogue");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [profile, setProfile] = useState<SalonPortalProfile | null>(null);
  const [account, setAccount] = useState<SalonAccountSummary | null>(null);
  const [catalogue, setCatalogue] = useState<SalonCatalogueItem[]>([]);
  const [requests, setRequests] = useState<SalonPortalRequest[]>([]);
  const [orders, setOrders] = useState<SalonPortalOrder[]>([]);
  const [invoices, setInvoices] = useState<SalonInvoiceRow[]>([]);

  // Cart / request builder state
  const [cart, setCart] = useState<Record<string, number>>({});
  const [requestNote, setRequestNote] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("all");

  // Selected invoice document modal
  const [viewingInvoiceDoc, setViewingInvoiceDoc] = useState<{
    invoiceId: string;
    loading: boolean;
    data: Record<string, unknown> | null;
  } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, a, c, r, o, inv] = await Promise.all([
        fetchSalonMe(),
        fetchSalonMyAccount(),
        fetchSalonCatalogue(),
        fetchSalonMyRequests(),
        fetchSalonMyOrders(),
        fetchSalonMyInvoices(),
      ]);
      setProfile(p);
      setAccount(a);
      setCatalogue(c);
      setRequests(r);
      setOrders(o);
      setInvoices(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load salon partner portal.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleUpdateCart = (skuId: string, delta: number) => {
    setCart((prev) => {
      const current = prev[skuId] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[skuId];
        return copy;
      }
      return { ...prev, [skuId]: next };
    });
  };

  const handleClearCart = () => setCart({});

  const cartItems = Object.entries(cart)
    .map(([skuId, qty]) => {
      const item = catalogue.find((c) => c.skuId === skuId);
      if (!item) return null;
      return { item, qty };
    })
    .filter((entry): entry is { item: SalonCatalogueItem; qty: number } => entry !== null);

  const cartTotalPaisa = cartItems.reduce(
    (sum, { item, qty }) => sum + item.pricePaisa * qty,
    0,
  );

  const handleSubmitRequest = async () => {
    if (cartItems.length === 0) return;
    setSubmittingRequest(true);
    try {
      const result = await submitSalonRequest({
        lines: cartItems.map(({ item, qty }) => ({ sku_id: item.skuId, qty })),
        note: requestNote.trim() || undefined,
      });
      showToast(
        `Order request submitted (#${result.request_id.slice(0, 8)}). Awaiting office conversion.`,
        "ok",
      );
      setCart({});
      setRequestNote("");
      setActiveTab("requests");
      const updatedReqs = await fetchSalonMyRequests();
      setRequests(updatedReqs);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not submit order request.", "warn");
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!window.confirm("Are you sure you want to cancel this order request?")) return;
    try {
      await cancelSalonRequest(requestId, "Cancelled by salon partner");
      showToast("Order request cancelled.", "info");
      const updatedReqs = await fetchSalonMyRequests();
      setRequests(updatedReqs);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not cancel request.", "warn");
    }
  };

  const handleOpenInvoiceDoc = async (invoiceId: string) => {
    setViewingInvoiceDoc({ invoiceId, loading: true, data: null });
    try {
      const doc = await fetchSalonInvoiceDocument(invoiceId);
      setViewingInvoiceDoc({ invoiceId, loading: false, data: doc });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not load invoice document.", "warn");
      setViewingInvoiceDoc(null);
    }
  };

  const handleSignOut = async () => {
    await signOutEverywhere();
    onSignOut();
  };

  const productGroups = Array.from(new Set(catalogue.map((c) => c.groupName).filter(Boolean)));

  const filteredCatalogue = catalogue.filter((item) => {
    if (selectedGroup !== "all" && item.groupName !== selectedGroup) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.productName.toLowerCase().includes(q) ||
      item.code.toLowerCase().includes(q) ||
      item.variant.toLowerCase().includes(q) ||
      item.brandLabel.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#faf7f5] dark:bg-[#171413] text-[#1d1a19] dark:text-[#f2eeec]">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#211d1b]/95 backdrop-blur border-b border-[#e6dfdb] dark:border-[#3a3330]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#7a2e4a] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-extrabold text-base tracking-tight truncate">
                  {profile?.salonName ?? "Salon Partner Portal"}
                </h1>
                {profile?.stage && (
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7a2e4a] dark:text-[#d77a9c] bg-[#7a2e4a]/10 px-2 py-0.5 rounded-md">
                    {profile.stage}
                  </span>
                )}
                {profile?.blocked && (
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 px-2 py-0.5 rounded-md">
                    Account Hold
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96] truncate">
                {profile?.areaName ? `${profile.areaName} · ` : ""}Official KH Enterprises Partner Access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              disabled={loading}
              title="Refresh salon data"
              className="p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96] hover:text-[#1d1a19] dark:hover:text-[#f2eeec] disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-6xl mx-auto px-4 flex items-center gap-2 overflow-x-auto text-xs font-semibold pb-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveTab("catalogue")}
            className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === "catalogue"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Product Catalogue</span>
            {cartItems.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-amber-400 text-black font-extrabold">
                {cartItems.reduce((acc, c) => acc + c.qty, 0)}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("requests")}
            className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === "requests"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>My Requests ({requests.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("orders")}
            className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === "orders"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Official Orders ({orders.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("invoices")}
            className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === "invoices"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Invoices ({invoices.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("account")}
            className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === "account"
                ? "bg-[#7a2e4a] text-white shadow-xs"
                : "text-[#6b625e] dark:text-[#a59b96] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Account & Ledger</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Unable to load portal data</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* ================= TAB 1: CATALOGUE & ORDER REQUEST BUILDER ================= */}
        {activeTab === "catalogue" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left 2 Cols: Catalog Browse */}
            <div className="lg:col-span-2 space-y-4">
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-sm">Partner Wholesale Catalogue</h2>
                    <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                      Authorized prices for {profile?.salonName ?? "your salon"}
                    </p>
                  </div>
                  <input
                    type="text"
                    placeholder="Search brand, shade, code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full sm:w-64 px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs"
                  />
                </div>

                {productGroups.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedGroup("all")}
                      className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap ${
                        selectedGroup === "all"
                          ? "bg-[#7a2e4a] text-white"
                          : "border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
                      }`}
                    >
                      All Categories
                    </button>
                    {productGroups.map((grp) => (
                      <button
                        key={grp}
                        type="button"
                        onClick={() => setSelectedGroup(grp)}
                        className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap ${
                          selectedGroup === grp
                            ? "bg-[#7a2e4a] text-white"
                            : "border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
                        }`}
                      >
                        {grp}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {filteredCatalogue.length === 0 ? (
                <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                  No products found in this category.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredCatalogue.map((item) => {
                    const inCart = cart[item.skuId] || 0;
                    return (
                      <div
                        key={item.skuId}
                        className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex flex-col justify-between gap-2.5 hover:border-[#7a2e4a] transition-colors"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                            <span className="font-semibold text-[#7a2e4a] dark:text-[#d77a9c]">
                              {item.brandLabel || "Kiran"}
                            </span>
                            <span className="font-mono">{item.code}</span>
                          </div>
                          <h3 className="font-bold text-xs mt-0.5 leading-snug">{item.productName}</h3>
                          <p className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                            {item.variant} · {item.unit}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] flex items-center justify-between gap-2">
                          <div>
                            <div className="font-extrabold text-xs text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                              PKR {(item.pricePaisa / 100).toLocaleString()}
                            </div>
                            {item.ownPrice && (
                              <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                Salon Contract Rate
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {inCart > 0 ? (
                              <div className="flex items-center gap-1 bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb] dark:border-[#3a3330] rounded-lg p-0.5 text-xs">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCart(item.skuId, -1)}
                                  className="w-6 h-6 flex items-center justify-center font-bold text-[#6b625e] hover:text-[#1d1a19]"
                                >
                                  -
                                </button>
                                <span className="w-6 text-center font-bold tabular-nums">
                                  {inCart}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateCart(item.skuId, 1)}
                                  className="w-6 h-6 flex items-center justify-center font-bold text-[#6b625e] hover:text-[#1d1a19]"
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleUpdateCart(item.skuId, 1)}
                                className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold shadow-xs hover:opacity-95"
                              >
                                + Add
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right 1 Col: Request Cart Summary */}
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3 sticky top-24">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                    <span>Order Request Cart</span>
                  </h3>
                  {cartItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearCart}
                      className="text-[11px] text-rose-600 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {cartItems.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#6b625e] dark:text-[#a59b96] border border-dashed border-[#e6dfdb] dark:border-[#3a3330] rounded-xl">
                    Select products from the catalogue to prepare a salon restock request.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {cartItems.map(({ item, qty }) => (
                        <div
                          key={item.skuId}
                          className="flex items-center justify-between text-xs gap-2 py-1 border-b border-[#e6dfdb]/50 dark:border-[#3a3330]"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{item.productName}</div>
                            <div className="text-[10px] text-[#6b625e] dark:text-[#a59b96]">
                              {qty}x @ PKR {(item.pricePaisa / 100).toLocaleString()}
                            </div>
                          </div>
                          <div className="font-bold tabular-nums text-right shrink-0">
                            PKR {((item.pricePaisa * qty) / 100).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-[#e6dfdb] dark:border-[#3a3330] flex items-center justify-between font-bold text-xs">
                      <span>Estimated Subtotal</span>
                      <span className="text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                        PKR {(cartTotalPaisa / 100).toLocaleString()}
                      </span>
                    </div>

                    <div>
                      <label htmlFor="salon-req-note" className="block text-[11px] font-semibold mb-1">
                        Instructions / Preferred Delivery Time:
                      </label>
                      <textarea
                        id="salon-req-note"
                        rows={2}
                        value={requestNote}
                        onChange={(e) => setRequestNote(e.target.value)}
                        placeholder="e.g. Please send before Thursday weekend rush..."
                        className="w-full p-2 text-xs rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                      />
                    </div>

                    <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 leading-snug">
                      <strong>Workflow Notice:</strong> Submitting this request sends it to KH
                      Enterprises Office for order conversion and scheduling. An official sales order
                      is not final until office review.
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitRequest}
                      disabled={submittingRequest}
                      className="w-full py-2.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                    >
                      {submittingRequest ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Submitting Request...</span>
                        </>
                      ) : (
                        <>
                          <span>Submit Order Request</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: MY ORDER REQUESTS ================= */}
        {activeTab === "requests" && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
              <h2 className="font-bold text-sm">Submitted Restock Requests</h2>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                History of requests submitted by salon partner for office conversion
              </p>
            </div>

            {requests.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No order requests submitted yet. Use the Product Catalogue to place a request.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <div
                    key={req.requestId}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs">
                          Request #{req.requestId.slice(0, 8)}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            req.status === "open"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : req.status === "converted"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-black/5 dark:bg-white/5 text-[#6b625e]"
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                        {new Date(req.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-xs space-y-1 bg-[#faf7f5] dark:bg-[#171413] p-3 rounded-xl border border-[#e6dfdb]/60 dark:border-[#3a3330]">
                      {req.lines.map((l, i) => (
                        <div key={i} className="flex justify-between gap-2">
                          <span>
                            {l.qty}x {l.productName} ({l.variant})
                          </span>
                          <span className="font-medium tabular-nums">
                            PKR {((l.unitPricePaisa * l.qty) / 100).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {req.note && (
                        <div className="pt-2 text-[11px] text-[#6b625e] dark:text-[#a59b96] border-t border-[#e6dfdb]/60 dark:border-[#3a3330]">
                          <span className="font-semibold">Note:</span> {req.note}
                        </div>
                      )}
                      {req.reason && (
                        <div className="pt-1 text-[11px] text-rose-600 dark:text-rose-400">
                          <span className="font-semibold">Reason:</span> {req.reason}
                        </div>
                      )}
                    </div>

                    {req.status === "open" && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(req.requestId)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Cancel Request</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: OFFICIAL ORDERS ================= */}
        {activeTab === "orders" && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
              <h2 className="font-bold text-sm">Official Sales Orders & Deliveries</h2>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Confirmed orders processed by KH Enterprises Office and scheduled for dispatch
              </p>
            </div>

            {orders.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No official orders created yet.
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((ord) => (
                  <div
                    key={ord.orderId}
                    className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs">
                          Order #{ord.orderId.slice(0, 8)}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {ord.status}
                        </span>
                        <span className="text-[10px] uppercase text-[#6b625e] dark:text-[#a59b96] font-semibold">
                          Plan: {ord.plan}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                        {new Date(ord.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-xs space-y-1 bg-[#faf7f5] dark:bg-[#171413] p-3 rounded-xl border border-[#e6dfdb]/60 dark:border-[#3a3330]">
                      {ord.lines.map((l, i) => (
                        <div key={i} className="flex justify-between gap-2">
                          <span>
                            {l.qty}x {l.productName} ({l.variant})
                          </span>
                          <span className="font-medium tabular-nums">
                            PKR {((l.unitPricePaisa * l.qty) / 100).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-[#e6dfdb] dark:border-[#3a3330] flex justify-between font-bold text-xs">
                        <span>Total Amount</span>
                        <span className="text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                          PKR {(ord.totalPaisa / 100).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 4: INVOICES ================= */}
        {activeTab === "invoices" && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
              <h2 className="font-bold text-sm">Official Invoices</h2>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Issued commercial invoices with payments and outstanding balance
              </p>
            </div>

            {invoices.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
                No invoices issued yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#faf7f5] dark:bg-[#171413] border-b border-[#e6dfdb] dark:border-[#3a3330] font-semibold text-[#6b625e] dark:text-[#a59b96]">
                    <tr>
                      <th className="p-3">Invoice #</th>
                      <th className="p-3">Issued Date</th>
                      <th className="p-3 text-right">Total (PKR)</th>
                      <th className="p-3 text-right">Paid (PKR)</th>
                      <th className="p-3 text-right">Outstanding (PKR)</th>
                      <th className="p-3 text-center">Document</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                    {invoices.map((inv) => (
                      <tr key={inv.invoiceId} className="hover:bg-black/[0.02]">
                        <td className="p-3 font-mono font-bold text-[#1d1a19] dark:text-[#f2eeec]">
                          {inv.number}
                        </td>
                        <td className="p-3 text-[#6b625e] dark:text-[#a59b96]">
                          {new Date(inv.issuedAt).toLocaleDateString()}
                        </td>
                        <td className="p-3 text-right font-medium tabular-nums">
                          {(inv.totalPaisa / 100).toLocaleString()}
                        </td>
                        <td className="p-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                          {(inv.paidPaisa / 100).toLocaleString()}
                        </td>
                        <td className="p-3 text-right font-bold tabular-nums text-[#7a2e4a] dark:text-[#d77a9c]">
                          {(inv.outstandingPaisa / 100).toLocaleString()}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleOpenInvoiceDoc(inv.invoiceId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-[11px] font-medium text-[#7a2e4a] dark:text-[#d77a9c] hover:bg-[#7a2e4a]/10"
                          >
                            <FileText className="w-3 h-3" />
                            <span>View</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 5: ACCOUNT & LEDGER ================= */}
        {activeTab === "account" && account && (
          <div className="space-y-5">
            {/* Balance Overview Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
                <span className="text-xs text-[#6b625e] dark:text-[#a59b96]">Invoiced Total</span>
                <div className="text-lg font-extrabold tabular-nums mt-1 text-[#1d1a19] dark:text-[#f2eeec]">
                  PKR {(account.balance.invoicedPaisa / 100).toLocaleString()}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
                <span className="text-xs text-[#6b625e] dark:text-[#a59b96]">Total Paid</span>
                <div className="text-lg font-extrabold tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                  PKR {(account.balance.paidPaisa / 100).toLocaleString()}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
                <span className="text-xs text-[#6b625e] dark:text-[#a59b96]">Outstanding Balance</span>
                <div className="text-lg font-extrabold tabular-nums mt-1 text-[#7a2e4a] dark:text-[#d77a9c]">
                  PKR {(account.balance.balancePaisa / 100).toLocaleString()}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
                <span className="text-xs text-[#6b625e] dark:text-[#a59b96]">Overdue Amount</span>
                <div className="text-lg font-extrabold tabular-nums mt-1 text-rose-600 dark:text-rose-400">
                  PKR {(account.balance.overduePaisa / 100).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Installments Table */}
            {account.installments.length > 0 && (
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                <h3 className="font-bold text-sm">Payment Plan Installments</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#faf7f5] dark:bg-[#171413] border-b border-[#e6dfdb] dark:border-[#3a3330] font-semibold text-[#6b625e] dark:text-[#a59b96]">
                      <tr>
                        <th className="p-2.5">Invoice</th>
                        <th className="p-2.5">Schedule</th>
                        <th className="p-2.5">Due Date</th>
                        <th className="p-2.5 text-right">Due (PKR)</th>
                        <th className="p-2.5 text-right">Remaining (PKR)</th>
                        <th className="p-2.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                      {account.installments.map((inst, i) => (
                        <tr key={i}>
                          <td className="p-2.5 font-mono">{inst.invoiceNumber}</td>
                          <td className="p-2.5">
                            {inst.seq} of {inst.ofCount}
                          </td>
                          <td className="p-2.5">{new Date(inst.dueOn).toLocaleDateString()}</td>
                          <td className="p-2.5 text-right font-medium tabular-nums">
                            {(inst.amountDuePaisa / 100).toLocaleString()}
                          </td>
                          <td className="p-2.5 text-right font-bold tabular-nums text-[#7a2e4a] dark:text-[#d77a9c]">
                            {(inst.remainingPaisa / 100).toLocaleString()}
                          </td>
                          <td className="p-2.5 text-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/5 dark:bg-white/5">
                              {inst.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Payment Receipts */}
            {account.payments.length > 0 && (
              <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3">
                <h3 className="font-bold text-sm">Payment Receipts</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#faf7f5] dark:bg-[#171413] border-b border-[#e6dfdb] dark:border-[#3a3330] font-semibold text-[#6b625e] dark:text-[#a59b96]">
                      <tr>
                        <th className="p-2.5">Receipt #</th>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Method</th>
                        <th className="p-2.5 text-right">Amount (PKR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                      {account.payments.map((p, i) => (
                        <tr key={i}>
                          <td className="p-2.5 font-mono font-bold">{p.receiptNumber}</td>
                          <td className="p-2.5 text-[#6b625e] dark:text-[#a59b96]">
                            {new Date(p.paidAt).toLocaleDateString()}
                          </td>
                          <td className="p-2.5 uppercase font-medium">{p.method}</td>
                          <td className="p-2.5 text-right font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {(p.amountPaisa / 100).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Invoice Document Modal */}
      {viewingInvoiceDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Commercial Invoice Document</span>
              </h3>
              <button
                type="button"
                onClick={() => setViewingInvoiceDoc(null)}
                className="p-1 rounded-lg text-[#6b625e] hover:text-[#1d1a19] dark:hover:text-[#f2eeec]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {viewingInvoiceDoc.loading ? (
              <div className="py-12 text-center text-xs text-[#6b625e] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[#7a2e4a]" />
                <span>Generating invoice view...</span>
              </div>
            ) : viewingInvoiceDoc.data ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] border border-[#e6dfdb]/60 dark:border-[#3a3330] space-y-1 font-mono text-[11px]">
                  <pre className="whitespace-pre-wrap break-all">
                    {JSON.stringify(viewingInvoiceDoc.data, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#6b625e]">No document data available.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
