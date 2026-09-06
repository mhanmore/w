# w

A lightweight home for attractive, mobile-first content intended to be shared by link in WhatsApp and similar messaging apps.

## Objective

The goal of this repository is to make it easy to turn ad-hoc research, trip plans, guides, recommendations and other personal content into polished web pages that:

- are easy to share as a normal HTTPS link;
- render reliably inside mobile browsers and in-app browsers such as WhatsApp on iOS;
- generate useful Open Graph previews when pasted into messaging apps;
- can include rich layouts, photographs, maps and light client-side interactivity;
- require no application server or database;
- remain simple enough that pages can be generated or substantially rewritten by an LLM from a prompt;
- avoid fragile single-file HTML attachment workflows.

The preferred delivery model is:

**WhatsApp message → HTTPS link → static hosted page**

rather than trying to render rich HTML directly as an attachment inside WhatsApp.

## Hosting model

The repository is intended to be served as a static site via GitHub Pages at:

`https://mhanmore.github.io/w/`

Pages should deploy from the root of the `main` branch.

There should be:

- no backend;
- no server-side runtime;
- no authentication requirement for shared pages;
- no build complexity unless it provides a clear benefit.

Plain HTML/CSS/JavaScript is preferred. A minimal static-site generator is acceptable only if it materially improves maintainability without making one-off page generation cumbersome.

## Content structure

Each piece of shared content should live at a stable, human-readable path, for example:

```text
/
  index.html
  trips/
    antalya-2026/
      index.html
      images/
  guides/
    example-guide/
      index.html
      images/
```

Each page may have its own visual language. Shared assets should only be introduced where they genuinely reduce duplication.

## Mobile-first requirements

Pages are primarily expected to be opened from WhatsApp on iPhone.

Design priorities:

1. Excellent rendering at narrow mobile widths.
2. Large, comfortable tap targets.
3. Legible typography without zooming.
4. Fast first render on ordinary mobile data.
5. Graceful handling of embedded browsers.
6. No layout that depends on hover.
7. Sensible behaviour when JavaScript or a third-party resource fails.

Desktop presentation should still be polished, but mobile is the primary target.

## WhatsApp and social previews

Every shareable page should include appropriate metadata, including:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:image" content="https://.../share.jpg">
<meta property="og:type" content="website">
<meta property="og:url" content="https://.../">
```

The Open Graph image should use an absolute HTTPS URL, be stored with the page, and be deliberately composed as a share card rather than relying on an arbitrary content image.

## Images

Prefer locally hosted page assets over hotlinking third-party images.

For generated pages:

- download or create suitable images and store them under the page's own `images/` directory;
- optimise them for web use;
- use modern formats such as WebP where appropriate;
- include meaningful `alt` text;
- record source/licensing information where required.

External hotlinks may be used temporarily during drafting but should not be considered production-ready.

## Maps

Interactive maps are welcome where they improve the content.

Preferred approach:

- MapLibre GL JS;
- a public/static tile source that does not require a private API key where practical;
- markers, routes and lightweight GeoJSON stored client-side;
- no backend map service owned by this project.

Maps should degrade gracefully. Where the map is important to understanding the page, consider a static fallback image or summary list of locations.

A map embedded directly in the page is preferable to an iframe around another site.

## External links

Links to useful services such as Komoot, Google Maps, official attraction pages or source material should be ordinary HTTPS links.

External links should complement the page rather than being required for the page to render.

## Visual design

The repository is not intended to enforce one generic template. Generated pages should be free to use a distinct visual language based on their content, including editorial/brochure layouts, cards, timelines, maps, galleries, large photography, diagrams and responsive data displays.

The common constraint is quality and usability, not visual uniformity.

Avoid generic “AI dashboard” aesthetics unless the subject genuinely calls for them.

## Accessibility

Generated pages should aim for semantic HTML, good colour contrast, meaningful headings, useful alt text, keyboard-accessible interactive controls, reduced-motion consideration where relevant, and layouts that remain usable with enlarged text.

## Performance

Keep pages light enough to open comfortably from a messaging app.

Prefer resized/compressed images, lazy-loading below the fold, minimal JavaScript and static assets served directly by the host.

Do not inline large image assets into HTML merely to create a single file. Hosted static assets are the normal production model.

## LLM-generated content workflow

A typical prompt should be able to say:

> Create a polished shareable page for this content in `trips/example/`. Use the repository README as the implementation brief. Research or source suitable imagery where appropriate, store production assets locally, add Open Graph metadata and ensure the result works particularly well when opened from WhatsApp on iOS.

The LLM should be able to choose the page-specific design rather than simply filling a rigid template.

## Definition of done

A shareable page is complete when:

- it has a stable hosted URL;
- it looks good on an iPhone-sized viewport;
- it opens normally from WhatsApp;
- its important content does not depend on blocked attachment/webview resources;
- its photographs and other critical assets are reliably hosted;
- its map/interactivity works or fails gracefully;
- it has a useful WhatsApp/Open Graph preview;
- external links work;
- the page requires no server-side application.

## Initial use case

The first intended example is an Antalya/Kemer family walking holiday brochure combining attractive editorial presentation, family-friendly activities, proper hiking options, photographs, drive-time context, MapLibre locations, Komoot/Lycian Way links and WhatsApp-friendly sharing.
