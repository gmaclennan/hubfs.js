var hubfs = require('./')
var test = require('tape')
var Octokat = require('octokat')
var dotenv = require('dotenv')
var bufferEqual = require('buffer-equal')
var async = require('async')

dotenv.load()

var tempRepoName = 'test' + Date.now()
var testUser = process.env.GITHUB_USER

var options = {
  owner: testUser,
  repo: tempRepoName,
  auth: {
    token: process.env.GITHUB_TOKEN
  }
}

var fs = hubfs(options)

function setup () {
  test('Create temporary test repo', function (t) {
    var octo = new Octokat(options.auth)
    octo.user.repos.create({ name: tempRepoName, auto_init: true }, t.end)
  })
}

function teardown () {
  test('Delete temporary test repo', function (t) {
    var octo = new Octokat(options.auth)
    octo.repos(testUser, tempRepoName).remove(t.end)
  })
}

// This is necessary because sometimes the github API cannot keep up
// and we get errors
function pauseAndEnd (t) {
  return function (err) {
    setTimeout(t.end.bind(null, err), 500)
  }
}

setup()

test('Creates new file', function (t) {
  fs.writeFile('test.txt', 'hello world', pauseAndEnd(t))
})

test('Updates an existing file', function (t) {
  fs.writeFile('test.txt', 'hello planet', pauseAndEnd(t))
})

test('Creates large file', function (t) {
  fs.writeFile('test.bin', new Buffer(1100000), pauseAndEnd(t))
})

test('Updates large file', function (t) {
  fs.writeFile('test.bin', new Buffer(1100002), pauseAndEnd(t))
})

test('Reads text file', function (t) {
  fs.readFile('test.txt', { encoding: 'utf8' }, function (err, data) {
    t.error(err)
    t.equal(data, 'hello planet')
    t.end()
  })
})

test('Error reading non-existent file', function (t) {
  fs.readFile('dontexist.txt', { encoding: 'utf8' }, function (err, data) {
    t.ok(err, 'Should throw error')
    t.equal(err.message, 'File not found')
    t.end()
  })
})

test('Error reading file from invalid repo', function (t) {
  var options = {
    owner: testUser,
    repo: tempRepoName + '123',
    auth: {
      token: process.env.GITHUB_TOKEN
    }
  }
  var fs = hubfs(options)

  fs.readFile('test.txt', { encoding: 'utf8' }, function (err, data) {
    t.ok(err, 'Should throw error')
    t.equal(err.message, 'File not found')
    t.end()
  })
})

test('Reads binary file', function (t) {
  fs.readFile('test.txt', function (err, data) {
    t.error(err)
    t.ok(bufferEqual(data, new Buffer('hello planet')), 'Buffer contents match')
    t.end()
  })
})

test('Reads large file', function (t) {
  fs.readFile('test.bin', t.end)
})

test('Returns error trying to write to invalid repo', function (t) {
  var options = {
    owner: testUser,
    repo: tempRepoName + '123',
    auth: {
      token: process.env.GITHUB_TOKEN
    }
  }
  var fs = hubfs(options)

  fs.writeFile('test.txt', 'hello planet', function (err) {
    t.ok(err, 'should throw error')
    t.equal(err.message, 'Invalid repo')
    t.end()
  })
})

test('Writes multiple files without error', function (t) {
  var tasks = []
  for (var i = 0; i < 20; i++) {
    tasks.push(function (i) {
      return function (cb) {
        fs.writeFile('test' + i + '.txt', 'hello planet' + i, function (err) {
          t.error(err, 'wrote test' + i + '.txt')
          cb(err)
        })
      }
    }(i))
  }
  async.parallel(tasks, function (err) {
    t.error(err, 'completed without error')
    t.skip('checking files exist')
    var tasks = []
    for (var i = 0; i < 20; i++) {
      tasks.push(function (i) {
        return function (cb) {
          fs.readFile('test' + i + '.txt', function (err) {
            t.error(err, 'test' + i + '.txt exists')
            cb(err)
          })
        }
      }(i))
    }
    async.parallel(tasks, function (err) {
      t.error(err, 'all files exist on repo')
      t.end()
    })
  })
})

teardown()
