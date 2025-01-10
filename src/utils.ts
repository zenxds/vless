import net from 'net'
import stream from 'stream'
// import WebSocket from 'ws'

export function log(type: 'log' | 'info' | 'error', ...args: string[]) {
  console[type](`[${new Date().toISOString()}] ${type.toUpperCase()}:`, ...args)
}

function ipv6ToString(buffer: Buffer) {
  if (buffer.length !== 16) {
    throw new Error('Invalid IPv6 address: must be 16 bytes.')
  }

  // 将 16 字节的 IPv6 地址分为 8 组，每组 2 字节
  const segments = []
  for (let i = 0; i < 16; i += 2) {
    // 每组读取 2 个字节并转换为十六进制字符串
    segments.push(buffer.readUInt16BE(i).toString(16))
  }

  // 合并为 IPv6 字符串
  // let ipv6 = segments.join(':');

  // // 压缩零段（可选）
  // ipv6 = ipv6.replace(/(^|:)0(:0)*(:|$)/, '::').replace(/:{3,}/g, '::');

  // return ipv6;

  return segments.join(':')
}

export function parseVLESS(buffer: Buffer) {
  let offset = 0

  // 版本 (1 字节)
  const version = buffer.readUInt8(offset)
  offset += 1
  if (version !== 0) {
    throw new Error('Unsupported VLESS version')
  }

  // UUID（16 字节）
  const uuid = buffer.subarray(offset, offset + 16).toString('hex')
  offset += 16

  // 附加信息，长度 + 内容，实际应该未使用
  const protoBufLength = buffer.readUInt8(offset)
  offset += 1

  const protoBuf = buffer.subarray(offset, offset + protoBufLength)
  offset += protoBufLength

  // 指令（1 字节）
  const command = buffer.readUInt8(offset)
  offset += 1

  // 端口 （2 字节）
  const targetPort = buffer.readUInt16BE(offset)
  offset += 2

  // 4. 提取目标地址类型（1 字节）
  const addressType = buffer.readUInt8(offset)
  offset += 1

  let targetAddress = ''
  if (addressType === 1) {
    // IPv4 地址（4 字节）
    targetAddress = buffer.subarray(offset, offset + 4).join('.')
    offset += 4
  } else if (addressType === 2) {
    // 域名（1 字节长度 + 数据）
    const domainLength = buffer.readUInt8(offset)
    offset += 1
    targetAddress = buffer
      .subarray(offset, offset + domainLength)
      .toString('utf8')
    offset += domainLength
  } else if (addressType === 3) {
    // IPv6 地址（16 字节）
    targetAddress = ipv6ToString(buffer.subarray(offset, offset + 16))
    offset += 16
  } else {
    throw new Error('Unsupported address type')
  }

  return {
    version,
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

// export function closeWebSocket(socket: WebSocket, err?: boolean) {
//   if (socket.readyState !== WebSocket.OPEN) {
//     return
//   }

//   if (err) {
//     socket.terminate()
//   } else {
//     socket.close()
//   }
// }
