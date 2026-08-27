/**
 * Placeholder content so the whole site is visible immediately. Everything here
 * is clearly marked as an example and is meant to be replaced from /admin — no
 * real achievements, employers, credentials or results are invented.
 */
import sharp from 'sharp';
import { get, run } from './index.js';
import { storeUpload } from '../lib/media.js';
import { saveGroup } from '../lib/settings.js';
import { createProject, createResearch, nextPosition } from '../lib/content.js';
import { addBlock, updateBlock } from '../lib/blocks.js';

export function hasContent() {
  return (
    get('SELECT COUNT(*) AS n FROM projects').n > 0 ||
    get('SELECT COUNT(*) AS n FROM research').n > 0 ||
    get('SELECT COUNT(*) AS n FROM skill_categories').n > 0
  );
}

/** A neutral placeholder image, generated so the layout is visible at once. */
async function placeholder(label, tone) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
    <rect width="1600" height="1000" fill="${tone.bg}"/>
    <rect x="60" y="60" width="1480" height="880" fill="none" stroke="${tone.line}" stroke-width="2" stroke-dasharray="14 10"/>
    <text x="800" y="480" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"
          font-size="54" fill="${tone.text}">${label}</text>
    <text x="800" y="556" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif"
          font-size="30" fill="${tone.line}">Placeholder — replace in Admin, Media</text>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return storeUpload({
    buffer,
    originalName: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-placeholder.png',
    mimetype: 'image/png',
    alt: label + ' (placeholder image)'
  });
}

const TONES = [
  { bg: '#eef1f6', line: '#c3cbd8', text: '#5c6675' },
  { bg: '#eef3ef', line: '#c1d2c6', text: '#566a5c' },
  { bg: '#f2eff5', line: '#cfc6d8', text: '#655a70' },
  { bg: '#f4f1ea', line: '#d6cdba', text: '#6d6450' }
];

/** Add a block and fill it in one step. */
function block(ownerType, ownerId, type, data) {
  const id = addBlock(ownerType, ownerId, type);
  updateBlock(id, data);
  return id;
}

