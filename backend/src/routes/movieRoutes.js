import express from 'express';
import { downloadMovie, getDownloads, listMovies, playMovie } from '../controllers/movieController.js';

const router = express.Router();

router.post('/download', downloadMovie);
router.get('/progress', getDownloads);
router.get('/', listMovies);
router.get('/play', playMovie);

export default router;
