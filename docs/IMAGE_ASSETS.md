# Internet images and the asset library

The server can search free-to-use images on the internet, download them into a local asset library with their licence and credits, and import them into Photoshop as separate layers. Everything runs inside the existing MCP server. The tools are in the `assets` module (`src/mcp/tools/assets.ts`), the providers are in `src/assets/`, and Photoshop work goes through the same bridge commands as every other tool (`image.place`, `layer.transform`, `doc.create`, …).

## Providers

| Provider | Key | Good for | Licence of results |
| --- | --- | --- | --- |
| [Openverse](https://openverse.org) | none | photos, illustrations, SVG/PNG graphics | Creative Commons / public domain (per image) |
| [Wikimedia Commons](https://commons.wikimedia.org) | none | photos, diagrams, SVG icons | CC / public domain / GFDL (per file); non-free files are skipped |
| [Unsplash](https://unsplash.com/developers) | `UNSPLASH_ACCESS_KEY` | stock photos | Unsplash License; Unsplash+ (paid) results are excluded |
| [Pexels](https://www.pexels.com/api/) | `PEXELS_API_KEY` | stock photos | Pexels License |
| [Pixabay](https://pixabay.com/api/docs/) | `PIXABAY_API_KEY` | photos, illustrations, vectors, backgrounds | Pixabay Content License |
| Google Images via [SerpApi](https://serpapi.com/google-images-api) | `SERPAPI_API_KEY` | anything on the web | **Unverified** — see below |
| Google Images via [Custom Search JSON API](https://developers.google.com/custom-search/v1/overview) | `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID` | anything on the web | **Unverified** — see below |

### Google Images

Google results come only from authorized APIs. Scraping google.com is against Google's terms and is not implemented.

- **SerpApi** (`SERPAPI_API_KEY`) is used when its key is set. It is a paid third-party service that returns Google Images results. It supports orientation (`imgar`), minimum size (`imgsz`), transparency and colour (`image_color`), image type, and Google's usage-rights label (`licenses=fc` when you pass `license: "commercial"`).
- **Google Custom Search JSON API** (`GOOGLE_CSE_API_KEY` and the Programmable Search Engine id `GOOGLE_CSE_ID`, with image search on) is the fallback. Google closed it to new customers and is shutting it down on **1 January 2027**, so use it only if you already have a key.

Google results are images from anywhere on the web, so **their licence is not known**. Every Google result and downloaded asset is marked `licenseStatus: "unverified"` and `attributionRequired: true`. The tools add a warning at search, download and import time. With `license: "commercial"` the server passes Google's usage-rights filter, but that is only Google's label: open the `pageUrl` and confirm the rights before use. `license: "no-attribution"` never returns Google results. Downloads from Google results come from arbitrary hosts, so they go through the same URL validation as plain URLs: SSRF checks on every redirect, file-type sniffing and size limits. Many sites block direct downloads or return HTML; those downloads fail safely.

Providers without a key are skipped, and the result lists them under `skipped` with the reason. Openverse and Wikimedia work out of the box. Each provider is throttled. When a provider returns HTTP 429, the server stops calling it until the `Retry-After` time has passed.

## Tools

| Tool | What it does |
| --- | --- |
| `search_images` | Search by keywords, `kind` (photo, illustration, vector, icon, texture), `category`, `orientation`, `minWidth`/`minHeight`, `fileType`, `license` (`any`, `commercial`, `no-attribution`) and `color` |
| `search_stock_photos` | Photographs from Unsplash, Pexels, Pixabay and Openverse |
| `search_transparent_images` | PNG/SVG cut-outs and graphics with transparency |
| `search_icons` | Icons and simple vector symbols |
| `search_textures` | Textures and backgrounds |
| `get_image_details` | Full metadata of a search result or downloaded asset (creator, licence, attribution, tags, whether it is downloaded) |
| `filter_images` | Filter the results seen this session by orientation, size range, type, transparency, licence, provider or text, and sort by resolution |
| `download_image` | Download one image by search `id` or `url` into the library; optionally `then: "place"` or `"open"` |
| `download_multiple_images` | Download up to 50 images; failures are reported without stopping the batch |
| `import_image_to_photoshop` | Import one image (asset id, search id, URL or local path): place it as a named layer, set position and size, fit it to the canvas, rotate, scale and set opacity, or open it as a document |
| `import_multiple_images` | Import several images into one document (optionally a new one), each as its own layer, with a `grid` or `stack` layout and an optional group |
| `get_downloaded_assets` | List the library; with `includeCredits: true` it also returns an attribution block |

`place_image` and `import_image` also accept a `url`. The download goes through the same library and checks.

Search results use ids like `openverse:ca15…`, `pexels:7` or `wikimedia:42`. The server keeps every result it has returned in this process, so later calls can refer to an image by its id. Downloaded files get an `assetId` (`asset_…`) based on their content.

## Asset library

Files are saved to `ASSETS_DIR` (default `<first allowed path>/assets`), in one folder per provider (or `subfolder`). Each file gets a unique, sanitized name, for example `assets/pexels/mountain-lake-3fa9c1.jpg`, and two kinds of record:

- `<file>.json` next to the image, with the source URL, page URL, creator, licence, licence URL, attribution text, dimensions, size and SHA-256.
- `manifest.json` in the library root, which lists every asset (`get_downloaded_assets` reads it).

Each record also has a `transparency` field. It is `alpha` when the file really has an alpha channel (PNG RGBA/LA or `tRNS`, WebP with alpha, GIF, SVG) and `none` for opaque files. Providers only report the file type, so many results from `search_transparent_images` turn out to be opaque PNGs. Check this field after downloading, and for a photo on a plain background run `remove_background` after importing.

A file whose content is already in the library is not stored twice. The existing record is returned with `duplicate: true`.

## Safety checks

- **What is downloaded:** a file is accepted only if its bytes identify it as PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF, HEIC or SVG. The URL extension and the `Content-Type` header are not trusted. Executables, HTML and archives are rejected. SVGs with scripts, event handlers, `javascript:` links, entities or embedded HTML are rejected.
- **Where from:** downloads by search id must stay on that provider's image hosts (`images.unsplash.com`, `images.pexels.com`, `pixabay.com`/`cdn.pixabay.com`, `upload.wikimedia.org`), and every redirect is checked again. Openverse results come from many hosts, and plain URL downloads go through URL validation instead:
  - only `http`/`https`, with no credentials in the URL;
  - every host and every redirect hop is resolved, and loopback, private, link-local, CGNAT, multicast and reserved addresses are refused. `ALLOW_PRIVATE_DOWNLOADS=true` turns this off.
- **How much:** `MAX_DOWNLOAD_MB` caps the size, enforced while streaming. `MAX_IMAGE_DIMENSION` and `MAX_IMAGE_MEGAPIXELS` stop oversized images and decompression bombs. Downloads also have a timeout.
- **Where to:** file names come from `sanitizeName` (ASCII, dashes, no dots or slashes, Windows device names avoided). Paths go through the sandbox `PathPolicy`. Files are written to a temporary `.part` file, checked, then moved into place.
- **Failures:** network errors, HTTP 429 and HTTP 5xx are retried with exponential back-off (`DOWNLOAD_RETRIES`). Other failures are reported, and in batches they do not stop the remaining downloads.
- **Provider terms:** results are limited to free content, and paid or premium results are dropped. Unsplash's download endpoint is called when an Unsplash photo is downloaded, as its API terms require. API keys are only sent to their provider's API host and are never returned or logged.

## Licences and credit

Every result and asset shows `license`, `licenseUrl`, `attributionRequired`, `commercialUse` and a ready-made `attribution` string. Images downloaded from a plain URL are marked "licence unknown". Filter with `license: "commercial"` or `"no-attribution"` when the use calls for it, and call `get_downloaded_assets { includeCredits: true }` before delivery.

## AI design workflow

The `design_with_web_assets` prompt takes the AI through the whole process:

1. Read the brief.
2. List the assets the design needs.
3. Search with the most specific tool.
4. Choose images by fit and licence.
5. Download them (`download_multiple_images`).
6. Create the document and import each asset as its own layer (`import_multiple_images`).
7. Continue designing with the other tools.
8. Collect the credits.

Example (any MCP client):

> Design a 1080×1080 Instagram post for a mountain coffee brand. Use a landscape photo as the background, a coffee-cup icon and a paper texture overlay, all licensed for commercial use.
