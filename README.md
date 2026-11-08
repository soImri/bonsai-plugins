# imri-plugins

A Bonsai marketplace: skills by Imri Sofer.

<table>
  <tr><th></th><th align="left">Skill</th><th align="left">What it does</th></tr>
  <tr><td width="48" align="center"></td><td nowrap><b>ship-app-cards</b></td><td>Take a connected app from no App Cards to shipped: agree the cards, build them in the app's bundled Bonsai plugin, run up to three eval + UX-expert rounds until they feel like the real app, record previews for the launch kit, then merge and announce. Includes the helper briefs, the review-loop method and the known traps.</td></tr>
  <tr><td width="48" align="center"><img src="product-preview/assets/icon-256.png" width="48" height="48" alt=""></td><td nowrap><b>product-preview</b></td><td>Record a short, captioned GIF of a real product flow or matched before/after comparison. Portable CDP recorder, GIF encoder, review images, optional presentation page and cover; no machine-specific paths or Kay checkout required.</td></tr>
  <tr><td width="48" align="center"><img src="launch-kit/assets/icon-256.png" width="48" height="48" alt=""></td><td nowrap><b>launch-kit</b></td><td>Build a launch kit for your feature: one self-contained HTML page with a gallery of short previews per app, surface or use case, plus a cover for the announcement. Includes the page template, the copy rules, packaging and page checks, and a frame-by-frame privacy audit. Records with <code>product-preview</code>.</td></tr>
  <tr><td width="48" align="center"><img src="yakomoji/assets/icon-256.png" width="48" height="48" alt=""></td><td nowrap><b>yakomoji</b></td><td>Create or revise transparent Yako mascot PNGs and looping GIFs. Includes the character reference, 20 concept examples, prompt patterns and a macOS GIF assembler.</td></tr>
</table>

## Add it to Bonsai

App Store → Sources → add `https://github.com/soImri/bonsai-plugins` as a marketplace and review the source. Then open App Store → Browse and press Get on the specific item you want. Choose `ship-app-cards` under Connectors, `product-preview` or `launch-kit` under Product demos, or `yakomoji` under Design assets.

If this source is already added, open App Store → Sources → the source → Check for updates, then find the skill you want in Browse.

Or ask Bonsai: "Install the launch-kit skill from https://github.com/soImri/bonsai-plugins". Substitute any other skill name from the table.

Trusting a source makes its catalog browsable; it does not install every item.

### Ship App Cards prerequisites

Run it on Claude Opus 5.5 at the extra high (`xhigh`) thinking level, or Claude Fable 5.1, or a newer top model; the skill stops on anything weaker. Plan on three to five hours and roughly $100 to $200 of model spend per app. You also need a checkout of `yaklabs-ai/kay` you can push branches to, GitHub connected in Bonsai, a Mac that runs Bonsai's dev app, and the app connected in Bonsai with a test account or demo project. Install `product-preview` too; the launch-kit stage records with it.

### Product Preview prerequisites

A sandbox/development Chromium or Electron page with CDP enabled, Node.js 22+, and npm access. The skill discovers the target's actual endpoint and asks the agent to adapt the scenario to the observed UI. It does not automate sign-in or capture native operating-system dialogs. Its optional page and cover templates need no private brand assets or licensed fonts.

### Launch Kit prerequisites

Install `product-preview` too; it records the previews. Node.js 22+ and a Chromium for the page checks. Text in frames is read automatically on macOS, or with Tesseract elsewhere; without either, the privacy check is a visual pass only.

### Yakomoji prerequisites

An image generation/editing tool that accepts reference images and supports transparency. The bundled GIF assembler uses macOS Swift and ImageIO; other platforms can use an available GIF encoder following the skill's animation guide. All references and examples are included; no files from the author's computer are needed. Installing the skill does not itself add image-tool capabilities.

## Layout

Skills sit at the root (one `SKILL.md` folder each), plugins under `plugins/` (one `kay-plugin.json` folder each). `marketplace.json` names them and assigns categories. Generate the catalog with `node tools/validate.mjs --fix`, then check it with `node tools/validate.mjs` before publishing. The catalog's versions and content digests describe the items from this source; recipients refresh the source through Bonsai to discover published changes.
