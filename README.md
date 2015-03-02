# ghfs

[![build status](https://secure.travis-ci.org/gmaclennan/ghfs.js.png)](http://travis-ci.org/gmaclennan/ghfs.js)

Github API wrapper to writeFile and readFile


### `ghfs(repo)`

A mixin for [Octokat.js](https://github.com/philschatz/octokat.js) that
provides a simple wrapper for writing to and reading from a repo. It
provides an interface similar to node.js `fs.readFile` and `fs.writeFile`.

The Github API does not provide an easy way to update a file, and there are
some little tricky issues around maximum file size for reading using the
[contents API](https://developer.github.com/v3/repos/contents/). This tries
to do things the easy (quick) way first, but if not will also work for
larger files up to 100Mb (although, the xmlhttprequest library used by
Octokat seems to timeout for files that large)

### Parameters

| parameter | type                 | description                                                                                                    |
| --------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `repo`    | Octokat\.users\.repo | A vaid repo returned from Octokat with the call `octo.user.repos('user', 'reponame')`. See below for examples. |


### Example

```js
var ghfs = require('ghfs'); 
var Octokat = require('octokat');

var octo = new Octocat({ username: "USER_NAME", password: "PASSWORD" });

var gh = ghfs(octo.repos('owner', 'repo'));
```


**Returns** `Object`, returns and instance of ghfs with two methods `readFile` and `writeFile`.


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
  if (err) throw err;
  console.log('It\'s saved!');
});
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
  if (err) throw err; 
  console.log(data);
});
```

## Installation

Requires [nodejs](http://nodejs.org/).

```sh
$ npm install ghfs
```

## Tests

```sh
$ npm test
```


