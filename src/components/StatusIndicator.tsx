import { AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { AlertLevel } from "../types/smartcare.ts";

export function AlertLevelLabel({ level }: { level: AlertLevel }) {
  if (level === "Critical") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap shrink-0">
        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
        Critical
      </span>
    );
  }
  if (level === "Warning") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
        Warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-arova-green-dark whitespace-nowrap shrink-0">
      <CheckCircle2 className="w-4 h-4 text-arova-green shrink-0" aria-hidden="true" />
      Normal
    </span>
  );
}
