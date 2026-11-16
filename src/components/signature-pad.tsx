import React, { useEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";

export interface SignatureCapturePayload {
  dataUrl: string;
  outcome: "signed" | "refused" | "unable";
  signatoryName: string;
  designation: string;
  note?: string;
}

interface SignaturePadProps {
  onCapture: (payload: SignatureCapturePayload) => void;
  salonName: string;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({ onCapture, salonName }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [outcome, setOutcome] = useState<"signed" | "refused" | "unable">("signed");
  const [signatoryName, setSignatoryName] = useState("Salon Manager");
  const [designation, setDesignation] = useState("Manager");
  const [note, setNote] = useState("");
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, rect.width * 2);
    canvas.height = Math.max(140, rect.height * 2);
    ctx.scale(2, 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1d1a19";
    ctx.lineWidth = 2.5;
  }, []);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (outcome !== "signed") return;
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setHasDrawn(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || outcome !== "signed") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const canConfirm =
    signatoryName.trim().length >= 2 &&
    designation.trim().length >= 2 &&
    (outcome !== "signed" || hasDrawn);

  const confirm = () => {
    if (!canConfirm) return;
    const dataUrl = outcome === "signed" && canvasRef.current ? canvasRef.current.toDataURL("image/png") : "";
    onCapture({
      dataUrl,
      outcome,
      signatoryName: signatoryName.trim(),
      designation: designation.trim(),
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="text-[#6b625e] dark:text-[#a59b96]">
        Customer Acknowledgement for <strong>{salonName}</strong>: record signatory details and capture receiver signature.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="block font-semibold mb-1">Outcome</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as "signed" | "refused" | "unable")}
            className="w-full px-2.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
          >
            <option value="signed">Signed by Receiver</option>
            <option value="refused">Refused Signature</option>
            <option value="unable">Unable to Sign</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Signatory Name</label>
          <input
            type="text"
            required
            value={signatoryName}
            onChange={(e) => setSignatoryName(e.target.value)}
            placeholder="Full Name"
            className="w-full px-2.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Designation</label>
          <input
            type="text"
            required
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="Owner / Manager / Reception"
            className="w-full px-2.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
          />
        </div>
      </div>

      {outcome === "signed" && (
        <div className="border border-[#e6dfdb] dark:border-[#3a3330] rounded-xl overflow-hidden bg-white dark:bg-[#171413]">
          <canvas
            ref={canvasRef}
            className="w-full h-36 touch-none cursor-crosshair block"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
      )}

      <div>
        <label className="block font-semibold mb-1">Delivery Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={outcome === "signed" ? "Optional remarks..." : "Reason signature could not be captured..."}
          className="w-full px-2.5 py-2 rounded-xl border border-[#e6dfdb] dark:border-[#3a3330] bg-[#faf7f5] dark:bg-[#171413]"
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={clear}
          disabled={outcome !== "signed"}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium text-[#6b625e] hover:text-[#1d1a19] disabled:opacity-40"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>

        <button
          type="button"
          onClick={confirm}
          disabled={!canConfirm}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-40"
        >
          <Check className="w-3.5 h-3.5" />
          <span>{outcome === "signed" ? "Attach Signature" : "Record Outcome"}</span>
        </button>
      </div>
    </div>
  );
};
