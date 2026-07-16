import express from 'express';
import { downloadMovie, getDownloads, listMovies, playMovie, cancelMovieDownload, deleteMovie, streamMovie } from '../controllers/movieController.js';

const router = express.Router();

router.post('/download', downloadMovie);
router.get('/progress', getDownloads);
router.get('/', listMovies);
router.get('/play', playMovie);
router.post('/cancel-download', cancelMovieDownload);
router.delete('/:fileName', deleteMovie);
router.get('/stream/:fileName', streamMovie);

export default router;
