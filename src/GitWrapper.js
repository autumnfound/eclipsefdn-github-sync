const Octokit = require('@octokit/rest');

module.exports = function(token) {
	// instantiate octokit
	const octokit = new Octokit({
	  auth: token
	});
	
	this.addTeam = function(org, name, dryRun) {
	  // call the API if dry run is not set
	  if (!dryRun) {
	    octokit.teams.create({
	      'org': org,
	      'name': name,
	      'privacy': 'closed'
	    }).then(result => {
	      console.log(`Done creating team with name: ${org}:${name}`);
	    }).catch(err =>{
	    	if (err.errors) {
	    		console.log('API encountered the following errors processing current request:\n');
	    		for (var i = 0; i < err.errors.length; i++) {
		    		console.log('\t'+err.errors[i].message);
	    		}
	    	} else {
	    		console.log(err);
	    	}
	    });
	  } else {
	    console.log(`Dry run set, not writing new team ${org}:${name}`);
	  }
	}
}