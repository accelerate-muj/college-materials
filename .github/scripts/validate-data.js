#!/usr/bin/env node
'use strict';

/**
 * Validates every committed data/pyq file against the rules in src/pyq.js.
 *
 * Run by .github/workflows/ci.yml, or directly:
 *   node .github/scripts/validate-data.js
 *
 * Reuses src/pyq.js rather than restating the rules, so the site, the build and
 * this gate cannot disagree about what a valid paper is.
 */

const fs = require('fs');
const path = require('path');

const PYQ = require('../../src/pyq.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_ROOT = path.join(REPO_ROOT, PYQ.DATA_DIR);

const errors = [];
const seenIds = new Map(); // id -> first file it appeared in
let papersChecked = 0;

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
  } catch (error) {
    errors.push(relativePath + ': not valid JSON — ' + error.message);
    return null;
  }
}

const cataloguePath = PYQ.DATA_DIR + '/catalogue.json';
const subjectsPath = PYQ.DATA_DIR + '/subjects.json';
const catalogue = readJson(cataloguePath);

if (!catalogue) {
  console.error(errors.join('\n'));
  process.exit(1);
}

/* --- The catalogue itself, before anything that depends on it ------------ */

const yearIds = new Set();
(catalogue.years || []).forEach(function (year) {
  if (yearIds.has(year.id)) errors.push(cataloguePath + ': duplicate year id "' + year.id + '"');
  yearIds.add(year.id);
});

const branchIds = new Set();
const groupIds = new Set((catalogue.branchGroups || []).map((group) => group.id));
(catalogue.branches || []).forEach(function (branch) {
  if (branchIds.has(branch.id)) errors.push(cataloguePath + ': duplicate branch id "' + branch.id + '"');
  branchIds.add(branch.id);

  if (!groupIds.has(branch.group)) {
    errors.push(cataloguePath + ': branch "' + branch.id + '" references unknown group "' + branch.group + '"');
  }
});

if (branchIds.size === 0) errors.push(cataloguePath + ': no branches defined');

/* --- Every paper collection the catalogue implies ------------------------ */

const expected = PYQ.expectedCollections(catalogue);
const expectedPaths = new Set(expected.map((collection) => PYQ.collectionPath(collection.yearId, collection.branchId)));

expected.forEach(function (collection) {
  const relativePath = PYQ.collectionPath(collection.yearId, collection.branchId);
  if (!fs.existsSync(path.join(REPO_ROOT, relativePath))) return; // not yet contributed to

  const papers = readJson(relativePath);
  if (papers === null) return;

  if (!Array.isArray(papers)) {
    errors.push(relativePath + ': expected an array of papers');
    return;
  }

  const year = catalogue.years.find((candidate) => candidate.id === collection.yearId);

  papers.forEach(function (paper, index) {
    papersChecked += 1;
    const where = relativePath + ' [' + index + ']';

    PYQ.validatePaper(paper, { catalogue: catalogue, year: year }).forEach(function (problem) {
      errors.push(where + ': ' + problem);
    });

    if (paper && paper.id) {
      if (seenIds.has(paper.id)) {
        errors.push(where + ': duplicate id "' + paper.id + '" (already defined in ' + seenIds.get(paper.id) + ')');
      } else {
        seenIds.set(paper.id, relativePath);
      }
    }

    // A `file` entry that points at a PDF nobody committed renders as a dead
    // link on the live site, which is worse than no entry at all.
    if (paper && paper.file && !fs.existsSync(path.join(REPO_ROOT, paper.file))) {
      errors.push(where + ': file "' + paper.file + '" is not committed to the repository');
    }
  });
});

/* --- Stray files ---------------------------------------------------------
 * A paper filed under a misspelled branch is invisible on the site and silently
 * ignored by the build, so it has to be an error rather than a shrug.
 */

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(function (entry) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return [absolute];
  });
}

walk(DATA_ROOT).forEach(function (absolute) {
  const relativePath = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
  if (relativePath === cataloguePath || relativePath === subjectsPath) return;
  if (relativePath.endsWith('README.md') || relativePath.endsWith('TEMPLATE.json')) return;

  if (!relativePath.endsWith('.json')) {
    errors.push(relativePath + ': unexpected non-JSON file under ' + PYQ.DATA_DIR + '/');
    return;
  }

  if (!expectedPaths.has(relativePath)) {
    errors.push(relativePath + ': not a collection the catalogue defines — check the year and branch ids in ' + cataloguePath);
  }
});

/* --- The subject catalogue ------------------------------------------------
 * Feeds the picker in the scanner. A key that is not a real collection means
 * those subjects are offered to nobody, which is silent — so it is an error.
 */

if (fs.existsSync(path.join(REPO_ROOT, subjectsPath))) {
  const subjectsFile = readJson(subjectsPath);
  const subjects = subjectsFile && subjectsFile.subjects;

  if (subjectsFile && (typeof subjects !== 'object' || subjects === null || Array.isArray(subjects))) {
    errors.push(subjectsPath + ': "subjects" must be an object keyed by collection.');
  } else if (subjects) {
    const validKeys = new Set(expected.map((collection) => collection.key));

    Object.keys(subjects).forEach(function (key) {
      if (!validKeys.has(key)) {
        errors.push(subjectsPath + ': "' + key + '" is not a collection the catalogue defines.');
        return;
      }
      const list = subjects[key];
      if (!Array.isArray(list)) {
        errors.push(subjectsPath + ': "' + key + '" must be an array.');
        return;
      }
      const names = new Set();
      list.forEach(function (subject, index) {
        const where = subjectsPath + ' ' + key + '[' + index + ']';
        if (typeof subject !== 'object' || subject === null || Array.isArray(subject)) {
          errors.push(where + ': not an object');
          return;
        }
        if (!subject.name || typeof subject.name !== 'string') errors.push(where + ': needs a "name"');
        if (subject.code !== undefined && !/^[A-Z]{2,4}\s?\d{3,4}$/.test(String(subject.code))) {
          errors.push(where + ': code "' + subject.code + '" does not look like a subject code');
        }
        Object.keys(subject).forEach(function (field) {
          if (['name', 'code'].indexOf(field) === -1) errors.push(where + ': unknown field "' + field + '"');
        });
        const dedupe = String(subject.name || '').trim().toLowerCase();
        if (names.has(dedupe)) errors.push(where + ': "' + subject.name + '" is listed twice');
        names.add(dedupe);
      });
    });
  }
}

/* --- Report -------------------------------------------------------------- */

if (errors.length > 0) {
  errors.forEach((error) => console.error('::error::' + error));
  console.error('\n' + errors.length + ' problem' + (errors.length === 1 ? '' : 's') + ' found.');
  process.exit(1);
}

console.log('Data is valid — ' + papersChecked + ' paper' + (papersChecked === 1 ? '' : 's') + ' across ' + expected.length + ' collections.');
