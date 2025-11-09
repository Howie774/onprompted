// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve your front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

// Example dynamic API (proves it's NOT static)
app.post('/api/echo', (req, res) => {
  const { text } = req.body || {};
  res.json({ ok: true, received: text || null, ts: Date.now() });
});

// Health check for Render
app.get('/healthz', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OnPrompted server listening on http://localhost:${PORT}`);
});