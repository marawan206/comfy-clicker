'use client'
/**
 * The welcome gift, offered once per account: an RTX PRO 6000 (plus the PSU that can feed it) for
 * the founders, 50,000 credits for the Sonam special. Both declinable, and a decline is as final as
 * an accept, because the whole joke dies if the card can be farmed by reloading.
 *
 * Timing is the hard part. The check waits for two things:
 *   1. the player is signed in, and
 *   2. `getCloudDecided()` is true, meaning cloud sync has finished deciding whether this device's
 *      run is the one that counts.
 * Without (2), a founder signing in on a new phone would be offered the card against the throwaway
 * local run that the cloud save is about to replace, accept it, and watch it disappear a second
 * later along with the flag that was supposed to make the offer once.
 *
 * The other guard is on the handle: a name only counts as evidence while it is the one sign-up
 * handed out (`handle_changed_at` is null), unless the email is already on a comfy.org address. So
 * signing up as nobody and renaming yourself to `robin_x` buys nothing.
 */
import { useState, useSyncExternalStore } from 'react'
import { Gift } from 'lucide-react'
import { useAuth } from '@/components/auth/useAuth'
import { fx } from '@/components/fx/fxBus'
import { ModalBase, ModalButton } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { GIFTS } from '@/data/gifts'
import { GIFT_DECLINED_SUFFIX } from '@/game/actions'
import type { GiftKind } from '@/game/types'
import { giftFor } from '@/lib/gifts'
import { CLOUD_DECIDED_EVENT, getCloudDecided } from '@/state/persistence'
import { useGame, useGameStore } from '@/state/useGame'

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
interface GiftCopy {
  /** Uppercase modal title. */
  kicker: string
  headline: string
  body: string
  accept: string
  decline: string
  acceptToast: { title: string; description: string }
  declineToast: { title: string; description: string }
}

const COPY: Record<GiftKind, GiftCopy> = {
  founder: {
    kicker: "Founders' welcome",
    headline: 'One RTX PRO 6000, on the house.',
    body: 'You are on the list. 96 GB, 600 W, a PSU that can take it, zero payback. Or start on the 4-core box like everyone else. The box will not take it personally.',
    accept: 'Accept the card',
    decline: 'Start on the CPU',
    acceptToast: { title: 'Delivered', description: 'RTX PRO 6000 racked · 850 W PSU installed · payback: n/a' },
    declineToast: { title: 'Declined. Respect.', description: 'Same rig as everyone. See you on the board.' },
  },
  sonam: {
    kicker: 'The Sonam special',
    headline: '50,000 credits. No questions.',
    body: "Somebody insisted. Credits aren't real, but 50,000 of them buy a very real RTX PRO 6000 with change. The offer does not come back.",
    accept: 'Take the credits',
    decline: 'Earn them the slow way',
    acceptToast: { title: 'The Sonam special', description: '+50,000. Spend it like it is real. It is not.' },
    declineToast: { title: 'Declined. Respect.', description: 'Every credit the long way, then. See you on the board.' },
  },
}

// ---------------------------------------------------------------------------
// Rules (pure, so the matrix can be pinned in a test)
// ---------------------------------------------------------------------------

/** Flag `declineGift` raises. Mirrors `${GIFTS[kind].flag}${GIFT_DECLINED_SUFFIX}`. */
export function declinedFlag(kind: GiftKind): string {
  return `${GIFTS[kind].flag}${GIFT_DECLINED_SUFFIX}`
}

/** The only four flags this modal cares about: accepted and declined, per gift. */
const ANSWER_FLAGS: readonly string[] = [GIFTS.founder.flag, `${GIFTS.founder.flag}${GIFT_DECLINED_SUFFIX}`, GIFTS.sonam.flag, `${GIFTS.sonam.flag}${GIFT_DECLINED_SUFFIX}`]

/** Those four flags as one primitive, because `state.flags` is mutated in place and never changes identity. */
export function answerBits(flags: Record<string, boolean>): string {
  return ANSWER_FLAGS.map((k) => (flags[k] === true ? '1' : '0')).join('')
}

