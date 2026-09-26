# Security policy

MagpieCRM holds contact data, so we take reports seriously. The same code runs
the hosted service (MagpieCRM Cloud), so a vulnerability here is usually a
vulnerability there too.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through
[GitHub's private vulnerability reporting](https://github.com/magpiecrm/magpie-crm-app/security/advisories/new)
(the "Report a vulnerability" button on the Security tab).

Include what you found, how to reproduce it, and what an attacker could do with
it. We'll acknowledge the report within **3 working days**, keep you updated,
and credit you in the advisory unless you'd rather we didn't.

Please don't access or change other people's data, degrade the service, or run
automated scans against MagpieCRM Cloud; test against your own self-hosted
copy instead.

## Supported versions

Security fixes go into the latest release. Self-hosters should run the latest
version; see [RELEASING.md](RELEASING.md).
