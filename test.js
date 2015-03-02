var hubfs = require('./');
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

var fs = hubfs(repo);

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

function pauseAndEnd(t) {
    return function(err) {
        setTimeout(t.end.bind(null, err), 500);
    };
}

setup();

test('Creates new file', function(t) {
    fs.writeFile('test.txt', 'hello world', pauseAndEnd(t));
});

test('Updates an existing file', function(t) {
    fs.writeFile('test.txt', 'hello planet', pauseAndEnd(t));
});

test('Creates large file', function(t) {
    fs.writeFile('test.bin', new Buffer(1100000), pauseAndEnd(t));
});

test('Updates large file', function(t) {
    fs.writeFile('test.bin', new Buffer(1100002), pauseAndEnd(t));
});

test('Reads text file', function(t) {
    fs.readFile('test.txt', { encoding: 'utf8' }, function(err, data) {
        t.error(err);
        t.equal(data, 'hello planet');
        t.end();
    });
});

test('Reads binary file', function(t) {
    fs.readFile('test.txt', function(err, data) {
        t.error(err);
        t.ok(bufferEqual(data, new Buffer('hello planet')), 'Buffer contents match');
        t.end();
    });
});

test('Reads large file', function(t) {
    fs.readFile('test.bin', t.end);
});

teardown();
