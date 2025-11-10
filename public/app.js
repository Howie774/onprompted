const ideaEl = document.getElementById('idea');
const beginBtn = document.getElementById('begin');
const chat = document.getElementById('chat');
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

// --- Clarification flow state ---
let pendingGoal = null;           // original idea
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
        .map((q, i) => `<li>${escapeHtml(q)}</li>`)
        .join('');

      loading.innerHTML = `
        I have a few quick questions to make this perfect:
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