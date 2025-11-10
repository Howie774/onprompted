// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import promptEngineRouter from './promptEngineRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
// Make sure your environment is configured for applicationDefault()
// or swap this for a service account JSON if needed.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

// Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Attach Firebase user from ID token (for all /api routes)
async function attachFirebaseUser(req, _res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const idToken = header.slice('Bearer '.length).trim();
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.user = {
        uid: decoded.uid,
        email: decoded.email || null,
      };
    } catch (err) {
      console.log('ID token verification failed:', err.message);
      // Treat as unauthenticated if token invalid
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

// Serve your front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

// All /api routes get Firebase user (if present)
app.use('/api', attachFirebaseUser);

// 🔹 Mount Prompt Engineer API under /api
// This gives you: POST /api/engineer-prompt
app.use('/api', promptEngineRouter);

// Example dynamic API (still fine) — now also has req.user if token sent
app.post('/api/echo', (req, res) => {
  const { text } = req.body || {};
  res.json({
    ok: true,
    received: text || null,
    ts: Date.now(),
    user: req.user || null,
  });
});

// Health check for Render
app.get('/healthz', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OnPrompted server listening on http://localhost:${PORT}`);
});