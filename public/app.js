(() => {
  const app = document.getElementById('app');
  const state = { user: null, tab: 'bills', month: null, view: 'login', error: '', notice: '' };

  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayStr(new Date());
  const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  const monthLabel = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shiftMonth = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const dayDiff = (iso) => Math.round((Date.parse(iso) - Date.parse(today())) / 86400000);
  const dueText = (iso) => new Date(iso + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Tiny DOM helper: children are nodes or strings; strings are always text, never HTML.
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api/' + path, {
      method,
      headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : {},
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.user) { state.user = null; state.view = 'login'; render(); }
      throw new Error(data.error || 'Something went wrong');
    }
    return data;
  }

  function fail(e) { state.error = e.message; render(); }

  // ---------- login ----------
  function loginView() {
    const activating = state.view === 'activate';
    const submit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        if (activating) await api('activate', 'POST', { email: f.get('email'), code: f.get('code'), password: f.get('password') });
        else await api('login', 'POST', { email: f.get('email'), password: f.get('password') });
        await boot();
      } catch (err) { fail(err); }
    };
    return h('div', { class: 'card', style: 'margin-top:10vh' },
      h('h1', {}, 'Budget Month'),
      h('p', { class: 'muted' }, activating ? 'First time? Enter the 10-character code from the owner and choose a password.' : 'Members sign in below.'),
      h('form', { onsubmit: submit },
        h('label', { for: 'email' }, 'Email'),
        h('input', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'username' }),
        activating && [h('label', { for: 'code' }, 'Sign-up code'),
          h('input', { id: 'code', name: 'code', type: 'text', required: true, maxlength: 10, autocomplete: 'off', style: 'text-transform:uppercase' })],
        h('label', { for: 'password' }, activating ? 'New password (8+ characters)' : 'Password'),
        h('input', { id: 'password', name: 'password', type: 'password', required: true, minlength: activating ? 8 : 1, autocomplete: activating ? 'new-password' : 'current-password' }),
        state.error && h('div', { class: 'error', role: 'alert' }, state.error),
        h('button', { class: 'primary full', type: 'submit' }, activating ? 'Create my password & sign in' : 'Sign in')),
      h('p', {}, h('button', { class: 'link', type: 'button', onclick: () => { state.view = activating ? 'login' : 'activate'; state.error = ''; render(); } },
        activating ? 'Back to sign in' : 'I have a sign-up code')));
  }

  // ---------- bills ----------
  async function billsView() {
    const t = today();
    const [{ posts }, { reminders }] = await Promise.all([
      api(`posts?month=${state.month}&today=${t}`), api(`reminders?today=${t}`),
    ]);
    const total = posts.reduce((s, p) => s + p.amount, 0);
    const paid = posts.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);
    const reload = () => render();

    const remind = reminders.length && h('div', { class: 'alert' + (reminders.some((p) => dayDiff(p.due_date) < 0) ? ' late' : ''), role: 'alert' },
      h('strong', {}, 'Pay soon!'),
      h('ul', {}, reminders.map((p) => {
        const d = dayDiff(p.due_date);
        return h('li', {}, `${p.title} ${money(p.amount)} — ${d < 0 ? `overdue ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`}`);
      })));

    const row = (p) => {
      const d = dayDiff(p.due_date);
      const badge = p.paid ? h('span', { class: 'badge paid' }, 'Paid')
        : d < 0 ? h('span', { class: 'badge late' }, 'Overdue')
        : d <= 3 ? h('span', { class: 'badge soon' }, d === 0 ? 'Due today' : `Due in ${d}d`) : null;
      return h('div', { class: 'post' + (p.paid ? ' paid' : '') },
        h('input', { type: 'checkbox', checked: p.paid, 'aria-label': `Mark ${p.title} paid`,
          onchange: async (e) => { try { await api(`posts/${p.id}`, 'PATCH', { paid: e.target.checked }); reload(); } catch (err) { fail(err); } } }),
        h('div', { class: 'info' },
          h('div', { class: 'title' }, p.title, badge),
          h('div', { class: 'muted' }, `Due ${dueText(p.due_date)}${p.repeat ? ' · repeats monthly' : ''}${p.paid_at ? ` · paid ${new Date(p.paid_at).toLocaleDateString()}` : ''}`),
          p.note && h('div', { class: 'muted' }, p.note),
          h('div', { class: 'actions' },
            h('button', { class: 'small', onclick: () => editBill(p) }, 'Edit'),
            h('button', { class: 'small danger', onclick: async () => {
              if (!confirm(`Delete "${p.title}"?`)) return;
              try { await api(`posts/${p.id}`, 'DELETE', {}); reload(); } catch (err) { fail(err); }
            } }, 'Delete'))),
        h('div', { class: 'amount' }, money(p.amount)));
    };

    const editBill = (p) => {
      const title = prompt('Bill name', p.title); if (title === null) return;
      const amount = prompt('Amount', p.amount); if (amount === null) return;
      const due = prompt('Due date (YYYY-MM-DD)', p.due_date); if (due === null) return;
      api(`posts/${p.id}`, 'PATCH', { title, amount, due_date: due }).then(reload, fail);
    };

    const addForm = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('posts', 'POST', { title: f.get('title'), amount: f.get('amount'), due_date: f.get('due_date'), note: f.get('note'), repeat: f.get('repeat') === 'on', month: state.month });
        reload();
      } catch (err) { fail(err); }
    } },
      h('h2', {}, `Post a payment for ${monthLabel(state.month)}`),
      h('label', { for: 'title' }, 'What to pay'),
      h('input', { id: 'title', name: 'title', type: 'text', required: true, maxlength: 100, placeholder: 'Rent, phone, power…' }),
      h('div', { class: 'row' },
        h('div', {}, h('label', { for: 'amount' }, 'Amount'), h('input', { id: 'amount', name: 'amount', type: 'number', required: true, min: 0, step: '0.01', inputmode: 'decimal' })),
        h('div', {}, h('label', { for: 'due' }, 'Due date'), h('input', { id: 'due', name: 'due_date', type: 'date', required: true, value: `${state.month}-${t.startsWith(state.month) ? t.slice(8) : '01'}` }))),
      h('label', { for: 'note' }, 'Note (optional)'),
      h('input', { id: 'note', name: 'note', type: 'text', maxlength: 500 }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'repeat' }), 'Repeat every month'),
      h('button', { class: 'primary full', type: 'submit' }, 'Add to this month'));

    return h('div', {}, remind,
      h('div', { class: 'month' },
        h('button', { 'aria-label': 'Previous month', onclick: () => { state.month = shiftMonth(state.month, -1); render(); } }, '‹'),
        h('strong', {}, monthLabel(state.month)),
        h('button', { 'aria-label': 'Next month', onclick: () => { state.month = shiftMonth(state.month, 1); render(); } }, '›')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Total'), h('b', {}, money(total))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Paid'), h('b', {}, money(paid))),
        h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Left to pay'), h('b', {}, money(total - paid)))),
      h('div', { class: 'card' }, posts.length ? posts.map(row) : h('div', { class: 'empty' }, 'Nothing posted for this month yet.')),
      addForm);
  }

  // ---------- members (owner) ----------
  async function membersView() {
    const { members } = await api('members');
    const showCode = (name, code) => { state.notice = `Sign-up code for ${name}: ${code} — give it to them. They use it with their email on the sign-in page ("I have a sign-up code").`; render(); };
    return h('div', {},
      state.notice && h('div', { class: 'alert' }, state.notice),
      h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { const r = await api('members', 'POST', { name: f.get('name'), email: f.get('email') }); showCode(f.get('name'), r.signup_code); } catch (err) { fail(err); }
      } },
        h('h2', {}, 'Add a member'),
        h('label', { for: 'mname' }, 'Name'), h('input', { id: 'mname', name: 'name', type: 'text', required: true, maxlength: 80 }),
        h('label', { for: 'memail' }, 'Email'), h('input', { id: 'memail', name: 'email', type: 'email', required: true }),
        h('button', { class: 'primary full', type: 'submit' }, 'Add & make 10-character code')),
      h('div', { class: 'card' }, h('h2', {}, 'Members'),
        members.length ? members.map((m) => h('div', { class: 'post' },
          h('div', { class: 'info' },
            h('div', {}, m.name, h('span', { class: 'badge ' + (m.status === 'pending' ? 'soon' : 'paid') }, m.status === 'pending' ? 'Waiting to sign up' : 'Active')),
            h('div', { class: 'muted' }, m.email),
            m.signup_code && h('div', {}, 'Code: ', h('span', { class: 'code' }, m.signup_code)),
            h('div', { class: 'actions' },
              h('button', { class: 'small', onclick: async () => {
                const name = prompt('Name', m.name); if (name === null) return;
                const email = prompt('Email', m.email); if (email === null) return;
                try { await api(`members/${m.id}`, 'PATCH', { name, email }); render(); } catch (err) { fail(err); }
              } }, 'Edit'),
              h('button', { class: 'small', onclick: async () => {
                if (!confirm(`Make a new code for ${m.name}? Their current password stops working.`)) return;
                try { const r = await api(`members/${m.id}`, 'PATCH', { reset_code: true }); showCode(m.name, r.signup_code); } catch (err) { fail(err); }
              } }, 'New code'),
              h('button', { class: 'small danger', onclick: async () => {
                if (!confirm(`Remove ${m.name} and all their posts?`)) return;
                try { await api(`members/${m.id}`, 'DELETE', {}); render(); } catch (err) { fail(err); }
              } }, 'Remove')))))
          : h('div', { class: 'empty' }, 'No members yet.')));
  }

  async function changePassword() {
    const current = prompt('Current password'); if (!current) return;
    const password = prompt('New password (8+ characters)'); if (!password) return;
    try { await api('password', 'POST', { current, password }); alert('Password changed'); } catch (e) { alert(e.message); }
  }

  // ---------- shell ----------
  async function render() {
    const err = state.error;
    if (!state.user) { app.replaceChildren(loginView()); state.error = ''; return; }
    const owner = state.user.role === 'owner';
    const shell = h('div', {},
      h('div', { class: 'bar' },
        h('div', {}, h('h1', {}, 'Budget Month'), h('div', { class: 'muted' }, `${state.user.name} · ${owner ? 'Owner' : 'Member'}`)),
        h('div', { class: 'actions' },
          !owner && h('button', { class: 'small', onclick: changePassword }, 'Password'),
          h('button', { class: 'small', onclick: async () => { await api('logout', 'POST', {}).catch(() => {}); state.user = null; state.view = 'login'; render(); } }, 'Sign out'))),
      owner && h('div', { class: 'tabs' },
        h('button', { 'aria-pressed': state.tab === 'bills', onclick: () => { state.tab = 'bills'; state.notice = ''; render(); } }, 'My bills'),
        h('button', { 'aria-pressed': state.tab === 'members', onclick: () => { state.tab = 'members'; render(); } }, 'Members')),
      err && h('div', { class: 'error', role: 'alert' }, err));
    state.error = '';
    app.replaceChildren(shell);
    try {
      shell.append(state.tab === 'members' && owner ? await membersView() : await billsView());
    } catch (e) { if (state.user) shell.append(h('div', { class: 'error' }, e.message)); }
  }

  async function boot() {
    const { user } = await api('me').catch(() => ({ user: null }));
    state.user = user;
    state.tab = 'bills';
    state.month = today().slice(0, 7);
    state.error = '';
    render();
  }
  boot();
})();
