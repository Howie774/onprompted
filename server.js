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

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[STRIPE] Missing STRIPE_SECRET_KEY env var');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Express app
const app = express();
app.use(cors());

// Use JSON/body parsing for all routes EXCEPT the Stripe webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe-webhook') {
    return next();
  }
  return express.json()(req, res, next);
});

app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe-webhook') {
    return next();
  }
  return express.urlencoded({ extended: true })(req, res, next);
});

// Serve your front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

/* ========== STRIPE WEBHOOK ========== */

app.post(
  '/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error('[WEBHOOK] Missing STRIPE_WEBHOOK_SECRET env var');
      return res.status(500).send('Webhook not configured');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[WEBHOOK] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('[WEBHOOK] Event received:', event.type);

    try {
      // 1) Link checkout.session to user (customer id + subscription id)
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

          console.log(
            `[WEBHOOK] Linked checkout session to user: ${firebaseUid}`
          );
        } else {
          console.warn(
            '[WEBHOOK] checkout.session.completed missing firebaseUid or customer',
            {
              firebaseUid,
              customer: session.customer,
            }
          );
        }
      }

      // 2) Create / update subscription → set plan + limits
      if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated'
      ) {
        const subscription = event.data.object;
        console.log(
          `[WEBHOOK] ${event.type} subscription:`,
          subscription.id
        );

        const priceId = subscription.items.data[0]?.price?.id;
        const customerId = subscription.customer;

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

        // Look up Firebase UID from Stripe Customer metadata
        const customer = await stripe.customers.retrieve(customerId);
        const firebaseUid = customer.metadata?.firebaseUid;

        if (!firebaseUid) {
          console.warn(
            '[WEBHOOK] Subscription event without firebaseUid on customer metadata',
            { customerId }
          );
        } else {
          const updateData = {
            plan,
            quota,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            usedInputs: 0,
          };

          // Guard against undefined (the previous bug)
          if (subscription.current_period_start) {
            // Store as seconds or ms; here keep raw seconds for simplicity
            updateData.periodStart = subscription.current_period_start;
          }

          await db
            .collection('users')
            .doc(firebaseUid)
            .set(updateData, { merge: true });

          console.log(
            `[WEBHOOK] Updated user ${firebaseUid} -> plan=${plan}, quota=${quota}`
          );
        }
      }

      // 3) Downgrade on cancel
      if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        console.log(
          '[WEBHOOK] customer.subscription.deleted:',
          subscription.id
        );
        const customerId = subscription.customer;

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

          console.log(
            `[WEBHOOK] Downgraded user ${firebaseUid} to free plan`
          );
        } else {
          console.warn(
            '[WEBHOOK] subscription.deleted without firebaseUid metadata',
            { customerId }
          );
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[WEBHOOK] Error handling event:', err);
      res.status(500).send('Webhook handler error');
    }
  }
);

/* ========== AUTH MIDDLEWARE ========== */

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
      console.log('[AUTH] ID token verification failed:', err.message);
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

// All /api routes get Firebase user (if present)
app.use('/api', attachFirebaseUser);

// Require auth helper for billing routes
function requireAuth(req, res, next) {
  if (!req.user || !req.user.uid) {
    console.log('[AUTH] requireAuth failed. No user on request.');
    return res.status(401).json({ error: 'auth_required' });
  }
  next();
}

/* ========== BILLING API ========== */

const PLAN_PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  agency: process.env.STRIPE_PRICE_AGENCY,
};

app.post(
  '/api/billing/create-checkout-session',
  requireAuth,
  async (req, res) => {
    try {
      const { plan } = req.body || {};
      console.log('[CHECKOUT][API] Incoming body:', req.body);
      console.log('[CHECKOUT][API] Auth user:', req.user);

      const priceId = PLAN_PRICE_MAP[plan];
      console.log('[CHECKOUT][API] Using priceId:', priceId);

      if (!priceId) {
        return res.status(400).json({ error: 'invalid_plan' });
      }

      const firebaseUid = req.user.uid;
      const email = req.user.email || undefined;
      const baseUrl =
        process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;

      console.log('[CHECKOUT][API] firebaseUid:', firebaseUid);
      console.log('[CHECKOUT][API] baseUrl:', baseUrl);

      const userRef = db.collection('users').doc(firebaseUid);
      const userSnap = await userRef.get();
      let stripeCustomerId = userSnap.exists
        ? userSnap.data().stripeCustomerId
        : null;

      let customer;

      if (stripeCustomerId) {
        console.log(
          '[CHECKOUT][API] Existing Stripe customer:',
          stripeCustomerId
        );
        customer = await stripe.customers.retrieve(stripeCustomerId);
      } else {
        console.log(
          '[CHECKOUT][API] Creating new Stripe customer for:',
          email
        );
        customer = await stripe.customers.create({
          email,
          metadata: { firebaseUid },
        });
        stripeCustomerId = customer.id;
        await userRef.set({ stripeCustomerId }, { merge: true });
        console.log(
          '[CHECKOUT][API] Created Stripe customer:',
          stripeCustomerId
        );
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/?billing=success`,
        cancel_url: `${baseUrl}/?billing=cancel`,
        client_reference_id: firebaseUid,
      });

      console.log(
        '[CHECKOUT][API] Created checkout session:',
        session.id
      );

      return res.json({ url: session.url });
    } catch (err) {
      console.error('[CHECKOUT][API] Error creating checkout session:', err);
      return res.status(500).json({ error: 'server_error' });
    }
  }
);

/* ========== PROMPT ENGINE API ========== */

app.use('/api', promptEngineRouter);

/* ========== ECHO / HEALTH ========== */

app.post('/api/echo', (req, res) => {
  const { text } = req.body || {};
  res.json({
    ok: true,
    received: text || null,
    ts: Date.now(),
    user: req.user || null,
  });
});

app.get('/healthz', (_req, res) => res.send('ok'));

/* ========== SERVER START ========== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OnPrompted server listening on http://localhost:${PORT}`);
});