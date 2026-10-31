export const INDEX_HTML = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>orica-ai chat</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0e1117;
        --panel: #161b22;
        --border: #30363d;
        --text: #e6edf3;
        --muted: #8b949e;
        --user: #1f6feb;
        --ai: #21262d;
        --accent: #3fb950;
        --danger: #f85149;
        --tool: #d29922;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0; padding: 0; height: 100%;
        background: var(--bg); color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
      }
      body { display: flex; flex-direction: column; }
      header {
        padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--panel);
        display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--muted);
      }
      header strong { color: var(--text); font-size: 14px; }
      header .meta { display: flex; gap: 12px; flex-wrap: wrap; }
      header button {
        margin-left: auto; background: transparent; border: 1px solid var(--border);
        color: var(--muted); padding: 4px 10px; border-radius: 4px; font-size: 12px; cursor: pointer;
      }
      header button:hover { color: var(--text); border-color: var(--text); }
      main {
        flex: 1; overflow-y: auto; padding: 16px;
        display: flex; flex-direction: column; gap: 12px;
        position: relative;
      }
      main.dragover::after {
        content: "ドロップして画像を添付";
        position: absolute; inset: 8px; border: 2px dashed var(--accent); border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        color: var(--accent); font-size: 18px; background: rgba(63, 185, 80, 0.06);
        pointer-events: none;
      }
      .msg {
        max-width: 75%; padding: 10px 14px;
        border-radius: 12px; line-height: 1.55;
        white-space: pre-wrap; word-wrap: break-word;
      }
      .msg.user { align-self: flex-end; background: var(--user); color: white; }
      .msg.ai { align-self: flex-start; background: var(--ai); border: 1px solid var(--border); }
      .msg.err { align-self: flex-start; background: transparent; border: 1px solid var(--danger); color: var(--danger); }
      .msg .caret {
        display: inline-block; width: 6px; height: 1em; vertical-align: -2px;
        background: var(--accent); margin-left: 2px; animation: blink 1s steps(2) infinite;
      }
      @keyframes blink { 50% { opacity: 0; } }
      .attached-imgs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
      .attached-imgs img { max-height: 120px; max-width: 200px; border-radius: 6px; border: 1px solid var(--border); }
      .attached-files { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
      .attached-files .file-pill {
        font-size: 12px; padding: 2px 8px;
        background: rgba(255, 255, 255, 0.08); border-radius: 4px;
        align-self: flex-start;
      }
      .tool-line {
        align-self: flex-start; font-size: 12px; color: var(--tool);
        padding: 2px 8px; border: 1px solid var(--tool); border-radius: 4px;
        max-width: 75%; word-wrap: break-word;
      }
      .tool-line.error { color: var(--danger); border-color: var(--danger); }
      .meta-line {
        font-size: 11px; color: var(--muted);
        margin-top: -4px; display: flex; gap: 8px; flex-wrap: wrap;
      }
      .chip { padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; }
      footer {
        border-top: 1px solid var(--border); background: var(--panel); padding: 12px 16px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .preview-bar {
        display: flex; gap: 6px; flex-wrap: wrap;
      }
      .preview-bar:empty { display: none; }
      .thumb {
        position: relative; display: inline-block;
      }
      .thumb img {
        height: 60px; max-width: 120px; border-radius: 4px; border: 1px solid var(--border);
        display: block;
      }
      .thumb .file-chip {
        display: inline-flex; align-items: center; gap: 6px;
        height: 60px; padding: 0 12px;
        border: 1px solid var(--border); border-radius: 4px;
        background: var(--ai); font-size: 12px; max-width: 220px;
      }
      .thumb .file-chip .name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .thumb .file-chip .size { color: var(--muted); }
      .thumb .remove {
        position: absolute; top: -6px; right: -6px;
        width: 18px; height: 18px; border-radius: 50%;
        background: var(--danger); color: white; border: none;
        font-size: 12px; line-height: 18px; padding: 0; cursor: pointer;
      }
      .notice-line {
        align-self: flex-start; font-size: 12px; color: var(--muted);
        padding: 2px 8px; border: 1px dashed var(--muted); border-radius: 4px;
        max-width: 75%;
      }
      .jump-bottom {
        position: absolute; right: 16px; bottom: 16px;
        width: 36px; height: 36px; border-radius: 50%;
        background: var(--panel); color: var(--text);
        border: 1px solid var(--border); cursor: pointer;
        font-size: 18px; line-height: 1; padding: 0;
        display: none; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }
      .jump-bottom.visible { display: flex; }
      .jump-bottom:hover { border-color: var(--accent); color: var(--accent); }
      .input-row { display: flex; gap: 8px; }
      textarea {
        flex: 1; resize: none;
        background: var(--bg); color: var(--text);
        border: 1px solid var(--border); border-radius: 6px;
        padding: 8px 10px; font-size: 14px; font-family: inherit;
        min-height: 44px; max-height: 200px;
      }
      textarea:focus { outline: none; border-color: var(--accent); }
      button.attach, button.send {
        border: 1px solid var(--border); border-radius: 6px;
        padding: 0 14px; cursor: pointer; font-size: 14px;
      }
      button.attach {
        background: var(--bg); color: var(--text);
      }
      button.attach:hover { border-color: var(--accent); color: var(--accent); }
      button.send {
        background: var(--accent); color: #0e1117; border: none; font-weight: 600;
      }
      button.send:disabled { opacity: 0.4; cursor: wait; }
      .empty {
        margin: auto; color: var(--muted); text-align: center;
        font-size: 13px; line-height: 1.6;
      }
      .empty code { background: var(--panel); padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <strong>orica-ai chat</strong>
      <div class="meta" id="meta">connecting…</div>
      <button id="clear">Clear</button>
    </header>
    <main id="log">
      <div class="empty">
        CLAUDE.md / .claude/memory / skills が自動注入される対話 GUI (SSE ストリーミング)。<br />
        Enter で送信 / Shift+Enter で改行。<br />
        📎 / 貼り付け / ドラッグ&amp;ドロップでファイル添付 (画像→vision モデル、テキスト系→プロンプト埋め込み、その他→スキップ通知)。
      </div>
      <button id="jump-bottom" class="jump-bottom" title="最新メッセージへ">↓</button>
    </main>
    <footer>
      <div class="preview-bar" id="previews"></div>
      <div class="input-row">
        <button id="attach" class="attach" title="ファイルを添付 (画像 / テキスト系)">📎</button>
        <input type="file" id="file" multiple hidden />
        <textarea id="input" placeholder="メッセージを入力 (Enter で送信 / Shift+Enter で改行)" autofocus></textarea>
        <button id="send" class="send">Send</button>
      </div>
    </footer>
    <script>
      const log = document.getElementById('log');
      const input = document.getElementById('input');
      const send = document.getElementById('send');
      const meta = document.getElementById('meta');
      const clearBtn = document.getElementById('clear');
      const attachBtn = document.getElementById('attach');
      const fileInput = document.getElementById('file');
      const previews = document.getElementById('previews');
      let history = [];
      let pending = false;
      /** @type {Array<{ name: string, mimeType: string, base64: string, isImage: boolean, size: number, dataUrl?: string }>} */
      let attached = [];

      // stick-to-bottom: ユーザーが上にスクロールしたら自動追従を停止する
      let stickToBottom = true;
      const STICK_THRESHOLD_PX = 48;
      const jumpBottomBtn = document.getElementById('jump-bottom');
      function isAtBottom() {
        return (log.scrollHeight - log.scrollTop - log.clientHeight) <= STICK_THRESHOLD_PX;
      }
      function updateJumpButton() {
        if (!jumpBottomBtn) return;
        if (stickToBottom) jumpBottomBtn.classList.remove('visible');
        else jumpBottomBtn.classList.add('visible');
      }
      log.addEventListener('scroll', () => {
        stickToBottom = isAtBottom();
        updateJumpButton();
      }, { passive: true });
      function scrollToBottomIfPinned() {
        if (stickToBottom) log.scrollTop = log.scrollHeight;
      }
      function forceScrollToBottom() {
        stickToBottom = true;
        log.scrollTop = log.scrollHeight;
        updateJumpButton();
      }
      if (jumpBottomBtn) {
        jumpBottomBtn.addEventListener('click', () => forceScrollToBottom());
      }

      async function loadInfo() {
        try {
          const r = await fetch('/api/info');
          const j = await r.json();
          meta.textContent = 'model: ' + j.model + ' @ ' + j.baseUrl;
        } catch (e) {
          meta.textContent = 'info failed: ' + e.message;
        }
      }

      function clearEmpty() {
        const empty = log.querySelector('.empty');
        if (empty) empty.remove();
      }

      function humanSize(bytes) {
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
      }

      function renderPreviews() {
        previews.innerHTML = '';
        attached.forEach((a, i) => {
          const wrap = document.createElement('span');
          wrap.className = 'thumb';
          if (a.isImage && a.dataUrl) {
            const img = document.createElement('img');
            img.src = a.dataUrl;
            wrap.appendChild(img);
          } else {
            const chip = document.createElement('span');
            chip.className = 'file-chip';
            const icon = document.createElement('span'); icon.textContent = '📄';
            const name = document.createElement('span'); name.className = 'name'; name.textContent = a.name;
            const size = document.createElement('span'); size.className = 'size'; size.textContent = humanSize(a.size);
            chip.append(icon, name, size);
            chip.title = a.name + ' (' + a.mimeType + ')';
            wrap.appendChild(chip);
          }
          const rm = document.createElement('button');
          rm.className = 'remove';
          rm.textContent = '×';
          rm.onclick = () => { attached.splice(i, 1); renderPreviews(); };
          wrap.appendChild(rm);
          previews.appendChild(wrap);
        });
      }

      function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result);
            const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (!m) return reject(new Error('not data url'));
            resolve({ mimeType: m[1], base64: m[2], dataUrl });
          };
          reader.onerror = () => reject(reader.error || new Error('read failed'));
          reader.readAsDataURL(file);
        });
      }

      async function attachFiles(files) {
        for (const f of files) {
          if (f.size > 10 * 1024 * 1024) {
            appendError('ファイルが大きすぎます (10MB 超): ' + f.name);
            continue;
          }
          const { mimeType, base64, dataUrl } = await readFileAsBase64(f);
          const isImage = (mimeType || f.type || '').startsWith('image/');
          attached.push({
            name: f.name,
            mimeType: mimeType || f.type || 'application/octet-stream',
            base64,
            isImage,
            size: f.size,
            dataUrl: isImage ? dataUrl : undefined,
          });
        }
        renderPreviews();
      }

      function appendUser(text, atts) {
        clearEmpty();
        const w = document.createElement('div');
        w.className = 'msg user';
        w.textContent = text || '(添付のみ)';
        const imgAtts = (atts || []).filter((a) => a.isImage && a.dataUrl);
        const fileAtts = (atts || []).filter((a) => !a.isImage);
        if (imgAtts.length > 0) {
          const row = document.createElement('div');
          row.className = 'attached-imgs';
          for (const a of imgAtts) {
            const im = document.createElement('img'); im.src = a.dataUrl; row.appendChild(im);
          }
          w.appendChild(row);
        }
        if (fileAtts.length > 0) {
          const col = document.createElement('div');
          col.className = 'attached-files';
          for (const a of fileAtts) {
            const pill = document.createElement('span');
            pill.className = 'file-pill';
            pill.textContent = '📄 ' + a.name + ' (' + humanSize(a.size) + ')';
            col.appendChild(pill);
          }
          w.appendChild(col);
        }
        log.appendChild(w);
        forceScrollToBottom();
      }

      function appendNotice(msg) {
        const w = document.createElement('div');
        w.className = 'notice-line';
        w.textContent = 'ℹ ' + msg;
        log.appendChild(w);
        scrollToBottomIfPinned();
      }

      function appendAiBubble() {
        clearEmpty();
        const w = document.createElement('div');
        w.className = 'msg ai';
        const caret = document.createElement('span');
        caret.className = 'caret';
        w.appendChild(caret);
        log.appendChild(w);
        scrollToBottomIfPinned();
        return { node: w, caret, text: '' };
      }

      function appendToolLine(name, args) {
        const w = document.createElement('div');
        w.className = 'tool-line';
        const argText = args ? ' ' + JSON.stringify(args).slice(0, 120) : '';
        w.textContent = '🔧 ' + name + argText;
        log.appendChild(w);
        scrollToBottomIfPinned();
        return w;
      }

      function markToolDone(node, result) {
        if (!node) return;
        const summary = (() => {
          try {
            const s = typeof result === 'string' ? result : JSON.stringify(result);
            return s.length > 80 ? s.slice(0, 80) + '…' : s;
          } catch { return ''; }
        })();
        if (summary) node.textContent += ' → ' + summary;
      }

      function markToolError(node, errorMsg) {
        if (!node) return;
        node.classList.add('error');
        node.textContent += ' ✗ ' + errorMsg;
      }

      function appendError(msg) {
        const w = document.createElement('div');
        w.className = 'msg err';
        w.textContent = msg;
        log.appendChild(w);
        scrollToBottomIfPinned();
      }

      function appendMetaChips(meta) {
        const m = document.createElement('div');
        m.className = 'meta-line';
        const chips = [];
        if (meta.steps != null) chips.push('steps: ' + meta.steps);
        for (const s of (meta.selectedSkills || [])) chips.push('skill: ' + s);
        for (const x of (meta.selectedMemories || [])) chips.push('memory: ' + x);
        for (const t of chips) {
          const c = document.createElement('span');
          c.className = 'chip'; c.textContent = t;
          m.appendChild(c);
        }
        if (chips.length > 0) log.appendChild(m);
      }

      async function sendMessage() {
        if (pending) return;
        const text = input.value.trim();
        if (!text && attached.length === 0) return;

        const sendAttachments = attached.map((a) => ({
          name: a.name, mimeType: a.mimeType, base64: a.base64,
        }));
        appendUser(text, attached);
        input.value = '';
        attached = []; renderPreviews();
        pending = true; send.disabled = true;

        let bubble = appendAiBubble();
        /** @type {Map<string, HTMLElement>} */
        const toolNodes = new Map();
        let doneMeta = null;
        let errorMsg = null;

        try {
          const r = await fetch('/api/chat-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: text, history, attachments: sendAttachments }),
          });
          if (!r.ok || !r.body) {
            errorMsg = 'HTTP ' + r.status;
          } else {
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const blocks = buffer.split('\\n\\n');
              buffer = blocks.pop() || '';
              for (const block of blocks) {
                const lines = block.split('\\n');
                const dataLine = lines.find((l) => l.startsWith('data: '));
                if (!dataLine) continue;
                let event;
                try { event = JSON.parse(dataLine.slice(6)); } catch { continue; }
                if (event.type === 'text') {
                  if (!bubble) bubble = appendAiBubble();
                  bubble.text += event.delta;
                  bubble.node.textContent = bubble.text;
                  bubble.node.appendChild(bubble.caret);
                  scrollToBottomIfPinned();
                } else if (event.type === 'tool_start') {
                  if (bubble) { bubble.caret.remove(); bubble = null; }
                  const node = appendToolLine(event.name, event.arguments);
                  // callId があれば id ベース、後方互換で無ければ name ベース。
                  const key = event.callId || event.name;
                  toolNodes.set(key, node);
                } else if (event.type === 'tool_result') {
                  const key = event.callId || event.name;
                  markToolDone(toolNodes.get(key), event.result);
                } else if (event.type === 'tool_error') {
                  const key = event.callId || event.name;
                  markToolError(toolNodes.get(key), event.error);
                } else if (event.type === 'notice') {
                  appendNotice(event.message);
                } else if (event.type === 'done') {
                  doneMeta = event;
                } else if (event.type === 'error') {
                  errorMsg = event.message;
                }
              }
            }
          }
        } catch (e) {
          errorMsg = e.message;
        }

        if (bubble) bubble.caret.remove();
        if (doneMeta) {
          appendMetaChips(doneMeta);
          history.push({ role: 'user', content: text || '(添付画像)' });
          history.push({ role: 'assistant', content: doneMeta.output || (bubble ? bubble.text : '') });
        }
        if (errorMsg) appendError('error: ' + errorMsg);
        pending = false; send.disabled = false; input.focus();
      }

      // events
      send.addEventListener('click', sendMessage);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
      input.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items || [];
        const files = [];
        for (const it of items) {
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length > 0) { e.preventDefault(); await attachFiles(files); }
      });
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        await attachFiles(Array.from(fileInput.files || []));
        fileInput.value = '';
      });
      const mainEl = document.getElementById('log');
      ['dragenter', 'dragover'].forEach((ev) =>
        mainEl.addEventListener(ev, (e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault(); mainEl.classList.add('dragover');
          }
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        mainEl.addEventListener(ev, (e) => {
          if (ev === 'drop') {
            e.preventDefault();
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length > 0) attachFiles(files);
          }
          mainEl.classList.remove('dragover');
        })
      );
      clearBtn.addEventListener('click', () => {
        history = []; attached = []; renderPreviews();
        log.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '会話をクリアしました。';
        log.appendChild(empty);
      });

      loadInfo();
    </script>
  </body>
</html>
`;
