---
name: yakomoji
description: Create or revise consistent Yako (Yucko) mascot emoji as transparent still PNGs or looping animated GIFs, using the bundled character reference and the team's established cartoon style.
metadata:
  version: "0.2.1"
---

# Yakomoji

Create a recognizable, cute Yako whose expression and action read at chat-emoji size. Use the user's requested name and concept. Default to a still unless animation is requested. User direction overrides these defaults.

## Character reference

Resolve all paths relative to this skill folder. Open `assets/yako-reference.png` with the available image-viewing tool before generating. Pass it to the image tool as the character identity reference; a written description alone is insufficient for consistent results. For an edit, use the current selected image as the primary reference. An external meme or costume image is a secondary pose/style reference only.

- Round, cute, shaggy brown yak face; cream tousled forelock and beard/chest; broad tan oval muzzle; large white expressive eyes; wide ears and curved tan horns.
- Broad tan cloven hooves, each with **two chunky lobes and one central cleft**. No fingers, thumbs, palm creases, or human hands—even for human meme poses.
- Rounded compact proportions and a large readable face. Keep the muzzle short and eyes friendly. Avoid elongated faces and oversized human toothy grins.
- Thick dark-brown cartoon outlines, simple warm colors, restrained soft shading. Sparse fur strokes rather than realistic hair.
- Costumes, aging, transformations and colors may change to serve the request; keep the characteristic face, muzzle, horns and hoof anatomy.

## Composition

Use one clear joke or action. Prefer head and torso close-ups; use full body when sitting, kicking, walking or another action requires it. Fill a square canvas with a compact silhouette, small safe margins and actual transparency. Keep horns, props and limbs inside the canvas. Use bold recognizable props, clear gaps between limbs, and little fine detail. Default to no text or scenery. Add scenery only when it materially supports the concept or the user asks.

For many-limb concepts, explicitly state exact limb and object counts and their one-to-one relationship. For held props, describe the grip and perspective. Laptop displays face the character; show lid backs when appropriate. For a meme, inspect the actual reference, then transfer its pose and expression to Yako's anatomy.

## Stills and edits

For a concept already explored by the team, read its entry in [references/concepts.md](references/concepts.md) and inspect the linked example. The catalog covers all 20 existing concepts, their intended meaning, current visual direction, and relevant revision lessons. Load only the relevant examples; these concepts are starting points, not mandatory costumes or compositions.

1. Choose the main expression, pose and one or two necessary props; proceed using context without requiring a concept approval.
2. Use the available image-generation/editing tool, with transparency enabled. If the environment provides an imagegen skill, follow its tool-routing rules. Do not silently switch to a separately billed API or require an API key when a built-in tool is available.
3. Use the prompt structures in [references/prompts.md](references/prompts.md). For revisions, name the exact change and all important invariants. Avoid rebuilding unrelated details.
4. Inspect the generated image: identity, hooves, limb count, prop contact, cropping, alpha and action readability. Make focused corrections when needed.
5. Save the final PNG in the task workspace using the emoji name; preserve prior versions during revisions. A name such as `yak-smash` is a filename/emoji shortcode, not a request to print text in the picture.

## Animation

Read [references/animation.md](references/animation.md) for an animated request. Deliver an actual looping GIF, not just a sprite sheet. Favor a small coherent sequence with a stable pose and visible motion in the relevant action. Earlier rigid limb rotations and whole-character wobbling did not satisfy this user's animation expectations. Keep body and feet registered; animate the action (flowing tears, eating, blinking) rather than substituting unrelated motion.

The bundled `assets/yak-cry-sheet.png` and `assets/yak-cry-128.gif` demonstrate a four-frame waterfall-cry loop. They are examples, not a required template for every action. The sheet assembler supports macOS with Swift; other environments may use their supported GIF encoder following the same frame rules.

## Delivery and quality

- For stills, provide the transparent master PNG. For animations, provide a 128px emoji GIF and a 384px preview; a 32px version is useful for checking readability. These are project conventions, not claims about every chat service's upload limits.
- Inspect at small size and on both light and dark backgrounds. Check that the face/action remains recognizable, outlines are clean, props are countable and no stray halos appear.
- For GIFs, verify multiple frames, loop metadata, durations, transparency, disposal/trailing artifacts, file size and the transition from last frame to first. Watch the loop when a preview surface is available; otherwise inspect frame samples and state any unverified playback limitation.
- Keep the source PNG/sheet and a short note with the final prompt and tool used. Return clickable file links and an inline preview where supported. Never claim exact pixel preservation from a generative edit.
- Do not upload emoji or message teammates unless explicitly asked. The skill package is shareable; it does not itself authorize publishing.

For visual comparisons, use the [concept catalog](references/concepts.md). Its examples include close-ups, full-body actions, group compositions, meme adaptations and animations. The bundled examples record work created in the originating chat; inclusion does not imply that every example was explicitly approved by the user.
