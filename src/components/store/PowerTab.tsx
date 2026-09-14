"use client";
import { useGameShallow } from "@/state/useGame";
import { HARDWARE_FAMILIES } from "@/data/hardware";
import type { HardwareFamily } from "@/game/types";
import { formatCps, formatWatts } from "@/game/format";
import { PowerMeter } from "@/components/hero/PowerMeter";
import { CreditsIcon } from "@/components/brand/CreditsIcon";
import { cn } from "@/lib/utils";
import { UpgradeRow } from "./UpgradeRow";
import { useFamilyDraw, useVisibleUpgrades } from "./storeHooks";

const FAMILY_TITLE = Object.fromEntries(
  HARDWARE_FAMILIES.map((f) => [f.id, f.label]),
) as Record<HardwareFamily, string>;

/** Power meter, PSU/cooling upgrades and a per-family draw breakdown. */
export function PowerTab() {
  const upgrades = useVisibleUpgrades("power");
  const rows = useFamilyDraw();
  const power = useGameShallow((_s, d) => ({
    draw: d.powerDraw,
    budget: d.powerBudget,
    throttled: d.throttled,
  }));
  const totalDraw = rows.reduce((sum, r) => sum + r.watts, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <div className="pt-3">
        <PowerMeter />
      </div>

      <section className="mt-4" aria-label="Power and cooling upgrades">
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-smoke-600 uppercase">
          Power &amp; cooling
        </h3>
        {upgrades.length === 0 ? (
          <p className="rounded-lg border border-dashed border-charcoal-400 px-3 py-3 text-[11px] text-smoke-700">
            The breaker is fine. For now. New PSUs and coolers show up as the
            rack grows.
          </p>
        ) : (
          upgrades.map((id) => <UpgradeRow key={id} id={id} />)
        )}
      </section>

      <section className="mt-4" aria-label="Draw by family">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold tracking-[0.08em] text-smoke-600 uppercase">
            Draw by family
          </h3>
          <span
            className={cn(
              "text-[11px] tabular-nums",
              power.throttled ? "text-slot-vae" : "text-smoke-600",
            )}
          >
            {formatWatts(power.draw)} / {formatWatts(power.budget)}
            {power.throttled && " · rack off"}
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-charcoal-400">
          <table className="w-full table-fixed border-collapse text-[11px] tabular-nums">
            <colgroup>
              <col />
              <col className="w-11" />
              <col className="w-[5.5rem]" />
              <col className="w-14" />
            </colgroup>
            <thead>
              <tr className="bg-charcoal-700 text-[10px] font-semibold tracking-[0.08em] text-smoke-700 uppercase">
                <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                  Family
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-semibold"
                >
                  Units
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-semibold"
                  title="Draw and share of the total"
                >
                  Draw
                </th>
                <th
                  scope="col"
                  className="px-2 py-1.5 text-right font-semibold"
                  title="Credits per second per watt"
                >
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <CreditsIcon
                      size={9}
                      aria-hidden="true"
                      className="text-credits"
                    />
                    <span aria-hidden="true">/W</span>
                    <span className="sr-only">Credits per second per watt</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const perWatt = r.watts > 0 ? r.cps / r.watts : Infinity;
                return (
                  <tr
                    key={r.family}
                    className="border-t border-charcoal-400/60 text-smoke-100"
                  >
                    <th
                      scope="row"
                      className="truncate px-2 py-1.5 text-left font-semibold"
                      title={FAMILY_TITLE[r.family] ?? r.family}
                    >
                      {FAMILY_TITLE[r.family] ?? r.family}
                    </th>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap text-smoke-600">
                      {r.units}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {formatWatts(r.watts)}
                      <span className="text-smoke-600">
                        {" "}
                        · {Math.round(r.share * 100)}%
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap text-smoke-600">
                      {Number.isFinite(perWatt) ? formatCps(perWatt) : "free"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-2 py-3 text-center text-smoke-700"
                  >
                    Nothing plugged in.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr className="border-t border-charcoal-400 bg-charcoal-700 font-semibold text-smoke-100">
                  <th scope="row" className="px-2 py-1.5 text-left">
                    Total
                  </th>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap text-smoke-600">
                    {rows.reduce((s, r) => s + r.units, 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {formatWatts(totalDraw)}
                    <span className="text-smoke-600"> · 100%</span>
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap text-smoke-600">
                    {totalDraw > 0
                      ? formatCps(
                          rows.reduce((s, r) => s + r.cps, 0) / totalDraw,
                        )
                      : "free"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
