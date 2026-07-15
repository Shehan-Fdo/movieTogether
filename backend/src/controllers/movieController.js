import { b2Service } from '../services/b2Service.js';
import { startDownload, activeDownloads, cancelDownload } from '../services/downloadService.js';
import { b2Config } from '../config/b2.js';

export async function downloadMovie(req, res) {
  console.log('--- downloadMovie request received ---');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body type:', typeof req.body);
  console.log('Body:', req.body);
  try {
    let url = req.body?.url;
    let customName = req.body?.customName;

    // Fallback 1: Query parameters
    if (!url && req.query.url) {
      url = decodeURIComponent(req.query.url);
      customName = req.query.customName ? decodeURIComponent(req.query.customName) : '';
      console.log('Resolved url from query parameters:', url);
    }

    // Fallback 2: Custom headers
    if (!url && req.headers['x-download-url']) {
      url = decodeURIComponent(req.headers['x-download-url']);
      customName = req.headers['x-custom-name'] ? decodeURIComponent(req.headers['x-custom-name']) : '';
      console.log('Resolved url from custom headers:', url);
    }

    if (!url) {
      return res.status(400).json({ 
        error: 'Missing download URL',
        debug: {
          method: req.method,
          headers: req.headers,
          bodyType: typeof req.body,
          bodyRaw: req.body,
          bodyKeys: req.body ? Object.keys(req.body) : []
        }
      });
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
    const files = await b2Service.listFiles();
    // Keep only completed video uploads and map properties
    const movies = files
      .filter(f => f.action === 'upload')
      .map(f => ({
        fileName: f.fileName,
        size: f.contentLength,
        uploadedAt: new Date(f.uploadTimestamp).toISOString()
      }));
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

    const { downloadUrl } = await b2Service.authorize();
    const token = await b2Service.getDownloadAuthorization(fileName);
    
    // Encode parts of filename path properly
    const encodedFileName = fileName.split('/').map(encodeURIComponent).join('/');
    const playUrl = `${downloadUrl}/file/${b2Config.bucketName}/${encodedFileName}?Authorization=${token}`;
    
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

    await b2Service.deleteFileByName(fileName);
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete movie failed:', error);
    return res.status(500).json({ error: error.message });
  }
}
