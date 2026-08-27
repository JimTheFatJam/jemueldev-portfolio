import { Router } from 'express';
import multer from 'multer';
import {
  storeUpload,
  listMedia,
  getMedia,
  deleteMedia,
  updateMediaAlt,
  findMediaUsage,
  ACCEPTED_MIME,
  MAX_UPLOAD_BYTES
} from '../../lib/media.js';
import { str, int, bool } from '../../lib/validate.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!ACCEPTED_MIME.includes(file.mimetype)) {
      return cb(Object.assign(new Error(`${file.originalname}: unsupported file type.`), { status: 400 }));
    }
    cb(null, true);
  }
});

router.get('/', (req, res) => {
  const search = str(req.query.q, 80);
  res.render('admin/media/list', {
    pageTitle: 'Media',
    section: 'media',
    items: listMedia({ search }),
    search,
    maxBytes: MAX_UPLOAD_BYTES
  });
});

router.post('/upload', upload.array('files', 12), async (req, res, next) => {
  try {
    // multipart bodies are parsed by multer, so the CSRF check happens here.
    req.assertCsrf();

    const files = req.files || [];
    if (files.length === 0) {
      res.flash('error', 'Choose at least one file to upload.');
      return res.redirect('/admin/media');
    }

    const alt = str(req.body.alt, 300);
    const saved = [];
    const failed = [];
    for (const file of files) {
      try {
        saved.push(
          await storeUpload({
            buffer: file.buffer,
            originalName: file.originalname,
            mimetype: file.mimetype,
            alt: files.length === 1 ? alt : ''
          })
        );
      } catch (err) {
        failed.push(`${file.originalname}: ${err.message}`);
      }
    }

    if (req.get('accept')?.includes('application/json')) {
      return res.json({ media: saved, errors: failed });
    }
    if (failed.length) res.flash('error', failed.join(' '));
    else res.flash('success', `Uploaded ${saved.length} file${saved.length === 1 ? '' : 's'}.`);
    res.redirect('/admin/media');
  } catch (err) {
    next(err);
  }
});

/** HTML fragment used by the media picker dialog in the editors. */
router.get('/picker', (req, res) => {
  const multiple = bool(req.query.multiple);
  const search = str(req.query.q, 80);
  res.render('admin/media/picker', {
    layout: false,
    items: listMedia({ search, limit: 200 }).filter((item) => item.isImage || bool(req.query.docs)),
    multiple,
    search
  });
});

router.post('/:id/alt', (req, res, next) => {
  const media = getMedia(int(req.params.id));
  if (!media) return next();
  updateMediaAlt(media.id, str(req.body.alt, 300));
  res.flash('success', 'Alt text updated.');
  res.redirect('/admin/media');
});

router.post('/:id/delete', async (req, res, next) => {
  try {
    const media = getMedia(int(req.params.id));
    if (!media) return next();

    const usage = findMediaUsage(media.id);
    if (usage.length > 0 && !bool(req.body.force)) {
      res.flash(
        'error',
        `“${media.original_name}” is still used in ${usage.length} place${usage.length === 1 ? '' : 's'} ` +
          `(${[...new Set(usage.map((item) => item.label))].join(', ')}). Remove it there first, or confirm to force delete.`
      );
      return res.redirect('/admin/media?highlight=' + media.id);
    }

    await deleteMedia(media.id);
    res.flash('success', `Deleted “${media.original_name}”.`);
    res.redirect('/admin/media');
  } catch (err) {
    next(err);
  }
});

export default router;
