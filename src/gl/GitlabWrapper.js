/*! **************************************************************
 * Copyright (C) 2021 Eclipse Foundation, Inc.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0/
 *
 * Contributors: Martin Lowe <martin.lowe@eclipse-foundation.org>
 *
 * SPDX-License-Identifier: EPL-2.0
 ************************************************************** */

const VERBOSE_SECONDARY_BASIC = 1;
const VERBOSE_SECONDARY_MEDIUM = 2;

const CONTRIBUTOR_PERMS_LEVEL = 20;
const COMMITTER_PERMS_LEVEL = 30;

const { Gitlab } = require('gitlab');
const uuid = require('uuid');

class GitlabWrapper {
  #gitlab;
  #eclipseAPI;
  /** Access token used for current and child instances of Gitlab API, should never be exposed */
  #accessToken;
  /** URI to remote Gitlab host */
  #host;
  set host(val) {
    this.#host = val;
  }
  get host() {
    return this.#host;
  }
  /** Name of provider used in Gitlab for remote login */
  #provider;
  set provider(val) {
    this.#provider = val;
  }
  get provider() {
    return this.#provider;
  }
  /** Whether logging should be verbose */
  #verbose;
  set verbose(val) {
    if (typeof val === 'number') {
      this.#verbose = val;
    }
  }
  get verbose() {
    return this.#verbose > 0;
  }
  /** Whether the wrapper should action write operations */
  #dryRun;
  set dryRun(val) {
    if (typeof val === 'boolean') {
      this.#dryRun = val;
    }
  }
  get dryRun() {
    return this.#dryRun;
  }

  /**
  Creates a wrapping class that contains logic for common operations in Gitlab when migrating/syncing content.

  @param accessToken the generated Gitlab instance, with set host and access token for immediate usage.
  @param eclipseAPI reference to an Eclipse API wrapper to fetch data from the Eclipse API for user creation.
   */
  constructor(accessToken, host, provider, eclipseAPI, verbose = false, sudo = undefined) {
    this.#accessToken = accessToken;
    this.#host = host;
    this.#provider = provider;
    this.#eclipseAPI = eclipseAPI;
    this.#gitlab = createAdminGitlab(this.#accessToken, this.#host, sudo);
    this.#verbose = verbose;
  }

