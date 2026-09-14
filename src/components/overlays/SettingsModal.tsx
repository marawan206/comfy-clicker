'use client'
/**
 * Settings: display/feedback toggles, manual save, export/import codes, the hard reset (hold to
 * confirm) and an About blurb. Every toggle goes through `store.toggleSetting`, so the shell's
 * `html.projector` / `html.reduced-motion` mirrors follow automatically.
 */
import { useId, useState, type ReactNode } from 'react'
import { Check, ClipboardCopy, Download, GraduationCap, HardDriveDownload, Info, Monitor, Play, Save, ScrollText, Sparkles, Trash2, Upload, Volume2, Waves } from 'lucide-react'
import { getSfxVolume, playCue, setSfxVolume } from '@/audio/sfxEngine'
import { cn } from '@/lib/utils'
import { useCloudSync } from '@/components/auth/useAuth'
import { HoldToConfirm, ModalBase, ModalButton, SectionLabel } from '@/components/overlays/ModalBase'
import { toast } from '@/components/overlays/useToasts'
import { GAME_VERSION, PATCH_NOTES } from '@/data/patchNotes'
import { AUTOSAVE_MS } from '@/game/constants'
import { exportString, importString } from '@/game/save'
import type { GameSettings } from '@/game/types'
import { useGameShallow, useGameStore } from '@/state/useGame'

export interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  return (
    <ModalBase open={open} onClose={onClose} title="Settings" icon={<Monitor size={16} />} stripe="cond" size="md">
      <SettingsBody onClose={onClose} />
    </ModalBase>
  )
}

interface ToggleDef {
  key: keyof GameSettings
  label: string
  hint: string
  icon: ReactNode
}

const TOGGLES: ToggleDef[] = [
  { key: 'sfx', label: 'Sound effects', hint: 'Clicks, cash, and the occasional fan spin-up.', icon: <Volume2 size={16} /> },
  { key: 'particles', label: 'Particles', hint: 'Credit diamonds, confetti and the rain behind the rig.', icon: <Sparkles size={16} /> },
  { key: 'reducedMotion', label: 'Reduced motion', hint: 'Fewer springs and loops. Your OS setting is respected either way.', icon: <Waves size={16} /> },
  { key: 'projector', label: 'Projector mode', hint: 'Bigger type and panels for the back row.', icon: <Monitor size={16} /> },
]

const SAVE_TOGGLE: ToggleDef = {
  key: 'autosave',
  label: 'Autosave',
  hint: 'Every 10 s, a moment after any purchase or unlock, and when the tab hides. S saves any time.',
  icon: <HardDriveDownload size={16} />,
}

