# Optional presentation page and cover

The preview GIF is the default deliverable. Make the page or cover only when requested. Templates are in `templates/`; they use system fonts and self-contained CSS, with no dependency on a private asset repository. Copy a template beside an `assets/` folder containing the approved preview files.

## Page

Use `preview-page.html`. Replace every `FEATURE`, `DESCRIPTION`, `STEP` and `ALT` placeholder. Put the reviewed GIF at `assets/preview.gif` and its static poster at `assets/poster.png`. Keep a short feature name, at most two sentences explaining the benefit and trigger, and three or four steps. Remove unused steps. Do not add status sections, mechanism notes, PR numbers or repeated explanations.

The page has a Replay control and an animation toggle. It respects reduced motion by showing the static poster until playback is requested. Keep any decorative motion outside the recorded UI. The shipped template has no background animation.

For a specific brand, use only assets the user is authorized to redistribute. Copy them alongside the page and cite their source in the archive README; do not fetch a colleague's private asset library or bundle licensed font software. An outlined logo and approved background art are optional substitutions, not required dependencies.

Check desktop, narrow viewport, keyboard access, Replay, animation toggle, reduced motion and missing assets. Package with `files_package_html` after reading its Files guidance. Publish and open the packaged file. A local relative link is not a shareable page.

## Cover

Use `cover.html`, a 1600×900 composition. Fill the feature name, a plain 10–15 word benefit, and `assets/shot.png`. Use one real, sharp screenshot of the main function, not a 1× video frame enlarged to fit. Capture the actual control at sufficient device pixels; a verified CDP `Page.captureScreenshot` clip with `scale: 3` can do this for Chromium pages. Check its dimensions before using it. Keep the panel straight and its essential controls inside the composition.

Render at a 1600×900 viewport with device scale factor 2. Inspect the full-size result for clipped headline, unreadable UI and missing assets. Long names need a smaller heading or wrapping, not overlapping artwork. Posting the cover with a message and GIF still requires approval for the exact destination and content.
