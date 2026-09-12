'use client'
/**
 * Header account menu (after Kokonut's profile-dropdown, on the game's chrome): an avatar tile
 * with the handle or "Guest", a cloud-sync status dot, and a dropdown with Save to cloud now /
 * Leaderboard / Sign in / Sign out. It also mounts the AuthSheet and CloudMergeModal (the
 * header is on every route, so they are always reachable) and boots cloud sync once.
 */
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, CloudUpload, LogIn, LogOut, Trophy, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AuthSheet } from '@/components/auth/AuthSheet'
import { openAuthSheet, signOut, useAuth, useCloudSync } from '@/components/auth/useAuth'
import { gradientFor } from '@/components/common/Art'
import { CloudMergeModal } from '@/components/overlays/CloudMergeModal'
import { toast } from '@/components/overlays/useToasts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ensureCloudSync, saveToCloudNow, type CloudSyncStatus } from '@/state/persistence'

const STATUS: Record<CloudSyncStatus, { dot: string; label: string; hint: string }> = {
  synced: { dot: 'bg-electric-400', label: 'Synced', hint: 'Cloud save is up to date.' },
  syncing: { dot: 'bg-slot-cond animate-pulse', label: 'Syncing', hint: 'Uploading the save…' },
  offline: { dot: 'bg-smoke-800', label: 'Local only', hint: 'Saves live in this browser. Sign in to back them up.' },
  error: { dot: 'bg-slot-vae', label: 'Sync failed', hint: 'Could not reach the cloud. Playing on locally; retrying every minute.' },
}

const ITEM =
  'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-smoke-100 outline-none transition-colors hover:bg-charcoal-500 focus:bg-charcoal-500 data-highlighted:bg-charcoal-500 [&>svg]:shrink-0 [&>svg]:text-smoke-600'

export function AccountMenu({ className }: { className?: string }) {
  const auth = useAuth()
  const sync = useCloudSync()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    ensureCloudSync()
  }, [])

  const signedIn = auth.status === 'signed-in'
  const name = signedIn ? (auth.handle ?? auth.user?.email?.split('@')[0] ?? 'player') : 'Guest'
  const email = signedIn ? (auth.user?.email ?? null) : null
  const status = signedIn ? STATUS[sync] : STATUS.offline

  const saveNow = async () => {
    if (saving) return
    setSaving(true)
    const ok = await saveToCloudNow()
    setSaving(false)
    toast(ok ? 'Saved to cloud' : 'Cloud save failed', {
      title: 'Cloud',
      description: ok ? 'This run is backed up. Other devices will see it on their next sign-in.' : 'Could not reach the cloud. Your local save is fine; it retries every minute.',
      icon: <CloudUpload className={ok ? 'text-electric-400' : 'text-slot-vae'} />,
      tone: ok ? 'electric' : 'danger',
      key: 'cloud-save',
    })
  }

  const doSignOut = async () => {
    const r = await signOut()
    toast(r.ok ? 'Signed out' : r.error, {
      title: 'Cloud',
      description: r.ok ? 'The run stays in this browser as a guest save.' : undefined,
      icon: <LogOut className={r.ok ? 'text-electric-400' : 'text-slot-vae'} />,
      tone: r.ok ? 'electric' : 'danger',
      key: 'auth',
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={signedIn ? `Account: ${name}. ${status.label}.` : 'Account: guest. Sign in or create an account.'}
              title={status.hint}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-comfy border border-charcoal-400 bg-charcoal-600 pr-1.5 pl-1 text-xs font-semibold text-smoke-100 transition-colors hover:border-charcoal-300 hover:bg-charcoal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400 data-popup-open:border-charcoal-300 data-popup-open:bg-charcoal-500',
                className,
              )}
            />
          }
        >
          <Avatar name={name} guest={!signedIn} />
          <span className="hidden max-w-28 truncate xl:inline">{name}</span>
          <SyncDot status={signedIn ? sync : 'offline'} />
          <ChevronDown size={12} aria-hidden="true" className="text-smoke-800" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-64 min-w-64 rounded-2xl border-2 border-charcoal-400 bg-charcoal-600 p-2 text-smoke-100 shadow-[0_4px_0_#0e0e0f,0_16px_40px_rgba(0,0,0,0.5)] ring-0"
        >
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar name={name} guest={!signedIn} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-smoke-100">{name}</p>
              <p className="truncate text-[11px] text-smoke-600">{email ?? 'Playing without an account'}</p>
            </div>
          </div>
          <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-charcoal-400 bg-charcoal-700/60 px-2.5 py-1.5 text-[11px] text-smoke-600">
            <SyncDot status={signedIn ? sync : 'offline'} />
            <span className="font-semibold uppercase tracking-[0.08em] text-smoke-100">{status.label}</span>
            <span className="ml-auto truncate">{signedIn ? (sync === 'synced' ? 'every 60 s' : '') : 'local save'}</span>
          </div>
          <DropdownMenuSeparator className="my-1.5 bg-charcoal-400/70" />

          {signedIn ? (
            <DropdownMenuItem className={ITEM} onClick={() => void saveNow()} disabled={saving || sync === 'syncing'}>
              <CloudUpload size={16} />
              {saving ? 'Uploading…' : 'Save to cloud now'}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem className={ITEM} onClick={() => openAuthSheet('sign-in')}>
                <LogIn size={16} />
                Sign in
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM} onClick={() => openAuthSheet('sign-up')}>
                <UserPlus size={16} />
                Create account
                <Hint>keeps this run</Hint>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem className={ITEM} render={<Link href="/leaderboard" />}>
            <Trophy size={16} />
            Leaderboard
            {!signedIn ? <Hint>sign in to appear</Hint> : null}
          </DropdownMenuItem>

          {signedIn ? (
            <>
              <DropdownMenuSeparator className="my-1.5 bg-charcoal-400/70" />
              <DropdownMenuItem className={cn(ITEM, 'text-slot-vae hover:bg-slot-vae/10 focus:bg-slot-vae/10 data-highlighted:bg-slot-vae/10 [&>svg]:text-slot-vae')} onClick={() => void doSignOut()}>
                <LogOut size={16} />
                Sign out
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AuthSheet />
      <CloudMergeModal />
    </>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="ml-auto text-[10px] font-medium text-smoke-600">{children}</span>
}

function Avatar({ name, guest, size = 22 }: { name: string; guest: boolean; size?: number }) {
  const initial = (name.replace(/^comfy-/, '').charAt(0) || 'c').toUpperCase()
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-comfy font-extrabold leading-none text-smoke-100', guest && 'border border-dashed border-charcoal-300 text-smoke-600')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: guest ? undefined : gradientFor(name) }}
    >
      {guest ? '?' : initial}
    </span>
  )
}

function SyncDot({ status }: { status: CloudSyncStatus }) {
  const s = STATUS[status]
  return (
    <span className="relative grid size-3 shrink-0 place-items-center" title={s.hint} aria-label={s.label} role="img">
      {status === 'synced' ? <span aria-hidden="true" className="absolute size-2.5 rounded-full bg-electric-400/30" /> : null}
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', s.dot)} />
    </span>
  )
}
