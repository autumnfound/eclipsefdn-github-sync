var chai = require('chai');
var expect = chai.expect;

const { StaticTeamManager, ServiceTypes } = require('../src/teams/StaticTeamManager.js');
const SAMPLE_TEAM_NAME = 'sample-triage';
describe('StaticTeamManager', function() {
  let defaultStm;
  beforeEach(function() {
    defaultStm = new StaticTeamManager();
  });

  describe('#constructor', function() {
    it('should allow no-arg constructor', function() {
      expect(defaultStm).to.be.an('object').and.not.equal(null);
    });

    it('should allow array param', function() {
      expect(new StaticTeamManager([getTestTeam()])
        .extendedTeamData.filter(team => team.teamName === SAMPLE_TEAM_NAME)).to.not.be.empty;
    });

    it('should ignore non-array param', function() {
      expect(new StaticTeamManager(getTestTeam())
        .extendedTeamData.filter(team => team.teamName === SAMPLE_TEAM_NAME)).to.be.an('array').and.to.be.empty;
    });
  });

  describe('#verbose', function() {
    it('should be false by default', function() {
      expect(defaultStm.verbose).to.be.a('boolean').and.to.equal(false);
    });
    it('can be set directly', function() {
      defaultStm.verbose = true;
      expect(defaultStm.verbose).to.be.a('boolean').and.to.equal(true);
    });
    it('should not accept boolean-like string arguments', function() {
      defaultStm.verbose = "true";
      expect(defaultStm.verbose).to.be.a('boolean').and.to.equal(false);
    });
    it('should not accept boolean-like int arguments', function() {
      defaultStm.verbose = 1;
      expect(defaultStm.verbose).to.be.a('boolean').and.to.equal(false);
    });
    it('should not accept Boolean arguments', function() {
      defaultStm.verbose = new Boolean(true);
      expect(defaultStm.verbose).to.equal(false);
    });
    it('should not cast as Boolean class object for return', function() {
      defaultStm.verbose = new Boolean(true);
      expect(defaultStm.verbose).to.be.a('boolean');
    });
  });
  describe('#getPermissionsForTeam', function() {
    describe('success', function() {
      describe('-> github', function() {
        it('should define read permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'READ' }), ServiceTypes.GITHUB)).to.be.a('string').and.to.equal('pull');
        });
        it('should define triage permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam(), ServiceTypes.GITHUB)).to.be.a('string').and.to.equal('triage');
        });
        it('should define write permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'WRITE' }), ServiceTypes.GITHUB)).to.be.a('string').and.to.equal('push');
        });
        it('should define maintain permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'MAINTAIN' }), ServiceTypes.GITHUB)).to.be.a('string').and.to.equal('maintain');
        });
        it('should define admin permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'ADMIN' }), ServiceTypes.GITHUB)).to.be.a('string').and.to.equal('admin');
        });
      });

      describe('-> gitlab', function() {
        it('should define read permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'READ' }), ServiceTypes.GITLAB)).to.be.a('string').and.to.equal('10');
        });
        it('should define triage permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam(), ServiceTypes.GITLAB)).to.be.a('string').and.to.equal('20');
        });
        it('should define write permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'WRITE' }), ServiceTypes.GITLAB)).to.be.a('string').and.to.equal('30');
        });
        it('should define maintain permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'MAINTAIN' }), ServiceTypes.GITLAB)).to.be.a('string').and.to.equal('40');
        });
        it('should define admin permissions', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'ADMIN' }), ServiceTypes.GITLAB)).to.be.a('string').and.to.equal('40');
        });
      });
    });
    describe('failure', function() {
      it('should return null for null service type', function() {
        expect(defaultStm.getPermissionsForTeam(getTestTeam(), null)).to.equal(null);
      });
      describe('-> github', function() {
        it('should return null for invalid permission', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'REPORTER' }), ServiceTypes.GITHUB)).to.equal(null);
        });
        it('null team should return null', function() {
          expect(defaultStm.getPermissionsForTeam(null, ServiceTypes.GITHUB)).to.equal(null);
        });
      });
      describe('-> gitlab', function() {
        it('should return null for invalid permission', function() {
          expect(defaultStm.getPermissionsForTeam(getTestTeam({ 'permission': 'REPORTER' }), ServiceTypes.GITLAB)).to.equal(null);
        });
        it('null team should return null', function() {
          expect(defaultStm.getPermissionsForTeam(null, ServiceTypes.GITLAB)).to.equal(null);
        });
      });
    });
  });

  describe('#processTeams', function() {
    describe('success', function() {
      it('should be able to handle mixed repo teams', function() {
        let tmpManager = new StaticTeamManager([getTestTeam()]);
        expect(tmpManager.processTeams(ServiceTypes.GITHUB)
          .filter(team => team.name === SAMPLE_TEAM_NAME)).to.have.lengthOf('1');
        expect(tmpManager.processTeams(ServiceTypes.GITLAB)
          .filter(team => team.name === SAMPLE_TEAM_NAME)).to.have.lengthOf('1');
      });
      it('should be able to return Github teams', function() {
        expect(new StaticTeamManager([
          getTestTeam({ 'repos': ['https://github.com/eclipsefdn-webdev/example'] })
        ])
          .processTeams(ServiceTypes.GITHUB)
          .filter(team => team.name === SAMPLE_TEAM_NAME)).to.have.lengthOf('1');
      });
      it('should be able to return Gitlab teams', function() {
        expect(new StaticTeamManager([
          getTestTeam({ 'repos': ['https://gitlab.eclipse.org/eclipsefdn-webdev/example'] })
        ])
          .processTeams(ServiceTypes.GITLAB)
          .filter(team => team.name === SAMPLE_TEAM_NAME)).to.have.lengthOf('1');
      });
      it('should be able to filter Github only teams', function() {
        expect(new StaticTeamManager([
          getTestTeam({ 'repos': ['https://github.com/eclipsefdn-webdev/example'] })
        ])
          .processTeams(ServiceTypes.GITLAB)
          .filter(team => team.name === SAMPLE_TEAM_NAME)).to.be.empty;
      });
      it('should be able to filter Gitlab only teams', function() {
        expect(new StaticTeamManager([
          getTestTeam({ 'repos': ['https://gitlab.eclipse.org/eclipsefdn-webdev/example'] })
        ])
          .processTeams(ServiceTypes.GITHUB)
          .filter(team => team.name === SAMPLE_TEAM_NAME)).to.be.empty;
      });
    });
    describe('failure', function() {
      it('should return no result for invalid permission', function() {
        expect(new StaticTeamManager([getTestTeam({ 'permission': 'REPORTER' })])
          .processTeams(ServiceTypes.GITHUB)
          .filter(team => team.teamName === SAMPLE_TEAM_NAME)).to.be.empty;
      });
    });
  });
});

/**
Helper that retrieves a basic test team for the Static team manager. Allows for a passed object to override some of the basic settings to reduce duplication.
 */
function getTestTeam(overrides = {}) {
  return Object.assign({
    "repos": [
      "https://github.com/eclipsefdn-webdev/example",
      "https://gitlab.eclipse.org/eclipsefdn-webdev/example"
    ],
    "teamName": SAMPLE_TEAM_NAME,
    "members": [
      {
        "name": "sampleuser",
        "url": "https://api.eclipse.org/account/profile/sampleuser",
        "expiration": ""
      }
    ],
    "permission": "TRIAGE",
    "expiration": "2099-12-31"
  }, overrides);
}