var chai = require('chai');
var expect = chai.expect;

const { SecretReader, getBaseConfig } = require('../src/SecretReader.js');
describe('SecretReader', function() {
  var reader = new SecretReader({ root: `${__dirname}/secrets` });
  describe('#readSecret', function() {
    describe('success', function() {
      var result = reader.readSecret('sample-secret');
      it('should be a string', function() {
        expect(result).to.be.a('string');
      });
      it('should be trimmed', function() {
        expect(result).to.equal(result.trim());
      });
      it('should be equal to', function() {
        expect(result).to.equal('sample-secret');
      });
    });
    describe('alternate encoding', function() {
      var result = reader.readSecret('non-utf-file', 'ascii');
      it('should be a string', function() {
        expect(result).to.be.a('string');
      });
      it('should be trimmed', function() {
        expect(result).to.equal(result.trim());
      });
      it('should be equal to', function() {
        expect(result).to.equal('us-ascii-test');
      });
    });
    describe('no file', function() {
      var result = reader.readSecret('random-file-name');
      it('should be null', function() {
        expect(result).to.equal(null);
      });
    });
  });
  describe('#getBaseConfig', function() {
    describe('success', function() {
      var result = getBaseConfig();
      it('should be an object', function() {
        expect(result).to.be.an('object');
      });
      it('should have a root property', function() {
        expect(result.root).to.be.a('string').and.to.not.equal(undefined);
      });
      it('should have an encoding property', function() {
        expect(result.encoding).to.be.a('string').and.to.not.equal(undefined);
      });
    });
    describe('immutability', function() {
      var result = getBaseConfig();
      // not with these tests, root needs to be provided as it can't be guaranteed that the base
      // secrets dir exists on all machines.
      it('should not change when creating a new reader', function() {
        // take a deep copy to avoid issues with references and data changes
        var resultBase = JSON.parse(JSON.stringify(result));
        // try with empty configs
        try {
          new SecretReader({});
        } catch (err) {
          // expected on most machines, but not all
        }
        var result1 = getBaseConfig();
        // with new properties
        new SecretReader({ root: __dirname, prop: 'test' });
        var result2 = getBaseConfig();
        // with modified base properties
        new SecretReader({ root: __dirname + '/secrets', encoding: 'test' });
        var result3 = getBaseConfig();

        expect(resultBase.root).to.equal(result1.root).and.to.equal(result2.root).and.to.equal(result3.root).and.to.not.equal(undefined);
        expect(resultBase.encoding).to.equal(result1.encoding).and.to.equal(result2.encoding).and.to.equal(result3.encoding).and.to.not.equal(undefined);
        expect(result2.prop).to.equal(undefined);
      });
      it('should not change when modifying value', function() {
        var result1 = getBaseConfig();
        var originalRoot = result1.root;
        result1.root = 'different_value';
        result1.prop = 'new property';
        var result2 = getBaseConfig();
        // they should be different objects
        expect(result1).to.not.equal(result2);
        // new properties should be separate from base configuration
        expect(result2.prop).to.equal(undefined);
        // second call should equal first calls values, and not the changed value
        expect(result2.root).to.equal(originalRoot).and.not.equal(result1.root);
      });
    });
  });
});