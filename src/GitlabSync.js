// set up yargs command line parsing
var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .example('$0', '')
  .option('d', {
    alias: 'dryrun',
    description: 'Runs script as dry run, not writing any changes to API',
    boolean: true,
  })
  .option('D', {
    alias: 'devMode',
    description: 'Runs script in dev mode, which returns API data that does not impact production organizations/teams.',
    boolean: true,
  })
  .option('V', {
    alias: 'verbose',
    description: 'Sets the script to run in verbose mode',
    boolean: true,
  })
  .option('H', {
    alias: 'host',
    description: 'GitLab host base URL',
    default: 'http://gitlab.eclipse.org/',
  })
  .option('p', {
    alias: 'provider',
    description: 'The OAuth provider name set in GitLab',
    default: 'oauth2_generic',
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

const ADMIN_PERMISSIONS_LEVEL = 50;

const uuid = require('uuid');
const { SecretReader, getBaseConfig } = require('./SecretReader.js');

const { Gitlab } = require('gitlab');
const EclipseAPI = require('./EclipseAPI.js');

var api;
var eApi;
var bots;

var namedGroups = {};
var namedProjects = {};
var namedUsers = {};
var gMems = {};

_prepareSecret();

/**
 * Retrieves secret API token from system, and then starts the script via _init
 *
 * @returns
 */
function _prepareSecret() {
  // retrieve the secret API token
  var accessToken, eclipseToken;
  // retrieve the secret API file root if set
  var settings = getBaseConfig();
  if (argv.s !== undefined) {
    settings.root = argv.s;
  }
  var reader = new SecretReader(settings);
  var data = reader.readSecret('access-token');
  if (data !== null) {
    accessToken = data.trim();
    // retrieve the Eclipse API token (needed for emails)
    data = reader.readSecret('eclipse-oauth-config');
    if (data !== null) {
      eclipseToken = data.trim();
      run(accessToken, eclipseToken);
    } else {
      console.log('Could not find the Eclipse OAuth config, exiting');
    }
  } else {
    console.log('Could not find the GitLab access token, exiting');
  }
}

async function run(secret, eclipseToken) {
  api = new Gitlab({
    host: argv.H,
    token: secret,
  });
  eApi = new EclipseAPI(JSON.parse(eclipseToken));
  eApi.testMode = argv.D;

  // get raw project data and post process to add additional context
  var data = await eApi.eclipseAPI();
  data = eApi.postprocessEclipseData(data, 'gitlab_repos');

  // get the bots for the projects
  var rawBots = await eApi.eclipseBots();
  bots = eApi.processBots(rawBots, 'gitlab.eclipse.org');

  // get all current groups for the instance
  var groups = await api.Groups.all();
  var projects = await api.Projects.all();
  var users = await api.Users.all();

  // map the groups/projects/users to their name
  for (var groupIdx in groups) {
    namedGroups[sanitizeGroupName(groups[groupIdx].path)] = groups[groupIdx];
  }
  for (var projectIdx in projects) {
    namedProjects[getCompositeProjectKey(projects[projectIdx].name, projects[projectIdx].namespace.id)] = projects[projectIdx];
  }
  for (var userIdx in users) {
    namedUsers[users[userIdx].username] = users[userIdx];
  }

  // fetch org group from results, create if missing
  console.log('Starting sync');
  var g = await getGroup('Eclipse', 'eclipse', undefined);
  if (g === undefined) {
    if (argv.d) {
      console.log('Unable to start sync of GitLab content. Base Eclipse group could not be found and dryrun is set');
    } else {
      console.log('Unable to start sync of GitLab content. Base Eclipse group could not be created');
    }
    return;
  }

  for (projectIdx in data) {
    var project = data[projectIdx];
    console.log(`Processing '${project.short_project_id}'`);
    // fetch project group from results, create if missing
    var projGroup = await getGroup(project.name, project.short_project_id, g);
    if (projGroup === undefined) {
      if (argv.d) {
        console.log(`Unable to continue processing project with ID '${project.short_project_id}'.`
          + ' Group does not exist and dryrun has been set.');
      } else {
        console.log(`Unable to continue processing project with ID '${project.short_project_id}'.`
          + ' Group does not exist and could not be created.');
      }
      continue;
    }

    // get the list of users to be added for current project
    var userList = getUserList(project);
    // for each user, get their gitlab user and add to the project group
    var usernames = Object.keys(userList);
    for (var usernameIdx in usernames) {
      var uname = usernames[usernameIdx];
      var user = await getUser(uname, userList[uname].url);
      if (user === undefined) {
        console.log(`Could not retrieve user for UID '${uname}', skipping`);
        continue;
      }

      await addUserToGroup(user, projGroup, userList[uname].access_level);
    }

    // remove users that don't match the expected users
    await removeAdditionalUsers(userList, projGroup, project.short_project_id);

    // for each of the repos in the Eclipse project, ensure there is a GL
    // project
    for (var repoIdx in project.gitlab_repos) {
      var extRepo = project.gitlab_repos[repoIdx];
      if (extRepo === undefined || extRepo.repo === undefined || extRepo.org === undefined) {
        continue;
      }
      if (argv.V) {
        console.log(`Processing repo '${extRepo.url}'`);
      }
      // retrieving current project
      var p = await getProject(extRepo.repo, projGroup);
      if (p !== undefined) {
        console.log(`Project with ID ${p.id} created for repository target ${extRepo.url}`);
      }
    }
  }
}

async function removeAdditionalUsers(expectedUsers, group, projectID) {
  if (argv.V) {
    console.log(`GitlabSync:removeAdditionalUsers(expectedUsers = ${expectedUsers}, group = ${group}, projectID = ${projectID})`);
  }
  // get the current list of users for the group
  var members = await getGroupMembers(group);
  if (members === undefined) {
    console.log(`Could not find any group members for ID ${group.id}'. Skipping user removal check`);
    return;
  }

  // check that each of the users in the group match whats expected
  var expectedUsernames = Object.keys(expectedUsers);
  for (var memberIdx in members) {
    var member = members[memberIdx];
    // check access and ensure user isn't an owner
    console.log(`Checking user '${member.username}' access to group '${group.name}'`);
    if (member.access_level !== ADMIN_PERMISSIONS_LEVEL && expectedUsernames.indexOf(member.username) === -1
      && !isBot(member.username, projectID)) {
      if (argv.d) {
        console.log(`Dryrun flag active, would have removed user '${member.username}' from group '${group.name}'`);
        continue;
      }
      console.log(`Removing user '${member.username}' from group '${group.name}'`);
      try {
        await api.GroupMembers.remove(group.id, member.id);
      } catch (err) {
        if (argv.V) {
          console.log(err);
        }
        console.log(`Error while removing user '${member.username}' from group '${group.name}'`);
      }
    }
  }
}

function isBot(uname, projectID) {
  var botList = bots[projectID];
  // check if the current user is in the current key-values list
  if (botList !== undefined && botList.indexOf(uname) !== -1) {
    return true;
  }
  return false;
}


/** API FUNCTIONS */


async function addUserToGroup(user, group, perms) {
  if (argv.V) {
    console.log(`GitlabSync:addUserToGroup(user = ${user}, group = ${group}, perms = ${perms})`);
  }
  // get the members for the current group
  var members = await getGroupMembers(group);
  if (members === undefined) {
    console.log(`Could not find any references to group with ID ${group.id}`);
    return;
  }

  // check if user is already present
  for (var memberIdx in members) {
    if (members[memberIdx].username === user.username) {
      console.log(`User '${user.username}' is already a member of ${group.name}`);
      if (members[memberIdx].access_level !== perms) {
        // skip if dryrun
        if (argv.d) {
          console.log(`Dryrun flag active, would have updated user '${members[memberIdx].username}' in group '${group.name}'`);
          return;
        }

        // modify user, catching errors
        console.log(`Fixing permission level for user '${user.username}' in group '${group.name}'`);
        try {
          var updatedMember = await api.GroupMembers.edit(group.id, user.id, perms);
          // update inner array
          members[memberIdx] = updatedMember;
          gMems[group.id] = members;
        } catch (err) {
          if (argv.V) {
            console.log(err);
          }
          console.log(`Error while fixing permission level for user '${user.username}' in group '${group.name}'`);
          return;
        }
      }
      // return a copy of the updated user
      return JSON.parse(JSON.stringify(members[memberIdx]));
    }
  }
  // check if dry run before updating
  if (argv.d) {
    console.log(`Dryrun flag active, would have added user '${user.username}' to group '${group.name}' with access level '${perms}'`);
    return;
  }

  console.log(`Adding '${user.username}' to '${group.name}' group`);
  try {
    // add member to group, track, and return a copy
    var newMember = await api.GroupMembers.add(group.id, user.id, perms);
    members.push(newMember);
    gMems[group.id] = members;

    // return a copy
    return JSON.parse(JSON.stringify(newMember));
  } catch (err) {
    if (argv.V) {
      console.log(err);
    }
    console.log(`Error while adding '${user.username}' to '${group.name}' group`);
  }
}

async function getProject(name, parent) {
  if (argv.V) {
    console.log(`GitlabSync:getProject(name = ${name}, parent = ${parent})`);
  }
  if (name.trim() === '.github') {
    console.log("Skipping project with name '.github'. No current equivalent to default repository in GitLab.");
    return;
  }

  var p = namedProjects[getCompositeProjectKey(name, parent.id)];
  if (p === undefined) {
    console.log(`Creating new project with name '${name}'`);
    // create the request options for the new user
    var opts = {
      path: name,
      visibility: 'public',
    };
    if (parent !== undefined) {
      opts.namespace_id = parent.id;
    }
    // check if dry run before creating new project
    if (argv.d) {
      console.log(`Dryrun flag active, would have created new project '${name}' with options ${JSON.stringify(opts)}`);
      return;
    }

    // create the new project, and track it
    if (argv.V) {
      console.log(`Creating project with options: ${JSON.stringify(opts)}`);
    }
    try {
      p = await api.Projects.create(opts);
    } catch (err) {
      if (argv.V) {
        console.log(err);
      }
    }
    if (p === null || p instanceof Array) {
      console.log(`Error while creating project '${name}'`);
      return undefined;
    }
    if (argv.V) {
      console.log(`Created project: ${JSON.stringify(p)}`);
    }
    // set it back
    namedProjects[getCompositeProjectKey(name, parent.id)] = p;
  }
  return p;
}

async function getGroup(name, path, parent, visibility = 'public') {
  if (argv.V) {
    console.log(`GitlabSync:getGroup(name = ${name}, path = ${path}, parent = ${parent}, visibility = ${visibility})`);
  }
  var g = namedGroups[sanitizeGroupName(path)];
  if (g === undefined) {
    console.log(`Creating new group with name '${name}'`);
    var opts = {
      name: name,
      path: sanitizeGroupName(path),
      project_creation_level: 'maintainer',
      visibility: visibility,
      request_access_enabled: false,
    };
    if (parent !== undefined && parent.id !== undefined) {
      opts.parent_id = parent.id;
    }
    // check if dry run before creating group
    if (argv.d) {
      console.log(`Dryrun flag active, would have created new group '${name}' with options ${JSON.stringify(opts)}`);
      return;
    }

    // if verbose is set display user opts
    if (argv.V) {
      console.log(`Creating group with options: ${JSON.stringify(opts)}`);
    }
    try {
      g = await api.Groups.create(opts);
    } catch (err) {
      if (argv.V) {
        console.log(err);
      }
    }
    if (g === null || g instanceof Array) {
      console.log(`Error while creating group '${name}'`);
      return undefined;
    }
    if (argv.V) {
      console.log(`Created group: ${JSON.stringify(g)}`);
    }
    // set it back
    namedGroups[sanitizeGroupName(path)] = g;
  }
  return g;
}

async function getUser(uname, url) {
  if (argv.V) {
    console.log(`GitlabSync:getUser(uname = ${uname}, url = ${url})`);
  }
  if (url === undefined || url === '') {
    console.log(`Cannot fetch user information for user '${uname}' with no set URL`);
    return;
  }

  var u = namedUsers[uname];
  if (u === undefined) {
    if (argv.d) {
      console.log(`Dryrun is enabled. Would have created user ${uname} but was skipped`);
      return;
    }

    // retrieve user data
    var data = await eApi.eclipseUser(uname);
    if (data === undefined) {
      console.log(`Cannot create linked user account for '${uname}', no external data found`);
      return;
    }
    console.log(`Creating new user with name '${uname}'`);
    var opts = {
      username: uname,
      password: uuid.v4(),
      force_random_password: true,
      name: `${data.first_name} ${data.last_name}`,
      email: data.mail,
      extern_uid: data.uid,
      provider: argv.p,
      skip_confirmation: true,
    };
    // check if dry run before creating new user
    if (argv.d) {
      console.log(`Dryrun flag active, would have created new user '${uname}' with options ${JSON.stringify(opts)}`);
      return;
    }

    // if verbose, display information being used to generate user
    if (argv.V) {
      // copy the object and redact the password for security
      var optLog = JSON.parse(JSON.stringify(opts));
      optLog.password = 'redacted';
      console.log(`Creating user with options: ${JSON.stringify(optLog)}`);
    }
    try {
      u = await api.Users.create(opts);
    } catch (err) {
      if (argv.V) {
        console.log(err);
      }
    }
    if (u === null) {
      console.log(`Error while creating user '${uname}'`);
      return undefined;
    }
    // set it back
    namedUsers[uname] = u;
  }
  return u;
}

async function getGroupMembers(group) {
  if (argv.V) {
    console.log(`GitlabSync:getGroupMembers(group = ${group})`);
  }
  var members = gMems[group.id];
  if (members === undefined) {
    try {
      members = await api.GroupMembers.all(group.id);
    } catch (err) {
      if (argv.V) {
        console.log(err);
      }
    }
    if (members === null) {
      console.log(`Unable to find group members for group with ID '${group.id}'`);
      return;
    }
    gMems[group.id] = members;
  }
  return members;
}


/** HELPERS */


function getUserList(project) {
  if (argv.V) {
    console.log(`GitlabSync:getUserList(project = ${project})`);
  }
  var l = {};
  // add the contributors with reporter access
  for (var contributorIdx in project.contributors) {
    l[project.contributors[contributorIdx].username] = {
      url: project.contributors[contributorIdx].url,
      access_level: 20,
    };
  }
  // add the committers with developer access
  for (var committerIdx in project.committers) {
    l[project.committers[committerIdx].username] = {
      url: project.committers[committerIdx].url,
      access_level: 30,
    };
  }
  // add the project leads not yet tracked with reporter access
  var keys = Object.keys(l);
  for (var plIdx in project.project_lead) {
    if (!keys.contains(project.project_lead[plIdx].username)) {
      l[project.project_lead[plIdx].username] = {
        url: project.project_lead[plIdx].url,
        access_level: 20,
      };
    }
  }
  // add the bots with developer access
  var botList = bots[project.project_id];
  for (var botIdx in botList) {
    l[botList[botIdx]] = {
      access_level: 30,
    };
  }
  return l;
}

function sanitizeGroupName(pid) {
  if (argv.V) {
    console.log(`GitlabSync:sanitizeGroupName(pid = ${pid})`);
  }
  if (pid !== undefined) {
    return pid.toLowerCase().replace(/[^\s\da-zA-Z-.]/g, '-');
  }
  return '';
}

function getCompositeProjectKey(projectName, parentId) {
  return projectName + ':' + parentId;
}
