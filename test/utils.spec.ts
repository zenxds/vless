import {
  assertHandshakePayloadSize,
  parseVLESS,
  VlessProtocolError,
} from '@/utils'
import { VlessCommand } from '@/types'

const TEST_UUID = '123e4567e89b12d3a456426614174000'

function createVlessPacket(options: {
  command?: VlessCommand
  port?: number
  addressType: 1 | 2 | 3
  address: Buffer
  data?: Buffer
  addons?: Buffer
  version?: number
}) {
  const addons = options.addons || Buffer.alloc(0)
  const data = options.data || Buffer.alloc(0)

  return Buffer.concat([
    Buffer.from([options.version ?? 0]),
    Buffer.from(TEST_UUID, 'hex'),
    Buffer.from([addons.length]),
    addons,
    Buffer.from([options.command ?? VlessCommand.TCP]),
    Buffer.from([(options.port ?? 443) >> 8, (options.port ?? 443) & 0xff]),
    Buffer.from([options.addressType]),
    options.address,
    data,
  ])
}

describe('parseVLESS', () => {
  test('parses an ipv4 tcp request and preserves early data', () => {
    const packet = createVlessPacket({
      addressType: 1,
      address: Buffer.from([1, 1, 1, 1]),
      data: Buffer.from('ping'),
    })

    expect(parseVLESS(packet)).toEqual({
      version: 0,
      uuid: TEST_UUID,
      protoBuf: Buffer.alloc(0),
      command: VlessCommand.TCP,
      targetAddress: '1.1.1.1',
      targetPort: 443,
      data: Buffer.from('ping'),
    })
  })

  test('parses a domain request without addons', () => {
    const domain = Buffer.from('example.com')
    const packet = createVlessPacket({
      addressType: 2,
      address: Buffer.concat([Buffer.from([domain.length]), domain]),
      port: 8443,
    })

    const parsed = parseVLESS(packet)
    expect(parsed.targetAddress).toBe('example.com')
    expect(parsed.targetPort).toBe(8443)
    expect(parsed.protoBuf).toEqual(Buffer.alloc(0))
  })

  test('rejects requests with unsupported addons', () => {
    const domain = Buffer.from('example.com')
    const packet = createVlessPacket({
      addressType: 2,
      address: Buffer.concat([Buffer.from([domain.length]), domain]),
      addons: Buffer.from([0xde, 0xad]),
    })

    expect(() => parseVLESS(packet)).toThrow(
      'Unsupported VLESS addons',
    )
  })

  test('parses an ipv6 request', () => {
    const packet = createVlessPacket({
      addressType: 3,
      address: Buffer.from([
        0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
      ]),
    })

    expect(parseVLESS(packet).targetAddress).toBe('2001:db8:0:0:0:0:0:1')
  })

  test('rejects truncated packets', () => {
    const packet = Buffer.from([0])
    expect(() => parseVLESS(packet)).toThrow(VlessProtocolError)
    expect(() => parseVLESS(packet)).toThrow(
      'Unexpected end of VLESS header while reading uuid',
    )
  })

  test('rejects unsupported versions and address types', () => {
    const invalidVersionPacket = createVlessPacket({
      version: 1,
      addressType: 1,
      address: Buffer.from([127, 0, 0, 1]),
    })

    expect(() => parseVLESS(invalidVersionPacket)).toThrow(
      'Unsupported VLESS version',
    )

    const invalidAddressTypePacket = createVlessPacket({
      addressType: 1,
      address: Buffer.from([127, 0, 0, 1]),
    })
    invalidAddressTypePacket[21] = 99

    expect(() => parseVLESS(invalidAddressTypePacket)).toThrow(
      'Unsupported address type',
    )
  })

  test('rejects malformed target destinations', () => {
    const emptyDomainPacket = createVlessPacket({
      addressType: 2,
      address: Buffer.from([0]),
    })

    expect(() => parseVLESS(emptyDomainPacket)).toThrow(
      'Domain must not be empty',
    )

    const zeroPortPacket = createVlessPacket({
      addressType: 1,
      address: Buffer.from([127, 0, 0, 1]),
      port: 0,
    })

    expect(() => parseVLESS(zeroPortPacket)).toThrow(
      'Port must be between 1 and 65535',
    )
  })
})

describe('assertHandshakePayloadSize', () => {
  test('rejects payloads larger than the configured handshake limit', () => {
    expect(() =>
      assertHandshakePayloadSize(Buffer.alloc(5), 4),
    ).toThrow('VLESS handshake payload exceeds 4 bytes')
  })

  test('accepts payloads at or below the configured handshake limit', () => {
    expect(() =>
      assertHandshakePayloadSize(Buffer.alloc(4), 4),
    ).not.toThrow()
  })
})
