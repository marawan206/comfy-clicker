'use client'
/**
 * Taking the player there.
 *
 * On the same route a guide action is a window event the panel already listens for. Across routes
 * (the Graph lives at `/map`) the request is parked in `sessionStorage` and replayed once on the
 * other side: `GraphMap` picks up a `map` hand-off, `GuidanceHost` picks up the rest. One key, one
 * read, deleted as it is read, so a stale request can never fire twice or on a later visit.
 */
import { OPEN_MODAL_EVENT } from '@/components/overlays/ModalBase'
import type { ModalId } from '@/components/overlays/Overlays'
import { highlightElement, openStoreTab, type StoreTabEventDetail } from '@/components/store/storeHooks'
import { openCenterTab } from '@/components/studio/studioHooks'
import type { GuideAction } from './lockGuide'

/** `GraphMap` listens for this and centres the node. */
export const MAP_FOCUS_EVENT = 'comfy:map-focus'
const GOTO_KEY = 'comfy-clicker:goto'
const HERO_SELECTOR = '[data-tour="generate"]'
const GAME_ROUTE = '/'
const MAP_ROUTE = '/map'

/** What a route hand-off can ask for once the other page is up. */
export type Goto =
  | ({ kind: 'store' } & StoreTabEventDetail)
  | { kind: 'map'; nodeId: string }
  | { kind: 'center'; tab: 'studio' | 'feed' | 'contracts' }
  | { kind: 'hero' }

/** Enough of `next/navigation`'s router for this module; the host passes the real one. */
export interface GuideRouter {
  push: (href: string) => void
}

function currentPath(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname
}

function park(goto: Goto): void {
  try {
    window.sessionStorage.setItem(GOTO_KEY, JSON.stringify(goto))
  } catch {
    /* private mode: the navigation still happens, it just lands unfocused */
  }
}

/**
 * Take the parked request if it is one of `kinds`, and clear it. Anything parked for another
 * surface is left alone, so the Graph and the store can both watch the same key.
 */
export function consumeGoto(kinds: readonly Goto['kind'][]): Goto | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(GOTO_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let goto: Goto
  try {
    goto = JSON.parse(raw) as Goto
  } catch {
    try {
      window.sessionStorage.removeItem(GOTO_KEY)
    } catch {
      /* nothing to clean up */
    }
    return null
  }
  if (!goto || !kinds.includes(goto.kind)) return null
  try {
    window.sessionStorage.removeItem(GOTO_KEY)
  } catch {
    /* it will be overwritten by the next hand-off */
  }
  return goto
}

/** Scroll the Generate button into view and ring it: the answer to every "I need credits". */
export function focusHero(): void {
  const el = document.querySelector<HTMLElement>(HERO_SELECTOR)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  highlightElement(el)
  el.focus({ preventScroll: true })
}

/** Centre a node on the Graph, on this route or after the push. */
export function focusMapNode(nodeId: string): void {
  window.dispatchEvent(new CustomEvent<string>(MAP_FOCUS_EVENT, { detail: nodeId }))
}

/** Replay a parked hand-off on the page that now owns it. */
export function applyGoto(goto: Goto): void {
  switch (goto.kind) {
    case 'store': {
      const detail: StoreTabEventDetail = { tab: goto.tab }
      if (goto.family) detail.family = goto.family
      if (goto.focusId) detail.focusId = goto.focusId
      openStoreTab(detail)
      break
    }
    case 'map':
      focusMapNode(goto.nodeId)
      break
    case 'center':
      openCenterTab(goto.tab)
      break
    case 'hero':
      focusHero()
      break
  }
}

function goHome(goto: Goto, router?: GuideRouter): void {
  if (currentPath() === GAME_ROUTE) {
    applyGoto(goto)
    return
  }
  park(goto)
  if (router) router.push(GAME_ROUTE)
  // The bus can be driven from a toast action or a plain handler with no router in scope. The
  // request is parked first, so even a full page load lands on the right panel.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- no router here
  else window.location.href = GAME_ROUTE
}

/**
 * Run one guide action. Same route: dispatch and highlight. Other route: park the request and
 * push. `act` runs whatever the caller handed over (setting a model up in place, for instance).
 */
export function runGuideAction(action: GuideAction, router?: GuideRouter): void {
  if (typeof window === 'undefined') return
  switch (action.type) {
    case 'store': {
      const detail: StoreTabEventDetail = { tab: action.tab }
      if (action.family) detail.family = action.family
      if (action.focusId) detail.focusId = action.focusId
      goHome({ kind: 'store', ...detail }, router)
      break
    }
    case 'center':
      goHome({ kind: 'center', tab: action.tab }, router)
      break
    case 'hero':
      goHome({ kind: 'hero' }, router)
      break
    case 'map':
      if (currentPath() === MAP_ROUTE) {
        focusMapNode(action.nodeId)
      } else {
        park({ kind: 'map', nodeId: action.nodeId })
        if (router) router.push(MAP_ROUTE)
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see goHome
        else window.location.href = MAP_ROUTE
      }
      break
    case 'modal':
      window.dispatchEvent(new CustomEvent<ModalId>(OPEN_MODAL_EVENT, { detail: action.id }))
      break
    case 'act':
      action.run()
      break
  }
}

/** The button word for an action, so every guide says the same thing about the same jump. */
export function actionLabel(action: GuideAction): string {
  switch (action.type) {
    case 'store':
      return action.tab === 'hardware' ? 'Open Hardware' : action.tab === 'upgrades' ? 'Open Upgrades' : 'Open Models'
    case 'map':
      return 'Open the Graph'
    case 'center':
      return action.tab === 'studio' ? 'Open the Studio' : action.tab === 'feed' ? 'Open the Feed' : 'Open Contracts'
    case 'modal':
      switch (action.id) {
        case 'level':
          return 'Show my level'
        case 'stats':
          return 'Open Stats'
        case 'rebrand':
          return 'Open Rebrand'
        case 'daily':
          return 'Open the daily'
        case 'lounge':
          return 'Open the Lounge'
        case 'patch':
          return 'Open the patch notes'
        default:
          return 'Open Settings'
      }
    case 'hero':
      return 'Take me to Generate'
    case 'act':
      return action.label
  }
}
