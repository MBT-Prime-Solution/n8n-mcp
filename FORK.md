# MBT-Prime-Solution fork of n8n-mcp

Fork of [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp) that adds the
community node packages installed on our n8n instances to the node catalog, so
`search_nodes`, `get_node` and validation know them with full schemas.

## What differs from upstream

- `src/loaders/node-loader.ts`: `EXTRA_COMMUNITY_PACKAGES` list and
  `N8nNodeLoader.loadExtraCommunityNodes()`.
- `src/scripts/add-extra-community-nodes.ts` (`npm run add:extra-community`):
  upserts only those packages into `data/nodes.db` as community rows
  (`is_community = 1`, full npm package name as type prefix, e.g.
  `n8n-nodes-a2a-protocol.a2aClientAgent`). It leaves every other row as it is,
  so upstream's core node docs and community READMEs stay.
- `package.json`: the extra packages as pinned dependencies, plus the npm script.
- `data/nodes.db`: upstream's database with the extra rows added.

Currently added: `n8n-nodes-a2a-protocol@1.1.1`.

## Adding another package

1. `npm install --save-exact --legacy-peer-deps --ignore-scripts <package>@<version>`
2. Add the package name to `EXTRA_COMMUNITY_PACKAGES` in `src/loaders/node-loader.ts`.
3. Regenerate the database (below), check, commit.

Review the package first: it is `require`d during the import, so its code runs.

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/main          # resolve conflicts; for data/nodes.db take upstream's
git checkout upstream/main -- data/nodes.db
npm install --legacy-peer-deps --ignore-scripts && npm rebuild better-sqlite3
npm run build && npm run add:extra-community
npm run build && npx vitest run tests/unit/loaders tests/unit/parsers tests/unit/database
```

Check: `sqlite3 data/nodes.db "select node_type from nodes where npm_package_name='n8n-nodes-a2a-protocol'"`.
