/* Copyright (c) 2019 Eclipse Foundation and others.
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0
 * which is available at http://www.eclipse.org/legal/epl-v20.html,
 * SPDX-License-Identifier: EPL-2.0
 */
package com.eclipsefoundation.github.sync;

import java.util.Objects;

import org.eclipse.egit.github.core.client.GitHubClient;
import org.eclipse.egit.github.core.service.TeamService;

/**
 * Encapsulates GitHub functionality and provides easy access to authorized functionality.
 * 
 * @author Martin Lowe
 *
 */
public class GitHubWrapper {
	private GitHubClient client;
	
	/**
	 * Initializes the internal client object with given access token.
	 * 
	 * @param accessToken
	 */
	public GitHubWrapper(String accessToken) {
		Objects.requireNonNull(accessToken);
		
		this.client = new GitHubClient();
		this.client.setOAuth2Token(accessToken);
	}
	
	public TeamService getTeamService() {
		return new TeamService(client);
	}
	
}
