#!/usr/bin/env bash
# Copies brand SVGs, fonts and palette references from the ComfyUI_frontend checkout.
# Usage: scripts/copy-brand-assets.sh [path-to-ComfyUI_frontend]
set -euo pipefail
SRC="${1:-/Users/marwan/Desktop/Developer/ComfyUI_frontend}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="$ROOT/src/assets/brand"
PUB="$ROOT/public/brand"
mkdir -p "$BRAND/vendors" "$BRAND/nodes" "$PUB" "$ROOT/public/fonts"

cp "$SRC/public/assets/images/comfy-logo-single.svg" "$BRAND/comfy-logo-single.svg"
cp "$SRC/public/assets/images/comfy-logo-mono.svg"   "$BRAND/comfy-logo-mono.svg"
cp "$SRC/public/assets/images/comfy-cloud-logo.svg"  "$BRAND/comfy-cloud-logo.svg"
cp "$SRC/public/assets/images/fallback-gradient-avatar.svg" "$BRAND/fallback-avatar.svg"
cp "$SRC/packages/design-system/src/icons/credits.svg" "$BRAND/credits.svg"
sed 's/fill="#8A8A8A"/fill="currentColor"/g' "$SRC/packages/design-system/src/icons/comfy-c.svg" > "$BRAND/comfy-c.svg"
cp "$SRC/public/fonts/inter-latin-normal.woff2" "$ROOT/public/fonts/inter-latin-normal.woff2"
cp "$SRC/public/fonts/inter-latin-italic.woff2" "$ROOT/public/fonts/inter-latin-italic.woff2"

for v in stability-ai bfl wan ltxv tencent ai-model kling veo sora luma minimax runway pixverse vidu ideogram recraft openai gemini grok elevenlabs meshy tripo bytedance moonvalley-marey topaz magnific; do
  f="$SRC/packages/design-system/src/icons/$v.svg"
  [ -f "$f" ] && cp "$f" "$BRAND/vendors/$v.svg" || echo "missing vendor icon: $v"
done
for n in text-to-image text-to-video image-to-video load-3-d lora-loader template node workflow save-image save-video play image-scale extensions-blocks image-edit image-inpainting image-batch load-video load-audio save-glb send pin canny depth-to-video pose-to-video subgraph-blueprint-canny-to-video-ltx-2-0 subgraph-blueprint-pose-to-video-ltx-2-0; do
  f="$SRC/packages/design-system/src/icons/$n.svg"
  [ -f "$f" ] && sed 's/fill="#8A8A8A"/fill="currentColor"/g; s/stroke="#8A8A8A"/stroke="currentColor"/g' "$f" > "$BRAND/nodes/$n.svg" || echo "missing node icon: $n"
done
# public copies for <img> use and favicon
cp "$BRAND/comfy-logo-single.svg" "$PUB/comfy-logo.svg"
cp "$BRAND/comfy-logo-single.svg" "$ROOT/public/favicon.svg"
cp "$BRAND/credits.svg" "$PUB/credits.svg"
echo "brand assets copied: $(ls "$BRAND" | wc -l) root, $(ls "$BRAND/vendors" | wc -l) vendors, $(ls "$BRAND/nodes" | wc -l) nodes"
