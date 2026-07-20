export enum VlessCommand {
  TCP = 1,
  UDP = 2,
  MUX = 3,
}

export enum VlessAddressType {
  IPv4 = 1,
  Domain = 2,
  IPv6 = 3,
}

export interface ParsedVLESSRequest {
  version: 0
  uuid: string
  protoBuf: Buffer
  command: number
  targetAddress: string
  targetPort: number
  data: Buffer
}

export interface ServerConfig {
  uuid: string
  port: number
  wsPath: string
  certFile: string
  keyFile: string
  isHttps: boolean
}
