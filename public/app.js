const ideaEl = document.getElementById('idea');
const beginBtn = document.getElementById('begin');
const chat = document.getElementById('chat');
document.getElementById('year').textContent = new Date().getFullYear();

document.getElementById('chips').addEventListener('click', (e)=>{
  const ex = e.target.closest('.chip')?.dataset.example;
  if(!ex) return;
  ideaEl.value = ex; ideaEl.focus();
});

function addBubble(html, who='ai'){
  const b = document.createElement('div');
  b.className = `bubble ${who}`;
  b.innerHTML = html;
  chat.appendChild(b);
  chat.scrollTop = chat.scrollHeight;
}

beginBtn.addEventListener('click', ()=>{
  const idea = ideaEl.value.trim();
  if(!idea){ addBubble('Please paste your idea first 🙂'); ideaEl.focus(); return; }
  addBubble(`<strong>You:</strong> ${escapeHtml(idea)}`, 'user');
  // Front-end only: no backend, just a friendly placeholder
  addBubble("Nice. I’ll figure out the domain automatically and ask just a couple smart follow-ups when we wire the backend. For now, this is a visual demo.");
});

ideaEl.addEventListener('keydown', (e)=>{
  if((e.metaKey || e.ctrlKey) && e.key === 'Enter') beginBtn.click();
});

function escapeHtml(s){
  return s.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// public/app.js (add at bottom)
async function pingEcho() {
  const res = await fetch('/api/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hello from browser' })
  });
  console.log('echo:', await res.json());
}
pingEcho();