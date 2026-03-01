'use client'

import createGlobe from 'cobe'
import { memo, useEffect, useRef, useState } from 'react'
import type { AttackEvent, GlobeArc, HistoricalArc, ViewMode } from '@/types'

const ARC_SEGMENTS = 48
const ARC_ALTITUDE = 0.35

// Cloudflare PoP destinations shown as fixed markers
const POP_MARKERS = [
  { location: [37.3382, -121.8863] as [number, number], size: 0.07 }, // SJC
  { location: [51.5074, -0.1278]   as [number, number], size: 0.07 }, // LHR
  { location: [50.1109,  8.6821]   as [number, number], size: 0.07 }, // FRA
  { location: [1.3521,  103.8198]  as [number, number], size: 0.07 }, // SIN
  { location: [-33.8688, 151.2093] as [number, number], size: 0.07 }, // SYD
]

// ── Math helpers ───────────────────────────────────────────────────────────────

// cobe's internal 3D convention (verified from minified source):
//   x = cos(lat) * cos(lng)
//   y = sin(lat)
//   z = -cos(lat) * sin(lng)
// Different from the standard geographic convention — must match exactly.
function toVec3(lat: number, lng: number): [number, number, number] {
  const phi    = (lat * Math.PI) / 180
  const lambda = (lng * Math.PI) / 180
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.sin(phi),
    -Math.cos(phi) * Math.sin(lambda),
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

// Standard Y-axis rotation — matches cobe's J(theta, phi) matrix's phi columns:
//   x' =  x*cos(phi) + z*sin(phi)
//   z' = -x*sin(phi) + z*cos(phi)
function rotateY(
  v: [number, number, number],
  phi: number,
): [number, number, number] {
  const [x, y, z] = v
  return [
    x * Math.cos(phi) + z * Math.sin(phi),
    y,
    -x * Math.sin(phi) + z * Math.cos(phi),
  ]
}

// X-axis rotation — matches cobe's J(theta, phi) matrix's theta columns.
// Applied after Y rotation to reproduce cobe's full transform: R_x(theta) * R_y(phi).
function rotateX(
  v: [number, number, number],
  theta: number,
): [number, number, number] {
  const [x, y, z] = v
  return [
    x,
    y * Math.cos(theta) - z * Math.sin(theta),
    y * Math.sin(theta) + z * Math.cos(theta),
  ]
}

// Orthographic projection to canvas pixel space.
// cobe's sphere occupies 80% of the canvas (sphere diameter = 0.8 * canvas_size),
// so the correct scale factor is 0.4 (radius = 40% of canvas), NOT 0.5.
function project(
  vec: [number, number, number],
  pxSize: number,
): { x: number; y: number; visible: boolean } {
  const [rx, ry, rz] = vec
  return {
    x: (0.5 + rx * 0.4) * pxSize,
    y: (0.5 - ry * 0.4) * pxSize,
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
  viewMode?: ViewMode
  historicalArcs?: HistoricalArc[]
}

// ── Component ──────────────────────────────────────────────────────────────────

function Globe({ arcs, onArcClick, viewMode = 'live', historicalArcs = [] }: GlobeProps) {
  const containerRef      = useRef<HTMLDivElement>(null)
  const globeRef          = useRef<HTMLCanvasElement>(null)
  const overlayRef        = useRef<HTMLCanvasElement>(null)
  const phiRef            = useRef(0)
  const thetaRef          = useRef(0.3)   // kept in sync with cobe's theta uniform
  const arcsRef           = useRef(arcs)
  const historicalArcsRef = useRef(historicalArcs)
  const viewModeRef       = useRef(viewMode)
  const hitTargets        = useRef<HitTarget[]>([])
  const isDraggingRef     = useRef(false)
  const dragStartRef      = useRef({ x: 0, y: 0 })
  const lastPosRef        = useRef({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  // Keep refs current without re-creating the globe
  useEffect(() => { arcsRef.current = arcs },                 [arcs])
  useEffect(() => { historicalArcsRef.current = historicalArcs }, [historicalArcs])
  useEffect(() => { viewModeRef.current = viewMode },         [viewMode])

  useEffect(() => {
    const container   = containerRef.current!
    const globeCanvas = globeRef.current!
    const overlay     = overlayRef.current!

    const logicalSize = container.clientWidth || container.clientHeight || 600
    const dpr         = window.devicePixelRatio || 1
    const pxSize      = logicalSize * dpr

    // Size the overlay canvas to match globe resolution, fill container via CSS
    overlay.width  = pxSize
    overlay.height = pxSize
    overlay.style.width  = '100%'
    overlay.style.height = '100%'

    const globe = createGlobe(globeCanvas, {
      devicePixelRatio: dpr,
      width:   pxSize,
      height:  pxSize,
      phi:     0,
      theta:   thetaRef.current,
      dark:    1,
      diffuse: 1.2,
      mapSamples:    16000,
      mapBrightness: 6,
      baseColor:   [0.04, 0.04, 0.12],
      markerColor: [0.25, 0.65, 1.0],
      glowColor:   [0.08, 0.15, 0.6],
      markers: POP_MARKERS,
      onRender(state) {
        // Always auto-rotate — drag input adds on top in pointer handlers
        phiRef.current += 0.003
        state.phi   = phiRef.current
        state.theta = thetaRef.current   // push current theta into cobe each frame
        if (viewModeRef.current === 'history') {
          drawHistoricalArcs(overlay, phiRef.current, thetaRef.current, logicalSize, dpr)
        } else {
          drawArcs(overlay, phiRef.current, thetaRef.current, logicalSize, dpr)
        }
      },
    })

    return () => globe.destroy()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Arc rendering ────────────────────────────────────────────────────────────

  function drawArcs(
    canvas: HTMLCanvasElement,
    phi: number,
    theta: number,
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

      // Build screen-space path: great-circle slerp + altitude lift + full rotation
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
        // Apply both rotations to match cobe's transform: R_x(theta) * R_y(phi)
        pts.push(project(rotateX(rotateY(lifted, phi), theta), pxSize))
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

      // Arrowhead at destination end (last visible segment, pointing direction of travel)
      let arrowIdx = -1
      for (let i = ARC_SEGMENTS; i > 0; i--) {
        if (pts[i].visible && pts[i - 1].visible) { arrowIdx = i; break }
      }
      if (arrowIdx > 0) {
        const tip = pts[arrowIdx]
        const bk  = pts[arrowIdx - 1]
        const dx  = tip.x - bk.x
        const dy  = tip.y - bk.y
        const mag = Math.hypot(dx, dy)
        if (mag > 0) {
          const nx = dx / mag
          const ny = dy / mag
          const al = 8 * dpr   // arrow length
          const aw = 4 * dpr   // arrow half-width
          ctx.beginPath()
          ctx.moveTo(tip.x, tip.y)
          ctx.lineTo(tip.x - nx * al - ny * aw, tip.y - ny * al + nx * aw)
          ctx.lineTo(tip.x - nx * al + ny * aw, tip.y - ny * al - nx * aw)
          ctx.closePath()
          ctx.fillStyle   = arc.color
          ctx.globalAlpha = 0.9
          ctx.shadowColor = arc.color
          ctx.shadowBlur  = 6 * dpr
          ctx.fill()
        }
      }

      // Attacker origin — outer pulse ring + bright white core
      const src = pts[0]
      if (src.visible) {
        // Outer ring (marks attacker)
        ctx.beginPath()
        ctx.arc(src.x, src.y, 9 * dpr, 0, Math.PI * 2)
        ctx.strokeStyle = arc.color
        ctx.lineWidth   = 1.5 * dpr
        ctx.globalAlpha = 0.35
        ctx.shadowBlur  = 0
        ctx.stroke()

        // Coloured mid fill
        ctx.beginPath()
        ctx.arc(src.x, src.y, 5 * dpr, 0, Math.PI * 2)
        ctx.fillStyle   = arc.color
        ctx.globalAlpha = 0.3
        ctx.fill()

        // Bright white core
        ctx.beginPath()
        ctx.arc(src.x, src.y, 3 * dpr, 0, Math.PI * 2)
        ctx.fillStyle   = '#ffffff'
        ctx.globalAlpha = 1
        ctx.shadowColor = arc.color
        ctx.shadowBlur  = 14 * dpr
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1
    ctx.shadowBlur  = 0
    hitTargets.current = newHitTargets
  }

  // ── Historical arc rendering ──────────────────────────────────────────────────
  // Static country-level arcs — no animation, thickness + opacity encode weight.

  function drawHistoricalArcs(
    canvas: HTMLCanvasElement,
    phi: number,
    theta: number,
    logicalSize: number,
    dpr: number,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pxSize = logicalSize * dpr
    ctx.clearRect(0, 0, pxSize, pxSize)

    for (const harc of historicalArcsRef.current) {
      const startVec = toVec3(harc.origin.lat, harc.origin.lng)
      const endVec   = toVec3(harc.target.lat, harc.target.lng)

      const pts: Array<{ x: number; y: number; visible: boolean }> = []
      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const t      = i / ARC_SEGMENTS
        const interp = slerp(startVec, endVec, t)
        const alt    = 1 + ARC_ALTITUDE * 0.6 * Math.sin(t * Math.PI)  // lower arc than live
        const lifted: [number, number, number] = [interp[0] * alt, interp[1] * alt, interp[2] * alt]
        pts.push(project(rotateX(rotateY(lifted, phi), theta), pxSize))
      }

      // Thickness: 1–4px based on weight, opacity: 0.25–0.75
      const w = Math.max(0, Math.min(1, harc.weight))
      ctx.strokeStyle = '#818cf8'   // indigo-400 — distinct from live attack-type colors
      ctx.lineWidth   = (1 + w * 3) * dpr
      ctx.shadowColor = '#6366f1'
      ctx.shadowBlur  = 4 * dpr
      ctx.globalAlpha = 0.25 + w * 0.5

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

      // Arrowhead at destination end (last visible segment)
      let hArrowIdx = -1
      for (let i = ARC_SEGMENTS; i > 0; i--) {
        if (pts[i].visible && pts[i - 1].visible) { hArrowIdx = i; break }
      }
      if (hArrowIdx > 0) {
        const tip = pts[hArrowIdx]
        const bk  = pts[hArrowIdx - 1]
        const dx  = tip.x - bk.x
        const dy  = tip.y - bk.y
        const mag = Math.hypot(dx, dy)
        if (mag > 0) {
          const nx = dx / mag
          const ny = dy / mag
          const al = (5 + w * 4) * dpr   // scale arrow with weight
          const aw = (2.5 + w * 2) * dpr
          ctx.beginPath()
          ctx.moveTo(tip.x, tip.y)
          ctx.lineTo(tip.x - nx * al - ny * aw, tip.y - ny * al + nx * aw)
          ctx.lineTo(tip.x - nx * al + ny * aw, tip.y - ny * al - nx * aw)
          ctx.closePath()
          ctx.fillStyle   = '#818cf8'
          ctx.globalAlpha = 0.4 + w * 0.5
          ctx.shadowColor = '#6366f1'
          ctx.shadowBlur  = 4 * dpr
          ctx.fill()
        }
      }

      // Origin country — outer ring + bright white core (mirrors live arc styling)
      const src = pts[0]
      if (src.visible) {
        // Outer ring
        ctx.beginPath()
        ctx.arc(src.x, src.y, (7 + w * 3) * dpr, 0, Math.PI * 2)
        ctx.strokeStyle = '#818cf8'
        ctx.lineWidth   = 1.5 * dpr
        ctx.globalAlpha = 0.2 + w * 0.2
        ctx.shadowBlur  = 0
        ctx.stroke()

        // Coloured mid fill
        ctx.beginPath()
        ctx.arc(src.x, src.y, (4 + w * 2) * dpr, 0, Math.PI * 2)
        ctx.fillStyle   = '#818cf8'
        ctx.globalAlpha = 0.2 + w * 0.3
        ctx.fill()

        // Bright white core
        ctx.beginPath()
        ctx.arc(src.x, src.y, (2 + w) * dpr, 0, Math.PI * 2)
        ctx.fillStyle   = '#ffffff'
        ctx.globalAlpha = 0.6 + w * 0.4
        ctx.shadowColor = '#6366f1'
        ctx.shadowBlur  = 10 * dpr
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1
    ctx.shadowBlur  = 0
    hitTargets.current = []  // no click targets in history mode
  }

  // ── Pointer / drag handling ───────────────────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    isDraggingRef.current = true
    setDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    lastPosRef.current   = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    phiRef.current   += dx * 0.008
    thetaRef.current  = Math.max(-0.5, Math.min(0.5, thetaRef.current + dy * 0.008))
  }

  function handlePointerUp() {
    isDraggingRef.current = false
    setDragging(false)
  }

  // ── Click handling ───────────────────────────────────────────────────────────

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    // Ignore click if the pointer actually moved (was a drag, not a tap)
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    if (Math.hypot(dx, dy) > 5) return

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
      className="relative aspect-square h-full max-w-full select-none"
    >
      {/* cobe WebGL globe */}
      <canvas
        ref={globeRef}
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      />
      {/* 2D arc overlay — pointer-events off so drag/click reach the div below */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />
      {/* Interaction capture */}
      <div
        className={`absolute inset-0 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  )
}

export default memo(Globe)
