# Email verification: the verification server and proxies

"Reveal email" and "Save to list" find a work email by generating likely
addresses (`jane.smith@`, `jsmith@`, …) and asking the company's mail server,
over SMTP, whether each mailbox exists. No email is ever sent. That check is
done by the email verification server, an open-source SMTP verifier
(AGPL-3.0) that runs as its own service (`docker/reacher/docker-compose.yml`).

## 1. Run the verification server

```bash
bun run verifier:up     # docker compose, bound to 127.0.0.1:8080
bun run verifier:logs
bun run verifier:down
```

It reads `REACHER_SECRET` (required) and optionally `REACHER_HELLO_NAME` /
`REACHER_FROM_EMAIL` from `.env`. The app finds it through `REACHER_URL` and
`REACHER_SECRET` in `.env`, or the same fields in **Settings → Email verification**.
Then press **Test verification** there: it checks a made-up address at Gmail
and at Microsoft 365 (no real mailbox is contacted) and reports whether each
route got a definite answer.

Without a verifier the app still works, but every email is an unverified
best guess.

## 2. Do you need proxies?

Verification needs **outbound port 25**. Check from the machine running
the verification server:

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
  "ALLOW_FROM=<public IP of the verification server> PROXY_USER=verify PROXY_PASS='<long random password>' bash setup-dante.sh"
```

The script installs [Dante](https://www.inet.no/dante/) as a SOCKS5 proxy
that:

- only accepts connections from `ALLOW_FROM` (also enforced by `ufw`),
- requires the username and password,
- only relays to port 25, so it can't be used as a general proxy.

(This configuration was tested: SMTP through the proxy works, other ports
and wrong passwords are refused, and the verification server's checks go through it.)

Then in **Settings → Email verification → Verification proxies** add the server's IP,
port `1080` and the same username/password, save, and run **Test
verification**. Proxies saved there are stored encrypted; `REACHER_PROXIES`
(a JSON array of `{host, port, username, password, label}`) is the env-var
alternative.

### Several IPs on one server

Extra IPs on the same server are cheaper than a server per IP (OVH's
Additional IPs, for example). Each IP gets its own proxy on its own port,
connecting out from that IP, so each counts as a separate verification IP:

1. Order the IPs and add them to the server's network interface as aliases
   (OVH: "Configuring IP aliasing"). On Ubuntu that's a netplan file such as
   `/etc/netplan/51-extra-ips.yaml`:

   ```yaml
   network:
     version: 2
     ethernets:
       eth0:            # your interface: ip -4 addr
         addresses:
           - 203.0.113.10/32
           - 203.0.113.11/32
   ```

   then `netplan apply`.
2. Run the script with every IP, **the server's main IP first** so it keeps
   port 1080:

   ```bash
   EXTERNAL_IPS="<main IP> 203.0.113.10 203.0.113.11" ALLOW_FROM=<public IP of the verification server> \
     PROXY_USER=verify PROXY_PASS='<long random password>' bash setup-dante.sh
   ```

   It prints one line per IP (host, port, outgoing IP) to add as separate
   proxies. The script checks each IP is on an interface and never changes
   the network configuration itself.
3. Set each IP's reverse DNS (below). The app's health check looks at each
   proxy's host address, which is the main IP for all of them here, so check
   the extra IPs' blocklist status yourself (e.g. MXToolbox) for now.

IPs on one server share its uptime and its provider's reputation: a mail
server that refuses the whole hosting provider refuses all of them. A second
server at another provider reaches more companies.

## 4. Reverse DNS and HELO

Mail servers trust a connecting IP more when its reverse DNS looks like a
real mail host:

1. Pick a hostname on a domain you control, e.g. `verify1.yourdomain.com`,
   and add an **A record** pointing it at the proxy's IP.
2. In your VPS provider's panel, set the IP's **reverse DNS (PTR)** to that
   same hostname.
3. Set **HELO name** to that hostname and **FROM address** to an address on
   that domain (Settings → Email verification, or `REACHER_HELLO_NAME` /
   `REACHER_FROM_EMAIL`).

Use a domain you don't send campaigns from, so a verification IP getting
flagged can't touch your sending reputation. With several proxies, one HELO
name is sent for all of them; give each proxy a PTR on the same domain.

## 5. Keeping IPs healthy

Mail servers answer checks from IPs they trust, so the app keeps every IP's
checks gentle and stops using one that gets listed.

**Rate limits** (in `proxyRouter.ts`; adding a proxy adds capacity):

- Per IP: 20 checks a minute; Microsoft 6 and Google 10 a minute (they
  throttle hardest); and a daily ceiling, 1,500 by default, set under
  **Daily checks per IP** in Settings → Email verification.
- Per company, across all IPs: up to 12 checks in any 3 minutes (a first
  Reveal there can take 7: the catch-all test plus 6 guesses), about 4 a
  minute after that. Saves wait for a slot; a Reveal waits up to 90 seconds.
- Per company per day: 20 **rejected** guesses, then that company waits until
  tomorrow, since lots of rejections is what address harvesting looks like.
  Checks that hit a real mailbox (a known format) don't count.
- At most 6 guesses per person, stopping after 2 "couldn't check" answers.

**Pausing and resting:**

- An IP on a spam blocklist (Spamhaus, Barracuda, SpamCop, …) stops being used
  until a health check finds it clean. Spamhaus's policy list of home/dynamic
  IPs doesn't count.
- A blocklisted FROM domain pauses all verification (every check names it),
  unless you tick **Keep verifying anyway** for that domain while testing.
- An IP whose last checks are mostly blocked (30%+ of the last 50) rests for
  an hour and you get a notification; 3 blocks or timeouts in a row rest it
  for 15 minutes; 6 unreachable servers in a row (its port 25 may be blocked)
  do too.
- A company that refuses an IP (drops its connections, or turns it away as a
  hosting or listed IP) is checked through your other IPs for the next 6
  hours, and the refused check is retried through one of them straight away.
  Some companies refuse whole hosting providers, so IPs at two different
  providers reach more of them. When every IP has been refused, Reveals there
  stop without spending more checks.
- The health panel checks each IP and the FROM domain every 6 hours and on
  "Check now"; the proxy table shows today's checks and each IP's status.

Counts are kept in memory, so a restart resets them.

- Greylisting (a `4xx` "try later") is normal; saves retry those people
  after 5 minutes.
- Catch-all domains accept every address, so nothing can be verified there.
  They're detected once per domain and remembered for 180 days, and people there are hidden from search while verified-only is on.
- Never send email from verification IPs.