/** Swap this modal for the patch notes: same overlay host, so Esc still closes whatever is open. */
function openPatchNotes(): void {
  window.dispatchEvent(new CustomEvent<string>('comfy:open-modal', { detail: 'patch' }))
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const store = useGameStore()
  const settings = useGameShallow((s) => ({
    sfx: s.settings.sfx,
    particles: s.settings.particles,
    reducedMotion: s.settings.reducedMotion,
    projector: s.settings.projector,
    autosave: s.settings.autosave,
  }))
  const [exported, setExported] = useState('')
  const [copied, setCopied] = useState(false)
  const [importText, setImportText] = useState('')
  const [volume, setVolume] = useState(() => Math.round(getSfxVolume() * 100))
  const [importError, setImportError] = useState<string | null>(null)
  const importId = useId()
  const volumeId = useId()
  // Signed in: whatever replaces this run is uploaded within the minute, so say so before the click.
  const cloud = useCloudSync() !== 'offline'

  const saveNow = () => {
    if (!store.save()) {
      const wait = Math.max(1, Math.ceil(store.msUntilManualSave() / 1000))
      toast(`Already saved · again in ${wait}s`, { title: 'Save', description: 'Autosave is still running underneath.', icon: <Save className="text-smoke-600" />, key: 'saved' })
      return
    }
    toast('Saved', { title: 'Save', description: 'Progress lives in this browser. Export a code to move it.', icon: <Save className="text-electric-400" />, tone: 'electric', key: 'saved' })
  }

  const doExport = () => {
    store.save()
    setExported(exportString(store.state))
    setCopied(false)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported)
      setCopied(true)
      toast('Save code copied', { title: 'Export', icon: <ClipboardCopy className="text-electric-400" />, tone: 'electric', key: 'export' })
    } catch {
      toast('Clipboard blocked. Select the code and copy it by hand', { title: 'Export', tone: 'danger', key: 'export' })
    }
  }

  const doImport = () => {
    const text = importText.trim()
    if (!text) {
      setImportError('Paste a save code first.')
      return
    }
    const next = importString(text, Date.now(), store.state.meta.guestId)
    if (!next) {
      setImportError('That is not a Comfy Clicker save code (they start with CC1|).')
      return
    }
    store.replaceState(next)
    setImportError(null)
    setImportText('')
    toast('Save imported', { title: 'Import', description: 'The rig is exactly where the code left it.', icon: <Upload className="text-electric-400" />, tone: 'electric' })
    onClose()
  }

  const hardReset = () => {
    store.hardReset()
    toast('Fresh install', { title: 'Hard reset', description: 'One CPU, SD 1.5, and unlimited optimism.', icon: <Trash2 className="text-slot-vae" />, tone: 'danger' })
    onClose()
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="settings-toggles">
        <SectionLabel className="mb-2">
          <span id="settings-toggles">Display &amp; feedback</span>
        </SectionLabel>
        <ul className="divide-y divide-charcoal-400/70 overflow-hidden rounded-xl border border-charcoal-400 bg-charcoal-700/40">
          {TOGGLES.map((t) => (
            <li key={t.key} className="px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-comfy bg-charcoal-700 text-smoke-600">{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-smoke-100">{t.label}</p>
                  <p className="text-xs text-smoke-600">{t.hint}</p>
                </div>
                <Switch checked={settings[t.key]} label={t.label} onChange={() => store.toggleSetting(t.key)} />
              </div>
              {t.key === 'sfx' && settings.sfx ? (
                <div className="mt-2 flex items-center gap-3 pl-11">
                  <label htmlFor={volumeId} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-smoke-600">
                    Volume
                  </label>
                  <input
                    id={volumeId}
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      setVolume(next)
                      setSfxVolume(next / 100)
                    }}
                    onPointerUp={() => playCue({ name: 'tick' })}
                    onKeyUp={() => playCue({ name: 'tick' })}
                    className="h-1 flex-1 cursor-pointer accent-electric-400"
                  />
                  <span className="w-8 text-right text-xs tabular-nums text-smoke-600">{volume}</span>
                  <ModalButton size="sm" onClick={() => playCue({ name: 'achievement' })}>
                    <Play size={13} />
                    Test
                  </ModalButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="settings-save">
        <SectionLabel className="mb-2">
          <span id="settings-save">Save data</span>
        </SectionLabel>
        <div className="flex flex-wrap gap-2">
          <ModalButton tone="primary" onClick={saveNow} data-autofocus>
            <Save size={15} />
            Save now
          </ModalButton>
          <ModalButton onClick={doExport}>
            <Download size={15} />
            Export code
          </ModalButton>
        </div>
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-charcoal-400 bg-charcoal-700/40 px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-comfy bg-charcoal-700 text-smoke-600">{SAVE_TOGGLE.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-smoke-100">{SAVE_TOGGLE.label}</p>
            <p className="text-xs text-smoke-600">
              {settings.autosave
                ? SAVE_TOGGLE.hint
                : 'Off: only S, Save now, and leaving the tab write the save. Living dangerously.'}
            </p>
          </div>
          <Switch checked={settings.autosave} label={SAVE_TOGGLE.label} onChange={() => store.toggleSetting('autosave')} />
        </div>
        <p className="mt-1.5 text-xs text-smoke-600">Autosaves every {AUTOSAVE_MS / 1000} s and whenever the tab hides. Press S to save any time.</p>
        {exported ? (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              readOnly
              value={exported}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Exported save code"
              rows={3}
              className="w-full resize-none rounded-xl border border-charcoal-400 bg-charcoal-800 p-2 font-mono text-[11px] leading-snug break-all text-smoke-600 focus-visible:border-electric-400"
            />
            <div className="flex items-center gap-2">
              <ModalButton size="sm" onClick={copy}>
                {copied ? <Check size={14} className="text-electric-400" /> : <ClipboardCopy size={14} />}
                {copied ? 'Copied' : 'Copy to clipboard'}
              </ModalButton>
              <span className="text-xs text-smoke-600 tabular-nums">{exported.length.toLocaleString('en-US')} characters</span>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby={importId}>
        <SectionLabel className="mb-2">
          <span id={importId}>Import a code</span>
        </SectionLabel>
        <textarea
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value)
            if (importError) setImportError(null)
          }}
          placeholder="Paste a CC1| save code (or a raw save JSON) here"
          aria-label="Save code to import"
          aria-invalid={importError ? 'true' : undefined}
          rows={3}
          className={cn(
            'w-full resize-none rounded-xl border bg-charcoal-800 p-2 font-mono text-[11px] leading-snug text-smoke-100 placeholder:text-smoke-800 focus-visible:border-electric-400',
            importError ? 'border-slot-vae' : 'border-charcoal-400',
          )}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ModalButton tone="sapphire" onClick={doImport} disabled={importText.trim() === ''} aria-disabled={importText.trim() === '' ? 'true' : undefined}>
            <Upload size={15} />
            Import &amp; replace
          </ModalButton>
          <span className={cn('text-xs', importError ? 'text-slot-vae' : 'text-smoke-600')} role={importError ? 'alert' : undefined}>
            {importError ?? (cloud ? 'Replaces the current run, and the cloud save within a minute. Export first if you want it back.' : 'Replaces the current run. Export first if you want it back.')}
          </span>
        </div>
      </section>

      <section aria-labelledby="settings-danger" className="rounded-xl border-2 border-charcoal-400 border-l-4 border-l-slot-vae bg-charcoal-700/40 p-3">
        <SectionLabel className="mb-1 text-slot-vae">
          <span id="settings-danger">Hard reset</span>
        </SectionLabel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-smoke-600">
            Wipes everything: credits, rigs, the Graph, achievements, CP{cloud ? ', and the cloud save follows within a minute' : ''}. No confirmation dialog after this one. The hold is the dialog.
          </p>
          <HoldToConfirm label="Hold to reset" holdingLabel="Wiping…" holdMs={2000} onConfirm={hardReset} icon={<Trash2 size={15} />} aria-label="Hold for two seconds to erase the save and start over" />
        </div>
      </section>

      <section aria-labelledby="settings-help">
        <SectionLabel className="mb-2">
          <span id="settings-help">Help</span>
        </SectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          <ModalButton
            onClick={() => {
              onClose()
              window.dispatchEvent(new CustomEvent('comfy:open-modal', { detail: 'help' }))
            }}
          >
            <GraduationCap size={15} />
            Replay the tutorial
          </ModalButton>
          <span className="text-xs text-smoke-600">Six steps, about ninety seconds. The ? in the header does this too.</span>
        </div>
      </section>

      <section aria-labelledby="settings-about" className="text-xs leading-relaxed text-smoke-600">
        <SectionLabel className="mb-1">
          <span id="settings-about" className="inline-flex items-center gap-1.5">
            <Info size={12} /> About
          </span>
        </SectionLabel>
        <p className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openPatchNotes}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[0.354em] border border-charcoal-400 bg-charcoal-600 px-2 text-[11px] font-bold text-smoke-100 transition-colors hover:border-charcoal-300 hover:bg-charcoal-500',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400',
            )}
          >
            <ScrollText size={12} aria-hidden="true" />
            Patch notes
            <span className="font-mono tabular-nums text-smoke-600">v{GAME_VERSION}</span>
          </button>
          <span className="text-[11px] text-smoke-600">{PATCH_NOTES[0]?.title}</span>
        </p>
        <p>
          <span className="font-semibold text-smoke-100">Comfy Clicker</span>, made by{' '}
          <a
            href="https://github.com/marawan206"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-electric-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
          >
            marawan206
          </a>
          . Click Generate, buy real GPUs, quantize everything, go viral. Art was generated using Comfy Cloud.
        </p>
        <p className="mt-1">
          Not affiliated with or endorsed by Comfy Org, NVIDIA, AMD, Apple, AWS, Azure or Runpod. Hardware names are used for flavour;
          prices are credits, and credits aren&rsquo;t real.
        </p>
      </section>
    </div>
  )
}

/**
 * The knob is positioned from an explicit `left`: without it Chrome puts an absolutely positioned
 * child of a button at the button's centred static position, so the ON translate pushed the knob
 * clean out of the pill and OFF looked like ON. The state word sits next to the pill so nobody
 * has to decode a colour.
 */
function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="group inline-flex shrink-0 items-center gap-2 rounded-comfy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-400"
    >
      <span
        className={cn(
          'w-6 text-right text-[10px] font-bold uppercase tracking-[0.08em] tabular-nums transition-colors',
          checked ? 'text-electric-400' : 'text-smoke-800',
        )}
        aria-hidden="true"
      >
        {checked ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative block h-6 w-11 rounded-full border-2 transition-colors',
          checked ? 'border-electric-400 bg-electric-400' : 'border-charcoal-300 bg-charcoal-700 group-hover:border-charcoal-200',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full shadow-[0_1px_0_rgba(0,0,0,0.35)] transition-[translate,background-color] duration-150',
            checked ? 'translate-x-5 bg-charcoal-800' : 'translate-x-0 bg-smoke-600',
          )}
        />
      </span>
    </button>
  )
}
