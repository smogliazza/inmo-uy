import { Router } from 'express';
import { MODULE_KEYS, resolveModules } from '../lib/modules';

const router = Router();

// GET /api/modules/installation — public: which modules are on for this installation before any
// brokerage override. The login page uses it (e.g. to show "Sign in with Google" only when available).
router.get('/installation', (_req, res) => {
    const map = resolveModules({});
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ modules: Object.fromEntries(MODULE_KEYS.map(k => [k, map[k].enabled])) });
});

export default router;
