# hubfs.js

[![build status](https://secure.travis-ci.org/gmaclennan/hubfs.js.png)](http://travis-ci.org/gmaclennan/hubfs.js)

Github API wrapper to writeFile and readFile


### `Hubfs(options)`

A mixin for [Octokat.js](https://github.com/philschatz/octokat.js) that
provides a simple wrapper for writing to and reading from a repo. It
replicates node.js `fs.readFile` and `fs.writeFile`. It has a few special
features:

1. **Minimize requests**

    By default it tries to use the Github [contents
API](https://developer.github.com/v3/repos/contents/) to read, write with a
single request and update a file with 3 requests: (a) tries to write; (b)
gets sha for existing file; (c) writes update

2. **Read and update large files**

    The contents API cannot read or update files larger than 1Mb. Hubfs
switches to the [git API](https://developer.github.com/v3/git/) to read and
update files up to 100Mb

3. **Simultaneous writes**

    Repeatedly writing to the contents API [will result in an
error](http://stackoverflow.com/questions/19576601/github-api-issue-with-file-upload)
because of delays updating the HEAD, and making multiple simultaneous
writes will result in the same problem of Fast Forward commits. Hubfs will
automatically queue up requests and switch to using the git API for
multiple parallel writes. It will batch together multiple writes to the
same repo in commits of up to 10 files, but will make commits as quickly as
it can.

**Limitations**

- Repeat writes do not currently respect `options.flags='wx'` (they will
overwrite existing files)

- Maximum batch size for commits cannot be changed, awaiting [upstream
async issue](https://github.com/caolan/async/pull/740)

### Breaking change in v1.0.0

No longer operates as a Octokat mixin, instead new instances are created
with an `options` object with the owner, repo and auth, which is passed
to Octokat.


### Parameters

| parameter | type   | description                                                                                                                                                                              |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options` | Object | `options.owner` Github repo owner, `options.repo` repo name, `options.auth` (optional) passed through to a new
[Octokat instance](https://github.com/philschatz/octokat.js#in-a-browser) |


### Example

```js
var Hubfs = require('Hubfs')

var options = {
  owner: 'github_username',
  repo: 'github_repo_name'
  auth: {
    username: "USER_NAME",
    password: "PASSWORD"
  }
}

var gh = Hubfs(options)
```


**Returns** `Object`, returns and instance of Hubfs with two methods `readFile` and `writeFile`.


### `writeFile(filename, data, [options], callback)`

Asynchronously writes data to a file on Github, replacing the file if it
already exists. `data` can be a string or a buffer.

The `encoding` option is ignored if `data` is a buffer. It defaults to `'utf8'`.

The file path is always interpreted from the root of the repo, whether or
not it is preceded by a slash.


### Parameters

| parameter   | type           | description                                                                                                                                                                                       |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filename`  | String         |                                                                                                                                                                                                   |
| `data`      | String\,Buffer |                                                                                                                                                                                                   |
| `[options]` | Object         | _optional:_ `options.encoding='utf8'` `options.flag='w'` default will overwrite, `'wx'` will fail if path exists. `options.message` Commit message. `options.branch='master'` branch to write to. |
| `callback`  | Function       |                                                                                                                                                                                                   |


### Example

```js
gh.writeFile('message.txt', 'Hello Github', function (err) {
  if (err) throw err
  console.log('It\'s saved!')
})
```


### `readFile(filename, [options], callback)`

Asynchronously read a file on Github.

The file path is always interpreted from the root of the repo, whether or
not it is preceded by a slash.

The callback is passed two arguments `(err, data)`, where `data` is the
contents of the file.

If no encoding is specified, then the raw buffer is returned.

### Parameters

| parameter   | type     | description                                                                                               |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `filename`  | String   |                                                                                                           |
| `[options]` | Object   | _optional:_ `options.encoding=null` (returns Buffer) `options.ref='master'` name of the commit/branch/tag |
| `callback`  | Function |                                                                                                           |


### Example

```js
gh.readFile('/my_folder/my_file.txt', function (err, data) {
  if (err) throw err
  console.log(data)
})
```

## Installation

Requires [nodejs](http://nodejs.org/).

```sh
$ npm install hubfs.js
```

## Tests

```sh
$ npm test
```


