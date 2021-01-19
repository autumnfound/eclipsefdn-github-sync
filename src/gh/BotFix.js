/*! *****************************************************************************
 * Copyright (C) 2021 Eclipse Foundation, Inc.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/
 *
 * Contributors: Martin Lowe <martin.lowe@eclipse-foundation.org>
 *
 * SPDX-License-Identifier: EPL-2.0
 ******************************************************************************/

var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true,
  })
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true,
  })
  .option('s', {
    alias: 'secretLocation',
    description: 'The location of the access-token file containing an API access token',
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

const Wrapper = require('../GitWrapper.js');
const EclipseAPI = require('../EclipseAPI.js');
const { SecretReader, getBaseConfig } = require('../SecretReader.js');

var wrap, eclipseApi;
var inviteCtr = 0;
var rawCtr = 0;

_prepareSecret();

function _prepareSecret() {
  // retrieve the secret API file root if set
  var settings = getBaseConfig();
  if (argv.s !== undefined) {
    settings.root = argv.s;
  }
  var reader = new SecretReader(settings);
  // get the secret and start the script if set
  var secret = reader.readSecret('api-token');
  if (secret !== null) {
    _init(secret.trim());
  }
}

async function _init(secret) {
  if (secret === undefined || secret === '') {
    console.log('Could not fetch API secret, exiting');
    return;
  }
  wrap = new Wrapper(secret);
  if (!await wrap.checkAccess()) {
    return;
  }
  wrap.setDryRun(argv.d);
  wrap.setVerbose(argv.V);
  console.log(`Running in dryrun? ${argv.d}`);

  eclipseApi = new EclipseAPI();
  eclipseApi.testMode = argv.t;
  // get raw project data and post process to add additional context
  var data = await eclipseApi.eclipseAPI('?github_only=1');
  data = eclipseApi.postprocessEclipseData(data, 'github_repos');

  console.log(`Finished preloading ${data.length} projects`);
  // get bots for raw project processing
  var rawBots = await eclipseApi.eclipseBots();
  // get the count of bots with github bots defined
  rawCtr = getTotalBotsCount(rawBots, 'github.com');
  console.log(`Found ${rawBots.length}(${rawCtr} with GitHub account) registered bots`);
  let projectBots = eclipseApi.processBots(rawBots);

  // start the sync operation.
  await runSync(data, projectBots);
}

async function runSync(data, projectBots) {
  for (let pIdx in projectBots) {
    let project = findProject(data, pIdx);
    if (project === undefined) {
      console.log('ERROR - could not find project corresponding to ' + pIdx);
      continue;
    }
    await processProject(project, projectBots[pIdx]);
  }
  console.log(`Invited ${inviteCtr} / ${rawCtr} bots to various teams`);
}
async function processProject(project, bots) {
  if (project === undefined) {
    console.log('No project passed, cannot process bots for nothing');
    return;
  }
  // get + sanitize team name for current project in terms of committers
  var teamName = wrap.sanitizeTeamName(`${project.project_id}-committers`);
  console.log(`\nProcessing bots for project ${project.project_id}(${teamName})`);
  var orgs = [];
  for (var idx in project.github_repos) {
    var repo = project.github_repos[idx];
    var org = repo.org;
    // check if we've processed this org yet, if not, then push bots (all teams need to exist)
    if (!orgs.includes(org)) {
      console.log(`Adding bots to team '${teamName}' for ${org}`);
      for (let bIdx in bots) {
        let uname = bots[bIdx];
        console.log(`Adding bot '${uname}' to team '${teamName}'`);

        if (!argv.d) {
          // inviting bot to project team
          await wrap.inviteUserToTeam(org, teamName, uname);
        } else {
          console.log(`Would have added bot '${uname}' to team '${teamName}' in org '${org}'`);
        }
        inviteCtr++;
      }
      // capture org so we don't add them twice
      orgs.push(org);
    }
  }
}

function findProject(projects, name) {
  for (var i in projects) {
    var project = projects[i];
    if (project.project_id === name) {
      return project;
    }
  }
}

function getTotalBotsCount(bots, site) {
  var ctr = 0;
  for (var b in bots) {
    if (bots[b][site] !== undefined){
      ctr++;
    }
  }
  return ctr;
}

