var wrapper = require('./GitWrapper.js');
// set up yargs command line parsing
var argv = require('yargs')
    .usage('Usage: $0 <command> [options]')
    .command('add_team', 'Add a team to an organization')
    .example('$0 add_team -T \'123456789abcdefghi\' -t sample -o eclipse-test', 'count the lines in the given file')
    .option('T', {
      alias: 'token',
      description: 'Access token for GitHub',
      required: true
    })
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
    .option('d', {
      alias: 'dryrun',
      description: 'Runs script as dry run, not writing any changes to API',
      boolean: true
    })
    .implies('add_team', ['o', 't'])
    .help('h')
    .alias('h', 'help')
    .version('0.1')
    .alias('v', 'version')
    .epilog('Copyright 2019 Eclipse Foundation inc.')
    .argv;

// check that we have a command
if (!argv._) {
  console.log('The <command> must be set to use the toolset');
  return;
}

// if add_team is set
if (argv._[0] === 'add_team') {
  var org = argv.o;
  var name = argv.t;
  if (!org || !name) {
    console.log('add_team command requires organization and team name to be set');
    return;
  }
  var wrap = new wrapper(argv.token);
  wrap.addTeam(org,name,argv.dryrun);
}
