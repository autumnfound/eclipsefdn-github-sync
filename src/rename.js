/*******************************************************************************
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
const Wrapper = require('./GitWrapper.js');
const CachedHttp = require('./HttpWrapper.js');
const axios = require('axios');
const parse = require('parse-link-header');

var readline = require('readline');

// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true
  })
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true
  })
  .option('o', {
    alias: 'org',
    description: 'The org to rename teams for',
    required: true
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

// create global placeholder for wrapper
var wrap;

// thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(1024);
var int32 = new Int32Array(sab);
const waitTimeInMS = 1000;

// read in secret from command line
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
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
  if (secret == undefined || secret == "") {
    console.log("Could not fetch API secret, exiting");
    return;
  }
  
  // build wrapper
  wrap = new Wrapper(secret);
  wrap.setDryRun(argv.d);
  
  // get suggested repo to team name map
  var projectDataRaw = await eclipseAPI();
  //var projectDataRaw = d;
  var map = mapRepoToIDs(projectDataRaw);
  var projectedOut = {};
  
  // log what the raw repo -> team names are
  var mapKeys = Object.keys(map);
  var mapKeyOut = "REPO, TEAM_NAME\n";
  for (var i in mapKeys) {
    mapKeyOut += `${mapKeys[i]}, ${map[mapKeys[i]]}\n`;
  }
  console.log(`DATA:\n${mapKeyOut}\n\n`);
  
  var ts = await wrap.getTeamsForOrg(argv.o);
  for (var idx in ts) {
    var team = ts[idx];
    console.log(`Getting repos for team ${team.name}`);
    var rs = await wrap.getReposForTeam(team);
    var tgt = null;
    for (var rsIdx in rs) {
      var repo = rs[rsIdx]["name"];
      console.log(`Looking up projected team name for repo '${repo}'`);
      // get the projected team name for the repo
      tgt = map[repo];
      if (tgt != null) {
        projectedOut[team.name] = tgt;
        // only action if dry run is false
        if (!argv.d) {
          wrap.renameTeam(argv.o, team.name, tgt);
        } else {
          console.log(`Dry run enabled, not renaming ${team.name} to ${tgt}`);
        }
        Atomics.wait(int32, 0, 0, waitTimeInMS);
        break;
      }
    }
    // if it doesn't find anything, set an empty column
    if (tgt == null) {
      projectedOut[team.name] = "";
    }
    Atomics.wait(int32, 0, 0, waitTimeInMS);
  }
  // log what the projected output would be
  var keys = Object.keys(projectedOut);
  var csvOut = "CURRENT_TEAM_NAME, NEW_TEAM_NAME\n";
  for (var i in keys) {
    csvOut += `${keys[i]}, ${projectedOut[keys[i]]}\n`;
  }
  console.log(`DATA:\n${csvOut}`);
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
    }).catch(err => logError(err, 'team:list'));
    
    // collect the results
    if (result != null && result.length > 0) {
      for (var i = 0; i < result.length; i++) {
        data.push(result[i]);
        console.log(`Found ${result[i].project_id}`);
      }
    }
  }
  return data;
}

function mapRepoToIDs(data) {
  // map project repos to the project id
  var out = {};
  for (var k in data) {
      var proj = data[k];
      for (var l in proj["github_repos"]) {
        var gitUrl = proj["github_repos"][l]["url"];
        var repoMatch = /[^\/]+\/?$/.exec(gitUrl);
        // check to make sure we got a match
        if (repoMatch == null) {
          console.log(`Repo '${proj.name}' has a bad GitHub URL: '${gitUrl}'`);
          continue;
        }
        
        // if the name ends with a slash, remove it
        var repoName = repoMatch[0];
        if (repoName.endsWith('/')) {
          repoName = repoName.substring(0, repoName.length -2);
        }
        // set the committer name
        out[repoName] = wrap.sanitizeTeamName(proj.project_id + "-committers");
      }
  }
  return out;
}