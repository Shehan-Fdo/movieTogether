import express from 'express';
import { downloadMovie, getDownloads, listMovies, playMovie, cancelMovieDownload, deleteMovie } from '../controllers/movieController.js';

const router = express.Router();

router.post('/download', downloadMovie);
router.get('/progress', getDownloads);
router.get('/', listMovies);
router.get('/play', playMovie);
router.post('/cancel-download', cancelMovieDownload);
router.delete('/:fileName', deleteMovie);

export default router;
