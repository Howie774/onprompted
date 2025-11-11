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

// Account sidebar elements
const accountSidebar = document.getElementById('accountSidebar');
const accountSidebarEmail = document.getElementById('accountSidebarEmail');
const accountSidebarPrompts = document.getElementById('accountSidebarPrompts');

// Pricing buttons (legacy IDs, kept)
const freePlanBtn = document.getElementById('freePlanBtn');
const starterPlanBtn = document.getElementById('starterPlanBtn');
const proPlanBtn = document.getElementById('proPlanBtn');
const agencyPlanBtn = document.getElementById('agencyPlanBtn');

let currentUser = null;
let currentIdToken = null; // will be sent to /api/engineer-prompt

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
  return s.replace(/[&<>\"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// --- Auth modal helpers ---
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

// Attach auth modal events
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

// --- Auth helpers ---
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
      const cred = await window.firebaseAuth.createUserWithEmailAndPassword(email, pass);
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
      const cred = await window.firebaseAuth.signInWithEmailAndPassword(email, pass);
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
      const result = await window.firebaseAuth.signInWithPopup(window.firebaseGoogleProvider);
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

// --- Prompt history save/load ---
async function savePromptToHistory({ goal, clarificationAnswers = null, finalPrompt }) {
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
  if (!accountSidebar || !accountSidebarPrompts || !accountSidebarEmail) return;
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

  accountSidebar.style.display = docs.length ? 'flex' : 'flex';
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
      if (accountSidebar) accountSidebar.style.display = 'flex'; // still show account info
      return;
    }

    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    docs.reverse(); // oldest first

    // Append history into chat (memory)
    docs.forEach((item) => {
      if (item.goal) {
        addBubble(`<strong>You (past):</strong> ${escapeHtml(item.goal)}`, 'user');
      }
      if (item.finalPrompt) {
        addBubble(
          `<div><strong>Optimized Prompt (saved):</strong></div>
           <pre class="prompt-block">${escapeHtml(item.finalPrompt || '')}</pre>`,
          'ai'
        );
      }
    });

    // Render sidebar summary
    renderSidebarHistory(docs);
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

// --- Track auth & ID token ---
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
      console.log('[AUTH] ID token fetched on state change, length:', currentIdToken?.length || 0);
    } catch (e) {
      console.error('[AUTH] Error getting ID token:', e);
      currentIdToken = null;
    }

    await loadPromptHistory();
  } else {
    if (userEmailEl) {
      userEmailEl.textContent = '';
      userEmailEl.style.display = 'none';
    }
    if (loginOpenBtn) loginOpenBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';

    currentIdToken = null;
    if (accountSidebar) accountSidebar.style.display = 'none';

    console.log('[AUTH] No user logged in');
  }
});

// Keep ID token fresh
window.firebaseAuth.onIdTokenChanged(async (user) => {
  if (!user) {
    console.log('[AUTH] onIdTokenChanged: no user');
    currentIdToken = null;
    return;
  }
  try {
    currentIdToken = await user.getIdToken();
    console.log('[AUTH] ID token refreshed, length:', currentIdToken?.length || 0);
  } catch (e) {
    console.error('[AUTH] Error refreshing ID token:', e);
    currentIdToken = null;
  }
});

// --- Clarification flow state ---
let pendingGoal = null;             // original idea
let awaitingClarifications = false; // if true, next submit = send answers

function setAnswerMode(on) {
  awaitingClarifications = on;
  beginBtn.textContent = on ? 'Answer & Generate' : 'Begin';
  if (on) {
    ideaEl.placeholder = 'Type your answers to the questions above…';
  } else {
    ideaEl.placeholder = 'Describe what you want…';
  }
}

// Initial state
setAnswerMode(false);

