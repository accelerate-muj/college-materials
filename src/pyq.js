'use strict';

/**
 * The PYQ archive's rules, as pure functions.
 *
 * Nothing here touches the DOM, the filesystem, or any global state, which is
 * what lets the same file be the single source of truth for four callers that
 * otherwise share nothing:
 *
 *   build.js                     bakes data/ into pyq/data.js
 *   .github/scripts/validate-data.js   the CI gate over committed data
 *   tests/pyq.test.js            runs in Node and in a browser
 *   pyq/app.js                   the site itself
 *
 * Restating "what a valid paper looks like" in each of those would let them
 * drift, and the copy that guards contributions is the one that must not.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PYQ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DATA_DIR = 'data/pyq';
  const COMMON_COLLECTION = 'common';

  /** Fields a paper record may carry. Anything else is rejected, not ignored. */
  const KNOWN_FIELDS = ['id', 'subject', 'code', 'semester', 'exam', 'year', 'url', 'file', 'pages', 'contributor', 'notes'];
  const REQUIRED_FIELDS = ['id', 'subject', 'exam', 'year'];

  /**
   * The oldest paper year we will accept. Papers predate the archive, but a
   * three-digit year is a typo rather than a genuinely old paper.
   */
  const EARLIEST_YEAR = 2010;

  /** Ids are used in URLs and as filenames, so keep them boring. */
  const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /** Contributor handles are rendered as links to github.com/<handle>. */
  const HANDLE_PATTERN = /^@[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

  /**
   * Repo-relative paths only, and only under the archive's own directory.
   * Without the containment check a record could point the site at any file in
   * the repository, and `..` segments would let it escape entirely.
   */
  const FILE_PATTERN = /^papers\/[A-Za-z0-9._/-]+\.pdf$/;

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
  }

  /**
   * The storage key for one collection of papers:
   *
   *   btech/year-3/cse-aiml     a branched year of a branched programme
   *   bba/year-1/common         a programme with no specialisations
   *   btech/year-1/common       B.Tech's common first year
   *
   * Also the path under data/pyq, minus the .json — one concept, derived once.
   *
   * Three levels rather than two: the archive covers every MUJ programme, not
   * only B.Tech, and "third year CSE" means nothing without knowing which
   * degree it belongs to.
   */
  function collectionKey(programmeId, yearNumber, branchId) {
    return programmeId + '/' + yearId(yearNumber) + '/' + (branchId || COMMON_COLLECTION);
  }

  function collectionPath(programmeId, yearNumber, branchId) {
    return DATA_DIR + '/' + collectionKey(programmeId, yearNumber, branchId) + '.json';
  }

  function yearId(yearNumber) {
    return 'year-' + yearNumber;
  }

  /** The inverse: "year-3" → 3, anything else → null. */
  function parseYearId(value) {
    const match = /^year-([1-9]\d?)$/.exec(String(value || ''));
    return match ? Number(match[1]) : null;
  }

  /** "Third year". Degrees run to five years here, so no hardcoded list. */
  const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

  function yearName(yearNumber) {
    return (ORDINALS[yearNumber] || 'Year ' + yearNumber) + ' Year';
  }

  /**
   * Year N covers semesters 2N-1 and 2N. True of every programme here, so it
   * is derived rather than listed — one less thing to get out of step.
   */
  function semestersFor(yearNumber) {
    return [yearNumber * 2 - 1, yearNumber * 2];
  }

  /** Does this year of this programme split by specialisation? */
  function isBranched(programme, yearNumber) {
    if (!programme.branches || programme.branches.length === 0) return false;
    return (programme.commonYears || []).indexOf(yearNumber) === -1;
  }

  function findProgramme(catalogue, programmeId) {
    return (catalogue.programmes || []).find(function (programme) {
      return programme.id === programmeId;
    });
  }

  function findBranch(programme, branchId) {
    return ((programme && programme.branches) || []).find(function (branch) {
      return branch.id === branchId;
    });
  }

  /** Parses "btech/year-3/cse-aiml" back into its parts, or null. */
  function parseCollectionKey(key) {
    const match = /^([a-z0-9-]+)\/year-(\d+)\/([a-z0-9-]+)$/.exec(String(key || ''));
    if (!match) return null;
    return {
      programmeId: match[1],
      year: Number(match[2]),
      branchId: match[3] === COMMON_COLLECTION ? null : match[3],
    };
  }

  /** Every collection the catalogue implies, whether or not a file exists yet. */
  function expectedCollections(catalogue) {
    const collections = [];

    (catalogue.programmes || []).forEach(function (programme) {
      for (let year = 1; year <= programme.years; year += 1) {
        if (!isBranched(programme, year)) {
          collections.push({
            programmeId: programme.id,
            year: year,
            branchId: null,
            key: collectionKey(programme.id, year, null),
          });
          continue;
        }
        programme.branches.forEach(function (branch) {
          collections.push({
            programmeId: programme.id,
            year: year,
            branchId: branch.id,
            key: collectionKey(programme.id, year, branch.id),
          });
        });
      }
    });

    return collections;
  }

  /**
   * Checks one paper record against the catalogue it belongs to.
   *
   * Returns an array of human-readable problems — empty means valid. Returning
   * every problem at once rather than throwing on the first keeps a contributor
   * from playing whack-a-mole across repeated CI runs.
   */
  function validatePaper(paper, context) {
    const errors = [];
    const catalogue = (context && context.catalogue) || { examTypes: [] };
    const year = context && context.year;

    if (!isPlainObject(paper)) return ['not an object'];

    REQUIRED_FIELDS.forEach(function (field) {
      if (paper[field] === undefined || paper[field] === null || paper[field] === '') {
        errors.push('missing required field "' + field + '"');
      }
    });

    Object.keys(paper).forEach(function (field) {
      if (KNOWN_FIELDS.indexOf(field) === -1) {
        errors.push('unknown field "' + field + '" (allowed: ' + KNOWN_FIELDS.join(', ') + ')');
      }
    });

    if (paper.id !== undefined && !ID_PATTERN.test(String(paper.id))) {
      errors.push('id "' + paper.id + '" must be lowercase letters, digits and single hyphens');
    }

    if (paper.subject !== undefined && typeof paper.subject !== 'string') {
      errors.push('subject must be a string');
    } else if (typeof paper.subject === 'string' && paper.subject.trim().length > 120) {
      errors.push('subject is longer than 120 characters');
    }

    if (paper.code !== undefined && !/^[A-Z]{2,4}\s?\d{3,4}$/.test(String(paper.code))) {
      errors.push('code "' + paper.code + '" does not look like a subject code (e.g. "CS2001")');
    }

    const examIds = (catalogue.examTypes || []).map(function (type) {
      return type.id;
    });
    if (paper.exam !== undefined && examIds.indexOf(paper.exam) === -1) {
      errors.push('exam "' + paper.exam + '" is not one of: ' + examIds.join(', '));
    }

    const currentYear = (context && context.currentYear) || new Date().getUTCFullYear();
    if (paper.year !== undefined) {
      if (!isInteger(paper.year)) {
        errors.push('year must be a whole number');
      } else if (paper.year < EARLIEST_YEAR || paper.year > currentYear + 1) {
        errors.push('year ' + paper.year + ' is outside ' + EARLIEST_YEAR + '–' + (currentYear + 1));
      }
    }

    if (paper.semester !== undefined) {
      if (!isInteger(paper.semester)) {
        errors.push('semester must be a whole number');
      } else if (year) {
        const allowed = semestersFor(year);
        if (allowed.indexOf(paper.semester) === -1) {
          errors.push('semester ' + paper.semester + ' is not part of ' + yearName(year) + ' (expected ' + allowed.join(' or ') + ')');
        }
      }
    }

    if (paper.url === undefined && paper.file === undefined) {
      errors.push('needs either "url" (a link to the paper) or "file" (a PDF committed under papers/)');
    }

    if (paper.url !== undefined && !/^https:\/\/[^\s]+$/.test(String(paper.url))) {
      errors.push('url must be an https:// link');
    }

    if (paper.file !== undefined && !FILE_PATTERN.test(String(paper.file))) {
      errors.push('file "' + paper.file + '" must be a .pdf path under papers/');
    }

    if (paper.pages !== undefined && (!isInteger(paper.pages) || paper.pages < 1)) {
      errors.push('pages must be a positive whole number');
    }

    if (paper.contributor !== undefined && !HANDLE_PATTERN.test(String(paper.contributor))) {
      errors.push('contributor "' + paper.contributor + '" must be a GitHub handle like "@octocat"');
    }

    if (paper.notes !== undefined && String(paper.notes).length > 280) {
      errors.push('notes is longer than 280 characters');
    }

    return errors;
  }

  /**
   * Newest first, then by semester, then alphabetically — the order a student
   * scanning for "last year's paper" actually wants.
   */
  function sortPapers(papers) {
    return papers.slice().sort(function (a, b) {
      if (a.year !== b.year) return b.year - a.year;
      const semesterA = a.semester || 0;
      const semesterB = b.semester || 0;
      if (semesterA !== semesterB) return semesterA - semesterB;
      return String(a.subject).localeCompare(String(b.subject));
    });
  }

  /** Groups papers by subject, for the per-subject cards the site renders. */
  function groupBySubject(papers) {
    const order = [];
    const bySubject = new Map();

    sortPapers(papers).forEach(function (paper) {
      const key = paper.code ? String(paper.code).replace(/\s+/g, '') : String(paper.subject).toLowerCase();
      if (!bySubject.has(key)) {
        bySubject.set(key, { key: key, subject: paper.subject, code: paper.code || null, papers: [] });
        order.push(key);
      }
      bySubject.get(key).papers.push(paper);
    });

    return order.map(function (key) {
      return bySubject.get(key);
    });
  }

  /** Where a paper actually lives, resolved relative to the site root. */
  function paperHref(paper, rootPrefix) {
    if (paper.url) return paper.url;
    return (rootPrefix || '') + paper.file;
  }

  /**
   * The subjects a contributor can pick from for one collection.
   *
   * Two sources, merged: the curated list in data/pyq/subjects.json, and every
   * subject already present in that collection's papers. The second half is
   * what makes this work while the curated lists are still being filled in from
   * the curriculum — a subject only ever has to be typed once, by whoever files
   * the first paper for it, and it is offered to everyone after that.
   *
   * Matched on code where there is one, else on the lowercased name, so the
   * same subject filed as "CS2001" and "cs2001" does not appear twice.
   */
  function subjectsFor(curated, papers) {
    const seen = new Map();

    function add(subject) {
      if (!subject || !subject.name) return;
      const key = subject.code ? String(subject.code).replace(/\s+/g, '').toUpperCase() : String(subject.name).trim().toLowerCase();
      if (!key) return;
      const existing = seen.get(key);
      // A later entry may know the code where an earlier one did not.
      if (existing) {
        if (!existing.code && subject.code) existing.code = subject.code;
        return;
      }
      seen.set(key, { name: String(subject.name).trim(), code: subject.code ? String(subject.code).replace(/\s+/g, '').toUpperCase() : null });
    }

    (curated || []).forEach(add);
    (papers || []).forEach(function (paper) {
      add({ name: paper.subject, code: paper.code });
    });

    return Array.from(seen.values()).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  return {
    DATA_DIR: DATA_DIR,
    COMMON_COLLECTION: COMMON_COLLECTION,
    EARLIEST_YEAR: EARLIEST_YEAR,
    KNOWN_FIELDS: KNOWN_FIELDS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    collectionKey: collectionKey,
    collectionPath: collectionPath,
    parseCollectionKey: parseCollectionKey,
    expectedCollections: expectedCollections,
    yearId: yearId,
    parseYearId: parseYearId,
    yearName: yearName,
    semestersFor: semestersFor,
    isBranched: isBranched,
    findProgramme: findProgramme,
    findBranch: findBranch,
    validatePaper: validatePaper,
    sortPapers: sortPapers,
    groupBySubject: groupBySubject,
    paperHref: paperHref,
    subjectsFor: subjectsFor,
  };
});
