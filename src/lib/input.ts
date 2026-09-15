/**
 * The cheapest layer of the auto-clicker guard: a synthetic event is not a click.
 *
 * `Event.isTrusted` is false for anything `dispatchEvent` produced, which covers the console
 * one-liners and the browser-extension clickers. Real automation can still drive the OS pointer,
 * which is what the engine's rate cap is for.
 *
 * jsdom's synthetic events are all untrusted, so component tests call `overrideTrust(true)` once
 * in setup and `overrideTrust(false)` in teardown.
 */
let trustOverride = false

/** Force `trustedInput` to accept everything (jsdom tests only). */
export function overrideTrust(on: boolean): void {
  trustOverride = on
}

/** True when the event came from a real person, or the test override is on. */
export function trustedInput(e: { isTrusted: boolean } | null | undefined): boolean {
  if (trustOverride) return true
  return e?.isTrusted === true
}
