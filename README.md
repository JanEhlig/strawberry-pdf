# Strawberry PDF

A free PDF reader and editor for Windows, for everything you need day to day. No subscription, no account and no cloud. Files never leave the computer.

## Features

| Task | How |
|---|---|
| **Read** | Open PDFs by double-click, with "Open PDF" or by drag and drop. Multiple files open in tabs. Zoom with Ctrl+mouse wheel, browse thumbnails and the outline, search with Ctrl+F. |
| **Highlight** | Select text and choose **Highlight**, **Underline** or **Strike through** in the bar below the selection. The **Mark up** tool (H) does the same; hold Alt to mark a free area instead of text. |
| **Add text** | Choose **Text** (T), click an empty spot on the page and type. Font, size and color are set in the options bar. Hold Alt to place new text on top of existing text. |
| **Edit existing text** | In the **Text** tool, point at a line and click it, or select a line and choose **Edit text**. The new text keeps the original font, size, color and letter spacing, and the size can be adjusted while editing. Characters missing from the embedded font are taken from the same font on the computer or from a close match. The original line is replaced in the file, not covered up. |
| **Insert images** | In the **Sign** tool (S), click the image icon, pick a PNG or JPEG such as a logo or stamp, and click on the page. |
| **Comment** | Pin a **Note** (N) or double-click any annotation. Clicking a note opens its comment right away. All comments are listed in the sidebar. |
| **Draw and shapes** | **Draw** (D) for freehand. **Shapes** (R) for rectangle, ellipse, line and arrow; hold Shift for straight lines and squares. |
| **Sign** | **Sign** (S): draw, type or import a signature. The stroke weight can be adjusted at any time and the signature is saved for later use. Checkmark, cross and date are available as well. |
| **Fill forms** | Click into a form field and type. Tab moves to the next field. |
| **Redact** | **Redact** (X): swipe over text or drag an area, then choose "Apply redactions". Text, image pixels and graphics are permanently removed from the file. |
| **Organize pages** | **Pages** opens the page overview. Reorder pages by dragging, rotate, delete, insert blank pages or save a selection as a new PDF. |
| **Combine PDFs** | Choose **Combine PDFs** on the start screen or in the ⋯ menu, or drop a PDF into the page overview. Form fields, notes and links are preserved. |
| **Save** | Ctrl+S saves. "Save as" and "Copy with embedded annotations" are in the ⋯ menu. |
| **Export to Word and Excel** | Choose **Export to Word** or **Export to Excel** in the ⋯ menu. Word files keep paragraphs, fonts, colors, tables and images. Excel files get one sheet per page, with tables in rows and columns and amounts, percentages and dates as real numbers. Form field values and annotations are included, and scanned pages with recognized text are exported as text. |
| **Print** | Ctrl+P opens the print dialog with a preview. Choose the printer, copies, pages (all, the current page or a range such as 1-3, 5), paper, size, orientation and two-sided printing, print in grayscale and decide whether annotations are printed. Landscape pages are turned to fit the paper automatically, and the settings are remembered. The Windows print dialog is still one click away. |
| **Undo** | Ctrl+Z and Ctrl+Y, even after saving. |

Press **F1** for all keyboard shortcuts.

Available in English, German, French, Spanish, Italian, Dutch, Polish and Portuguese. The language follows Windows and can be changed in the settings.

## Installation

1. Download `Strawberry-PDF-Setup-<version>.exe` from the [releases page](https://github.com/JanEhlig/strawberry-pdf/releases/latest) and run it. The default "Only for me" installation does not require administrator rights.
2. Windows SmartScreen may show an "Unknown publisher" warning on first launch, because the installer is not signed with a commercial certificate. Choose "More info" and then "Run anyway".
3. To make Strawberry PDF the default PDF app, open the ⋯ menu, go to *Settings* and choose *Open Windows settings*.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run dev          # start the app with hot reload
npm test             # unit tests
npm run build        # production build to out/
npm run e2e          # end-to-end tests against the build (Playwright and Electron)
npm run typecheck    # type checking
npm run fixtures     # regenerate test PDFs
npm run icons        # generate app icons and Store tiles from build/icon.svg
npm run dist         # Windows installer to release/
npm run dist:store   # Microsoft Store package to release/
npm run release:public -- owner/repo          # dry run of a public release
npm run release:public -- owner/repo --push   # publish the release as a single commit and tag
```

### Architecture

Strawberry PDF uses a **layered architecture following the ports and adapters pattern** (hexagonal architecture). Dependencies point inward only: the UI depends on the application layer, the application layer depends on the engine and platform ports, and the core depends on nothing.

| Layer | Location | Responsibility |
|---|---|---|
| **UI** | `src/renderer/src/app`, `chrome`, `viewer`, `sidebar`, `organize`, `dialogs`, `start`, `ui` | React components grouped by feature. `ui` is the shared component library. |
| **Application** | `src/renderer/src/state` | Per-document and app state (Zustand stores, unidirectional data flow) and use cases such as open, save, export, pages, redaction and printing. Every document mutation goes through this layer. |
| **Core** | `src/renderer/src/engine` (entry point `core.ts`) | All PDF logic, built on MuPDF, including text editing and the Word and Excel export in `engine/export`. Independent of the UI and Electron, and tested directly in Node. |
| **Adapters** | `src/renderer/src/engine/client.ts`, `worker.ts`, `src/renderer/src/platform` | Connect the core through a web worker (RPC with a render queue) and the app to Electron, with a browser fallback. |
| **Host** | `src/main`, `src/preload`, `src/shared` | Electron main process: windows, file access, atomic saving, printing, installed fonts, single instance. The inter-process contract is defined in `src/shared/api.ts` and exposed by `src/preload`. |

Deliberate exceptions: read-only calls such as rendering and text selection go from the UI straight to the engine client. Dialogs that need an answer (password, redaction confirmation, signature) are provided to the application layer as functions returning a promise.

### Technical notes

- Documents are saved with `garbage,compress`. `garbage=compact` would break the undo history, and saving without garbage collection would leave redacted content in the file. Both cases are covered by tests.
- Digitally signed PDFs are saved incrementally so existing signatures stay valid, except after redaction.
- Annotations are standard PDF annotations and remain visible and editable in Acrobat, Edge and Chrome.

## License

Strawberry PDF is free software licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later), as required by its PDF engine MuPDF (© Artifex Software, AGPL-3.0). Anyone distributing Strawberry PDF must provide the corresponding source code. See [LICENSE](LICENSE) for the full text.

Fonts: Atkinson Hyperlegible Next, Great Vibes, Dancing Script and Caveat (SIL Open Font License). Icons: Lucide (ISC).