/** The inverse, so the effect below decides from a value React can actually compare. */
export function answerFlags(bits: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  ANSWER_FLAGS.forEach((k, i) => {
    out[k] = bits[i] === '1'
  })
  return out
}

/**
 * The handle the gift rules are allowed to look at. A handle counts while it is still the one
 * sign-up assigned, and always for a comfy.org address (those people may rename themselves freely
 * and are on the list either way). A renamed handle on any other domain counts for nothing.
 */
export function matchableHandle(email: string | null | undefined, handle: string | null | undefined, handleChangedAt: string | null | undefined): string | null {
  if (!handle) return null
  if (!handleChangedAt) return handle
  const domain = (email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  return domain === 'comfy.org' ? handle : null
}

/** The gift this account is owed and has not answered yet, or null. */
export function pendingGift(
  email: string | null | undefined,
  handle: string | null | undefined,
  handleChangedAt: string | null | undefined,
  flags: Record<string, boolean>,
): GiftKind | null {
  const kind = giftFor(email, matchableHandle(email, handle, handleChangedAt))
  if (!kind) return null
  if (flags[GIFTS[kind].flag] === true || flags[declinedFlag(kind)] === true) return null
  return kind
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
/** `getCloudDecided` as an external store, so the flag is read during render and never in an effect. */
function subscribeDecided(onChange: () => void): () => void {
  window.addEventListener(CLOUD_DECIDED_EVENT, onChange)
  return () => {
    window.removeEventListener(CLOUD_DECIDED_EVENT, onChange)
  }
}
const decidedOnServer = (): boolean => false

export function FounderGiftModal() {
  const auth = useAuth()
  const store = useGameStore()
  const decided = useSyncExternalStore(subscribeDecided, getCloudDecided, decidedOnServer)
  /** The gift this session has already answered, so the card leaves on the click and not a tick later. */
  const [answered, setAnswered] = useState<GiftKind | null>(null)

  const answers = useGame((s) => answerBits(s.flags))
  const started = useGame((_s, _d, s) => s.started)

  const eligible = pendingGift(auth.user?.email ?? null, auth.handle, auth.handleChangedAt, answerFlags(answers))
  const ready = auth.status === 'signed-in' && decided && started
  const kind = ready && eligible !== null && eligible !== answered ? eligible : null

  const accept = () => {
    if (!kind) return
    const copy = COPY[kind]
    setAnswered(kind)
    const result = store.grantGift(kind)
    if (result.error) return
    fx.confetti()
    toast(copy.acceptToast.title, {
      title: 'Welcome gift',
      description: copy.acceptToast.description,
      icon: <Gift className="text-electric-400" />,
      tone: 'electric',
      key: 'gift',
      sound: { name: 'viral' },
    })
  }

  const decline = () => {
    if (!kind) return
    const copy = COPY[kind]
    setAnswered(kind)
    store.declineGift(kind)
    toast(copy.declineToast.title, {
      title: 'Welcome gift',
      description: copy.declineToast.description,
      icon: <Gift className="text-smoke-600" />,
      key: 'gift',
    })
  }

  const copy = kind ? COPY[kind] : null

  return (
    <ModalBase
      open={copy !== null}
      onClose={decline}
      title={copy?.kicker ?? ''}
      icon={<Gift size={16} />}
      stripe="electric"
      size="sm"
      dismissible={false}
      footer={
        copy ? (
          <>
            <ModalButton tone="ghost" onClick={decline}>
              {copy.decline}
            </ModalButton>
            <ModalButton tone="primary" size="lg" onClick={accept} data-autofocus>
              <Gift size={16} />
              {copy.accept}
            </ModalButton>
          </>
        ) : null
      }
    >
      {copy ? (
        <div className="flex flex-col gap-3">
          <p className="text-lg leading-snug font-extrabold text-smoke-100">{copy.headline}</p>
          <p className="text-sm leading-relaxed text-smoke-600">{copy.body}</p>
        </div>
      ) : null}
    </ModalBase>
  )
}
