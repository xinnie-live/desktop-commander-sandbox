# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

Before changing mounts, Docker, networking, or the device lifecycle, read the [development rules](AGENTS.md) and [security model](docs/SECURITY_MODEL.md).

## Local development

Use Node.js 22 or later. From the project root, run:

Dependency installation and notice collection use **npm 10.9.4** (also declared in `packageManager`). Node 22 and Node 24 host execution remain supported. npm 11 can deduplicate the lockfile into a different physical layout; that layout is not supported by the strict notices collector. Use `npx --yes npm@10.9.4 ci --omit=dev --ignore-scripts --no-audit --no-fund`, then `npm run remote-device:notices`. Missing required entries remain errors; do not skip them. CI pins npm and collects notices on both Node versions.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The offline suite needs no Docker. Controller tests use synthetic data and isolate both configuration and run logs in temporary directories. Tests do not open the native picker, start Remote Device, pair an account, or contact its cloud service.

## Code map

| Area | Entry points | Responsibility |
|---|---|---|
| Container image | `Dockerfile`, `docker/drop_uid_exec.c` | Pin and patch the upstream tool package; run the Remote Device parent and tool child under the configured UIDs. |
| Container policy | `compose.yaml`, `scripts/mount-compose.mjs`, `scripts/validate-compose.mjs` | Define the single service, fixed volumes and base mounts, generate the fixed extra-mount override, and reject policy drift. |
| Local controller | `scripts/console.mjs` | Implement the fixed CLI, loopback HTTP console, session checks, workspace and mount operations, and fixed Docker Compose calls. |
| Local settings and paths | `scripts/workspace-selection.mjs`, `scripts/workspace-settings.mjs`, `scripts/public-data.mjs` | Validate workspace selections, persist per-user profiles, and create browser-safe folder summaries and path-redacted responses. |
| Logs and network settings | `scripts/run-log-security.mjs`, `scripts/system-proxy.mjs` | Extract the supported official authorization URL for the UI and read or validate optional HTTP(S) proxy settings. Run logs preserve complete container stdout/stderr locally, capped at 7 files and 10 MB each. The console does not probe or claim cloud connectivity. |
| Browser UI | `web/` | Serve static English/Chinese console assets. Full paths are displayed only in authenticated loopback workspace/mount views; the browser submits picker IDs, never host paths. |
| Regression checks | `tests/*.test.mjs`, `.github/workflows/ci.yml` | Exercise local logic with synthetic folders, fake Docker processes, and offline container checks in CI. |
| User and maintainer docs | `docs/`, root `*.md` | Explain installation, operation, threat boundaries, and release requirements. |

## Validate changes

- **Code, UI, or docs:** Run `npm test` and update the affected English and Simplified Chinese docs.
- **Compose, image, mounts, or lifecycle:** Run `docker compose config --quiet` and `node scripts/validate-compose.mjs --self-test`. Build the pinned image, then run `npm run test:docker-host`. This uses a separate Compose project and a no-network shell container to check synthetic mounts and volume retention. It cleans up only resources it creates.
- **Console:** Use synthetic folders to test creating, switching, editing permissions, and deleting workspace profiles. Check stop cancellation and confirmation, current and saved logs after start and stop, language switching, unavailable status, and at most one restart per confirmed batch of changes. Verify log retention is limited to seven matching files and 10 MB per file.
- **Platforms and pairing:** Use a clean copy on each OS and Docker combination you intend to claim support for. Verify build, start, stop, mounts, volume retention, and the native picker. The user must verify and approve real pairing manually; check cloud connectivity separately. Offline tests and CI do not establish these results.

In pull requests, describe why the change is needed, what it affects, which checks ran, and what remains unverified.

## Upstream upgrades

Dependabot checks dependencies weekly. The patch script reads the target version from the lockfile, checks the installed version, and attempts the existing patches. A failed match stops the build. Existing CI builds update PRs and runs offline checks. Investigate upstream changes when patches or tests fail, then validate the fix. Before release, use dedicated trial folders to verify volume retention, actual reconnection, and read/write permissions across an image upgrade. Record versions, environment, and results. The user manually approves real pairing.

