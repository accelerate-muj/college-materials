'use strict';

/**
 * The PYQ archive's view layer.
 *
 * Three screens, selected by the URL hash:
 *
 *   #/                        pick a year
 *   #/second-year             pick a branch (only for a branched year)
 *   #/second-year/cse         the papers themselves
 *
 * Hash routing rather than a page per branch: there are four years and fourteen
 * branches, so real pages would mean ~43 near-identical HTML files to keep in
 * sync by hand. Hash routing also survives being opened over file://, which
 * path-based routing does not — and opening the file directly is how most
 * contributors will check their own change before pushing.
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

  function findYear(yearId) {
    return catalogue.years.find(function (year) {
      return year.id === yearId;
    });
  }

  function findBranch(branchId) {
    return catalogue.branches.find(function (branch) {
      return branch.id === branchId;
    });
  }

  function papersFor(yearId, branchId) {
    return collections[PYQ.collectionKey(yearId, branchId)] || [];
  }

  /** How many papers a year holds across every one of its branches. */
  function countForYear(year) {
    if (!year.branched) return papersFor(year.id, null).length;
    return catalogue.branches.reduce(function (total, branch) {
      return total + papersFor(year.id, branch.id).length;
    }, 0);
  }

  function countLabel(count) {
    if (count === 0) return 'No papers yet';
    return count + (count === 1 ? ' paper' : ' papers');
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

  /* --- Screen: pick a year ----------------------------------------------- */

  function yearScreen() {
    const cards = catalogue.years
      .slice()
      .sort(function (a, b) {
        return a.ordinal - b.ordinal;
      })
      .map(function (year) {
        const meta = year.branched
          ? catalogue.branches.length + ' branches · semesters ' + year.semesters.join(' & ')
          : 'Common to all branches · semesters ' + year.semesters.join(' & ');
        return card('#/' + year.id, year.name, meta, countForYear(year));
      });

    return [
      prompt('find ./pyq -name "*.pdf"'),
      el('h1', {}, ['Past year papers. ', el('span', { class: 'accent', text: 'All of them.' })]),
      el('p', {
        class: 'lede',
        text:
          'Mid-term and end-term papers for Manipal University Jaipur, organised by year of study. ' +
          'Pick your year to start.',
      }),
      trajectory(),
      el('ul', { class: 'card-grid' }, cards),
      el('div', { class: 'empty-actions' }, [
        el('a', { class: 'btn-cta', href: 'add/', text: 'Add a paper' }),
        el('span', { class: 'card-meta', text: 'Scan it with your phone, or upload what you have.' }),
      ]),
    ];
  }

  /* --- Screen: pick a branch --------------------------------------------- */

  function branchScreen(year) {
    const nodes = [
      breadcrumb([
        { label: 'PYQ Archive', href: '#/' },
        { label: year.name },
      ]),
      prompt('cd ./pyq/' + year.id),
      el('h1', { text: year.name }),
      el('p', {
        class: 'lede',
        text: 'Semesters ' + year.semesters.join(' and ') + '. Pick your branch.',
      }),
    ];

    // Grouped so a fourteen-item list reads as two short ones.
    catalogue.branchGroups.forEach(function (group) {
      const branches = catalogue.branches.filter(function (branch) {
        return branch.group === group.id;
      });
      if (branches.length === 0) return;

      const headingId = 'group-' + group.id;
      nodes.push(el('h2', { class: 'group-heading', id: headingId, text: group.name }));
      nodes.push(
        el(
          'ul',
          { class: 'card-grid', 'aria-labelledby': headingId },
          branches.map(function (branch) {
            return card(
              '#/' + year.id + '/' + branch.id,
              branch.short,
              branch.short === branch.name ? null : branch.name,
              papersFor(year.id, branch.id).length
            );
          })
        )
      );
    });

    return nodes;
  }

  /* --- Screen: the papers ------------------------------------------------- */

  function paperNode(paper) {
    const label = [paper.exam, paper.year].join(' ');
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

  function subjectNode(group) {
    return el('article', { class: 'subject' }, [
      el('h3', { text: group.subject }),
      group.code ? el('p', { class: 'subject-code', text: group.code }) : null,
      el('ul', { class: 'paper-list' }, group.papers.map(paperNode)),
    ]);
  }

  /** Deep-links the scanner straight to the collection the reader is looking at. */
  function addUrl(year, branch) {
    const params = new URLSearchParams({ year: year.id });
    if (branch) params.set('branch', branch.id);
    return 'add/?' + params.toString();
  }

  function emptyState(year, branch) {
    return el('div', { class: 'empty' }, [
      el('h2', { text: 'No papers here yet' }),
      el('p', {
        text:
          'Nobody has added a ' +
          (branch ? branch.short + ' ' : '') +
          year.name.toLowerCase() +
          ' paper yet. If you have one in front of you, photographing it takes about a minute.',
      }),
      el('div', { class: 'empty-actions' }, [
        el('a', { class: 'btn-cta', href: addUrl(year, branch), text: 'Add a paper' }),
      ]),
      el('p', { class: 'card-meta' }, [
        'Prefer to do it by hand? ',
        el('a', { href: REPO + '/blob/main/CONTRIBUTING.md', text: 'The contributing guide' }),
        ' covers the JSON entry — it is four lines.',
      ]),
    ]);
  }

  function papersScreen(year, branch) {
    const papers = papersFor(year.id, branch ? branch.id : null);

    const trail = [{ label: 'PYQ Archive', href: '#/' }];
    if (branch) {
      trail.push({ label: year.name, href: '#/' + year.id });
      trail.push({ label: branch.short });
    } else {
      trail.push({ label: year.name });
    }

    const heading = branch ? branch.short + ' — ' + year.name : year.name;
    const lede = branch
      ? branch.name + ', semesters ' + year.semesters.join(' and ') + '.'
      : year.note || 'Semesters ' + year.semesters.join(' and ') + '.';

    const nodes = [
      breadcrumb(trail),
      prompt('ls ./pyq/' + PYQ.collectionKey(year.id, branch ? branch.id : null)),
      el('h1', { text: heading }),
      el('p', { class: 'lede', text: lede }),
    ];

    if (papers.length === 0) {
      nodes.push(emptyState(year, branch));
      return nodes;
    }

    const groups = PYQ.groupBySubject(papers);
    nodes.push(
      el('p', { class: 'group-heading', text: countLabel(papers.length) + ' · ' + groups.length + ' subjects' })
    );
    groups.forEach(function (group) {
      nodes.push(subjectNode(group));
    });

    // A reader who did not find what they wanted is the likeliest contributor.
    nodes.push(
      el('div', { class: 'empty-actions' }, [
        el('a', { class: 'btn-cta', href: addUrl(year, branch), text: 'Add a paper' }),
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

  function parseRoute() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash.split('/').filter(function (part) {
      return part.length > 0;
    });
  }

  function route() {
    const parts = parseRoute();

    if (parts.length === 0) {
      document.title = 'Past Year Question Papers — Accelerate';
      render(yearScreen());
      return;
    }

    const year = findYear(parts[0]);
    if (!year) {
      render(notFoundScreen('year called "' + parts[0] + '"'));
      return;
    }

    // An unbranched year has no branch layer to pick from, so it goes straight
    // to its papers.
    if (parts.length === 1) {
      document.title = year.name + ' — PYQ Archive';
      render(year.branched ? branchScreen(year) : papersScreen(year, null));
      return;
    }

    if (!year.branched) {
      render(notFoundScreen(year.name + ' branch — that year is common to every branch'));
      return;
    }

    const branch = findBranch(parts[1]);
    if (!branch) {
      render(notFoundScreen('branch called "' + parts[1] + '"'));
      return;
    }

    document.title = branch.short + ' ' + year.name + ' — PYQ Archive';
    render(papersScreen(year, branch));
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
