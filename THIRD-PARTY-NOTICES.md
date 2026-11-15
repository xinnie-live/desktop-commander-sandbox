# Third-party software notices / 第三方软件声明

Desktop Commander Sandbox's own code is licensed under [MIT](LICENSE). This does
not relicense Desktop Commander, npm dependencies, native libraries, Node.js, or
the Debian packages in the container. Their original terms and notices apply.

## Files supplied with the image and source archive

The image keeps this file and `third-party/` at
`/opt/desktop-commander-sandbox/`. During every image build,
`scripts/third-party-notices.mjs` checks installed versions against the lockfile
and generates `third-party/installed/npm-packages.json` (names, versions,
declared licenses, authors, source repositories and package integrity) and
`npm-NOTICES.txt` (original notice/license files and licensing README sections).
The original files in `node_modules` are also retained. Platform-specific npm
packages are inventoried in the image where they are actually installed.

The host console has no npm runtime dependencies. The source ZIP includes the
notice generator, the reviewed supplemental evidence, native-library license
texts and source manifest; it does not include `node_modules` or an inventory
from an unrelated host architecture.

Some older npm tarballs declare MIT/MIT-X11 but omit a standalone text. Their
published author attributions and the MIT terms are reproduced in
[`npm-SUPPLEMENTAL-NOTICES.txt`](third-party/npm-SUPPLEMENTAL-NOTICES.txt).
The same file includes the original upstream Apache-2.0 notice for the pinned
Puppeteer packages and the ISC notice for saxes. Supplemental coverage is matched
to exact package names, versions and declared licenses; new omissions stop the
image build for review rather than silently inheriting an unrelated notice.

## sharp / libvips shared libraries

The pinned sharp 0.35.5 packages use sharp-libvips 1.3.4 (libvips 8.18.7).
The original [upstream notice table](third-party/sharp-libvips/THIRD-PARTY-NOTICES.md)
identifies the bundled libraries and their license choices, including LGPLv3.
The upstream table also appears in the npm package README; absence of a file
named LICENSE in that package does not mean the package has no licensing notice.

- [Original source license and copyright texts](third-party/sharp-libvips/SOURCE-NOTICES.txt).
- [GNU GPL v3](third-party/licenses/GPL-3.0.txt) and [GNU LGPL v3](third-party/licenses/LGPL-3.0.txt).
- [Exact upstream source/patch URLs and SHA-256 hashes](third-party/sources.lock.json).
- Upstream build recipe: [sharp-libvips commit ebb95f8](https://github.com/lovell/sharp-libvips/tree/ebb95f8add54eee8bed840e3fb587e4cbec857d7).

The source manifest covers the native library archives, the upstream patches,
the complete build-recipe archive, and the registry crates identified by the
bundled librsvg Cargo.lock. It includes optional/build/test components as a
superset; listing a component does not assert it is linked into every image.
The libraries are not modified by this project. The upstream build recipe
contains upstream source modifications and build options.

For libtiff 4.7.2, the manifest uses the official release tarball from the
[upstream primary download site](https://libtiff.gitlab.io/libtiff/releases/v4.7.2.html)
instead of GitLab's generated tag archive, which returned HTTP 406 on GitHub runners.
The 573 files shared by the two archives were compared byte-for-byte and match;
the release tarball includes generated distribution files and omits some repository
metadata, archived tools and maintainer/test files. This is a source-download
substitution for the same version, not a change to the installed native library.
The original upstream build recipe is preserved unchanged.

Each Release also supplies
`desktop-commander-sandbox-third-party-sources-<version>.tar.gz` and its SHA-256
file. This archive contains the original native source archives and patches
listed in the manifest, plus these notices. The same sources can be downloaded
from the explicit, versioned URLs in the manifest without waiting for a response
from the maintainer. Run `npm run remote-device:third-party` to verify/download
them and rebuild this source attachment; Node.js 22+, HTTPS access and `tar` are
required. The source attachment is separate from the smaller application ZIP.

You may modify the LGPL-covered libraries and debug those modifications under
their licenses. The native library is loaded as a shared library. An ABI-compatible
replacement can be included in a rebuilt image; see the upstream build recipe
(`./build.sh linux-x64` or `./build.sh linux-arm64v8`) and sharp's
[custom libvips/build instructions](https://sharp.pixelplumbing.com/install/).
Rebuilding an image does not require weakening the supplied runtime permissions
or exposing host management interfaces to the running container. This project
does not prohibit reverse engineering needed to debug such library changes.

## buffers 0.1.1

The published npm tarball omits its license field. Original author James Halliday
declared MIT/X11 in [commit 1b745ee](https://github.com/bitpay/node-buffers/commit/1b745ee35d33eb166e15ef1866073a07c6d7de87).
The installed `index.js` is byte-identical to that commit (SHA-256
`97801e296ba5f3c32242f647e1daac5917e300367fed7935ab1e62f40adb1b8a`).
The build rejects different bytes before applying this licensing clarification.
Copies of the [upstream declaration](third-party/buffers/package.upstream.json),
[upstream README](third-party/buffers/README.markdown), and
[Debian's copyright and MIT text](third-party/buffers/debian-copyright.txt)
are supplied. The Debian document is from
<https://sources.debian.org/src/node-buffers/0.1.1-2/debian/copyright/>;
its Debian-packaging attributions are preserved as part of that original document.
No implementation or license metadata is silently rewritten in `node_modules`.

## Node.js and Debian base image

The runtime base is pinned by digest in `Dockerfile`. Keep the base image's
copyright/license files under `/usr/share/doc` and `/usr/share/common-licenses`.
Node.js source and its bundled third-party notices are available from the exact
[Node.js 22.21.0 distribution](https://nodejs.org/dist/v22.21.0/).
Debian source packages are available through [Debian Snapshot](https://snapshot.debian.org/)
using the source package/version reported by `dpkg-query -W` inside the image.
The C compiler build stage is not distributed as the runtime image.

## 中文说明

项目自身使用 MIT，不替第三方依赖重新授权。镜像构建时会生成实际安装的 npm
软件清单并汇集原始声明，同时保留包内文件。源码 ZIP 携带生成脚本、补充许可证据、
原生库许可文本和固定源码清单；完整原生库源码附件单独随 Release 分发。

sharp/libvips 的上游许可表已保留；GPL/LGPL 全文、源码中的版权与许可文本、构建脚本、
补丁和版本固定的源码下载地址均可在上面的链接中找到。`buffers` 的 MIT/X11 声明来自
原作者提交，并以实现文件 SHA-256 核对，避免把许可说明套用到未经复核的版本。
这些材料记录实际分发的软件及来源，不代表对整个系统作笼统的安全或法律保证。
