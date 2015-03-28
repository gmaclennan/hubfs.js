var extend = require("xtend");

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
 * @param  {Octokat.users.repo} repo A vaid repo returned from Octokat with
 * the call `octo.user.repos('user', 'reponame')`. See below for examples.
 * @return {Object}      returns and instance of hubfs with two methods
 * `readFile` and `writeFile`.
 * @example
 * var hubfs = require('hubfs');
 * var Octokat = require('octokat');
 *
 * var octo = new Octocat({ username: "USER_NAME", password: "PASSWORD" });
 *
 * var gh = hubfs(octo.repos('owner', 'repo'));
 */
function hubfs(repo) {
  if (!(this instanceof hubfs)) {
    return new hubfs(repo);
  }
  // Basic checks that we have a valid octokat repo.
  if ((typeof repo !== 'function') ||
    (typeof repo.contents !== 'function') ||
    (typeof repo.git !== 'function')) {
    throw new Error('Need to provide an octokat repo to constructor');
  }
  this._repo = repo;
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
 *   if (err) throw err;
 *   console.log('It\'s saved!');
 * });
 */
hubfs.prototype.writeFile = function writeFile(filename, data, options, callback) {
  if (typeof filename !== 'string' || filename.length === 0)
    throw new Error('Must provide a valid filename');
  if (typeof callback !== 'function') {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    } else {
      throw new Error('Need to provide callback');
    }
  }

  var writeDefaults = {
    encoding: 'utf8',
    message: 'Update/create ' + filename,
    branch: 'master',
    flag: 'w'
  };

  options = extend(writeDefaults, options);

  if (!(Buffer.isBuffer(data)))
    data = new Buffer(data, options.encoding);

  // Remove preceding slash on filename
  filename.replace(/^\//, '');

  var params = {
    path: filename,
    message: options.message,
    branch: options.branch,
    content: data.toString('base64')
  };

  var file = this._repo.contents(filename);
  var _this = this;

  // First, just try to write the file without a sha, but if we get a 422 error,
  // try to get the sha and write an update
  file.add(params, function(err, info) {
    if (info === false) return callback(new Error('Invalid repo'))
    if (!err) return callback(null);
    if (err.status !== 422 || options.flags === 'wx') return callback(err);
    return _this._getSha.call(_this, params, function(err, sha) {
      if (err) return callback(err);
      params.sha = sha;
      file.add(params, callback);
    });
  });
};

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
 *   if (err) throw err;
 *   console.log(data);
 * });
 */
hubfs.prototype.readFile = function readFile(filename, options, callback) {
  if (typeof filename !== 'string' || filename.length === 0)
    throw new Error('Must provide a valid filename');
  if (typeof callback !== 'function') {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    } else {
      throw new Error('Need to provide callback');
    }
  }

  var readDefaults = {
    encoding: null,
    ref: 'master'
  };

  options = extend(readDefaults, options);

  // Remove preceding slash on filename
  filename.replace(/^\//, '');

  var params = {
    ref: options.ref
  };

  var file = this._repo.contents(filename);
  var _this = this;

  file.fetch(params, function(err, data) {
    if (!err) return encodeContents(data);
    // We will get an error if trying to read a large file
    // (Github says > 1Mb, but sometimes smaller files fail too)
    // So we try to get the blob the long way round.
    params.path = filename;
    _this._getShaSlow.call(_this, params, function(err, sha) {
      if (err) return callback(err);
      _this._repo.git.blobs(sha).fetch(function(err, data) {
        if (err) return callback(err);
        encodeContents(data);
      });
    });
  });

  function encodeContents(data) {
    var content = new Buffer(data.content, data.encoding);
    if (options.encoding !== null)
      content = content.toString(options.encoding);
    callback(null, content);
  }
};

hubfs.prototype._getSha = function _getSha(params, cb) {
  var _this = this;

  _this._repo.contents(params.path).fetch(params, function(err, info) {
    if (!err) return cb(null, info.sha);
    // This API only supports up to 1Mb, so let's try another way
    _this._getShaSlow.call(_this, params, cb);
  });
};

hubfs.prototype._getShaSlow = function _getShaSlow(params, cb) {
  var repo = this._repo;
  repo.git.refs('heads/' + (params.branch || params.ref)).fetch(function(err, ref) {
    if (err) return cb(new Error('File not found'));
    repo.git.commits(ref.object.sha).fetch(function(err, commit) {
      if (err) return cb(new Error('File not found'));
      repo.git.trees(commit.tree.sha + '?recursive=1').fetch(function(err, tree) {
        if (err) return cb(new Error('File not found'));
        for (var i = 0; i < tree.tree.length; i++) {
          if (tree.tree[i].path === params.path) {
            return cb(null, tree.tree[i].sha);
          }
        }
        cb(new Error('File not found'));
      });
    });
  });
};

module.exports = hubfs;
