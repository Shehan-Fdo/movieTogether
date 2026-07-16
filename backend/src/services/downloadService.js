import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moviesDir = path.join(__dirname, '../../data/movies');

// Ensure movies directory exists
if (!fs.existsSync(moviesDir)) {
  fs.mkdirSync(moviesDir, { recursive: true });
}

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
  let filePath = null;
  let writeStream = null;

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

    filePath = path.join(moviesDir, resolvedName);
    writeStream = fs.createWriteStream(filePath);

    const stream = Readable.fromWeb(response.body);

    for await (const chunk of stream) {
      if (controller?.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const canWrite = writeStream.write(chunk);
      if (!canWrite) {
        await new Promise(resolve => writeStream.once('drain', resolve));
      }

      task.bytesTransferred += chunk.length;
      if (bytesTotal > 0) {
        task.progress = Math.round((task.bytesTransferred / bytesTotal) * 100);
      } else {
        task.progress = 0;
      }
    }

    await new Promise((resolve, reject) => {
      writeStream.end(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    task.status = 'completed';
    task.progress = 100;
    task.completedAt = new Date().toISOString();
    console.log(`Task ${taskId} completed successfully!`);

  } catch (error) {
    console.error(`Task ${taskId} failed:`, error);
    if (writeStream) {
      writeStream.destroy();
    }
    
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error('Error deleting partial file:', unlinkErr);
      }
    }

    if (error.name === 'AbortError') {
      task.status = 'cancelled';
      task.error = 'Cancelled by user';
    } else {
      task.status = 'failed';
      task.error = error.message;
    }
    task.completedAt = new Date().toISOString();
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
