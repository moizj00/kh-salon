import React, { useRef, useState, useEffect } from "react";
import { Check, RotateCcw } from "lucide-react";

interface SignaturePadProps {
  onCapture: (signatureBase64: string) => void;
  salonName: string;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({ onCapture, salonName }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High DPI scaling
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
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
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
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
    if (!isDrawing.current) return;
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

  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = canvas.toDataURL("image/png");
    onCapture(dataUrl);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-[#6b625e] dark:text-[#a59b96]">
        Customer Acknowledgement for <strong>{salonName}</strong>: Sign below to confirm goods received in sound condition.
      </div>

      <div className="border border-[#e6dfdb] dark:border-[#3a3330] rounded-xl overflow-hidden bg-white dark:bg-[#171413] shadow-inner">
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

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#e6dfdb] dark:border-[#3a3330] text-xs font-medium text-[#6b625e] hover:text-[#1d1a19]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>

        <button
          type="button"
          onClick={confirm}
          disabled={!hasDrawn}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7a2e4a] text-white text-xs font-semibold disabled:opacity-40"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Attach Signature</span>
        </button>
      </div>
    </div>
  );
};
