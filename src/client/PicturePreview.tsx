import { useEffect, useId, useRef, useState } from "react";
import type { PictureLoadQueue } from "./picture-load-queue.js";
import { useModalDialog } from "./useModalDialog.js";

function PictureViewer({
  filename,
  source,
  close,
}: {
  filename: string;
  source: string;
  close: () => void;
}) {
  const dialog = useModalDialog();
  const heading = useId();
  const [failed, setFailed] = useState(false);
  return (
    <dialog
      ref={dialog}
      open
      className="dialog-backdrop"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="project-dialog picture-viewer">
        <header>
          <h2 id={heading}>{filename}</h2>
          <button type="button" className="button button-quiet" onClick={close}>
            Close
          </button>
        </header>
        {failed ? (
          <p role="status">Image preview unavailable.</p>
        ) : (
          <img src={source} alt={filename} onError={() => setFailed(true)} />
        )}
      </section>
    </dialog>
  );
}

// Large originals can otherwise keep tens of MiB of decoded pixels per row.
function inlineThumbnail(image: HTMLImageElement, compact: boolean) {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (width * height <= 2_000_000) return;
  const scale = Math.min(
    (compact ? 192 : 800) / width,
    (compact ? 144 : 450) / height,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image preview unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export function PicturePreview({
  filename,
  source,
  queue,
  compact = false,
}: {
  filename: string;
  source: string;
  queue: PictureLoadQueue;
  compact?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [viewing, setViewing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const frame = button.current!;
    const element = image.current!;
    let disposed = false;
    let nearby = true;
    let generation = 0;
    let release: (() => void) | undefined;

    function finish(success: boolean, read = generation) {
      if (disposed || read !== generation || !element.hasAttribute("src"))
        return;
      if (!success) {
        observer?.disconnect();
        element.removeAttribute("src");
      }
      setStatus(success ? "ready" : "failed");
      release?.();
    }
    function loaded() {
      if (!element.hasAttribute("src")) return;
      try {
        const small = inlineThumbnail(element, compact);
        if (small) {
          // Assigning the bounded PNG releases the camera-size source. Wait
          // for the thumbnail's own load/decode before yielding the queue slot.
          element.src = small;
          return;
        }
        const read = generation;
        if (typeof element.decode === "function")
          void element.decode().then(
            () => finish(true, read),
            () => finish(false, read),
          );
        else finish(true, read);
      } catch {
        finish(false);
      }
    }
    const failed = () => finish(false);
    function schedule() {
      release ??= queue.enqueue(() => {
        element.src = source;
      });
    }
    function unloadDistantImage() {
      if (
        nearby ||
        document.activeElement === frame ||
        frame.closest(".attachment-card")?.querySelector("dialog[open]")
      )
        return;
      if (element.hasAttribute("src")) {
        generation++;
        element.removeAttribute("src");
        setStatus("loading");
      }
      release?.();
      release = undefined;
    }
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              if (disposed) return;
              nearby = entries[entries.length - 1].isIntersecting;
              if (nearby) schedule();
              else unloadDistantImage();
            },
            { root: frame.closest(".history"), rootMargin: "200px 0px" },
          );
    element.addEventListener("load", loaded);
    element.addEventListener("error", failed);
    frame.addEventListener("blur", unloadDistantImage);
    if (observer) observer.observe(frame);
    else schedule();
    return () => {
      disposed = true;
      observer?.disconnect();
      frame.removeEventListener("blur", unloadDistantImage);
      element.removeEventListener("load", loaded);
      element.removeEventListener("error", failed);
      element.removeAttribute("src");
      release?.();
    };
  }, [queue, source, compact, attempt]);

  const failed = status === "failed";
  return (
    <>
      <button
        type="button"
        ref={button}
        className="picture-frame"
        aria-label={
          failed ? `Retry preview of ${filename}` : `View ${filename} larger`
        }
        aria-busy={status === "loading" || undefined}
        aria-haspopup={failed ? undefined : "dialog"}
        disabled={status === "loading"}
        onClick={() => {
          if (failed) {
            setStatus("loading");
            setAttempt(attempt + 1);
          } else {
            // Touch and Safari clicks do not necessarily focus the opener.
            button.current?.focus({ preventScroll: true });
            setViewing(true);
          }
        }}
      >
        <img ref={image} alt="" decoding="async" hidden={status !== "ready"} />
        {status === "ready" && (
          <span className="picture-expand" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />
            </svg>
          </span>
        )}
        {failed && (
          <span className="picture-error">
            <span>Image preview unavailable.</span>
            <u>Retry</u>
          </span>
        )}
      </button>
      {viewing && (
        <PictureViewer
          filename={filename}
          source={source}
          close={() => setViewing(false)}
        />
      )}
    </>
  );
}
