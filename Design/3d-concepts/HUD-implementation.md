# HUD design deconstruction

The two references share one shell. hud1 is the crypt / Night 1 state; hud2 is the church / Night 3 state. The top band occupies about 70 of 937 reference pixels; the footer occupies 85. The viewport between them remains the existing 3D scene.

## Visual layers

- Dark oxblood-brown wood, fine horizontal grain, black recesses, double brass edge highlights, and gothic corner tracery.
- Top: crescent medallion and plum night capsule; a rounded navy-to-amber time track, moon, stars, tick marks, sun and diamond pointer; plum countdown capsule; house totals on two lines; bat and hunter-hat counters; three inset hunger rings.
- Footer: pointed-arch crypt badge projecting above the frame; large ivory location title; smaller parchment description; hairline gold divider and ruby diamond; individually framed WASD keys. hud1 also includes an E / Enter prompt.
- Typography uses local Georgia / Times New Roman, warm ivory, lavender cursed totals, and dark relief shadows. The source typeface is unknown, so glyph shapes are an approximation.

## Assets and layout

`assets/hud/concept-atlas.png` is an unchanged copy of hud1. CSS sprite coordinates preserve its painted moon, house, bat, hat, crypt badge, and corner graphics. No image-generation service, package manager, or runtime dependency is required for the HUD. `wood.svg` and `clock.svg` supply scalable, reconstructed surfaces. Text, counter values, hunger state, clock pointer, and layout are independent elements, not a screenshot overlay.

Desktop scales at the reference width of 1678px, bounded to keep large-screen text legible without enormous ornament. Below 1100px, time information and counters occupy separate rows. Below 600px, the footer wraps and drops the decorative divider and keyboard movement legend; every top-bar statistic remains visible. A narrower-phone adjustment supports 320px. Safe-area offsets protect notched screens. The HUD does not intercept the scene's pointer input, and the settings panel sits below the top bar.

## Prototype states and integration

- `scene3d.html`: live day/night clock, countdown, pointer, and location text from the scene's walker proximity.
- `scene3d.html?hud=1`: frozen hud1 values and crypt copy, including the reference-only E / Enter prompt.
- `scene3d.html?hud=2`: frozen hud2 values and church copy.
- `window.hud.setCounters({clean, cursed, vampires, hunters, hunger})` is the integration point for gameplay. These counters currently use sample data; they are not connected to the 2D game's simulation.
- Hunger runs from 0 (fully fed, three red blood circles) to 3 (starving, three empty circles). Initial hunger is 0 in live and reference modes.
- The round badge displays the sun from 06:00 to 18:00 and the moon otherwise. During the final five seconds before dusk, the countdown alternates red and ivory once per second; reduced-motion mode keeps it steadily red. The warning clears at nightfall.
- `window.hud.setContext(title, description)` updates the footer. Default proximity updates run every 250ms; reference modes freeze these updates.

The reference E prompt is visual only: the existing 3D scene has no enter-crypt gameplay. Live mode omits that prompt. Keyboard movement remains the existing WASD/arrow implementation; this change does not add touch locomotion.

Implementation uses standard [CSS media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using) and [background positioning](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/background-position). No npm tools were used.
