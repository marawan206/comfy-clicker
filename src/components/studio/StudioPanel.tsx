"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles, TriangleAlert, Upload, Workflow, X } from "lucide-react";
import { useGameStore } from "@/state/useGame";
import { Panel } from "@/components/common/Panel";
import { CreditsIcon } from "@/components/brand/CreditsIcon";
import { PublishDialog } from "@/components/hub/PublishDialog";
import {
  STUDIO_LOAD_EVENT,
  clearPendingStudioLoad,
  ensureHubRoyaltyBridge,
  isStudioLoadDetail,
  openHubPublish,
  peekPendingStudioLoad,
  type StudioLoadDetail,
} from "@/components/hub/useHub";
import { formatNum } from "@/game/format";
import type { Precision } from "@/game/types";
import type { GameStore } from "@/state/store";
import { buildIndex } from "@/game/catalog";
import { explainRun, explainSetup, setupCause, type LockCause } from "@/game/guidance";
import { guideCauses } from "@/components/guidance/GuidanceHost";
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
  MAX_SELECTED_TAGS,
  patchSelection,
  useComputeCostPreview,
  useMotionOK,
  useStudioSelection,
} from "./studioHooks";

type Flash =
  { kind: "ok"; text: string } | { kind: "err"; text: string } | null;

/**
 * Why `queueJob` would refuse, as a cause the guidance popover can turn into steps: the model has
 * to exist and be installed, something has to be able to run it, and the credits have to be there.
 */
