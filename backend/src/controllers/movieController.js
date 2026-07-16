import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startDownload, activeDownloads, cancelDownload } from '../services/downloadService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moviesDir = path.resolve(path.join(__dirname, '../../data/movies'));

export async function downloadMovie(req, res) {
  console.log('--- downloadMovie request received ---');
  try {
    let url = req.body?.url;
    let customName = req.body?.customName;

    // Fallback 1: Query parameters
    if (!url && req.query.url) {
      url = decodeURIComponent(req.query.url);
      customName = req.query.customName ? decodeURIComponent(req.query.customName) : '';
    }

    // Fallback 2: Custom headers
    if (!url && req.headers['x-download-url']) {
      url = decodeURIComponent(req.headers['x-download-url']);
      customName = req.headers['x-custom-name'] ? decodeURIComponent(req.headers['x-custom-name']) : '';
    }

    if (!url) {
      return res.status(400).json({ error: 'Missing download URL' });
    }

    const taskId = await startDownload(url, customName);
    return res.status(202).json({ success: true, taskId });
  } catch (error) {
    console.error('Download initiation failed:', error);
    return res.status(500).json({ error: error.message });
  }
}

export function getDownloads(req, res) {
  const downloads = Array.from(activeDownloads.values());
  return res.json(downloads);
}

export async function listMovies(req, res) {
  try {
    if (!fs.existsSync(moviesDir)) {
      return res.json([]);
    }

    const files = await fs.promises.readdir(moviesDir);
    const movies = [];

    for (const file of files) {
      if (file === '.gitkeep') continue;

      const filePath = path.join(moviesDir, file);
      const stats = await fs.promises.stat(filePath);
      
      if (stats.isFile()) {
        movies.push({
          fileName: file,
          size: stats.size,
          uploadedAt: stats.mtime.toISOString()
        });
      }
    }

    // Sort by upload date descending
    movies.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    return res.json(movies);
  } catch (error) {
    console.error('List movies failed:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function playMovie(req, res) {
  try {
    const { fileName } = req.query;
    if (!fileName) {
      return res.status(400).json({ error: 'Missing fileName parameter' });
    }

    const filePath = path.resolve(path.join(moviesDir, fileName));
    if (!filePath.startsWith(moviesDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Movie file not found' });
    }

    // Return the local streaming endpoint URL
    const playUrl = `/api/movies/stream/${encodeURIComponent(fileName)}`;
    return res.json({ playUrl });
  } catch (error) {
    console.error('Get play URL failed:', error);
    return res.status(500).json({ error: error.message });
  }
}

export function cancelMovieDownload(req, res) {
  const { taskId } = req.body;
  if (!taskId) {
    return res.status(400).json({ error: 'Missing taskId parameter' });
  }
  const success = cancelDownload(taskId);
  return res.json({ success });
}

export async function deleteMovie(req, res) {
  try {
    const { fileName } = req.params;
    if (!fileName) {
      return res.status(400).json({ error: 'Missing fileName parameter' });
    }

    const filePath = path.resolve(path.join(moviesDir, fileName));
    if (!filePath.startsWith(moviesDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return res.json({ success: true });
    } else {
      return res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Delete movie failed:', error);
    return res.status(500).json({ error: error.message });
  }
}

export function streamMovie(req, res) {
  try {
    const { fileName } = req.params;
    if (!fileName) {
      return res.status(400).json({ error: 'Missing fileName parameter' });
    }

    const filePath = path.resolve(path.join(moviesDir, fileName));
    if (!filePath.startsWith(moviesDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // res.sendFile handles Range requests natively
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Streaming file failed:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
}
