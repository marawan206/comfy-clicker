"use client";
/**
 * Bottom-centre stack of running random events. Reads `state.events.active` through a string key so
 * in-place mutations still re-render, and renders one row per event (except the trending spark,
 * which has its own floating badge, and a spot reclaim that reserved capacity already absorbed).
 * Each row shows the full card for a few seconds, then collapses to a compact pill so a five-minute
 * Model Drop never obstructs the workbench; a broken node stays expanded because it needs the Fix button.
 */
import { memo, useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Cloud,
  CloudOff,
  Download,
  Megaphone,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STRIPE_CLASS,
  useReducedMotionPref,
} from "@/components/overlays/ModalBase";
import { toast } from "@/components/overlays/useToasts";
import type { Stripe } from "@/components/common/Panel";
import { useNow } from "@/hooks/useNow";
import { buildIndex } from "@/game/catalog";
import {
  CLOUD_PROMO_MULT,
  EVENT_LIKES_BOOST,
  MODEL_DROP_TAG_LIKES,
  NODE_BROKE_INCOME_MULT,
  POWER_SURGE_BUDGET_FRACTION,
} from "@/game/events";
import { formatDuration } from "@/game/format";
import type { ActiveEvent, EventKind } from "@/game/types";
import { useGame, useGameStore } from "@/state/useGame";

/** How long the full card stays before collapsing to the pill. */
const EXPANDED_MS = 6000;

interface Row {
  defId: string;
  kind: EventKind;
  startedAt: number;
  endsAt: number;
  payload: string;
}

/** Ids are kebab-case, so a pipe never appears inside a field. */
const SEP = "|";

/** Serialises the active, unresolved events so the selector returns a primitive. */
function eventKey(events: ActiveEvent[]): string {
  let out = "";
  for (const e of events) {
    if (e.resolved) continue;
    if (e.kind === "trendingSpark") continue;
    out += `${e.defId}${SEP}${e.kind}${SEP}${e.startedAt}${SEP}${e.endsAt}${SEP}${e.payload ?? ""}\n`;
  }
  return out;
}

function parseKey(key: string): Row[] {
  if (!key) return [];
  const rows: Row[] = [];
  for (const line of key.split("\n")) {
    if (!line) continue;
    const [defId, kind, startedAt, endsAt, payload] = line.split(SEP);
    if (!defId || !kind) continue;
    rows.push({
      defId,
      kind: kind as EventKind,
      startedAt: Number(startedAt),
      endsAt: Number(endsAt),
      payload: payload ?? "",
    });
  }
  return rows;
}

interface KindMeta {
  stripe: Stripe;
  icon: ReactNode;
  accent: string;
  bar: string;
}

const KIND_META: Record<Exclude<EventKind, "trendingSpark">, KindMeta> = {
  modelDrop: {
    stripe: "latent",
    icon: <Download size={18} />,
    accent: "text-slot-latent",
    bar: "bg-slot-latent",
  },
  nodeBroke: {
    stripe: "vae",
    icon: <TriangleAlert size={18} />,
    accent: "text-slot-vae",
    bar: "bg-slot-vae",
  },
  founderRepost: {
    stripe: "electric",
    icon: <Megaphone size={18} />,
    accent: "text-electric-400",
    bar: "bg-electric-400",
  },
  spotReclaim: {
    stripe: "vae",
    icon: <CloudOff size={18} />,
    accent: "text-slot-vae",
    bar: "bg-slot-vae",
  },
  powerSurge: {
    stripe: "cond",
    icon: <Zap size={18} />,
    accent: "text-slot-cond",
    bar: "bg-slot-cond",
  },
  cloudPromo: {
    stripe: "sapphire",
    icon: <Cloud size={18} />,
    accent: "text-[#7f8dff]",
    bar: "bg-sapphire-700",
  },
};

const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