  /**
  Retrieves active Gitlab user with given username if it exists. If the user does not exist, it is created.

  @param uname the username to retrieve a Gitlab user for
  */
  async getUser(uname) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:getUser(uname = ${uname})`);
    }
    // look for user that already exists
    var u = await this.#gitlab.Users.search(uname);
    if (u === undefined || u === null || (Array.isArray(u) && u.length === 0)) {
      if (this.#dryRun) {
        console.log(`Dryrun is enabled. Would have created user ${uname} but was skipped`);
        return;
      }

      // retrieve user data
      var data = await this.#eclipseAPI.eclipseUser(uname);
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
        email: `dummy+${uuid.v4()}@eclipse.org`, // data.mail,
        extern_uid: data.uid,
        provider: this.#provider,
        skip_confirmation: true,
      };

      // if verbose, display information being used to generate user
      if (this.#verbose > 0) {
        // copy the object and redact the password for security
        var optLog = JSON.parse(JSON.stringify(opts));
        optLog.password = 'redacted';
        console.log(`Creating user with options: ${JSON.stringify(optLog)}`);
      }
      try {
        u = await this.#gitlab.Users.create(opts);
      } catch (err) {
        console.log(err);

      }
      if (u === null) {
        console.log(`Error while creating user '${uname}'`);
        return;
      }
    }
    if (Array.isArray(u)) {
      return u[0];
    }
    return u;
  }


  async getGroup(groupName) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:getGroup(groupName = ${groupName})`);
    }
    return await this.#gitlab.Groups.search(groupName);
  }

  async createGroup(name, path, parent, opts = {}) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabSync:createGroup(name = ${name}, path = ${path}, parent = ${parent}, opts = ${JSON.stringify(opts)})`);
    }
    // create default params for creating group
    let defaults = {
      name: name,
      path: path,
      project_creation_level: 'noone',
      visibility: 'public',
      request_access_enabled: false,
      emails_disabled: false,
    };
    if (parent !== undefined && parent.id !== undefined) {
      opts.parent_id = parent.id;
    }
    // allow for override of default params
    let params = Object.assign({}, defaults, opts);
    // check if dry run before creating group
    if (this.#dryRun) {
      console.log(`Dryrun flag active, would have created new group '${name}' with options ${JSON.stringify(opts)}`);
      return;
    }
    // if verbose is set display user opts
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`Creating group with options: ${JSON.stringify(params)}`);
    }
    try {
      let g = await this.#gitlab.Groups.create(params);
      if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
        console.log(`Created group: ${JSON.stringify(g)}`);
      }
      return g;
    } catch (err) {
      console.log(err);
    }
  }

  async removeGroup(groupID) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:removeGroup(groupID = ${groupID})`);
    }
    if (!this.#dryRun) {
      try {
        return await this.#gitlab.Groups.remove(groupID);
      } catch (err) {
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(err);
        }
      }
    } else {
      console.log('');
    }
  }

  async addUserToGroup(groupID, userID, access = CONTRIBUTOR_PERMS_LEVEL, expiration = undefined) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:addUserToGroup(groupID = ${groupID}, userID = ${userID}, access = ${access})`);
    }
    if (!this.#dryRun) {
      try {
        return await this.#gitlab.GroupMembers.add(groupID, userID, access, {
          expires_at: expiration,
        });
      } catch (err) {
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(err);
        }
      }
    } else {
      console.log('');
    }

  }

  async shareProjectWithGroup(projectID, groupID, access = COMMITTER_PERMS_LEVEL) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:shareProjectWithGroup(projectID = ${projectID}, groupID = ${groupID}, access = ${access})`);
    }
    if (!this.#dryRun) {
      try {
        return await this.#gitlab.Projects.share(projectID, groupID, access);
      } catch (err) {
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(err);
        }
      }
    } else {
      console.log('');
    }
  }

  async editProject(projectID, updates = {}) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:getGroup(projectID = ${projectID}, updates = ${JSON.stringify(updates)})`);
    }
    if (!this.#dryRun) {
      try {
        return await this.#gitlab.Projects.edit(projectID, updates);
      } catch (err) {
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(err);
        }
      }
    } else {
      console.log('');
    }
  }

  /**
  Create Gitlab issue with the given properties within the designated project.

  @param {number|string} projectID the project that the issue should be made against
  @param {string} title the title of the issue
  @param {string} description the description of the issue
  @param {String} createdAt (optional) the date of creation for the issue. ISO 8601 formatted, for example 2021-01-13T01:10:40Z
   */
  async createIssue(projectID, title, description, createdAt) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:createIssue(projectID = ${projectID}, title = ${title}, description = ${description},
         createdAt = ${createdAt})`);
    }
    if (!this.#dryRun) {
      try {
        return this.#gitlab.Issues.create(projectID, {
          title: title,
          createdAt: createdAt,
          description: description,
        });
      } catch (err) {
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(err);
        }
      }
    } else {
      console.log('');
    }
  }

  /**
  Update Gitlab issue with the given properties within the designated project.

  @param {number|string} projectID the project that the issue should be made against
  @param {string} issueID the internal Issue ID of the ID to be updated
  @param {Record<String, any>} updates the updates to be made in the issue, set in an object
   */
  async editIssue(projectID, issueID, updates) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:editIssue(projectID = ${projectID}, issueID = ${issueID}, updates = ${updates})`);
    }
    if (!this.#dryRun) {
      try {
        return this.#gitlab.Issues.edit(projectID, issueID, updates);
      } catch (err) {
        if (this.#verbose > VERBOSE_SECONDARY_MEDIUM) {
          console.log(err);
        }
      }
    } else {
      console.log('');
    }
  }

  /**
  Create a comment within the designated project issue with given body and date.

  @param {number|string} projectID the project that the issue should be made against
  @param {number|string} issueID the ID of the issue that this comment is made against
  @param {string} body the body of the issue comment
  @param {string} createdAt (optional) the date of creation for the issue. ISO 8601 formatted, for example 2021-01-13T01:10:40Z
   */
  async createIssueComment(projectID, issueID, body, createdAt) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:createIssueComment(projectID = ${projectID}, issueID = ${issueID}, body = ${body},
         createdAt = ${createdAt})`);
    }
    if (!this.#dryRun) {
      return await this.#gitlab.IssueNotes.create(projectID, issueID, body, {
        createdAt: createdAt,
      });
    } else {
      console.log('');
    }
  }

  async addUserToProject(projectID, userID, permissions = CONTRIBUTOR_PERMS_LEVEL, expiration = undefined) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:addUserToProject(projectID = ${projectID}, userID = ${userID}, permissions = ${permissions},` +
        `expiration = ${expiration})`);
    }
    let opts = {
      expires_at: expiration ? expiration.toISOString() : undefined,
    };
    if (!this.#dryRun) {
      try {
        return await this.#gitlab.ProjectMembers.add(projectID, userID, permissions, opts);
      } catch (e) {
        console.log(e);
      }
    } else {
      console.log('');
    }
  }

  /**
  TODO

  @param file base64 encoded file data to be transmitted
   */
  async uploadIssueFile(projectID, file, fileName, opts = {}) {
    if (this.#verbose > VERBOSE_SECONDARY_BASIC) {
      console.log(`GitlabWrapper:uploadIssueFile(projectID = ${projectID}, file = (OMMITTED), opts = ${opts})`);
    }
    if (!this.#dryRun) {
      try {
        return await this.#gitlab.Projects.upload(projectID, Buffer.from(file, 'base64'), {
          metadata: {
            filename: fileName,
          },
        }, opts);
      } catch (e) {
        console.log(e);
      }
    } else {
      console.log('');
    }
  }

  /**
  Creates a Gitlab Wrapper for the given user, assuming that the current session/access token is an admin level token (which can use
  the sudo field to impersonate users). Reuses the same Eclipse API wrapper as it is still good.

  @param {string} uname the username to create an impersonated Gitlab wrapper for
  @param {string} secretRoot the secret files root path for retrieving access tokens
   */
  async getImpersonatedWrapper(uname) {
    // get the designated user if it exists
    var user = await this.getUser(uname);
    if (user !== undefined) {
      return new GitlabWrapper(this.#accessToken, this.#host, this.#provider, this.#eclipseAPI, this.#verbose, user.id);
    } else {
      console.log(`Could not fetch impersonated Gitlab instance, no user found for '${uname}'`);
    }
  }
}

/**
Creates a Gitlab instance with the current access token secret, and optionally sudo ID when impersonating a user. This ID
should be the users internal Gitlab user ID, not the external Eclipse username.

@param {string} accessToken the secret files root path for retrieving access tokens
@param {string} host the secret files root path for retrieving access tokens
@param {number|string} sudo (optional) the user ID to create an impersonated Gitlab instance for (optional)
 */
function createAdminGitlab(accessToken, host, sudo) {
  // retrieve the secret API file root if set
  if (accessToken !== undefined) {
    var options = {
      host: host,
      token: accessToken,
    };
    // allow impersonation
    if (sudo !== undefined) {
      options['sudo'] = sudo;
    }
    return new Gitlab(options);
  } else {
    console.log('Could not find the GitLab access token, returning');
  }
}
module.exports.GitlabWrapper = GitlabWrapper;
module.exports.createAdminGitlab = createAdminGitlab;