## Release checks

To prepare a release, bump `version` in `package.json`, `package-lock.json`, and the `image:` tag in `compose.yaml`, add a `CHANGELOG.md` section, then push a `vX.Y.Z` tag. `.github/workflows/release.yml` builds amd64 and arm64 images natively, publishes them to GHCR, and creates a draft GitHub Release with the source archive. Before publishing the first Release, make the GHCR package public under the repository's **Packages** settings and complete the download checks below. The tag and public images are visible even while the Release is a draft.

Before tagging, run `npm run remote-device:package`. Verify that the archive passes `npm test` in a clean directory and excludes local configuration, logs, credentials, mounted files, and Docker state. Run CI in the published repository and record the tested host and runtime versions in the release notes. Leave untested combinations marked as unverified. If distributing a built image, check its third-party license and notice requirements.

Report security issues privately as described in [SECURITY.md](SECURITY.md), not in public issues.

Project code uses the [MIT License](LICENSE). Third-party dependencies retain their own licenses.

### Dependencies and redistribution materials

Run `npm audit --omit=dev --ignore-scripts --registry=https://registry.npmjs.org`
against the checked-in lockfile before release; the release workflow fails on
reported vulnerabilities. Keep exact overrides scoped to the affected consumer
when a major upgrade would break other consumers. After changing them, build the
image and run `sh scripts/smoke-dependencies.sh` and the existing runtime checks.
The dependency smoke checks use synthetic RSA keys, glob fixtures and loopback
HTTP inside a network-disabled container, without real enrollment or cloud access.

[Third-party notices](THIRD-PARTY-NOTICES.md) describe the materials in each image.
The image build generates an inventory and preserves original npm notices. It
fails on missing license declarations, unexpected installed versions or changed
`buffers` licensing-evidence bytes. When upgrading sharp/libvips, update the
upstream notice table, source license collection and `third-party/sources.lock.json`
together. Check the upstream build scripts and librsvg Cargo.lock for additional
sources/patches; record exact URLs and verified hashes, not mutable branch URLs.
Run `npm run remote-device:third-party` to produce the separate native-source
attachment. The release workflow attaches it and its checksum to the draft Release.
Keep this attachment and its documented source URLs accessible with the images.

## First public release

Publishing source at `0.0.0-dev` does not require a release tag. Before pushing, review the exact staged tree (including newly added notices/assets), exclude local data and credentials, and compare it with the tested archive. After the first source commit is pushed, require the cross-platform Actions matrix on that exact commit to pass; local tests cannot establish a Windows CI result. Keep development and unverified-platform labels until their acceptance is complete.

The release workflow pushes both the versioned image and `latest` before creating the draft Release. Draft status does not keep those image tags private. Configure private vulnerability reporting, review GHCR visibility, and verify anonymous pulls and startup from clean trial environments before announcing the Release.

1. Create `xinnie-live/desktop-commander-sandbox` on GitHub, review staged files, then commit and push the source. Enable Actions and private vulnerability reporting.
2. Wait for default-branch CI to pass. Keep unverified platform labels; real pairing and upgrades have been checked on macOS with OrbStack.
3. Choose a stable version such as `0.1.0`, synchronize package and lockfile root versions and the Compose image tag, and add its changelog section. Commit, then push the matching `v0.1.0` tag.
4. The release workflow tests and validates the source archive and its checksum before building both image architectures and creating a draft Release. Attachments include the source ZIP and its SHA-256 checksum. Users can download the prebuilt image or build from source.
5. Set the first GHCR package to Public in GitHub Packages. Verify anonymous versioned-image pulls for both `linux/amd64` and `linux/arm64` using an empty temporary Docker configuration. In a dedicated trial copy, verify the console's image download, failure recovery, and the Release instructions. Do not sign out of or replace the user's existing Docker configuration.
6. Check attachments, instructions, documentation links, and private vulnerability reporting. Record tested platforms and remaining acceptance gaps, then publish the draft Release. Fix failed workflows and use a new version for changes to published releases.

Prebuilt images update the container software. The source ZIP supplies the host console. The source archive includes macOS, Windows, and Linux launch scripts described in the README.
