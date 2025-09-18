const db = require('../db/pool');
router.get('/dbcheck', async (_req, res) => {
  try {
    const r = await db.query('SELECT NOW() as now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'DB_FAIL' });
  }
});

