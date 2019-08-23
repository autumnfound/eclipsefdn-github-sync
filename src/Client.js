var wrapper = require('./GitWrapper.js');
var readline = require('readline');

// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('add_team', 'Add a team to an organization')
  .command('add_repo_to_team', 'Add a repo to a team')
  .command('invite_user', 'Invite a user to a team')
  .command('remove_user', 'Remove a user from a team')
  .command('rename_team', 'Renames a team within the organization')
  .option('t', {
    description: 'Name of team',
    alias: 'team',
    nargs: 1
  })
  .option('o', {
    description: 'Name of organization',
    alias: 'organization',
    nargs: 1
  })
  .option('r', {
    description: 'Name of repo',
    alias: 'repo',
    nargs: 1
  })
  .option('u', {
    description: 'Name of user',
    alias: 'username',
    nargs: 1
  })
  .option('R', {
    description: 'New name of team',
    alias: 'rename',
    nargs: 1
  })
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

// read in secret from command line
var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
rl.question('Please enter your GitHub access token: ', (answer) => acceptInput(answer));

function run(argv, secret) {
  // check that we have a command
  if (!argv._ || !argv._[0]) {
    console.log('The <command> must be set to use the toolset');
    return;
  }
  
  var wrap = new wrapper(secret);
  wrap.setDryRun(argv.dryrun);
  
  // if add_team is set
  if (argv._[0] === 'add_team') {
    wrap.addTeam(argv.o,argv.t);
  } else if (argv._[0] === 'add_repo_to_team') {
    wrap.addRepoToTeam(argv.o, argv.t, argv.r);
  } else if (argv._[0] === 'invite_user') {
    wrap.inviteUserToTeam(argv.o, argv.t, argv.u);
  } else if (argv._[0] === 'remove_user') {
    wrap.removeUserFromTeam(argv.o, argv.t, argv.u);
  } else if (argv._[0] === 'rename_team') {
    wrap.renameTeam(argv.o, argv.t, argv.R);
  } else if (argv._[0] === 'add_repo') {
    wrap.addRepo(argv.o, argv.r);
  }
}

// best attempt at basic input checking
function acceptInput(answer) {
  var secret = answer.trim();
  if (!secret || secret.length == 0) {
    console.log('A token is required to run sync functionality, please try again');
    return rl.question('Please enter your GitHub access token: ', (answer) => acceptInput(answer));
  }

  rl.close();
  run(argv, secret);
}