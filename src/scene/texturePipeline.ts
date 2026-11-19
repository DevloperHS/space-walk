import * as THREE from 'three';
import {
  RawRgbaBuffer,
  runTextureJob,
  TextureJob,
  TextureJobResult,
} from './textureGenerators';

interface QueuedJob {
  id: number;
  priority: number;
  job: TextureJob;
  onReady: (result: TextureJobResult) => void;
}

interface CompletedJob {
  result: TextureJobResult;
  onReady: (result: TextureJobResult) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

/**
 * Wraps a raw top-to-bottom RGBA pixel buffer into a mipmapped, anisotropically
 * filtered THREE.DataTexture with flipY = true so orientation matches CanvasTexture identically.
 */
export function buildDataTexture(
  buf: RawRgbaBuffer,
  isColor: boolean,
  maxAnisotropy: number,
  wrapS: THREE.Wrapping = THREE.RepeatWrapping,
  wrapT: THREE.Wrapping = THREE.ClampToEdgeWrapping,
  repeat = 1,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(buf.data, buf.width, buf.height, THREE.RGBAFormat);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.flipY = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, maxAnisotropy);
  if (repeat !== 1) {
    tex.repeat.set(repeat, repeat);
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Progressive off-main-thread procedural texture bakery.
 * - Spawns a compact Web Worker pool so full 1024x512 planetary and 512x512 asteroid
 *   PBR maps never freeze the browser window on low-end CPUs.
 * - Processes jobs in strict visibility priority order (spawn view first).
 * - Throttles GPU texture handoff to 1 texture set per animation frame via flushOneUpload()
 *   so GPU mipmap uploads never stall the render loop.
 * - Automatically terminates all workers once baking completes to reclaim memory.
 */
export class ProgressiveTexturePipeline {
  private nextId = 1;
  private disposed = false;
  private started = false;
  private queue: QueuedJob[] = [];
  private inFlight = new Map<number, QueuedJob>();
  private completed: CompletedJob[] = [];
  private workers: WorkerSlot[] = [];
  private fallbackTimer: number | null = null;
  private useWorkers = false;

  public enqueue(
    priority: number,
    job: TextureJob,
    onReady: (result: TextureJobResult) => void,
  ): void {
    if (this.disposed) return;
    this.queue.push({
      id: this.nextId++,
      priority,
      job,
      onReady,
    });
  }

  public start(): void {
    if (this.disposed || this.started || this.queue.length === 0) return;
    this.started = true;
    this.queue.sort((a, b) => a.priority - b.priority || a.id - b.id);

    // Keep at least 1 core free for main thread & browser compositor on low-core devices
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    const workerCount = Math.max(1, Math.min(3, cores <= 2 ? 1 : cores - 1));

    if (typeof Worker !== 'undefined') {
      try {
        for (let i = 0; i < workerCount; i++) {
          const worker = new Worker(new URL('./textureWorker.ts', import.meta.url), {
            type: 'module',
          });
          const slot: WorkerSlot = { worker, busy: false };
          worker.onmessage = (e: MessageEvent<{ id: number; result: TextureJobResult }>) => {
            if (this.disposed) return;
            slot.busy = false;
            const entry = this.inFlight.get(e.data.id);
            if (entry) {
              this.inFlight.delete(e.data.id);
              this.completed.push({ result: e.data.result, onReady: entry.onReady });
            }
            this.dispatchNext();
          };
          worker.onerror = () => {
            // Gracefully fall back to sliced main-thread execution if worker fails
            slot.busy = false;
            this.teardownWorkers();
            this.useWorkers = false;
            this.requeueInFlight();
            this.scheduleFallbackSlice();
          };
          this.workers.push(slot);
        }
        this.useWorkers = this.workers.length > 0;
      } catch {
        this.teardownWorkers();
        this.useWorkers = false;
      }
    }

    if (this.useWorkers) {
      this.dispatchNext();
    } else {
      this.scheduleFallbackSlice();
    }
  }

  private requeueInFlight(): void {
    if (this.inFlight.size === 0) return;
    for (const job of this.inFlight.values()) {
      this.queue.unshift(job);
    }
    this.inFlight.clear();
    this.queue.sort((a, b) => a.priority - b.priority || a.id - b.id);
  }

  private dispatchNext(): void {
    if (this.disposed || !this.useWorkers) return;

    for (let i = 0; i < this.workers.length; i++) {
      const slot = this.workers[i];
      if (!slot.busy && this.queue.length > 0) {
        const next = this.queue.shift()!;
        slot.busy = true;
        this.inFlight.set(next.id, next);
        slot.worker.postMessage({ id: next.id, job: next.job });
      }
    }

    if (this.queue.length === 0 && this.inFlight.size === 0) {
      this.teardownWorkers();
    }
  }

  private scheduleFallbackSlice(): void {
    if (this.disposed || this.fallbackTimer !== null || this.queue.length === 0) return;
    this.fallbackTimer = window.setTimeout(() => {
      this.fallbackTimer = null;
      if (this.disposed || this.queue.length === 0) return;
      const next = this.queue.shift()!;
      const result = runTextureJob(next.job);
      this.completed.push({ result, onReady: next.onReady });
      if (this.queue.length > 0) {
        this.scheduleFallbackSlice();
      }
    }, 32);
  }

  /**
   * Uploads at most one completed high-resolution texture set per animation frame so
   * texImage2D + mipmap generation stays invisible to frame pacing on low-end GPUs.
   */
  public flushOneUpload(): boolean {
    if (this.disposed || this.completed.length === 0) return false;
    const item = this.completed.shift()!;
    item.onReady(item.result);
    return true;
  }

  private teardownWorkers(): void {
    for (let i = 0; i < this.workers.length; i++) {
      this.workers[i].worker.terminate();
    }
    this.workers.length = 0;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.teardownWorkers();
    this.queue.length = 0;
    this.inFlight.clear();
    this.completed.length = 0;
  }
}
