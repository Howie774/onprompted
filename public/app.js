const ideaEl = document.getElementById('idea');
const beginBtn = document.getElementById('begin');
const chat = document.getElementById('chat');
const copyBtn = document.getElementById('copyPrompt');

// Auth elements
const loginOpenBtn = document.getElementById('loginOpenBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authModal = document.getElementById('authModal');
const authCloseBtn = document.getElementById('authCloseBtn');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authLoginBtn = document.getElementById('authLoginBtn');
const authSignupBtn = document.getElementById('authSignupBtn');
const authGoogleBtn = document.getElementById('authGoogleBtn');
const userEmailEl = document.getElementById('userEmail');
const userPlanLabel = document.getElementById('userPlanLabel');

// Account sidebar elements
const accountSidebar = document.getElementById('accountSidebar');
const accountSidebarEmail = document.getElementById('accountSidebarEmail');
const accountSidebarPrompts = document.getElementById('accountSidebarPrompts');
const accountSidebarPlan = document.getElementById('accountSidebarPlan');
const accountSidebarUsage = document.getElementById('accountSidebarUsage');

// Pricing buttons (legacy IDs, kept)
const freePlanBtn = document.getElementById('freePlanBtn');
const starterPlanBtn = document.getElementById('starterPlanBtn');
const proPlanBtn = document.getElementById('proPlanBtn');
const agencyPlanBtn = document.getElementById('agencyPlanBtn');

let currentUser = null;
let currentIdToken = null; // sent to /api routes

document.getElementById('year').textContent = new Date().getFullYear();

document.getElementById('chips').addEventListener('click', (e) => {
  const ex = e.target.closest('.chip')?.dataset.example;
  if (!ex) return;
  ideaEl.value = ex;
  ideaEl.focus();
});

function addBubble(html, who = 'ai') {
  const b = document.createElement('div');
  b.className = `bubble ${who}`;
  b.innerHTML = html;
  chat.appendChild(b);
  chat.scrollTop = chat.scrollHeight;
  return b;
}

function escapeHtml(s) {
  return s.replace(/[&<>\"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ========== Shared API Error Handling for Prompt Engine ========== */

function handlePromptApiError(status, err, loadingEl) {
  const code = err?.code;
  const msg = err?.message;

  // Not signed in -> open auth modal + clear message
  if (status === 401 || code === 'AUTH_REQUIRED') {
    loadingEl.innerHTML =
      'Create a free account to get started. Sign in to generate optimized prompts.';
    openAuthModal();
    return true;
  }

  // Plan limit reached -> show upgrade message from backend
  if (status === 402 || code === 'LIMIT_REACHED') {
    const safeMsg =
      msg ||
      'You have reached your current plan limit. Upgrade your plan to continue using OnPrompted.';
    loadingEl.innerHTML = escapeHtml(safeMsg);
    return true;
  }

  // Fallback generic
  loadingEl.innerHTML =
    'Something went wrong generating your prompt. Please try again.';
  return true;
}

/* ========== Plan / Usage UI Helpers ========== */

const CLIENT_PLAN_LIMITS = {
  free: 10,
  starter: 50,
  pro: 500,
  agency: 5000,
};

function formatPlanName(plan) {
  if (!plan) return 'Free';
  const p = String(plan).toLowerCase();
  if (p === 'starter') return 'Starter';
  if (p === 'pro') return 'Pro';
  if (p === 'agency') return 'Agency';
  return 'Free';
}

function hidePlanUi() {
  if (userPlanLabel) {
    userPlanLabel.style.display = 'none';
    userPlanLabel.textContent = '';
  }
  if (accountSidebarPlan) accountSidebarPlan.textContent = '';
  if (accountSidebarUsage) accountSidebarUsage.textContent = '';
}

function applyPlanUi({ plan, used, limit }) {
  const safeLimit =
    typeof limit === 'number' && limit > 0
      ? limit
      : CLIENT_PLAN_LIMITS[plan] || CLIENT_PLAN_LIMITS.free;
  const safeUsed = typeof used === 'number' && used >= 0 ? used : 0;
  const remaining = Math.max(safeLimit - safeUsed, 0);

  const nicePlan = formatPlanName(plan);
  const headerLabel = `${nicePlan} • ${remaining} left`;
  const sidebarPlanText = `${nicePlan} plan`;
  const sidebarUsageText = `${remaining}/${safeLimit} inputs left`;

  if (userPlanLabel) {
    userPlanLabel.textContent = headerLabel;
    userPlanLabel.style.display = 'inline-flex';
  }
  if (accountSidebarPlan) {
    accountSidebarPlan.textContent = sidebarPlanText;
  }
  if (accountSidebarUsage) {
    accountSidebarUsage.textContent = sidebarUsageText;
  }
}

async function fetchAndRenderUserPlan(uid) {
  if (!uid || !window.firebaseDb) {
    hidePlanUi();
    return;
  }

  try {
    const snap = await window.firebaseDb.collection('users').doc(uid).get();
    if (!snap.exists) {
      applyPlanUi({
        plan: 'free',
        used: 0,
        limit: CLIENT_PLAN_LIMITS.free,
      });
      return;
    }

    const data = snap.data() || {};
    const plan = data.plan || 'free';

    const used =
      typeof data.usage === 'number'
        ? data.usage
        : typeof data.usedInputs === 'number'
        ? data.usedInputs
        : 0;

    const limit =
      (typeof data.limit === 'number' && data.limit > 0 && data.limit) ||
      (typeof data.quota === 'number' && data.quota > 0 && data.quota) ||
      CLIENT_PLAN_LIMITS[plan] ||
      CLIENT_PLAN_LIMITS.free;

    applyPlanUi({ plan, used, limit });
  } catch (err) {
    console.error('[ACCOUNT] Failed to load plan/usage:', err);
  }
}

/* ========== Auth modal helpers ========== */

function openAuthModal() {
  if (!authModal) return;
  authModal.style.display = 'flex';
  if (authEmail) authEmail.value = '';
  if (authPassword) authPassword.value = '';
  if (authEmail) authEmail.focus();
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.style.display = 'none';
}

if (loginOpenBtn) {
  loginOpenBtn.addEventListener('click', openAuthModal);
}
if (authCloseBtn) {
  authCloseBtn.addEventListener('click', closeAuthModal);
}
if (authModal) {
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });
}

/* ========== Auth helpers ========== */

function showError(message) {
  alert(message);
}

// Email/password signup
if (authSignupBtn) {
  authSignupBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const pass = authPassword.value.trim();
    if (!email || !pass) return showError('Enter email and password.');

    try {
      const cred =
        await window.firebaseAuth.createUserWithEmailAndPassword(email, pass);
      console.log('[AUTH] Signed up:', cred.user.uid);
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] Signup error:', err);
      showError(err.message || 'Could not create account.');
    }
  });
}

