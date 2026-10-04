# Fetch Desk motion

> Integration update: origin/main was pulled to `f1cd987`. The redesign now uses upstream `DeskEngine`, `CreatePetFlow`, `PetSwitcher` and server pet synchronization. Engine source files remain unchanged. The size/performance figures below describe the pre-integration redesign; the merged build includes the upstream 3D runtime (approximately 1,966.6 kB gzip JS / 17.48 kB gzip CSS) and emits Vite's large-chunk warning.

The Desk keeps its navy/lime identity with warm paper, Fraunces headlines, Nunito Sans UI, original SVG icons and an illustrated companion. Work is quiet sage; Play crossfades peach into the habitat before opening the existing room route. The room and pet engine are unchanged.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| quick | 160 ms | small control feedback |
| normal | 240 ms | default Motion transitions, paper hover, notifications, paper pile |
| reveal | 360 ms | section reveals, badge, toggle |
| scene | 400 ms | theme wash, treat hop/crumbs, ripple |
| ease.out | cubic-bezier(.22,1,.36,1) | entrances and UI settling |
| ease.inOut | cubic-bezier(.65,0,.35,1) | reserved for reversible scene transitions |
| spring.soft | duration 380 ms, bounce .18 | card entrance/release, speech bubble |
| spring.magnetic | stiffness 350, damping 28, mass .5 | magnetic buttons and eye tracking |

`src/motion.tsx` owns JS tokens, `MotionProvider`, `Reveal`, `MagneticButton`, focus, ripples and platform measurement. CSS equivalents live in `design.css`. All interpolated visual properties are transform/opacity. Blur and shadows are static surfaces; their layers fade or move. Pointer resizing changes dimensions directly without a layout transition.

## Choreography

- Sidebar enters first; greeting, one headline reveal, command bar and prompts follow. Card entrances stagger 80 ms with a restrained bounce. Input stays live.
- Native scrolling drives sun/hill/feather parallax, six paw progress marks, Pip's head tilt and a small calendar-edge peek. A fixed-size sticky header condenses its glass layer without changing document layout. Lower sections reveal once.
- Card titles drag; release carries at most 14 px of velocity before a short spring settlement. Hover tilts only decorative paper. Arrow keys move; Shift increases the step; the resize handle accepts the same keys.
- Focus reveals the command halo; listening pulses the mic; speech animates five waveform bars. Button press, magnetic movement and pointer ripple are independent of text layout.
- Treats drag onto Pip or activate by click/keyboard. A 400 ms hop and crumbs acknowledge success. Toys bounce on hover. Bubbles enter/exit; idle blinks, wing/tail flicks and dust pause offscreen.
- Peek derives papers and activity from existing run events: dust while working, paper layers on tool completion, tail burst on success, sheepish error pose. Empty cards show sleepy Pip; planning uses paw skeletons.
- Approval requires the existing explicit button or an uninterrupted 1.2-second pointer/Space hold. Twelve opacity segments communicate hold progress. Release, blur, pointer cancellation or leaving the control cancels the gesture. Enter activates only the focused button.

## Engine geometry contract

No engine files or contract types changed. `getBoundingClientRect()` measurements are converted to coordinates relative to the engine canvas before calling the upstream DeskEngine adapter, which converts them back to viewport coordinates for the real engine. Moving/entering/resizing cards are synchronously removed before motion and restored after settlement. A layout effect commits the final x/y and clears the transform before reporting. ResizeObserver, capture-phase scroll, viewport resize and font readiness trigger batched measurements. Unchanged reports are deduplicated. Decorative hover layers and the peeking mascot never move the reported card wrapper.

## Reduced motion and keyboard

OS `prefers-reduced-motion` and the existing Settings toggle both disable parallax, eye following, entrance displacement, ambient loops, ripples, magnetic movement and animated drag settlement. Treats remain clickable and keyboard operable. Paw progress and hold segments retain direct state feedback. No smooth-scroll library intercepts native scrolling. Dialogs trap/restore focus; controls have visible focus indicators; scrollable card bodies are keyboard focusable.

## Verification and performance

Commands: `pnpm --filter @fetch/desk lint`, `typecheck`, `build`, `test:ui`. Browser checks use an installed Chrome (`channel: 'chrome'`); CI can install it with `pnpm --filter @fetch/desk exec playwright install chrome`.

Ten browser tests cover desktop/mobile, reduced motion, keyboard movement/resizing, calendar drag and platform reporting during/after motion and scroll, quiet states, focus, approval hold/cancellation, command/Peek flow, error events, pet creation/switching, treat drop after scroll, and the existing Play destination. Axe checks WCAG A/AA rules on light/dark Desk, settings and notifications. Visual captures cover 1440, 1280, 768 and 390 px widths. These are frontend/demo checks; they do not validate live account integrations or microphone hardware.

Production baseline rebuilt from commit `0c7479b` using the same Vite: **82.56 kB gzip JS / 7.36 kB gzip CSS**. Redesign: approximately **137.7 kB gzip JS / 16.3 kB gzip CSS**, an increase of **55.1 / 8.9 kB**. Three Latin variable WOFF2 files total **113.34 kB**, including the italic display face; critical normal faces total **67.69 kB** and are preloaded. Fonts are self-hosted with `font-display: swap`; no Google Fonts requests remain.

A 3.5-second native-scroll sample in Windows headless Chrome 154 recorded **259 frames**, **13.3 ms median**, **13.5 ms p95**, and **2 frames over 33.4 ms**. This supports the 60 fps target on this environment, not a guarantee for all devices. Motion values avoid React updates for continuous parallax/eyes; measurements use one rAF batch; only six dust particles and five waveform bars are used. No WebGL, image assets, smooth-scroll runtime or engine code was added.

## Changed files and dependencies

| Files | Purpose |
| --- | --- |
| `src/App.tsx` | redesigned shell, preserved commands/dialogs/routes, suggestions, help, approval integration |
| `src/DeskWindow.tsx` | extracted cards, responsive positions, pointer/keyboard drag and resize |
| `src/DeskLife.tsx` | SVG mascot, habitat, scroll responses, trays, Peek, hold control and states |
| `src/motion.tsx` | motion system, geometry reporting and accessible interaction hooks |
| `src/icons.tsx` | original warm SVG icon set |
| `src/design.css` | visual system, responsive layouts, themes and calm overrides |
| `src/fonts.css`, `index.html`, `src/main.tsx` | self-hosted fonts, preloads and stylesheet wiring |
| `src/styles.css`, `src/f2.css` | remove old font imports/stacks and obsolete layout animation |
| `src/store.ts` | select an existing pet; existing state shape retained |
| `package.json`, `../../pnpm-lock.yaml` | dependencies and lint/typecheck/browser scripts |
| `eslint.config.js`, `playwright.config.ts`, `.gitignore` | repeatable checks and generated-artifact exclusions |
| `tests/desk.spec.ts`, `tests/accessibility.spec.ts`, `tests/visual-performance.spec.ts` | interaction, accessibility, responsive and performance coverage |
| `MOTION.md` | this specification and measured delivery notes |

Runtime additions: `motion` 14 (React animation/gesture system), `@fontsource-variable/fraunces` and `@fontsource-variable/nunito-sans` 5.3 (local fonts). Development additions: ESLint 10, `@eslint/js`, `typescript-eslint` 8.71, Playwright 1.63 and `@axe-core/playwright` 4.13. Desk's floating TypeScript version is pinned to **5.9.3** because the installed lint parser rejects TypeScript 7; other workspace compiler versions are unchanged. Test/lint tools do not enter the client bundle.
