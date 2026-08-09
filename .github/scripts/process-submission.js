#!/usr/bin/env node
'use strict';

/**
 * Turns a paper-submission issue into a pull request.
 *
 * Run by .github/workflows/submission.yml. Reads the issue body from the
 * environment, validates it against the same rules the site and CI use,
 * downloads the attached PDF, writes it plus the JSON entry, regenerates
 * pyq/data.js and emits step outputs for the workflow to commit and open a PR.
 *
 * It never merges anything. A maintainer reviews the pull request.
 *
 * ## Threat model
 *
 * The issue body is written by anyone with a GitHub account, and this script
 * runs with a token that can write to the repository. campus-mapper shipped
 * three separate holes in the equivalent script, so the rules here are:
 *
 *   - Nothing from the issue is interpolated into a shell command. The workflow
 *     passes values in through `env:` and reads outputs through $GITHUB_OUTPUT
 *     with a random delimiter.
 *   - The write path is derived from validated catalogue ids and a sanitised
 *     id, never from anything the submitter typed as a path.
 *   - The download URL must be on GitHub's own attachment hosts, or it is
 *     refused — the token in this process's environment must not be pointed at
 *     an arbitrary server.
 *   - The response must actually be a PDF, under a size cap, or it is refused.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PYQ = require('../../src/pyq.js');
const Submission = require('../../src/submission.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const issueBody = process.env.ISSUE_BODY || '';
const issueNumber = process.env.ISSUE_NUMBER || '';
const issueAuthor = process.env.ISSUE_AUTHOR || '';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

/** Values reach the workflow this way; a random delimiter cannot be forged by content. */
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = 'ghadelim_' + crypto.randomBytes(16).toString('hex');
  fs.appendFileSync(file, name + '<<' + delimiter + '\n' + String(value) + '\n' + delimiter + '\n');
}

/** Ends the run without a PR, leaving a comment explaining why. */
function reject(reasons) {
  const lines = [
    "Thanks for this — the bot could not process it yet.",
    '',
    ...reasons.map(function (reason) {
      return '- ' + reason;
    }),
    '',
    'Edit the issue to fix it and the bot will try again automatically. If the PDF is missing, just drag it into a comment.',
  ];
  setOutput('status', 'rejected');
  setOutput('comment', lines.join('\n'));
  console.log('Rejected:\n' + reasons.join('\n'));
  process.exit(0);
}

/* --- Parse ---------------------------------------------------------------- */

const catalogue = readJson(PYQ.DATA_DIR + '/catalogue.json');

const parsed = Submission.parseBody(issueBody, { catalogue: catalogue });
if (!parsed.ok) reject(parsed.errors);

const attachment = Submission.findAttachment(issueBody);
if (!attachment.ok) reject(attachment.errors);

const submission = parsed.submission;

/* --- Unique id ------------------------------------------------------------
 * Two people submitting the same paper is a normal event, not an error. The
 * suffix keeps both; a maintainer can close the duplicate during review.
 */

function existingIds() {
  const ids = new Set();
  PYQ.expectedCollections(catalogue).forEach(function (collection) {
    const relativePath = PYQ.collectionPath(collection.yearId, collection.branchId);
    const absolute = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(absolute)) return;
    JSON.parse(fs.readFileSync(absolute, 'utf8')).forEach(function (paper) {
      if (paper && paper.id) ids.add(paper.id);
    });
  });
  return ids;
}

const taken = existingIds();
const baseId = submission.paper.id;
let uniqueId = baseId;
let suffix = 2;
while (taken.has(uniqueId)) {
  uniqueId = baseId + '-' + suffix;
  suffix += 1;
}
submission.paper.id = uniqueId;

/* --- Download -------------------------------------------------------------- */

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'accelerate-muj-college-materials-bot' },
  });

  if (!response.ok) {
    reject(['Could not download the attached file (HTTP ' + response.status + '). Try attaching it again.']);
  }

  // Trust the body, not the header: check the declared length if present, then
  // stop reading if the actual bytes exceed the cap anyway.
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > Submission.MAX_BYTES) {
    reject(['The attached file is ' + Math.round(declared / 1048576) + ' MB. The limit is ' + Submission.MAX_BYTES / 1048576 + ' MB — try scanning in greyscale.']);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length > Submission.MAX_BYTES) {
    reject(['The attached file is larger than ' + Submission.MAX_BYTES / 1048576 + ' MB.']);
  }
  if (bytes.length === 0) {
    reject(['The attached file is empty.']);
  }
  // A PDF starts with %PDF-. Anything else is not what it claims to be.
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    reject(['The attached file is not a PDF. Attach the .pdf the scanner saved for you.']);
  }

  return bytes;
}

/* --- Write ----------------------------------------------------------------- */

async function main() {
  const bytes = await download(attachment.url);

  const filePath = Submission.filePath(submission);
  const absolute = path.join(REPO_ROOT, filePath);

  // Belt and braces: filePath is built from validated parts, but a path that
  // escapes the repository would be catastrophic, so assert it did not.
  const resolved = path.resolve(absolute);
  if (!resolved.startsWith(path.join(REPO_ROOT, 'papers') + path.sep)) {
    reject(['Refusing to write outside papers/ — this is a bug, please mention it in the issue.']);
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, bytes);

  const record = Object.assign({}, submission.paper, { file: filePath });
  if (!record.contributor && issueAuthor) record.contributor = '@' + issueAuthor;

  const collectionPath = PYQ.collectionPath(submission.year.id, submission.branch ? submission.branch.id : null);
  const collectionAbsolute = path.join(REPO_ROOT, collectionPath);

  const papers = fs.existsSync(collectionAbsolute) ? JSON.parse(fs.readFileSync(collectionAbsolute, 'utf8')) : [];
  papers.push(record);

  fs.mkdirSync(path.dirname(collectionAbsolute), { recursive: true });
  fs.writeFileSync(collectionAbsolute, JSON.stringify(PYQ.sortPapers(papers), null, 2) + '\n');

  const where = submission.branch ? submission.branch.short + ' ' + submission.year.name : submission.year.name;

  setOutput('status', 'ok');
  setOutput('branch', Submission.branchName(submission));
  setOutput('title', 'Add ' + (record.code ? record.code + ' ' : '') + record.exam + ' ' + record.year + ' (' + where + ')');
  setOutput(
    'body',
    [
      'Adds **' + record.subject + '** — ' + record.exam + ' ' + record.year + ', ' + where + '.',
      '',
      'Submitted by @' + issueAuthor + ' in #' + issueNumber + ' via the scanner.',
      '',
      '| | |',
      '|---|---|',
      '| Paper | `' + filePath + '` (' + Math.round(bytes.length / 1024) + ' KB) |',
      '| Entry | `' + collectionPath + '` |',
      '',
      'The bot validated the record against `src/pyq.js` and confirmed the file is a PDF. Please check the scan is legible and the subject and year are right before merging.',
      '',
      'Closes #' + issueNumber,
    ].join('\n')
  );
  setOutput(
    'comment',
    'Thanks! Committed `' + filePath + '` and opened a pull request — a maintainer will review it and merge. Nothing else needed from you.'
  );

  console.log('Prepared ' + filePath + ' and updated ' + collectionPath + '.');
}

main().catch(function (error) {
  // An unexpected failure should still tell the contributor something.
  setOutput('status', 'rejected');
  setOutput('comment', 'The bot hit an unexpected error processing this submission: `' + error.message + '`. A maintainer will take a look.');
  console.error(error);
  process.exit(0);
});
