import { b2Service } from './b2Service.js';
import { Readable } from 'stream';
import crypto from 'crypto';

export const activeDownloads = new Map();
const activeControllers = new Map();

function cleanupDownloadHistory() {
  const maxHistory = 10;
  const history = Array.from(activeDownloads.values())
    .filter(d => d.status === 'completed' || d.status === 'failed')
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  
  while (history.length > maxHistory) {
    const oldest = history.shift();
    if (oldest) {
      activeDownloads.delete(oldest.id);
    }
  }
}

export async function startDownload(url, customName = '') {
  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    url,
    filename: customName || 'Detecting...',
    status: 'connecting',
    bytesTotal: 0,
    bytesTransferred: 0,
    progress: 0,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null
  };

  const controller = new AbortController();
  activeControllers.set(taskId, controller);

  activeDownloads.set(taskId, task);

  runDownloadTask(taskId).catch(err => {
    console.error(`Task ${taskId} uncaught error:`, err);
  });

  return taskId;
}

async function runDownloadTask(taskId) {
  const task = activeDownloads.get(taskId);
  if (!task) return;
  let fileId = null;

  try {
    const controller = activeControllers.get(taskId);
    const response = await fetch(task.url, { signal: controller?.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch remote URL: ${response.statusText} (${response.status})`);
    }

    const headers = response.headers;
    const bytesTotal = parseInt(headers.get('content-length') || '0', 10);
    task.bytesTotal = bytesTotal;

    const resolvedName = getFilenameFromHeadersOrUrl(task.url, headers);
    task.filename = resolvedName;
    task.status = 'downloading';

    await b2Service.authorize();
    fileId = await b2Service.startLargeFile(resolvedName);
    console.log(`B2 Large File started. fileId: ${fileId}`);

    const partSize = 20 * 1024 * 1024; // 20 MB
    let buffers = [];
    let accumulatedLength = 0;
    let partNumber = 1;
    const parts = [];

    const stream = Readable.fromWeb(response.body);

    const uploadPromises = [];
    const maxConcurrentUploads = 3;
    let uploadError = null;

    const abortPromise = controller ? new Promise((_, reject) => {
      if (controller.signal.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }
      controller.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }) : null;

    for await (const chunk of stream) {
      if (uploadError) {
        throw uploadError;
      }

      buffers.push(chunk);
      accumulatedLength += chunk.length;

      task.bytesTransferred += chunk.length;
      if (bytesTotal > 0) {
        task.progress = Math.round((task.bytesTransferred / bytesTotal) * 100);
      } else {
        task.progress = 0;
      }

      if (accumulatedLength >= partSize) {
        const partBuffer = Buffer.concat(buffers, accumulatedLength);
        buffers = [];
        accumulatedLength = 0;

        const currentPart = partNumber;
        partNumber++;

        // Apply backpressure if we exceed max concurrent uploads
        while (uploadPromises.filter(p => !p.resolved).length >= maxConcurrentUploads) {
          if (uploadError) throw uploadError;
          if (controller && controller.signal.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          task.status = 'uploading (backpressure)';
          console.log(`Backpressure triggered. Waiting for active B2 uploads to drain...`);
          
          const activePromises = uploadPromises.filter(p => !p.resolved).map(p => p.promise);
          if (abortPromise) {
            activePromises.push(abortPromise);
          }
          await Promise.race(activePromises);
        }

        task.status = 'downloading';
        console.log(`Starting background upload for Part ${currentPart}...`);
        
        const uploadObj = { resolved: false };
        const promise = (async () => {
          try {
            const { uploadUrl, authorizationToken } = await b2Service.getUploadPartUrl(fileId);
            const result = await b2Service.uploadPart(uploadUrl, authorizationToken, currentPart, partBuffer);
            parts.push(result);
          } catch (err) {
            uploadError = err;
          } finally {
            uploadObj.resolved = true;
          }
        })();
        uploadObj.promise = promise;
        uploadPromises.push(uploadObj);
      }
    }

    if (accumulatedLength > 0) {
      if (uploadError) throw uploadError;
      const partBuffer = Buffer.concat(buffers, accumulatedLength);
      const currentPart = partNumber;
      
      console.log(`Starting background upload for Final Part ${currentPart}...`);
      const uploadObj = { resolved: false };
      const promise = (async () => {
        try {
          const { uploadUrl, authorizationToken } = await b2Service.getUploadPartUrl(fileId);
          const result = await b2Service.uploadPart(uploadUrl, authorizationToken, currentPart, partBuffer);
          parts.push(result);
        } catch (err) {
          uploadError = err;
        } finally {
          uploadObj.resolved = true;
        }
      })();
      uploadObj.promise = promise;
      uploadPromises.push(uploadObj);
    }

    if (uploadPromises.length > 0) {
      task.status = 'uploading remaining parts';
      console.log('Waiting for all background B2 uploads to finish...');
      
      const allUploads = Promise.all(uploadPromises.map(p => p.promise));
      if (abortPromise) {
        await Promise.race([allUploads, abortPromise]);
      } else {
        await allUploads;
      }
    }

    if (uploadError) {
      throw uploadError;
    }

    console.log('Finishing B2 Large File...');
    const partSha1s = parts.sort((a, b) => a.partNumber - b.partNumber).map(p => p.contentSha1);
    await b2Service.finishLargeFile(fileId, partSha1s);

    task.status = 'completed';
    task.progress = 100;
    task.completedAt = new Date().toISOString();
    console.log(`Task ${taskId} completed successfully!`);

  } catch (error) {
    console.error(`Task ${taskId} failed:`, error);
    if (error.name === 'AbortError') {
      task.status = 'cancelled';
      task.error = 'Cancelled by user';
    } else {
      task.status = 'failed';
      task.error = error.message;
    }
    task.completedAt = new Date().toISOString();

    if (fileId) {
      console.log(`Cancelling B2 Large File: ${fileId}...`);
      try {
        await b2Service.cancelLargeFile(fileId);
      } catch (cancelErr) {
        console.error('Error cancelling B2 large file:', cancelErr);
      }
    }
  } finally {
    activeControllers.delete(taskId);
    cleanupDownloadHistory();
  }
}

function getFilenameFromHeadersOrUrl(url, headers) {
  const contentDisposition = headers.get('content-disposition');
  if (contentDisposition) {
    const match = contentDisposition.match(/filename\*?=["']?([^"';]+)["']?/i);
    if (match && match[1]) {
      let filename = match[1];
      if (filename.startsWith("UTF-8''")) {
        filename = filename.slice(7);
      }
      return decodeURIComponent(filename);
    }
  }
  
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      return decodeURIComponent(lastPart);
    }
  } catch (e) {
    // ignore
  }
  return 'movie.mp4';
}

export function cancelDownload(taskId) {
  const controller = activeControllers.get(taskId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}
