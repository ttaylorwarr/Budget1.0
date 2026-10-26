// Copy repeating bills forward into `month` (unpaid) if they are not there yet.
export async function rollRepeats(env, userId, month) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM posts p WHERE user_id = ?1 AND repeat = 1 AND month < ?2
       AND month = (SELECT MAX(month) FROM posts WHERE user_id = ?1 AND series_id = p.series_id)
       AND NOT EXISTS (SELECT 1 FROM posts WHERE user_id = ?1 AND series_id = p.series_id AND month = ?2)`,
  ).bind(userId, month).all();
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const stmts = results.map((p) => {
    const day = String(Math.min(Number(p.due_date.slice(8, 10)), lastDay)).padStart(2, '0');
    return env.DB.prepare(
      `INSERT INTO posts (user_id, series_id, month, title, amount_cents, due_date, note, repeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    ).bind(userId, p.series_id, month, p.title, p.amount_cents, `${month}-${day}`, p.note);
  });
  if (stmts.length) await env.DB.batch(stmts);
}

