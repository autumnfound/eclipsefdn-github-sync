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
// constants
const MB_IN_BYTES = 1024;
const DEFAULT_WAIT_PERIOD_IN_MS = 333;

// custom wrappers
const Wrapper = require('../GitWrapper.js');
const CachedHttp = require('../HttpWrapper.js');
const EclipseAPI = require('../EclipseAPI.js');

var readline = require('readline');

// create global placeholder for wrapper
var wrap;
var cHttp;
var eclipseApi;

var bots;

// thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(MB_IN_BYTES);
var int32 = new Int32Array(sab);
const waitTimeInMS = DEFAULT_WAIT_PERIOD_IN_MS;

// read in secret from command line
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question('Please enter your GitHub access token: ', answer => acceptInput(answer));

// best attempt at basic input checking
function acceptInput(answer) {
  var secret = answer.trim();
  if (!secret || secret.length === 0) {
    console.log('A token is required to run sync functionality, please try again');
    return rl.question('Please enter your GitHub access token: ', a => acceptInput(a));
  }

  rl.close();
  run(secret);
}

async function run(secret) {
  if (secret === undefined || secret === '') {
    console.log('Could not fetch API secret, exiting');
    return;
  }

  // build wrapper
  wrap = new Wrapper(secret);
  cHttp = new CachedHttp();
  eclipseApi = new EclipseAPI();

  // get eclipse api data
  var rawData = await eclipseApi.eclipseAPI();
  var rawBots = await eclipseApi.eclipseBots();

  var data = retrieveMaintainedOrgsRepos(rawData);
  bots = eclipseApi.processBots(rawBots);

  var auditNotes = [];
  var projects = Object.keys(data);
  for (var pIdx in projects) {
    var pId = projects[pIdx];
    var project = data[pId];
    var keys = Object.keys(project);
    for (var idx in keys) {
      var org = keys[idx];
      var repos = project[org];
      for (var repoIdx in repos) {
        var repo = repos[repoIdx];
        // get list of GitHub collaborators
        var collaborators = await wrap.getRepoCollaborators(org, repo);
        Atomics.wait(int32, 0, 0, waitTimeInMS);
        if (collaborators === undefined) {
          console.log(`Error while fetching collaborators for ${org}/${repo}`);
          continue;
        }
        // create audit notes for collaborators and record
        var notes = await processCollaborators(collaborators, pId, org, repo);
        Array.prototype.push.apply(auditNotes, notes);
      }
    }
  }
  // print data to console
  console.log('GITHUB_UNAME,ECLIPSE_UNAME,ORG,REPO,ECA,IS_COMMITTER,IS_PL,READ_ACCESS,WRITE_ACCESS,IS_ADMIN');
  for (var rowIdx in auditNotes) {
    var row = auditNotes[rowIdx];
    console.log(`${row.github},${row.uname},${row.org},${row.repo},${row.eca},${row.committer},${row.lead},`
      + `${row.read},${row.write},${row.admin}`);
  }
  cHttp.close();
}

async function processCollaborators(collaborators, projectId, org, repo) {
  if (collaborators === undefined || collaborators.length === 0) {
    return [];
  }
  var audits = [];
  for (var collabIdx in collaborators) {
    if (collaborators[collabIdx].login === 'eclipsewebmaster') {
      continue;
    }
    var row = await generateDataRow(collaborators[collabIdx], projectId, org, repo);
    if (row !== undefined) {
      audits.push(row);
    }
  }
  return audits;
}

async function generateDataRow(collaborator, projectId, org, repo) {
  console.log(`Generating row for user ${uname}`);
  var projBots = bots[projectId];
  var uname = collaborator.login;
  if (projBots === undefined || projBots.indexOf(uname) === -1) {
    // query the Eclipse API to check for corresponding user
    var url = `https://api.eclipse.org/github/profile/${uname}`;
    var result = await cHttp.getData(url);
    if (result != null) {
      var projects = await cHttp.getData(result['projects_url']);
      var projRels = projects[projectId];
      // check for Project Lead or Committer status
      var status = false;
      var lead = false;
      if (projRels != null && projRels.length > 0) {
        for (var relIdx in projRels) {
          var rel = projRels[relIdx];
          if (rel['Relation']['Relation'] === 'CM'
            && rel['Relation']['IsActive'] === '1') {
            status = true;
          }
          if (rel['Relation']['Relation'] === 'PL'
            && rel['Relation']['IsActive'] === '1') {
            lead = true;
          }
        }
      }
      return {
        github: uname,
        uname: result.name,
        repo: repo,
        org: org,
        eca: result.eca.signed,
        committer: status,
        lead: lead,
        read: collaborator.permissions.pull,
        write: collaborator.permissions.push,
        admin: collaborator.permissions.admin,
      };
    }
    return {
      github: uname,
      uname: '',
      repo: repo,
      org: org,
      eca: false,
      committer: false,
      lead: false,
      read: collaborator.permissions.pull,
      write: collaborator.permissions.push,
      admin: collaborator.permissions.admin,
    };
  } else {
    console.log(`'${uname}' was a bot for ${org}/${repo}`);
  }
}

function retrieveMaintainedOrgsRepos(data) {
  // maintain map of orgs to repos
  var orgs = {};
  for (var key in data) {
    var project = data[key];
    var projectID = project.project_id;
    var repos = project.github_repos;
    var projMap = {};

    // maintain orgs used by this project
    for (var idx in repos) {
      var repoUrl = repos[idx].url;
      // strip the repo url to get the org + repo
      var match = /\/([^/]+)\/([^/]+)\/?$/.exec(repoUrl);
      // check to make sure we got a match
      if (match === null) {
        continue;
      }

      // get the org + repo from the repo URL
      var org = match[1];
      var repo = match[2];

      var repoList = projMap[org];
      if (repoList === undefined) {
        repoList = [];
      }
      if (!repoList.includes(repo)) {
        repoList.push(repo);
        projMap[org] = repoList;
      }
    }
    orgs[projectID] = projMap;
  }
  return orgs;
}
