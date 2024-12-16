// https://xtls.github.io/development/protocols/vless.html
import 'dotenv/config'
import net from 'net'
import path from 'path'
import * as http from 'http'
import * as https from 'https'
import { readFileSync } from 'fs'
import { WebSocketServer, createWebSocketStream } from 'ws'
import express from 'express'

import { log, parseVLESS, closeWebSocket, closeNetSocket } from './utils'

const UUID = process.env.UUID || ''
const PORT = Number(process.env.PORT || 3000)
const WS_PATH = process.env.WS_PATH || '/'
const CERT_FILE = process.env.CERT_FILE || ''
const KEY_FILE = process.env.KEY_FILE || ''

const isHttps = CERT_FILE && KEY_FILE

const app = express()
app.use('/static', express.static(path.join(__dirname, '../static')))

const server = isHttps
  ? https.createServer(
      {
        cert: readFileSync(CERT_FILE),
        key: readFileSync(KEY_FILE),
      },
      app,
    )
  : http.createServer(app)
const wsServer = new WebSocketServer({ noServer: true })

wsServer.on('connection', ws => {
  ws.once('message', (msg: Buffer) => {
    const info = parseVLESS(msg)

    if (info.uuid !== UUID) {
      ws.close()
      return
    }

    const targetSocket = net.createConnection({
      host: info.targetAddress,
      port: info.targetPort,
    })

    targetSocket.once('connect', () => {
      ws.send(new Uint8Array([info.version, 0]))
      targetSocket.write(info.data)

      const duplexStream = createWebSocketStream(ws)
      duplexStream.pipe(targetSocket)
    })

    // 转发目标服务器的数据回 WebSocket 客户端
    targetSocket.on('data', chunk => {
      ws.send(chunk)
    })

    targetSocket.on('error', err => {
      targetSocket.destroy(err)
    })

    targetSocket.on('close', hasError => {
      closeWebSocket(ws, hasError)
    })

    ws.on('error', () => {
      ws.close()
    })

    ws.on('close', () => {
      closeNetSocket(targetSocket)
    })
  })
})

server.on('upgrade', function upgrade(request, socket, head) {
  const { pathname } = new URL(request.url || '', 'wss://base.url')

  if (pathname === WS_PATH) {
    wsServer.handleUpgrade(request, socket, head, function done(ws) {
      wsServer.emit('connection', ws, request)
    })
  }
})

server.listen(PORT, () => {
  log(
    'info',
    `${isHttps ? 'https' : 'http'} server started on port ${PORT} with UUID ${UUID}`,
  )
})
