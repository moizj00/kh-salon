import React, { useCallback, useEffect, useState } from "react";
import {
  approveOfficeDelivery,
  assignSalonRep,
  createOfficeInvitation,
  decideOfficeApproval,
  decideOfficeDevice,
  decideOfficeSignup,
  fetchInvoiceDocument,
  fetchLowStockAlerts,
  fetchOfficeCommission,
  fetchOfficeCommissionReps,
  fetchOfficeDeliverySignature,
  fetchOfficeDevices,
  fetchOfficeInvitations,
  fetchOfficeInvoices,
  fetchOfficePendingApprovals,
  fetchOfficePendingDeliveries,
  fetchOfficePendingSignups,
  fetchOfficePendingStock,
  fetchOfficeSignatureImage,
  fetchStaffUsers,
  fetchStockBalances,
  fetchStockLocations,
  ownerAdjustStock,
  proposeOfficeStockIssue,
  recordOfficeCommissionPayment,
  rejectOfficeDelivery,
  resolveOfficePendingStock,
  reverseOfficeCommissionPayment,
  revokeOfficeInvitation,
  setOfficeCommissionRate,
  setOfficeMemberStatus,
  setOfficeReorderPoint,
  setOfficeSalonPrice,
} from "../lib/api";
import type {
  DeliverySignatureStatus,
  LowStockAlertRow,
  OfficeApprovalRequestRow,
  OfficeCommissionRepSummary,
  OfficeDeviceRow,
  OfficeInvitationRow,
  OfficePendingDelivery,
  PendingReturnStockRow,
  SalonInvoiceRow,
  SalonSignupRequestRow,
  SKU,
  StockBalanceRow,
  StockLocationRow,
  UserProfile,
  UserRole,
} from "../server/types";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Key,
  Layers,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
  X,
} from "lucide-react";

interface OfficeOperationsPanelsProps {
  currentUser: UserProfile;
  skus: SKU[];
  salons: Array<{ id: string; name: string }>;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
  onRefreshParent?: () => void;
}

type OfficeTab =
  | "deliveries"
  | "returns"
  | "governance"
  | "inventory"
  | "commissions"
  | "invoices";