function blockedCause(
  store: GameStore,
  modelId: string,
  precision: Precision,
  affordable: boolean,
  cost: number,
): LockCause | null {
  const { state, derived, catalog } = store;
  const model = buildIndex(catalog).modelById[modelId];
  if (!model) return null;
  if (!state.models[model.id]?.setup) {
    return explainSetup(model, state, derived, catalog) ?? setupCause(model, derived, catalog);
  }
  const run = explainRun(model, precision, state, derived, catalog);
  if (run) return run;
  if (!affordable) return { kind: "credits", need: cost, have: state.credits };
  return null;
}

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

  // A ComfyHub recipe handed to the Studio: parked in sessionStorage across the /hub → / route
  // change, or delivered live by `comfy:studio-load`. It tags the next queued job with
  // `hubWorkflowId` so the author's royalty is recorded when the post resolves, as long as the
  // form still matches the recipe's model and precision.
  //
  // The parked copy is cleared when the recipe is *consumed*, never on mount: `CenterTabs` keys
  // the panel on the tab, so one trip through the Feed unmounts this component, and a mount-time
  // clear used to throw the hand-off away and silently cost the workflow author their royalty.
  const [hubJob, setHubJob] = useState<StudioLoadDetail | null>(peekPendingStudioLoad);
  const dropHubJob = useCallback(() => {
    clearPendingStudioLoad();
    setHubJob(null);
  }, []);
  useEffect(() => {
    ensureHubRoyaltyBridge();
    const onLoad = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isStudioLoadDetail(detail)) return;
      patchSelection({
        modelId: detail.modelId,
        precision: detail.precision,
        tags: detail.tags.slice(0, MAX_SELECTED_TAGS),
        ...(detail.prompt !== undefined ? { prompt: detail.prompt } : {}),
      });
      setHubJob(detail);
    };
    window.addEventListener(STUDIO_LOAD_EVENT, onLoad);
    return () => window.removeEventListener(STUDIO_LOAD_EVENT, onLoad);
  }, []);
  const hubMatches =
    hubJob !== null &&
    hubJob.modelId === modelId &&
    hubJob.precision === precision;

  const disabled = preview.blocker !== null;

  /** Queue the post. Returns true when the job is in the queue, so Ctrl+Enter knows it landed. */
  const generate = useCallback((): boolean => {
    if (disabled) {
      showFlash({
        kind: "err",
        text: preview.blocker ?? "Cannot queue right now",
      });
      return false;
    }
    const result = store.queueJob({
      modelId,
      precision,
      prompt,
      tags,
      ...(hubMatches && hubJob ? { hubWorkflowId: hubJob.hubWorkflowId } : {}),
    });
    if (result.error) {
      showFlash({ kind: "err", text: result.error });
      return false;
    }
    if (hubMatches) dropHubJob();
    showFlash({
      kind: "ok",
      text:
        preview.queueLen === 0
          ? hubMatches
            ? "Queued from ComfyHub · rendering now"
            : "Queued · rendering now"
          : `Queued · #${preview.queueLen + 1} in line`,
    });
    return true;
  }, [
    disabled,
    dropHubJob,
    hubJob,
    hubMatches,
    modelId,
    precision,
    preview.blocker,
    preview.queueLen,
    prompt,
    showFlash,
    store,
    tags,
  ]);

  /**
   * A refused Generate explains itself where the player clicked. A full queue is not a lock (it
   * clears on its own in a few seconds), so that one stays a flash.
   */
  const onGenerate = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (!disabled || preview.queueFull) {
        generate();
        return;
      }
      const cause = blockedCause(store, modelId, precision, preview.affordable, preview.cost);
      if (cause) guideCauses(e.currentTarget, [cause], store, preview.modelName || "This post");
      else generate();
    },
    [disabled, generate, modelId, precision, preview.affordable, preview.cost, preview.modelName, preview.queueFull, store],
  );

  const publish = useCallback(
    () => openHubPublish({ modelId, precision, hashtags: tags }),
    [modelId, precision, tags],
  );

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
        <PromptInput onSubmit={generate} />
        <HashtagPicker />

        <AnimatePresence initial={false}>
          {hubJob ? (
            <motion.div
              key={hubJob.hubWorkflowId}
              role="status"
              initial={motionOk ? { opacity: 0, y: -4 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={motionOk ? { opacity: 0, y: -4 } : undefined}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className={cn(
                "flex items-center gap-2 rounded-xl border-2 border-l-4 px-3 py-2 text-xs",
                hubMatches
                  ? "border-charcoal-400 border-l-sapphire-700 bg-charcoal-700/60 text-smoke-600"
                  : "border-slot-vae/40 border-l-slot-vae bg-charcoal-700/60 text-smoke-600",
              )}
            >
              <Workflow
                size={14}
                className={cn("shrink-0", hubMatches ? "text-[#7f8dff]" : "text-slot-vae/80")}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">
                {hubMatches ? (
                  <>
                    Next post runs{" "}
                    <span className="font-semibold text-smoke-100">
                      {hubJob.name ?? "a ComfyHub workflow"}
                    </span>
                    {hubJob.authorHandle ? (
                      <>
                        {" "}by{" "}
                        <span className="font-semibold text-smoke-100">@{hubJob.authorHandle}</span>
                      </>
                    ) : null}
                    {" "}· 5% royalty to the author
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-smoke-100">
                      {hubJob.name ?? "The ComfyHub workflow"}
                    </span>{" "}
                    needs its own model and precision. Switch back, or drop it.
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={dropHubJob}
                aria-label="Drop the ComfyHub workflow"
                title="Drop the workflow · the next post is just yours"
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-[0.354em] text-smoke-800 transition-colors hover:bg-charcoal-500 hover:text-smoke-100",
                  FOCUS_RING,
                )}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* The CTA never goes below the fold: the cost line and the buttons stick to the bottom of
            the centre column, with a fade so the content scrolling under them reads as content. */}
        <div className="sticky bottom-0 z-10 -mx-4 mt-auto px-4 pb-0">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-4 h-4 bg-linear-to-t from-charcoal-600 to-transparent"
          />
          <div className="relative flex flex-col gap-2 rounded-xl border-2 border-charcoal-400 bg-charcoal-700 p-3">
            <CostLine />
            <div className="flex flex-wrap items-center gap-3">
              <motion.button
                type="button"
                data-tour="studio-generate"
                onClick={onGenerate}
                aria-disabled={disabled}
                aria-label={
                  disabled
                    ? `Generate post (${preview.blocker})`
                    : "Generate post"
                }
                title={disabled ? (preview.blocker ?? undefined) : "Queue Prompt · Ctrl+Enter"}
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
              <motion.button
                type="button"
                onClick={publish}
                whileTap={motionOk ? { scale: 0.96, y: 2 } : undefined}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                title="Publish this model, precision and tags to ComfyHub · every run pays you 5%"
                aria-label="Publish to ComfyHub"
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-xl border-2 border-charcoal-400 bg-charcoal-600 px-4 text-sm font-bold text-smoke-100 shadow-[0_4px_0_#0e0e0f] transition-colors hover:border-sapphire-700 hover:text-[#7f8dff]",
                  FOCUS_RING,
                )}
              >
                <Upload size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Publish to ComfyHub</span>
                <span className="sm:hidden">Publish</span>
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
        </div>

        <QueueList />
      </Panel>
      <PublishDialog />
    </CostPreviewProvider>
  );
}
