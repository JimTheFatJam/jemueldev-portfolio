import { Router } from 'express';
import { run } from '../../db/index.js';
import { listEducation, getEducation, reorder, nextPosition } from '../../lib/content.js';
import { str, text, bool, int, mediaId } from '../../lib/validate.js';

const router = Router();

function parseForm(body) {
  return {
    degree: str(body.degree, 160) || 'Untitled',
    institution: str(body.institution, 160),
    date_range: str(body.date_range, 80),
    description: text(body.description, 5000),
    logo_id: mediaId(body.logo_id),
    visible: bool(body.visible)
  };
}

router.get('/', (req, res) => {
  res.render('admin/education/list', {
    pageTitle: 'Education',
    section: 'education',
    items: listEducation()
  });
});

router.get('/new', (req, res) => {
  res.render('admin/education/form', {
    pageTitle: 'Add education',
    section: 'education',
    item: {
      id: null,
      degree: '',
      institution: '',
      date_range: '',
      description: '',
      logo: null,
      logo_id: null,
      visible: true
    },
    isNew: true
  });
});

router.post('/', (req, res) => {
  const data = parseForm(req.body);
  const info = run(
    `INSERT INTO education (degree, institution, date_range, description, logo_id, visible, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    data.degree,
    data.institution,
    data.date_range,
    data.description,
    data.logo_id,
    data.visible ? 1 : 0,
    nextPosition('education')
  );
  res.flash('success', 'Education entry added.');
  res.redirect('/admin/education/' + Number(info.lastInsertRowid));
});

router.get('/:id', (req, res, next) => {
  const item = getEducation(req.params.id);
  if (!item) return next();
  res.render('admin/education/form', {
    pageTitle: item.degree,
    section: 'education',
    item,
    isNew: false
  });
});

router.post('/:id', (req, res, next) => {
  const item = getEducation(req.params.id);
  if (!item) return next();
  const data = parseForm(req.body);
  run(
    `UPDATE education SET degree = ?, institution = ?, date_range = ?, description = ?, logo_id = ?, visible = ?
     WHERE id = ?`,
    data.degree,
    data.institution,
    data.date_range,
    data.description,
    data.logo_id,
    data.visible ? 1 : 0,
    item.id
  );
  res.flash('success', 'Education entry saved.');
  res.redirect('/admin/education/' + item.id);
});

router.post('/:id/move', (req, res) => {
  reorder('education', int(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/education');
});

router.post('/:id/delete', (req, res) => {
  run('DELETE FROM education WHERE id = ?', int(req.params.id));
  res.flash('success', 'Education entry deleted.');
  res.redirect('/admin/education');
});

export default router;
