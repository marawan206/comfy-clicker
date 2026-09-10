/**
 * The litegraph canvas behind everything: a fixed, full-screen dot grid (24 px dots, every fifth
 * one brighter at 120 px) with a faint vignette so the panels read as nodes floating on a graph.
 * Pure presentation — no hooks, pointer-events none, sits at z-0 under the z-10 shell content.
 */
export function DotGrid() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 select-none">
      <div className="cc-dot-grid absolute inset-0" />
      <div className="cc-vignette absolute inset-0" />
    </div>
  )
}
