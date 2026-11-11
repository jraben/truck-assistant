# truck-assistant.com

One-page project website, hosted on the GoDaddy cPanel plan (docroot
`public_html/truck-assistant.com`), not on GitHub Pages.

Build: `node site/build.mjs` writes `_site/` (the page, CSS, `.htaccess`, and
the screenshots it borrows from `docs/` and `ui/public/`). Upload: zip the
contents of `_site/`, upload it with cPanel File Manager into the docroot,
extract, and delete the zip.

The `.htaccess` redirect to HTTPS only works once AutoSSL has issued the
certificate; if the site loops or warns, check cPanel › SSL/TLS Status first.

Planned: a shop for printed parts and parts-kit links (the "Soon" cards).
Amazon affiliate links need the Associates disclosure on the page.
