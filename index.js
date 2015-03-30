var extend = require('xtend')
var async = require('async')

/**
 * A mixin for [Octokat.js](https://github.com/philschatz/octokat.js) that
 * provides a simple wrapper for writing to and reading from a repo. It
 * provides an interface similar to node.js `fs.readFile` and `fs.writeFile`.
 *
 * The Github API does not provide an easy way to update a file, and there are
 * some little tricky issues around maximum file size for reading using the
 * [contents API](https://developer.github.com/v3/repos/contents/). This tries
 * to do things the easy (quick) way first, but if not will also work for
 * larger files up to 100Mb.
 *
 * Also handles multiple asynchronous file writes gracefully, queueing up
 * writes to avoid Github errors from fast forward commits, and batching
 * file writes into single commits of up to 10 files at a time, if you try
 * to write another file whilst another is being written to the same repo
 * and branch.
 * @param  {Octokat.users.repo} repo A vaid repo returned from Octokat with
 * the call `octo.user.repos('user', 'reponame')`. See below for examples.
 * @return {Object}      returns and instance of Hubfs with two methods
 * `readFile` and `writeFile`.
 * @example
 * var Hubfs = require('Hubfs')
 * var Octokat = require('octokat')
 *
 * var octo = new Octocat({ username: "USER_NAME", password: "PASSWORD" })
 *
 * var gh = Hubfs(octo.repos('owner', 'repo'))
 */
function Hubfs (repo) {
  if (!(this instanceof Hubfs)) {
    return new Hubfs(repo)
  }
  // Basic checks that we have a valid octokat repo.
  if ((typeof repo !== 'function') ||
    (typeof repo.contents !== 'function') ||
    (typeof repo.git !== 'function')) {
    throw new Error('Need to provide an octokat repo to constructor')
  }
  this._repo = repo
  this._queue = async.queue(this._createBlob.bind(this), 50)
  this._cargos = {}
  this._status = {}
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
  var branch = options.branch
  var status = this._status[branch] = this._status[branch] || {}

  var params = {
    path: filename,
    message: options.message,
    branch: branch,
    content: data.toString('base64')
  }

  var _this = this

  if (status.writing && !status.next) {
    this._queue.pause()
    status.next = function () {
      _this._queue.resume()
      status.next = null
    }
  }

  if (options.safe || status.writing || status.queueing) {
    var cargo
    status.queueing = true
    if (!this._cargos[branch]) {
      cargo = this._cargos[branch] = async.cargo(cargoWorker, 10)
      cargo.drain = function () { status.queueing = false }
    } else {
      cargo = this._cargos[branch]
    }
    this._queue.push(params, function (err, file) {
      if (err) callback(err)
      cargo.push(file, callback)
    })
    return
  }

  function cargoWorker (files, cb) {
    _this._commit.call(_this, files, branch, cb)
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
 * Receives base64 encoded content and creates a new blob on the repo,
 * returning the sha
 * @private
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
 * Makes a new commit from an array of blob shas and updates the branch HEAD.
 * @param  {Array}   files    Array of `file` Objects with properties
 * `file.sha` and `file.path` and optional `file.message` commit message
 * @private
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