export const OfficeOperationsPanels: React.FC<OfficeOperationsPanelsProps> = ({
  currentUser,
  skus,
  salons,
  showToast,
  onRefreshParent,
}) => {
  const [activeTab, setActiveTab] = useState<OfficeTab>("deliveries");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab 1: Pending Deliveries & Signatures
  const [pendingDeliveries, setPendingDeliveries] = useState<OfficePendingDelivery[]>([]);
  const [inspectingSigSubmissionId, setInspectingSigSubmissionId] = useState<string | null>(null);
  const [sigStatus, setSigStatus] = useState<DeliverySignatureStatus | null>(null);
  const [sigImageUrl, setSigImageUrl] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingSubmissionId, setRejectingSubmissionId] = useState<string | null>(null);

  // Tab 2: Returns / Pending Stock
  const [pendingStock, setPendingStock] = useState<PendingReturnStockRow[]>([]);
  const [resolvingItem, setResolvingItem] = useState<PendingReturnStockRow | null>(null);
  const [returnOutcome, setReturnOutcome] = useState<"returned_to_bag" | "returned_to_warehouse" | "missing">("returned_to_warehouse");
  const [returnNote, setReturnNote] = useState("");

  // Tab 3: Governance (Signups, Invites, Devices, Approvals)
  const [pendingSignups, setPendingSignups] = useState<SalonSignupRequestRow[]>([]);
  const [invitations, setInvitations] = useState<OfficeInvitationRow[]>([]);
  const [devices, setDevices] = useState<OfficeDeviceRow[]>([]);
  const [officeApprovals, setOfficeApprovals] = useState<OfficeApprovalRequestRow[]>([]);
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; full_name: string; role: string }>>([]);

  // New Invite Modal State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteKind, setInviteKind] = useState<"rep" | "salon">("rep");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSalonId, setInviteSalonId] = useState("");

  // Tab 4: Warehouse Inventory & Issues
  const [stockLocations, setStockLocations] = useState<StockLocationRow[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalanceRow[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlertRow[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");

  // Stock issue creation
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [fromLocId, setFromLocId] = useState("");
  const [toLocId, setToLocId] = useState("");
  const [issueSkuId, setIssueSkuId] = useState("");
  const [issueQty, setIssueQty] = useState(1);
  const [issueNote, setIssueNote] = useState("");

  // Owner stock adjustment
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjLocId, setAdjLocId] = useState("");
  const [adjSkuId, setAdjSkuId] = useState("");
  const [adjDelta, setAdjDelta] = useState(0);
  const [adjReason, setAdjReason] = useState("");

  // Tab 5: Commissions
  const [commissionReps, setCommissionReps] = useState<OfficeCommissionRepSummary[]>([]);
  const [selectedRepId, setSelectedRepId] = useState<string>("");
  const [repStatement, setRepStatement] = useState<any | null>(null);
  const [commPaymentAmount, setCommPaymentAmount] = useState<number>(0);
  const [commPaymentNote, setCommPaymentNote] = useState("");

  // Tab 6: Invoices
  const [officeInvoices, setOfficeInvoices] = useState<SalonInvoiceRow[]>([]);
  const [viewingInvoiceDoc, setViewingInvoiceDoc] = useState<Record<string, unknown> | null>(null);

  const isOwner = currentUser.role === "owner";

  // Data loader by tab
  const loadTab = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "deliveries") {
        const dels = await fetchOfficePendingDeliveries();
        setPendingDeliveries(dels);
      } else if (activeTab === "returns") {
        const ret = await fetchOfficePendingStock();
        setPendingStock(ret);
      } else if (activeTab === "governance") {
        const [su, inv, dev, apprs, st] = await Promise.all([
          fetchOfficePendingSignups(),
          fetchOfficeInvitations(),
          fetchOfficeDevices(),
          fetchOfficePendingApprovals(),
          fetchStaffUsers(),
        ]);
        setPendingSignups(su);
        setInvitations(inv);
        setDevices(dev);
        setOfficeApprovals(apprs);
        setStaffUsers(st);
      } else if (activeTab === "inventory") {
        const [locs, bals, alerts] = await Promise.all([
          fetchStockLocations(),
          fetchStockBalances(),
          fetchLowStockAlerts(),
        ]);
        setStockLocations(locs);
        setStockBalances(bals);
        setLowStockAlerts(alerts);
        if (locs.length > 0 && !selectedLocationId) {
          setSelectedLocationId(locs[0]!.id);
        }
      } else if (activeTab === "commissions") {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const to = now.toISOString().slice(0, 10);
        const reps = await fetchOfficeCommissionReps(from, to);
        setCommissionReps(reps);
        if (reps.length > 0 && !selectedRepId) {
          setSelectedRepId(reps[0]!.repId);
          const stmt = await fetchOfficeCommission(reps[0]!.repId, from, to);
          setRepStatement(stmt);
        }
      } else if (activeTab === "invoices") {
        const invs = await fetchOfficeInvoices();
        setOfficeInvoices(invs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operational data.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedLocationId, selectedRepId]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  // Handle Delivery Approval / Rejection
  const handleApproveDelivery = async (submissionId: string) => {
    try {
      await approveOfficeDelivery(submissionId);
      showToast("Delivery verified and approved. Invoice issued to salon.", "ok");
      await loadTab();
      onRefreshParent?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not approve delivery.", "warn");
    }
  };

  const handleRejectDelivery = async (submissionId: string) => {
    if (!rejectReason.trim()) {
      showToast("Please enter a reason for delivery rejection.", "warn");
      return;
    }
    try {
      await rejectOfficeDelivery(submissionId, rejectReason.trim());
      showToast("Delivery rejected and returned for rep review.", "ok");
      setRejectingSubmissionId(null);
      setRejectReason("");
      await loadTab();
      onRefreshParent?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not reject delivery.", "warn");
    }
  };

  const handleInspectSignature = async (submissionId: string) => {
    setInspectingSigSubmissionId(submissionId);
    setSigStatus(null);
    setSigImageUrl(null);
    try {
      const status = await fetchOfficeDeliverySignature(submissionId);
      setSigStatus(status);
      if (status.signatureId && status.hasPicture) {
        const img = await fetchOfficeSignatureImage(status.signatureId);
        setSigImageUrl(img.pngBase64);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not load signature.", "warn");
    }
  };

  // Handle Returns Resolution
  const handleResolveStock = async () => {
    if (!resolvingItem) return;
    try {
      await resolveOfficePendingStock({
        submissionId: resolvingItem.submissionId,
        skuId: resolvingItem.skuId,
        qty: resolvingItem.unsettled,
        outcome: returnOutcome,
        note: returnNote.trim() || undefined,
      });
      showToast("Pending return stock resolved.", "ok");
      setResolvingItem(null);
      setReturnNote("");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not resolve stock.", "warn");
    }
  };

  // Handle Device Approval / Revocation
  const handleDecideDevice = async (device: OfficeDeviceRow, approve: boolean) => {
    try {
      await decideOfficeDevice(device.id, approve, approve ? "Approved by office" : "Revoked by office");
      showToast(`Device ${device.label ?? device.id} ${approve ? "approved" : "revoked"}.`, "ok");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not update device status.", "warn");
    }
  };

  // Handle Governance Signup
  const handleDecideSignup = async (requestId: string, approve: boolean) => {
    try {
      await decideOfficeSignup({ requestId, approve, reason: approve ? "Approved" : "Rejected" });
      showToast(`Signup request ${approve ? "approved" : "rejected"}.`, "ok");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not decide signup.", "warn");
    }
  };

  // Handle Invitations
  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    try {
      await createOfficeInvitation({
        kind: inviteKind,
        fullName: inviteName.trim(),
        email: inviteEmail.trim(),
        salonId: inviteKind === "salon" ? inviteSalonId || undefined : undefined,
      });
      showToast(`Invitation sent to ${inviteEmail}.`, "ok");
      setShowInviteModal(false);
      setInviteName("");
      setInviteEmail("");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not create invitation.", "warn");
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      await revokeOfficeInvitation(id, "Revoked by manager");
      showToast("Invitation revoked.", "info");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not revoke invitation.", "warn");
    }
  };

  // Handle Stock Issue Proposal
  const handleProposeStockIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromLocId || !toLocId || !issueSkuId || issueQty <= 0) return;
    try {
      await proposeOfficeStockIssue({
        fromLocationId: fromLocId,
        toLocationId: toLocId,
        note: issueNote.trim() || undefined,
        items: [{ sku_id: issueSkuId, qty: issueQty }],
      });
      showToast("Stock issue proposed for recipient blind count confirmation.", "ok");
      setShowIssueModal(false);
      setIssueNote("");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not propose stock issue.", "warn");
    }
  };

  // Handle Owner Stock Adjustment
  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjLocId || !adjSkuId || adjDelta === 0 || !adjReason.trim()) return;
    try {
      await ownerAdjustStock({
        locationId: adjLocId,
        skuId: adjSkuId,
        qtyDelta: adjDelta,
        reason: adjReason.trim(),
      });
      showToast("Warehouse stock adjusted and logged to audit trail.", "ok");
      setShowAdjustModal(false);
      setAdjReason("");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not adjust stock.", "warn");
    }
  };

  // Handle Commission Payment
  const handleRecordCommPayment = async () => {
    if (!selectedRepId || commPaymentAmount <= 0) return;
    try {
      await recordOfficeCommissionPayment(
        selectedRepId,
        commPaymentAmount,
        commPaymentNote.trim() || undefined,
      );
      showToast(`Commission payment of PKR ${commPaymentAmount.toLocaleString()} recorded.`, "ok");
      setCommPaymentAmount(0);
      setCommPaymentNote("");
      await loadTab();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not record payment.", "warn");
    }
  };

  // Handle View Invoice Document
  const handleViewInvoice = async (invoiceId: string) => {
    try {
      const doc = await fetchInvoiceDocument(invoiceId);
      setViewingInvoiceDoc(doc);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not fetch invoice.", "warn");
    }
  };

  return (
    <div className="space-y-4">
      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("deliveries")}
          className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === "deliveries"
              ? "bg-[#7a2e4a] text-white shadow-xs"
              : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>Pending Deliveries ({pendingDeliveries.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("returns")}
          className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === "returns"
              ? "bg-[#7a2e4a] text-white shadow-xs"
              : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
          }`}
        >
          <Boxes className="w-3.5 h-3.5" />
          <span>Unsettled Returns ({pendingStock.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("inventory")}
          className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === "inventory"
              ? "bg-[#7a2e4a] text-white shadow-xs"
              : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Warehouse & Stock Issues</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("governance")}
          className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === "governance"
              ? "bg-[#7a2e4a] text-white shadow-xs"
              : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Governance & Devices</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("commissions")}
          className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === "commissions"
              ? "bg-[#7a2e4a] text-white shadow-xs"
              : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Commissions Ledger</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("invoices")}
          className={`min-h-[38px] px-3.5 rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === "invoices"
              ? "bg-[#7a2e4a] text-white shadow-xs"
              : "bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] text-[#6b625e] dark:text-[#a59b96]"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Official Invoices</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ================= TAB 1: PENDING DELIVERIES & SIGNATURES ================= */}
      {activeTab === "deliveries" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm">Delivery Submissions Pending Office Verification</h3>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Inspect GPS evidence, signatory identity, and attached digital signature before approval
              </p>
            </div>
            <button
              type="button"
              onClick={loadTab}
              className="p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          {pendingDeliveries.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
              All delivery submissions have been reviewed and approved.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {pendingDeliveries.map((del) => (
                <div
                  key={del.submissionId}
                  className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                          Submission #{del.submissionId.slice(0, 8)}
                        </span>
                        <h4 className="font-bold text-sm text-[#1d1a19] dark:text-[#f2eeec]">
                          {del.salonName}
                        </h4>
                      </div>
                      <div className="font-extrabold text-sm text-[#7a2e4a] dark:text-[#d77a9c] tabular-nums">
                        PKR {(del.totalPaisa / 100).toLocaleString()}
                      </div>
                    </div>

                    <div className="text-xs space-y-1 text-[#6b625e] dark:text-[#a59b96]">
                      <div>
                        <strong className="text-[#1d1a19] dark:text-[#f2eeec]">Rep:</strong> {del.repName} ·{" "}
                        <strong className="text-[#1d1a19] dark:text-[#f2eeec]">Signatory:</strong> {del.receivedByName}
                      </div>
                      <div className="flex items-center gap-2">
                        {del.distanceFromPinM !== null && (
                          <span>
                            Distance to Pin: <strong>{del.distanceFromPinM}m</strong>
                          </span>
                        )}
                        {del.mockLocation && (
                          <span className="text-rose-600 font-bold">Mock Location Flagged</span>
                        )}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[#faf7f5] dark:bg-[#171413] text-xs space-y-1">
                      {del.lines.map((l, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>
                            {l.qty}x {l.variant}
                          </span>
                          <span className="font-medium tabular-nums">
                            PKR {((l.unitPricePaisa * l.qty) / 100).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#e6dfdb]/60 dark:border-[#3a3330] space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleInspectSignature(del.submissionId)}
                        className="flex-1 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:border-[#7a2e4a]"
                      >
                        Inspect Signature
                      </button>

                      <button
                        type="button"
                        onClick={() => setRejectingSubmissionId(del.submissionId)}
                        className="px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 text-xs font-semibold"
                      >
                        Reject
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApproveDelivery(del.submissionId)}
                        className="px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                    </div>

                    {rejectingSubmissionId === del.submissionId && (
                      <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 space-y-2 text-xs">
                        <label className="font-semibold block text-rose-800 dark:text-rose-200">
                          Reason for Rejection:
                        </label>
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="e.g. Signature illegible, quantities mismatched..."
                          className="w-full p-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-[#171413]"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingSubmissionId(null);
                              setRejectReason("");
                            }}
                            className="px-2.5 py-1 text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectDelivery(del.submissionId)}
                            className="px-3 py-1 bg-rose-600 text-white rounded-lg font-semibold text-xs"
                          >
                            Confirm Rejection
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: UNSETTLED RETURNS ================= */}
      {activeTab === "returns" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
            <h3 className="font-bold text-sm">Unsettled Return Stock</h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              Products rejected, damaged or returned from deliveries awaiting warehouse disposition
            </p>
          </div>

          {pendingStock.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-[#e6dfdb] dark:border-[#3a3330] text-center text-xs text-[#6b625e] dark:text-[#a59b96]">
              No unsettled return stock currently recorded.
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingStock.map((row) => (
                <div
                  key={`${row.submissionId}-${row.skuId}`}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-[#1d1a19] dark:text-[#f2eeec]">
                      {row.unsettled}x SKU {row.skuCode}
                    </div>
                    <div className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
                      Salon: <strong>{row.salonName}</strong> · Rep: {row.repName} · Reason: {row.reason}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setResolvingItem(row)}
                    className="px-3.5 py-1.5 rounded-xl bg-[#7a2e4a] text-white font-semibold text-xs shadow-xs"
                  >
                    Resolve Stock
                  </button>
                </div>
              ))}
            </div>
          )}

          {resolvingItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3">
                <h3 className="font-bold text-sm">
                  Resolve Return: {resolvingItem.unsettled}x {resolvingItem.skuCode}
                </h3>
                <div>
                  <label className="block text-xs font-semibold mb-1">Target Disposition:</label>
                  <select
                    value={returnOutcome}
                    onChange={(e) => setReturnOutcome(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs"
                  >
                    <option value="returned_to_warehouse">Return to Central Warehouse</option>
                    <option value="returned_to_bag">Return to Rep Field Bag</option>
                    <option value="missing">Write-Off (Damaged / Missing)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Audit Note (optional):</label>
                  <input
                    type="text"
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                    placeholder="Inspection remarks..."
                    className="w-full p-2.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] text-xs"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setResolvingItem(null)}
                    className="flex-1 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleResolveStock}
                    className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold"
                  >
                    Confirm Resolution
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: GOVERNANCE & DEVICES ================= */}
      {activeTab === "governance" && (
        <div className="space-y-6">
          {/* Pending Signups */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm">Salon Partner Signups ({pendingSignups.length})</h3>
            {pendingSignups.length === 0 ? (
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">No pending salon signups.</p>
            ) : (
              <div className="space-y-2">
                {pendingSignups.map((su) => (
                  <div
                    key={su.requestId}
                    className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-sm">{su.salonName}</div>
                      <div className="text-[11px] text-[#6b625e]">
                        {su.contactName} · {su.email} · {su.address}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecideSignup(su.requestId, false)}
                        className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecideSignup(su.requestId, true)}
                        className="px-3 py-1.5 rounded-lg bg-[#7a2e4a] text-white font-semibold"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Device Authorizations */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm">Approved Staff Devices ({devices.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {devices.map((d) => (
                <div
                  key={d.id}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-3.5 h-3.5 text-[#7a2e4a]" />
                      <span className="font-bold truncate">{d.label ?? "Unlabeled Device"}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/5">
                        {d.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#6b625e] mt-0.5">
                      User: <strong>{d.userName}</strong> ({d.userRole}) · {d.platform ?? "Web"}
                    </div>
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    {d.status !== "approved" && (
                      <button
                        type="button"
                        onClick={() => handleDecideDevice(d, true)}
                        className="px-2.5 py-1 bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                      >
                        Approve
                      </button>
                    )}
                    {d.status !== "revoked" && (
                      <button
                        type="button"
                        onClick={() => handleDecideDevice(d, false)}
                        className="px-2.5 py-1 border border-rose-300 text-rose-600 rounded-lg text-xs"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Invitations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Invitations & Registration Codes</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(true)}
                className="px-3 py-1.5 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Invite</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-bold">{inv.fullName}</div>
                    <div className="text-[11px] text-[#6b625e]">
                      {inv.email} · Role: {inv.kind} · Status: {inv.status}
                    </div>
                  </div>

                  {inv.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(inv.id)}
                      className="px-2.5 py-1 text-xs text-rose-600 border border-rose-200 rounded-lg"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: WAREHOUSE INVENTORY & STOCK ISSUES ================= */}
      {activeTab === "inventory" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm">Warehouse Stock & Reorder Points</h3>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Manage central warehouse inventory, issue stock to rep bags, and configure reorders
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFromLocId(stockLocations[0]?.id || "");
                  setToLocId(stockLocations[1]?.id || "");
                  setIssueSkuId(skus[0]?.id || "");
                  setShowIssueModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold flex items-center gap-1 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Issue Stock to Bag</span>
              </button>

              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setAdjLocId(stockLocations[0]?.id || "");
                    setAdjSkuId(skus[0]?.id || "");
                    setShowAdjustModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-[#7a2e4a] text-[#7a2e4a] text-xs font-semibold"
                >
                  Owner Adjust Stock
                </button>
              )}
            </div>
          </div>

          {/* Low Stock Alerts */}
          {lowStockAlerts.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>Low Stock Reorder Alerts ({lowStockAlerts.length} SKUs below threshold)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {lowStockAlerts.map((al) => (
                  <div
                    key={al.skuId}
                    className="p-2.5 rounded-xl bg-white dark:bg-[#171413] border border-amber-200"
                  >
                    <div className="font-mono font-bold">{al.code}</div>
                    <div className="text-[11px] text-[#6b625e]">
                      On Hand: <strong>{al.onHand}</strong> (Reorder: {al.reorderPoint})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stock Balances Table */}
          <div className="overflow-x-auto rounded-2xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf7f5] dark:bg-[#171413] border-b border-[#e6dfdb] dark:border-[#3a3330] font-semibold text-[#6b625e]">
                <tr>
                  <th className="p-3">SKU Code</th>
                  <th className="p-3">Product Name</th>
                  <th className="p-3">Brand</th>
                  <th className="p-3 text-right">On Hand</th>
                  <th className="p-3 text-center">Reorder Point</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6dfdb]/60">
                {skus.map((sku) => {
                  const bal = stockBalances.find((b) => b.skuId === sku.id)?.onHand ?? sku.bag_qty ?? 0;
                  return (
                    <tr key={sku.id}>
                      <td className="p-3 font-mono font-bold">{sku.sku_code}</td>
                      <td className="p-3 font-semibold">{sku.name}</td>
                      <td className="p-3 text-[#6b625e]">{sku.brand ?? "Kiran"}</td>
                      <td className="p-3 text-right font-extrabold tabular-nums">{bal}</td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={async () => {
                            const val = window.prompt(`Set reorder point for ${sku.name}:`, "10");
                            if (val !== null) {
                              const rp = Number(val) || 0;
                              await setOfficeReorderPoint(sku.id, rp);
                              showToast(`Reorder point set to ${rp}.`, "ok");
                              await loadTab();
                            }
                          }}
                          className="px-2 py-0.5 rounded border border-[#e6dfdb] hover:border-[#7a2e4a]"
                        >
                          Config
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= TAB 5: COMMISSIONS ================= */}
      {activeTab === "commissions" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm">Representative Commissions Ledger</h3>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Track earned commissions against delivered invoices and disburse monthly payments
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Rep List */}
            <div className="space-y-2">
              {commissionReps.map((rep) => (
                <button
                  key={rep.repId}
                  type="button"
                  onClick={async () => {
                    setSelectedRepId(rep.repId);
                    const now = new Date();
                    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                    const to = now.toISOString().slice(0, 10);
                    const stmt = await fetchOfficeCommission(rep.repId, from, to);
                    setRepStatement(stmt);
                  }}
                  className={`w-full text-left p-3 rounded-xl border text-xs transition-colors ${
                    selectedRepId === rep.repId
                      ? "border-[#7a2e4a] bg-[#7a2e4a]/5 font-bold"
                      : "border-[#e6dfdb] bg-white dark:bg-[#211d1b]"
                  }`}
                >
                  <div className="font-bold text-sm">{rep.fullName}</div>
                  <div className="flex justify-between mt-1 text-[#6b625e]">
                    <span>Owed: PKR {(rep.owedPaisa / 100).toLocaleString()}</span>
                    <span>Paid: PKR {(rep.paidPaisa / 100).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Rep Statement & Payout Form */}
            <div className="lg:col-span-2 space-y-4">
              {repStatement && (
                <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] space-y-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-sm">Commission Statement</span>
                    <span className="font-mono text-[#6b625e]">
                      {repStatement.from} to {repStatement.to}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413]">
                      <span className="text-[#6b625e]">Total Earned</span>
                      <div className="text-sm font-extrabold tabular-nums mt-0.5">
                        PKR {(repStatement.earnedPaisa / 100).toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413]">
                      <span className="text-[#6b625e]">Total Paid</span>
                      <div className="text-sm font-extrabold tabular-nums mt-0.5 text-emerald-700">
                        PKR {(repStatement.paidPaisa / 100).toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413]">
                      <span className="text-[#6b625e]">Balance Owed</span>
                      <div className="text-sm font-extrabold tabular-nums mt-0.5 text-[#7a2e4a]">
                        PKR {(repStatement.owedPaisa / 100).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Disburse Payment Form */}
                  <div className="p-3.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-2 text-xs">
                    <span className="font-bold">Record Commission Payout</span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        placeholder="Amount (PKR)"
                        value={commPaymentAmount || ""}
                        onChange={(e) => setCommPaymentAmount(Math.max(0, Number(e.target.value) || 0))}
                        className="w-36 p-2 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums"
                      />
                      <input
                        type="text"
                        placeholder="Remarks / Bank reference..."
                        value={commPaymentNote}
                        onChange={(e) => setCommPaymentNote(e.target.value)}
                        className="flex-1 p-2 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                      />
                      <button
                        type="button"
                        onClick={handleRecordCommPayment}
                        disabled={commPaymentAmount <= 0}
                        className="px-4 py-2 bg-[#7a2e4a] text-white rounded-lg font-semibold disabled:opacity-50"
                      >
                        Disburse
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 6: OFFICIAL INVOICES ================= */}
      {activeTab === "invoices" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#211d1b] border border-[#e6dfdb] dark:border-[#3a3330] shadow-xs">
            <h3 className="font-bold text-sm">Commercial Invoices</h3>
            <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
              All commercial invoices generated from delivered customer orders
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#e6dfdb] dark:border-[#3a3330] bg-white dark:bg-[#211d1b]">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#faf7f5] dark:bg-[#171413] border-b border-[#e6dfdb] dark:border-[#3a3330] font-semibold text-[#6b625e]">
                <tr>
                  <th className="p-3">Invoice #</th>
                  <th className="p-3">Issued Date</th>
                  <th className="p-3 text-right">Total (PKR)</th>
                  <th className="p-3 text-right">Paid (PKR)</th>
                  <th className="p-3 text-right">Outstanding</th>
                  <th className="p-3 text-center">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6dfdb]/60">
                {officeInvoices.map((inv) => (
                  <tr key={inv.invoiceId}>
                    <td className="p-3 font-mono font-bold">{inv.number}</td>
                    <td className="p-3 text-[#6b625e]">
                      {new Date(inv.issuedAt).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums">
                      {(inv.totalPaisa / 100).toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums text-emerald-700">
                      {(inv.paidPaisa / 100).toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-extrabold tabular-nums text-[#7a2e4a]">
                      {(inv.outstandingPaisa / 100).toLocaleString()}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleViewInvoice(inv.invoiceId)}
                        className="px-2.5 py-1 rounded border border-[#e6dfdb] text-[#7a2e4a] hover:bg-[#7a2e4a]/10"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Signature Inspector Modal */}
      {inspectingSigSubmissionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Delivery Signature Verification</h3>
              <button
                type="button"
                onClick={() => setInspectingSigSubmissionId(null)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {sigStatus ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] space-y-1">
                  <div>
                    <strong>Signatory:</strong> {sigStatus.signatoryName ?? "Unknown"} (
                    {sigStatus.signatoryDesignation ?? "Receiver"})
                  </div>
                  <div>
                    <strong>Outcome:</strong> {sigStatus.outcome}
                  </div>
                  <div>
                    <strong>Signed At:</strong>{" "}
                    {sigStatus.signedAt ? new Date(sigStatus.signedAt).toLocaleString() : "N/A"}
                  </div>
                  {sigStatus.note && (
                    <div>
                      <strong>Note:</strong> {sigStatus.note}
                    </div>
                  )}
                </div>

                {sigImageUrl ? (
                  <div className="border border-[#e6dfdb] dark:border-[#3a3330] rounded-xl p-2 bg-white dark:bg-black/40 text-center">
                    <span className="text-[10px] text-[#6b625e] block mb-1">
                      Digital Signature Vector Image
                    </span>
                    <img
                      src={sigImageUrl}
                      alt="Customer Signature"
                      className="max-h-36 mx-auto object-contain"
                    />
                  </div>
                ) : (
                  <div className="p-4 border border-dashed border-[#e6dfdb] text-center text-[#6b625e]">
                    No signature image attached (Outcome: {sigStatus.outcome})
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-[#6b625e]">Loading signature...</div>
            )}
          </div>
        </div>
      )}

      {/* Invoice Document Viewer Modal */}
      {viewingInvoiceDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Commercial Invoice Details</h3>
              <button
                type="button"
                onClick={() => setViewingInvoiceDoc(null)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-[#faf7f5] dark:bg-[#171413] text-[11px] font-mono whitespace-pre-wrap break-all overflow-x-auto">
              {JSON.stringify(viewingInvoiceDoc, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Propose Stock Issue Modal */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleProposeStockIssue}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Propose Stock Issue</h3>
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold mb-1">Source Location:</label>
              <select
                value={fromLocId}
                onChange={(e) => setFromLocId(e.target.value)}
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                {stockLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.kind})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Target Location (Rep Bag / Warehouse):</label>
              <select
                value={toLocId}
                onChange={(e) => setToLocId(e.target.value)}
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                {stockLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.kind})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">Product SKU:</label>
                <select
                  value={issueSkuId}
                  onChange={(e) => setIssueSkuId(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  {skus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.sku_code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Quantity:</label>
                <input
                  type="number"
                  min={1}
                  value={issueQty}
                  onChange={(e) => setIssueQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Note (optional):</label>
              <input
                type="text"
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                placeholder="Reason or destination remarks..."
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white font-semibold"
              >
                Submit Issue
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Owner Stock Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleAdjustStock}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Owner Stock Adjustment (Audit-Logged)</h3>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold mb-1">Location:</label>
              <select
                value={adjLocId}
                onChange={(e) => setAdjLocId(e.target.value)}
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                {stockLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">SKU:</label>
                <select
                  value={adjSkuId}
                  onChange={(e) => setAdjSkuId(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  {skus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.sku_code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Delta (+/- Qty):</label>
                <input
                  type="number"
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(Number(e.target.value) || 0)}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-bold tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Mandatory Audit Reason:</label>
              <input
                type="text"
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g. Physical inventory reconciliation count..."
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white font-semibold"
              >
                Apply Adjustment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleCreateInvite}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#211d1b] p-5 shadow-2xl border border-[#e6dfdb] dark:border-[#3a3330] space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Issue User Invitation</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="p-1 rounded-lg text-[#6b625e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block font-semibold mb-1">User Role Kind:</label>
              <select
                value={inviteKind}
                onChange={(e) => setInviteKind(e.target.value as any)}
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              >
                <option value="rep">Field Sales Representative</option>
                <option value="salon">Salon Partner Owner/Manager</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Full Name:</label>
              <input
                type="text"
                required
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Person's name"
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Email Address:</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
              />
            </div>

            {inviteKind === "salon" && (
              <div>
                <label className="block font-semibold mb-1">Link to Salon:</label>
                <select
                  value={inviteSalonId}
                  onChange={(e) => setInviteSalonId(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
                >
                  <option value="">Select Salon...</option>
                  {salons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="flex-1 py-2 rounded-xl border border-[#e6dfdb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-[#7a2e4a] text-white font-semibold"
              >
                Send Invite
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
