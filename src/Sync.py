#!/usr/bin/env python
import config as cfg
from SyncClient import SyncClient
from github.GithubException import UnknownObjectException, GithubException

import re, sys, argparse

def __run():
    src = SyncClient.get_github_client(cfg.git_src)
    if args.create_team:
        __create_team(src,args.create_team[0],args.create_team[1])
    else:
        for org in src.get_user().get_orgs():
            # TODO: do we want to fallback or just use .login?
            org_display = org.name or org.login
            ## check that we match the org for one of our filters
            if __org_matches(org_display):
                for repo in org.get_repos():
                    print("Working with " + org_display + ":" + repo.name)
                    __process_issues(repo.get_issues())
            else:
                print(org_display + " doesn\'t match given organization filters, skipping")



# Creates a team with team_name, in the organization with login name of target_org,
# using the access rights of the current github_client
def __create_team(github_client, target_org, team_name):
    try:
        # try to retrieve organization with given login name
        org = github_client.get_organization(target_org)
        # in case we somehow don't get a valid org, return
        if not org:
            print(target_org+' doesn\'t match an available organization login string')
            return;

        # Indicate the found result, and create the team (if not dry run)
        print('Target org of '+target_org+' found! Creating team with name '+team_name)
        if not args.dry_run:
            org.create_team(team_name, privacy='closed')
    except UnknownObjectException:
        # exception thrown when there is no org with matching login
        print('ERROR: ' + target_org + ' doesn\'t match an available organization login string')
    except GithubException:
        # exception thrown when there is a team that exists with the given name
        print('ERROR: ' + team_name + ' already exists as a team within the given organization')


# The 'Do stuff' method for issues. This will have more stuff in it later.
def __process_issues(issues):
    for issue in issues:
        print('\t' + issue.title + ' #' + str(issue.number))


# Check that the org name matches the patterns/names set in the method arguments, which
# is by default the set of configuration organizations.
def __org_matches(org_name, org_patterns=cfg.orgs):
    for org_pattern in org_patterns:
        re_match = re.search(org_pattern, org_name)
        if re_match and re_match.group:
            return True
    return None


# Convert lists or singular var into a list of exclusive patterns for use in regex.
# While the strings can be used straight, this ensures there's no accidental partial matches.
def __generate_patterns_for_orgs(orgs):
    patterns = []
    if isinstance(orgs, list):
        for org in orgs:
            # wrap org name in ^<string>$ to make exclusive instead of inclusive search
            patterns.append('^'+org+'$')
    elif isinstance(orgs, str):
        patterns.append('^'+orgs+'$')
    return patterns


# get the CLI arguments
parser = argparse.ArgumentParser(description='TODO.')
parser.add_argument('-C', '--create_team', nargs=2, metavar="str", help="Creates a team with the following 2 arguments, the first being the target organization and the second being the new team name")
parser.add_argument('-d', '--dry_run', action="store_true", help="Enables dry run for the script, disabling writing functionality")
args = parser.parse_args(sys.argv[1:])

## Go back to top and run the script
__run()
