export default {
  // =====================================================
  //                  EMAIL HANDLER
  // =====================================================
  async email(message, env, ctx) {
    try {
      const id = Date.now().toString();

      const from = message.from;
      const to = message.to;
      const subject = message.headers.get("subject") || "(No subject)";
      const date = new Date().toISOString();

      // ----- Đọc toàn bộ raw MIME email -----
      const rawResponse = new Response(message.raw);
      const buffer = await rawResponse.arrayBuffer();
      const raw = new TextDecoder("utf-8").decode(buffer);

      // ===== LẤY PHẦN NỘI DUNG (CONTENT) & DECODE =====
      let body = "";
      let bodyIsHtml = false;

      // Ưu tiên phần text/plain
      const plainPart = raw.match(
        /Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|$)/i
      );

      if (plainPart) {
        const partFull = plainPart[0];   // cả headers + body
        let content = plainPart[1].trim(); // chỉ body

        // xem encoding là gì
        const encMatch = partFull.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
        const encoding = encMatch ? encMatch[1].toLowerCase().trim() : "";

        if (encoding === "quoted-printable") {
          body = decodeQuotedPrintableUtf8(content);
        } else if (encoding === "base64") {
          body = decodeBase64Utf8(content);
        } else {
          body = content;
        }

      } else {
        // Nếu không có text/plain, thử text/html
        const htmlPart = raw.match(
          /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(\r?\n--|$)/i
        );

        if (htmlPart) {
          const partFull = htmlPart[0];
          let content = htmlPart[1].trim();

          const encMatch = partFull.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
          const encoding = encMatch ? encMatch[1].toLowerCase().trim() : "";

          if (encoding === "quoted-printable") {
            body = decodeQuotedPrintableUtf8(content);
          } else if (encoding === "base64") {
            body = decodeBase64Utf8(content);
          } else {
            body = content;
          }
          bodyIsHtml = true;
        } else {
          // Bất đắc dĩ: không parse được thì để nguyên raw
          body = raw;
        }
      }

      const emailData = JSON.stringify({
        id,
        from,
        to,
        subject,
        body,
        bodyIsHtml,
        raw,
        read: false,
        date
      });

      // Lưu email vào KV
      await env.REGEMAILS.put(id, emailData);
      console.log("📩 Email saved:", id);

    } catch (err) {
      console.error("❌ Email handler error:", err);
    }
  },

  // =====================================================
  //                  HTTP HANDLER (UI)
  // =====================================================
  async fetch(request, env) {
    const url = new URL(request.url);
    const params = url.searchParams;

    // =====================================================
    //                DELETE EMAIL
    // =====================================================
    if (params.get("delete")) {
      const id = params.get("delete");
      await env.REGEMAILS.delete(id);

      return new Response("Deleted", {
        status: 302,
        headers: { "Location": "/" }
      });
    }

    // =====================================================
    //             DELETE MULTIPLE
    // =====================================================
    if (params.get("deleteMultiple")) {
      const ids = params.get("deleteMultiple").split(",").map(s => s.trim()).filter(Boolean);
      for (const id of ids) await env.REGEMAILS.delete(id);
      return new Response("Deleted", { status: 302, headers: { "Location": "/" } });
    }

    // =====================================================
    //             TOGGLE READ/UNREAD
    // =====================================================
    if (params.get("toggleRead")) {
      const id = params.get("toggleRead");
      const data = await env.REGEMAILS.get(id);
      if (data) {
        const email = JSON.parse(data);
        email.read = !email.read;
        await env.REGEMAILS.put(id, JSON.stringify(email));
      }
      return new Response("", { status: 302, headers: { "Location": "/" } });
    }

    // =====================================================
    //             DOWNLOAD RAW EMAIL
    // =====================================================
    if (params.get("raw")) {
      const id = params.get("raw");
      const data = await env.REGEMAILS.get(id);
      if (!data) return new Response("Not found", { status: 404 });
      const email = JSON.parse(data);
      return new Response(email.raw || "", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="email-${id}.eml"`
        }
      });
    }

    // =====================================================
    //                VIEW SINGLE EMAIL
    // =====================================================
    if (params.get("view")) {
      const id = params.get("view");
      const data = await env.REGEMAILS.get(id);

      if (!data) return new Response("Email not found", { status: 404 });

      const email = JSON.parse(data);
      const sanitized = sanitizeHTML(email.body || "");
      const formattedDate = new Date(email.date).toLocaleString();

      return new Response(`
        <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${escapeHTML(email.subject)}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
            :root{
              --bg:#f8fafc;--bg-dark:#0f172a;--card:#ffffff;--card-dark:#1e293b;--text:#0f172a;--text-light:#64748b;--muted:#94a3b8;--muted-dark:#475569;
              --brand:#2563eb;--brand-hover:#1d4ed8;--success:#10b981;--danger:#ef4444;--info:#06b6d4;
              --border:#e2e8f0;--border-dark:#334155;--shadow:0 1px 3px rgba(0,0,0,0.1);--shadow-lg:0 10px 25px rgba(0,0,0,0.08);
            }
            [data-theme=dark]{
              --bg:var(--bg-dark);--card:var(--card-dark);--text:var(--text);--border:var(--border-dark);
            }
            *{box-sizing:border-box}
            html,body{height:100%;margin:0;padding:0}
            body{
              font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
              background:var(--bg);color:var(--text);transition:background 0.2s,color 0.2s;line-height:1.6;
            }
            .wrap{max-width:900px;margin:0 auto;padding:24px}
            h1{margin:0 0 24px 0;font-size:28px;font-weight:700;color:var(--text)}
            h2{margin:0 0 16px 0;font-size:22px;font-weight:700;color:var(--text)}
            .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
            .header-nav{display:flex;gap:12px;align-items:center}
            .box{
              background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;margin-bottom:24px;
              box-shadow:var(--shadow);transition:box-shadow 0.3s,background 0.2s;
            }
            .box:hover{box-shadow:var(--shadow-lg)}
            .meta{
              color:var(--text-light);font-size:13px;line-height:1.8;margin:16px 0;
              display:grid;gap:8px;
            }
            .meta strong{color:var(--text);font-weight:600}
            .body{
              background:var(--bg);padding:16px;border-radius:8px;border-left:4px solid var(--brand);
              font-family:'JetBrains Mono',monospace;font-size:13px;line-height:1.6;overflow-x:auto;
              color:var(--text);margin-top:16px;white-space:pre-wrap;word-break:break-word
            }
            .html-render{
              background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:20px;margin:16px 0;
              font-size:14px;line-height:1.7;overflow-x:auto;
            }
            .html-render img{max-width:100%;height:auto}
            a{color:var(--brand);text-decoration:none;transition:color 0.2s}
            a:hover{color:var(--brand-hover)}
            .btn{
              display:inline-flex;align-items:center;gap:8px;border-radius:8px;padding:10px 16px;
              font-weight:600;color:white;background:var(--brand);text-decoration:none;cursor:pointer;border:none;
              transition:all 0.2s;font-size:14px;font-family:inherit
            }
            .btn:hover{background:var(--brand-hover);transform:translateY(-1px);box-shadow:0 4px 12px rgba(37,99,235,0.3)}
            .btn.secondary{background:var(--muted-dark);color:white}
            .btn.secondary:hover{background:#334155}
            .btn.danger{background:var(--danger)}
            .btn.danger:hover{background:#dc2626}
            .btn.ghost{background:transparent;color:var(--brand);border:1.5px solid rgba(37,99,235,0.3);padding:9px 15px}
            .btn.ghost:hover{background:rgba(37,99,235,0.05);border-color:rgba(37,99,235,0.5)}
            .btn.small{padding:6px 12px;font-size:13px}
            .tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}
            .tabs{display:flex;gap:12px;border-bottom:2px solid var(--border);margin:20px 0}
            .tab{padding:12px 0;border-bottom:2px solid transparent;cursor:pointer;transition:all 0.2s;font-weight:600}
            .tab.active{border-bottom-color:var(--brand);color:var(--brand)}
            .toggle-theme{width:40px;height:40px;border-radius:8px;border:1px solid var(--border);background:var(--card);cursor:pointer;flex:0 0 40px;display:flex;align-items:center;justify-content:center}
            .toggle-theme:hover{background:var(--bg)}
            @media (max-width:768px){
              .wrap{padding:16px}
              .box{padding:16px}
              .tools{flex-direction:column;align-items:stretch}
              .btn{width:100%;justify-content:center}
              h1{font-size:24px}
              h2{font-size:18px}
            }
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="header">
              <a href="/" class="btn ghost small">← Back</a>
              <button class="toggle-theme" onclick="toggleTheme()" title="Toggle theme">🌙</button>
            </div>
            <div class="box">
              <h2>${escapeHTML(email.subject)}</h2>
              <div class="tools">
                <a class="btn" href="?raw=${email.id}">📥 Download raw</a>
                <a class="btn secondary" href="?toggleRead=${email.id}">🔖 ${email.read ? 'Mark unread' : 'Mark read'}</a>
              </div>
              <div class="meta">
                <div><strong>From:</strong> ${escapeHTML(email.from)}</div>
                <div><strong>To:</strong> ${escapeHTML(email.to)}</div>
                <div><strong>Date:</strong> ${escapeHTML(formattedDate)}</div>
              </div>
              ${email.bodyIsHtml ? `<div class="tabs"><div class="tab active" onclick="showTab('html')">📄 HTML</div><div class="tab" onclick="showTab('raw')">📝 Raw</div></div>` : ''}
              ${email.bodyIsHtml ? `<div id="html" class="html-render">${sanitized}</div>` : ''}
              <div id="raw" class="body">${escapeHTML(email.body)}</div>
            </div>
          </div>
          <script>
            function toggleTheme(){const t=document.documentElement.dataset.theme;document.documentElement.dataset.theme=t==='dark'?'light':'dark';localStorage.setItem('theme',document.documentElement.dataset.theme)}
            function showTab(t){const h=document.getElementById('html'),r=document.getElementById('raw');if(!h)return;h.style.display=t==='html'?'block':'none';r.style.display=t==='raw'?'block':'none';document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));event.target.classList.add('active')}
            window.addEventListener('load',()=>{const t=localStorage.getItem('theme')||'light';document.documentElement.dataset.theme=t;document.querySelector('.toggle-theme').textContent=t==='dark'?'☀️':'🌙'})
          </script>
        </body>
        </html>
      `, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // =====================================================
    //                LIST ALL EMAILS
    // =====================================================
    const list = await env.REGEMAILS.list();
    let emails = [];

    for (const key of list.keys) {
      const data = await env.REGEMAILS.get(key.name);
      if (data) emails.push(JSON.parse(data));
    }

    // Sort email mới nhất lên đầu
    emails.sort((a, b) => Number(b.id) - Number(a.id));

    // Search
    const q = (params.get('q') || '').toLowerCase().trim();
    if (q) {
      emails = emails.filter(e => {
        return (e.subject || '').toLowerCase().includes(q)
          || (e.from || '').toLowerCase().includes(q)
          || (e.body || '').toLowerCase().includes(q);
      });
    }

    // Pagination
    const perPage = 20;
    const page = Math.max(1, parseInt(params.get('page') || '1', 10));
    const total = emails.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const start = (page - 1) * perPage;
    const paged = emails.slice(start, start + perPage);

    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Email Inbox</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
          :root{
            --bg:#f8fafc;--bg-dark:#0f172a;--card:#ffffff;--card-dark:#1e293b;--text:#0f172a;--text-light:#64748b;--muted:#94a3b8;--muted-dark:#475569;
            --brand:#2563eb;--brand-hover:#1d4ed8;--success:#10b981;--danger:#ef4444;--info:#06b6d4;
            --border:#e2e8f0;--border-dark:#334155;--shadow:0 1px 3px rgba(0,0,0,0.1);--shadow-lg:0 10px 25px rgba(0,0,0,0.08);
          }
          [data-theme=dark]{
            --bg:var(--bg-dark);--card:var(--card-dark);--text:var(--text);--border:var(--border-dark);
          }
          *{box-sizing:border-box}
          html,body{height:100%;margin:0;padding:0}
          body{
            font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            background:var(--bg);color:var(--text);transition:background 0.2s,color 0.2s;line-height:1.6;
          }
          .wrap{max-width:1200px;margin:0 auto;padding:24px}
          h1{margin:0 0 24px 0;font-size:28px;font-weight:700;color:var(--text)}
          .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:16px}
          .header-left{display:flex;align-items:center;gap:16px;flex:1;min-width:0}
          .search-box{flex:1;min-width:200px;max-width:400px}
          .search-box input{
            width:100%;padding:10px 14px;border:1.5px solid var(--border);background:var(--card);border-radius:8px;
            font-family:inherit;color:var(--text);transition:all 0.2s;font-size:14px
          }
          .search-box input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,0.1)}
          .email-card{
            background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;
            display:flex;gap:12px;align-items:center;transition:all 0.2s;position:relative;
          }
          .email-card:hover{box-shadow:var(--shadow-lg);border-color:var(--border)}
          .email-card input[type="checkbox"]{width:18px;height:18px;cursor:pointer;flex:0 0 18px}
          .email-content{flex:1;min-width:0;cursor:pointer}
          .email-subject{
            font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;text-decoration:none;display:block;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          }
          .email-card:hover .email-subject{color:var(--brand)}
          .email-meta{
            font-size:13px;color:var(--text-light);display:flex;align-items:center;gap:12px;flex-wrap:wrap
          }
          .email-from{font-weight:500;color:var(--text)}
          .read-indicator{
            display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 8px;
          }
          .read-true{background:#cbd5e1}
          .read-false{background:var(--success)}
          .email-actions{
            display:flex;gap:8px;align-items:center;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end
          }
          .btn{
            display:inline-flex;align-items:center;gap:6px;border-radius:6px;padding:8px 12px;
            font-weight:600;color:white;background:var(--brand);text-decoration:none;cursor:pointer;border:none;
            transition:all 0.2s;font-size:13px;font-family:inherit;white-space:nowrap
          }
          .btn:hover{background:var(--brand-hover);transform:translateY(-1px);box-shadow:0 4px 12px rgba(37,99,235,0.3)}
          .btn.secondary{background:var(--muted-dark);color:white}
          .btn.secondary:hover{background:#334155}
          .btn.danger{background:var(--danger)}
          .btn.danger:hover{background:#dc2626}
          .btn.info{background:var(--info)}
          .btn.info:hover{background:#0891b2}
          .btn.ghost{background:transparent;color:var(--brand);border:1.5px solid rgba(37,99,235,0.3);padding:7px 11px}
          .btn.ghost:hover{background:rgba(37,99,235,0.05);border-color:rgba(37,99,235,0.5)}
          .btn.small{padding:6px 10px;font-size:12px}
          .controls{
            display:flex;gap:16px;align-items:center;margin-bottom:20px;flex-wrap:wrap;justify-content:space-between
          }
          .controls-left{display:flex;gap:16px;align-items:center;flex:1;min-width:0;flex-wrap:wrap}
          .controls-right{display:flex;gap:8px;align-items:center;flex:0 0 auto;flex-wrap:wrap}
          .toggle-theme{width:40px;height:40px;border-radius:8px;border:1.5px solid var(--border);background:var(--card);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;font-size:18px}
          .toggle-theme:hover{background:var(--bg);border-color:var(--brand)}
          .pagination{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:24px}
          .pagination-info{font-size:13px;color:var(--text-light)}
          .empty-state{text-align:center;padding:60px 20px;color:var(--text-light)}
          .empty-state-icon{font-size:48px;margin-bottom:16px}
          @media (max-width:1024px){
            .email-actions{flex-direction:column}
            .btn{width:100%}
          }
          @media (max-width:768px){
            .wrap{padding:16px}
            .controls{gap:12px;flex-direction:column;align-items:stretch}
            .controls-left{flex-direction:column}
            .controls-right{justify-content:stretch}
            .search-box{max-width:100%}
            .email-card{flex-direction:column;align-items:stretch}
            .email-actions{width:100%;flex-direction:row;justify-content:space-around}
            .btn{font-size:12px;padding:6px 10px}
            h1{font-size:24px}
            .header-left{flex-direction:column;width:100%}
            .toggle-theme{width:100%;height:auto;padding:8px}
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="header">
            <h1>📬 Email Inbox</h1>
            <button class="toggle-theme" onclick="toggleTheme()" title="Toggle dark mode">🌙</button>
          </div>

          <div class="controls">
            <div class="controls-left">
              <form class="search-box" action="/" method="get" style="margin:0">
                <input type="text" name="q" placeholder="🔍 Search subject, from, body..." value="${escapeHTML(params.get('q')||'')}">
              </form>
            </div>
            <div class="controls-right">
              <button class="btn ghost small" onclick="selectAll()">☑️ Select all</button>
              <button class="btn ghost small" onclick="clearAll()">☐ Clear</button>
              <button class="btn danger small" onclick="deleteSelected()">🗑️ Delete</button>
            </div>
          </div>

          ${total === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">📭</div>
              <h2 style="margin:0 0 8px 0">No emails found</h2>
              <p style="margin:0;color:var(--text-light)">Your inbox is empty or no emails match your search.</p>
            </div>
          ` : `
            <form id="listForm">
            ${paged.map(e => `
              <div class="email-card">
                <input type="checkbox" name="sel" value="${e.id}" onclick="event.stopPropagation()">
                <a href="?view=${e.id}" class="email-content" style="text-decoration:none;color:inherit">
                  <div class="email-subject">
                    <span class="read-indicator ${e.read ? 'read-true' : 'read-false'}"></span>
                    ${escapeHTML(e.subject||'(No subject)')}
                  </div>
                  <div class="email-meta">
                    <span class="email-from" title="${escapeHTML(e.from)}">${escapeHTML(e.from)}</span>
                    <span>•</span>
                    <span>${escapeHTML(new Date(e.date).toLocaleString())}</span>
                  </div>
                </a>
                <div class="email-actions" onclick="event.stopPropagation()">
                  <a class="btn ghost small" href="?toggleRead=${e.id}" title="Toggle read status">${e.read ? '👁️ Unread' : '📖 Read'}</a>
                  <a class="btn info small" href="?raw=${e.id}" title="Download raw email">📥 Raw</a>
                  <a class="btn danger small" href="?delete=${e.id}" onclick="return confirm('Delete this email?')">🗑️ Delete</a>
                </div>
              </div>
            `).join('')}
            </form>

            <div class="pagination">
              <div class="pagination-info">📊 ${(page-1)*perPage + 1}–${Math.min(page*perPage, total)} of ${total}</div>
              <div style="display:flex;gap:8px;align-items:center">
                ${page>1?`<a class="btn ghost small" href="/?page=${page-1}${q?`&q=${encodeURIComponent(q)}`:''}">← Prev</a>`:'<span style="font-size:13px;color:var(--text-light)">← Prev</span>'}
                <div class="pagination-info">Page ${page} / ${pages}</div>
                ${page<pages?`<a class="btn ghost small" href="/?page=${page+1}${q?`&q=${encodeURIComponent(q)}`:''}">Next →</a>`:'<span style="font-size:13px;color:var(--text-light)">Next →</span>'}
              </div>
            </div>
          `}

        </div>

        <script>
          function toggleTheme(){
            const theme = document.documentElement.dataset.theme;
            const newTheme = theme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = newTheme;
            localStorage.setItem('theme', newTheme);
            updateThemeButton();
          }
          function updateThemeButton(){
            const theme = document.documentElement.dataset.theme;
            document.querySelector('.toggle-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
          }
          function selectAll(){ document.querySelectorAll('input[name=sel]').forEach(i=>i.checked=true) }
          function clearAll(){ document.querySelectorAll('input[name=sel]').forEach(i=>i.checked=false) }
          function deleteSelected(){
            const vals = Array.from(document.querySelectorAll('input[name=sel]:checked')).map(i=>i.value);
            if(!vals.length) return alert('No items selected');
            if(!confirm('Delete ' + vals.length + ' email(s)?')) return;
            window.location = '/?deleteMultiple=' + vals.join(',');
          }
          window.addEventListener('load', ()=>{
            const theme = localStorage.getItem('theme') || 'light';
            document.documentElement.dataset.theme = theme;
            updateThemeButton();
          });
        </script>
      </body>
      </html>
    `;

    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
};

// =====================================================
//                HTML ESCAPE (CHỐNG XSS)
// =====================================================
function escapeHTML(str) {
  str = String(str || "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// =====================================================
//                SIMPLE HTML SANITIZER
// Removes <script> tags and dangerous attributes (basic)
// =====================================================
function sanitizeHTML(html) {
  if (!html) return "";
  let safe = String(html);
  // remove script tags and contents
  safe = safe.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  // remove style tags to prevent injected styles
  safe = safe.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  // remove on* event handlers
  safe = safe.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "");
  safe = safe.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, "");
  // remove javascript: protocol
  safe = safe.replace(/javascript:/gi, "");
  // remove data: protocol (can be dangerous)
  safe = safe.replace(/data:text\/html/gi, "");
  // wrap images with max-width
  safe = safe.replace(/<img\s+/gi, '<img style="max-width:100%;height:auto" ');
  return safe;
}

// =====================================================
//       QUOTED-PRINTABLE UTF-8 DECODER
// =====================================================
function decodeQuotedPrintableUtf8(input) {
  if (!input) return "";

  // Bỏ soft line breaks: "=\r\n" hoặc "=\n"
  let cleaned = input.replace(/=\r?\n/g, "");

  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "=") {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push("=".charCodeAt(0));
      }
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }

  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

// =====================================================
//          BASE64 UTF-8 DECODER
// =====================================================
function decodeBase64Utf8(input) {
  if (!input) return "";
  const cleaned = input.replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}