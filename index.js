var extend = require('xtend')
var async = require('async')
var Octokat = require('octokat')

var queues = {}
var cargos = {}
var statuses = {}

/**
 * A mixin for [Octokat.js](https://github.com/philschatz/octokat.js) that
 * provides a simple wrapper for writing to and reading from a repo. It
 * replicates node.js `fs.readFile` and `fs.writeFile`. It has a few special
 * features:
 *
 * 1. **Minimize requests**
 *
 *     By default it tries to use the Github [contents
 * API](https://developer.github.com/v3/repos/contents/) to read, write with a
 * single request and update a file with 3 requests: (a) tries to write; (b)
 * gets sha for existing file; (c) writes update
 *
 * 2. **Read and update large files**
 *
 *     The contents API cannot read or update files larger than 1Mb. Hubfs
 * switches to the [git API](https://developer.github.com/v3/git/) to read and
 * update files up to 100Mb
 *
 * 3. **Simultaneous writes**
 *
 *     Repeatedly writing to the contents API [will result in an
 * error](http://stackoverflow.com/questions/19576601/github-api-issue-with-file-upload)
 * because of delays updating the HEAD, and making multiple simultaneous
 * writes will result in the same problem of Fast Forward commits. Hubfs will
 * automatically queue up requests and switch to using the git API for
 * multiple parallel writes. It will batch together multiple writes to the
 * same repo in commits of up to 10 files, but will make commits as quickly as
 * it can.
 *
 * **Limitations**
 *
 * - Repeat writes do not currently respect `options.flags='wx'` (they will
 * overwrite existing files)
 *
 * - Maximum batch size for commits cannot be changed, awaiting [upstream
 * async issue](https://github.com/caolan/async/pull/740)
 *
 * ### Breaking change in v1.0.0
 *
 * No longer operates as a Octokat mixin, instead new instances are created
 * with an `options` object with the owner, repo and auth, which is passed
 * to Octokat.
 *
 * @param  {Object} options `options.owner` Github repo owner, `options.repo`
 * repo name, `options.auth` (optional) passed through to a new
 * [Octokat instance](https://github.com/philschatz/octokat.js#in-a-browser)
 * @return {Object}      returns and instance of Hubfs with two methods
 * `readFile` and `writeFile`.
 * @example
 * var Hubfs = require('Hubfs')
 *
 * var options = {
 *   owner: 'github_username',
 *   repo: 'github_repo_name'
 *   auth: {
 *     username: "USER_NAME",
 *     password: "PASSWORD"
 *   }
 * }
 *
 * var gh = Hubfs(options)
 */
function Hubfs (options) {
  if (!(this instanceof Hubfs)) {
    return new Hubfs(options)
  }
  options = options || {}
  if (!options.owner) {
    throw new Error('Must provide Github repo owner options.owner')
  }
  if (!options.repo) {
    throw new Error('Must provide Github repo name options.repo')
  }
  this._repo = new Octokat(options.auth).repos(options.owner, options.repo)
  this._reponame = options.owner + '/' + options.repo
}

/**
 * Asynchronously writes data to a file on Github, replacing the file if it
 * already exists. `data` can be a string or a buffer.
 *
 * The `encoding` option is ignored if `data` is a buffer. It defaults to `'utf8'`.
 *
 * The file path is always interpreted from the root of the repo, whether or
 * not it is preceded by a slash.
 *
 * @param  {String}   filename
 * @param  {String|Buffer}   data
 * @param  {Object}   [options] `options.encoding='utf8'` `options.flag='w'`
 * default will overwrite, `'wx'` will fail if path exists. `options.message` Commit message. `options.branch='master'` branch to write to.
 * @param  {Function} callback
 * @example
 * gh.writeFile('message.txt', 'Hello Github', function (err) {
 *   if (err) throw err
 *   console.log('It\'s saved!')
 * })
 */
Hubfs.prototype.writeFile = function writeFile (filename, data, options, callback) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('Must provide a valid filename')
  }
  if (typeof callback !== 'function') {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    } else {
      throw new Error('Need to provide callback')
    }
  }

  var writeDefaults = {
    encoding: 'utf8',
    message: 'Update/create ' + filename,
    branch: 'master',
    flag: 'w'
  }

  options = extend(writeDefaults, options)

  if (!(Buffer.isBuffer(data))) {
    data = new Buffer(data, options.encoding)
  }

  // Remove preceding slash on filename
  filename.replace(/^\//, '')

  // Writes to each repo/branch need to be queued to avoid Fast Forward errors
  var id = this._reponame + '/' + options.branch
  var status = statuses[id] = statuses[id] || {}
  var queue = queues[id] = queues[id] || async.queue(this._createBlob.bind(this), 50)
  var cargo = cargos[id] = cargos[id] || async.cargo(cargoWorker, 10)
  cargo.drain = function () { status.queueing = false }

  var params = {
    path: filename,
    message: options.message,
    branch: options.branch,
    content: data.toString('base64')
  }

  var _this = this

  if (status.writing && !status.next) {
    queue.pause()
    status.next = function () {
      queue.resume()
      status.next = null
    }
  }

  if (options.safe || status.writing || status.queueing) {
    status.queueing = true
    queue.push(params, function (err, file) {
      if (err) callback(err)
      cargo.push(file, callback)
    })
    return
  }

  function cargoWorker (files, cb) {
    _this._commit.call(_this, files, options.branch, cb)
  }

  var file = this._repo.contents(filename)
  status.writing = true

  // First, just try to write the file without a sha, but if we get a 422 error,
  // try to get the sha and write an update
  file.add(params, function (err, info) {
    if (info === false) return done(new Error('Invalid repo'))
    if (!err) return done(null)
    if (err.status !== 422 || options.flags === 'wx') return done(err)
    _this._getBlobSha.call(_this, params, function (err, sha) {
      if (err) return done(err)
      params.sha = sha
      file.add(params, done)
    })
  })

  function done (err) {
    // Using the Github contents API we need to leave a slight delay
    // before it's safe to write to the repo again
    // http://stackoverflow.com/questions/19576601/github-api-issue-with-file-upload
    setTimeout(function () {
      status.writing = false
      if (typeof status.next === 'function') status.next()
    }, 500)
    callback(err)
  }
}

