const Wrapper = require('./GitWrapper.js');
const axios = require('axios');
const readline = require('readline');

//create global placeholder for wrapper
var wrap;

// thread sleeping to prevent abuse of API
var sab = new SharedArrayBuffer(1024);
var int32 = new Int32Array(sab);
const waitTimeInMS = 1000;

// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true
  })
  .help('h')
  .alias('h', 'help')
  .version('0.1')
  .alias('v', 'version')
  .epilog('Copyright 2019 Eclipse Foundation inc.')
  .argv;

// retrieve the scret from stdin
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
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
  _init(secret);
}

async function runSync(data) {
  var start = new Date();
  for (key in data) {
    var repos = data[key].repos;
    var isSpec = data[key].specification_project;
    console.log(`${key}:spec=${isSpec}`);

    // maintain orgs used by this project
    var orgs = [];
    for (idx in repos) {
      // pause for a set amount of time to prevent API abuse
      Atomics.wait(int32, 0, 0, waitTimeInMS);
      
      var repoStr = repos[idx];
      var org = repoStr.substring(0, repoStr.indexOf('/'));
      var repo = repoStr.substring(repoStr.indexOf('/') + 1);
      console.log(`\t- org=${org};repo=${repo}`);
      
      // check if we've processed this org yet, if not, then create teams and
      // store
      if (!orgs.includes(org)) {
        console.log(`Generating teams for ${org}/${repo}`);
        orgs.push(org);
        // prefetch teams to reduce redundant calls
        var pt = await wrap.prefetchTeams(org);
        var pr = await wrap.prefetchRepos(org);
        
        // create the teams for the current org
        if (!argv.d) {
          var t1 = await wrap.addTeam(org, `${key}-committers`);
          var t2 = await wrap.addTeam(org, `${key}-contributors`);
        } else {
          console.log('Dry run set, not adding teams for org: ' + org);
        }
        
        // wait to make sure that we don't abuse GitHub API
        Atomics.wait(int32, 0, 0, waitTimeInMS);
      }
      if (!argv.d) {
        // create the repo if it doesn't exist
        var r = await wrap.addRepo(org, repo);
        
        // Ensure that the teams refer to the repo
        var tr1 = await wrap.addRepoToTeam(org, `${key}-committers`, repo);
        var tr2 = await wrap.addRepoToTeam(org, `${key}-contributors`, repo);
      } else {
        console.log(`Dry run set, not adding repo (${repo}) for org: ${org}`);
      }
    }
  }
  // log how long it took to do this stuff
  var end = new Date();
  console.log(`\nStart: ${start}, end: ${end}, calls: ${wrap.getCallCount()}`);
}

/**
 * Async as we require blocking to ensure that data is available when processing
 * starts.
 */
async function _init(secret) {
  wrap = new Wrapper(secret);
  wrap.setDryRun(argv.d);
  
  // get the GitHub repo data
  var data = await axios.get('https://projects.eclipse.org/api/github')
    .then(response => {
      return response.data;
    }).catch(err => console.log(err));
  
  // start the sync operation.
  runSync(data);
}