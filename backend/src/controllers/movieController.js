import { b2Service } from '../services/b2Service.js';
import { startDownload, activeDownloads } from '../services/downloadService.js';
import { b2Config } from '../config/b2.js';

export async function downloadMovie(req, res) {
  try {
    const { url, customName } = req.body;
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
