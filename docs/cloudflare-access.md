# Cloudflare Access deployment

This repository is ready to run behind a remotely managed Cloudflare Tunnel.
The integration is disabled by default and does not change local development.

## Authentication model

Cloudflare Access is the outer, identity-aware gate. Better Auth remains the
application session and authorization layer, including the `admin` and
`member` roles. An allowed user therefore passes Access first and then signs
in to management-platform with a username and password.

```text
Browser -> Cloudflare Access -> Tunnel -> cloudflared -> localhost:3007
                                                            |
                                                            +-> app:3000
                                                                +-> Better Auth
```

Keeping both layers avoids coupling Cloudflare identity-provider changes to
application accounts. Automatic account provisioning or single sign-on is a
separate follow-up and should verify the signed Access JWT before trusting its
identity claims.

## 1. Prepare application configuration

Create `.env` next to `docker-compose.yml` and set at least:

```dotenv
BETTER_AUTH_SECRET=<random-secret>
BETTER_AUTH_URL=https://startup.elarbol.me
APP_BIND_ADDRESS=127.0.0.1
APP_HOST_PORT=3007
CLOUDFLARE_TUNNEL_TOKEN=<remotely-managed-tunnel-token>
```

`BETTER_AUTH_URL` must be the final HTTPS hostname users visit. Keep
`APP_BIND_ADDRESS` on `127.0.0.1`. The tunnel connector reaches the application
at `http://localhost:3007`; the application still listens on port 3000 inside
its container.

The tunnel token can run that tunnel. Keep it out of source control and rotate
it if it is exposed.

## 2. Create Access before publishing the route

In Cloudflare One:

1. Add a **self-hosted** Access application for the complete application
   hostname, `startup.elarbol.me`.
2. Add an explicit Allow policy for the intended email addresses, identity
   provider group, or company email domain.
3. Do not use `Everyone`, or an unrestricted one-time-PIN login method, as the
   Allow condition.
4. Select the intended identity provider and session duration.

Access applications deny by default, but the hostname is public if a tunnel
route is created before its Access application. Create the Access application
first.

## 3. Create and route the tunnel

Create a remotely managed tunnel named `management-platform` under
**Networking -> Tunnels**. Add a published application route with:

```text
Hostname: startup.elarbol.me
Service:  http://localhost:3007
```

Copy the raw tunnel token into the untracked `.env` file as
`CLOUDFLARE_TUNNEL_TOKEN`. Do not paste it into `docker-compose.yml`. The
Compose service passes it through `TUNNEL_TOKEN`, so it does not appear in the
`cloudflared` process arguments.

## 4. Start the opt-in profile

```bash
docker compose --profile cloudflare up --build -d
docker compose --profile cloudflare ps
docker compose logs cloudflared
```

Without `--profile cloudflare`, Compose starts only the application and behaves
as before.

## 5. Verify before relying on Access

- In a signed-out/private browser, the public hostname redirects to Access.
- An allowed identity reaches the management-platform login page.
- A disallowed identity is blocked by Access.
- `docker compose ps` shows host port 3007 bound to `127.0.0.1`, not
  `0.0.0.0`.
- The host firewall has no separate public ingress path to the application.
- File uploads, CSV exports, invoice print views, and logout still work through
  the public HTTPS hostname.

## Optional origin JWT validation

The tunnel plus loopback-only host binding removes the normal direct-origin
path. For additional defense in depth, validate the
`Cf-Access-Jwt-Assertion` header in the application against Cloudflare's JWKS,
the team-domain issuer, and this application's Audience (`AUD`) tag. Never
trust `Cf-Access-Authenticated-User-Email` or decoded JWT claims without first
validating the token signature, issuer, audience, and expiry.

Do this as a separate change because enabling it before the Cloudflare team
domain and Audience tag are available would lock out every request.

## Rollback

Stop the tunnel profile and run the ordinary Compose stack:

```bash
docker compose --profile cloudflare down
docker compose up -d
```

The database, uploads, Better Auth accounts, and sessions stay in the existing
`app_data` volume.
