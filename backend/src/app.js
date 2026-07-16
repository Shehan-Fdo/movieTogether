import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import movieRoutes from './routes/movieRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());

// Custom body parser to capture stream data directly before any framework consumption
app.use((req, res, next) => {
  let data = '';
  req.on('data', chunk => {
    data += chunk;
  });
  req.on('end', () => {
    req.rawBody = data;
    if (data) {
      try {
        req.body = JSON.parse(data);
      } catch (e) {
        // Fallback for non-JSON
      }
    }
    next();
  });
});

// API Routes
app.use('/api/movies', movieRoutes);

// Serve Static Frontend files
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// Fallback all other routes to index.html
app.get('*any', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

export default app;
