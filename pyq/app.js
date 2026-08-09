'use strict';

/**
 * The PYQ archive's view layer.
 *
 * Four screens, selected by the URL hash:
 *
 *   #/                        pick a programme
 *   #/btech                   pick a year
 *   #/btech/year-3            pick a specialisation (only where the year splits)
 *   #/btech/year-3/cse-aiml   the papers themselves
 *
 * Hash routing rather than a page per collection: the catalogue implies over a
 * hundred collections, so real pages would mean a hundred near-identical HTML
 * files to keep in sync by hand. Hash routing also survives being opened over
 * file://, which path-based routing does not — and opening the file directly is
 * how most contributors will check their own change before pushing.
 *
 * Everything is built with createElement/textContent rather than innerHTML.
 * Paper titles and contributor handles come from contributed JSON, and string
 * concatenation into innerHTML is how that becomes an XSS hole.
 */

(function () {
  const PYQ = window.PYQ;
  const DATA = window.PYQ_DATA;
  const root = document.getElementById('app');

  if (!DATA || !DATA.catalogue) {
    render(errorScreen());
    return;
  }

  const catalogue = DATA.catalogue;
  const collections = DATA.collections || {};

  const REPO = 'https://github.com/accelerate-muj/college-materials';

  /* --- Small DOM helpers ------------------------------------------------- */

  function el(tag, attributes, children) {
    const node = document.createElement(tag);

    Object.keys(attributes || {}).forEach(function (name) {
      const value = attributes[name];
      if (value === null || value === undefined || value === false) return;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else node.setAttribute(name, value === true ? '' : String(value));
    });

    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });

    return node;
  }

  function render(nodes) {
    root.textContent = '';
    nodes.forEach(function (node) {
      root.appendChild(node);
    });
  }

  /* --- Lookups ----------------------------------------------------------- */

  function papersFor(programme, year, branchId) {
    return collections[PYQ.collectionKey(programme.id, year, branchId)] || [];
  }

  /** How many papers one year of a programme holds, across all its branches. */
  function countForYear(programme, year) {
    if (!PYQ.isBranched(programme, year)) return papersFor(programme, year, null).length;
    return programme.branches.reduce(function (total, branch) {
      return total + papersFor(programme, year, branch.id).length;
    }, 0);
  }

  function countForProgramme(programme) {
    let total = 0;
    for (let year = 1; year <= programme.years; year += 1) total += countForYear(programme, year);
    return total;
  }

  function countLabel(count) {
    if (count === 0) return 'No papers yet';
    return count + (count === 1 ? ' paper' : ' papers');
  }

  /** "4 years · 15 specialisations" — what a programme card says about itself. */
  function programmeMeta(programme) {
    const parts = [programme.years + (programme.years === 1 ? ' year' : ' years')];
    if (programme.branches && programme.branches.length > 0) {
      parts.push(programme.branches.length + ' specialisations');
    }
    return parts.join(' · ');
  }

  function groupName(groupId) {
    const group = (catalogue.programmeGroups || []).find(function (candidate) {
      return candidate.id === groupId;
    });
    return group ? group.name : 'Other programmes';
  }

  /* --- Shared chrome ----------------------------------------------------- */

  function breadcrumb(trail) {
    return el('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' }, [
      el(
        'ol',
        {},
        trail.map(function (step, index) {
          const isLast = index === trail.length - 1;
          return el('li', {}, [
            isLast
              ? el('span', { 'aria-current': 'page', text: step.label })
              : el('a', { href: step.href, text: step.label }),
          ]);
        })
      ),
    ]);
  }

  function card(href, title, meta, count) {
    return el('li', {}, [
      el('a', { class: 'card', href: href }, [
        el('span', { class: 'card-title', text: title }),
        meta ? el('span', { class: 'card-meta', text: meta }) : null,
        el('span', { class: 'card-count', 'data-empty': count === 0 ? 'true' : 'false', text: countLabel(count) }),
      ]),
    ]);
  }

  /**
   * The shell-prompt eyebrow. The "$ " is added by CSS rather than written
   * here, so a screen reader reads the label and not the prompt character.
   */
  function prompt(text) {
    return el('p', { class: 'prompt', text: text });
  }

  function trajectory() {
    return el('hr', { class: 'trajectory' });
  }

  /* --- Screen: pick a programme ------------------------------------------ */

  function programmeScreen() {
    const nodes = [
      prompt('find ./pyq -name "*.pdf"'),
      el('h1', {}, ['Past year papers. ', el('span', { class: 'accent', text: 'All of them.' })]),
      el('p', {
        class: 'lede',
        text:
          'Mid-term and end-term papers from across Manipal University Jaipur — every programme, ' +
          'not just engineering. Pick yours to start.',
      }),
      trajectory(),
    ];

    // Grouped, because twenty-odd programmes as one list is a wall.
    (catalogue.programmeGroups || []).forEach(function (group) {
      const programmes = catalogue.programmes.filter(function (programme) {
        return programme.group === group.id;
      });
      if (programmes.length === 0) return;

      const headingId = 'group-' + group.id;
      nodes.push(el('h2', { class: 'group-heading', id: headingId, text: group.name }));
      nodes.push(
        el(
          'ul',
          { class: 'card-grid', 'aria-labelledby': headingId },
          programmes.map(function (programme) {
            return card('#/' + programme.id, programme.short, programme.name, countForProgramme(programme));
          })
        )
      );
    });

    nodes.push(
      el('div', { class: 'empty-actions' }, [
        el('a', { class: 'btn-cta', href: 'add/', text: 'Add a paper' }),
        el('span', { class: 'card-meta', text: 'Scan it with your phone, or upload what you have.' }),
      ])
    );

    return nodes;
  }

  /* --- Screen: pick a year ----------------------------------------------- */

  function yearScreen(programme) {
    const cards = [];
    for (let year = 1; year <= programme.years; year += 1) {
      const semesters = PYQ.semestersFor(year);
      const meta = PYQ.isBranched(programme, year)
        ? programme.branches.length + ' specialisations · semesters ' + semesters.join(' & ')
        : 'Semesters ' + semesters.join(' & ');
      cards.push(card('#/' + programme.id + '/' + PYQ.yearId(year), PYQ.yearName(year), meta, countForYear(programme, year)));
    }

    return [
      breadcrumb([{ label: 'PYQ Archive', href: '#/' }, { label: programme.short }]),
      prompt('cd ./pyq/' + programme.id),
      el('h1', { text: programme.short }),
      el('p', { class: 'lede', text: programme.name + '. ' + programmeMeta(programme) + '. Pick your year.' }),
      trajectory(),
      el('ul', { class: 'card-grid' }, cards),
    ];
  }

  /* --- Screen: pick a specialisation -------------------------------------- */

  function branchScreen(programme, year) {
    return [
      breadcrumb([
        { label: 'PYQ Archive', href: '#/' },
        { label: programme.short, href: '#/' + programme.id },
        { label: PYQ.yearName(year) },
      ]),
      prompt('cd ./pyq/' + programme.id + '/' + PYQ.yearId(year)),
      el('h1', { text: PYQ.yearName(year) + ' — ' + programme.short }),
      el('p', {
        class: 'lede',
        text: 'Semesters ' + PYQ.semestersFor(year).join(' and ') + '. Pick your specialisation.',
      }),
      el(
        'ul',
        { class: 'card-grid' },
        programme.branches.map(function (branch) {
          return card(
            '#/' + programme.id + '/' + PYQ.yearId(year) + '/' + branch.id,
            branch.short,
            branch.short === branch.name ? null : branch.name,
            papersFor(programme, year, branch.id).length
          );
        })
      ),
    ];
  }

  /* --- Screen: the papers ------------------------------------------------- */

  function paperNode(paper) {
    const detail = [];
    if (paper.semester) detail.push('semester ' + paper.semester);
    if (paper.pages) detail.push(paper.pages + ' pages');
    if (paper.contributor) detail.push('added by ' + paper.contributor);

    const isExternal = Boolean(paper.url);

    return el('li', {}, [
      el(
        'a',
        {
          class: 'paper-link',
          href: PYQ.paperHref(paper, '../'),
          // Contributed links point off-site; opening in a new tab keeps the
          // archive open, and noopener stops the target reaching window.opener.
          target: isExternal ? '_blank' : null,
          rel: isExternal ? 'noopener noreferrer' : null,
          // The visible text is "MTE 2024", which is meaningless read alone in
          // a screen-reader's link list, so the accessible name is fuller.
          'aria-label':
            paper.exam +
            ' ' +
            paper.year +
            ' — ' +
            paper.subject +
            (detail.length ? ' (' + detail.join(', ') + ')' : '') +
            (isExternal ? ', opens in a new tab' : ''),
          title: paper.notes || null,
        },
        [
          el('span', { class: 'paper-exam', text: paper.exam }),
          el('span', { class: 'paper-year', text: String(paper.year) }),
        ]
      ),
    ]);
  }

  /**
   * Per-exam "add" chips on a subject card.
   *
   * This is the shortest path in the whole archive: the reader is looking at
   * a subject inside a collection, so programme, year, branch, subject, code
   * and exam are all already known. The link carries every one of them, which
   * means the scanner has nothing left to ask and opens straight on the camera.
   *
   * Only exam types that are missing for this subject are offered — an "add
   * MTE" chip next to three existing MTE papers is noise.
   */
  function addChips(programme, year, branch, group) {
    const have = new Set(
      group.papers.map(function (paper) {
        return paper.exam;
      })
    );

    const missing = catalogue.examTypes.filter(function (type) {
      return !have.has(type.id);
    });
    if (missing.length === 0) return null;

    const context = { subject: group.subject, code: group.code || '' };

    return el('div', { class: 'subject-add' }, [
      el('span', { class: 'subject-add-label', text: 'Add' }),
      el(
        'ul',
        { class: 'paper-list' },
        missing.map(function (type) {
          return el('li', {}, [
            el('a', {
              class: 'add-chip',
              href: addUrl(programme, year, branch, Object.assign({ exam: type.id }, context)),
              text: type.id,
              'aria-label': 'Add a ' + type.name + ' paper for ' + group.subject,
            }),
          ]);
        })
      ),
    ]);
  }

  function subjectNode(programme, year, branch, group) {
    return el('article', { class: 'subject' }, [
      el('h3', { text: group.subject }),
      group.code ? el('p', { class: 'subject-code', text: group.code }) : null,
      el('ul', { class: 'paper-list' }, group.papers.map(paperNode)),
      addChips(programme, year, branch, group),
    ]);
  }

  /**
   * Deep-links the scanner with everything this screen already knows.
   *
   * The scanner skips any step the URL answers, so the more context a link
   * carries the less form a contributor sees. From a subject card with an exam
   * type, that is nothing at all — it opens on the camera.
   */
  function addUrl(programme, year, branch, extra) {
    const params = new URLSearchParams({ programme: programme.id, year: String(year) });
    if (branch) params.set('branch', branch.id);
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key]) params.set(key, extra[key]);
    });
    return 'add/?' + params.toString();
  }

  function emptyState(programme, year, branch) {
    const what = programme.short + ' ' + PYQ.yearName(year).toLowerCase() + (branch ? ' ' + branch.short : '');

    return el('div', { class: 'empty' }, [
      el('h2', { text: 'No papers here yet' }),
      el('p', {
        text:
          'Nobody has added a ' + what + ' paper yet. If you have one in front of you, ' +
          'photographing it takes about a minute.',
      }),
      el('div', { class: 'empty-actions' }, [
        el('a', { class: 'btn-cta', href: addUrl(programme, year, branch), text: 'Add a paper' }),
      ]),
      el('p', { class: 'card-meta' }, [
        'Prefer to do it by hand? ',
        el('a', { href: REPO + '/blob/main/CONTRIBUTING.md', text: 'The contributing guide' }),
        ' covers the JSON entry — it is four lines.',
      ]),
    ]);
  }

  function papersScreen(programme, year, branch) {
    const papers = papersFor(programme, year, branch ? branch.id : null);

    const trail = [
      { label: 'PYQ Archive', href: '#/' },
      { label: programme.short, href: '#/' + programme.id },
    ];
    if (branch) {
      trail.push({ label: PYQ.yearName(year), href: '#/' + programme.id + '/' + PYQ.yearId(year) });
      trail.push({ label: branch.short });
    } else {
      trail.push({ label: PYQ.yearName(year) });
    }

    const heading = branch
      ? branch.short + ' — ' + PYQ.yearName(year)
      : PYQ.yearName(year) + ' — ' + programme.short;

    // Three cases: a specialisation names itself, a common year of a branched
    // programme explains why it has no specialisation, and everything else
    // just names the degree.
    const context = branch
      ? branch.name
      : programme.branches && programme.branches.length
        ? programme.note || 'Common to every specialisation.'
        : programme.name;
    const lede = context.replace(/\.?$/, '.') + ' Semesters ' + PYQ.semestersFor(year).join(' and ') + '.';

    const nodes = [
      breadcrumb(trail),
      prompt('ls ./pyq/' + PYQ.collectionKey(programme.id, year, branch ? branch.id : null)),
      el('h1', { text: heading }),
      el('p', { class: 'lede', text: lede }),
    ];

    if (papers.length === 0) {
      nodes.push(emptyState(programme, year, branch));
      return nodes;
    }

    const groups = PYQ.groupBySubject(papers);
    nodes.push(
      el('p', { class: 'group-heading', text: countLabel(papers.length) + ' · ' + groups.length + ' subjects' })
    );
    groups.forEach(function (group) {
      nodes.push(subjectNode(programme, year, branch, group));
    });

    // A reader who did not find what they wanted is the likeliest contributor.
    nodes.push(
      el('div', { class: 'empty-actions' }, [
        el('a', { class: 'btn-cta', href: addUrl(programme, year, branch), text: 'Add a paper' }),
      ])
    );

    return nodes;
  }

  /* --- Screens: failure modes -------------------------------------------- */

  function notFoundScreen(what) {
    return [
      breadcrumb([{ label: 'PYQ Archive', href: '#/' }, { label: 'Not found' }]),
      prompt('cat: no such file or directory'),
      el('h1', {}, ['Not ', el('span', { class: 'accent', text: 'found.' })]),
      el('p', { class: 'lede', text: 'There is no ' + what + ' in the archive.' }),
      el('p', {}, [el('a', { href: '#/', text: 'Back to the archive' })]),
    ];
  }

  function errorScreen() {
    return [
      prompt('build.js: pyq/data.js not found'),
      el('h1', {}, ['Archive ', el('span', { class: 'accent', text: 'not loaded.' })]),
      el('p', {
        class: 'lede',
        text: 'The archive data failed to load. pyq/data.js is generated by build.js — if you are running this from a checkout, run "node build.js" first.',
      }),
      el('p', {}, [el('a', { href: REPO, text: 'Browse the papers on GitHub instead' })]),
    ];
  }

  /* --- Routing ------------------------------------------------------------ */

  /**
   * The archive was B.Tech-only for its first few days, and those links are
   * out there. Rewriting them costs four lines and beats a 404.
   */
  const LEGACY_YEARS = { 'first-year': 1, 'second-year': 2, 'third-year': 3, 'fourth-year': 4 };

  function upgradeLegacyRoute(parts) {
    if (parts.length === 0 || !Object.prototype.hasOwnProperty.call(LEGACY_YEARS, parts[0])) return null;
    const upgraded = ['btech', PYQ.yearId(LEGACY_YEARS[parts[0]])];
    if (parts[1]) upgraded.push(parts[1]);
    return upgraded;
  }

  function parseRoute() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash.split('/').filter(function (part) {
      return part.length > 0;
    });
  }

  function route() {
    let parts = parseRoute();

    const upgraded = upgradeLegacyRoute(parts);
    if (upgraded) {
      window.location.replace('#/' + upgraded.join('/'));
      return;
    }

    if (parts.length === 0) {
      document.title = 'Past Year Question Papers — Accelerate';
      render(programmeScreen());
      return;
    }

    const programme = PYQ.findProgramme(catalogue, parts[0]);
    if (!programme) {
      render(notFoundScreen('programme called "' + parts[0] + '"'));
      return;
    }

    if (parts.length === 1) {
      document.title = programme.short + ' — PYQ Archive';
      render(yearScreen(programme));
      return;
    }

    const year = PYQ.parseYearId(parts[1]);
    if (!year || year > programme.years) {
      render(notFoundScreen(programme.short + ' year "' + parts[1] + '"'));
      return;
    }

    // A year with no specialisations has no layer to pick from, so it goes
    // straight to its papers.
    if (parts.length === 2) {
      document.title = PYQ.yearName(year) + ' ' + programme.short + ' — PYQ Archive';
      render(PYQ.isBranched(programme, year) ? branchScreen(programme, year) : papersScreen(programme, year, null));
      return;
    }

    if (!PYQ.isBranched(programme, year)) {
      render(notFoundScreen(programme.short + ' ' + PYQ.yearName(year).toLowerCase() + ' specialisation — that year is not split'));
      return;
    }

    const branch = PYQ.findBranch(programme, parts[2]);
    if (!branch) {
      render(notFoundScreen(programme.short + ' specialisation called "' + parts[2] + '"'));
      return;
    }

    document.title = branch.short + ' ' + PYQ.yearName(year) + ' — PYQ Archive';
    render(papersScreen(programme, year, branch));
  }

  /**
   * Moving focus to <main> on navigation is what makes hash routing usable with
   * a keyboard or screen reader: without it, focus stays on the link that was
   * just clicked and the new screen is never announced.
   */
  function routeAndFocus() {
    route();
    const main = document.getElementById('main');
    if (main) main.focus();
  }

  window.addEventListener('hashchange', routeAndFocus);

  // The first render must not steal focus — the user has not navigated yet.
  route();
})();
