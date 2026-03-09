// https://xtls.github.io/development/protocols/vless.html
import 'dotenv/config'
import net from 'net'
import path from 'path'
import * as http from 'http'
import * as https from 'https'
import { readFileSync } from 'fs'
import { RawData, WebSocketServer, createWebSocketStream } from 'ws'
import express from 'express'

import {
  log,
  parseVLESS,
  closeNetSocket,
  isAllowedUpgradePath,
  isSupportedCommand,
  resolveServerConfig,
} from './utils'

const HANDSHAKE_TIMEOUT_MS = 10_000
const TARGET_SOCKET_TIMEOUT_MS = 30_000
const MAX_HANDSHAKE_PAYLOAD_BYTES = 64 * 1024

const { uuid, port, wsPath, certFile, keyFile, isHttps } = resolveServerConfig(process.env)

const app = express()
app.use('/static', express.static(path.join(__dirname, '../static')))

const server = isHttps
  ? https.createServer(
      {
        cert: readFileSync(certFile),
        key: readFileSync(keyFile),
      },
      app,
    )
  : http.createServer(app)
const wsServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_HANDSHAKE_PAYLOAD_BYTES,
})

function toBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }

  return Buffer.from(data)
}

wsServer.on('connection', ws => {
  const handshakeTimeout = setTimeout(() => {
    ws.close(1008, 'Handshake timeout')
  }, HANDSHAKE_TIMEOUT_MS)

  ws.once('close', () => {
    clearTimeout(handshakeTimeout)
  })

  ws.once('message', (msg: RawData) => {
    clearTimeout(handshakeTimeout)

    let info: ReturnType<typeof parseVLESS>
    try {
      info = parseVLESS(toBuffer(msg))
    } catch (error) {
      log('error', error instanceof Error ? error.message : 'Invalid VLESS request')
      ws.close(1008, 'Invalid VLESS request')
      return
    }

    if (info.uuid !== uuid) {
      ws.close(1008, 'Unauthorized UUID')
      return
    }

    if (!isSupportedCommand(info.command)) {
      ws.close(1003, 'Unsupported VLESS command')
      return
    }

    const targetSocket = net.createConnection({
      host: info.targetAddress,
      port: info.targetPort,
    })
    targetSocket.setTimeout(TARGET_SOCKET_TIMEOUT_MS)

    const duplexStream = createWebSocketStream(ws)

    targetSocket.once('connect', () => {
      ws.send(new Uint8Array([info.version, 0]))
      if (info.data.length > 0) {
        targetSocket.write(info.data)
      }

      duplexStream.pipe(targetSocket)
      targetSocket.pipe(duplexStream)
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
  })
})

server.on('upgrade', function upgrade(request, socket, head) {
  if (isAllowedUpgradePath(request.url, wsPath)) {
    wsServer.handleUpgrade(request, socket, head, function done(ws) {
      wsServer.emit('connection', ws, request)
    })
    return
  }

  socket.destroy()
})

server.listen(port, () => {
  const maskedUuid = `${uuid.slice(0, 8)}...${uuid.slice(-4)}`
  log(
    'info',
    `${isHttps ? 'https' : 'http'} server started on port ${port} with UUID ${maskedUuid}`,
  )
})
