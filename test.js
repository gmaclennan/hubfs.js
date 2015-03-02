var ghfs = require('./');
var test = require('tape');
var Octokat = require('octokat');
var dotenv = require('dotenv');
var bufferEqual = require('buffer-equal');

dotenv.load();

var tempRepoName = 'test' + Date.now();
var testUser = process.env.GITHUB_USER;

var octo = new Octokat({
  token: process.env.GITHUB_TOKEN
});

var repo = octo.repos(testUser, tempRepoName);

var gh = ghfs(repo);

function setup() {
    test('Create temporary test repo', function(t) {
        octo.user.repos.create({ name: tempRepoName, auto_init: true }, t.end);
    });
}

function teardown() {
    test('Delete temporary test repo', function(t) {
        octo.repos(testUser, tempRepoName).remove(t.end);
    });
}

setup();

test('Creates new file', function(t) {
    gh.writeFile('test.txt', 'hello world', t.end);
});

test('Updates an existing file', function(t) {
    gh.writeFile('test.txt', 'hello planet', t.end);
});

test('Creates large file', function(t) {
    gh.writeFile('test.bin', new Buffer(1100000), t.end);
});

test('Updates large file', function(t) {
    gh.writeFile('test.bin', new Buffer(1100002), t.end);
});

test('Reads text file', function(t) {
    gh.readFile('test.txt', { encoding: 'utf8' }, function(err, data) {
        t.error(err);
        t.equal(data, 'hello planet');
        t.end();
    });
});

test('Reads binary file', function(t) {
    gh.readFile('test.txt', function(err, data) {
        t.error(err);
        t.ok(bufferEqual(data, new Buffer('hello planet')), 'Buffer contents match');
        t.end();
    });
});

test('Reads large file', function(t) {
    gh.readFile('test.bin', t.end);
});

teardown();
