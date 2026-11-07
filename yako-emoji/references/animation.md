# Animated emoji

## Design the loop

Choose the action, stable anchor and loop seam first. For `yak-cry`, Yako sits on his bottom with two legs extended toward the viewer; feet stay planted while cyan waterfalls flow from both eyes and splash beside the feet. The eyes, streams and splashes tell the story. A small sob supports the motion.

Use four to eight generated keyframes for a simple loop when enough; use more for complex movement. A four-frame 0.14-second-per-frame loop is the bundled cry example, not a universal timing. Slow expressions often need longer holds. Avoid a pause on the loop seam unless intended. Do not replace actual action with a rotating cutout or a whole-body bounce.

## Generate frames

Ask the image tool for equal-size registered cells on a transparent sprite sheet, or generate individual frames from an approved base when the sheet is inconsistent. For a 2x2 sheet, order frames top-left, top-right, bottom-left, bottom-right. State identical camera, scale, character proportions, foot baseline and cell margins. No panel lines or labels.

Prompt extension:

> Create a four-frame animation sheet, exactly two columns and two rows of equal square cells. Keep the same Yako and pose registered at the same location and scale in every cell. [Describe fixed anchors.] Frame 1: [state]. Frame 2: [state]. Frame 3: [state]. Frame 4: [state returning smoothly toward frame 1]. Actual transparency. Clear margins inside every cell. No labels or borders. Each frame is a complete coherent illustration.

For waterfalls, move bright streaks downward through broad continuous cyan streams and vary splash droplets. For eating, preserve the prop grip and move the hoof to the mouth. Count every limb in every frame.

## Assemble

Use the supplied macOS helper when Swift/ImageIO are available. It crops fixed cells without independently recentering or stretching characters, scales all frames identically and encodes an endlessly looping transparent GIF. It also saves frame previews and verifies GIF frame count. It does not repair inconsistent artwork.

```sh
xcrun swift -module-cache-path /tmp/yako-swift-cache scripts/assemble_gif.swift \
  --sheet assets/yak-cry-sheet.png --columns 2 --rows 2 \
  --output /absolute/task/outputs/yak-cry --sizes 32,128,384 --delay 0.14
```

Run from the skill directory or use absolute paths. `--output` is a filename prefix; the helper adds `-128.gif` etc. It refuses to overwrite existing output files. For another variant, choose a new prefix. Use `--count` for a sheet with unused trailing cells. For variable holds, `--delays` accepts one comma-separated duration per frame. GIF timing is rounded to hundredths of a second.

On another platform, use the supported image/GIF tooling with the same fixed cell crop, common scale, alpha handling, full-frame disposal and infinite-loop behavior. Do not install packages or silently use a paid service solely because this macOS helper is unavailable. State runtime needs and use available capabilities.

GIF alpha is binary. The helper thresholds alpha after resizing to remove translucent fringes; it unpremultiplies RGB before making edge pixels opaque. Inspect the result on light and dark backgrounds. Do not independently crop each frame to its visible bounds: that changes size and alignment as splashes move.

## Check before delivery

Inspect all frame previews for changing anatomy, detached limbs, wrong counts, scale drift and clipping. Watch the loop if possible. Confirm tears/props actually move, feet don't jump, transparent regions clear correctly, and the last-to-first transition is coherent. The 128px version should read immediately; inspect at 32px too. If the loop fails, regenerate the problematic frames or simplify the motion. Retain a clean still as an optional companion, not a substitute for an explicitly requested GIF.
