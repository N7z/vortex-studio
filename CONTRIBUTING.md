# Contributing

Thanks for helping out. This file covers how the project is organised and what a
pull request needs before it can be merged.

## Getting set up

You need PHP 8.3 or newer, Composer, and Node 20 or newer.

```
composer install
npm install
cp .env.example .env
php artisan key:generate
```

Run the app with `php artisan serve` and `npm run dev` in two terminals.

The live editing server is a separate package. If you are working on team editing,
install it too:

```
cd live-editing-server
npm install
npm start
```

## Branches

`master` is what runs in production. `develop` is where work lands first.

Open your pull request against `develop`. Only `develop` gets merged into `master`,
and that happens when a release goes out.

Branch off `develop` and give the branch a name that says what it does, like
`fix-arrow-camera` or `add-material-picker`.

## Before you open a pull request

Run everything the CI runs, so you find problems before the bot does:

```
npm test
npm run build
node luacheck.mjs
./vendor/bin/pest
cd live-editing-server && npm test
```

All of it has to pass. A pull request with a red check does not get merged.

## Commit messages

Write the subject in lowercase, as an instruction, saying what the change makes the
app do:

```
let an unanchored part fall and be stood on in the play test
stop the walk stampede when a player stands still
```

Not `Fixed bug` or `updates`. If someone reads only the subject line they should
know what changed.

Keep it to one line. No body, no `Co-authored-by` trailer. If a change needs
paragraphs of explanation, that explanation belongs in the pull request description,
where people can read it next to the diff.

One commit per idea. If you fixed two unrelated things, send two pull requests.

## Code style

Follow whatever the file around you already does. Indentation, naming and import
order come from the neighbours, not from a personal preference.

PHP follows the Laravel conventions. JavaScript uses four spaces and single quotes.

### Comments

Most code does not need a comment. The name of a function and the shape of the code
say what it does, and a comment that repeats them goes stale the moment someone
edits the line above it.

Write a comment when the reason for the code is not visible in the code. Something
you would only know from a browser bug, a file format, or a decision made elsewhere:

```js
// firefox cancels the download if the URL is revoked in the same tick
// glTF puts v = 0 at the top row and leaves flipY off, OBJ flips
```

Start it in lowercase. Keep it to one line. If you need more than two lines to
explain a function, the function is probably doing too much, so split it instead.

Do not leave commented out code behind. Git remembers it.

## Tests

A bug fix comes with a test that fails without the fix. A new feature comes with a
test for the part of it that has rules, like a limit, a permission, or a format.

PHP tests live in `tests/Feature`. JavaScript tests live in `scripts/*.test.mjs`.
The live editing server has its own tests in `live-editing-server/test`.

## Pull request description

Say what the change does and why. If it changes something people can see, add a
screenshot or a short clip. If it changes the saved map format, say so clearly,
because that affects files people already have.

## Releases

`master` is tagged with a version like `v1.2.0` when a release goes out.

The middle number goes up for new features, the last number for fixes. The first
number goes up only when the saved map format changes in a way that older files or
older builds cannot handle.

You do not need to touch the version yourself. Tagging happens on `master` after
`develop` is merged in.