export function EventBanner() {
  const key = useGame((s) => eventKey(s.events.active));
  const reservedCapacity = useGame((_, d) => d.reservedCapacity);
  const reduced = useReducedMotionPref();
  const rows = useMemo(() => parseKey(key), [key]);
  const shown = rows.filter(
    (r) => !(r.kind === "spotReclaim" && reservedCapacity),
  );

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2"
      aria-label="Live events"
    >
      <AnimatePresence initial={false}>
        {shown.map((row) => (
          <motion.div
            key={row.defId + row.startedAt}
            layout={!reduced}
            initial={
              reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }
            }
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            transition={
              reduced
                ? { duration: 0.12 }
                : { type: "spring", stiffness: 380, damping: 30 }
            }
            className="pointer-events-auto max-w-full"
          >
            <EventRow row={row} reduced={reduced} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const EventRow = memo(function EventRow({
  row,
  reduced,
}: {
  row: Row;
  reduced: boolean;
}) {
  const store = useGameStore();
  const now = useNow(250);
  const { eventById, hashtagById, hardwareById } = buildIndex(store.catalog);
  const def = eventById[row.defId];
  const meta = KIND_META[row.kind as Exclude<EventKind, "trendingSpark">];
  if (!meta) return null;

  const total = Math.max(1, row.endsAt - row.startedAt);
  const remainingMs = Math.max(0, row.endsAt - now);
  const progress = Math.min(1, remainingMs / total);
  const isBroken = row.kind === "nodeBroke";
  const expanded = isBroken || now - row.startedAt < EXPANDED_MS;

  let title = def?.title ?? "Event";
  let desc: ReactNode = def?.desc ?? "";
  let short: ReactNode = title;
  switch (row.kind) {
    case "modelDrop": {
      const tag = hashtagById[row.payload]?.tag ?? row.payload;
      desc = (
        <>
          Likes ×{1 + MODEL_DROP_TAG_LIKES} on{" "}
          <span className="font-semibold text-electric-400">#{tag}</span> while
          it lasts
        </>
      );
      short = (
        <>
          <span className="text-electric-400">#{tag}</span> ×
          {1 + MODEL_DROP_TAG_LIKES} likes
        </>
      );
      break;
    }
    case "nodeBroke":
      desc = `Income at ${pct(NODE_BROKE_INCOME_MULT)} until you fix the node`;
      short = `Income ${pct(NODE_BROKE_INCOME_MULT)}`;
      break;
    case "founderRepost":
      desc = `Posts finishing now get ×${EVENT_LIKES_BOOST} likes`;
      short = `×${EVENT_LIKES_BOOST} likes`;
      break;
    case "spotReclaim": {
      const hw = hardwareById[row.payload];
      title = def?.title ?? "Spot Instance Reclaimed";
      desc = (
        <>
          <span className="font-semibold text-smoke-100">
            {hw?.name ?? "A cloud node"}
          </span>{" "}
          is dark until the cloud gives it back
        </>
      );
      short = `${hw?.name ?? "Cloud node"} reclaimed`;
      break;
    }
    case "powerSurge":
      desc = `Power budget −${pct(POWER_SURGE_BUDGET_FRACTION)} · anything over budget runs throttled`;
      short = `Power −${pct(POWER_SURGE_BUDGET_FRACTION)}`;
      break;
    case "cloudPromo":
      desc = `Income ×${CLOUD_PROMO_MULT} · terms apply (the terms are ${def?.durationSec ?? Math.round(total / 1000)} seconds)`;
      short = `Income ×${CLOUD_PROMO_MULT}`;
      break;
    default:
      break;
  }

  const fix = () => {
    const r = store.resolveEvent(row.defId);
    if (r.error) toast(r.error, { tone: "danger", title: "Nothing to fix" });
  };

  const countdown = (
    <span
      role="timer"
      aria-label={`${formatDuration(remainingMs / 1000)} remaining`}
      className={cn(
        "shrink-0 text-right font-extrabold text-smoke-100 tabular-nums",
        expanded ? "w-12 text-sm" : "text-xs",
      )}
    >
      {formatDuration(remainingMs / 1000)}
    </span>
  );

  if (!expanded) {
    return (
      <div
        title={`${title}. ${typeof desc === "string" ? desc : ""}`.trim()}
        className={cn(
          "relative flex h-9 items-center gap-2 overflow-hidden rounded-full border-2 border-charcoal-400 border-l-4 bg-charcoal-600 pr-3 pl-2 shadow-[0_4px_0_#0e0e0f,0_10px_24px_rgba(0,0,0,0.35)]",
          STRIPE_CLASS[meta.stripe],
        )}
      >
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center [&>svg]:size-3.5",
            meta.accent,
          )}
        >
          {meta.icon}
        </span>
        <span className="truncate text-xs font-semibold text-smoke-100">
          {short}
        </span>
        <span className="text-smoke-800" aria-hidden="true">
          ·
        </span>
        {countdown}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-charcoal-700"
        >
          <span
            className={cn("block h-full origin-left", meta.bar)}
            style={{ transform: `scaleX(${progress})` }}
          />
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border-2 border-charcoal-400 border-l-4 bg-charcoal-600 shadow-[0_4px_0_#0e0e0f,0_14px_36px_rgba(0,0,0,0.4)]",
        STRIPE_CLASS[meta.stripe],
      )}
    >
      {isBroken && !reduced ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-slot-vae/10"
          animate={{ opacity: [0.2, 0.7, 0.2] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
      <div className="relative flex items-center gap-3 px-3.5 py-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-comfy bg-charcoal-700",
            meta.accent,
          )}
        >
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[11px] font-semibold uppercase tracking-[0.08em]",
              meta.accent,
            )}
          >
            {title}
          </p>
          <p className="truncate text-sm text-smoke-100">{desc}</p>
        </div>
        {isBroken ? (
          <button
            type="button"
            onClick={fix}
            aria-label={`Fix the broken node: ${title}`}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-electric-400 px-3.5 text-sm font-bold text-charcoal-800 shadow-press transition-transform hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 focus-visible:ring-offset-2 focus-visible:ring-offset-charcoal-600 active:translate-y-0.5 active:shadow-none"
          >
            <Wrench size={15} />
            Fix it
          </button>
        ) : null}
        {countdown}
      </div>
      <div className="relative h-1 w-full bg-charcoal-700" aria-hidden="true">
        <div
          className={cn(
            "h-full w-full origin-left transition-transform duration-300 ease-linear",
            meta.bar,
          )}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
});
