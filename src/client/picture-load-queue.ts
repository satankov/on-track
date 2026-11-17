// Owned by one mounted history. Each slot covers the read and the browser decode.
export class PictureLoadQueue {
  private readonly waiting = new Set<() => void>();
  private active = 0;

  enqueue(load: () => void): () => void {
    let running = false;
    const start = () => {
      running = true;
      this.active++;
      load();
    };
    if (this.active < 2) start();
    else this.waiting.add(start);

    // The same release handles completion, leaving the queue, and unmount.
    return () => {
      this.waiting.delete(start);
      if (!running) return;
      running = false;
      this.active--;
      const next = this.waiting.values().next().value;
      if (next) {
        this.waiting.delete(next);
        next();
      }
    };
  }
}
