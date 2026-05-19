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
