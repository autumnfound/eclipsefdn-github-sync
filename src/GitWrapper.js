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


// add additional plugins for octokit to meet best practices
const { Octokit } = require('@octokit/rest');
const throttling = require('@octokit/plugin-throttling');
const retry = require('@octokit/plugin-retry');

const ExtendedOctokit = Octokit
  .plugin(retry)
  .plugin(throttling);
const flatCache = require('flat-cache');

// variables for use with the cache
const teamCacheID = '1';
const repoCacheID = '2';
const orgCacheID = '3';
let teamCache = flatCache.load(teamCacheID);
let repoCache = flatCache.load(repoCacheID);
let orgCache = flatCache.load(orgCacheID);

// keep track of which prefetches have been completed
let prefetch = {
  teams: {},
  repos: {},
};

// run variables

// keep octokit outside of exports as its not needed to expose it there.
let octokit;

// count how many times the GitHub API was hit
var callCount = 0;

module.exports = class {
  #token;
  #dryrun;
  #verbose;
  constructor(token, verbose = false, dryrun = false) {
    this.#token = token;
    this.#verbose = verbose;
    this.#dryrun = dryrun;
    // instantiate octokit
    octokit = new ExtendedOctokit({
      auth: this.#token,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          console.log(`Request quota exhausted for request ${options.method} ${options.url}`);

          if (options.request.retryCount == 0) { // only retries once
            console.log(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          // does not retry, only logs a warning
          console.log(`Abuse detected for request ${options.method} ${options.url}`);
        },
      },
    });
  }
  // enable dry run functionality
  setDryRun(doDryRun) {
    this.#dryrun = doDryRun;
  }

  // enable dry run functionality
  setVerbose(isVerbose) {
    this.#verbose = isVerbose;
  }

  getCallCount() {
    return callCount;
  }

  async checkAccess() {
    if (this.#token == undefined || this.#token == '') {
      console.log('Application was not given an access token and will not continue');
      return;
    }
    try {
      const { headers } = await octokit.request('HEAD /');
      const scopes = headers['x-oauth-scopes'].split(', ');
      if (scopes.indexOf('admin:org') < 0) {
        console.log('Application was not given an access token with the admin:org scope and will not continue');
      } else {
        return true;
      }
    } catch (err) {
      console.log('Application was not given a valid access token');
    }
    return false;
  }

  addTeam(org, team) {
    if (!org || !team) {
      console.log('addTeam command requires organization and team to be set');
      return;
    }
    var sanitizedTeam = sanitizeTeamName(team);
    // check if the team already exists
    var cachedResult = teamCache.getKey(getTeamCacheKey(org, sanitizedTeam));
    if (cachedResult != null) {
      console.log(`Team with name ${team} already exists for ${org}, skipping creation`);
      return cachedResult;
    }

    // call the API if dry run is not set
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.create({
        org: org,
        name: sanitizedTeam,
        privacy: 'closed',
      }).then(result => {
        // cache the result for later use
        teamCache.setKey(getTeamCacheKey(org, sanitizedTeam), result.data);

        console.log(`Done creating team with name: ${org}:${sanitizedTeam}`);
        return result.data;
      }).catch(err => logError(err, 'team:create'));
    } else {
      console.log(`Dry run set, not writing new team ${org}:${sanitizedTeam}`);
    }
  }

  /**
   * Adds repository to given team in organization. First calls GitHub to get
   * an ID given team name and organization. This ID is used in call to attach
   * given repo to a team.
   */
  async addRepoToTeam(org, team, repo, permissions = 'pull', overwrite = true) {
    if (!org || !team || !repo) {
      console.log('addRepoToTeam command requires organization, team, and repo to be set');
      return;
    }
    if (!overwrite && (await doesTeamManageRepo(org, team, repo))) {
      console.log(`${org}/${repo} is already managed by ${team} and is set to not overwrite, returning`);
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
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.addOrUpdateRepo({
        owner: org,
        team_id: teamData.id,
        repo: repo,
        permission: permissions,
      }).then(result => {
        console.log(`Done adding repo to team: ${repo} -> ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:addOrUpdateRepo'));
    } else {
      console.log(`Dry run set, not writing new team ${org}/${sanitizedTeam}`);
    }
  }

  /**
   * Invites user with username of 'uname' to the given team in given
   * organization. Checks current member list to see if user should be
   * invited.
   */
  async inviteUserToTeam(org, team, uname) {
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
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.addOrUpdateMembership({
        team_id: teamData.id,
        username: uname,
      }).then(result => {
        console.log(`Done inviting user to team: ${uname} -> ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:addOrUpdateMembership'));
    }
  }

  /**
   * Removes user with username of 'uname' from the given team in given
   * organization. Checks current member list to see if user should be
   * removed.
   */
  async removeUserFromTeam(org, team, uname) {
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
    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.removeMembership({
        team_id: teamData.id,
        username: uname,
      }).then(result => {
        console.log(`Done removing user from team: ${uname} -> ${org}/${sanitizedTeam}`);
      }).catch(err => logError(err, 'team:removeMembership'));
    }
  }

  /**
   * Renames the given team in the organization with the passed new name.
   */
  async renameTeam(org, team, newName) {
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

    if (!this.#dryrun) {
      callCount++;
      return octokit.teams.update({
        team_id: teamData.id,
        name: sanitizedNewTeam,
      }).then(result => {
        console.log(`Done renaming team: ${org}/${sanitizedTeam} -> ${org}/${sanitizedNewTeam}`);
      }).catch(err => logError(err, 'team:update'));
    }
  }

  /**
   * Creates a new repo with given name and an EPL-2.0 license.
   */
  addRepo(org, repo) {
    if (repoCache.getKey(getRepoCacheKey(org, repo)) != null) {
      console.log(`Repo with name ${repo} already exists for ${org}, skipping creation`);

      return repoCache.getKey(getRepoCacheKey(org, repo));
    }

    if (!this.#dryrun) {
      callCount++;
      return octokit.repos.createInOrg({
        org: org,
        name: repo,
        license_template: 'EPL-2.0',
      }).then(result => {
        // cache the result for later use
        repoCache.setKey(getRepoCacheKey(org, repo), result.data);

        console.log(`Done creating repo for org: ${org}/${repo}`);
        return result.data;
      }).catch(err => logError(err, 'repos:createInOrg'));
    }
  }

  /**
   * Retrieve all team members associated with a team, using multiple calls if
   * necessary to get all users on a team.
   */
  async getTeamMembers(org, team, teamId) {
    return getTeamMembers(org, team, teamId);
  }

  async editTeam(teamId, teamName, options) {
    console.log(`Updating team ${teamId} settings: ${JSON.stringify(options)}`);
    // allow for other options being set
    var opt = options;
    if (opt == null) {
      opt = {};
    }
    // set the required team options
    opt['team_id'] = teamId;
    opt['name'] = teamName;
    return await octokit.teams.update(opt)
      .then(result => result)
      .catch(err => logError(err, 'team:list'));
  }

  /**
   * Prefetch and fill caches with all existing teams for the current org.
   * Will check if prefetch has already been performed for current org.
   */
  async prefetchTeams(org) {
    if (prefetch['teams'][org] == true) {
      return;
    }
    console.log(`Starting prefetch for teams in org=${org}`);

    var options = octokit.teams.list.endpoint.merge({
      org: org,
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:list'));
    if (data == undefined) {
      return;
    }

    var count = 0;
    for (var i = 0; i < data.length; i++) {
      var team = data[i];
      var cacheKey = getTeamCacheKey(org, sanitizeTeamName(team.slug));

      teamCache.setKey(cacheKey, team);
      count++;
    }

    // set the prefetch flag for org to true
    prefetch['teams'][org] = true;
    console.log(`Finished prefetch for org=${org}, got ${count} teams`);
  }

  /**
   * Prefetch and fill caches with all existing repos for the current org.
   * Will check if prefetch has already been performed for current org.
   */
  async prefetchRepos(org) {
    if (prefetch['repos'][org] == true) {
      return;
    }
    console.log(`Starting prefetch for repos in org=${org}`);
    var options = octokit.repos.listForOrg.endpoint.merge({
      org: org,
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:listMembers'));
    if (data == undefined) {
      return;
    }
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      var repo = data[i];
      var cacheKey = getRepoCacheKey(org, repo.name);

      repoCache.setKey(cacheKey, repo);
      count++;
    }

    // set the prefetch flag for org to true
    prefetch['repos'][org] = true;
    console.log(`Finished prefetch for org=${org}, got ${count} repos`);
  }

  /**
   * Gets all teams for a given organization
   */
  async getTeamsForOrg(org) {
    await this.prefetchTeams(org);
    var out = [];
    for (var repo in teamCache.all()) {
      out.push(JSON.parse(JSON.stringify(teamCache.getKey(repo))));
    }
    return out;
  }

  /**
   * Wraps GitHub repo team functionality in paginate to reduce calls for
   * potential large repos. Returns raw results with no cache
   */
  async getReposForTeam(team) {
    console.log(`Getting repos associated with team: ${team.name}`);
    var options = octokit.teams.listRepos.endpoint.merge({
      team_id: team.id,
    });
    return await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'repos:listRepos'));
  }

  async getInvitedMembers(org, team, teamId) {
    // generate a cache key and check if we have a valid cache result.
    var cacheKey = getInvitedMembersCacheKey(org, team);
    var cachedResult = teamCache.getKey(cacheKey);

    console.log(`Getting invited members for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult == null) {
      // loop through all available users, and add them to a list to be
    // returned
      var options = octokit.teams.listPendingInvitations.endpoint.merge({
        team_id: teamId,
      });
      var data = await octokit.paginate(options)
        .then(result => result)
        .catch(err => logError(err, 'team:listPendingInvitations'));
      if (data == undefined) {
        return undefined;
      }

      // save the data to cache to avoid reprocessing
      teamCache.setKey(cacheKey, data);

      // return the data for usage
      return Array.from(data);
    } else {
      console.log(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return Array.from(cachedResult);
    }
  }

  async getOrgCollaborators(org) {
    var cacheKey = getOrgCollabCacheKey(org);
    var cachedResult = orgCache.getKey(cacheKey);

    console.log(`Getting invited members for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult == null) {
      // loop through all available users, and add them to a list to be
    // returned
      var options = octokit.orgs.listOutsideCollaborators.endpoint.merge({
        org: org,
      });
      var data = await octokit.paginate(options)
        .then(result => result)
        .catch(err => logError(err, 'orgs:listOutsideCollaborators'));
      if (data == undefined) {
        return undefined;
      }

      // save the data to cache to avoid reprocessing
      orgCache.setKey(cacheKey, data);

      // return the data for usage
      return Array.from(data);
    } else {
      console.log(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return Array.from(cachedResult);
    }
  }

  async getRepoCollaborators(org, repo, affiliation = 'direct') {
    // generate a cache key and check if we have a valid cache result.
    var cacheKey = getRepoCollaboratorCacheKey(org, repo);
    var cachedResult = repoCache.getKey(cacheKey);

    console.log(`Getting collaborators for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult == null) {
      // loop through all available users, and add them to a list to be
    // returned
      var options = octokit.repos.listCollaborators.endpoint.merge({
        owner: org,
        repo: repo,
        affiliation: affiliation,
      });
      var data = await octokit.paginate(options)
        .then(result => result)
        .catch(err => logError(err, 'team:listCollaborators'));
      if (data == undefined) {
        return undefined;
      }

      // save the data to cache to avoid reprocessing
      teamCache.setKey(cacheKey, data);

      // return the data for usage
      return Array.from(data);
    } else {
      console.log(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return Array.from(cachedResult);
    }
  }


  async removeUserAsCollaborator(org, repo, uname) {
    if (!org || !repo || !uname) {
      console.log('removeUserAsCollaborator command requires organization, repo, and uname to be set');
      return;
    }

    var collabs = await this.getRepoCollaborators(org, repo);
    if (collabs == null) {
      console.log(`Could not find collaborators for team ${org}/${repo}`);
      return;
    }
    var isCollaborator = false;
    for (var i = 0; i < collabs.length; i++) {
      if (collabs[i].login == uname) {
        isCollaborator = true;
        break;
      }
    }
    if (!isCollaborator) {
      console.log(`User with usernmae '${uname}' is not a collaborator on ${org}/${repo}, cannot remove`);
      return;
    }

    // if not set to dryrun, invite user to team
    if (!this.#dryrun) {
      callCount++;
      return octokit.repos.removeCollaborator({
        owner: org,
        repo: repo,
        username: uname,
      }).then(result => {
        console.log(`Done removing user from team: ${uname} -> ${org}/${repo}`);
      }).catch(err => logError(err, 'repo:removeCollaborator'));
    }
  }

  async removeUserAsOutsideCollaborator(org, uname) {
    if (!org || !uname) {
      console.log('removeUserAsOutsideCollaborator command requires organization and uname to be set');
      return;
    }

    var collabs = await this.getOrgCollaborators(org);
    if (collabs == null) {
      console.log(`Could not find outside collaborators for team ${org}`);
      return;
    }
    var isCollaborator = false;
    for (var i = 0; i < collabs.length; i++) {
      if (collabs[i].login == uname) {
        isCollaborator = true;
        break;
      }
    }
    if (!isCollaborator) {
      console.log(`User with usernmae '${uname}' is not an outside collaborator on ${org}, cannot remove`);
      return;
    }

    // if not set to dryrun, remove outside collaborator from org
    if (!this.#dryrun) {
      callCount++;
      return octokit.orgs.removeOutsideCollaborator({
        org: org,
        username: uname,
      }).then(result => {
        console.log(`Done removing outside collaborator from org: ${uname} -> ${org}`);
      }).catch(err => logError(err, 'orgs:removeOutsideCollaborator'));
    }
  }

  /**
   * Updates permissions for a given organization given an object
   * with permissions and organization name.
   */
  updateOrgPermissions(org, permissions) {
    if (org == undefined || org == '') {
      console.log('Cannot update permissions for empty org name');
      return;
    }
    if (permissions == undefined || !(permissions instanceof Object)) {
      console.log('Cannot update organization with empty permissions');
      return;
    }
    // copy the permissions, and set the org into the new params object
    var params = JSON.parse(JSON.stringify(permissions));
    params.org = org;
    // required in v16 to enable additional management fields
    params.mediaType = {
      previews: ['surtur'],
    };
    if (!this.#dryrun) {
      // increment the call count  and update the permissions for the organization
      callCount++;
      return octokit.orgs.update(params).then(result => {
      // if verbose is set, print the parameters to console
        if (this.#verbose) {
          console.log(`Done updating org (${org}) to set parameters: ${JSON.stringify(params)}`);
        } else {
          console.log(`Done updating org (${org}) to set parameters.`);
        }
      }).catch(err => logError(err, 'orgs:update'));
    } else {
      console.log(`Dry run enabled, would have updated org (${org}) to set parameters: ${JSON.stringify(params)}`);
    }
  }

  getOrganization(org) {
    // generate a cache key and check if we have a valid cache result.
    var cacheKey = getOrgCacheKey(org);
    var cachedResult = orgCache.getKey(cacheKey);

    console.log(`Getting org for key: ${cacheKey}`);
    // fetch if we don't have a cached result
    if (cachedResult == null) {
      callCount++;
      return octokit.orgs.get({
        org: org,
        mediaType: {
          previews: ['surtur'],
        },
      }).then(result => {
        // cache the data in memory for use later
        orgCache.setKey(cacheKey, result.data);
        // return the data to the user
        return JSON.parse(JSON.stringify(result.data));
      }).catch(err => logError(err, 'orgs:get'));
    } else {
      console.log(`Found cached result for key ${cacheKey}`);

      // return result to be immediately used
      return JSON.parse(JSON.stringify(cachedResult));
    }
  }

  /**
   * Used to read cached/discovered repositories given an org name.
   */
  getDiscoveredRepos(org) {
    var out = [];
    var keys = repoCache.keys();
    var regex = new RegExp(`^${org}\/.*$`);
    for (var kIdx in keys) {
      var key = keys[kIdx];
      if (regex.test(key)) {
        out.push(repoCache.getKey(key));
      }
    }
    return out;
  }

  /**
   * Used to read cached/discovered repositories given an org name.
   */
  async getTeamsForRepo(org, repo) {
    if (!org || !repo) {
      console.log('getTeamsForRepo command requires organization and repo to be set');
      return;
    }
    // if not set to dryrun, remove outside collaborator from org
    var options = octokit.repos.listTeams.endpoint.merge({
      owner: org,
      repo: repo,
    });
    return await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'repos:listTeams'));
  }

  sanitizeTeamName(name) {
    return name.toLowerCase().replace(/[^\s\da-zA-Z-]/g, '-');
  }
};
/** END OF EXPORTS */


/**
 * Wraps GitHub team retrieval functionality with simple caching and returning
 * future promises of content, or the content directly if cached. Deep copies
 * data to prevent external modification of state
 */
function getTeam(org, team) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamCacheKey(org, sanitizeTeamName(team));
  var cachedResult = teamCache.getKey(cacheKey);

  console.log(`Getting team for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult == null) {
    callCount++;
    return octokit.teams.getByName({
      org: org,
      team_slug: sanitizeTeamName(team),
    }).then(result => {
      // cache the data in memory for use later
      teamCache.setKey(cacheKey, result.data);

      // return the data to the user
      return JSON.parse(JSON.stringify(result.data));
    }).catch(err => logError(err, 'team:getByName'));
  } else {
    console.log(`Found cached result for key ${cacheKey}`);

    // return result to be immediately used
    return JSON.parse(JSON.stringify(cachedResult));
  }
}

/**
 * Gets team members from API. Returns deep copies of results to prevent
 * modification of state data.
 */
async function getTeamMembers(org, team, teamId) {
  // generate a cache key and check if we have a valid cache result.
  var cacheKey = getTeamMembersCacheKey(org, team);
  var cachedResult = teamCache.getKey(cacheKey);

  console.log(`Getting team members for key: ${cacheKey}`);
  // fetch if we don't have a cached result
  if (cachedResult == null) {
    // loop through all available users, and add them to a list to be returned
    var options = octokit.teams.listMembers.endpoint.merge({
      team_id: teamId,
    });
    var data = await octokit.paginate(options)
      .then(result => result)
      .catch(err => logError(err, 'team:listMembers'));
    if (data == undefined) {
      return undefined;
    }

    // save the data to cache to avoid reprocessing
    teamCache.setKey(cacheKey, data);

    // return the data for usage
    return Array.from(data);
  } else {
    console.log(`Found cached result for key ${cacheKey}`);

    // return result to be immediately used
    return Array.from(cachedResult);
  }
}

async function doesTeamManageRepo(org, teamName, repo) {
  if (!org || !teamName || !repo) {
    console.log('checkManagesRepoInOrg command requires organization, team, and repo to be set');
    return;
  }
  var sanitizedTeamName = sanitizeTeamName(teamName);
  // get the team for its ID
  var team = getTeam(org, sanitizedTeamName);
  if (team == undefined) {
    console.log(`Could not find team for ${org}/${sanitizedTeamName}, returning false for team management`);
    return false;
  }
  // check if we already know about this teams management of repo
  var cachedResult = teamCache.getKey(getTeamManagementCacheKey(org, team.id, repo));
  if (cachedResult != null) {
    return cachedResult;
  }
  // attempt to check, catching errors which throw on 404s
  try {
    var result = await octokit.teams.checkManagesRepoLegacy({
      team_id: team.id,
      owner: org,
      repo: repo,
    });
    teamCache.setKey(getTeamManagementCacheKey(org, team.id, repo), result.status == 204);
    return result.status == 204;
  } catch (e) {
    console.log('Retrieved an error, assuming team does not manage repo');
    return false;
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
function getTeamManagementCacheKey(org, team, repo) {
  return `${getRepoCacheKey(org, repo)}->${team}:manages`;
}

function getInvitedMembersCacheKey(org, team) {
  return `${getTeamCacheKey(org, team)}:invited`;
}

function getRepoCollaboratorCacheKey(org, repo) {
  return `${getRepoCacheKey(org, repo)}:collab`;
}

function getRepoCacheKey(org, repo) {
  return `${org}/${repo}`;
}
function getOrgCollabCacheKey(org) {
  return `collaborators:${org}`;
}
function getOrgCacheKey(org) {
  return `org:${org}`;
}
/**
 * Logs error content when passed, printing the root called that was passed for
 * additional contextual information.
 */
function logError(err, root) {
  console.log(`API encountered errors processing current request (${root}). More information is available in log file`);
  if (err.errors) {
    for (var i = 0; i < err.errors.length; i++) {
      console.log(`${err.errors[i].message}`);
    }
  }
  console.log(err);
}
