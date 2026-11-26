import type { ReactNode } from "react";

interface VitalMetricCardProps {
  label: string;
  value: string;
  unit?: string;
  baselineText: string;
  statusNote: string;
  tone: "normal" | "warning" | "critical";
  icon: ReactNode;
}

export function VitalMetricCard({
  label,
  value,
  unit,
  baselineText,
  statusNote,
  tone,
  icon,
}: VitalMetricCardProps) {
  const toneText =
    tone === "critical"
      ? "text-red-700"
      : tone === "warning"
      ? "text-amber-700"
      : "text-arova-green-dark";

  return (
    <div className="bg-white border border-arova-border rounded-xl p-5 flex flex-col justify-between gap-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-arova-muted">{label}</span>
        <span
          className="w-8 h-8 rounded-lg bg-arova-mint text-arova-green flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-arova-text font-mono tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium text-arova-muted font-mono">{unit}</span>
        )}
      </div>

      <div className="pt-3 border-t border-arova-border/70 flex items-center justify-between gap-2 text-xs">
        <span className="text-arova-muted truncate">{baselineText}</span>
        <span className={`font-semibold whitespace-nowrap shrink-0 ${toneText}`}>
          {statusNote}
        </span>
      </div>
    </div>
  );
}
