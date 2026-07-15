import express from 'express';
import { downloadMovie, getDownloads, listMovies, playMovie, cancelMovieDownload } from '../controllers/movieController.js';

const router = express.Router();

router.post('/download', downloadMovie);
router.get('/progress', getDownloads);
router.get('/', listMovies);
router.get('/play', playMovie);
router.post('/cancel-download', cancelMovieDownload);

export default router;
