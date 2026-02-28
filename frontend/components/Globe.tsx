'use client'

import createGlobe from 'cobe'
import { useEffect, useRef } from 'react'
import type { AttackEvent, GlobeArc } from '@/types'

// Arc rendering constants
const ARC_SEGMENTS = 64     // path resolution
const ARC_ALTITUDE = 0.35   // how high arcs lift above the globe surface

// Cloudflare PoP destinations shown as fixed markers
const POP_MARKERS = [
  { location: [37.3382, -121.8863] as [number, number], size: 0.07 }, // SJC
  { location: [51.5074, -0.1278]   as [number, number], size: 0.07 }, // LHR
  { location: [50.1109,  8.6821]   as [number, number], size: 0.07 }, // FRA
  { location: [1.3521,  103.8198]  as [number, number], size: 0.07 }, // SIN
  { location: [-33.8688, 151.2093] as [number, number], size: 0.07 }, // SYD
]

// ── Math helpers ───────────────────────────────────────────────────────────────

function toVec3(lat: number, lng: number): [number, number, number] {
  const phi    = (lat * Math.PI) / 180
  const lambda = (lng * Math.PI) / 180
  return [
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(lambda),
  ]
}

function slerp(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const dot = Math.min(1, Math.max(-1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]))
  const angle = Math.acos(dot)
  if (angle < 1e-5) return a
  const s  = Math.sin(angle)
  const fa = Math.sin((1 - t) * angle) / s
  const fb = Math.sin(t * angle) / s
  return [fa*a[0] + fb*b[0], fa*a[1] + fb*b[1], fa*a[2] + fb*b[2]]
}

// Rotate vector around Y axis by phi (matches cobe's globe rotation)
function rotateY(
  v: [number, number, number],
  phi: number,
): [number, number, number] {
  const [x, y, z] = v
  return [
    x * Math.cos(phi) - z * Math.sin(phi),
    y,
    x * Math.sin(phi) + z * Math.cos(phi),
  ]
}

// Orthographic projection to canvas space
function project(
  vec: [number, number, number],
  pxSize: number,
): { x: number; y: number; visible: boolean } {
  const [rx, ry, rz] = vec
  return {
    x: (0.5 + rx / 2) * pxSize,
    y: (0.5 - ry / 2) * pxSize,
    visible: rz > 0,
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface HitTarget {
  x: number   // logical pixels
  y: number
  arc: GlobeArc
}

interface GlobeProps {
  arcs: GlobeArc[]
  onArcClick: (event: AttackEvent) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Globe({ arcs, onArcClick }: GlobeProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const globeRef      = useRef<HTMLCanvasElement>(null)
  const overlayRef    = useRef<HTMLCanvasElement>(null)
  const phiRef        = useRef(0)
  const arcsRef       = useRef(arcs)
  const hitTargets    = useRef<HitTarget[]>([])

  // Keep arcsRef current without re-creating the globe
  useEffect(() => { arcsRef.current = arcs }, [arcs])

  useEffect(() => {
    const container = containerRef.current!
    const globeCanvas = globeRef.current!
    const overlay = overlayRef.current!

    const logicalSize = container.clientWidth || 600
    const dpr = window.devicePixelRatio || 1
    const pxSize = logicalSize * dpr

    // Size the overlay canvas
    overlay.width  = pxSize
    overlay.height = pxSize
    overlay.style.width  = `${logicalSize}px`
    overlay.style.height = `${logicalSize}px`

    const globe = createGlobe(globeCanvas, {
      devicePixelRatio: dpr,
      width:  pxSize,
      height: pxSize,
      phi:    0,
      theta:  0.3,
      dark:   1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor:   [0.04, 0.04, 0.12],
      markerColor: [0.25, 0.65, 1.0],   // cyan — Cloudflare PoP colour
      glowColor:   [0.08, 0.15, 0.6],
      markers: POP_MARKERS,
      onRender(state) {
        phiRef.current += 0.003
        state.phi = phiRef.current
        drawArcs(overlay, phiRef.current, logicalSize, dpr)
      },
    })

    globeCanvas.style.width  = `${logicalSize}px`
    globeCanvas.style.height = `${logicalSize}px`

    return () => globe.destroy()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Arc rendering ────────────────────────────────────────────────────────────

  function drawArcs(
    canvas: HTMLCanvasElement,
    phi: number,
    logicalSize: number,
    dpr: number,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pxSize = logicalSize * dpr
    ctx.clearRect(0, 0, pxSize, pxSize)

    const newHitTargets: HitTarget[] = []

    for (const arc of arcsRef.current) {
      const startVec = toVec3(arc.startLat, arc.startLng)
      const endVec   = toVec3(arc.endLat,   arc.endLng)

      // Build screen-space path along the great circle with altitude lift
      const pts: Array<{ x: number; y: number; visible: boolean }> = []
      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const t      = i / ARC_SEGMENTS
        const interp = slerp(startVec, endVec, t)
        const alt    = 1 + ARC_ALTITUDE * Math.sin(t * Math.PI)
        const lifted: [number, number, number] = [
          interp[0] * alt,
          interp[1] * alt,
          interp[2] * alt,
        ]
        pts.push(project(rotateY(lifted, phi), pxSize))
      }

      // Register hit target at arc source (attacker) — in logical pixels
      newHitTargets.push({ x: pts[0].x / dpr, y: pts[0].y / dpr, arc })

      // Draw arc as visible segments (skip behind-the-globe sections)
      ctx.strokeStyle = arc.color
      ctx.lineWidth   = 1.5 * dpr
      ctx.shadowColor = arc.color
      ctx.shadowBlur  = 6 * dpr
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      let drawing = false

      for (const pt of pts) {
        if (pt.visible) {
          if (!drawing) { ctx.moveTo(pt.x, pt.y); drawing = true }
          else ctx.lineTo(pt.x, pt.y)
        } else {
          if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false }
        }
      }
      if (drawing) ctx.stroke()

      // Dot at attacker source
      const src = pts[0]
      if (src.visible) {
        ctx.beginPath()
        ctx.arc(src.x, src.y, 3.5 * dpr, 0, Math.PI * 2)
        ctx.fillStyle   = arc.color
        ctx.globalAlpha = 1
        ctx.shadowBlur  = 10 * dpr
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1
    ctx.shadowBlur  = 0
    hitTargets.current = newHitTargets
  }

  // ── Click handling ───────────────────────────────────────────────────────────

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    let nearest: HitTarget | null = null
    let minDist = 28 // px hit radius

    for (const target of hitTargets.current) {
      const d = Math.hypot(target.x - x, target.y - y)
      if (d < minDist) { minDist = d; nearest = target }
    }

    if (nearest) onArcClick(nearest.arc.event)
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-square max-w-2xl mx-auto select-none"
    >
      {/* cobe WebGL globe */}
      <canvas
        ref={globeRef}
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      />
      {/* 2D arc overlay — pointer-events off so cobe receives mouse events */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />
      {/* Transparent click capture div */}
      <div
        className="absolute inset-0 cursor-crosshair"
        onClick={handleClick}
      />
    </div>
  )
}
