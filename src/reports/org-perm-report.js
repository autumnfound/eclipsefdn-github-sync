/** *****************************************************************************
 * Copyright (C) 2019 Eclipse Foundation, Inc.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/
 *
 * Contributors: Martin Lowe <martin.lowe@eclipse-foundation.org>
 *
 * SPDX-License-Identifier: EPL-2.0
 ******************************************************************************/

// custom wrappers
const Wrapper = require('../GitWrapper.js');
const CachedHttp = require('../HttpWrapper.js');
const axios = require('axios');
const parse = require('parse-link-header');
// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true,
  })
  .option('t', {
    alias: 'throttle',
    description: 'The number of milliseconds to wait between calls',
    default: 333,
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

var readline = require('readline');
// create global placeholder for wrapper
var wrap;
var cHttp;

// thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(1024);
var int32 = new Int32Array(sab);
// fields desired for report
var fields = [
  'id',
  'login',
  'repo',
  'html_url',
  'default_repository_permission',
  'members_can_create_repositories',
  'members_allowed_repository_creation_type',
  'members_can_create_public_repositories',
  'members_can_create_private_repositories',
  'members_can_create_internal_repositories',
  /* Custom fields for more info */
  'missing_teams',
  'invalid_admin_user',
];
var allowedAdmins = ['eclipsewebmaster'];

// read in secret from command line
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question('Please enter your GitHub access token: ', (answer) => acceptInput(answer));

// best attempt at basic input checking
function acceptInput(answer) {
  var secret = answer.trim();
  if (!secret || secret.length == 0) {
    console.log('A token is required to run sync functionality, please try again');
    return rl.question('Please enter your GitHub access token: ', (answer) => acceptInput(answer));
  }

  rl.close();
  run(secret);
}

async function run(secret) {
  if (secret == undefined || secret == '') {
    console.log('Could not fetch API secret, exiting');
    return;
  }

  // build wrapper
  wrap = new Wrapper(secret);
  cHttp = new CachedHttp();

  // get eclipse api data
  var data = retrieveMaintainedOrgRepos(await eclipseAPI());
  var regex = new RegExp('.*(-committers|-contributors|-project-leads)$');
  var rows = [];
  var keys = Object.keys(data);
  for (var idx in keys) {
    var org = keys[idx];
    var orgActual = await wrap.getOrganization(org);
    wait();
    if (orgActual == undefined) {
      console.log(`Error retrieving org '${org}', will skip`);
      continue;
    }
    // get the keys for the data to filter out
    var orgFields = Object.keys(orgActual);
    // filter out data we don't need
    for (var orgIdx in orgFields) {
      var field = orgFields[orgIdx];
      if (!fields.includes(field)) {
        delete orgActual[field];
      }
    }
    // get all repos for org
    await wrap.prefetchRepos(org);
    wait();
    await wrap.prefetchTeams(org);
    wait();
    // get copy of all found repos for org
    var repos = await wrap.getDiscoveredRepos(org);
    wait();

    for (var rIdx in repos) {
      var foundRepo = repos[rIdx];
      // check if current repo is managed
      var teams = await wrap.getTeamsForRepo(org, foundRepo.name);
      wait();
      // if missing teams, error and include
      var missingTeam = true;
      for (var tIdx in teams) {
        var team = teams[tIdx];
        if (regex.test(team.name)) {
          missingTeam = false;
          console.log(`Found team name '${team.name}' for repo: ${foundRepo.name}, assuming teams are managed through API`);
          break;
        }
      }

      var hasInvalidAdmin = false;
      // if member has admin that isn't expected, error and include
      var collabs = await wrap.getRepoCollaborators(org, foundRepo.name, 'all');
      wait();
      for (var cIdx in collabs) {
        var collaborator = collabs[cIdx];
        if (collaborator.permissions.admin == true && !allowedAdmins.includes(collaborator.login)) {
          console.log(`Repo ${org}/${foundRepo.name} has invalid admin of ${collaborator.login}`);
          hasInvalidAdmin = true;
        }
      }
      console.log(`repo.name: ${foundRepo.name}, hasInvalidAdmin: ${hasInvalidAdmin}, missingTeam: ${missingTeam}`);
      if (hasInvalidAdmin || missingTeam) {
        // make a copy of current data
        var row = JSON.parse(JSON.stringify(orgActual));
        // add repo for tracking
        row.repo = foundRepo.name;
        row.html_url = foundRepo.html_url;
        // custom info fields
        row.missing_teams = missingTeam;
        row.invalid_admin_user = hasInvalidAdmin;
        // add to report
        rows.push(row);
      }
    }
  }

  // print data to console
  var header = '';
  for (var fieldIdx in fields) {
    header += fields[fieldIdx].toUpperCase() + ',';
  }
  console.log(header);
  for (var rowIdx in rows) {
    var writableRow = rows[rowIdx];
    var out = '';
    for (var writableFieldIdx in fields) {
      out += writableRow[fields[writableFieldIdx]];
      if (writableFieldIdx < (fields.length - 1)) {
        out += ',';
      }
    }
    console.log(out);
  }
  cHttp.close();
}

async function eclipseAPI() {
  var hasMore = true;
  var result = [];
  var data = [];
  // add timestamp to url to avoid browser caching
  var url = `https://projects.eclipse.org/api/projects?github_only=1&timestamp=${new Date().getTime()}`;
  // loop through all available users, and add them to a list to be returned
  while (hasMore) {
    console.log('Loading next page...');
    // get the current page of results, incrementing page count after call
    result = await axios.get(url).then(result => {
      // return the data to the user
      var links = parse(result.headers.link);
      if (links.self.url == links.last.url) {
        hasMore = false;
      } else {
        url = links.next.url;
      }
      return result.data;
    }).catch(err => console.log('Error while loading EclipseAPI data: ' + err));

    // collect the results
    if (result != null && result.length > 0) {
      for (var i = 0; i < result.length; i++) {
        data.push(result[i]);
      }
    }
  }
  return data;
}

function retrieveMaintainedOrgRepos(data) {
  // maintain map of orgs to repos
  var orgs = {};
  for (var key in data) {
    var project = data[key];
    var repos = project.github_repos;

    // maintain orgs used by this project
    for (var idx in repos) {
      var repoUrl = repos[idx].url;
      // strip the repo url to get the org + repo
      var match = /\/([^\/]+)\/([^\/]+)\/?$/.exec(repoUrl);
      // check to make sure we got a match
      if (match == null) {
        continue;
      }

      // get the org from the repo URL
      var org = match[1];
      var repo = match[2];
      if (orgs[org] == undefined) {
        orgs[org] = [];
      }
      if (!orgs[org].includes(repo)) {
        orgs[org].push(repo);
      }
    }
  }
  return orgs;
}

function wait() {
  if (argv.V) {
    console.log(`Waiting for ${argv.t}ms...`);
  }
  Atomics.wait(int32, 0, 0, argv.t);
}
