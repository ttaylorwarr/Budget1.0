import { rollRepeats } from '../functions/lib/repeats.js';

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function when(due, today) {
  const d = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  return d < 0 ? `overdue ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`;
}

// Emails each person once a day about their own unpaid bills that are due within 3 days or overdue.
async function sendReminders(env) {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const { results: users } = await env.DB.prepare('SELECT id, email, name FROM users').all();
  for (const u of users) {
    await rollRepeats(env, u.id, today.slice(0, 7));
    const { results: bills } = await env.DB.prepare(
      `SELECT id, title, amount_cents, due_date FROM posts
       WHERE user_id = ? AND paid = 0 AND due_date <= ? AND (last_reminded IS NULL OR last_reminded < ?)
       ORDER BY due_date`,
    ).bind(u.id, soon, today).all();
    if (!bills.length) continue;

    const lines = bills.map((b) => `${b.title} ${money(b.amount_cents)} - ${when(b.due_date, today)}`);
    try {
      await env.EMAIL.send({
        from: env.FROM_EMAIL,
        to: u.email,
        subject: `Pay soon: ${bills.length} bill${bills.length === 1 ? '' : 's'} due`,
        text: `Hi ${u.name},\n\n${lines.join('\n')}\n\nMark them paid at ${env.SITE_URL}`,
        html: `<p>Hi ${esc(u.name)},</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` +
          `<p><a href="${esc(env.SITE_URL)}">Open Budget Month</a> to mark them paid.</p>`,
      });
    } catch (e) {
      console.error('reminder failed for user', u.id, e);
      continue; // not marked, so tomorrow's run tries again
    }
    await env.DB.batch(bills.map((b) => env.DB.prepare('UPDATE posts SET last_reminded = ? WHERE id = ?').bind(today, b.id)));
  }
}

export default {
  scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};