// Main click handler
beginBtn.addEventListener('click', async () => {
  const text = ideaEl.value.trim();
  if (!text) {
    addBubble('Please type something first 🙂');
    ideaEl.focus();
    return;
  }

  // If we're answering clarifying questions:
  if (awaitingClarifications) {
    const clarificationAnswers = text;

    addBubble(`<strong>You:</strong> ${escapeHtml(clarificationAnswers)}`, 'user');

    const loading = addBubble('Got it. Crafting your optimized prompt…', 'ai');

    try {
      const res = await fetch('/api/engineer-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(currentIdToken ? { 'Authorization': `Bearer ${currentIdToken}` } : {})
        },
        body: JSON.stringify({
          goal: pendingGoal,
          clarificationAnswers,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[PROMPT] API error (final):', res.status, err);
        loading.innerHTML = 'Something went wrong generating your prompt. Please try again.';
        return;
      }

      const data = await res.json();

      if (data.status !== 'ready' || !data.final_prompt) {
        console.error('[PROMPT] Unexpected response (final):', data);
        loading.innerHTML = 'Unexpected response. Please try again.';
        return;
      }

      loading.innerHTML = `
        <div><strong>Optimized Prompt:</strong></div>
        <pre class="prompt-block">${escapeHtml(data.final_prompt)}</pre>
      `;

      savePromptToHistory({
        goal: pendingGoal,
        clarificationAnswers,
        finalPrompt: data.final_prompt,
      });

      pendingGoal = null;
      setAnswerMode(false);
      ideaEl.value = '';
    } catch (e) {
      console.error('[PROMPT] Network error (final):', e);
      loading.innerHTML = 'Network error while generating your prompt.';
    }

    return;
  }

  // Otherwise: first phase — send initial goal
  const goal = text;
  pendingGoal = goal;

  addBubble(`<strong>You:</strong> ${escapeHtml(goal)}`, 'user');

  const loading = addBubble('Thinking through what I need to ask…', 'ai');

  try {
    const res = await fetch('/api/engineer-prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentIdToken ? { 'Authorization': `Bearer ${currentIdToken}` } : {})
      },
      body: JSON.stringify({ goal }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[PROMPT] API error (phase 1):', res.status, err);
      loading.innerHTML = 'Something went wrong. Please try again.';
      return;
    }

    const data = await res.json();

    if (data.status === 'needs_clarification' && Array.isArray(data.questions) && data.questions.length) {
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
        <pre class="prompt-block">${escapeHtml(data.final_prompt)}</pre>
      `;

      savePromptToHistory({
        goal,
        finalPrompt: data.final_prompt,
      });

      pendingGoal = null;
      setAnswerMode(false);
      ideaEl.value = '';
      return;
    }

    console.error('[PROMPT] Unexpected response (phase 1):', data);
    loading.innerHTML = 'Unexpected response. Please try again.';
  } catch (e) {
    console.error('[PROMPT] Network error (phase 1):', e);
    loading.innerHTML = 'Network error talking to the prompt engine.';
  }
});

// Copy latest optimized prompt to clipboard
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      const lastPromptBlock = chat.querySelector('.prompt-block:last-of-type');

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
        alert('No prompt to copy yet. Generate one first.');
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

// --- Stripe Checkout helpers (pricing buttons) ---
async function startCheckout(plan) {
  console.log('[CHECKOUT] startCheckout called with:', {
    plan,
    hasUser: !!currentUser,
    userUid: currentUser?.uid,
    hasToken: !!currentIdToken,
  });

  if (!currentUser || !currentIdToken) {
    console.warn('[CHECKOUT] Missing user or token, opening auth modal.');
    openAuthModal();
    return;
  }

  try {
    const res = await fetch('/api/billing/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentIdToken}`,
      },
      body: JSON.stringify({ plan }),
    });

    const responseText = await res.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (e) {
      console.error('[CHECKOUT] Failed to parse JSON response:', responseText);
      data = { raw: responseText };
    }

    console.log('[CHECKOUT] Response status:', res.status, 'body:', data);

    if (!res.ok) {
      const msg =
        data.message ||
        data.error ||
        `Checkout failed with status ${res.status}`;
      showError(`Could not start checkout: ${msg}`);
      return;
    }

    if (data.url) {
      console.log('[CHECKOUT] Redirecting to Stripe URL:', data.url);
      window.location.href = data.url;
    } else {
      console.error('[CHECKOUT] Missing URL in successful response:', data);
      showError('Checkout URL missing. Please try again.');
    }
  } catch (err) {
    console.error('[CHECKOUT] Network error starting checkout:', err);
    showError('Network error starting checkout.');
  }
}

// Legacy ID-based handlers (kept; safe if elements don't exist)
if (freePlanBtn) {
  freePlanBtn.addEventListener('click', () => {
    if (!currentUser) {
      console.log('[CHECKOUT] Free plan click, no user -> auth modal');
      openAuthModal();
      return;
    }
    alert('You are on the free plan. 10 prompt inputs / month included.');
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

// NEW: Attach upgrade flow to .plan-upgrade-btn buttons in pricing section
const planUpgradeButtons = document.querySelectorAll('.plan-upgrade-btn');
planUpgradeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const plan = btn.dataset.plan;
    console.log('[CHECKOUT] Upgrade button clicked:', plan);
    if (!plan) return;

    if (!currentUser || !currentIdToken) {
      console.warn('[CHECKOUT] No user/token on upgrade click -> auth modal');
      openAuthModal();
      return;
    }

    startCheckout(plan);
  });
});

// Optional: echo test (still fine; now includes token if present)
(async function pingEcho() {
  try {
    const res = await fetch('/api/echo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentIdToken ? { 'Authorization': `Bearer ${currentIdToken}` } : {})
      },
      body: JSON.stringify({ text: 'hello from browser' }),
    });
    const data = await res.json().catch(() => ({}));
    console.log('[ECHO] Response:', data);
  } catch (e) {
    console.log('[ECHO] failed', e);
  }
})();