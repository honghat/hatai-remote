/**
 * useDaemonSocket — WebSocket hook for persistent Agent Daemon connection.
 *
 * Auto-connects on mount, auto-reconnects on disconnect.
 * Provides: sendCommand, daemonState, events, and control functions.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const WS_BASE = `ws://${window.location.hostname}:8000/agent/daemon/ws`
const RECONNECT_DELAY = 3000
const MAX_RECONNECT_DELAY = 30000

function getWsUrl() {
  const token = localStorage.getItem('hatai_token')
  return token ? `${WS_BASE}?token=${encodeURIComponent(token)}` : WS_BASE
}

export default function useDaemonSocket() {
  const [connected, setConnected] = useState(false)
  const [daemonState, setDaemonState] = useState('stopped') // idle, running, paused, stopped
  const [daemonInfo, setDaemonInfo] = useState({})
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const reconnectDelay = useRef(RECONNECT_DELAY)
  const onEventRef = useRef(null) // callback for incoming events
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(getWsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setConnected(true)
        reconnectDelay.current = RECONNECT_DELAY
        console.log('[Daemon] WebSocket connected')
      }

      ws.onmessage = (e) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(e.data)

          // Update daemon state from status events
          if (data.type === 'daemon_status' || data.type === 'heartbeat') {
            if (data.state) setDaemonState(data.state)
            setDaemonInfo(prev => ({ ...prev, ...data }))
          }

          // Forward all events to the callback
          if (onEventRef.current) {
            onEventRef.current(data)
          }
        } catch {}
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        console.log(`[Daemon] WebSocket disconnected, reconnecting in ${reconnectDelay.current}ms...`)

        reconnectTimer.current = setTimeout(() => {
          if (mountedRef.current) {
            reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_DELAY)
            connect()
          }
        }, reconnectDelay.current)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      // Will retry via onclose
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  // Send a raw JSON command to daemon
  const sendRaw = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
      return true
    }
    return false
  }, [])

  // High-level commands
  const sendTask = useCallback((message, sessionId = null, opts = {}) => {
    return sendRaw({
      type: 'task',
      message,
      session_id: sessionId,
      max_tokens: opts.maxTokens || 8192,
      temperature: opts.temperature || 0.5,
    })
  }, [sendRaw])

  const pause = useCallback(() => sendRaw({ type: 'pause' }), [sendRaw])
  const resume = useCallback(() => sendRaw({ type: 'resume' }), [sendRaw])
  const cancel = useCallback(() => sendRaw({ type: 'cancel' }), [sendRaw])
  const stop = useCallback(() => sendRaw({ type: 'stop' }), [sendRaw])
  const requestStatus = useCallback(() => sendRaw({ type: 'status' }), [sendRaw])
  const inject = useCallback((message) => sendRaw({ type: 'inject', message }), [sendRaw])

  // Set event handler
  const onEvent = useCallback((handler) => {
    onEventRef.current = handler
  }, [])

  return {
    connected,
    daemonState,
    daemonInfo,
    sendTask,
    sendRaw,
    pause,
    resume,
    cancel,
    stop,
    inject,
    requestStatus,
    onEvent,
  }
}
