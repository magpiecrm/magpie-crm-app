# Releasing

Every push to `main` is tested and published as
`ghcr.io/magpiecrm/magpie-crm-app:latest` (and by commit SHA). `latest` is
for trying things out; anything that stays up should run a **version**.

## Cutting a release

1. Make sure `main` is green (the "Test and publish image" workflow).
2. Bump `version` in `package.json` and commit it, e.g. `0.2.0`.
3. Tag and push:

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

The workflow tests the tag, publishes the image as `0.2.0` and `0.2`, and
creates a GitHub release with notes from the changes since the last one.

Versions follow [semver](https://semver.org): a patch (`0.2.1`) for fixes, a
minor (`0.3.0`) for features, and, from 1.0, a major for anything that needs
self-hosters to act (a changed environment variable, a data migration they
must run). Say what they need to do in the release notes.

## Rules that keep upgrades safe

- **A new version must read the previous version's data.** Copies are
  upgraded one at a time and can be rolled back, so data changes are
  additive: new fields have defaults, old ones keep working for a release.
- **Hosted-only behaviour is a setting, not a fork.** Anything the hosted
  service needs to behave differently goes behind an environment variable
  with a general name (e.g. `VERIFICATION_HEALTH_CHECKS`,
  `SOCIALFETCH_BALANCE`, `USAGE_API_TOKEN`), documented in the README.
- **No secrets or infrastructure details in this repo.**

## Security fixes

Fix privately (see [SECURITY.md](SECURITY.md)), release a patch version, roll
it out to the hosted service, and then publish the advisory.
