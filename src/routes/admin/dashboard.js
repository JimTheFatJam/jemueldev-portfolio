import { Router } from 'express';
import { contentCounts, listProjects, listResearch } from '../../lib/content.js';
import { getSettings } from '../../lib/settings.js';

const router = Router();

router.get('/', (req, res) => {
  const counts = contentCounts();
  const settings = getSettings();

  const checklist = [
    { label: 'Add your name and tagline', done: Boolean(settings.site.name && settings.site.name !== 'Your Name'), href: '/admin/settings' },
    { label: 'Write your hero introduction', done: Boolean(settings.hero.intro), href: '/admin/settings/hero' },
    { label: 'Write your about section', done: Boolean(settings.about.body), href: '/admin/settings/about' },
    { label: 'Publish at least one project', done: counts.projectsPublished > 0, href: '/admin/projects' },
    { label: 'Feature a project on the homepage', done: counts.projectsFeatured > 0, href: '/admin/projects' },
    { label: 'Add your skills', done: counts.skills > 0, href: '/admin/skills' },
    { label: 'Add your education', done: counts.education > 0, href: '/admin/education' },
    { label: 'Add contact links', done: Boolean(settings.site.email || settings.site.github), href: '/admin/settings' }
  ];

  res.render('admin/dashboard', {
    pageTitle: 'Dashboard',
    section: 'dashboard',
    counts,
    checklist,
    remaining: checklist.filter((item) => !item.done).length,
    recentProjects: listProjects().slice(0, 5),
    drafts: [
      ...listProjects({ status: 'draft' }).map((item) => ({ ...item, kind: 'Project', editHref: '/admin/projects/' + item.id })),
      ...listResearch({ status: 'draft' }).map((item) => ({ ...item, kind: 'Research', editHref: '/admin/research/' + item.id }))
    ].slice(0, 6)
  });
});

/** Preview the live site inside the admin, at a chosen viewport width. */
router.get('/preview', (req, res) => {
  const target = String(req.query.path || '/');
  const path = target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/admin') ? target : '/';
  const device = ['mobile', 'tablet', 'desktop'].includes(req.query.device) ? req.query.device : 'desktop';

  res.render('admin/preview', {
    pageTitle: 'Preview',
    section: 'preview',
    previewPath: path,
    device,
    projects: listProjects(),
    research: listResearch()
  });
});

export default router;
