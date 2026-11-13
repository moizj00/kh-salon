import React, { useState } from "react";
import { AlertCircle, Check, FileSpreadsheet, RefreshCw, Upload, X } from "lucide-react";
import { bulkImportSalonsApi } from "../lib/api";

interface SalonBulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
  showToast: (msg: string, type?: "ok" | "info" | "warn") => void;
}

interface ParsedSalonRow {
  name: string;
  area: string;
  contact: string;
  phone: string;
  creditLimit: number;
}

const SAMPLE_CSV = `Salon Name,Area,Contact Person,Phone,Credit Limit
Sanam Hair Studio,Clifton Block 4,Sanam Sheikh,0300-1122334,50000
Enzo Men's Grooming Lounge,DHA Phase 6,Bilal Enzo,0321-9988776,75000
Glamour Waves Salon & Spa,Bahadurabad,Farida Naz,0333-5566778,40000
The Barber Shop Studio,Gulshan Block 10,Kashif Ali,0345-2233445,30000`;

export const SalonBulkImportModal: React.FC<SalonBulkImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  showToast,
}) => {
  const [rawText, setRawText] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedSalonRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  if (!isOpen) return null;

  const parseData = (text: string) => {
    setParseError(null);
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setParsedRows([]);
      return;
    }

    const rows: ParsedSalonRow[] = [];
    let startIdx = 0;

    // Check if first row is header
    const firstLineLower = lines[0].toLowerCase();
    if (firstLineLower.includes("name") || firstLineLower.includes("salon") || firstLineLower.includes("area")) {
      startIdx = 1;
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      // Detect tab or comma
      let cols: string[];
      if (line.includes("\t")) {
        cols = line.split("\t").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      } else {
        // Basic CSV split
        cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      }

      if (cols.length === 0 || !cols[0]) continue;

      const name = cols[0];
      const area = cols[1] || "Karachi";
      const contact = cols[2] || "Owner";
      const phone = cols[3] || "0300-0000000";
      const creditLimit = parseInt(cols[4] || "25000", 10) || 25000;

      rows.push({
        name,
        area,
        contact,
        phone,
        creditLimit,
      });
    }

    if (rows.length === 0) {
      setParseError("Could not detect valid salon rows from input. Please check the column format.");
    }
    setParsedRows(rows);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setRawText(val);
    parseData(val);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRawText(content);
        parseData(content);
      }
    };
    reader.onerror = () => {
      setParseError("Failed to read file.");
    };
    reader.readAsText(file);
  };

  const handleLoadSample = () => {
    setRawText(SAMPLE_CSV);
    parseData(SAMPLE_CSV);
  };

  const handleSubmit = async () => {
    if (parsedRows.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await bulkImportSalonsApi(parsedRows);
      showToast(res.message, "ok");
      onSuccess(res.count);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bulk import failed.", "warn");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-[#211d1b] rounded-3xl border border-[#e6dfdb] dark:border-[#3a3330] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#e6dfdb] dark:border-[#3a3330] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#7a2e4a]/10 dark:bg-[#7a2e4a]/30 flex items-center justify-center text-[#7a2e4a] dark:text-[#d77a9c]">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-[#1d1a19] dark:text-[#f2eeec]">
                Bulk Import Salon Roster
              </h2>
              <p className="text-xs text-[#6b625e] dark:text-[#a59b96]">
                Upload CSV or paste rows directly from Excel / Google Sheets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[#6b625e]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="cursor-pointer px-3 py-1.5 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] font-medium hover:border-[#7a2e4a] flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-[#7a2e4a] dark:text-[#d77a9c]" />
                <span>Upload CSV / TSV</span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={handleLoadSample}
                className="px-3 py-1.5 rounded-xl border border-dashed border-[#7a2e4a]/40 text-[#7a2e4a] dark:text-[#d77a9c] hover:bg-[#7a2e4a]/5 font-medium"
              >
                Load Sample Karachi Salons
              </button>
            </div>

            <span className="text-[11px] text-[#6b625e] dark:text-[#a59b96]">
              Expected: Name, Area, Contact, Phone, Credit Limit
            </span>
          </div>

          {/* Text Area */}
          <div>
            <textarea
              rows={4}
              value={rawText}
              onChange={handleTextChange}
              placeholder="Paste comma or tab-separated rows here..."
              className="w-full p-3 font-mono text-[11px] rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413] focus:outline-none focus:ring-1 focus:ring-[#7a2e4a]"
            />
          </div>

          {parseError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Parsed Rows Preview */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between font-semibold text-xs">
                <span>Parsed Salons Preview ({parsedRows.length})</span>
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-normal">
                  Ready to import
                </span>
              </div>

              <div className="border border-[#e6dfdb] dark:border-[#3a3330] rounded-xl overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-[#f4efeb] dark:bg-[#1e1b19] border-b border-[#e6dfdb] dark:border-[#3a3330]">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Salon Name</th>
                      <th className="py-2 px-3 font-semibold">Area</th>
                      <th className="py-2 px-3 font-semibold">Contact</th>
                      <th className="py-2 px-3 font-semibold">Phone</th>
                      <th className="py-2 px-3 font-semibold text-right">Credit Limit (PKR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6dfdb]/60 dark:divide-[#3a3330]">
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-black/5 dark:hover:bg-white/5">
                        <td className="py-2 px-3 font-medium">{row.name}</td>
                        <td className="py-2 px-3">{row.area}</td>
                        <td className="py-2 px-3">{row.contact}</td>
                        <td className="py-2 px-3 font-mono">{row.phone}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          PKR {row.creditLimit.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5]/50 dark:bg-[#171413]/50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={parsedRows.length === 0 || isSubmitting}
            onClick={handleSubmit}
            className="px-4 py-2 rounded-xl bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5 shadow-sm hover:bg-[#66243d]"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Importing Ledger...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Import {parsedRows.length} Salons</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
