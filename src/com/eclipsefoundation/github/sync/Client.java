/* Copyright (c) 2019 Eclipse Foundation and others.
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0
 * which is available at http://www.eclipse.org/legal/epl-v20.html,
 * SPDX-License-Identifier: EPL-2.0
 */
package com.eclipsefoundation.github.sync;

import java.io.IOException;

import org.eclipse.egit.github.core.Team;
import org.eclipse.egit.github.core.service.TeamService;

import com.eclipsefoundation.github.sync.model.ApplicationParameters;

import picocli.CommandLine;

/**
 * Entry point and main class for using the toolset.
 * 
 * @author Martin Lowe
 */
public class Client {

	private GitHubWrapper wrap;
	private ApplicationParameters params;
	
	public Client(GitHubWrapper wrap, ApplicationParameters params) {
		this.wrap = wrap;
		this.params = params;
	}
	
	public static void main(String[] args) {
		// parse the CLI args
		ApplicationParameters params = new ApplicationParameters();
		new CommandLine(params).parseArgs(args);
		
		// get a wrapper for GitHub
		GitHubWrapper wrap = new GitHubWrapper(params.getAccessToken());
		Client c = new Client(wrap, params);
		
		if (params.isCreateTeam()) {
			c.createTeam();
		}
	}

	public void createTeam() {
		TeamService teamService = wrap.getTeamService();
		try {
			// create the model for the new team and set the parameters
			Team t = new Team();
			t.setName(params.getTeam());
			t.setPermission("pull");
			
			// call the service to create the team
			teamService.createTeam(params.getOrganization(), t);
		} catch (IOException e) {
			System.out.print(e);
		}
	}
}
