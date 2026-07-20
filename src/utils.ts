import net from 'net'
import stream from 'stream'
import {
  ParsedVLESSRequest,
  ServerConfig,
  VlessAddressType,
  VlessCommand,
} from './types'

export class VlessProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VlessProtocolError'
  }
}

export class IncompleteVlessHeaderError extends VlessProtocolError {
  constructor(message: string) {
    super(message)
    this.name = 'IncompleteVlessHeaderError'
  }
}

export function log(type: 'log' | 'info' | 'error', ...args: string[]) {
  console[type](`[${new Date().toISOString()}] ${type.toUpperCase()}:`, ...args)
}

function ipv6ToString(buffer: Buffer) {
  if (buffer.length !== 16) {
    throw new Error('Invalid IPv6 address: must be 16 bytes.')
  }

  const segments: string[] = []
  for (let i = 0; i < 16; i += 2) {
    segments.push(buffer.readUInt16BE(i).toString(16))
  }

  return segments.join(':')
}

function ensureReadable(buffer: Buffer, offset: number, size: number, field: string) {
  if (offset + size > buffer.length) {
    throw new IncompleteVlessHeaderError(
      `Unexpected end of VLESS header while reading ${field}`,
    )
  }
}

function readUInt8(buffer: Buffer, offset: number, field: string) {
  ensureReadable(buffer, offset, 1, field)
  return buffer.readUInt8(offset)
}

function readUInt16BE(buffer: Buffer, offset: number, field: string) {
  ensureReadable(buffer, offset, 2, field)
  return buffer.readUInt16BE(offset)
}

function readSlice(buffer: Buffer, offset: number, size: number, field: string) {
  ensureReadable(buffer, offset, size, field)
  return buffer.subarray(offset, offset + size)
}

export function normalizeUUID(value: string) {
  return value.replace(/-/g, '').trim().toLowerCase()
}

export function resolveServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const uuid = normalizeUUID(env.UUID || '')
  const port = Number(env.PORT || 19594)
  const wsPath = env.WS_PATH || '/'
  const certFile = env.CERT_FILE || ''
  const keyFile = env.KEY_FILE || ''

  if (!/^[0-9a-f]{32}$/.test(uuid)) {
    throw new Error('UUID must be a valid 32-character hexadecimal string')
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  if (!wsPath.startsWith('/')) {
    throw new Error('WS_PATH must start with "/"')
  }

  if ((certFile && !keyFile) || (!certFile && keyFile)) {
    throw new Error('CERT_FILE and KEY_FILE must either both be set or both be empty')
  }

  return {
    uuid,
    port,
    wsPath,
    certFile,
    keyFile,
    isHttps: Boolean(certFile && keyFile),
  }
}

export function isAllowedUpgradePath(requestUrl: string | undefined, wsPath: string) {
  try {
    return new URL(requestUrl || '', 'ws://localhost').pathname === wsPath
  } catch {
    return false
  }
}

export function isSupportedCommand(command: number): command is VlessCommand.TCP {
  return command === VlessCommand.TCP
}

export function parseVLESS(buffer: Buffer): ParsedVLESSRequest {
  let offset = 0

  if (buffer.length === 0) {
    throw new IncompleteVlessHeaderError('Empty VLESS request')
  }

  const version = readUInt8(buffer, offset, 'version')
  offset += 1
  if (version !== 0) {
    throw new VlessProtocolError('Unsupported VLESS version')
  }

  const uuid = readSlice(buffer, offset, 16, 'uuid').toString('hex')
  offset += 16

  const protoBufLength = readUInt8(buffer, offset, 'addons length')
  offset += 1

  const protoBuf = readSlice(buffer, offset, protoBufLength, 'addons')
  offset += protoBufLength
  if (protoBuf.length > 0) {
    throw new VlessProtocolError('Unsupported VLESS addons')
  }

  const command = readUInt8(buffer, offset, 'command')
  offset += 1

  const targetPort = readUInt16BE(buffer, offset, 'port')
  offset += 2
  if (targetPort < 1 || targetPort > 65535) {
    throw new VlessProtocolError('Port must be between 1 and 65535')
  }

  const addressType = readUInt8(buffer, offset, 'address type')
  offset += 1

  let targetAddress = ''
  if (addressType === VlessAddressType.IPv4) {
    targetAddress = readSlice(buffer, offset, 4, 'IPv4 address').join('.')
    offset += 4
  } else if (addressType === VlessAddressType.Domain) {
    const domainLength = readUInt8(buffer, offset, 'domain length')
    offset += 1
    if (domainLength === 0) {
      throw new VlessProtocolError('Domain must not be empty')
    }
    targetAddress = readSlice(buffer, offset, domainLength, 'domain').toString('utf8')
    offset += domainLength
  } else if (addressType === VlessAddressType.IPv6) {
    targetAddress = ipv6ToString(readSlice(buffer, offset, 16, 'IPv6 address'))
    offset += 16
  } else {
    throw new VlessProtocolError('Unsupported address type')
  }

  return {
    version: 0,
    uuid,
    protoBuf,
    command,
    targetAddress,
    targetPort,
    data: buffer.subarray(offset),
  }
}

export function closeNetSocket(
  socket: net.Socket | stream.Duplex,
  err?: boolean,
) {
  if (socket.destroyed) {
    return
  }

  if (err) {
    socket.destroy()
  } else if (socket.writable) {
    socket.end()
  }
}
