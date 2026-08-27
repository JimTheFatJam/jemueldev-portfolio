import { Router } from 'express';
import { get } from '../../db/index.js';
import { addBlock, updateBlock, deleteBlock, moveBlock, BLOCK_TYPES, OWNER_TYPES } from '../../lib/blocks.js';
import { int } from '../../lib/validate.js';

const router = Router();

/** Where the editor for a given owner lives. */
function ownerHref(ownerType, ownerId) {
  switch (ownerType) {
    case 'project':
      return '/admin/projects/' + ownerId;
    case 'research':
      return '/admin/research/' + ownerId;
    case 'page':
      return '/admin/pages/' + ownerId;
    case 'about':
      return '/admin/settings/about';
    default:
      return '/admin';
  }
}

function ownerExists(ownerType, ownerId) {
  if (ownerType === 'about') return Number(ownerId) === 0;
  const table = { project: 'projects', research: 'research', page: 'pages' }[ownerType];
  if (!table) return false;
  return Boolean(get(`SELECT id FROM ${table} WHERE id = ?`, Number(ownerId)));
}

router.post('/:ownerType/:ownerId/add', (req, res, next) => {
  const { ownerType } = req.params;
  const ownerId = ownerType === 'about' ? 0 : int(req.params.ownerId, 0);
  const type = String(req.body.type || '');

  if (!OWNER_TYPES.includes(ownerType) || !ownerExists(ownerType, ownerId)) return next();
  if (!BLOCK_TYPES[type]) {
    res.flash('error', 'Unknown block type.');
    return res.redirect(ownerHref(ownerType, ownerId));
  }

  const id = addBlock(ownerType, ownerId, type);
  res.flash('success', `${BLOCK_TYPES[type].label} block added.`);
  res.redirect(ownerHref(ownerType, ownerId) + '#block-' + id);
});

router.post('/:id', (req, res, next) => {
  const block = get('SELECT * FROM blocks WHERE id = ?', int(req.params.id));
  if (!block) return next();

  // `items` arrives as a JSON array from the gallery field.
  const data = { ...req.body };
  if (typeof data.items === 'string') {
    try {
      data.items = JSON.parse(data.items || '[]');
    } catch {
      data.items = [];
    }
  }

  updateBlock(block.id, data);
  res.flash('success', 'Block saved.');
  res.redirect(ownerHref(block.owner_type, block.owner_id) + '#block-' + block.id);
});

router.post('/:id/move', (req, res, next) => {
  const block = get('SELECT * FROM blocks WHERE id = ?', int(req.params.id));
  if (!block) return next();
  moveBlock(block.id, req.body.direction === 'up' ? 'up' : 'down');
  res.redirect(ownerHref(block.owner_type, block.owner_id) + '#block-' + block.id);
});

router.post('/:id/delete', (req, res, next) => {
  const block = get('SELECT * FROM blocks WHERE id = ?', int(req.params.id));
  if (!block) return next();
  deleteBlock(block.id);
  res.flash('success', 'Block deleted.');
  res.redirect(ownerHref(block.owner_type, block.owner_id) + '#content-blocks');
});

export default router;
