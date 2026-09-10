"use client";
import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Radio, Sparkles } from "lucide-react";
import type { FeedItem } from "@/server/feed/types";
import { Panel } from "@/components/common/Panel";
import { useFeed } from "@/components/feed/FeedProvider";
import { PostCard } from "@/components/feed/PostCard";
import { RealPostCard } from "@/components/feed/RealPostCard";
import {
  FeedClockContext,
  FeedSlowClockContext,
  usePostIds,
  useReducedMotionPref,
} from "@/components/feed/feedHooks";
import { useNow } from "@/hooks/useNow";

/** Cards rendered at most (the engine also caps `state.posts` at MAX_POSTS). */
export const FEED_CARD_CAP = 60;
/** One real post after this many player posts. */
const REAL_EVERY = 3;

type Entry =
  | { key: string; kind: "post"; id: string }
  | { key: string; kind: "real"; item: FeedItem };

/**
 * Newest-first mix: the player's posts always lead (a fresh post lands at the top of the feed),
 * with a real card after every three of them; whatever is left of the first three real cards pads
 * the end so a young feed never looks empty. Capped at FEED_CARD_CAP.
 */
export function interleaveFeed(
  postIds: readonly string[],
  real: readonly FeedItem[],
  cap = FEED_CARD_CAP,
): Entry[] {
  const out: Entry[] = [];
  let r = 0;
  const pushReal = (): void => {
    const item = real[r];
    if (!item) return;
    r += 1;
    out.push({ key: `r:${item.id}`, kind: "real", item });
  };
  postIds.forEach((id, i) => {
    out.push({ key: `p:${id}`, kind: "post", id });
    if ((i + 1) % REAL_EVERY === 0) pushReal();
  });
  while (r < REAL_EVERY) {
    const before = r;
    pushReal();
    if (r === before) break;
  }
  return out.length > cap ? out.slice(0, cap) : out;
}

/** The social feed: player posts interleaved with real posts from the wire. */
export function FeedPanel() {
  const ids = usePostIds();
  const { items, loading, origin } = useFeed();
  const reduced = useReducedMotionPref();
  const entries = useMemo(() => interleaveFeed(ids, items), [ids, items]);
  // One interval for the whole feed: live cards read the fast tick, timestamps the 2 s one.
  const now = useNow(250);
  const slowNow = now - (now % 2000);

  const wire =
    origin === "db" || origin === "memory" ? (
      <span
        className="inline-flex items-center gap-1 text-sapphire-700"
        title="Real posts are live from the wire"
      >
        <Radio size={12} aria-hidden="true" />
        live wire
      </span>
    ) : origin === "seed" ? (
      <span title="Real posts come from the archived seed">archive</span>
    ) : loading ? (
      <span>tuning in…</span>
    ) : null;

  return (
    <FeedClockContext.Provider value={now}>
      <FeedSlowClockContext.Provider value={slowNow}>
        <Panel
          title="Feed"
          stripe="model"
          right={
            <>
              <span className="tabular-nums">
                {ids.length} {ids.length === 1 ? "post" : "posts"}
              </span>
              {wire}
            </>
          }
          className="min-h-0 flex-1"
          bodyClassName="overflow-y-auto p-3"
        >
          {ids.length === 0 ? (
            <p className="mb-3 flex items-start gap-2 rounded-2xl border-2 border-dashed border-charcoal-300 px-3 py-2.5 text-sm text-smoke-600">
              <Sparkles
                size={16}
                className="mt-0.5 shrink-0 text-electric-400"
                aria-hidden="true"
              />
              Nothing posted yet. Queue a prompt in the Studio and it lands here
              — likes, payout and the occasional flop included.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3" aria-label="Feed">
            <AnimatePresence initial={false}>
              {entries.map((e) => (
                <motion.li
                  key={e.key}
                  className="cv-auto"
                  style={{ containIntrinsicSize: "0 150px" }}
                  initial={
                    reduced ? false : { opacity: 0, y: -14, scale: 0.98 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={
                    reduced
                      ? undefined
                      : {
                          opacity: 0,
                          scale: 0.98,
                          transition: { duration: 0.15 },
                        }
                  }
                  transition={{ type: "spring", stiffness: 380, damping: 26 }}
                >
                  {e.kind === "post" ? (
                    <PostCard id={e.id} />
                  ) : (
                    <RealPostCard item={e.item} />
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Panel>
      </FeedSlowClockContext.Provider>
    </FeedClockContext.Provider>
  );
}
