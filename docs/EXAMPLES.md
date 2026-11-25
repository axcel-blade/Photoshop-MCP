# Example prompts

Paste these into Claude Desktop or ChatGPT once the server is connected.

**Check the setup**
> Call photoshop_status and tell me which Photoshop version is running and which documents are open.

**Full design from a brief**
> Create a modern luxury skincare poster with a minimalist layout, beige background, elegant typography and a product image. Headline "PURE BEAUTY", subheadline "Radiance, refined". Save it as skincare-poster.psd and export a PNG preview.

**Plan first, then build**
> Plan (don't build yet) an A3 Swiss-style poster for a typography conference called "GRID 26". Show me the hierarchy and palette, then execute it once I approve.

**Product advertisement from a photo** (workflow engine)
> Using designs/perfume.png, make a 1080×1350 luxury perfume ad: remove the background, place it on a dark gold gradient with a soft reflection and glow, headline "NOIR ÉLIXIR", CTA "Shop now". Export PSD and a 4K PNG.

**Retouch a portrait**
> Open designs/portrait.jpg. Smooth the skin lightly, whiten the teeth, brighten the eyes and correct the white balance — all on separate layers — then show me a before/after preview.

**Background replacement**
> Remove the background from the active layer and replace it with designs/beach.jpg, then match the lighting and add a realistic shadow.

**Critique and improve**
> Critique the open document against the goal "clear focal point, readable on a phone". Then apply the automatic fixes for alignment and contrast and show me before/after scores.

**Targeted revisions**
> In plan <id>: make the headline bigger, change the background to navy, and move the logo up.

**Low-level control**
> Create a 2480×3508 px document at 300 ppi. Add a 470 px circle centered on the page in #C6A98A in a new "Graphics" group, add "PURE BEAUTY" in Georgia 48 pt centered 470 px from the top, then export a PNG.

**Variations**
> Generate 3 variations of a playful flyer for a kids' art camp — one per style, palette and layout — and build them in the background (background: true), then wait for the jobs.

**Batch processing**
> Resize every JPEG in designs/shoot to 2000 px on the long side, add a "© Studio" watermark bottom-right and export them as WebP to designs/web.

**Production export**
> Save the document as final.psd, then export PNG, a JPEG under 500 KB, WebP, TIFF and a delivery package with a manifest.

## UI design (Figma-AI-style)

**First-draft app screen**
> Create a sign-in screen for a fitness app called "Pulse" in a playful style with base color #5B2EFF.

**Landing page and dashboard**
> Design a modern SaaS landing page for "Acme Analytics" with the headline "Insights in minutes", then a web dashboard for the same brand.

**Design system**
> Create a UI kit for "Nova" in the corporate style so I can see the colors, type scale and components together.

**Custom screen with auto layout**
> List the UI components, then use create_ui_design on an iphone-15 frame to build a checkout screen: status bar, app bar with back button, order summary card, card-number and expiry inputs side by side, and a full-width "Pay $42.00" button pinned to the bottom.

**Clean up layers**
> Rename the generic layers in the open document to meaningful names. Show me the suggestions first.
