import { Router } from 'express';
import { searchIcons, renderIcon, ICON_COUNT, FALLBACK_ICON } from '../../lib/icons.js';
import { getGroup } from '../../lib/settings.js';
import { str } from '../../lib/validate.js';

const router = Router();

/**
 * HTML fragment for the icon picker dialog. Results are rendered with the same
 * inlining the public site uses, so the admin previews exactly what visitors
 * will see.
 */
router.get('/picker', (req, res) => {
  const query = str(req.query.q, 60);
  const style = getGroup('appearance').skillIconStyle === 'mono' ? 'mono' : 'color';
  const results = searchIcons(query, 60);

  res.render('admin/icons/picker', {
    layout: false,
    query,
    style,
    total: ICON_COUNT,
    fallbackIcon: FALLBACK_ICON,
    fallbackSvg: renderIcon(FALLBACK_ICON, { style }),
    results: results.map((icon) => ({ ...icon, svg: renderIcon(icon.name, { style }) }))
  });
});

export default router;