// Email/password login
if (authLoginBtn) {
  authLoginBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const pass = authPassword.value.trim();
    if (!email || !pass) return showError('Enter email and password.');

    try {
      const cred =
        await window.firebaseAuth.signInWithEmailAndPassword(email, pass);
      console.log('[AUTH] Logged in:', cred.user.uid);
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] Login error:', err);
      showError(err.message || 'Could not sign in.');
    }
  });
}

// Google login
if (authGoogleBtn) {
  authGoogleBtn.addEventListener('click', async () => {
    try {
      const result = await window.firebaseAuth.signInWithPopup(
        window.firebaseGoogleProvider
      );
      console.log('[AUTH] Google sign-in success:', result.user?.uid);
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] Google sign-in failed:', err);
      showError(err.message || 'Google sign-in failed.');
    }
  });
}

// Logout
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await window.firebaseAuth.signOut();
      console.log('[AUTH] Logged out');
    } catch (err) {
      console.error('[AUTH] Logout error:', err);
      showError('Could not log out.');
    }
  });
}

/* ========== Prompt history save/load ========== */

async function savePromptToHistory({
  goal,
  clarificationAnswers = null,
  finalPrompt,
}) {
  try {
    if (!currentUser || !window.firebaseDb) return;

    const ref = window.firebaseDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('prompts');

    await ref.add({
      goal: goal || null,
      clarificationAnswers: clarificationAnswers || null,
      finalPrompt,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Error saving prompt history:', err);
  }
}

function renderSidebarHistory(docs) {
  if (
    !accountSidebar ||
    !accountSidebarPrompts ||
    !accountSidebarEmail
  )
    return;
  if (!currentUser) {
    accountSidebar.style.display = 'none';
    return;
  }

  accountSidebarEmail.textContent = currentUser.email || '';
  accountSidebarPrompts.innerHTML = '';

  docs.slice(-6).forEach((item) => {
    if (!item.finalPrompt) return;
    const li = document.createElement('li');
    const preview = item.goal || item.finalPrompt;
    li.textContent = preview.trim().slice(0, 220);
    accountSidebarPrompts.appendChild(li);
  });

  accountSidebar.style.display = 'flex';
}

async function loadPromptHistory() {
  if (!currentUser || !window.firebaseDb) return;
  try {
    const ref = window.firebaseDb
      .collection('users')
      .doc(currentUser.uid)
      .collection('prompts')
      .orderBy('createdAt', 'desc')
      .limit(10);

    const snap = await ref.get();
    if (snap.empty) {
      if (accountSidebar) accountSidebar.style.display = 'flex';
      return;
    }

    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    docs.reverse(); // oldest first

    docs.forEach((item) => {
      if (item.goal) {
        addBubble(
          `<strong>You (past):</strong> ${escapeHtml(item.goal)}`,
          'user'
        );
      }
      if (item.finalPrompt) {
        addBubble(
          `<div><strong>Optimized Prompt (saved):</strong></div>
           <pre class="prompt-block">${escapeHtml(
             item.finalPrompt || ''
           )}</pre>`,
          'ai'
        );
      }
    });

    renderSidebarHistory(docs);
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

/* ========== Track auth & ID token ========== */

window.firebaseAuth.onAuthStateChanged(async (user) => {
  currentUser = user || null;

  if (currentUser) {
    if (userEmailEl) {
      userEmailEl.textContent = currentUser.email || '';
      userEmailEl.style.display = 'inline';
    }
    if (loginOpenBtn) loginOpenBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';

    try {
      currentIdToken = await currentUser.getIdToken();
      console.log(
        '[AUTH] ID token fetched on state change, length:',
        currentIdToken?.length || 0
      );
    } catch (e) {
      console.error('[AUTH] Error getting ID token:', e);
      currentIdToken = null;
    }

    await loadPromptHistory();
    await fetchAndRenderUserPlan(currentUser.uid);
  } else {
    if (userEmailEl) {
      userEmailEl.textContent = '';
      userEmailEl.style.display = 'none';
    }
    if (loginOpenBtn) loginOpenBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';

    currentIdToken = null;
    hidePlanUi();
    if (accountSidebar) accountSidebar.style.display = 'none';

    console.log('[AUTH] No user logged in');
  }
});

// Keep ID token fresh
window.firebaseAuth.onIdTokenChanged(async (user) => {
  if (!user) {
    console.log('[AUTH] onIdTokenChanged: no user');
    currentIdToken = null;
    hidePlanUi();
    return;
  }
  try {
    currentIdToken = await user.getIdToken();
    console.log(
      '[AUTH] ID token refreshed, length:',
      currentIdToken?.length || 0
    );
  } catch (e) {
    console.error('[AUTH] Error refreshing ID token:', e);
    currentIdToken = null;
  }
});

/* ========== Clarification flow ========== */

let pendingGoal = null;
let awaitingClarifications = false;

function setAnswerMode(on) {
  awaitingClarifications = on;
  beginBtn.textContent = on ? 'Answer & Generate' : 'Begin';
  if (on) {
    ideaEl.placeholder = 'Type your answers to the questions above…';
  } else {
    ideaEl.placeholder =
      "Paste your messy prompt or idea. Example: ‘Write a launch email for my new SaaS that helps students track deadlines.’";
  }
}

// Initial state
setAnswerMode(false);

beginBtn.addEventListener('click', async () => {
  const text = ideaEl.value.trim();
  if (!text) {
    addBubble('Please type something first 🙂');
    ideaEl.focus();
    return;
  }

  // Answering clarifications
  if (awaitingClarifications) {
    const clarificationAnswers = text;

    addBubble(
      `<strong>You:</strong> ${escapeHtml(clarificationAnswers)}`,
      'user'
    );

    const loading = addBubble(
      'Got it. Crafting your optimized prompt…',
      'ai'
    );

    try {
      const res = await fetch('/api/engineer-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(currentIdToken
            ? { Authorization: `Bearer ${currentIdToken}` }
            : {}),
        },
        body: JSON.stringify({
          goal: pendingGoal,
          clarificationAnswers,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[PROMPT] API error (final):', res.status, err);
        handlePromptApiError(res.status, err, loading);
        return;
      }

      const data = await res.json();

      if (data.status !== 'ready' || !data.final_prompt) {
        console.error('[PROMPT] Unexpected response (final):', data);
        loading.innerHTML =
          'Unexpected response. Please try again.';
        return;
      }

      loading.innerHTML = `
        <div><strong>Optimized Prompt:</strong></div>
        <pre class="prompt-block">${escapeHtml(
          data.final_prompt
        )}</pre>
      `;

      savePromptToHistory({
        goal: pendingGoal,
        clarificationAnswers,
        finalPrompt: data.final_prompt,
      });

      if (currentUser) {
        fetchAndRenderUserPlan(currentUser.uid);
      }

      pendingGoal = null;
      setAnswerMode(false);
      ideaEl.value = '';
    } catch (e) {
      console.error('[PROMPT] Network error (final):', e);
      loading.innerHTML =
        'Network error while generating your prompt.';
    }

    return;
  }

  // First phase — send initial goal
  const goal = text;
  pendingGoal = goal;

  addBubble(`<strong>You:</strong> ${escapeHtml(goal)}`, 'user');

  const loading = addBubble(
    'Thinking through what I need to ask…',
    'ai'
  );

  try {
    const res = await fetch('/api/engineer-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentIdToken
          ? { Authorization: `Bearer ${currentIdToken}` }
          : {}),
      },
      body: JSON.stringify({ goal }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(
        '[PROMPT] API error (phase 1):',
        res.status,
        err
      );
      handlePromptApiError(res.status, err, loading);
      return;
    }

    const data = await res.json();

    if (
      data.status === 'needs_clarification' &&
      Array.isArray(data.questions) &&
      data.questions.length
    ) {
      const qsHtml = data.questions
        .map((q) => `<li>${escapeHtml(q)}</li>`)
        .join('');

      loading.innerHTML = `
        <div class="clarify-label">I have a few quick questions to make this perfect:</div>
        <ul class="notes">${qsHtml}</ul>
        <div class="notes-label">Answer above, then hit “Answer & Generate”.</div>
      `;

      ideaEl.value = '';
      setAnswerMode(true);
      ideaEl.focus();
      return;
    }

    if (data.status === 'ready' && data.final_prompt) {
      loading.innerHTML = `
        <div><strong>Optimized Prompt:</strong></div>
        <pre class="prompt-block">${escapeHtml(
          data.final_prompt
        )}</pre>
      `;

      savePromptToHistory({
        goal,
        finalPrompt: data.final_prompt,
      });

      if (currentUser) {
        fetchAndRenderUserPlan(currentUser.uid);
      }

      pendingGoal = null;
      setAnswerMode(false);
      ideaEl.value = '';
      return;
    }

    console.error('[PROMPT] Unexpected response (phase 1):', data);
    loading.innerHTML = 'Unexpected response. Please try again.';
  } catch (e) {
    console.error('[PROMPT] Network error (phase 1):', e);
    loading.innerHTML =
      'Network error talking to the prompt engine.';
  }
});

/* ========== Copy prompt button ========== */

if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      const lastPromptBlock = chat.querySelector(
        '.prompt-block:last-of-type'
      );

      let textToCopy = '';
      if (lastPromptBlock) {
        textToCopy = lastPromptBlock.textContent.trim();
      } else {
        const aiBubbles = chat.querySelectorAll('.bubble.ai');
        const lastAi = aiBubbles[aiBubbles.length - 1];
        if (lastAi) {
          textToCopy = lastAi.textContent.trim();
        }
      }

      if (!textToCopy) {
        alert(
          'No prompt to copy yet. Generate one first.'
        );
        return;
      }

      await navigator.clipboard.writeText(textToCopy);
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy prompt';
      }, 1500);
    } catch (err) {
      console.error('[CLIPBOARD] Error:', err);
      alert('Could not copy. Please copy manually.');
    }
  });
}

