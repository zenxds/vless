import { AddressInfo } from 'net'
import net from 'net'
import * as http from 'http'
import { once } from 'events'
import { RawData, WebSocket, WebSocketServer } from 'ws'

import {
  DEFAULT_MAX_WS_PAYLOAD_BYTES,
  createVlessServer,
} from '@/server'
import { ServerConfig, VlessCommand } from '@/types'

const TEST_UUID = '123e4567e89b12d3a456426614174000'

function createVlessPacket(options: {
  port: number
  uuid?: string
  command?: number
  data?: Buffer
}) {
  return Buffer.concat([
    Buffer.from([0]),
    Buffer.from(options.uuid || TEST_UUID, 'hex'),
    Buffer.from([0]),
    Buffer.from([options.command ?? VlessCommand.TCP]),
    Buffer.from([options.port >> 8, options.port & 0xff]),
    Buffer.from([1, 127, 0, 0, 1]),
    options.data || Buffer.alloc(0),
  ])
}

function rawDataToBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }

  return Buffer.from(data)
}

async function listen(server: net.Server | http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

async function closeServer(server: net.Server | http.Server) {
  if (!server.listening) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

async function closeVlessServer(
  server: http.Server,
  wsServer: WebSocketServer,
) {
  for (const client of wsServer.clients) {
    client.terminate()
  }

  await Promise.all([
    closeServer(server),
    new Promise<void>(resolve => wsServer.close(() => resolve())),
  ])
}

async function openWebSocket(url: string) {
  const ws = new WebSocket(url)
  await once(ws, 'open')
  ws.on('error', () => undefined)
  return ws
}

function waitForClose(ws: WebSocket) {
  return new Promise<{ code: number; reason: string }>(resolve => {
    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
    })
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 2_000) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for test event')),
      timeoutMs,
    )

    promise.then(
      value => {
        clearTimeout(timeout)
        resolve(value)
      },
      error => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

describe('VLESS WebSocket server', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.()
    }
  })

  async function startVlessServer(
    options: Parameters<typeof createVlessServer>[1] = {},
  ) {
    const config: ServerConfig = {
      uuid: TEST_UUID,
      port: 0,
      wsPath: '/ws',
      certFile: '',
      keyFile: '',
      isHttps: false,
    }
    const instance = createVlessServer(config, options)
    const port = await listen(instance.server)
    cleanups.push(() => closeVlessServer(instance.server, instance.wsServer))
    return { ...instance, port }
  }

  async function startTcpServer(
    connectionHandler: (socket: net.Socket) => void,
  ) {
    const server = net.createServer(connectionHandler)
    const port = await listen(server)
    cleanups.push(() => closeServer(server))
    return { server, port }
  }

  test('buffers a split VLESS header, forwards large early data, and propagates close', async () => {
    let resolveTargetClosed: () => void = () => undefined
    const targetClosed = new Promise<void>(resolve => {
      resolveTargetClosed = resolve
    })
    const target = await startTcpServer(socket => {
      socket.on('data', data => {
        socket.write(data)
      })
      socket.once('close', resolveTargetClosed)
    })
    const proxy = await startVlessServer()
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)

    const earlyData = Buffer.alloc(128 * 1024, 0x61)
    const packet = createVlessPacket({ port: target.port, data: earlyData })
    const response = new Promise<Buffer>((resolve, reject) => {
      let acknowledged = false
      const chunks: Buffer[] = []

      ws.on('message', message => {
        const payload = rawDataToBuffer(message)
        if (!acknowledged) {
          if (!payload.equals(Buffer.from([0, 0]))) {
            reject(new Error('Invalid VLESS response header'))
            return
          }
          acknowledged = true
          return
        }

        chunks.push(payload)
        const combined = Buffer.concat(chunks)
        if (combined.length >= earlyData.length) {
          resolve(combined)
        }
      })
    })

    ws.send(packet.subarray(0, 10))
    ws.send(packet.subarray(10))

    await expect(withTimeout(response)).resolves.toEqual(earlyData)

    ws.close()
    await withTimeout(targetClosed)
  })

  test('rejects an unauthorized UUID before opening a target connection', async () => {
    let targetConnections = 0
    const target = await startTcpServer(() => {
      targetConnections += 1
    })
    const proxy = await startVlessServer()
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)
    const closed = waitForClose(ws)

    ws.send(
      createVlessPacket({
        port: target.port,
        uuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    )

    await expect(withTimeout(closed)).resolves.toEqual({
      code: 1008,
      reason: 'Unauthorized UUID',
    })
    expect(targetConnections).toBe(0)
  })

  test('closes a connection when the TCP target cannot be reached', async () => {
    const unavailableTarget = net.createServer()
    const unavailablePort = await listen(unavailableTarget)
    await closeServer(unavailableTarget)

    const proxy = await startVlessServer()
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)
    const closed = waitForClose(ws)

    ws.send(createVlessPacket({ port: unavailablePort }))

    await expect(withTimeout(closed)).resolves.toMatchObject({ code: 1006 })
  })

  test('enforces the VLESS handshake timeout across empty messages', async () => {
    const proxy = await startVlessServer({ handshakeTimeoutMs: 30 })
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)
    const closed = waitForClose(ws)

    ws.send(Buffer.alloc(0))

    await expect(withTimeout(closed)).resolves.toEqual({
      code: 1008,
      reason: 'Handshake timeout',
    })
  })

  test('rejects an incomplete VLESS header above the buffer limit', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation()
    const proxy = await startVlessServer({ maxHeaderBytes: 4 })
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)
    const closed = waitForClose(ws)

    ws.send(Buffer.from([0, 1, 2]))
    ws.send(Buffer.from([3, 4]))

    await expect(withTimeout(closed)).resolves.toEqual({
      code: 1008,
      reason: 'Invalid VLESS request',
    })
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('ERROR:'),
      'Unexpected end of VLESS header while reading uuid',
    )
    errorLog.mockRestore()
  })

  test('closes an idle TCP target after the configured timeout', async () => {
    const target = await startTcpServer(() => undefined)
    const proxy = await startVlessServer({ targetSocketTimeoutMs: 30 })
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)
    const closed = waitForClose(ws)

    ws.send(createVlessPacket({ port: target.port }))

    await expect(withTimeout(closed)).resolves.toMatchObject({ code: 1006 })
  })

  test('rejects a WebSocket message above the configured hard limit', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation()
    const proxy = await startVlessServer()
    const ws = await openWebSocket(`ws://127.0.0.1:${proxy.port}/ws`)
    const closed = waitForClose(ws)

    ws.send(Buffer.alloc(DEFAULT_MAX_WS_PAYLOAD_BYTES + 1))

    await expect(withTimeout(closed)).resolves.toMatchObject({ code: 1009 })
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('ERROR:'),
      'Max payload size exceeded',
    )
    errorLog.mockRestore()
  })
})
