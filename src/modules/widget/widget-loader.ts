/**
 * The embeddable widget loader. An org drops a single tag on their site:
 *
 *   <script src="https://YOUR-API/v1/widget/loader.js"
 *           data-stack62-token="s62w_..."></script>
 *
 * The script derives the API base from its own src, renders a floating chat
 * bubble + panel, and talks to the public /widget endpoints. Self-contained:
 * no dependencies, no build step, scoped class names.
 */
export function widgetLoaderScript(): string {
  return String.raw`(function () {
  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName('script');
    script = all[all.length - 1];
  }
  var token = script.getAttribute('data-stack62-token');
  if (!token) { console.error('[Stack62] missing data-stack62-token'); return; }
  // API base = everything up to and including the API prefix in the script src.
  var src = script.src;
  var apiBase = src.replace(/\/widget\/loader\.js.*$/, '');
  var accent = script.getAttribute('data-accent') || '#4f46e5';
  var title = script.getAttribute('data-title') || 'Ask us anything';

  var history = [];
  var open = false;

  var style = document.createElement('style');
  style.textContent = [
    '.s62-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:' + accent + ';color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000;font-size:24px;border:none}',
    '.s62-panel{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:-apple-system,Segoe UI,Roboto,sans-serif}',
    '.s62-panel.s62-open{display:flex}',
    '.s62-head{background:' + accent + ';color:#fff;padding:14px 16px;font-weight:600;font-size:15px}',
    '.s62-msgs{flex:1;overflow-y:auto;padding:14px;background:#f7f7f9}',
    '.s62-msg{margin:8px 0;padding:10px 12px;border-radius:12px;font-size:14px;line-height:1.45;max-width:85%;white-space:pre-wrap;word-wrap:break-word}',
    '.s62-user{background:' + accent + ';color:#fff;margin-left:auto;border-bottom-right-radius:4px}',
    '.s62-bot{background:#fff;color:#1a1a1a;border:1px solid #e6e6ea;border-bottom-left-radius:4px}',
    '.s62-foot{display:flex;border-top:1px solid #ececed;padding:8px}',
    '.s62-input{flex:1;border:none;outline:none;padding:10px;font-size:14px;background:transparent}',
    '.s62-send{background:' + accent + ';color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer;font-size:14px}',
    '.s62-typing{color:#999;font-size:13px;padding:4px 14px}'
  ].join('');
  document.head.appendChild(style);

  var bubble = document.createElement('button');
  bubble.className = 's62-bubble';
  bubble.innerHTML = '&#128172;';
  bubble.setAttribute('aria-label', 'Open chat');
  document.body.appendChild(bubble);

  var panel = document.createElement('div');
  panel.className = 's62-panel';
  panel.innerHTML =
    '<div class="s62-head">' + escapeHtml(title) + '</div>' +
    '<div class="s62-msgs" id="s62-msgs"></div>' +
    '<div class="s62-typing" id="s62-typing" style="display:none">Typing…</div>' +
    '<div class="s62-foot"><input class="s62-input" id="s62-input" placeholder="Type your question…"/><button class="s62-send" id="s62-send">Send</button></div>';
  document.body.appendChild(panel);

  var msgsEl = panel.querySelector('#s62-msgs');
  var inputEl = panel.querySelector('#s62-input');
  var sendEl = panel.querySelector('#s62-send');
  var typingEl = panel.querySelector('#s62-typing');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 's62-msg ' + (role === 'user' ? 's62-user' : 's62-bot');
    d.textContent = text;
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function toggle() {
    open = !open;
    panel.classList.toggle('s62-open', open);
    if (open && history.length === 0) greet();
    if (open) inputEl.focus();
  }
  function greet() {
    fetch(apiBase + '/widget/config', { headers: { 'x-widget-token': token } })
      .then(function (r) { return r.json(); })
      .then(function (cfg) { addMsg('bot', cfg.greeting || 'Hi! How can I help you today?'); })
      .catch(function () { addMsg('bot', 'Hi! How can I help you today?'); });
  }
  function send() {
    var q = (inputEl.value || '').trim();
    if (!q) return;
    inputEl.value = '';
    addMsg('user', q);
    history.push({ role: 'user', content: q });
    typingEl.style.display = 'block';
    fetch(apiBase + '/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-widget-token': token },
      body: JSON.stringify({ message: q, history: history.slice(0, -1) })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        typingEl.style.display = 'none';
        var reply = data && data.reply ? data.reply : 'Sorry, something went wrong.';
        addMsg('bot', reply);
        history.push({ role: 'assistant', content: reply });
      })
      .catch(function () {
        typingEl.style.display = 'none';
        addMsg('bot', 'Sorry, I could not reach the server.');
      });
  }

  bubble.addEventListener('click', toggle);
  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
})();`;
}
