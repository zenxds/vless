// https://xtls.github.io/development/protocols/vless.html
import 'dotenv/config'

import { createVlessServer } from './server'
import { log, resolveServerConfig } from './utils'

const config = resolveServerConfig(process.env)
const { server } = createVlessServer(config)

server.listen(config.port, () => {
  const maskedUuid = `${config.uuid.slice(0, 8)}...${config.uuid.slice(-4)}`
  log(
    'info',
    `${config.isHttps ? 'https' : 'http'} server started on port ${config.port} with UUID ${maskedUuid}`,
  )
})
