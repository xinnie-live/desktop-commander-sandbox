# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

Release candidate; not yet published. Platform acceptance limits in the README still apply.

- Use a fixed local console address (127.0.0.1:53707 by default) and guarded same-origin session setup so fresh tabs work without copying a credential. Keep per-start tokens and reject cross-origin requests; report port conflicts instead of silently choosing a new port.
- Show the console’s D mark as the browser tab favicon.

### Added

- A manual release rehearsal that validates source attachments and both native image architectures without publishing images or a Release. Release metadata checks reject package, lockfile, Compose, changelog and tag drift.

- Cross-platform launch scripts check prerequisites and open the local console.
- A fixed-version GHCR image download action in the console and CLI, with a separate source-build option and existing job logs.

- Single hardened Docker container running Desktop Commander 0.3.3 in Remote Device mode: read-only root filesystem, dropped capabilities, separate device and tool UIDs, and a setuid-checked privilege-drop helper.
- Local web console on `127.0.0.1` and a fixed CLI for build, start, stop, status, resources, storage, and logs.
- Workspace profiles with one main folder and up to 8 extra folders, each read-only or read/write, applied with at most one restart per confirmed change.
- Local run logs, capped at 7 files of 10 MB each.
- Optional HTTP(S) proxy configuration.
- English and Simplified Chinese UI and documentation.
- Offline regression tests, CI on Linux, macOS, and Windows, and a workflow for publishing multi-architecture images from version tags.

### Changed

- Record the scoped Linux x86_64 retest and picker prerequisites, add the privilege-drop helper check to CI, and fix English workspace counts when the current folder is missing.

- Remove recursive Linux workspace chmod; initialize only new dedicated roots and stop a running device before mount preparation. Resolve configuration, log and source boundary paths through symlink ancestors, including paths not yet created.
- Pin dependency installation and notice collection to npm 10.9.4 on supported Node 22/24 hosts; validate notice generation in CI and provide explicit recovery for incompatible install layouts.
- Explain Docker status failures in both UI languages, disable daemon-dependent image/start/stop controls, and restore them when status polling recovers.

- Pin security fixes for node-forge (1.4.3), Desktop Commander's glob (14.0.6), hono (4.13.18), and @hono/node-server (2.1.8), while preserving legacy glob consumers. Add offline dependency compatibility checks and a release-time npm audit gate.
- Include third-party notices, reviewed buffers licensing evidence, native source license texts and a checksum-pinned source manifest. Generate the installed npm notice inventory during image builds and attach native library sources separately to Releases.

- Recreate both README walkthrough GIFs at 3840 × 2160 with a 13-second loop using fresh 3× lossless browser captures and natively rendered text; update the linked high-resolution PNGs.

- Create releases as drafts and verify the source archive checksum before image publishing; require anonymous image pulls and console download checks before making the Release public.

- Return the remote-device container exit code from attached Compose starts, including workspace transitions, so device failures are not reported as a successful Compose exit.
- Correct the English image-preparation label and preserve readable header controls on narrow screens.
- Replace the README demo with current bilingual 1600 × 1080 screenshot walkthroughs and full-resolution stills; distinguish recorded acceptance summaries from live execution.

- Add bilingual Windows setup steps explaining background WSL 2 use without a separate Ubuntu installation, and a local-agent installation request and workflow linked from the README and development rules.
- Stop launcher prerequisite checks at the first unavailable Docker dependency, show bilingual platform-specific installation/recovery steps, and mark dependent checks skipped. Use UTF-8 in the Windows launcher.

- Make image preparation and device startup sequential primary actions. Download and source build are alternatives in one dialog; development builds disable image download with an explanation.
- Let authorization acknowledgement close the prompt without claiming cloud verification; retain the current run's dismissal state.
- Guide macOS users with missing or outdated Node.js to the official installer, then explain how to relaunch the console.
- Upgrade the pinned Desktop Commander dependency from 0.3.1 to 0.3.3 using the validated candidate lockfile.

- Read the upstream patch target from the lockfile while retaining installed-version and patch-structure checks.
- Simplify the bilingual quick start and document image upgrades, connector setup, and device revocation.

### Validation

- 2026-11-15 review: 69 offline tests and host Compose lifecycle checks passed. A network-disabled synthetic service reproduced the old Compose exit 0 versus container exit 7; `--exit-code-from remote-device` returned 7. Actual cloud pairing expiry has not been replayed. Browser checks at 1440, 390, and 320 CSS pixels found aligned left edges and no horizontal page overflow; the full remaining acceptance matrix is still open.

- 2026-11-15: 67 offline tests passed. Synthetic Windows/macOS/Linux cases verify missing-Docker guidance, skipped dependent checks, Compose/engine failures, and genuine configuration errors. Windows desktop execution of the updated launcher remains unverified.
- 2026-11-15: 61 offline tests passed, including authorization dismissal and image/start action sequencing. The actual local browser UI showed the preparation dialog and disabled development-image download. No new cloud pairing was performed for this UI fix.
- 2026-11-15, macOS arm64 with OrbStack and system Node.js 22.21.0: 59 offline tests passed. A freshly extracted ZIP was launched by double-clicking `start.command` in Finder; browser-based image build, device start, manual pairing, remote synthetic read/write, read-only write rejection (`EROFS`), and confirmed stop succeeded. Trial-only environment variables isolated configuration, logs, and the Compose project. The initial missing-Node failure was reproduced before the user installed Node.js; the package still requires a separate Node.js installation. Public GHCR download and other host platforms remain unverified.
- 2026-11-15, macOS arm64 with OrbStack, Docker 29.8.2 and Compose 5.5.0: 58 offline tests passed, along with Compose policy and host lifecycle checks.
- Trial images for Desktop Commander 0.3.1 and 0.3.3 verified persistent volumes, writable host output, and read-only mount enforcement across replacement. The 0.3.3 integration exposed 25 tools and denied access to synthetic device credentials.
- A manually approved trial device reconnected with the same device identity on 0.3.3, without another authorization prompt. Remote synthetic file reads and writes succeeded, and a write to the read-only mount was denied. The trial device was stopped after validation. The project dependency is pinned to the validated 0.3.3 release.

### Known limitations

- Outbound network access from the container is not filtered.