/* ========== Stripe Checkout ========== */

async function startCheckout(plan) {
  console.log('[CHECKOUT] startCheckout called with:', {
    plan,
    hasUser: !!currentUser,
    userUid: currentUser?.uid,
    hasToken: !!currentIdToken,
  });

  if (!currentUser || !currentIdToken) {
    console.warn(
      '[CHECKOUT] Missing user or token, opening auth modal.'
    );
    openAuthModal();
    return;
  }

  try {
    const res = await fetch(
      '/api/billing/create-checkout-session',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentIdToken}`,
        },
        body: JSON.stringify({ plan }),
      }
    );

    const responseText = await res.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      console.error(
        '[CHECKOUT] Failed to parse JSON response:',
        responseText
      );
      data = { raw: responseText };
    }

    console.log(
      '[CHECKOUT] Response status:',
      res.status,
      'body:',
      data
    );

    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        `Checkout failed with status ${res.status}`;
      showError(`Could not start checkout: ${msg}`);
      return;
    }

    if (data.url) {
      console.log(
        '[CHECKOUT] Redirecting to Stripe URL:',
        data.url
      );
      window.location.href = data.url;
    } else {
      console.error(
        '[CHECKOUT] Missing URL in successful response:',
        data
      );
      showError('Checkout URL missing. Please try again.');
    }
  } catch (err) {
    console.error(
      '[CHECKOUT] Network error starting checkout:',
      err
    );
    showError('Network error starting checkout.');
  }
}

// Legacy ID-based handlers (if present)
if (freePlanBtn) {
  freePlanBtn.addEventListener('click', () => {
    if (!currentUser) {
      console.log(
        '[CHECKOUT] Free plan click, no user -> auth modal'
      );
      openAuthModal();
      return;
    }
    alert(
      'You are on the free plan. 10 prompt inputs / month included.'
    );
  });
}
if (starterPlanBtn) {
  starterPlanBtn.addEventListener('click', () => {
    startCheckout('starter');
  });
}
if (proPlanBtn) {
  proPlanBtn.addEventListener('click', () => {
    startCheckout('pro');
  });
}
if (agencyPlanBtn) {
  agencyPlanBtn.addEventListener('click', () => {
    startCheckout('agency');
  });
}

// New buttons in pricing grid
const planUpgradeButtons =
  document.querySelectorAll('.plan-upgrade-btn');
planUpgradeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const plan = btn.dataset.plan;
    console.log(
      '[CHECKOUT] Upgrade button clicked:',
      plan
    );
    if (!plan) return;

    if (!currentUser || !currentIdToken) {
      console.warn(
        '[CHECKOUT] No user/token on upgrade click -> auth modal'
      );
      openAuthModal();
      return;
    }

    startCheckout(plan);
  });
});

/* ========== Echo test (optional) ========== */

(async function pingEcho() {
  try {
    const res = await fetch('/api/echo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentIdToken
          ? { Authorization: `Bearer ${currentIdToken}` }
          : {}),
      },
      body: JSON.stringify({ text: 'hello from browser' }),
    });
    const data = await res.json().catch(() => ({}));
    console.log('[ECHO] Response:', data);
  } catch (e) {
    console.log('[ECHO] failed', e);
  }
})();