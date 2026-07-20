# VLESS WebSocket proxy

A small Node.js server that accepts VLESS-over-WebSocket connections and proxies
the supported TCP command to the requested destination.

## Requirements

- Node.js 20+
- Yarn 1.x
- A VLESS UUID

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `UUID` | yes | none | VLESS client UUID; hyphenated and compact forms are accepted. |
| `PORT` | no | `19594` | HTTP/HTTPS listening port. |
| `WS_PATH` | no | `/` | Exact WebSocket upgrade path. Query strings are ignored when matching. |
| `CERT_FILE` | no | none | TLS certificate path. Must be set with `KEY_FILE`. |
| `KEY_FILE` | no | none | TLS private-key path. Must be set with `CERT_FILE`. |

Only the VLESS TCP command is supported. UDP, MUX, and VLESS addons are rejected.
Each WebSocket message is capped at 1 MiB, while the incremental VLESS header
buffer is capped at 1 KiB. Early data is not counted as part of the header limit.

## Run locally

```bash
UUID=123e4567-e89b-12d3-a456-426614174000 \
WS_PATH=/ws \
yarn start
```

The health endpoint is available at `GET /health`.

## TLS and deployment security

Without `CERT_FILE` and `KEY_FILE`, the server intentionally listens over plain
HTTP/WebSocket. A UUID authenticates a client but does not encrypt credentials or
proxied traffic. Do not expose plain WebSocket directly to an untrusted network.
For production, configure both TLS files or put the service behind a trusted TLS
terminator and expose only `wss://` to clients.

## Docker

```bash
docker build -t vless-websocket-proxy .
docker run --rm \
  -e UUID=123e4567-e89b-12d3-a456-426614174000 \
  -e WS_PATH=/ws \
  -p 19594:19594 \
  vless-websocket-proxy
```

The image and the application both default to port `19594`. Override `PORT` and
the container mapping together when a different port is required.

## PM2 deployment

For non-container deployments, compile the service and start the included PM2
cluster configuration:

```bash
yarn install --frozen-lockfile
yarn compile
cp ecosystem.config.example.js ecosystem.config.js
UUID=123e4567-e89b-12d3-a456-426614174000 yarn pm2:start
```

`PM2_INSTANCES` defaults to `2`; `PORT` defaults to `19594`. Environment variables
provided to the PM2 command are inherited by the workers. Use `yarn pm2:stop` to
stop the application. The generated `ecosystem.config.js` is intentionally ignored
so deployment-specific settings are not committed accidentally.

## Validation

```bash
yarn test
yarn lint
yarn compile
yarn audit
```
