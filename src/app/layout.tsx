import type { Metadata, Viewport } from 'next'
import './globals.css'
import { GameProvider } from '@/components/layout/GameProvider'

export const metadata: Metadata = {
  title: 'Comfy Clicker',
  description: 'Click Generate. Buy GPUs. Quantize everything. Go viral. An incremental game for ComfyUI people.',
  icons: { icon: '/favicon.svg' },
  openGraph: { title: 'Comfy Clicker', description: 'Click Generate. Buy GPUs. Quantize everything. Go viral.', type: 'website' },
}

export const viewport: Viewport = { themeColor: '#171718', width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-dvh bg-charcoal-800 font-inter text-smoke-100 antialiased selection:bg-electric-400 selection:text-charcoal-800">
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  )
}
