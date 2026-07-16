import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listMovies, playMovie, deleteMovie, uploadSubtitles } from '../src/controllers/movieController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moviesDir = path.resolve(path.join(__dirname, '../data/movies'));

test('Movie controller local filesystem operations', async (t) => {
  // Ensure directory exists
  if (!fs.existsSync(moviesDir)) {
    fs.mkdirSync(moviesDir, { recursive: true });
  }
  const testFileName = `test-movie-${Date.now()}.mp4`;
  const testFilePath = path.join(moviesDir, testFileName);
  fs.writeFileSync(testFilePath, 'dummy video content');

  await t.test('listMovies returns test movie', async () => {
    let responseData = null;
    const req = {};
    const res = {
      json: (data) => {
        responseData = data;
        return res;
      },
      status: (code) => {
        return res;
      }
    };

    await listMovies(req, res);
    assert.ok(Array.isArray(responseData));
    const testMovie = responseData.find(m => m.fileName === testFileName);
    assert.ok(testMovie);
    assert.strictEqual(testMovie.size, 19);
  });

  await t.test('playMovie returns correct stream url', async () => {
    let responseData = null;
    const req = {
      query: { fileName: testFileName }
    };
    const res = {
      json: (data) => {
        responseData = data;
        return res;
      },
      status: (code) => {
        return res;
      }
    };

    await playMovie(req, res);
    assert.ok(responseData);
    assert.strictEqual(responseData.playUrl, `/api/movies/stream/${encodeURIComponent(testFileName)}`);
  });

  await t.test('uploadSubtitles converts SRT to VTT and saves', async () => {
    let responseData = null;
    const srtText = `1\n00:01:20,000 --> 00:01:23,000\nHello World\n`;
    const req = {
      body: {
        fileName: testFileName,
        subtitleText: srtText,
        originalExtension: '.srt'
      }
    };
    const res = {
      json: (data) => {
        responseData = data;
        return res;
      },
      status: (code) => {
        return res;
      }
    };

    await uploadSubtitles(req, res);
    assert.ok(responseData);
    assert.strictEqual(responseData.success, true);
    
    const subPath = path.join(moviesDir, `${path.basename(testFileName, path.extname(testFileName))}.vtt`);
    assert.ok(fs.existsSync(subPath));
    const savedContent = fs.readFileSync(subPath, 'utf8');
    assert.ok(savedContent.startsWith('WEBVTT'));
    assert.ok(savedContent.includes('00:01:20.000 --> 00:01:23.000'));
    
    fs.unlinkSync(subPath);
  });

  await t.test('deleteMovie unlinks the file', async () => {
    let responseData = null;
    const req = {
      params: { fileName: testFileName }
    };
    const res = {
      json: (data) => {
        responseData = data;
        return res;
      },
      status: (code) => {
        return res;
      }
    };

    await deleteMovie(req, res);
    assert.ok(responseData);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(fs.existsSync(testFilePath), false);
  });

  // Cleanup safety
  if (fs.existsSync(testFilePath)) {
    fs.unlinkSync(testFilePath);
  }
});
