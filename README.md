# hubfs.js

[![build status](https://secure.travis-ci.org/gmaclennan/hubfs.js.png)](http://travis-ci.org/gmaclennan/hubfs.js)

Github API wrapper to writeFile and readFile


### `Hubfs(repo)`

A mixin for [Octokat.js](https://github.com/philschatz/octokat.js) that
provides a simple wrapper for writing to and reading from a repo. It
provides an interface similar to node.js `fs.readFile` and `fs.writeFile`.

The Github API does not provide an easy way to update a file, and there are
some little tricky issues around maximum file size for reading using the
[contents API](https://developer.github.com/v3/repos/contents/). This tries
to do things the easy (quick) way first, but if not will also work for
larger files up to 100Mb.

Also handles multiple asynchronous file writes gracefully, queueing up
writes to avoid Github errors from fast forward commits, and batching
file writes into single commits of up to 10 files at a time, if you try
to write another file whilst another is being written to the same repo
and branch.

### Parameters

| parameter | type                 | description                                                                                                    |
| --------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `repo`    | Octokat\.users\.repo | A vaid repo returned from Octokat with the call `octo.user.repos('user', 'reponame')`. See below for examples. |


### Example

```js
var Hubfs = require('Hubfs')
var Octokat = require('octokat')

var octo = new Octocat({ username: "USER_NAME", password: "PASSWORD" })

var gh = Hubfs(octo.repos('owner', 'repo'))
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


### `_createBlob(content, callback)`

Receives base64 encoded content and creates a new blob on the repo,
returning the sha

### Parameters

| parameter  | type     | description              |
| ---------- | -------- | ------------------------ |
| `content`  | Sting    | `base64` encoded content |
| `callback` | Function | called with new blob sha |



### `_commit(files, branch, callback)`

Makes a new commit from an array of blob shas and updates the branch HEAD.

### Parameters

| parameter  | type     | description                                                                                                   |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `files`    | Array    | Array of `file` Objects with properties `file.sha` and `file.path` and optional `file.message` commit message |
| `branch`   | String   | Branch to commit to                                                                                           |
| `callback` | Function | Called with ref to new head                                                                                   |


## Installation

Requires [nodejs](http://nodejs.org/).

```sh
$ npm install hubfs.js
```

## Tests

```sh
$ npm test
```