/**
 * Asynchronously read a file on Github.
 *
 * The file path is always interpreted from the root of the repo, whether or
 * not it is preceded by a slash.
 *
 * The callback is passed two arguments `(err, data)`, where `data` is the
 * contents of the file.
 *
 * If no encoding is specified, then the raw buffer is returned.
 * @param  {String}   filename
 * @param  {Object}   [options] `options.encoding=null` (returns Buffer)
 * `options.ref='master'` name of the commit/branch/tag
 * @param  {Function} callback
 * @example
 * gh.readFile('/my_folder/my_file.txt', function (err, data) {
 *   if (err) throw err
 *   console.log(data)
 * })
 */
Hubfs.prototype.readFile = function readFile (filename, options, callback) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('Must provide a valid filename')
  }
  if (typeof callback !== 'function') {
    if (typeof options === 'function') {
      callback = options
      options = undefined
    } else {
      throw new Error('Need to provide callback')
    }
  }

  var readDefaults = {
    encoding: null,
    ref: 'master'
  }

  options = extend(readDefaults, options)

  // Remove preceding slash on filename
  filename.replace(/^\//, '')

  var params = {
    ref: options.ref
  }

  var file = this._repo.contents(filename)
  var _this = this

  file.fetch(params, function (err, data) {
    if (!err) return encodeContents(data)
    if (err.status === 404) return callback(new Error('File not found'))
    // We will get an error if trying to read a large file
    // (Github says > 1Mb, but sometimes smaller files fail too)
    // So we try to get the blob the long way round.
    params.path = filename
    _this._getBlobShaSlow.call(_this, params, function (err, sha) {
      if (err) return callback(err)
      _this._repo.git.blobs(sha).fetch(function (err, data) {
        if (err) return callback(err)
        encodeContents(data)
      })
    })
  })

  function encodeContents (data) {
    var content = new Buffer(data.content, data.encoding)
    if (options.encoding !== null) {
      content = content.toString(options.encoding)
    }
    callback(null, content)
  }
}

Hubfs.prototype._getBlobSha = function _getBlobSha (params, callback) {
  var _this = this
  _this._repo.contents(params.path).fetch(params, function (err, info) {
    if (!err) return callback(null, info.sha)
    // This API only supports up to 1Mb, so let's try another way
    _this._getBlobShaSlow.call(_this, params, callback)
  })
}

Hubfs.prototype._getBlobShaSlow = function _getBlobShaSlow (params, callback) {
  var _repo = this._repo
  async.waterfall([
    _repo.git.refs('heads/' + (params.branch || params.ref)).fetch,
    function (ref, cb) {
      _repo.git.commits(ref.object.sha).fetch(cb)
    },
    function (commit, cb) {
      cb(null, commit.tree.sha)
    },
    function (sha, cb) {
      _repo.git.trees(sha + '?recursive=1').fetch(cb)
    },
    function (tree, cb) {
      var sha = tree.tree.filter(function (entry) {
        return entry.path === params.path
      })[0].sha
      cb(null, sha)
    }
  ], callback)
}

/**
 * @function
 * @private
 * Receives base64 encoded content and creates a new blob on the repo,
 * returning the sha
 * @param  {Sting}   content  `base64` encoded content
 * @param  {Function} callback called with new blob sha
 */
Hubfs.prototype._createBlob = function _createBlob (params, callback) {
  var input = {
    content: params.content,
    encoding: 'base64'
  }
  var file = {
    path: params.path,
    message: params.message
  }
  this._repo.git.blobs.create(input, function (err, response) {
    if (err) return callback(err)
    file.sha = response.sha
    callback(null, file)
  })
}

/**
 * @function
 * @private
 * Makes a new commit from an array of blob shas and updates the branch HEAD.
 * @param  {Array}   files    Array of `file` Objects with properties
 * `file.sha` and `file.path` and optional `file.message` commit message
 * @param  {String}   branch   Branch to commit to
 * @param  {Function} callback Called with ref to new head
 */
Hubfs.prototype._commit = function (files, branch, callback) {
  var _repo = this._repo
  async.waterfall([
    _repo.git.refs('heads/' + branch).fetch,
    function (ref, cb) {
      _repo.git.commits(ref.object.sha).fetch(cb)
    },
    function (commit, cb) {
      cb(null, commit.sha, commit.tree.sha)
    },
    function (commitSha, treeSha, cb) {
      var newTree = {
        base_tree: treeSha,
        tree: files.map(function (file) {
          return {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: file.sha
          }
        })
      }
      _repo.git.trees.create(newTree, function (err, tree) {
        cb(err, commitSha, tree.sha)
      })
    },
    function (commitSha, treeSha, cb) {
      var newCommit = {
        tree: treeSha,
        parents: [ commitSha ],
        message: files.reduce(function (prev, curr) {
          return prev + curr.path + ': ' + (curr.message || '') + '\n'
        }, 'Added new files\n\n')
      }
      _repo.git.commits.create(newCommit, cb)
    },
    function (commit, cb) {
      var newRef = {
        sha: commit.sha,
        force: true
      }
      _repo.git.refs('heads/' + branch).update(newRef, cb)
    }
  ], callback)
}

module.exports = Hubfs
