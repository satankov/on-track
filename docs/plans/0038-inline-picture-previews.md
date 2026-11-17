# Inline picture previews

Implemented on the v0.2.1 feature branch, November 17, 2026. The feature covers pictures attached to saved messages. [Open the interactive mockup](../../branding/threadstr/picture-previews/index.html).

## Reading a picture in context

A person returning to a project should be able to recognize a photo or check which screenshot a note refers to while reading the conversation. The first opening of a conversation, a reload, and a visit through the Files filter should all show the picture automatically.

| Message contents                  | Proposed appearance                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One picture                       | Place the complete picture in a frame up to 400 × 225 CSS pixels inside the existing attachment group. Put the filename, type, size, modification time and native actions underneath.                    |
| Two or more pictures              | Give each picture a 96 × 72 thumbnail beside its filename. At narrow widths use 72 × 54 and let the action buttons wrap. Show every attachment in its saved order, including documents between pictures. |
| Picture and documents             | Count pictures to choose the layout. A single picture still gets the larger frame. Each document keeps its compact file row.                                                                             |
| Portrait, panorama or small image | Center the whole image on the attachment surface, preserve orientation and aspect ratio, and scale down to fit. Fine details and edges are available in the larger view.                                 |
| Picture only                      | Render the attachment group and message footer. A caption is optional. Existing captions, labels and message times keep their positions.                                                                 |

Use the conversation's actual message bubble, inset surface, type badge and icon controls. Reserve the framed area before the picture loads and keep the message anchor stable if a preview fails. The preview sits outside the collapsible text body. Conversation search and Files use the same timeline presentation. A project-wide search result takes the reader to the owning conversation for the picture.

## Viewing a larger picture

Clicking or tapping a picture opens a fitted view inside the web interface. The viewer shows the filename, complete picture and a **Close** button. Keep the opener in the timeline. Give it a name such as “View earthrise-proof.jpg larger”, support Enter and Space, and show keyboard focus against the attachment inset. A native modal dialog keeps focus inside, supports Escape, and returns focus to that picture when closed. Respect browser zoom and the current viewport height.

Keep **Open** and **Show in Folder** beside the filename, using the capabilities reported for that file. They continue to use the operating system. On a missing file, show “File is missing.” in the existing row. Show in Folder can still reveal the containing directory when available. If a supported picture is corrupt or exceeds a preview limit, keep its metadata and available actions with a short reason such as “Image is too large to preview.” Ordinary documents need no preview warning.

## Implemented slice

Start with static JPEG and PNG files already managed by threadstr, including old messages and restored backups. Picked but unsent files keep the existing composer treatment. Markdown image URLs, animated images, SVG, video, PDFs and HEIC fall outside this slice. Automatic reads are limited to **12 MiB and 24 megapixels per picture**. Opening or revealing a file in the OS retains its own policy.

1. **Local image reads.** Add a read-only preview resource scoped to the conversation, note and attachment IDs in `src/server/app.ts` and `src/server/chat-service.ts`. Reuse ownership checks, the maintenance gate, and descriptor-validated reads in `src/server/attachments/managed-attachment-store.ts`. Enforce the byte ceiling before allocation. Check the actual raster format, dimensions and animation eligibility before returning bytes. Match the verified type to an eligible file extension. Apply same-origin image-request checks, a fixed image content type, `nosniff`, same-origin resource policy, and `no-store`. Share the guarded source between thumbnail and viewer. Native Open eligibility alone cannot establish preview eligibility.
2. **Timeline and viewer.** Extend `AttachmentList` in `src/client/App.tsx` and its rules in `src/client/styles.css`. Use filename and inexpensive metadata to reserve a candidate frame. Show the image once the local response passes validation and the browser decodes it. Lazy-load near the viewport and bound simultaneous reads. Key refreshes to the attachment identity and observed size/mtime. Drop stale images after replacement, removal or import. Use the existing dialog pattern and theme tokens. Record the new frame, compact row and focus states in `DESIGN.md` and the UI cookbook when implemented.
3. **Qualification.** Exercise a fresh upload, pre-existing attachment, Files-filter visit, and a sidecar edited outside threadstr. Check the same note after restoration, a chat switch during loading, and a project-search jump into a subthread. Measure the effect of ten large candidates on initial render, decode memory and timeline position before accepting the limits.

SQLite retains attachment metadata, the managed file holds the original bytes, and portable backups include those bytes through the existing export flow. Previews come from the current managed copy on demand. Large inline pictures are reduced in the browser and distant rows release their image sources. The feature uses the existing schema, backup format and dependencies. The browser's native image element supports deferred loading and space reservation. [MDN image element reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img). The storage and native action boundaries are documented in [ADR-0006](../adr/0006-managed-mutable-attachments-and-native-file-actions.md).

## Acceptance and verification

- Service and route tests cover scoped ownership, actual supported content, size and pixel bounds, missing or unsafe files, mutation during read, maintenance, and response headers. Confirm that arbitrary attachments still have no download route.
- Component tests cover loading, resize, unsupported and unreadable files, one and multiple pictures, mixed file order, attachment-only notes, and capability-specific fallback. A passive preview must never dispatch a native action.
- Browser tests cover an uncropped portrait and screenshot, keyboard activation and return, touch, long filenames, constrained width, all three themes, forced colors, and focus refresh after an external edit. Check scrolling and zoom before and after loading several pictures.
- Regression commands include `npm test -- src/server/attachments/managed-attachment-store.test.ts src/server/chat-service.test.ts src/server/app.test.ts src/client/App.test.tsx`, `npm run test:e2e -- e2e/project-chat.spec.ts e2e/project-search.spec.ts e2e/security-boundaries.spec.ts`, and `npm run verify`.

## Review

The mockup offers **One picture**, **Several files** and **Missing picture**. Click a picture to inspect the viewer. The examples and theme controls belong to the mockup. Its sample print uses Bill Anders’s Apollo 8 photograph. [NASA image credit](https://science.nasa.gov/resource/apollo-8s-iconic-earthrise/).

## Verification evidence

- The original release build failed the new browser journey because a saved picture had no inline viewer button. Desktop Chromium and mobile WebKit now pass upload, Files filtering, reopening, mixed-file order, full-size viewing, external edit refresh, selection-mode Escape, backup restoration and the project-search jump into a subthread.
- The browser admits two inline reads per mounted history and the server allows eight in-flight preview responses. Inline images over 2 megapixels become transient display-sized PNGs, up to 800 × 450 or 192 × 144. The full viewer loads the original. A distant row releases the image when it no longer owns focus or the open viewer.
- In a local Chromium run, a single note held ten 6000 × 4000 JPEGs of about 1 MiB each. All ten produced 192 × 128 thumbnails with at most two concurrent inline requests. The frame height stayed fixed, and the enlarged image retained its original dimensions. On that run the note appeared in 180 ms and all ten previews had been viewed within 861 ms.
- Large originals still require browser decoding. The combined renderer and GPU resident set sampled about 176 MiB before opening the note and about 780 MiB after viewing all ten. These figures include browser caches and shared pages. They do not measure a dedicated image heap or establish a memory bound for physical phones.
- `CI=true npm run verify` passed on macOS / Node 22.18.0, including the managed installation, update/recovery and uninstall smokes. Production dependency audit reported three moderate findings in the existing dependency tree. Desktop and narrow mobile browser checks also exercised the three themes, and Chromium exercised keyboard return at 200% zoom and in forced colors.