export async function seed({ force = false, quiet = false } = {}) {
  if (hasContent() && !force) return false;

  if (force) {
    for (const table of ['blocks', 'projects', 'research', 'skills', 'skill_categories', 'education']) {
      run(`DELETE FROM ${table}`);
    }
  }

  const log = quiet ? () => {} : (message) => console.log(message);
  log('Generating placeholder images…');

  const [airImage, webImage, mobileImage, figureImage] = await Promise.all([
    placeholder('Project image', TONES[0]),
    placeholder('Project image', TONES[1]),
    placeholder('Project image', TONES[2]),
    placeholder('Research figure', TONES[3])
  ]);

  // --- settings ------------------------------------------------------------

  saveGroup('site', {
    name: 'Your Name',
    tagline: 'Computer Science Student',
    description:
      'Placeholder introduction — replace this in Admin → Settings with a sentence about who you are and what you build.',
    metaDescription:
      'Computer Science student focused on machine learning and software development. Portfolio of projects and research.',
    email: 'you@example.com',
    github: 'https://github.com/your-username',
    linkedin: 'https://www.linkedin.com/in/your-profile',
    resumeUrl: '',
    baseUrl: ''
  });

  saveGroup('hero', {
    identity: 'Computer Science Student • Machine Learning • Software Development',
    headline: '',
    intro:
      'Placeholder introduction. Replace this in Admin → Settings → Hero: two or three sentences on what you work on, what you are studying, and what you are looking for next.',
    ctaLabel: 'View projects',
    ctaHref: '#projects',
    secondaryCtaLabel: 'Get in touch',
    secondaryCtaHref: '#contact'
  });

  saveGroup('about', {
    heading: 'About',
    body: [
      'This is placeholder text. Edit it in **Admin → Settings → About**.',
      '',
      'A good About section is short: what you study and where, the areas of computing you work in, and the kind of problem you like working on. Two or three paragraphs is plenty.',
      '',
      'You can add images, links and extra content blocks below the text without touching any code.'
    ].join('\n'),
    imageId: null,
    links: []
  });

  saveGroup('contact', {
    heading: "Let's connect.",
    body: 'Replace this line in Admin → Settings → Contact — for example, what kind of role or collaboration you are open to.',
    showEmail: true
  });

  // --- skills --------------------------------------------------------------

  // [display name, devicon icon name]. An empty icon renders no logo — a
  // reminder that the picker is optional, not required.
  const skillSeed = [
    ['Programming Languages', [['Python', 'python'], ['JavaScript', 'javascript'], ['Java', 'java'], ['C', 'c']]],
    ['Machine Learning & Data', [['PyTorch', 'pytorch'], ['scikit-learn', 'scikitlearn'], ['pandas', 'pandas'], ['NumPy', 'numpy']]],
    ['Web & Mobile Development', [['Node.js', 'nodejs'], ['React', 'react'], ['HTML & CSS', 'html5']]],
    ['Databases', [['PostgreSQL', 'postgresql'], ['SQLite', 'sqlite']]],
    ['Geospatial & Scientific Computing', [['GeoPandas', ''], ['QGIS', ''], ['Matplotlib', 'matplotlib']]],
    ['Tools & Technologies', [['Git', 'git'], ['Docker', 'docker'], ['Linux', 'linux']]]
  ];

  for (const [name, skills] of skillSeed) {
    const info = run(
      'INSERT INTO skill_categories (name, visible, position) VALUES (?, 1, ?)',
      name,
      nextPosition('skill_categories')
    );
    const categoryId = Number(info.lastInsertRowid);
    skills.forEach(([skill, icon], index) => {
      run('INSERT INTO skills (category_id, name, icon, position) VALUES (?, ?, ?, ?)', categoryId, skill, icon, index);
    });
  }

  // --- education -----------------------------------------------------------

  run(
    `INSERT INTO education (degree, institution, date_range, description, visible, position)
     VALUES (?, ?, ?, ?, 1, ?)`,
    'BSc Computer Science (placeholder)',
    'Your University',
    '2022 — 2026',
    'Replace this entry in Admin → Education. Mention relevant coursework, your thesis topic, or anything a recruiter should know.',
    nextPosition('education')
  );

  // --- projects ------------------------------------------------------------

  const caseStudyId = createProject({
    slug: 'example-pm25-prediction',
    title: 'Example: PM2.5 prediction pipeline',
    summary: 'Sample project showing how a full case study looks. Replace it with your own.',
    description:
      'This description is placeholder text. It appears above the content blocks on the project page, and Markdown works here — **bold**, _italic_, lists and [links](https://example.com).',
    tech: [{ name: 'Python', icon: 'python' }, { name: 'scikit-learn', icon: 'scikitlearn' }, { name: 'pandas', icon: 'pandas' }, { name: 'GeoPandas', icon: '' }],
    thumbnail_id: airImage.id,
    gallery: [figureImage.id],
    year: '2025',
    github_url: '',
    demo_url: '',
    featured: true,
    status: 'published',
    has_detail_page: true,
    meta_description: 'Example case study demonstrating the project detail page layout.'
  });

  const webProjectId = createProject({
    slug: 'example-web-app',
    title: 'Example: full-stack web application',
    summary: 'A shorter project card. Not every project needs a full case study.',
    description: '',
    tech: [{ name: 'Node.js', icon: 'nodejs' }, { name: 'PostgreSQL', icon: 'postgresql' }, { name: 'React', icon: 'react' }],
    thumbnail_id: webImage.id,
    gallery: [],
    year: '2025',
    github_url: '',
    demo_url: '',
    featured: true,
    status: 'published',
    has_detail_page: false,
    meta_description: ''
  });

  createProject({
    slug: 'example-draft-project',
    title: 'Example: draft project',
    summary: 'This one is a draft, so it does not appear on the public site — only you can see it.',
    description: '',
    tech: [{ name: 'Kotlin', icon: 'kotlin' }],
    thumbnail_id: mobileImage.id,
    gallery: [],
    year: '2026',
    github_url: '',
    demo_url: '',
    featured: false,
    status: 'draft',
    has_detail_page: true,
    meta_description: ''
  });

  block('project', caseStudyId, 'heading', { text: 'Problem', level: '2' });
  block('project', caseStudyId, 'richtext', {
    body: 'Describe the problem you set out to solve, and why it matters. Keep it to a short paragraph — a reader decides here whether to keep going.'
  });
  block('project', caseStudyId, 'heading', { text: 'Approach', level: '2' });
  block('project', caseStudyId, 'richtext', {
    body: 'Explain what you built and the decisions behind it:\n\n- the data or inputs you worked with\n- the models, algorithms or architecture you chose\n- what you deliberately left out'
  });
  block('project', caseStudyId, 'image', {
    mediaId: figureImage.id,
    caption: 'Placeholder figure — swap this for an architecture diagram or a result plot.',
    width: 'wide'
  });
  block('project', caseStudyId, 'heading', { text: 'Implementation', level: '2' });
  block('project', caseStudyId, 'code', {
    language: 'python',
    code: '# Placeholder snippet — show a piece of code that is actually interesting.\ndef rolling_features(frame, window=24):\n    return frame.rolling(window).agg(["mean", "std"])',
    caption: 'Keep snippets short: one idea per block.'
  });
  block('project', caseStudyId, 'heading', { text: 'Results', level: '2' });
  block('project', caseStudyId, 'richtext', {
    body: 'Report what you measured and how. Use real numbers from your own work — this placeholder deliberately contains none.'
  });
  block('project', caseStudyId, 'heading', { text: 'What I learned', level: '3' });
  block('project', caseStudyId, 'richtext', {
    body: 'A short, honest paragraph about what was harder than expected and what you would do differently.'
  });
  block('project', caseStudyId, 'projectRef', { projectId: webProjectId });

  // --- research ------------------------------------------------------------

  const researchId = createResearch({
    slug: 'example-thesis',
    title: 'Example: undergraduate thesis',
    abstract:
      'Placeholder abstract. Replace this in Admin → Research with your own — for example your PM2.5 work: the question, the data, the method, and what you found.',
    authors: 'Your Name',
    institution: 'Your University',
    date: '2026',
    work_status: 'In progress',
    paper_url: '',
    github_url: '',
    links: [],
    keywords: ['Placeholder keyword', 'Replace in Admin'],
    thumbnail_id: figureImage.id,
    gallery: [],
    featured: true,
    status: 'published',
    has_detail_page: true,
    meta_description: 'Example research entry demonstrating the research detail page.'
  });

  block('research', researchId, 'heading', { text: 'Background', level: '2' });
  block('research', researchId, 'richtext', {
    body: 'Set out the context and the gap your work addresses.'
  });
  block('research', researchId, 'heading', { text: 'Method', level: '2' });
  block('research', researchId, 'richtext', {
    body: 'Data sources, preprocessing, models, evaluation protocol — enough that someone could follow your reasoning.'
  });
  block('research', researchId, 'quote', {
    text: 'A pull quote is useful for one key finding. Remove this block if you do not need it.',
    attribution: ''
  });

  return true;
}
