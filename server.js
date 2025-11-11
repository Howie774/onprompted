// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import Stripe from 'stripe';
import promptEngineRouter from './promptEngineRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
 * Firebase Admin Init
 * ======================= */

function initFirebaseAdmin() {
  // Prefer explicit service-account style config from env
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  if (projectId && clientEmail && privateKey) {
    console.log('[INIT] Initializing Firebase Admin with explicit credentials.');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    console.warn(
      '[INIT] FIREBASE_* env vars not fully set. Falling back to applicationDefault(). ' +
      'This requires GOOGLE_APPLICATION_CREDENTIALS or runtime metadata. ' +
      'If you see "Unable to detect a Project Id" errors, set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.'
    );
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  console.log('[INIT] Firebase Admin initialized.');
}

if (!admin.apps.length) {
  initFirebaseAdmin();
}

const db = admin.firestore();

/* =========================
 * Stripe Init
 * ======================= */

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[INIT] STRIPE_SECRET_KEY is not set. Stripe calls will fail.');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});
console.log('[INIT] Stripe initialized.');

/* =========================
 * Express app
 * ======================= */

const app = express();
app.use(cors());

// JSON/body parsing for all routes EXCEPT the Stripe webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe-webhook') return next();
  return express.json()(req, res, next);
});

app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe-webhook') return next();
  return express.urlencoded({ extended: true })(req, res, next);
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
 * Stripe Webhook
 * ======================= */

app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log('[WEBHOOK] Event received:', event.type);
    } catch (err) {
      console.error('[WEBHOOK] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log('[WEBHOOK] checkout.session.completed:', session.id);

        const firebaseUid =
          session.client_reference_id || session.metadata?.firebaseUid;
        if (firebaseUid && session.customer) {
          await db
            .collection('users')
            .doc(firebaseUid)
            .set(
              {
                stripeCustomerId: session.customer,
                stripeSubscriptionId: session.subscription || null,
              },
              { merge: true }
            );
          console.log('[WEBHOOK] Linked customer to user:', firebaseUid);
        } else {
          console.warn('[WEBHOOK] Missing firebaseUid or customer on session.completed');
        }
      }

      if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated'
      ) {
        const subscription = event.data.object;
        const priceId = subscription.items.data[0]?.price?.id;
        const customerId = subscription.customer;

        console.log('[WEBHOOK]', event.type, 'subscription:', subscription.id);

        let plan = 'free';
        let quota = 10;

        if (priceId === process.env.STRIPE_PRICE_STARTER) {
          plan = 'starter';
          quota = 50;
        } else if (priceId === process.env.STRIPE_PRICE_PRO) {
          plan = 'pro';
          quota = 500;
        } else if (priceId === process.env.STRIPE_PRICE_AGENCY) {
          plan = 'agency';
          quota = 5000;
        }

        const customer = await stripe.customers.retrieve(customerId);
        const firebaseUid = customer.metadata?.firebaseUid;

        if (firebaseUid) {
          await db
            .collection('users')
            .doc(firebaseUid)
            .set(
              {
                plan,
                quota,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscription.id,
                periodStart: subscription.current_period_start,
                usedInputs: 0,
              },
              { merge: true }
            );
          console.log('[WEBHOOK] Updated plan for user:', firebaseUid, '->', plan);
        } else {
          console.warn('[WEBHOOK] No firebaseUid on customer metadata for subscription event');
        }
      }

      if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        console.log('[WEBHOOK] subscription.deleted:', subscription.id);

        const customer = await stripe.customers.retrieve(customerId);
        const firebaseUid = customer.metadata?.firebaseUid;

        if (firebaseUid) {
          await db
            .collection('users')
            .doc(firebaseUid)
            .set(
              {
                plan: 'free',
                quota: 10,
                stripeSubscriptionId: null,
              },
              { merge: true }
            );
          console.log('[WEBHOOK] Reset plan to free for user:', firebaseUid);
        } else {
          console.warn('[WEBHOOK] No firebaseUid on customer metadata for deletion event');
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[WEBHOOK] Error handling event:', err);
      res.status(500).send('Webhook handler error');
    }
  }
);

/* =========================
 * Auth middleware
 * ======================= */

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
      console.log('[AUTH] Verified ID token for UID:', decoded.uid);
    } catch (err) {
      console.warn('[AUTH] ID token verification failed:', err.message);
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

// All /api routes get Firebase user (if present)
app.use('/api', attachFirebaseUser);

function requireAuth(req, res, next) {
  if (!req.user || !req.user.uid) {
    console.warn('[AUTH] requireAuth failed. No user on request.');
    return res
      .status(401)
      .json({ error: 'auth_required', message: 'Authentication required' });
  }
  next();
}

/* =========================
 * Billing / Stripe Checkout
 * ======================= */

const PLAN_PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  agency: process.env.STRIPE_PRICE_AGENCY,
};

console.log('[INIT] PLAN_PRICE_MAP:', PLAN_PRICE_MAP);

app.post(
  '/api/billing/create-checkout-session',
  requireAuth,
  async (req, res) => {
    try {
      console.log('[CHECKOUT][API] Incoming body:', req.body);
      console.log('[CHECKOUT][API] Auth user:', req.user);

      const { plan } = req.body || {};
      const priceId = PLAN_PRICE_MAP[plan];

      if (!priceId) {
        console.warn('[CHECKOUT][API] invalid_plan for:', plan);
        return res
          .status(400)
          .json({ error: 'invalid_plan', message: 'Unknown plan on server' });
      }

      const firebaseUid = req.user.uid;
      const email = req.user.email || undefined;
      const baseUrl =
        process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;

      console.log('[CHECKOUT][API] Using priceId:', priceId);
      console.log('[CHECKOUT][API] firebaseUid:', firebaseUid);
      console.log('[CHECKOUT][API] baseUrl:', baseUrl);

      const userRef = db.collection('users').doc(firebaseUid);
      const userSnap = await userRef.get();
      let stripeCustomerId = userSnap.exists
        ? userSnap.data().stripeCustomerId
        : null;

      let customer;

      if (stripeCustomerId) {
        console.log('[CHECKOUT][API] Existing Stripe customer:', stripeCustomerId);
        customer = await stripe.customers.retrieve(stripeCustomerId);
      } else {
        console.log('[CHECKOUT][API] Creating new Stripe customer for:', email);
        customer = await stripe.customers.create({
          email,
          metadata: { firebaseUid },
        });
        stripeCustomerId = customer.id;
        await userRef.set(
          { stripeCustomerId },
          { merge: true }
        );
        console.log('[CHECKOUT][API] Created Stripe customer:', stripeCustomerId);
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/?billing=success`,
        cancel_url: `${baseUrl}/?billing=cancel`,
        client_reference_id: firebaseUid,
      });

      console.log('[CHECKOUT][API] Created checkout session:', session.id);

      return res.json({ url: session.url });
    } catch (err) {
      console.error('[CHECKOUT][API] Error creating checkout session:', err);
      return res.status(500).json({
        error: 'server_error',
        message: String(err),
      });
    }
  }
);

/* =========================
 * Other API routes
 * ======================= */

// Prompt Engineer API
app.use('/api', promptEngineRouter);

// Example echo route
app.post('/api/echo', (req, res) => {
  const { text } = req.body || {};
  res.json({
    ok: true,
    received: text || null,
    ts: Date.now(),
    user: req.user || null,
  });
});

// Health check
app.get('/healthz', (_req, res) => res.send('ok'));

/* =========================
 * Start server
 * ======================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OnPrompted server listening on http://localhost:${PORT}`);
});