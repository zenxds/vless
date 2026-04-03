import {
  isAllowedUpgradePath,
  isSupportedCommand,
  resolveServerConfig,
} from '@/utils'
import { VlessCommand } from '@/types'

describe('server helpers', () => {
  test('resolveServerConfig normalizes and validates runtime config', () => {
    expect(
      resolveServerConfig({
        UUID: '123e4567-e89b-12d3-a456-426614174000',
        PORT: '8443',
        WS_PATH: '/ws',
        CERT_FILE: '/tmp/cert.pem',
        KEY_FILE: '/tmp/key.pem',
      }),
    ).toEqual({
      uuid: '123e4567e89b12d3a456426614174000',
      port: 8443,
      wsPath: '/ws',
      certFile: '/tmp/cert.pem',
      keyFile: '/tmp/key.pem',
      isHttps: true,
    })
  })

  test('resolveServerConfig rejects invalid runtime config', () => {
    expect(() =>
      resolveServerConfig({
        UUID: 'invalid-uuid',
      }),
    ).toThrow('UUID must be a valid 32-character hexadecimal string')

    expect(() =>
      resolveServerConfig({
        UUID: '123e4567e89b12d3a456426614174000',
        PORT: '70000',
      }),
    ).toThrow('PORT must be an integer between 1 and 65535')

    expect(() =>
      resolveServerConfig({
        UUID: '123e4567e89b12d3a456426614174000',
        WS_PATH: 'ws',
      }),
    ).toThrow('WS_PATH must start with "/"')

    expect(() =>
      resolveServerConfig({
        UUID: '123e4567e89b12d3a456426614174000',
        CERT_FILE: '/tmp/cert.pem',
      }),
    ).toThrow('CERT_FILE and KEY_FILE must either both be set or both be empty')
  })

  test('isAllowedUpgradePath only accepts the configured path', () => {
    expect(isAllowedUpgradePath('/ws?token=1', '/ws')).toBe(true)
    expect(isAllowedUpgradePath('/metrics', '/ws')).toBe(false)
    expect(isAllowedUpgradePath('%', '/ws')).toBe(false)
  })

  test('isSupportedCommand only allows tcp command', () => {
    expect(isSupportedCommand(VlessCommand.TCP)).toBe(true)
    expect(isSupportedCommand(VlessCommand.UDP)).toBe(false)
    expect(isSupportedCommand(VlessCommand.MUX)).toBe(false)
  })
})
