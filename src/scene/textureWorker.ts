import { collectTransferables, runTextureJob, TextureJob } from './textureGenerators';

interface WorkerRequest {
  id: number;
  job: TextureJob;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, job } = event.data;
  const result = runTextureJob(job);
  const transferables = collectTransferables(result);
  (self as unknown as Worker).postMessage({ id, result }, transferables);
};
