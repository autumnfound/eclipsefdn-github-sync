const Octokit = require('@octokit/rest');
const flatCache = require('flat-cache');

// variables for use with the cache
const teamCacheID = '1';
const repoCacheID = '2';
let teamCache = flatCache.load(teamCacheID);
let repoCache = flatCache.load(repoCacheID);

// keep track of which prefetches have been completed
let prefetch = {
    'teams':{},
    'repos':{}
};

// run variables
var dryrun = false;
var verbose = false;

// keep octokit outside of exports as its not needed to expose it there.
let octokit;

// count how many times the GitHub API was hit
var callCount = 0;

module.exports = function(token) {
  // instantiate octokit
  octokit = new Octokit({
    auth: token
  });
  // enable dry run functionality
  this.setDryRun = function(doDryRun) {
    this.dryrun = doDryRun;
  };
  // enable dry run functionality
  this.setVerbose = function(isVerbose) {
    this.verbose = isVerbose;
  };
  this.getCallCount = function() {
    return callCount;
  };

	this.addTeam = function(org, team) {
    if (!org || !team) {
      console.log('addTeam command requires organization and team to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    // check if the team already exists
    if (teamCache.getKey(getTeamCacheKey(org, sanitizedTeam)) != null) {
      console.log(`Team with name ${team} already exists for ${org}, skipping creation`);
      return;
    }
    
	  // call the API if dry run is not set
	  if (!this.dryrun) {
	    callCount++;
	    return octokit.teams.create({
	      'org': org,
	      'name': sanitizedTeam,
	      'privacy': 'closed'
	    }).then(result => {
	      // cache the result for later use
	      teamCache.setKey(getTeamCacheKey(org, sanitizedTeam), result.data);
	      
	      console.log(`Done creating team with name: ${org}:${sanitizedTeam}`);
	    }).catch(err => logError(err, 'team:create'));
	  } else {
	    console.log(`Dry run set, not writing new team ${org}:${sanitizedTeam}`);
	  }
	};
	
	/**
   * Adds repository to given team in organization. First calls GitHub to get an
   * ID given team name and organization. This ID is used in call to attach
   * given repo to a team.
   */
	this.addRepoToTeam = async function(org, team, repo) {  
    if (!org || !team || !repo) {
      console.log('addRepoToTeam command requires organization, team, and repo to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    
		// call the API to get additional information about the team
	  var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
		if (teamData == null) {
			return;
		}
		
		// if not set to dryrun, add repo to team in given org
	  if (!this.dryrun) {
      callCount++;
	    return octokit.teams.addOrUpdateRepo({
			  'owner': org,
			  'team_id': teamData.id,
			  'repo': repo
			}).then(result => {
			  console.log(`Done adding repo to team: ${repo} -> ${org}/${sanitizedTeam}`)
			}).catch(err => logError(err, 'team:addOrUpdateRepo'));
	  } else {
		  console.log(`Dry run set, not writing new team ${org}/${name}`);	  
	  }
	};
  
	/**
   * Invites user with username of 'uname' to the given team in given
   * organization. Checks current member list to see if user should be invited.
   */
  this.inviteUserToTeam = async function(org, team, uname) {  
    if (!org || !team || !uname) {
      console.log('inviteUserToTeam command requires organization, team, and uname to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }
    
    // check if the user already exists in the team
    var teamMembers = await getTeamMembers(org, sanitizedTeam, teamData.id);
    for (var i = 0; i < teamMembers.length; i++) {
      if (teamMembers[i].login == uname) {
        console.log(`User with usernmae '${uname}' is already a member of ${org}/${sanitizedTeam}`);
        return;
      }
    }
    
    // if not set to dryrun, invite user to team
    if (!this.dryrun) {
      callCount++;
      return octokit.teams.addOrUpdateMembership({
        'team_id': teamData.id,
        'username': uname
      }).then(result => {
        console.log(`Done inviting user to team: ${uname} -> ${org}/${sanitizedTeam}`)
      }).catch(err => logError(err, 'team:addOrUpdateMembership'));
    }
  };
  
  /**
   * Removes user with username of 'uname' from the given team in given
   * organization. Checks current member list to see if user should be removed.
   */
  this.removeUserFromTeam = async function(org, team, uname) {  
    if (!org || !team || !uname) {
      console.log('removeUserFromTeam command requires organization, team, and uname to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    
    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }
    
    // check if the user already exists in the team
    var teamMembers = await getTeamMembers(org, sanitizedTeam, teamData.id);
    var isMember = false;
    for (var i = 0; i < teamMembers.length; i++) {
      if (teamMembers[i].login == uname) {
        isMember = true;
        break;
      }
    }
    if (!isMember) {
      console.log(`User with usernmae '${uname}' is not a member of ${org}/${team}, cannot remove`);
      return;
    }

    // if not set to dryrun, invite user to team
    if (!this.dryrun) {
      callCount++;
      return octokit.teams.removeMembership({
        'team_id': teamData.id,
        'username': uname
      }).then(result => {
        console.log(`Done removing user from team: ${uname} -> ${org}/${sanitizedTeam}`)
      }).catch(err => logError(err, 'team:removeMembership'));
    }
  };
  
  /**
   * Renames the given team in the organization with the passed new name.
   */
  this.renameTeam = async function(org, team, newName) {
    if (!org || !team || !newName) {
      console.log('renameTeam command requires organization, team, and new team name to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    var sanitizedNewTeam = sanitizeTeamName(newName);

    // call the API to get additional information about the team
    var teamData = await getTeam(org, sanitizedTeam);
    // check if data was returned
    if (teamData == null) {
      return;
    }

    if (!this.dryrun) {
      callCount++;
      return octokit.teams.update({
        'team_id': teamData.id,
        'name': sanitizedNewTeam
      }).then(result => {
        console.log(`Done renaming team: ${org}/${sanitizedTeam} -> ${org}/${sanitizedNewTeam}`)
      }).catch(err => logError(err, 'team:update'));
    }
  };

  /**
   * Creates a new repo with given name and an EPL-2.0 license.
   */
  this.addRepo = function(org, repo) {
    if (repoCache.getKey(getRepoCacheKey(org, repo)) != null) {
      console.log(`Repo with name ${repo} already exists for ${org}, skipping creation`);
      
      return repoCache.getKey(getRepoCacheKey(org, repo));
    }
    
    if (!this.dryrun) {
      callCount++;
      return octokit.repos.createInOrg({
        'org': org,
        'name': repo,
        'license_template': 'EPL-2.0'
      }).then(result => {
        // cache the result for later use
        repoCache.setKey(getRepoCacheKey(org, repo), result.data);
        
        console.log(`Done creating repo for org: ${org}/${repo}`);
        return result.data;
      }).catch(err => logError(err, 'repos:createInOrg'));
    }
  }
  
  /**
   * Prefetch and fill caches with all existing teams for the current org. Will
   * check if prefetch has already been performed for current org.
   */
  this.prefetchTeams = async function(org) {
    if (prefetch['teams'][org] == true) {
      return;
    }
    console.log(`Starting prefetch for teams in org=${org}`);
    
    var limit = 100;
    var page = 1;
    var result = [];
    var count = 0;
    // loop through all available users, and add them to a list to be returned
    while (page == 1 || (result != null && result.length == limit)) {
      callCount++;
      // get the current page of results, incrementing page count after call
      result = await octokit.teams.list({
        'org': org,
        'per_page': limit,
        'page': page++
      }).then(result => {
        // return the data to the user
        return result.data;
      }).catch(err => logError(err, 'team:list'));
      
      // collect the results
      if (result != null && result.length > 0) {
        for (var i = 0; i < result.length; i++) {
          var team = result[i];
          var cacheKey = getTeamCacheKey(org, sanitizeTeamName(team.slug));
          
          teamCache.setKey(cacheKey, team);
          count++;
        }
      }
    }
    // set the prefetch flag for org to true
    prefetch['teams'][org] = true;
    console.log(`Finished prefetch for org=${org}, got ${count} teams`);
  }
  
  /**
   * Prefetch and fill caches with all existing repos for the current org. Will
   * check if prefetch has already been performed for current org.
   */
  this.prefetchRepos = async function(org) {
    if (prefetch['repos'][org] == true) {
      return;
    }
    console.log(`Starting prefetch for repos in org=${org}`);
    
    var limit = 100;
    var page = 1;
    var result = [];
    var count = 0;
    // loop through all available users, and add them to a list to be returned
    while (page == 1 || (result != null && result.length == limit)) {
      callCount++;
      // get the current page of results, incrementing page count after call
      result = await octokit.repos.listForOrg({
        'org': org,
        'per_page': limit,
        'page': page++
      }).then(result => {
        // return the data to the user
        return result.data;
      }).catch(err => logError(err, 'team:list'));
      
      // collect the results
      if (result != null && result.length > 0) {
        for (var i = 0; i < result.length; i++) {
          var repo = result[i];
          var cacheKey = getRepoCacheKey(org, repo.name);
          
          repoCache.setKey(cacheKey, repo);
          count++;
        }
      }
    }
    // set the prefetch flag for org to true
    prefetch['repos'][org] = true;
    console.log(`Finished prefetch for org=${org}, got ${count} repos`);
  }
}
/** END OF EXPORTS */


/**
 * Wraps GitHub team retrieval functionality with simple caching and returning
 * future promises of content, or the content directly if cached.
 */
function getTeam(org, team) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamCacheKey(org, team);
  var cachedResult = teamCache.getKey(cacheKey);
  
  console.log(`Getting team for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult == null) {
    callCount++;
    return octokit.teams.getByName({
      'org': org,
      'team_slug': team.replace(/\./g, '-')
    }).then(result => {
      // cache the data in memory for use later
      teamCache.setKey(cacheKey, result.data);
      
      // return the data to the user
      return result.data;
    }).catch(err => logError(err, 'team:getByName'));
  } else {
    console.log(`Found cached result for key ${cacheKey} \n`);
    
    // return result to be immediately used
    return cachedResult;
  }
}

/**
 * Retrieve all team members associated with a team, using multiple calls if
 * necessary to get all users on a team.
 */
async function getTeamMembers(org, team, teamId) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamMembersCacheKey(org, team);
  var cachedResult = teamCache.getKey(cacheKey);
  
  // fetch if we don't have a cached result
  if (cachedResult == null) {
    var limit = 100;
    var page = 1;
    var result = [];
    var data = [];
    // loop through all available users, and add them to a list to be returned
    while (result.length == limit || page == 1) {
      callCount++;
      // get the current page of results, incrementing page count after call
      result = await octokit.teams.listMembers({
        'team_id': teamId,
        'per_page': limit,
        'page': page++
      }).then(result => {
        // return the data to the user
        return result.data;
      }).catch(err => logError(err, 'team:listMembers'));
      
      // collect the results
      if (result.length > 0) {
        for (var i = 0; i < result.length; i++) {
          data.push(result[i]);
        }
      }
    }
    // save the data to cache to avoid reprocessing
    teamCache.setKey(cacheKey, data);
    // return the data for usage
    return data;
  } else {
    console.log(`Found cached result for key ${cacheKey} \n`);
    
    // return result to be immediately used
    return cachedResult;
  }
}

function sanitizeTeamName(name) {
  return name.toLowerCase().replace(/[^\s\da-zA-Z-]/g, '-');
}

function getTeamCacheKey(org, team) {
  return `${org}/${team}`;
}

function getTeamMembersCacheKey(org, team) {
  return `${getTeamCacheKey(org, team)}:members`;
}

function getRepoCacheKey(org, repo) {
  return `${org}/${repo}`;
}

/**
 * Logs error content when passed, printing the root called that was passed for
 * additional contextual information.
 */
function logError(err, root) {
  console.log(`API encountered the following errors processing current request (${root}):`);
  if (err.errors) {
    for (var i = 0; i < err.errors.length; i++) {
      console.log(`\t ${err.errors[i].message}`);
    }
  }

  if (verbose == true) {
    console.log(err);
  }
}
