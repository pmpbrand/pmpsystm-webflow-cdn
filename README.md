# PMP System Webflow CDN

Public, browser-safe Webflow JavaScript files for the private `pmpbrand/pmpsystm` project.

Use version tags in Webflow for stable production URLs.

## jsDelivr URLs

```text
https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@v1.0.0/confess-page.js
https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@v1.0.0/voices-page.js
https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@v1.0.0/unlock-page.js
https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@v1.0.0/success-page.js
```

Success page with PDF download support needs dependencies loaded first:

```html
<script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@v1.0.1/success-page-complete.js"></script>
```

For testing the latest main branch only:

```text
https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@main/confess-page.js
```

## Publish Workflow

Copy updated files from the private repo's `webflow/` directory, commit, tag, and push a new version.

```bash
cp /home/parallels/pmpsystm/webflow/*.js /home/parallels/pmpsystm-webflow-cdn/
cd /home/parallels/pmpsystm-webflow-cdn
git status
git add .
git commit -m "Update Webflow scripts"
git tag v1.0.1
git push origin main --tags
```

## confess-hero-v4.min.js — the /confess hero module

The WebGL hero on `/confess`: one intact plate with depth parallax, the 3D sigil framed by
the pavilion, the sigil-as-light layer, and the lens/film pass. It used to ship as twelve
inline Webflow scripts assembled at runtime — Webflow allows only **15 registered scripts per
page block**, which the page had reached. One hosted file removes that ceiling.

```text
https://cdn.jsdelivr.net/gh/pmpbrand/pmpsystm-webflow-cdn@v1.1.0/confess-hero-v4.min.js
```

**Register it in Webflow with its Subresource Integrity hash.** Webflow requires one, and it
is what makes serving production code from a public repository safe: if this repository, the
tag, or the CDN were ever tampered with, the browser refuses a file whose hash does not match.

Current hash (`confess-hero-v4.min.js.sri`, 20212 bytes, module 4.2.0):

```text
sha384-ZcfHLjmS1CTIsAmYWDEzUJ9I7LST06PJx75nItQ8GjqCMpTf2VGhNEh34ZAjDidW
```

Regenerate it on every build:

```bash
openssl dgst -sha384 -binary confess-hero-v4.min.js | openssl base64 -A | sed 's/^/sha384-/'
```

Source, records and history live in the PMP OS at `06-SYSTEME-CONFESS/`. This repository holds
compiled output only — never secrets, never anything that is not already public in the page source.
