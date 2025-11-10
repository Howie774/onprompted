const ideaEl = document.getElementById('idea');
const beginBtn = document.getElementById('begin');
const chat = document.getElementById('chat');
const copyBtn = document.getElementById('copyPrompt');

// Auth elements (added)
const loginOpenBtn = document.getElementById('loginOpenBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authModal = document.getElementById('authModal');
const authCloseBtn = document.getElementById('authCloseBtn');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authLoginBtn = document.getElementById('authLoginBtn');
const authSignupBtn = document.getElementById('authSignupBtn');
const userEmailEl = document.getElementById('userEmail');

let currentUser = null;

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

// --- Auth modal helpers (added) ---
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

// --- Attach auth modal events (added) ---
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

// --- Auth helpers (added) ---
function showError(message) {
  alert(message);
}

// Create account (added)
if (authSignupBtn) {
  authSignupBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const pass = authPassword.value.trim();
    if (!email || !pass) return showError('Enter email and password.');

    try {
      const cred = await window.firebaseAuth.createUserWithEmailAndPassword(email, pass);
      console.log('Signed up:', cred.user.uid);
      closeAuthModal();
    } catch (err) {
      console.error(err);
      showError(err.message || 'Could not create account.');
    }
  });
}

// Login (added)
if (authLoginBtn) {
  authLoginBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const pass = authPassword.value.trim();
    if (!email || !pass) return showError('Enter email and password.');

    try {
      const cred = await window.firebaseAuth.signInWithEmailAndPassword(email, pass);
      console.log('Logged in:', cred.user.uid);
      closeAuthModal();
    } catch (err) {
      console.error(err);
      showError(err.message || 'Could not sign in.');
    }
  });
}

// Logout (added)
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await window.firebaseAuth.signOut();
    } catch (err) {
      console.error(err);
      showError('Could not log out.');
    }
  });
}

// --- Prompt history save/load (added) ---
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
    if (snap.empty) return;

    const docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    docs.reverse(); // oldest first

    docs.forEach((item) => {
      if (item.goal) {
        addBubble(`<strong>You (past):</strong> ${escapeHtml(item.goal)}`, 'user');
      }
      addBubble(
        `<div><strong>Optimized Prompt (saved):</strong></div>
         <pre class="prompt-block">${escapeHtml(item.finalPrompt || '')}</pre>`,
        'ai'
      );
    });
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

// --- Auth state listener (added) ---
window.firebaseAuth.onAuthStateChanged(async (user) => {
  currentUser = user || null;

  if (currentUser) {
    if (userEmailEl) {
      userEmailEl.textContent = currentUser.email || '';
      userEmailEl.style.display = 'inline';
    }
    if (loginOpenBtn) loginOpenBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';

    await loadPromptHistory();
  } else {
    if (userEmailEl) {
      userEmailEl.textContent = '';
      userEmailEl.style.display = 'none';
    }
    if (loginOpenBtn) loginOpenBtn.style.display = 'inline-block';
    if (logoutBtn) logoutBtn.style.display = 'none';

    console.log('No user logged in');
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

    // Show user answer bubble
    addBubble(`<strong>You:</strong> ${escapeHtml(clarificationAnswers)}`, 'user');

    // Show loading bubble
    const loading = addBubble('Got it. Crafting your optimized prompt…', 'ai');

    try {
      const res = await fetch('/api/engineer-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: pendingGoal,
          clarificationAnswers,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Prompt API error (final):', err);
        loading.innerHTML = 'Something went wrong generating your prompt. Please try again.';
        return;
      }

      const data = await res.json();

      if (data.status !== 'ready' || !data.final_prompt) {
        loading.innerHTML = 'Unexpected response. Please try again.';
        return;
      }

      loading.innerHTML = `
        <div><strong>Optimized Prompt:</strong></div>
        <pre class="prompt-block">${escapeHtml(data.final_prompt)}</pre>
      `;

      // Save to history if logged in (added)
      savePromptToHistory({
        goal: pendingGoal,
        clarificationAnswers,
        finalPrompt: data.final_prompt,
      });

      // Reset flow
      pendingGoal = null;
      setAnswerMode(false);
      ideaEl.value = '';
    } catch (e) {
      console.error(e);
      loading.innerHTML = 'Network error while generating your prompt.';
    }

    return;
  }

  // Otherwise: first phase — send initial goal
  const goal = text;
  pendingGoal = goal;

  // Show user bubble
  addBubble(`<strong>You:</strong> ${escapeHtml(goal)}`, 'user');

  // Show loading
  const loading = addBubble('Thinking through what I need to ask…', 'ai');

  try {
    const res = await fetch('/api/engineer-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Prompt API error (phase 1):', err);
      loading.innerHTML = 'Something went wrong. Please try again.';
      return;
    }

    const data = await res.json();

    // If clarifications are needed
    if (data.status === 'needs_clarification' && Array.isArray(data.questions) && data.questions.length) {
      const qsHtml = data.questions
        .map((q) => `<li>${escapeHtml(q)}</li>`)
        .join('');

      loading.innerHTML = `
        <div class="clarify-label">I have a few quick questions to make this perfect:</div>
        <ul class="notes">${qsHtml}</ul>
        <div class="notes-label">Answer above, then hit “Answer & Generate”.</div>
      `;

      // Enter answer mode
      ideaEl.value = '';
      setAnswerMode(true);
      ideaEl.focus();
      return;
    }

    // Otherwise, we already have the final optimized prompt
    if (data.status === 'ready' && data.final_prompt) {
      loading.innerHTML = `
        <div><strong>Optimized Prompt:</strong></div>
        <pre class="prompt-block">${escapeHtml(data.final_prompt)}</pre>
      `;

      // Save to history if logged in (added)
      savePromptToHistory({
        goal,
        finalPrompt: data.final_prompt,
      });

      pendingGoal = null;
      setAnswerMode(false);
      ideaEl.value = '';
      return;
    }

    loading.innerHTML = 'Unexpected response. Please try again.';
  } catch (e) {
    console.error(e);
    loading.innerHTML = 'Network error talking to the prompt engine.';
  }
});

// Copy latest optimized prompt to clipboard
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      // Prefer the last explicit optimized prompt block
      const lastPromptBlock = chat.querySelector('.prompt-block:last-of-type');

      let textToCopy = '';
      if (lastPromptBlock) {
        textToCopy = lastPromptBlock.textContent.trim();
      } else {
        // Fallback: last AI bubble
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
      console.error('Clipboard error:', err);
      alert('Could not copy. Please copy manually.');
    }
  });
}

// Optional: echo test (kept for sanity)
(async function pingEcho() {
  try {
    const res = await fetch('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello from browser' }),
    });
    console.log('echo:', await res.json());
  } catch (e) {
    console.log('echo failed', e);
  }
})();