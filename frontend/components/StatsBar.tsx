'use client'

import { useState, useEffect } from 'react'
import { Shield, Bell, User } from 'lucide-react'

interface HeaderProps {
  isConnected: boolean
}

export default function Header({ isConnected }: HeaderProps) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-6 shrink-0 z-50">
      {/* Brand */}
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20">
          <Shield className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          <h1 className="font-bold text-lg tracking-tight text-slate-100 leading-none font-mono">
            SENTINEL <span className="text-emerald-500 text-xs align-top">PRO</span>
          </h1>
          <div className="text-[10px] text-slate-500 font-mono uppercase tracking-widest leading-none mt-1">
            Global Threat Intelligence
          </div>
        </div>
      </div>

      {/* Right: clock + status + icons */}
      <div className="flex items-center gap-6 text-slate-400">
        <div className="text-right hidden sm:block">
          <div className="text-xs font-mono text-slate-300">{time}</div>
          <div className="text-[10px] text-slate-600 font-mono">LOCAL</div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className={isConnected ? 'text-emerald-400' : 'text-amber-400'}>
            {isConnected ? 'LIVE' : 'RECONNECTING'}
          </span>
        </div>

        <button className="p-2 hover:bg-slate-800 rounded-full transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-slate-950" />
        </button>
        <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
          <User className="w-4 h-4" />
        </div>
      </div>
    </header>
  )
}
