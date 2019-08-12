/* Copyright (c) 2019 Eclipse Foundation and others.
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0
 * which is available at http://www.eclipse.org/legal/epl-v20.html,
 * SPDX-License-Identifier: EPL-2.0
 */
package com.eclipsefoundation.github.sync.model;

import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

/**
 * @author Martin Lowe
 */
@Command(description = "", name = "eclipsefdn-github-sync", mixinStandardHelpOptions = true, version = "0.1")
public class ApplicationParameters {

	@Option(names = { "-c",
			"--create_team" }, description = "Flag to indicate that a new team should be created for the current run.")
	private boolean createTeam;

	@Option(names = { "-t", "--team" }, description = "The name of the team.")
	private String team;

	@Option(names = { "-o", "--organization" }, description = "The name of the targeted organization")
	private String organization;

	@Option(names = { "-T", "--token" }, description = "The authorized GitHub access Token", required = true)
	private String accessToken;

	@Option(names = { "-d",
			"--dry_run" }, description = "Enables dry run for the script, disabling writing functionality")
	private boolean dryRun;

	/**
	 * @return the access token for the current application run
	 */
	public String getAccessToken() {
		return accessToken;
	}

	/**
	 * @return indicated name of the organization
	 */
	public String getOrganization() {
		return organization;
	}

	/**
	 * @return indicated name of the team
	 */
	public String getTeam() {
		return team;
	}

	/**
	 * @return whether the application should create a new team
	 */
	public boolean isCreateTeam() {
		return createTeam;
	}

	/**
	 * @return whether the current application is being run as a dry run
	 */
	public boolean isDryRun() {
		return dryRun;
	}
}
