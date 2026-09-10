"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles, TriangleAlert } from "lucide-react";
import { useGameStore } from "@/state/useGame";
import { Panel } from "@/components/common/Panel";
import { CreditsIcon } from "@/components/brand/CreditsIcon";
import { formatNum } from "@/game/format";
import { cn } from "@/lib/utils";
import { ModelChips } from "./ModelChips";
import { PrecisionToggle } from "./PrecisionToggle";
import { PromptInput } from "./PromptInput";
import { HashtagPicker } from "./HashtagPicker";
import { CostLine } from "./CostLine";
import { QueueList } from "./QueueList";
import {
  CostPreviewProvider,
  FOCUS_RING,
  useComputeCostPreview,
  useMotionOK,
  useStudioSelection,
} from "./studioHooks";

type Flash =
  { kind: "ok"; text: string } | { kind: "err"; text: string } | null;

/** The Studio: pick a checkpoint and precision, write a prompt, tag it, queue the render. */
export function StudioPanel() {
  const store = useGameStore();
  const motionOk = useMotionOK();
  const { modelId, precision, prompt, tags } = useStudioSelection();
  const preview = useComputeCostPreview();

  const [flash, setFlash] = useState<Flash>(null);
  const flashTimer = useRef<number | null>(null);
  const showFlash = useCallback((next: Flash) => {
    setFlash(next);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(
      () => setFlash(null),
      next?.kind === "ok" ? 1800 : 3200,
    );
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const disabled = preview.blocker !== null;
  const generate = useCallback(() => {
    if (disabled) {
      showFlash({
        kind: "err",
        text: preview.blocker ?? "Cannot queue right now",
      });
      return;
    }
    const result = store.queueJob({ modelId, precision, prompt, tags });
    if (result.error) showFlash({ kind: "err", text: result.error });
    else
      showFlash({
        kind: "ok",
        text:
          preview.queueLen === 0
            ? "Queued · rendering now"
            : `Queued · #${preview.queueLen + 1} in line`,
      });
  }, [
    disabled,
    modelId,
    precision,
    preview.blocker,
    preview.queueLen,
    prompt,
    showFlash,
    store,
    tags,
  ]);

  return (
    <CostPreviewProvider value={preview}>
      <Panel
        stripe="model"
        title="Studio"
        right={
          <span className="tabular-nums">
            {preview.queueLen > 0 ? `${preview.queueLen} in queue` : "idle"}
          </span>
        }
        className="shrink-0"
        bodyClassName="flex flex-col gap-4"
      >
        <ModelChips />
        <PrecisionToggle />
        <PromptInput />
        <HashtagPicker />

        <div className="flex flex-col gap-2 rounded-xl border-2 border-charcoal-400 bg-charcoal-700/60 p-3">
          <CostLine />
          <div className="flex flex-wrap items-center gap-3">
            <motion.button
              type="button"
              onClick={generate}
              aria-disabled={disabled}
              aria-label={
                disabled
                  ? `Generate post (${preview.blocker})`
                  : "Generate post"
              }
              title={disabled ? (preview.blocker ?? undefined) : "Queue Prompt"}
              whileTap={
                motionOk && !disabled ? { scale: 0.96, y: 2 } : undefined
              }
              whileHover={motionOk && !disabled ? { scale: 1.02 } : undefined}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-xl border-2 px-5 text-base font-extrabold tracking-tight",
                FOCUS_RING,
                disabled
                  ? "cursor-not-allowed border-charcoal-300 bg-charcoal-500 text-smoke-800 shadow-none"
                  : "border-electric-400 bg-electric-400 text-charcoal-800 shadow-[0_4px_0_#0e0e0f] hover:brightness-105",
              )}
            >
              <Sparkles size={18} aria-hidden="true" />
              Generate post
              <span
                className={cn(
                  "ml-1 inline-flex items-center gap-0.5 text-sm font-bold tabular-nums",
                  disabled ? "text-smoke-800" : "text-charcoal-800/80",
                )}
              >
                <CreditsIcon size={12} aria-hidden="true" />
                {formatNum(preview.cost)}
              </span>
            </motion.button>
            <div
              className="min-w-0 flex-1 text-xs"
              role="status"
              aria-live="polite"
            >
              <AnimatePresence mode="wait" initial={false}>
                {flash ? (
                  <motion.span
                    key={`${flash.kind}:${flash.text}`}
                    initial={motionOk ? { opacity: 0, x: -6 } : false}
                    animate={{ opacity: 1, x: 0 }}
                    exit={motionOk ? { opacity: 0 } : undefined}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className={cn(
                      "inline-flex items-center gap-1.5 font-semibold",
                      flash.kind === "ok"
                        ? "text-electric-400"
                        : "text-slot-vae",
                    )}
                  >
                    {flash.kind === "ok" ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <TriangleAlert size={14} aria-hidden="true" />
                    )}
                    {flash.text}
                  </motion.span>
                ) : disabled ? (
                  <motion.span
                    key={`blocker:${preview.blocker}`}
                    initial={false}
                    animate={{ opacity: 1 }}
                    className="inline-flex items-center gap-1.5 text-smoke-700"
                  >
                    <TriangleAlert
                      size={14}
                      className="text-slot-vae/70"
                      aria-hidden="true"
                    />
                    {preview.blocker}
                  </motion.span>
                ) : (
                  <motion.span
                    key="ready"
                    initial={false}
                    animate={{ opacity: 1 }}
                    className="text-smoke-800"
                  >
                    Ready on {preview.hardwareName}. Trending tags move likes;
                    credits follow the roll.
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <QueueList />
      </Panel>
    </CostPreviewProvider>
  );
}
