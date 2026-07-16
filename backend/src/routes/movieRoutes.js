import express from 'express';
import { downloadMovie, getDownloads, listMovies, playMovie, cancelMovieDownload, deleteMovie, streamMovie, uploadSubtitles } from '../controllers/movieController.js';

const router = express.Router();

router.post('/download', downloadMovie);
router.get('/progress', getDownloads);
router.get('/', listMovies);
router.get('/play', playMovie);
router.post('/cancel-download', cancelMovieDownload);
router.delete('/:fileName', deleteMovie);
router.get('/stream/:fileName', streamMovie);
router.post('/subtitles', uploadSubtitles);

export default router;
