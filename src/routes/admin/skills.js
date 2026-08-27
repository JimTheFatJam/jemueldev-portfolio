import { Router } from 'express';
import { run, get } from '../../db/index.js';
import { listSkillCategories, reorder, nextPosition } from '../../lib/content.js';
import { str, bool, int } from '../../lib/validate.js';
import { normalizeIconName } from '../../lib/icons.js';

const router = Router();

router.get('/', (req, res) => {
  res.render('admin/skills', {
    pageTitle: 'Skills',
    section: 'skills',
    categories: listSkillCategories()
  });
});

// --- categories ------------------------------------------------------------

router.post('/categories', (req, res) => {
  const name = str(req.body.name, 80);
  if (!name) {
    res.flash('error', 'Give the category a name.');
    return res.redirect('/admin/skills');
  }
  run(
    'INSERT INTO skill_categories (name, visible, position) VALUES (?, 1, ?)',
    name,
    nextPosition('skill_categories')
  );
  res.flash('success', `Added the “${name}” category.`);
  res.redirect('/admin/skills');
});

router.post('/categories/:id', (req, res) => {
  const id = int(req.params.id);
  const name = str(req.body.name, 80);
  if (!id || !name) {
    res.flash('error', 'Give the category a name.');
    return res.redirect('/admin/skills');
  }
  run('UPDATE skill_categories SET name = ?, visible = ? WHERE id = ?', name, bool(req.body.visible) ? 1 : 0, id);
  res.flash('success', 'Category updated.');
  res.redirect('/admin/skills');
});

router.post('/categories/:id/move', (req, res) => {
  reorder('skill_categories', int(req.params.id), req.body.direction === 'up' ? 'up' : 'down');
  res.redirect('/admin/skills');
});

router.post('/categories/:id/delete', (req, res) => {
  const id = int(req.params.id);
  const category = get('SELECT name FROM skill_categories WHERE id = ?', id);
  // Skills cascade with the category (see the foreign key in schema.sql).
  run('DELETE FROM skill_categories WHERE id = ?', id);
  if (category) res.flash('success', `Deleted the “${category.name}” category and its skills.`);
  res.redirect('/admin/skills');
});

// --- skills ----------------------------------------------------------------

router.post('/categories/:id/skills', (req, res) => {
  const categoryId = int(req.params.id);
  const category = get('SELECT id FROM skill_categories WHERE id = ?', categoryId);
  if (!category) {
    res.flash('error', 'That category no longer exists.');
    return res.redirect('/admin/skills');
  }

  // One field, one skill per line or comma — quick to paste a whole stack in.
  const names = str(req.body.name, 400)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 30);

  if (names.length === 0) {
    res.flash('error', 'Type a skill name first.');
    return res.redirect('/admin/skills');
  }

  // Only a name from the devicon catalogue (or the generic mark) is stored.
  const icon = normalizeIconName(req.body.icon);
  let position = nextPosition('skills', { column: 'category_id', value: categoryId });
  for (const name of names) {
    run(
      'INSERT INTO skills (category_id, name, icon, position) VALUES (?, ?, ?, ?)',
      categoryId,
      name.slice(0, 60),
      names.length === 1 ? icon : '',
      position++
    );
  }
  res.flash('success', names.length === 1 ? `Added ${names[0]}.` : `Added ${names.length} skills.`);
  res.redirect('/admin/skills');
});

router.post('/skills/:id', (req, res) => {
  const id = int(req.params.id);
  const name = str(req.body.name, 60);
  if (!id || !name) {
    res.flash('error', 'A skill needs a name.');
    return res.redirect('/admin/skills');
  }
  run('UPDATE skills SET name = ?, icon = ? WHERE id = ?', name, normalizeIconName(req.body.icon), id);
  res.flash('success', 'Skill updated.');
  res.redirect('/admin/skills');
});

router.post('/skills/:id/move', (req, res) => {
  reorder('skills', int(req.params.id), req.body.direction === 'up' ? 'up' : 'down', { column: 'category_id' });
  res.redirect('/admin/skills');
});

router.post('/skills/:id/delete', (req, res) => {
  run('DELETE FROM skills WHERE id = ?', int(req.params.id));
  res.flash('success', 'Skill removed.');
  res.redirect('/admin/skills');
});

export default router;
