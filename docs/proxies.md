# Email verification: Reacher, proxies or NeverBounce

"Reveal email" and "Save to list" find a work email by generating likely
addresses (`jane.smith@`, `jsmith@`, …) and asking the company's mail server,
over SMTP, whether each mailbox exists. No email is ever sent. That check is
done by [Reacher](https://github.com/reacherhq/check-if-email-exists)
(AGPL-3.0), which runs as its own service.

## 1. Run Reacher

```bash
bun run reacher:up     # docker compose, bound to 127.0.0.1:8080
bun run reacher:logs
bun run reacher:down
```

It reads `REACHER_SECRET` (required) and optionally `REACHER_HELLO_NAME` /
`REACHER_FROM_EMAIL` from `.env`. The app finds it through `REACHER_URL` and
`REACHER_SECRET` in `.env`, or the same fields in **Settings → Prospecting**.
Then press **Test verification** there: it checks a made-up address at Gmail
and at Microsoft 365 (no real mailbox is contacted) and reports whether each
route got a definite answer.

Without a verifier the app still works, but every email is an unverified
best guess.

### Or skip all of this: NeverBounce

In **Settings → Prospecting → Email verification** you can pick
**NeverBounce** instead of Reacher. Checks then run from NeverBounce's
infrastructure, so none of the IP-reputation work below applies to you. It
costs one NeverBounce credit per check (about $0.008 pay-as-you-go): a
company's first person can take up to 6 checks while its address pattern is
learned, later people at that company take 1. NeverBounce reports catch-all
domains itself, so the extra catch-all probe is skipped. **Test
verification** uses 2 credits and shows your remaining balance.

NeverBounce (owned by ZoomInfo) receives every address you check. Before
using it with real data, accept its data processing agreement (it includes
the UK addendum for US transfers) and list it as a sub-processor in your
privacy notice.

## 2. Do you need proxies?

Verification needs **outbound port 25**. Check from the machine running
Reacher:

```bash
timeout 8 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo open || echo blocked
```

- **Blocked**: you need at least one proxy on a server where port 25 is open.
- **Open, on a home or office connection**: it works for low volume (tested:
  Gmail and Microsoft 365 both answered), but residential IPs are on
  blocklists such as Spamhaus PBL, and some mail servers will refuse or
  greylist them. Use proxies before any real volume.
- **Open, on a server with clean reverse DNS**: you can run without proxies,
  but spreading checks over a few IPs keeps any one of them from getting
  flagged.

## 3. Set up a proxy server

Any small Linux VPS works, as long as the provider allows outbound port 25.
Most large clouds block it by default (AWS, Google Cloud, Azure,
DigitalOcean, Hetzner Cloud); some unblock it on request, usually only for
older paid accounts. Check before you buy.

On a fresh Ubuntu/Debian server:

```bash
scp docker/proxy-node/setup-dante.sh root@PROXY_IP:
ssh root@PROXY_IP \
  "ALLOW_FROM=<public IP that runs Reacher> PROXY_USER=reacher PROXY_PASS='<long random password>' bash setup-dante.sh"
```

The script installs [Dante](https://www.inet.no/dante/) as a SOCKS5 proxy
that:

- only accepts connections from `ALLOW_FROM` (also enforced by `ufw`),
- requires the username and password,
- only relays to port 25, so it can't be used as a general proxy.

(This configuration was tested: SMTP through the proxy works, other ports
and wrong passwords are refused, and Reacher's checks go through it.)

Then in **Settings → Prospecting → Verification proxies** add the server's IP,
port `1080` and the same username/password, save, and run **Test
verification**. Proxies saved there are stored encrypted; `REACHER_PROXIES`
(a JSON array of `{host, port, username, password, label}`) is the env-var
alternative.

## 4. Reverse DNS and HELO

Mail servers trust a connecting IP more when its reverse DNS looks like a
real mail host:

1. Pick a hostname on a domain you control, e.g. `verify1.yourdomain.com`,
   and add an **A record** pointing it at the proxy's IP.
2. In your VPS provider's panel, set the IP's **reverse DNS (PTR)** to that
   same hostname.
3. Set **HELO name** to that hostname and **FROM address** to an address on
   that domain (Settings → Prospecting, or `REACHER_HELLO_NAME` /
   `REACHER_FROM_EMAIL`).

Use a domain you don't send campaigns from, so a verification IP getting
flagged can't touch your sending reputation. With several proxies, one HELO
name is sent for all of them; give each proxy a PTR on the same domain.

## 5. Keeping IPs healthy

- The app limits checks per proxy (20/min) and per mail provider across all
  proxies (Gmail 10/min, Microsoft 6/min, others 60/min), and tries at most 6
  addresses per person.
- A proxy that gets blocked, times out or rejects its login 3 times in a row
  is **benched for 15 minutes**. The health table in Settings shows OK /
  greylisted / blocked / timeout counts per proxy since the app started.
- Greylisting (a `4xx` "try later") is normal; saves retry those people
  after 5 minutes.
- Catch-all domains accept every address, so nothing can be verified there.
  They're detected once per domain and cached for 90 days, and those
  addresses are saved as "Catch-all".
- Never send email from verification IPs.
