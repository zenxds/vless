import net from 'net'
import path from 'path'
import * as http from 'http'
import * as https from 'https'
import { readFileSync } from 'fs'
import {
  RawData,
  WebSocket,
  WebSocketServer,
  createWebSocketStream,
} from 'ws'
import express from 'express'

import { ParsedVLESSRequest, ServerConfig } from './types'
import {
  IncompleteVlessHeaderError,
  closeNetSocket,
  isAllowedUpgradePath,
  isSupportedCommand,
  log,
  parseVLESS,
} from './utils'

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000
export const DEFAULT_TARGET_SOCKET_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_WS_PAYLOAD_BYTES = 1024 * 1024
export const DEFAULT_MAX_VLESS_HEADER_BYTES = 1024

export interface VlessServerOptions {
  handshakeTimeoutMs?: number
  targetSocketTimeoutMs?: number
  maxPayloadBytes?: number
  maxHeaderBytes?: number
}

function toBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }

  return Buffer.from(data)
}

function rejectWebSocket(ws: WebSocket, code: number, reason: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(code, reason)
  }
}

function startTcpProxy(
  ws: WebSocket,
  info: ParsedVLESSRequest,
  targetSocketTimeoutMs: number,
) {
  const targetSocket = net.createConnection({
    host: info.targetAddress,
    port: info.targetPort,
  })
  targetSocket.setTimeout(targetSocketTimeoutMs)

  const duplexStream = createWebSocketStream(ws)

  targetSocket.once('connect', () => {
    ws.send(new Uint8Array([info.version, 0]))

    duplexStream.pipe(targetSocket)
    targetSocket.pipe(duplexStream)

    if (info.data.length > 0) {
      targetSocket.write(info.data)
    }
  })

  targetSocket.on('close', hasError => {
    closeNetSocket(duplexStream, hasError)
  })

  duplexStream.on('close', () => {
    closeNetSocket(targetSocket)
  })

  targetSocket.on('error', () => {
    closeNetSocket(targetSocket, true)
    closeNetSocket(duplexStream, true)
  })

  targetSocket.on('timeout', () => {
    closeNetSocket(targetSocket, true)
    closeNetSocket(duplexStream, true)
  })

  duplexStream.on('error', () => {
    closeNetSocket(duplexStream, true)
    closeNetSocket(targetSocket, true)
  })
}

export function createVlessServer(
  config: ServerConfig,
  options: VlessServerOptions = {},
) {
  const handshakeTimeoutMs =
    options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  const targetSocketTimeoutMs =
    options.targetSocketTimeoutMs ?? DEFAULT_TARGET_SOCKET_TIMEOUT_MS
  const maxPayloadBytes =
    options.maxPayloadBytes ?? DEFAULT_MAX_WS_PAYLOAD_BYTES
  const maxHeaderBytes =
    options.maxHeaderBytes ?? DEFAULT_MAX_VLESS_HEADER_BYTES

  const app = express()
  app.get('/health', (_req, res): void => {
    res.send('ok')
  })
  app.use('/static', express.static(path.join(__dirname, '../static')))

  const server = config.isHttps
    ? https.createServer(
        {
          cert: readFileSync(config.certFile),
          key: readFileSync(config.keyFile),
        },
        app,
      )
    : http.createServer(app)

  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: maxPayloadBytes,
  })

  wsServer.on('connection', ws => {
    let handshakeBuffer = Buffer.alloc(0)

    const handshakeTimeout = setTimeout(() => {
      rejectWebSocket(ws, 1008, 'Handshake timeout')
    }, handshakeTimeoutMs)

    const clearHandshakeState = () => {
      clearTimeout(handshakeTimeout)
      handshakeBuffer = Buffer.alloc(0)
    }

    ws.once('close', clearHandshakeState)
    ws.on('error', error => {
      log('error', error.message)
    })

    const handleHandshakeMessage = (msg: RawData, isBinary: boolean) => {
      if (!isBinary) {
        clearHandshakeState()
        ws.off('message', handleHandshakeMessage)
        rejectWebSocket(ws, 1003, 'Binary messages required')
        return
      }

      handshakeBuffer = Buffer.concat([handshakeBuffer, toBuffer(msg)])

      let info: ParsedVLESSRequest
      try {
        info = parseVLESS(handshakeBuffer)
      } catch (error) {
        if (
          error instanceof IncompleteVlessHeaderError &&
          handshakeBuffer.length <= maxHeaderBytes
        ) {
          return
        }

        clearHandshakeState()
        ws.off('message', handleHandshakeMessage)
        log('error', error instanceof Error ? error.message : 'Invalid VLESS request')
        rejectWebSocket(ws, 1008, 'Invalid VLESS request')
        return
      }

      clearHandshakeState()
      ws.off('message', handleHandshakeMessage)

      if (info.uuid !== config.uuid) {
        rejectWebSocket(ws, 1008, 'Unauthorized UUID')
        return
      }

      if (!isSupportedCommand(info.command)) {
        rejectWebSocket(ws, 1003, 'Unsupported VLESS command')
        return
      }

      startTcpProxy(ws, info, targetSocketTimeoutMs)
    }

    ws.on('message', handleHandshakeMessage)
  })

  server.on('upgrade', (request, socket, head) => {
    if (isAllowedUpgradePath(request.url, config.wsPath)) {
      wsServer.handleUpgrade(request, socket, head, ws => {
        wsServer.emit('connection', ws, request)
      })
      return
    }

    socket.destroy()
  })

  return { server, wsServer }
}
